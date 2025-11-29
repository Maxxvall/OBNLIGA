import React, { useCallback, useEffect, useState } from 'react'
import type {
  ActivePredictionMatch,
  PredictionChoiceOption,
  PredictionMarketType,
  PredictionTemplateView,
  UserPredictionEntry,
} from '@shared/types'
import { fetchActivePredictions, fetchMyPredictions, submitPrediction } from '../api/predictionsApi'
import { ExpressCartProvider } from '../store/ExpressCartContext'
import { useExpressCart, createCartItem } from '../store/expressCartHooks'
import ExpressCartButton from '../components/ExpressCartButton'
import ExpressCartModal from '../components/ExpressCartModal'
import ExpressList from '../components/ExpressList'
import '../styles/predictions.css'

const TIME_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
})

type PredictionsTab = 'upcoming' | 'mine'

const MARKET_LABELS: Record<PredictionMarketType, string> = {
  MATCH_OUTCOME: 'Исход матча',
  TOTAL_GOALS: 'Тотал голов',
  CUSTOM_BOOLEAN: 'Спецмаркет',
}

const STATUS_LABELS: Record<UserPredictionEntry['status'], string> = {
  PENDING: 'Ожидает',
  WON: 'Засчитано',
  LOST: 'Не угадан',
  VOID: 'Аннулирован',
  CANCELLED: 'Отменён',
  EXPIRED: 'Просрочен',
}

const translateSubmitError = (code?: string): string => {
  switch (code) {
  case 'no_token':
  case 'unauthorized':
    return 'Войдите в профиль, чтобы сделать прогноз.'
  case 'match_locked':
    return 'Матч уже начался — приём прогнозов закрыт.'
  case 'template_not_ready':
    return 'Этот рынок пока не активен.'
  case 'entry_locked':
    return 'Прогноз уже рассчитан и не может быть изменён.'
  case 'invalid_selection':
    return 'Выбранный вариант недоступен.'
  case 'selection_required':
    return 'Выберите вариант, прежде чем отправлять прогноз.'
  case 'weekly_limit_reached':
    return 'Вы достигли лимита 10 прогнозов в неделю.'
  default:
    return 'Не удалось сохранить прогноз. Попробуйте чуть позже.'
  }
}

const formatMatchTime = (iso: string): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }
  return TIME_FORMATTER.format(date)
}

