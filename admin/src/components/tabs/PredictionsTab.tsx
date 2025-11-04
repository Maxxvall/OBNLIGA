import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react'
import { useAdminStore } from '../../store/adminStore'
import type {
  AdminPredictionMatch,
  AdminPredictionTemplate,
  PredictionTemplateEnsureSummaryView,
  TotalGoalsSuggestionView,
} from '../../types'
import { formatDateTime } from '../../utils/date'

type ManualFormState = {
  line: string
  basePoints: string
  difficultyMultiplier: string
  sourceUpdatedAt?: string
}

type FeedbackState = {
  kind: 'success' | 'error'
  message: string
  meta?: string
} | null

type PendingAction = {
  matchId: string | null
  action: 'auto' | 'manual' | null
}

const statusLabels: Record<AdminPredictionMatch['status'], string> = {
  SCHEDULED: 'Запланирован',
  LIVE: 'Идёт',
  POSTPONED: 'Перенесён',
  FINISHED: 'Завершён',
}

const formatClubName = (club: AdminPredictionMatch['homeClub']): string => {
  return club.shortName?.trim() || club.name
}

const formatNumber = (value?: number | null, fractionDigits = 2): string => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—'
  }
  if (Math.abs(Math.round(value) - value) < 0.001) {
    return String(Math.round(value))
  }
  return value.toFixed(fractionDigits).replace(/\.0+$/, '')
}

const parseNumericField = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const normalized = Number(value.replace(',', '.'))
    if (Number.isFinite(normalized)) {
      return normalized
    }
  }
  return undefined
}

type TotalGoalsOptionsView = {
  line?: number
  formattedLine?: string
  manual?: boolean
  sampleSize?: number
  averageGoals?: number
  standardDeviation?: number
  confidence?: number
  fallback?: boolean
  generatedAt?: string
}

const parseTotalGoalsOptions = (template?: AdminPredictionTemplate): TotalGoalsOptionsView => {
  if (!template) {
    return {}
  }
  const source = template.options
  if (!source || typeof source !== 'object') {
    return {}
  }
  const raw = source as Record<string, unknown>
  return {
    line: parseNumericField(raw.line),
    formattedLine: typeof raw.formattedLine === 'string' ? raw.formattedLine : undefined,
    manual: raw.manual === true,
    sampleSize: parseNumericField(raw.sampleSize),
    averageGoals: parseNumericField(raw.averageGoals),
    standardDeviation: parseNumericField(raw.standardDeviation),
    confidence: parseNumericField(raw.confidence),
    fallback: raw.fallback === true,
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : undefined,
  }
}

const totalTemplateOf = (match: AdminPredictionMatch): AdminPredictionTemplate | undefined => {
  return match.templates.find(template => template.marketType === 'TOTAL_GOALS')
}

const outcomeTemplateOf = (match: AdminPredictionMatch): AdminPredictionTemplate | undefined => {
  return match.templates.find(template => template.marketType === 'MATCH_OUTCOME')
}

const buildSummaryMeta = (summary?: PredictionTemplateEnsureSummaryView): string | undefined => {
  if (!summary) {
    return undefined
  }
  const parts: string[] = []
  if (summary.totalSuggestion?.line !== undefined) {
    parts.push(`линия ${formatNumber(summary.totalSuggestion.line)}`)
  }
  if (summary.createdMarkets.length) {
    parts.push(`создано: ${summary.createdMarkets.length}`)
  }
  if (summary.updatedMarkets.length) {
    parts.push(`обновлено: ${summary.updatedMarkets.length}`)
  }
  if (summary.skippedManualMarkets.length) {
    parts.push(`пропущено ручных: ${summary.skippedManualMarkets.length}`)
  }
  return parts.length ? parts.join(' • ') : undefined
}

