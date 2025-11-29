import React, { useCallback, useState, useEffect } from 'react'
import { useExpressCart } from '../store/expressCartHooks'
import type { ExpressCartItem } from '../store/ExpressCartContext'
import {
  createExpress,
  fetchExpressConfig,
  fetchWeekCount,
  invalidateExpressCache,
} from '../api/expressApi'
import type { CreateExpressItemInput } from '@shared/types'
import './ExpressCartModal.css'

const TIME_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

const formatDateTime = (iso: string): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return TIME_FORMATTER.format(date)
}

interface ExpressCartModalProps {
  onExpressCreated?: () => void
}

/**
 * Модальное окно для просмотра и подтверждения экспресса
 */
const ExpressCartModal: React.FC<ExpressCartModalProps> = ({ onExpressCreated }) => {
  const {
    items,
    isModalOpen,
    setModalOpen,
    removeItem,
    clearCart,
    config,
    weekCount,
    setConfig,
    setWeekCount,
    getMultiplier,
    isReadyToSubmit,
    isWeeklyLimitReached,
  } = useExpressCart()

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Загрузить конфигурацию и счётчик при открытии модалки
  useEffect(() => {
    if (!isModalOpen) return

    const loadData = async () => {
      try {
        const [configResult, countResult] = await Promise.all([
          fetchExpressConfig(),
          fetchWeekCount(),
        ])
        if (configResult.data) {
          setConfig(configResult.data)
        }
        if (countResult.data) {
          setWeekCount(countResult.data)
        }
      } catch (err) {
        console.warn('ExpressCartModal: failed to load config/count', err)
      }
    }

    void loadData()
  }, [isModalOpen, setConfig, setWeekCount])

  const handleClose = useCallback(() => {
    setModalOpen(false)
    setError(null)
    setSuccess(false)
  }, [setModalOpen])

  const handleRemoveItem = useCallback((templateId: string) => {
    removeItem(templateId)
    setError(null)
  }, [removeItem])

  const handleClearCart = useCallback(() => {
    clearCart()
    setError(null)
  }, [clearCart])

  const handleSubmit = useCallback(async () => {
    if (!isReadyToSubmit()) {
      setError(`Добавьте ${config?.minItems ?? 2}–${config?.maxItems ?? 4} события из разных матчей`)
      return
    }

    if (isWeeklyLimitReached()) {
      setError('Вы достигли лимита экспрессов на эту неделю')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const expressItems: CreateExpressItemInput[] = items.map(item => ({
        templateId: item.templateId,
        selection: item.selection,
      }))

      const result = await createExpress(expressItems)

      if (!result.ok) {
        // Обработка ошибок
        if (result.unauthorized) {
          setError('Войдите в профиль, чтобы создать экспресс')
        } else if (result.validationError === 'weekly_limit_reached') {
          setError('Вы достигли лимита экспрессов на эту неделю')
        } else if (result.validationError === 'duplicate_matches') {
          setError('Выбраны события из одного матча')
        } else if (result.validationError === 'too_few_items') {
          setError(`Минимум ${config?.minItems ?? 2} события для экспресса`)
        } else if (result.validationError === 'too_many_items') {
          setError(`Максимум ${config?.maxItems ?? 4} события для экспресса`)
        } else if (result.validationError === 'match_locked') {
          setError('Один из матчей уже начался')
        } else if (result.error) {
          setError(result.error)
        } else {
          setError('Не удалось создать экспресс. Попробуйте позже.')
        }
        return
      }

      // Успех!
      setSuccess(true)
      clearCart()
      invalidateExpressCache()
      onExpressCreated?.()

      // Закрыть модалку через 2 секунды
      setTimeout(() => {
        handleClose()
      }, 2000)
    } catch (err) {
      console.error('ExpressCartModal: submit failed', err)
      setError('Ошибка сети. Попробуйте позже.')
    } finally {
      setSubmitting(false)
    }
  }, [
    items,
    config,
    isReadyToSubmit,
    isWeeklyLimitReached,
    clearCart,
    onExpressCreated,
    handleClose,
  ])

  // Не рендерим если модалка закрыта
  if (!isModalOpen) {
    return null
  }

  const multiplier = getMultiplier()
  const ready = isReadyToSubmit()
  const weeklyLimitReached = isWeeklyLimitReached()
  const minItems = config?.minItems ?? 2
  const maxItems = config?.maxItems ?? 4

  // Расчёт потенциальных очков
  const totalBasePoints = items.reduce((sum, item) => sum + item.basePoints, 0)
  const potentialPoints = Math.round(totalBasePoints * multiplier)

  return (
    <div className="express-modal-overlay" onClick={handleClose}>
      <div className="express-modal" onClick={e => e.stopPropagation()}>
        <header className="express-modal-header">
          <h2 className="express-modal-title">
            Экспресс
            {items.length > 0 && (
              <span className="express-modal-count">({items.length}/{maxItems})</span>
            )}
          </h2>
          <button
            type="button"
            className="express-modal-close"
            onClick={handleClose}
            aria-label="Закрыть"
          >
            ×
          </button>
        </header>

        {success ? (
          <div className="express-modal-success">
            <div className="express-modal-success-icon">✓</div>
            <p>Экспресс успешно создан!</p>
            <p className="express-modal-success-points">
              Потенциальный выигрыш: <strong>+{potentialPoints}</strong> очков
            </p>
          </div>
        ) : (
          <>
            {/* Информация о лимитах */}
            {weekCount && (
              <div className="express-modal-limits">
                <span className="express-modal-limits-label">
                  Экспрессов за {weekCount.periodDays} дней:
                </span>
                <span className={`express-modal-limits-value ${weeklyLimitReached ? 'limit-reached' : ''}`}>
                  {weekCount.count}/{weekCount.limit}
                </span>
              </div>
            )}

            {/* Список элементов */}
            <div className="express-modal-items">
              {items.length === 0 ? (
                <p className="express-modal-empty">
                  Корзина пуста. Добавьте события из разных матчей.
                </p>
              ) : (
                <ul className="express-modal-item-list">
                  {items.map(item => (
                    <ExpressCartItemRow
                      key={item.templateId}
                      item={item}
                      onRemove={() => handleRemoveItem(item.templateId)}
                      disabled={submitting}
                    />
                  ))}
                </ul>
              )}
            </div>

            {/* Множитель и потенциальные очки */}
            {items.length > 0 && (
              <div className="express-modal-summary">
                <div className="express-modal-summary-row">
                  <span>Событий:</span>
                  <span>{items.length} / {minItems}–{maxItems}</span>
                </div>
                <div className="express-modal-summary-row">
                  <span>Множитель:</span>
                  <span className={ready ? 'multiplier-active' : 'multiplier-inactive'}>
                    ×{multiplier.toFixed(1)}
                  </span>
                </div>
                <div className="express-modal-summary-row highlight">
                  <span>Потенциальный выигрыш:</span>
                  <span className="express-points">+{potentialPoints}</span>
                </div>
                {!ready && (
                  <p className="express-modal-hint">
                    Добавьте ещё {minItems - items.length} {items.length === 1 ? 'событие' : 'события'} для активации экспресса
                  </p>
                )}
              </div>
            )}

            {/* Ошибка */}
            {error && (
              <p className="express-modal-error">{error}</p>
            )}

            {/* Кнопки */}
            <footer className="express-modal-footer">
              {items.length > 0 && (
                <button
                  type="button"
                  className="express-modal-clear"
                  onClick={handleClearCart}
                  disabled={submitting}
                >
                  Очистить
                </button>
              )}
              <button
                type="button"
                className="express-modal-submit"
                onClick={handleSubmit}
                disabled={!ready || weeklyLimitReached || submitting}
              >
                {submitting ? 'Создаём...' : 'Создать экспресс'}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  )
}

interface ExpressCartItemRowProps {
  item: ExpressCartItem
  onRemove: () => void
  disabled: boolean
}

const ExpressCartItemRow: React.FC<ExpressCartItemRowProps> = ({ item, onRemove, disabled }) => {
  return (
    <li className="express-cart-item">
      <div className="express-cart-item-info">
        <div className="express-cart-item-match">{item.matchLabel}</div>
        <div className="express-cart-item-details">
          <span className="express-cart-item-market">{item.marketTitle}</span>
          <span className="express-cart-item-selection">{item.selectionLabel}</span>
          <span className="express-cart-item-time">{formatDateTime(item.matchDateTime)}</span>
        </div>
      </div>
      <div className="express-cart-item-actions">
        <span className="express-cart-item-points">+{item.basePoints}</span>
        <button
          type="button"
          className="express-cart-item-remove"
          onClick={onRemove}
          disabled={disabled}
          aria-label="Удалить из экспресса"
        >
          ×
        </button>
      </div>
    </li>
  )
}

export default ExpressCartModal