const formatDateTime = (iso: string): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${day}.${month} ${hours}:${minutes}`
}

const translateMarketType = (marketType: PredictionMarketType): string =>
  MARKET_LABELS[marketType] ?? marketType

const computeExpectedPoints = (template: PredictionTemplateView): number => {
  const base = template.basePoints
  const multiplier = template.difficultyMultiplier ?? 1
  return Math.round(base * multiplier)
}

const translateChoiceLabel = (marketType: PredictionMarketType, rawValue: string): string => {
  const value = rawValue.trim()
  if (!value) {
    return rawValue
  }

  const upper = value.toUpperCase()

  if (marketType === 'MATCH_OUTCOME') {
    if (upper === 'ONE' || upper === '1') return 'П1'
    if (upper === 'DRAW' || upper === 'X') return 'Х' // Кириллическая Х
    if (upper === 'TWO' || upper === '2') return 'П2'
  }

  if (marketType === 'TOTAL_GOALS') {
    const overMatch = upper.match(/^OVER[_\s]?([0-9]+(?:\.[0-9]+)?)$/)
    if (overMatch) {
      return 'Больше'
    }
    const underMatch = upper.match(/^UNDER[_\s]?([0-9]+(?:\.[0-9]+)?)$/)
    if (underMatch) {
      return 'Меньше'
    }
    if (upper === 'OVER') return 'Больше'
    if (upper === 'UNDER') return 'Меньше'
  }

  if (marketType === 'CUSTOM_BOOLEAN') {
    if (upper === 'YES' || upper === 'TRUE') return 'Да'
    if (upper === 'NO' || upper === 'FALSE') return 'Нет'
  }

  return rawValue
}

const FALLBACK_CHOICES: Partial<Record<PredictionMarketType, PredictionChoiceOption[]>> = {
  MATCH_OUTCOME: [
    { value: 'ONE', label: 'П1' },
    { value: 'DRAW', label: 'Х' },
    { value: 'TWO', label: 'П2' },
  ],
}

const normalizeTemplateChoices = (template: PredictionTemplateView): PredictionChoiceOption[] => {
  const seen = new Map<string, PredictionChoiceOption>()

  const pushChoice = (value: string, label?: string, description?: string | null, points?: number | null) => {
    const trimmedValue = value.trim()
    if (!trimmedValue) {
      return
    }
    if (seen.has(trimmedValue)) {
      return
    }
    const fallbackLabel = translateChoiceLabel(template.marketType, trimmedValue)
    const candidateLabel = label && label.trim().length > 0 ? label.trim() : undefined

    let resolvedLabel = candidateLabel ?? fallbackLabel

    if (template.marketType === 'TOTAL_GOALS') {
      const normalizedCandidate = (candidateLabel ?? '').toLowerCase()
      if (
        !candidateLabel ||
        normalizedCandidate === trimmedValue.toLowerCase() ||
        normalizedCandidate === 'да' ||
        normalizedCandidate === 'нет' ||
        normalizedCandidate === 'yes' ||
        normalizedCandidate === 'no' ||
        normalizedCandidate === 'true' ||
        normalizedCandidate === 'false' ||
        normalizedCandidate.startsWith('over') ||
        normalizedCandidate.startsWith('under')
      ) {
        resolvedLabel = fallbackLabel
      }
    } else if (template.marketType === 'CUSTOM_BOOLEAN') {
      const normalizedCandidate = (candidateLabel ?? '').toUpperCase()
      if (normalizedCandidate === 'YES' || normalizedCandidate === 'NO') {
        resolvedLabel = translateChoiceLabel(template.marketType, trimmedValue)
      }
    }

    seen.set(trimmedValue, {
      value: trimmedValue,
      label: resolvedLabel,
      description: description ?? null,
      points: points ?? null,
    })
  }

  const consumeUnknown = (candidate: unknown) => {
    if (typeof candidate === 'string') {
      pushChoice(candidate)
      return
    }
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      pushChoice(String(candidate))
      return
    }
    if (candidate && typeof candidate === 'object') {
      const record = candidate as { value?: unknown; label?: unknown; description?: unknown; points?: unknown }
      if (typeof record.value === 'string') {
        const label = typeof record.label === 'string' ? record.label : undefined
        const description = typeof record.description === 'string' ? record.description : null
        const points = typeof record.points === 'number' ? record.points : null
        pushChoice(record.value, label, description, points)
      }
    }
  }

  const { options } = template
  if (Array.isArray(options)) {
    options.forEach(consumeUnknown)
  } else if (options && typeof options === 'object') {
    const record = options as Record<string, unknown>
    if (Array.isArray(record.choices)) {
      record.choices.forEach(consumeUnknown)
    }
    if (Array.isArray(record.options)) {
      record.options.forEach(consumeUnknown)
    }
    if (Array.isArray(record.values)) {
      record.values.forEach(consumeUnknown)
    }
  }

  if (seen.size === 0) {
    const fallback = FALLBACK_CHOICES[template.marketType]
    fallback?.forEach(choice => pushChoice(choice.value, choice.label, choice.description ?? null))
  }

  return Array.from(seen.values())
}

type TemplateMeta = {
  title: string
  subtitle?: string | null
  group: 'primary' | 'special'
}

const recordFromOptions = (options: unknown): Record<string, unknown> | null => {
  if (!options || typeof options !== 'object') {
    return null
  }
  return options as Record<string, unknown>
}

// Функция для определения порядка сортировки templates
// Порядок: Тотал-1, Основной тотал, Тотал+1, Пенальти, Красная карточка
const getTemplateSortOrder = (template: PredictionTemplateView): number => {
  const meta = resolveTemplateMeta(template)
  const title = meta.title.toLowerCase()

  // MATCH_OUTCOME - самый первый (но он отдельно обрабатывается)
  if (template.marketType === 'MATCH_OUTCOME') {
    return 0
  }

  // TOTAL_GOALS с разными линиями
  if (template.marketType === 'TOTAL_GOALS') {
    const options = recordFromOptions(template.options)
    let line: number | null = null
    if (typeof options?.line === 'number') {
      line = options.line
    } else if (typeof options?.formattedLine === 'string') {
      const parsedLine = parseFloat(options.formattedLine)
      line = Number.isNaN(parsedLine) ? null : parsedLine
    }
    
    if (line !== null && !Number.isNaN(line)) {
      let delta: number | null = null
      const rawDelta = options?.delta
      if (typeof rawDelta === 'number' && Number.isFinite(rawDelta)) {
        delta = rawDelta
      } else if (typeof rawDelta === 'string') {
        const parsedDelta = Number(rawDelta.replace(',', '.'))
        if (Number.isFinite(parsedDelta)) {
          delta = parsedDelta
        }
      }
      if (delta !== null) {
        // Тотал-1
        if (delta < 0) return 10
        // Тотал+1
        if (delta > 0) return 30
      }
      // Основной тотал (delta === 0 или отсутствует)
      return 20
    }
    return 20 // дефолтный тотал
  }

  // CUSTOM_BOOLEAN - проверяем по названию
  if (template.marketType === 'CUSTOM_BOOLEAN') {
    // Пенальти
    if (title.includes('пенальт') || title.includes('penalty')) {
      return 40
    }
    // Красная карточка
    if (title.includes('красн') || title.includes('red') || title.includes('карточк')) {
      return 50
    }
    // Остальные спецсобытия
    return 60
  }

  return 100 // все остальные в конец
}

// Сортировка шаблонов
const sortTemplates = (templates: PredictionTemplateView[]): PredictionTemplateView[] => {
  return [...templates].sort((a, b) => getTemplateSortOrder(a) - getTemplateSortOrder(b))
}

// Группировка матчей по датам
type MatchGroup = {
  dateKey: string
  dateLabel: string
  matches: ActivePredictionMatch[]
}

const formatDateGroupLabel = (date: Date): string => {
  const dayNames = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота']
  const dayName = dayNames[date.getDay()]
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${day}.${month} — ${dayName}`
}