const buildManualFormState = (match: AdminPredictionMatch): ManualFormState => {
  const totalTemplate = totalTemplateOf(match)
  const options = parseTotalGoalsOptions(totalTemplate)
  const fallbackLine = options.line ?? match.suggestion?.line
  const lineString =
    fallbackLine === undefined || fallbackLine === null ? '' : formatNumber(fallbackLine)
  const difficultySource = totalTemplate?.difficultyMultiplier
  const difficultyString =
    difficultySource === undefined || difficultySource === null
      ? ''
      : formatNumber(difficultySource, 2)
  return {
    line: lineString,
    basePoints: totalTemplate ? String(totalTemplate.basePoints) : '',
    difficultyMultiplier: difficultyString,
    sourceUpdatedAt: totalTemplate?.updatedAt,
  }
}

const confidenceToPercent = (value?: number): string | null => {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return null
  }
  const normalized = value > 1 ? value : value * 100
  const percent = Math.round(normalized)
  return `${percent}%`
}

export const PredictionsTab = () => {
  const {
    token,
    predictionMatches,
    seasons,
    selectedSeasonId,
    loadingPredictionMatches,
    loadingPredictionTemplate,
    fetchPredictionMatches,
    fetchSeasons,
    setPredictionTemplateAuto,
    setPredictionTemplateManual,
  } = useAdminStore(state => ({
    token: state.token,
    predictionMatches: state.data.predictionMatches,
    seasons: state.data.seasons,
    selectedSeasonId: state.selectedSeasonId,
    loadingPredictionMatches: Boolean(state.loading.predictionMatches),
    loadingPredictionTemplate: Boolean(state.loading.predictionTemplate),
    fetchPredictionMatches: state.fetchPredictionMatches,
    fetchSeasons: state.fetchSeasons,
    setPredictionTemplateAuto: state.setPredictionTemplateAuto,
    setPredictionTemplateManual: state.setPredictionTemplateManual,
  }))

  const [seasonFilter, setSeasonFilter] = useState<number | null>(selectedSeasonId ?? null)
  const [seasonInitialized, setSeasonInitialized] = useState<boolean>(
    () => selectedSeasonId !== undefined && selectedSeasonId !== null
  )
  const [manualForms, setManualForms] = useState<Record<string, ManualFormState>>({})
  const [feedback, setFeedback] = useState<Record<string, FeedbackState>>({})
  const [pendingAction, setPendingAction] = useState<PendingAction>({ matchId: null, action: null })

  const matches = useMemo(() => {
    return [...predictionMatches].sort((left, right) => {
      return left.matchDateTime.localeCompare(right.matchDateTime)
    })
  }, [predictionMatches])

  const activeSeasonId = useMemo(() => {
    const active = seasons.find(season => season.isActive)
    return active?.id ?? null
  }, [seasons])

  useEffect(() => {
    if (seasonInitialized) {
      return
    }
    const candidate = selectedSeasonId ?? activeSeasonId
    if (candidate !== null && candidate !== undefined) {
      setSeasonFilter(candidate)
      setSeasonInitialized(true)
    }
  }, [seasonInitialized, selectedSeasonId, activeSeasonId])

  useEffect(() => {
    if (!token) {
      return
    }
    if (!seasons.length) {
      void fetchSeasons().catch(() => undefined)
    }
  }, [token, seasons.length, fetchSeasons])

  useEffect(() => {
    if (!token) {
      return
    }
    if (!matches.length) {
      void fetchPredictionMatches({ seasonId: seasonFilter ?? undefined, force: true }).catch(
        () => undefined
      )
    }
  }, [token, matches.length, seasonFilter, fetchPredictionMatches])

  useEffect(() => {
    setManualForms(prev => {
      const next: Record<string, ManualFormState> = {}
      for (const match of matches) {
        const totalTemplate = totalTemplateOf(match)
        const previous = prev[match.matchId]
        if (previous && previous.sourceUpdatedAt === totalTemplate?.updatedAt) {
          next[match.matchId] = previous
        } else {
          next[match.matchId] = buildManualFormState(match)
        }
      }
      return next
    })
  }, [matches])

  const setFeedbackForMatch = (matchId: string, state: FeedbackState) => {
    setFeedback(prev => ({ ...prev, [matchId]: state }))
  }

  const handleRefresh = () => {
    void fetchPredictionMatches({ seasonId: seasonFilter ?? undefined, force: true }).catch(
      () => undefined
    )
  }

  const handleSeasonChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value
    if (value === 'all') {
      setSeasonFilter(null)
      setSeasonInitialized(true)
      void fetchPredictionMatches({ seasonId: undefined, force: true }).catch(() => undefined)
      return
    }
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      setSeasonFilter(parsed)
      setSeasonInitialized(true)
      void fetchPredictionMatches({ seasonId: parsed, force: true }).catch(() => undefined)
    }
  }

  const handleAuto = async (match: AdminPredictionMatch) => {
    const isLocked = match.status !== 'SCHEDULED'
    if (isLocked) {
      setFeedbackForMatch(match.matchId, {
        kind: 'error',
        message: 'Матч уже не в статусе SCHEDULED — автоматический режим недоступен.',
      })
      return
    }
    setPendingAction({ matchId: match.matchId, action: 'auto' })
    try {
      const result = await setPredictionTemplateAuto(match.matchId)
      const meta = buildSummaryMeta(result.summary)
      setFeedbackForMatch(match.matchId, {
        kind: 'success',
        message: 'Возвращено к автоматическому расчёту.',
        meta,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось переключить режим.'
      setFeedbackForMatch(match.matchId, { kind: 'error', message })
    } finally {
      setPendingAction({ matchId: null, action: null })
    }
  }

  const handleManualSubmit = async (
    event: FormEvent<HTMLFormElement>,
    match: AdminPredictionMatch,
    formState: ManualFormState
  ) => {
    event.preventDefault()
    const isLocked = match.status !== 'SCHEDULED'
    if (isLocked) {
      setFeedbackForMatch(match.matchId, {
        kind: 'error',
        message: 'Матч закрыт для изменений — статус не SCHEDULED.',
      })
      return
    }

    const normalizedLine = Number(formState.line.replace(',', '.'))
    if (!Number.isFinite(normalizedLine)) {
      setFeedbackForMatch(match.matchId, {
        kind: 'error',
        message: 'Введите корректную линию тотала.',
      })
      return
    }

    const basePointsValue = formState.basePoints.trim()
      ? Number(formState.basePoints.replace(',', '.'))
      : undefined
    if (basePointsValue !== undefined && (!Number.isFinite(basePointsValue) || basePointsValue < 0)) {
      setFeedbackForMatch(match.matchId, {
        kind: 'error',
        message: 'Очки должны быть неотрицательным числом.',
      })
      return
    }

    const difficultyValue = formState.difficultyMultiplier.trim()
      ? Number(formState.difficultyMultiplier.replace(',', '.'))
      : undefined
    if (difficultyValue !== undefined && (!Number.isFinite(difficultyValue) || difficultyValue <= 0)) {
      setFeedbackForMatch(match.matchId, {
        kind: 'error',
        message: 'Множитель сложности должен быть больше нуля.',
      })
      return
    }

    setPendingAction({ matchId: match.matchId, action: 'manual' })
    try {
      const payload: {
        line: number
        basePoints?: number
        difficultyMultiplier?: number
      } = {
        line: normalizedLine,
      }
      if (basePointsValue !== undefined) {
        payload.basePoints = Math.trunc(basePointsValue)
      }
      if (difficultyValue !== undefined) {
        payload.difficultyMultiplier = Number(difficultyValue.toFixed(2))
      }
      const result = await setPredictionTemplateManual(match.matchId, payload)
      const meta = result.suggestion
        ? `подсказка: линия ${formatNumber(result.suggestion.line)}`
        : undefined
      setFeedbackForMatch(match.matchId, {
        kind: 'success',
        message: 'Ручной режим сохранён.',
        meta,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось сохранить ручной режим.'
      setFeedbackForMatch(match.matchId, { kind: 'error', message })
    } finally {
      setPendingAction({ matchId: null, action: null })
    }
  }

  const handleManualFieldChange = (
    matchId: string,
    field: keyof ManualFormState,
    value: string
  ) => {
    setManualForms(prev => {
      const current = prev[matchId]
      const safeCurrent: ManualFormState = current
        ? current
        : { line: '', basePoints: '', difficultyMultiplier: '' }
      return {
        ...prev,
        [matchId]: {
          ...safeCurrent,
          [field]: value,
        },
      }
    })
  }

  const renderSuggestion = (suggestion: TotalGoalsSuggestionView | null | undefined) => {
    if (!suggestion) {
      return <p className="prediction-suggestion-empty">Нет актуальной подсказки — используем fallback.</p>
    }

    const confidence = confidenceToPercent(suggestion.confidence)
    const generatedLabel = suggestion.generatedAt
      ? formatDateTime(suggestion.generatedAt, {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })
      : null

    return (
      <ul className="prediction-suggestion-list">
        <li>
          <span>Рекомендованная линия</span>
          <strong>{formatNumber(suggestion.line)}</strong>
        </li>
        <li>
          <span>Средний тотал</span>
          <strong>{formatNumber(suggestion.averageGoals)}</strong>
        </li>
        <li>
          <span>Дисперсия</span>
          <strong>{formatNumber(suggestion.standardDeviation)}</strong>
        </li>
        <li>
          <span>Выборка</span>
          <strong>{suggestion.sampleSize}</strong>
        </li>
        {confidence ? (
          <li>
            <span>Уверенность</span>
            <strong>{confidence}</strong>
          </li>
        ) : null}
        {generatedLabel ? (
          <li>
            <span>Дата расчёта</span>
            <strong>{generatedLabel}</strong>
          </li>
        ) : null}
        {suggestion.fallback ? (
          <li className="prediction-tag warning">Используется fallback-порог</li>
        ) : null}
      </ul>
    )
  }

  return (
    <div className="tab-sections">
      <header className="tab-header">
        <div>
          <h3>Настройка прогнозов</h3>
          <p>
            Контролируйте линии тоталов и вручную регулируйте сложность до публикации матча.
          </p>
        </div>
        <div className="tab-header-actions predictions-actions">
          <select
            className="tab-select"
            value={seasonFilter === null ? 'all' : String(seasonFilter)}
            onChange={handleSeasonChange}
            aria-label="Сезон"
          >
            <option value="all">Все сезоны</option>
            {seasons.map(season => (
              <option key={season.id} value={season.id}>
                {season.name}
              </option>
            ))}
          </select>
          <button
            className="button-ghost"
            type="button"
            onClick={handleRefresh}
            disabled={loadingPredictionMatches}
          >
            {loadingPredictionMatches ? 'Обновляем…' : 'Обновить'}
          </button>
        </div>
      </header>

      {matches.length === 0 ? (
        <section className="card prediction-card">
          <p>В выбранном диапазоне нет предстоящих матчей со ставками прогнозов.</p>
        </section>
      ) : null}

      {matches.map(match => {
        const totalTemplate = totalTemplateOf(match)
        const outcomeTemplate = outcomeTemplateOf(match)
        const totalOptions = parseTotalGoalsOptions(totalTemplate)
        const formState = manualForms[match.matchId] ?? buildManualFormState(match)
        const feedbackState = feedback[match.matchId]
        const isLocked = match.status !== 'SCHEDULED'
        const isManual = totalTemplate?.isManual ?? false
        const currentLine = totalOptions.formattedLine ?? formatNumber(totalOptions.line)
        const totalUpdatedLabel = totalTemplate?.updatedAt
          ? formatDateTime(totalTemplate.updatedAt, {
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })
          : null
        const pendingForMatch =
          pendingAction.matchId === match.matchId ? pendingAction.action : null
        const isAutoPending = pendingForMatch === 'auto' && loadingPredictionTemplate
        const isManualPending = pendingForMatch === 'manual' && loadingPredictionTemplate

        return (
          <section key={match.matchId} className="card prediction-card">
            <header className="prediction-card-header">
              <div className="prediction-card-info">
                <span className="prediction-datetime">
                  {formatDateTime(match.matchDateTime, {
                    day: '2-digit',
                    month: 'long',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                <span className="prediction-teams">
                  <strong>{formatClubName(match.homeClub)}</strong>
                  <span className="prediction-vs">—</span>
                  <strong>{formatClubName(match.awayClub)}</strong>
                </span>
              </div>
              <div className="prediction-meta">
                <span className={`status-badge status-${match.status.toLowerCase()}`}>
                  {statusLabels[match.status] ?? match.status}
                </span>
                <span className={`prediction-mode ${isManual ? 'manual' : 'auto'}`}>
                  {isManual ? 'Ручной режим' : 'Авто расчёт'}
                </span>
              </div>
            </header>

            {feedbackState ? (
              <div className={`inline-feedback ${feedbackState.kind}`}>
                <div>
                  <strong>{feedbackState.message}</strong>
                  {feedbackState.meta ? (
                    <span className="feedback-meta">{feedbackState.meta}</span>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="feedback-close"
                  onClick={() => setFeedbackForMatch(match.matchId, null)}
                  aria-label="Скрыть уведомление"
                >
                  ×
                </button>
              </div>
            ) : null}

            <div className="prediction-market">
              <h4>1X2 рынок</h4>
              {outcomeTemplate ? (
                <ul className="prediction-stats">
                  <li>
                    <span>Базовые очки</span>
                    <strong>{outcomeTemplate.basePoints}</strong>
                  </li>
                  <li>
                    <span>Множитель</span>
                    <strong>{formatNumber(outcomeTemplate.difficultyMultiplier, 2)}</strong>
                  </li>
                  <li>
                    <span>Последнее обновление</span>
                    <strong>
                      {formatDateTime(outcomeTemplate.updatedAt, {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </strong>
                  </li>
                </ul>
              ) : (
                <p>Шаблон 1X2 отсутствует — проверьте генерацию шаблонов.</p>
              )}
            </div>

            <div className="prediction-market">
              <h4>Тотал голов</h4>
              <ul className="prediction-stats">
                <li>
                  <span>Текущая линия</span>
                  <strong>{currentLine}</strong>
                </li>
                <li>
                  <span>Очки</span>
                  <strong>{totalTemplate ? totalTemplate.basePoints : '—'}</strong>
                </li>
                <li>
                  <span>Множитель</span>
                  <strong>{totalTemplate ? formatNumber(totalTemplate.difficultyMultiplier, 2) : '—'}</strong>
                </li>
                <li>
                  <span>Обновлено</span>
                  <strong>{totalUpdatedLabel ?? '—'}</strong>
                </li>
              </ul>

              <div className="prediction-actions">
                <button
                  type="button"
                  className="button-secondary compact"
                  onClick={() => handleAuto(match)}
                  disabled={isLocked || loadingPredictionTemplate || isManualPending || isAutoPending}
                >
                  {isAutoPending ? 'Применяем…' : 'Автоматический расчёт'}
                </button>
              </div>

              <form
                className="prediction-form"
                onSubmit={event => handleManualSubmit(event, match, formState)}
              >
                <div className="prediction-form-grid">
                  <label>
                    Линия тотала
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formState.line}
                      onChange={event =>
                        handleManualFieldChange(match.matchId, 'line', event.target.value)
                      }
                      disabled={isLocked || loadingPredictionTemplate}
                      required
                    />
                  </label>
                  <label>
                    Очки (опция)
                    <input
                      type="number"
                      inputMode="numeric"
                      value={formState.basePoints}
                      onChange={event =>
                        handleManualFieldChange(match.matchId, 'basePoints', event.target.value)
                      }
                      disabled={isLocked || loadingPredictionTemplate}
                      min={0}
                    />
                  </label>
                  <label>
                    Множитель (опция)
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formState.difficultyMultiplier}
                      onChange={event =>
                        handleManualFieldChange(
                          match.matchId,
                          'difficultyMultiplier',
                          event.target.value
                        )
                      }
                      disabled={isLocked || loadingPredictionTemplate}
                    />
                  </label>
                </div>
                <div className="form-actions prediction-form-actions">
                  <button
                    className="button-primary compact"
                    type="submit"
                    disabled={isLocked || loadingPredictionTemplate || isAutoPending || isManualPending}
                  >
                    {isManualPending ? 'Сохраняем…' : 'Сохранить ручной режим'}
                  </button>
                </div>
              </form>
            </div>

            <div className="prediction-suggestion">
              <h5>Подсказка калькулятора</h5>
              {renderSuggestion(match.suggestion)}
            </div>
          </section>
        )
      })}
    </div>
  )
}
