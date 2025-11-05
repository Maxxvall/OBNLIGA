import React, { useCallback, useEffect, useState } from 'react'
import type {
  ActivePredictionMatch,
  PredictionChoiceOption,
  PredictionMarketType,
  PredictionTemplateView,
  UserPredictionEntry,
} from '@shared/types'
import { fetchActivePredictions, fetchMyPredictions, submitPrediction } from '../api/predictionsApi'
import '../styles/predictions.css'

const DATE_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

type PredictionsTab = 'upcoming' | 'mine'

const MARKET_LABELS: Record<PredictionMarketType, string> = {
  MATCH_OUTCOME: 'Исход матча',
  TOTAL_GOALS: 'Тотал голов',
  CUSTOM_BOOLEAN: 'Спецмаркет',
}

const MATCH_STATUS_LABELS: Record<ActivePredictionMatch['status'], string> = {
  SCHEDULED: 'Матч не начался',
  LIVE: 'Матч идёт',
  POSTPONED: 'Перенесён',
  FINISHED: 'Завершён',
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

const formatDateTime = (iso: string): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }
  return DATE_FORMATTER.format(date)
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
    if (upper === 'DRAW' || upper === 'X') return 'X'
    if (upper === 'TWO' || upper === '2') return 'П2'
  }

  if (marketType === 'TOTAL_GOALS') {
    const overMatch = upper.match(/^OVER[_\s]?([0-9]+(?:\.[0-9]+)?)$/)
    if (overMatch) {
      return 'Да'
    }
    const underMatch = upper.match(/^UNDER[_\s]?([0-9]+(?:\.[0-9]+)?)$/)
    if (underMatch) {
      return 'Нет'
    }
    if (upper === 'OVER') return 'Да'
    if (upper === 'UNDER') return 'Нет'
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
    { value: 'DRAW', label: 'X' },
    { value: 'TWO', label: 'П2' },
  ],
}