const groupMatchesByDate = (matches: ActivePredictionMatch[]): MatchGroup[] => {
  const groups = new Map<string, ActivePredictionMatch[]>()
  
  matches.forEach(match => {
    const date = new Date(match.matchDateTime)
    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    
    if (!groups.has(dateKey)) {
      groups.set(dateKey, [])
    }
    groups.get(dateKey)!.push(match)
  })
  
  const result: MatchGroup[] = []
  groups.forEach((groupMatches, dateKey) => {
    const firstMatch = groupMatches[0]
    const date = new Date(firstMatch.matchDateTime)
    result.push({
      dateKey,
      dateLabel: formatDateGroupLabel(date),
      matches: groupMatches.sort((a, b) => 
        new Date(a.matchDateTime).getTime() - new Date(b.matchDateTime).getTime()
      ),
    })
  })
  
  return result.sort((a, b) => a.dateKey.localeCompare(b.dateKey))
}

const resolveTemplateMeta = (template: PredictionTemplateView): TemplateMeta => {
  if (template.marketType === 'TOTAL_GOALS') {
    const options = recordFromOptions(template.options)
    let formattedLine: string | null = null
    
    if (typeof options?.formattedLine === 'string') {
      const parsed = parseFloat(options.formattedLine)
      if (!Number.isNaN(parsed)) {
        const rounded = Math.round(parsed * 2) / 2
        formattedLine = rounded.toFixed(1)
      } else {
        formattedLine = options.formattedLine
      }
    } else if (typeof options?.line === 'number') {
      const rounded = Math.round(options.line * 2) / 2
      formattedLine = rounded.toFixed(1)
    }
    
    return {
      title: formattedLine ? `Тотал голов ${formattedLine}` : 'Тотал голов',
      subtitle: null,
      group: 'primary',
    }
  }

  if (template.marketType === 'CUSTOM_BOOLEAN') {
    const options = recordFromOptions(template.options)
    const title = typeof options?.title === 'string' ? options.title : 'Спец событие'
    return {
      title,
      subtitle: null,
      group: 'special',
    }
  }

  return {
    title: translateMarketType(template.marketType),
    group: 'primary',
  }
}

