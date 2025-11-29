/**
 * Компонент для создания экспресс-прогнозов
 *
 * Позволяет выбрать несколько событий из разных матчей и объединить их в экспресс.
 * Показывает расчёт очков и множитель.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ActivePredictionMatch,
  ExpressConfig,
  ExpressWeekCount,
  PredictionChoiceOption,
  PredictionMarketType,
  PredictionTemplateView,
} from '@shared/types'
import {
  createExpress,
  fetchExpressConfig,
  fetchWeekCount,
  formatMultiplier,
  getMultiplierForItemCount,
  translateExpressError,
} from '../api/expressApi'
import './ExpressBuilder.css'

// =================== ТИПЫ ===================

type ExpressItem = {
  templateId: string
  matchId: string
  selection: string
  selectionLabel: string
  marketLabel: string
  basePoints: number
  homeClub: {
    name: string
    shortName: string | null
    logoUrl: string | null
  }
  awayClub: {
    name: string
    shortName: string | null
    logoUrl: string | null
  }
  matchDateTime: string
}

type ExpressBuilderProps = {
  matches: ActivePredictionMatch[]
  onExpressCreated?: () => void
  isAuthorized?: boolean
}

// =================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===================

const MARKET_LABELS: Record<PredictionMarketType, string> = {
  MATCH_OUTCOME: 'Исход',
  TOTAL_GOALS: 'Тотал',
  CUSTOM_BOOLEAN: 'Спец',
}

const translateChoiceLabel = (marketType: PredictionMarketType, value: string): string => {
  const upper = value.toUpperCase().trim()

  if (marketType === 'MATCH_OUTCOME') {
    if (upper === 'ONE' || upper === '1') return 'П1'
    if (upper === 'DRAW' || upper === 'X') return 'Х'
    if (upper === 'TWO' || upper === '2') return 'П2'
  }

  if (marketType === 'TOTAL_GOALS') {
    if (upper.startsWith('OVER')) return 'ТБ'
    if (upper.startsWith('UNDER')) return 'ТМ'
  }

  if (marketType === 'CUSTOM_BOOLEAN') {
    if (upper === 'YES' || upper === 'TRUE') return 'Да'
    if (upper === 'NO' || upper === 'FALSE') return 'Нет'
  }

  return value
}

const getClubShortName = (club: { name: string; shortName: string | null }): string => {
  if (club.shortName) return club.shortName
  const words = club.name.trim().split(/\s+/)
  if (words.length === 1) {
    return words[0].slice(0, 3).toUpperCase()
  }
  return words.map(w => w[0]).join('').slice(0, 3).toUpperCase()
}

const normalizeTemplateChoices = (template: PredictionTemplateView): PredictionChoiceOption[] => {
  const { options } = template
  const choices: PredictionChoiceOption[] = []

  if (Array.isArray(options)) {
    options.forEach(opt => {
      if (typeof opt === 'string') {
        choices.push({
          value: opt,
          label: translateChoiceLabel(template.marketType, opt),
          description: null,
          points: null,
        })
      } else if (opt && typeof opt === 'object' && 'value' in opt) {
        const o = opt as Record<string, unknown>
        choices.push({
          value: String(o.value),
          label: typeof o.label === 'string' ? o.label : translateChoiceLabel(template.marketType, String(o.value)),
          description: typeof o.description === 'string' ? o.description : null,
          points: typeof o.points === 'number' ? o.points : null,
        })
      }
    })
  } else if (options && typeof options === 'object') {
    const record = options as Record<string, unknown>
    const arr = record.choices || record.options || record.values
    if (Array.isArray(arr)) {
      arr.forEach(opt => {
        if (typeof opt === 'string') {
          choices.push({
            value: opt,
            label: translateChoiceLabel(template.marketType, opt),
            description: null,
            points: null,
          })
        } else if (opt && typeof opt === 'object' && 'value' in opt) {
          const o = opt as Record<string, unknown>
          choices.push({
            value: String(o.value),
            label: typeof o.label === 'string' ? o.label : translateChoiceLabel(template.marketType, String(o.value)),
            description: typeof o.description === 'string' ? o.description : null,
            points: typeof o.points === 'number' ? o.points : null,
          })
        }
      })
    }
  }

  // Fallback для MATCH_OUTCOME
  if (choices.length === 0 && template.marketType === 'MATCH_OUTCOME') {
    choices.push(
      { value: 'ONE', label: 'П1', description: null, points: null },
      { value: 'DRAW', label: 'Х', description: null, points: null },
      { value: 'TWO', label: 'П2', description: null, points: null }
    )
  }

  return choices
}

const formatTime = (iso: string): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${day}.${month} ${hours}:${minutes}`
}

// =================== КОМПОНЕНТ ===================

const ExpressBuilder: React.FC<ExpressBuilderProps> = ({
  matches,
  onExpressCreated,
  isAuthorized = true,
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [items, setItems] = useState<ExpressItem[]>([])
  const [config, setConfig] = useState<ExpressConfig | null>(null)
  const [weekCount, setWeekCount] = useState<ExpressWeekCount | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [success, setSuccess] = useState<string | undefined>()
  const [selectedMatch, setSelectedMatch] = useState<string | null>(null)
  const [loadingConfig, setLoadingConfig] = useState(true)

  // Загрузка конфига и счётчика при открытии
  useEffect(() => {
    if (!isOpen) return

    let cancelled = false

    const load = async () => {
      setLoadingConfig(true)
      try {
        const [configResult, countResult] = await Promise.all([
          fetchExpressConfig(),
          fetchWeekCount(),
        ])
        if (!cancelled) {
          setConfig(configResult.data)
          setWeekCount(countResult.data)
        }
      } catch (err) {
        console.warn('ExpressBuilder: failed to load config', err)
      } finally {
        if (!cancelled) {
          setLoadingConfig(false)
        }
      }
    }

    void load()
    return () => { cancelled = true }
  }, [isOpen])

  // Фильтрация доступных матчей (исключаем уже добавленные)
  const availableMatches = useMemo(() => {
    const usedMatchIds = new Set(items.map(i => i.matchId))
    return matches.filter(m => !usedMatchIds.has(m.matchId))
  }, [matches, items])

  // Расчёт очков
  const calculation = useMemo(() => {
    const count = items.length
    if (count === 0) {
      return { basePoints: 0, multiplier: 1, totalPoints: 0 }
    }
    const basePoints = items.reduce((sum, item) => sum + item.basePoints, 0)
    const multiplier = getMultiplierForItemCount(count, config)
    const totalPoints = Math.round(basePoints * multiplier)
    return { basePoints, multiplier, totalPoints }
  }, [items, config])

  // Проверка лимита
  const canCreateExpress = useMemo(() => {
    if (!weekCount) return true
    return weekCount.remaining > 0
  }, [weekCount])

  // Проверка минимума/максимума
  const minItems = config?.minItems ?? 2
  const maxItems = config?.maxItems ?? 4
  const canAddMore = items.length < maxItems
  const canSubmit = items.length >= minItems && items.length <= maxItems && canCreateExpress

  // Добавление события в экспресс
  const addItem = useCallback((
    match: ActivePredictionMatch,
    template: PredictionTemplateView,
    selection: string,
    selectionLabel: string
  ) => {
    const basePoints = template.basePoints * (template.difficultyMultiplier ?? 1)
    const marketLabel = MARKET_LABELS[template.marketType] ?? template.marketType

    const newItem: ExpressItem = {
      templateId: template.id,
      matchId: match.matchId,
      selection,
      selectionLabel,
      marketLabel,
      basePoints: Math.round(basePoints),
      homeClub: match.homeClub,
      awayClub: match.awayClub,
      matchDateTime: match.matchDateTime,
    }

    setItems(prev => [...prev, newItem])
    setSelectedMatch(null)
    setError(undefined)
    setSuccess(undefined)
  }, [])

  // Удаление события из экспресса
  const removeItem = useCallback((templateId: string) => {
    setItems(prev => prev.filter(i => i.templateId !== templateId))
    setError(undefined)
    setSuccess(undefined)
  }, [])

  // Очистка экспресса
  const clearItems = useCallback(() => {
    setItems([])
    setError(undefined)
    setSuccess(undefined)
  }, [])

  // Отправка экспресса
  const handleSubmit = useCallback(async () => {
    if (!canSubmit || submitting) return

    setSubmitting(true)
    setError(undefined)
    setSuccess(undefined)

    try {
      const result = await createExpress(
        items.map(i => ({ templateId: i.templateId, selection: i.selection }))
      )

      if (!result.ok) {
        setError(translateExpressError(result.error))
        return
      }

      setSuccess(`Экспресс создан! Возможный выигрыш: +${calculation.totalPoints} очков`)
      setItems([])

      // Обновить счётчик
      const countResult = await fetchWeekCount({ force: true })
      setWeekCount(countResult.data)

      onExpressCreated?.()
    } catch (err) {
      console.error('ExpressBuilder: submit failed', err)
      setError(translateExpressError())
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, submitting, items, calculation.totalPoints, onExpressCreated])

  // Переключение панели
  const toggleOpen = useCallback(() => {
    setIsOpen(prev => !prev)
    setSelectedMatch(null)
    setError(undefined)
    setSuccess(undefined)
  }, [])

  if (!isAuthorized) {
    return null
  }

  return (
    <div className="express-builder">
      {/* Кнопка открытия */}
      <button
        type="button"
        className={`express-toggle-btn ${isOpen ? 'active' : ''}`}
        onClick={toggleOpen}
      >
        <span className="express-toggle-icon">⚡</span>
        <span className="express-toggle-label">
          {isOpen ? 'Скрыть экспресс' : 'Собрать экспресс'}
        </span>
        {items.length > 0 && (
          <span className="express-item-count">{items.length}</span>
        )}
      </button>

      {/* Панель экспресса */}
      {isOpen && (
        <div className="express-panel">
          {/* Заголовок */}
          <div className="express-header">
            <div className="express-header-main">
              <h3 className="express-title">Экспресс-прогноз</h3>
              <p className="express-subtitle">
                Объедините {minItems}-{maxItems} события из разных матчей
              </p>
            </div>
            {weekCount && (
              <div className="express-limit-info">
                <span className="express-limit-label">Осталось:</span>
                <span className={`express-limit-value ${weekCount.remaining === 0 ? 'exhausted' : ''}`}>
                  {weekCount.remaining}/{weekCount.limit}
                </span>
              </div>
            )}
          </div>

          {/* Загрузка */}
          {loadingConfig && (
            <div className="express-loading">Загрузка...</div>
          )}

          {/* Ошибка лимита */}
          {!canCreateExpress && (
            <div className="express-limit-warning">
              Вы уже создали {weekCount?.limit} экспресса за {weekCount?.periodDays} дней.
              Попробуйте позже.
            </div>
          )}

          {/* Список выбранных событий */}
          {items.length > 0 && (
            <div className="express-items">
              <div className="express-items-header">
                <span className="express-items-count">
                  Выбрано: {items.length}/{maxItems}
                </span>
                <button
                  type="button"
                  className="express-clear-btn"
                  onClick={clearItems}
                >
                  Очистить
                </button>
              </div>
              <ul className="express-items-list">
                {items.map(item => (
                  <li key={item.templateId} className="express-item">
                    <div className="express-item-match">
                      <span className="express-item-teams">
                        {getClubShortName(item.homeClub)} — {getClubShortName(item.awayClub)}
                      </span>
                      <span className="express-item-time">{formatTime(item.matchDateTime)}</span>
                    </div>
                    <div className="express-item-selection">
                      <span className="express-item-market">{item.marketLabel}:</span>
                      <span className="express-item-choice">{item.selectionLabel}</span>
                      <span className="express-item-points">+{item.basePoints}</span>
                    </div>
                    <button
                      type="button"
                      className="express-item-remove"
                      onClick={() => removeItem(item.templateId)}
                      aria-label="Удалить"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Расчёт */}
          {items.length > 0 && (
            <div className="express-calculation">
              <div className="express-calc-row">
                <span className="express-calc-label">Базовые очки:</span>
                <span className="express-calc-value">{calculation.basePoints}</span>
              </div>
              <div className="express-calc-row highlight">
                <span className="express-calc-label">
                  Множитель ({items.length} событий):
                </span>
                <span className="express-calc-value multiplier">
                  {formatMultiplier(calculation.multiplier)}
                </span>
              </div>
              <div className="express-calc-row total">
                <span className="express-calc-label">Итого при выигрыше:</span>
                <span className="express-calc-value">+{calculation.totalPoints}</span>
              </div>
            </div>
          )}

          {/* Выбор матча */}
          {canAddMore && canCreateExpress && (
            <div className="express-match-picker">
              <h4 className="express-picker-title">Добавить событие</h4>

              {selectedMatch === null ? (
                <div className="express-match-list">
                  {availableMatches.length === 0 ? (
                    <p className="express-no-matches">
                      Нет доступных матчей для добавления
                    </p>
                  ) : (
                    availableMatches.map(match => (
                      <button
                        key={match.matchId}
                        type="button"
                        className="express-match-btn"
                        onClick={() => setSelectedMatch(match.matchId)}
                      >
                        <span className="express-match-teams">
                          {getClubShortName(match.homeClub)} — {getClubShortName(match.awayClub)}
                        </span>
                        <span className="express-match-time">
                          {formatTime(match.matchDateTime)}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              ) : (
                <MatchTemplatesPicker
                  match={availableMatches.find(m => m.matchId === selectedMatch)!}
                  onSelect={addItem}
                  onCancel={() => setSelectedMatch(null)}
                />
              )}
            </div>
          )}

          {/* Ошибки и успех */}
          {error && <div className="express-error">{error}</div>}
          {success && <div className="express-success">{success}</div>}

          {/* Кнопка отправки */}
          {items.length > 0 && canCreateExpress && (
            <button
              type="button"
              className="express-submit-btn"
              onClick={handleSubmit}
              disabled={!canSubmit || submitting}
            >
              {submitting ? 'Создаём...' : `Создать экспресс (${formatMultiplier(calculation.multiplier)})`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// =================== ПОДКОМПОНЕНТ: ВЫБОР СОБЫТИЯ В МАТЧЕ ===================

type MatchTemplatesPickerProps = {
  match: ActivePredictionMatch
  onSelect: (
    match: ActivePredictionMatch,
    template: PredictionTemplateView,
    selection: string,
    selectionLabel: string
  ) => void
  onCancel: () => void
}

const MatchTemplatesPicker: React.FC<MatchTemplatesPickerProps> = ({
  match,
  onSelect,
  onCancel,
}) => {
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)

  // Фильтруем только активные шаблоны
  const templates = match.templates.filter(t => t.status === 'ACTIVE')

  if (templates.length === 0) {
    return (
      <div className="express-template-picker">
        <div className="express-picker-header">
          <span className="express-picker-match">
            {getClubShortName(match.homeClub)} — {getClubShortName(match.awayClub)}
          </span>
          <button type="button" className="express-back-btn" onClick={onCancel}>
            ← Назад
          </button>
        </div>
        <p className="express-no-templates">Нет доступных событий для этого матча</p>
      </div>
    )
  }

  const handleChoiceClick = (
    template: PredictionTemplateView,
    choice: PredictionChoiceOption
  ) => {
    const label = choice.label || translateChoiceLabel(template.marketType, choice.value)
    onSelect(match, template, choice.value, label)
  }

  return (
    <div className="express-template-picker">
      <div className="express-picker-header">
        <span className="express-picker-match">
          {getClubShortName(match.homeClub)} — {getClubShortName(match.awayClub)}
        </span>
        <button type="button" className="express-back-btn" onClick={onCancel}>
          ← Назад
        </button>
      </div>

      <div className="express-templates">
        {templates.map(template => {
          const choices = normalizeTemplateChoices(template)
          const isExpanded = selectedTemplate === template.id
          const marketLabel = MARKET_LABELS[template.marketType] ?? template.marketType
          const basePoints = Math.round(template.basePoints * (template.difficultyMultiplier ?? 1))

          return (
            <div key={template.id} className="express-template">
              <button
                type="button"
                className={`express-template-header ${isExpanded ? 'expanded' : ''}`}
                onClick={() => setSelectedTemplate(isExpanded ? null : template.id)}
              >
                <span className="express-template-name">{marketLabel}</span>
                <span className="express-template-points">+{basePoints}</span>
              </button>

              {isExpanded && choices.length > 0 && (
                <div className="express-choices">
                  {choices.map(choice => (
                    <button
                      key={choice.value}
                      type="button"
                      className="express-choice-btn"
                      onClick={() => handleChoiceClick(template, choice)}
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default ExpressBuilder