const normalizeTemplateChoices = (template: PredictionTemplateView): PredictionChoiceOption[] => {
  const seen = new Map<string, PredictionChoiceOption>()

  const pushChoice = (value: string, label?: string, description?: string | null) => {
    const trimmedValue = value.trim()
    if (!trimmedValue) {
      return
    }
    if (seen.has(trimmedValue)) {
      return
    }
    const resolvedLabel = label && label.trim().length > 0 ? label.trim() : translateChoiceLabel(template.marketType, trimmedValue)
    seen.set(trimmedValue, {
      value: trimmedValue,
      label: resolvedLabel,
      description: description ?? null,
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
      const record = candidate as { value?: unknown; label?: unknown; description?: unknown }
      if (typeof record.value === 'string') {
        const label = typeof record.label === 'string' ? record.label : undefined
        const description = typeof record.description === 'string' ? record.description : null
        pushChoice(record.value, label, description)
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

const renderClubCompact = (
  club: ActivePredictionMatch['homeClub'] | UserPredictionEntry['homeClub']
) => (
  <div className="prediction-club-compact">
    <span className="prediction-club-name">{club.name}</span>
  </div>
)

const renderUpcomingMatchHeader = (match: ActivePredictionMatch) => (
  <header className="prediction-card-header-compact">
    <div className="prediction-card-meta-compact">
      <span className="prediction-card-date">{formatDateTime(match.matchDateTime)}</span>
      <span className={`prediction-status status-${match.status.toLowerCase()}`}>
        {MATCH_STATUS_LABELS[match.status] ?? match.status}
      </span>
    </div>
    <div className="prediction-card-teams-compact">
      {renderClubCompact(match.homeClub)}
      <span className="prediction-vs-compact">VS</span>
      {renderClubCompact(match.awayClub)}
    </div>
  </header>
)

const formatEntrySelection = (entry: UserPredictionEntry): string => {
  if (entry.marketType === 'LEGACY_1X2') {
    const upper = entry.selection.toUpperCase()
    if (upper === 'ONE' || upper === '1') return 'П1'
    if (upper === 'DRAW' || upper === 'X') return 'X'
    if (upper === 'TWO' || upper === '2') return 'П2'
    return translateChoiceLabel('MATCH_OUTCOME', entry.selection)
  }
  if (entry.marketType === 'LEGACY_TOTAL') {
    const over = entry.selection.match(/^OVER[_\s]?(.+)$/)
    if (over) {
      const total = parseFloat(over[1])
      const rounded = Math.round(total * 2) / 2
      return `Да (${rounded.toFixed(1)})`
    }
    const under = entry.selection.match(/^UNDER[_\s]?(.+)$/)
    if (under) {
      const total = parseFloat(under[1])
      const rounded = Math.round(total * 2) / 2
      return `Нет (${rounded.toFixed(1)})`
    }
    return entry.selection
  }
  if (entry.marketType === 'LEGACY_EVENT') {
    if (entry.selection.startsWith('PENALTY_')) {
      return entry.selection === 'PENALTY_YES' ? 'Да' : 'Нет'
    }
    if (entry.selection.startsWith('RED_CARD_')) {
      return entry.selection === 'RED_CARD_YES' ? 'Да' : 'Нет'
    }
    return entry.selection
  }
  if (
    entry.marketType === 'MATCH_OUTCOME'
    || entry.marketType === 'TOTAL_GOALS'
    || entry.marketType === 'CUSTOM_BOOLEAN'
  ) {
    return translateChoiceLabel(entry.marketType, entry.selection)
  }
  return entry.selection
}

const formatEntryMarketLabel = (entry: UserPredictionEntry): string => {
  if (entry.marketType === 'LEGACY_EVENT') {
    if (entry.selection.startsWith('PENALTY_')) {
      return 'Пенальти'
    }
    if (entry.selection.startsWith('RED_CARD_')) {
      return 'Удаление'
    }
  }
  
  switch (entry.marketType) {
  case 'MATCH_OUTCOME':
    return 'Исход матча'
  case 'TOTAL_GOALS':
    return 'Тотал голов'
  case 'CUSTOM_BOOLEAN':
    return 'Спец событие'
  case 'LEGACY_1X2':
    return 'Исход матча'
  case 'LEGACY_TOTAL':
    return 'Тотал голов'
  case 'LEGACY_EVENT':
    return 'Спец событие'
  default:
    return entry.marketType
  }
}

const renderUserPrediction = (prediction: UserPredictionEntry) => (
  <li key={prediction.id} className={`prediction-entry prediction-entry-${prediction.status.toLowerCase()}`}>
    <div className="prediction-entry-header">
      <div className="prediction-entry-meta">
        <span>{formatDateTime(prediction.matchDateTime)}</span>
        <span className={`prediction-status status-${prediction.status.toLowerCase()}`}>
          {STATUS_LABELS[prediction.status] ?? prediction.status}
        </span>
      </div>
      <div className="prediction-entry-teams-compact">
        {renderClubCompact(prediction.homeClub)}
        <span className="prediction-vs-compact">VS</span>
        {renderClubCompact(prediction.awayClub)}
      </div>
    </div>
    <div className="prediction-entry-body">
      <div>
        <span className="prediction-market-label">{formatEntryMarketLabel(prediction)}</span>
        <strong>{formatEntrySelection(prediction)}</strong>
      </div>
      {typeof prediction.scoreAwarded === 'number' ? (
        <div>
          <span className="prediction-market-label">Очки</span>
          <span>{prediction.scoreAwarded}</span>
        </div>
      ) : null}
    </div>
  </li>
)
const PredictionsPage: React.FC = () => {
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
    setSelectedOptions(prev => ({ ...prev, [templateId]: value }))
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

    return (
      <ul className="prediction-match-list">
        {upcoming.map(match => {
          if (!match.templates.length) {
            return (
              <li key={match.matchId} className="prediction-match">
                {renderUpcomingMatchHeader(match)}
                <p className="prediction-note compact">Настройки прогнозов появятся позже.</p>
              </li>
            )
          }

          const isExpanded = expandedMatches[match.matchId] === true
          
          const outcomeTemplate = match.templates.find(t => t.marketType === 'MATCH_OUTCOME')
          const otherTemplates = match.templates.filter(t => t.marketType !== 'MATCH_OUTCOME')
          
          const hasAnySelection = match.templates.some(t => selectedOptions[t.id])
          const anySubmitting = match.templates.some(t => submitting[t.id])
          const anyError = match.templates.map(t => submitErrors[t.id]).find(e => e)
          const anySuccess = match.templates.map(t => submitSuccess[t.id]).find(e => e)

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
                  <span className="prediction-points-hint">+{expectedPoints} очков</span>
                </div>
                <div className="prediction-options">
                  {choices.map(choice => (
                    <button
                      type="button"
                      key={choice.value}
                      className={`prediction-option${selected === choice.value ? ' selected' : ''}`}
                      onClick={() => handleOptionSelect(template.id, choice.value)}
                      disabled={anySubmitting}
                    >
                      <span className="prediction-option-label">{choice.label}</span>
                    </button>
                  ))}
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
                    {anySubmitting ? 'Отправляем...' : anySuccess ? 'Обновить прогноз' : 'Отправить прогноз'}
                  </button>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
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

    if (!mine.length) {
      return <p className="prediction-note">Вы ещё не делали прогнозы. Попробуйте выбрать исходы в ближайших матчах.</p>
    }

    return <ul className="prediction-entry-list">{mine.map(renderUserPrediction)}</ul>
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
    </div>
  )
}

export default PredictionsPage