const renderClubCompactWithLogo = (
  club: ActivePredictionMatch['homeClub']
) => (
  <div className="prediction-club-compact">
    {club.logoUrl ? (
      <img src={club.logoUrl} alt={club.name} className="prediction-club-logo" />
    ) : (
      <div className="prediction-club-logo-placeholder" />
    )}
    <span className="prediction-club-name">{club.name}</span>
  </div>
)

const getClubShortName = (club: { name: string; shortName: string | null }): string => {
  if (club.shortName) return club.shortName
  // Генерируем сокращение из первых 3 букв названия
  const words = club.name.trim().split(/\s+/)
  if (words.length === 1) {
    return words[0].slice(0, 3).toUpperCase()
  }
  // Для названий из нескольких слов берём первые буквы
  return words.map(w => w[0]).join('').slice(0, 3).toUpperCase()
}

const renderUpcomingMatchHeader = (match: ActivePredictionMatch) => {
  const competitionLabel = match.competitionName && match.seasonName
    ? `${match.competitionName} • ${match.seasonName}`
    : match.competitionName || match.seasonName || 'Матч'
  
  return (
    <header className="prediction-card-header-compact">
      <div className="prediction-card-meta-compact">
        <span className="prediction-card-competition">{competitionLabel}</span>
        <span className="prediction-card-time">{formatMatchTime(match.matchDateTime)}</span>
      </div>
      <div className="prediction-card-teams-compact">
        {renderClubCompactWithLogo(match.homeClub)}
        <span className="prediction-vs-compact">VS</span>
        {renderClubCompactWithLogo(match.awayClub)}
      </div>
    </header>
  )
}

const formatEntrySelection = (entry: UserPredictionEntry): string => {
  if (entry.marketType === 'LEGACY_1X2' || entry.marketType === 'MATCH_OUTCOME') {
    const upper = entry.selection.toUpperCase()
    if (upper === 'ONE' || upper === '1') return 'П1'
    if (upper === 'DRAW' || upper === 'X') return 'Х'
    if (upper === 'TWO' || upper === '2') return 'П2'
    return translateChoiceLabel('MATCH_OUTCOME', entry.selection)
  }
  
  if (entry.marketType === 'LEGACY_TOTAL' || entry.marketType === 'TOTAL_GOALS') {
    const over = entry.selection.match(/^OVER[_\s]?(.+)$/i)
    if (over) {
      const total = parseFloat(over[1])
      const rounded = Math.round(total * 2) / 2
      return `ТБ ${rounded.toFixed(1)}`
    }
    const under = entry.selection.match(/^UNDER[_\s]?(.+)$/i)
    if (under) {
      const total = parseFloat(under[1])
      const rounded = Math.round(total * 2) / 2
      return `ТМ ${rounded.toFixed(1)}`
    }
    return entry.selection
  }
  
  if (entry.marketType === 'LEGACY_EVENT' || entry.marketType === 'CUSTOM_BOOLEAN') {
    const upper = entry.selection.toUpperCase()
    if (upper.includes('PENALTY')) {
      return upper.includes('YES') ? 'Пенальти — Да' : 'Пенальти — Нет'
    }
    if (upper.includes('RED_CARD') || upper.includes('REDCARD')) {
      return upper.includes('YES') ? 'Красная карточка — Да' : 'Красная карточка — Нет'
    }
    // Для других CUSTOM_BOOLEAN событий
    if (upper.includes('YES') || upper === 'TRUE') return 'Да'
    if (upper.includes('NO') || upper === 'FALSE') return 'Нет'
    return entry.selection
  }
  
  return entry.selection
}

