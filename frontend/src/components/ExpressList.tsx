/**
 * Компонент для отображения списка экспресс-прогнозов пользователя
 * с анимациями выигрыша/проигрыша
 */

import React, { useCallback, useEffect, useState } from 'react'
import type { ExpressBetView, ExpressStatus, PredictionEntryStatus } from '@shared/types'
import { fetchMyExpresses, formatMultiplier } from '../api/expressApi'
import './ExpressList.css'

// =================== ТИПЫ ===================

type ExpressListProps = {
  onRefresh?: () => void
}

// =================== ХРАНЕНИЕ ПОКАЗАННЫХ АНИМАЦИЙ ===================

const SHOWN_ANIMATIONS_KEY = 'express_shown_animations'

const getShownAnimationIds = (): Set<string> => {
  try {
    const raw = localStorage.getItem(SHOWN_ANIMATIONS_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as string[]
    return new Set(parsed)
  } catch {
    return new Set()
  }
}

const markAnimationShown = (expressId: string): void => {
  try {
    const shown = getShownAnimationIds()
    shown.add(expressId)
    // Храним только последние 100 ID для экономии места
    const arr = Array.from(shown).slice(-100)
    localStorage.setItem(SHOWN_ANIMATIONS_KEY, JSON.stringify(arr))
  } catch {
    // Игнорируем ошибки localStorage
  }
}

// =================== КОНСТАНТЫ ===================

const STATUS_LABELS: Record<ExpressStatus, string> = {
  PENDING: 'Ожидает',
  WON: 'Выигрыш',
  LOST: 'Проигрыш',
  CANCELLED: 'Отменён',
  VOID: 'Аннулирован',
}

const ITEM_STATUS_LABELS: Record<PredictionEntryStatus, string> = {
  PENDING: '⏳',
  WON: '✓',
  LOST: '✕',
  VOID: '—',
  CANCELLED: '—',
  EXPIRED: '—',
}

// =================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===================

const formatDateTime = (iso: string): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${day}.${month} ${hours}:${minutes}`
}

const getClubShortName = (club: { name: string; shortName: string | null }): string => {
  if (club.shortName) return club.shortName
  const words = club.name.trim().split(/\s+/)
  if (words.length === 1) {
    return words[0].slice(0, 3).toUpperCase()
  }
  return words.map(w => w[0]).join('').slice(0, 3).toUpperCase()
}

const translateSelection = (marketType: string, selection: string): string => {
  const upper = selection.toUpperCase()

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

  return selection
}

// =================== КОМПОНЕНТ ===================

const ExpressList: React.FC<ExpressListProps> = ({ onRefresh: _onRefresh }) => {
  const [expresses, setExpresses] = useState<ExpressBetView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [celebratingId, setCelebratingId] = useState<string | null>(null)

  // Загрузка экспрессов
  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError(undefined)
      try {
        const result = await fetchMyExpresses()
        if (!cancelled) {
          setExpresses(result.data)

          // Проверяем, есть ли новый выигрыш для анимации (который ещё не показывали)
          const shownIds = getShownAnimationIds()
          const recentWin = result.data.find(
            e => e.status === 'WON' && e.resolvedAt &&
              Date.now() - new Date(e.resolvedAt).getTime() < 60_000 && // < 1 минуты
              !shownIds.has(e.id) // Ещё не показывали
          )
          if (recentWin) {
            setCelebratingId(recentWin.id)
            markAnimationShown(recentWin.id)
            setTimeout(() => setCelebratingId(null), 4000)
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('ExpressList: failed to load', err)
          setError('Не удалось загрузить экспрессы')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()
    return () => { cancelled = true }
  }, [])

  // Примечание: onRefresh можно использовать для расширения функционала
  // например, передавать колбэк обновления через ref

  const toggleExpand = useCallback((id: string) => {
    setExpandedId(prev => prev === id ? null : id)
  }, [])

  if (loading) {
    return <div className="express-list-loading">Загрузка экспрессов...</div>
  }

  if (error) {
    return <div className="express-list-error">{error}</div>
  }

  if (expresses.length === 0) {
    return (
      <div className="express-list-empty">
        <span className="express-list-empty-icon">⚡</span>
        <p>У вас пока нет экспресс-прогнозов</p>
        <p className="express-list-empty-hint">
          Создайте экспресс, объединив 2-4 события из разных матчей
        </p>
      </div>
    )
  }

  return (
    <div className="express-list">
      <h3 className="express-list-title">
        <span className="express-list-icon">⚡</span>
        Экспрессы
      </h3>

      <ul className="express-list-items">
        {expresses.map(express => {
          const isExpanded = expandedId === express.id
          const isCelebrating = celebratingId === express.id
          const statusClass = express.status.toLowerCase()
          const pendingCount = express.items.filter(i => i.status === 'PENDING').length
          const wonCount = express.items.filter(i => i.status === 'WON').length
          const lostCount = express.items.filter(i => i.status === 'LOST').length

          return (
            <li
              key={express.id}
              className={`express-card express-status-${statusClass} ${isCelebrating ? 'celebrating' : ''}`}
            >
              {/* Анимация выигрыша */}
              {isCelebrating && (
                <div className="express-celebration">
                  <span className="celebration-text">🎉 ВЫИГРЫШ! 🎉</span>
                  <span className="celebration-points">+{express.scoreAwarded}</span>
                </div>
              )}

              {/* Заголовок карточки */}
              <button
                type="button"
                className="express-card-header"
                onClick={() => toggleExpand(express.id)}
              >
                <div className="express-card-main">
                  <span className="express-card-items-count">
                    {express.items.length} событий
                  </span>
                  <span className={`express-card-status status-${statusClass}`}>
                    {STATUS_LABELS[express.status]}
                  </span>
                </div>

                <div className="express-card-stats">
                  <span className="express-card-multiplier">
                    {formatMultiplier(express.multiplier)}
                  </span>
                  {express.status === 'PENDING' ? (
                    <span className="express-card-potential">
                      до +{Math.round(express.basePoints * express.multiplier)}
                    </span>
                  ) : express.scoreAwarded !== null ? (
                    <span className={`express-card-points ${express.scoreAwarded > 0 ? 'won' : ''}`}>
                      {express.scoreAwarded > 0 ? `+${express.scoreAwarded}` : express.scoreAwarded}
                    </span>
                  ) : null}
                </div>

                <div className="express-card-progress">
                  {express.items.map(item => (
                    <span
                      key={item.id}
                      className={`progress-dot status-${item.status.toLowerCase()}`}
                      title={`${getClubShortName(item.homeClub)} - ${getClubShortName(item.awayClub)}`}
                    />
                  ))}
                </div>

                <span className="express-expand-icon">
                  {isExpanded ? '▲' : '▼'}
                </span>
              </button>

              {/* Развёрнутое содержимое */}
              {isExpanded && (
                <div className="express-card-details">
                  <div className="express-items-summary">
                    <span className="summary-item won">✓ {wonCount}</span>
                    <span className="summary-item lost">✕ {lostCount}</span>
                    <span className="summary-item pending">⏳ {pendingCount}</span>
                  </div>

                  <ul className="express-items-list">
                    {express.items.map(item => (
                      <li
                        key={item.id}
                        className={`express-item-row status-${item.status.toLowerCase()}`}
                      >
                        <span className="item-status-icon">
                          {ITEM_STATUS_LABELS[item.status]}
                        </span>
                        <div className="item-match">
                          <span className="item-teams">
                            {item.homeClub.name} — {item.awayClub.name}
                          </span>
                          <span className="item-time">{formatDateTime(item.matchDateTime)}</span>
                        </div>
                        <span className="item-selection">
                          {translateSelection(item.marketType, item.selection)}
                        </span>
                        <span className="item-points">+{item.basePoints}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="express-created-at">
                    Создан: {formatDateTime(express.createdAt)}
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default ExpressList