// Мемоизированный компонент для карточки прогноза пользователя
type UserPredictionCardProps = {
  prediction: UserPredictionEntry
}

const UserPredictionCardInner: React.FC<UserPredictionCardProps> = ({ prediction }) => {
  const formattedSelection = formatEntrySelection(prediction)
  const competitionLabel = prediction.competitionName && prediction.seasonName
    ? `${prediction.competitionName} • ${prediction.seasonName}`
    : prediction.competitionName || prediction.seasonName || 'Матч'
  
  const homeShort = getClubShortName(prediction.homeClub)
  const awayShort = getClubShortName(prediction.awayClub)
  
  return (
    <li className={`prediction-entry-compact prediction-entry-${prediction.status.toLowerCase()}`}>
      <div className="prediction-entry-row">
        {/* Очки слева */}
        <div className="prediction-entry-points">
          {typeof prediction.scoreAwarded === 'number' ? (
            <span className={`points-value ${prediction.scoreAwarded > 0 ? 'positive' : prediction.scoreAwarded < 0 ? 'negative' : ''}`}>
              {prediction.scoreAwarded > 0 ? `+${prediction.scoreAwarded}` : prediction.scoreAwarded}
            </span>
          ) : (
            <span className="points-placeholder">—</span>
          )}
        </div>
        
        {/* Основная информация */}
        <div className="prediction-entry-content">
          <div className="prediction-entry-meta">
            <span className="prediction-entry-competition-short">{competitionLabel}</span>
            <span className="prediction-entry-datetime-short">{formatDateTime(prediction.matchDateTime)}</span>
            <span className={`prediction-status-compact status-${prediction.status.toLowerCase()}`}>
              {STATUS_LABELS[prediction.status] ?? prediction.status}
            </span>
          </div>
          <div className="prediction-entry-main">
            <span className="prediction-teams-short">{homeShort} vs {awayShort}</span>
            <span className="prediction-selection-value">{formattedSelection}</span>
          </div>
        </div>
      </div>
    </li>
  )
}

const UserPredictionCard = React.memo(UserPredictionCardInner, (prev, next) => {
  // Перерендер только при изменении данных прогноза
  const p = prev.prediction
  const n = next.prediction
  return (
    p.id === n.id &&
    p.status === n.status &&
    p.scoreAwarded === n.scoreAwarded &&
    p.selection === n.selection
  )
})

UserPredictionCard.displayName = 'UserPredictionCard'

const PredictionsPageInner: React.FC = () => {
  const expressCart = useExpressCart()
  const [tab, setTab] = useState<PredictionsTab>('upcoming')
  const [upcoming, setUpcoming] = useState<ActivePredictionMatch[]>([])
  const [mine, setMine] = useState<UserPredictionEntry[]>([])
  const [loadingUpcoming, setLoadingUpcoming] = useState(true)
  const [loadingMine, setLoadingMine] = useState(false)
  const [errorUpcoming, setErrorUpcoming] = useState<string | undefined>(undefined)
  const [errorMine, setErrorMine] = useState<string | undefined>(undefined)
  const [mineLoadedOnce, setMineLoadedOnce] = useState(false)
  const [isAuthorized, setIsAuthorized] = useState<boolean | undefined>(undefined)
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({})
  const [submitErrors, setSubmitErrors] = useState<Record<string, string | undefined>>({})
  const [submitSuccess, setSubmitSuccess] = useState<Record<string, string | undefined>>({})
  const [expandedMatches, setExpandedMatches] = useState<Record<string, boolean>>({})


  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoadingUpcoming(true)
      setErrorUpcoming(undefined)
      try {
        const result = await fetchActivePredictions()
        if (!cancelled) {
          setUpcoming(result.data)
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('predictions: failed to load active list', err)
          setErrorUpcoming('Не удалось загрузить список ближайших матчей.')
        }
      } finally {
        if (!cancelled) {
          setLoadingUpcoming(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (tab !== 'mine' || mineLoadedOnce) {
      return
    }

    let cancelled = false
    setLoadingMine(true)
    setErrorMine(undefined)

    const load = async () => {
      try {
        const result = await fetchMyPredictions()
        if (cancelled) return
        setMine(result.data)
        setIsAuthorized(!result.unauthorized)
      } catch (err) {
        if (!cancelled) {
          console.warn('predictions: failed to load my predictions', err)
          setErrorMine('Не удалось получить ваши прогнозы.')
        }
      } finally {
        if (!cancelled) {
          setMineLoadedOnce(true)
          setLoadingMine(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [tab, mineLoadedOnce])

  const refreshMyPredictions = useCallback(async () => {
    try {
      const result = await fetchMyPredictions()
      setMine(result.data)
      setIsAuthorized(!result.unauthorized)
      setMineLoadedOnce(true)
    } catch (err) {
      console.warn('predictions: refresh after submit failed', err)
    }
  }, [])

  const handleOptionSelect = useCallback((templateId: string, value: string) => {
    setSelectedOptions(prev => {
      // Если выбран тот же вариант - снимаем выбор
      if (prev[templateId] === value) {
        const updated = { ...prev }
        delete updated[templateId]
        return updated
      }
      // Иначе устанавливаем новый выбор
      return { ...prev, [templateId]: value }
    })
    setSubmitErrors(prev => ({ ...prev, [templateId]: undefined }))
    setSubmitSuccess(prev => ({ ...prev, [templateId]: undefined }))
  }, [])

  const toggleMatchExpanded = useCallback((matchId: string) => {
    setExpandedMatches(prev => ({ ...prev, [matchId]: !prev[matchId] }))
  }, [])

  const handleSubmit = useCallback(
    async (template: PredictionTemplateView) => {
      const choice = selectedOptions[template.id]
      if (!choice) {
        setSubmitErrors(prev => ({ ...prev, [template.id]: 'Выберите вариант, чтобы продолжить.' }))
        return
      }

      setSubmitting(prev => ({ ...prev, [template.id]: true }))
      setSubmitErrors(prev => ({ ...prev, [template.id]: undefined }))

      try {
        const result = await submitPrediction(template.id, choice)

        if (!result.ok || !result.data) {
          if (result.unauthorized) {
            setIsAuthorized(false)
          }
          const errorCode = result.validationError ?? result.error ?? (result.conflict ? 'entry_locked' : undefined)
          setSubmitErrors(prev => ({ ...prev, [template.id]: translateSubmitError(errorCode) }))
          return
        }

        setIsAuthorized(true)
        const successMessage = result.created ? 'Прогноз сохранён' : 'Прогноз обновлён'
        setSubmitSuccess(prev => ({ ...prev, [template.id]: successMessage }))
        await refreshMyPredictions()
      } catch (err) {
        console.warn('predictions: submit failed', err)
        setSubmitErrors(prev => ({ ...prev, [template.id]: translateSubmitError('unknown_error') }))
      } finally {
        setSubmitting(prev => ({ ...prev, [template.id]: false }))
      }
    },
    [selectedOptions, refreshMyPredictions]
  )

  const upcomingContent = () => {
    if (loadingUpcoming) {
      return <p className="prediction-note">Загружаем ближайшие матчи...</p>
    }

    if (errorUpcoming) {
      return <p className="prediction-error">{errorUpcoming}</p>
    }

    if (!upcoming.length) {
      return <p className="prediction-note">В ближайшие шесть дней нет доступных прогнозов.</p>
    }

    const matchGroups = groupMatchesByDate(upcoming)

    return (
      <div>
        {matchGroups.map(group => (
          <div key={group.dateKey} className="prediction-date-group">
            <h3 className="prediction-date-header">{group.dateLabel}</h3>
            <ul className="prediction-match-list">
              {group.matches.map(match => {
                if (!match.templates.length) {
                  return (
                    <li key={match.matchId} className="prediction-match">
                      {renderUpcomingMatchHeader(match)}
                      <p className="prediction-note compact">Настройки прогнозов появятся позже.</p>
                    </li>
                  )
                }

                const isExpanded = expandedMatches[match.matchId] === true
                const outcomeTemplate = match.templates.find(template => template.marketType === 'MATCH_OUTCOME')
                const otherTemplatesUnsorted = match.templates.filter(template => template.marketType !== 'MATCH_OUTCOME')
                const otherTemplates = sortTemplates(otherTemplatesUnsorted)

                const hasAnySelection = match.templates.some(template => selectedOptions[template.id])
                const anySubmitting = match.templates.some(template => submitting[template.id])
                const anyError = match.templates.map(template => submitErrors[template.id]).find(Boolean)
                const anySuccess = match.templates.map(template => submitSuccess[template.id]).find(Boolean)

                const renderTemplateOptions = (template: PredictionTemplateView) => {
                  const meta = resolveTemplateMeta(template)
                  const choices = normalizeTemplateChoices(template)
                  const selected = selectedOptions[template.id]
                  const expectedPoints = computeExpectedPoints(template)

                  if (!choices.length) {
                    return null
                  }

                  return (
                    <section key={template.id} className="prediction-market-inline">
                      <div className="prediction-market-inline-header">
                        <span className="prediction-market-inline-title">{meta.title}</span>
                      </div>
                      <div className="prediction-options">
                        {choices.map(choice => {
                          const choicePoints = choice.points ?? expectedPoints
                          return (
                            <button
                              type="button"
                              key={choice.value}
                              className={`prediction-option${selected === choice.value ? ' selected' : ''}`}
                              onClick={() => handleOptionSelect(template.id, choice.value)}
                              disabled={anySubmitting}
                            >
                              <span className="prediction-option-label">{choice.label}</span>
                              <span className="prediction-option-points">+{choicePoints}</span>
                            </button>
                          )
                        })}
                      </div>
                    </section>
                  )
                }

                return (
                  <li key={match.matchId} className="prediction-match-compact">
                    {renderUpcomingMatchHeader(match)}

                    {outcomeTemplate ? renderTemplateOptions(outcomeTemplate) : null}

                    {otherTemplates.length > 0 ? (
                      <button
                        type="button"
                        className="prediction-expand-toggle"
                        onClick={() => toggleMatchExpanded(match.matchId)}
                      >
                        {isExpanded ? 'Скрыть события' : 'Больше событий'}
                      </button>
                    ) : null}

                    {isExpanded && otherTemplates.length > 0 ? (
                      <div className="prediction-additional-markets">
                        {otherTemplates.map(renderTemplateOptions)}
                      </div>
                    ) : null}

                    {hasAnySelection || anyError || anySuccess ? (
                      <div className="prediction-match-footer">
                        {anyError ? (
                          <span className="prediction-feedback error">{anyError}</span>
                        ) : anySuccess ? (
                          <span className="prediction-feedback success">{anySuccess}</span>
                        ) : null}

                        {!anySuccess && (
                          <div className="prediction-footer-buttons">
                            <button
                              type="button"
                              className="prediction-submit-main"
                              onClick={async () => {
                                for (const template of match.templates) {
                                  if (selectedOptions[template.id]) {
                                    await handleSubmit(template)
                                  }
                                }
                              }}
                              disabled={!hasAnySelection || anySubmitting}
                            >
                              {anySubmitting ? 'Отправляем...' : 'Отправить прогноз'}
                            </button>

                            {/* Кнопка добавления в экспресс */}
                            {isAuthorized !== false && (() => {
                              // Найти выбранный шаблон и его выбор
                              const selectedTemplate = match.templates.find(t => selectedOptions[t.id])
                              if (!selectedTemplate) return null

                              const selection = selectedOptions[selectedTemplate.id]
                              const meta = resolveTemplateMeta(selectedTemplate)
                              const choices = normalizeTemplateChoices(selectedTemplate)
                              const choiceObj = choices.find(c => c.value === selection)
                              const selectionLabel = choiceObj?.label ?? selection

                              // Проверить, есть ли уже этот матч в корзине
                              const matchInCart = expressCart.hasMatch(match.matchId)
                              const canAdd = expressCart.canAddMore() && !matchInCart

                              return (
                                <button
                                  type="button"
                                  className={`prediction-express-btn ${matchInCart ? 'in-cart' : ''}`}
                                  onClick={() => {
                                    if (matchInCart) {
                                      // Открыть модалку для просмотра
                                      expressCart.setModalOpen(true)
                                    } else {
                                      const cartItem = createCartItem(
                                        selectedTemplate,
                                        match,
                                        selection,
                                        selectionLabel,
                                        meta.title
                                      )
                                      expressCart.addItem(cartItem)
                                    }
                                  }}
                                  disabled={!canAdd && !matchInCart}
                                  title={matchInCart ? 'Этот матч уже в экспрессе' : canAdd ? 'Добавить в экспресс' : 'Достигнут лимит событий'}
                                >
                                  {matchInCart ? '✓ В экспрессе' : '+ В экспресс'}
                                </button>
                              )
                            })()}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    )
  }

  const myContent = () => {
    if (isAuthorized === false) {
      return <p className="prediction-note">Войдите в профиль, чтобы просматривать свои прогнозы.</p>
    }

    if (loadingMine) {
      return <p className="prediction-note">Загружаем историю прогнозов...</p>
    }

    if (errorMine) {
      return <p className="prediction-error">{errorMine}</p>
    }

    return (
      <div className="my-predictions-container">
        {/* Список экспрессов */}
        <ExpressList />

        {/* Список обычных прогнозов */}
        {mine.length > 0 ? (
          <>
            <h3 className="my-predictions-section-title">Одиночные прогнозы</h3>
            <ul className="prediction-entry-list">
              {mine.map(p => <UserPredictionCard key={p.id} prediction={p} />)}
            </ul>
          </>
        ) : (
          <p className="prediction-note">Вы ещё не делали одиночных прогнозов. Попробуйте выбрать исходы в ближайших матчах.</p>
        )}
      </div>
    )
  }

  return (
    <div className="predictions-page">
      <header className="predictions-header">
        <div className="predictions-header-content">
          <div>
            <h1 className="predictions-title">Прогнозы</h1>
            <p className="predictions-subtitle">
              Выбирайте исходы матчей и зарабатывайте очки в рейтинге. Лимит: 10 прогнозов в неделю.
            </p>
          </div>
        </div>
        <div className="predictions-tabs" role="tablist" aria-label="Прогнозы">
          <button
            type="button"
            role="tab"
            className={tab === 'upcoming' ? 'active' : ''}
            aria-selected={tab === 'upcoming'}
            onClick={() => setTab('upcoming')}
          >
            Ближайшие
          </button>
          <button
            type="button"
            role="tab"
            className={tab === 'mine' ? 'active' : ''}
            aria-selected={tab === 'mine'}
            onClick={() => setTab('mine')}
          >
            Мои прогнозы
          </button>
        </div>
      </header>

      <div className="predictions-tab-panel" role="tabpanel">
        {tab === 'upcoming' ? upcomingContent() : myContent()}
      </div>

      {/* Плавающая кнопка корзины экспресса */}
      <ExpressCartButton />

      {/* Модалка корзины экспресса */}
      <ExpressCartModal onExpressCreated={refreshMyPredictions} />
    </div>
  )
}

/**
 * Обёртка страницы прогнозов с провайдером корзины экспресса
 */
const PredictionsPage: React.FC = () => (
  <ExpressCartProvider>
    <PredictionsPageInner />
  </ExpressCartProvider>
)

export default PredictionsPage
