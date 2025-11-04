import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  RatingLeaderboardEntryView,
  RatingLevel,
  RatingScopeKey,
} from '@shared/types'
import { fetchRatingLeaderboard } from '../api/ratingsApi'
import '../styles/ratings.css'

type ScopeState = {
  entries: RatingLeaderboardEntryView[]
  total: number
  capturedAt?: string
  page: number
  pageSize: number
  version?: string
  loading: boolean
  error?: string
  fetchedAt?: number
}

const PAGE_SIZE = 25
const CACHE_TTL_MS = 300_000

const scopeLabels: Record<RatingScopeKey, string> = {
  current: 'Текущий сезон',
  yearly: 'Годовой рейтинг',
}

const levelLabels: Record<RatingLevel, string> = {
  BRONZE: 'Бронза',
  SILVER: 'Серебро',
  GOLD: 'Золото',
  PLATINUM: 'Платина',
  DIAMOND: 'Алмаз',
  MYTHIC: 'Мифический',
}

const errorMessages: Record<string, string> = {
  http_error: 'Сервер временно недоступен. Попробуйте обновить позже.',
  invalid_json: 'Не удалось разобрать ответ от сервера.',
  empty_response: 'Ответ сервера не содержит данных.',
  response_error: 'Сервер вернул ошибку при загрузке рейтинга.',
  unknown_error: 'Произошла неизвестная ошибка.',
}

const createInitialScopeState = (): ScopeState => ({
  entries: [],
  total: 0,
  capturedAt: undefined,
  page: 0,
  pageSize: PAGE_SIZE,
  version: undefined,
  loading: false,
  error: undefined,
  fetchedAt: undefined,
})

const formatError = (code: string): string => {
  return errorMessages[code] ?? errorMessages.unknown_error
}

const getFallbackInitials = (value: string): string => {
  if (!value) {
    return '??'
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return '??'
  }
  return trimmed.slice(0, 2).toUpperCase()
}

const mergeEntries = (
  existing: RatingLeaderboardEntryView[],
  incoming: RatingLeaderboardEntryView[],
  page: number
): RatingLeaderboardEntryView[] => {
  if (page === 1) {
    return incoming
  }
  if (incoming.length === 0) {
    return existing
  }
  const map = new Map<number, RatingLeaderboardEntryView>()
  existing.forEach((entry) => {
    map.set(entry.userId, entry)
  })
  incoming.forEach((entry) => {
    map.set(entry.userId, entry)
  })
  return Array.from(map.values()).sort((a, b) => a.position - b.position)
}

const formatRelativeHint = (timestamp?: number): string | null => {
  if (!timestamp) {
    return null
  }
  const secondsAgo = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (secondsAgo < 5) {
    return 'Таблица обновлена секунду назад.'
  }
  if (secondsAgo < 60) {
    return `Показаны свежие данные (${secondsAgo} сек назад).`
  }
  const minutesAgo = Math.round(secondsAgo / 60)
  return `Последнее обновление примерно ${minutesAgo} мин назад.`
}

export function RatingsPage() {
  const [scope, setScope] = useState<RatingScopeKey>('current')
  const [states, setStates] = useState<Record<RatingScopeKey, ScopeState>>({
    current: createInitialScopeState(),
    yearly: createInitialScopeState(),
  })
  const statesRef = useRef(states)
  const [hint, setHint] = useState<string | null>(null)

  useEffect(() => {
    statesRef.current = states
  }, [states])

  const updateStates = useCallback(
    (updater: (current: Record<RatingScopeKey, ScopeState>) => Record<RatingScopeKey, ScopeState>) => {
      setStates((prev) => {
        const next = updater(prev)
        statesRef.current = next
        return next
      })
    },
    []
  )

  const numberFormatter = useMemo(() => new Intl.NumberFormat('ru-RU'), [])
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('ru-RU', {
        dateStyle: 'short',
        timeStyle: 'short',
      }),
    []
  )

  const loadLeaderboard = useCallback(
    async (targetScope: RatingScopeKey, page = 1, force = false) => {
      updateStates((prev) => ({
        ...prev,
        [targetScope]: {
          ...prev[targetScope],
          loading: true,
          error: undefined,
        },
      }))

      const snapshot = statesRef.current[targetScope]
      const version = !force && page === 1 ? snapshot.version : undefined
      const response = await fetchRatingLeaderboard(targetScope, { page, pageSize: PAGE_SIZE }, version)

      if (!response.ok) {
        const errorLabel = formatError(response.error)
        updateStates((prev) => ({
          ...prev,
          [targetScope]: {
            ...prev[targetScope],
            loading: false,
            error: errorLabel,
          },
        }))
        setHint('Не удалось обновить рейтинг. Проверьте соединение и попробуйте ещё раз.')
        return
      }

      if ('notModified' in response && response.notModified) {
        updateStates((prev) => ({
          ...prev,
          [targetScope]: {
            ...prev[targetScope],
            loading: false,
            error: undefined,
          },
        }))
        setHint(formatRelativeHint(snapshot.fetchedAt))
        return
      }

      const { data, version: nextVersion } = response

      updateStates((prev) => {
        const nextEntries = mergeEntries(prev[targetScope].entries, data.entries, data.page)
        const nextState: ScopeState = {
          ...prev[targetScope],
          entries: nextEntries,
          total: data.total,
          capturedAt: data.capturedAt,
          page: data.page,
          pageSize: data.pageSize,
          version: nextVersion ?? prev[targetScope].version,
          loading: false,
          error: undefined,
          fetchedAt: Date.now(),
        }
        return {
          ...prev,
          [targetScope]: nextState,
        }
      })
      setHint(null)
    },
    [updateStates]
  )

  useEffect(() => {
    const currentState = statesRef.current[scope]
    if (currentState.entries.length === 0) {
      loadLeaderboard(scope, 1)
      return
    }
    const isFresh = !!currentState.fetchedAt && Date.now() - currentState.fetchedAt < CACHE_TTL_MS
    if (!isFresh) {
      loadLeaderboard(scope, 1)
      return
    }
    setHint(formatRelativeHint(currentState.fetchedAt))
  }, [scope, loadLeaderboard])

  const activeState = states[scope]
  const hasMore = activeState.entries.length < activeState.total
  const isLoadingInitial = activeState.loading && activeState.entries.length === 0
  const isLoadingMore = activeState.loading && activeState.entries.length > 0
  const defaultHint = `Запросы кешируются до ${Math.round(CACHE_TTL_MS / 1000)} секунд для снижения нагрузки.`

  const handleScopeChange = (nextScope: RatingScopeKey) => {
    if (nextScope === scope) {
      return
    }
    setScope(nextScope)
  }

  const handleRefresh = () => {
    loadLeaderboard(scope, 1, true)
  }

  const handleLoadMore = () => {
    if (!hasMore || activeState.loading) {
      return
    }
    const nextPage = Math.max(1, activeState.page) + 1
    loadLeaderboard(scope, nextPage)
  }

  return (
    <div className="ratings-page">
      <header className="ratings-header">
        <div className="ratings-title-row">
          <h1 className="ratings-title">Рейтинг игроков</h1>
          <div className="ratings-controls">
            <button type="button" onClick={handleRefresh} disabled={activeState.loading}>
              Обновить
            </button>
          </div>
        </div>
        <div className="ratings-title-row">
          <div className="ratings-scope-switch">
            {(Object.keys(scopeLabels) as RatingScopeKey[]).map((scopeKey) => (
              <button
                key={scopeKey}
                type="button"
                className={scope === scopeKey ? 'active' : ''}
                onClick={() => handleScopeChange(scopeKey)}
              >
                {scopeLabels[scopeKey]}
              </button>
            ))}
          </div>
          <div className="ratings-updated">
            {activeState.capturedAt
              ? `Срез от ${dateFormatter.format(new Date(activeState.capturedAt))}`
              : 'Срез обновляется каждые несколько минут'}
          </div>
        </div>
        <div className="ratings-note">{hint ?? defaultHint}</div>
        {activeState.error ? <div className="ratings-error">{activeState.error}</div> : null}
      </header>

      {isLoadingInitial ? (
        <div className="ratings-empty">Загружаем свежий рейтинг...</div>
      ) : activeState.entries.length === 0 ? (
        <div className="ratings-empty">Пока нет данных для отображения рейтинга.</div>
      ) : (
        <ul className="ratings-list">
          {activeState.entries.map((entry) => {
            const seasonalLabel = scope === 'current' ? 'Очки сезона' : 'Очки года'
            const seasonalValue = scope === 'current' ? entry.seasonalPoints : entry.yearlyPoints
            const cardHighlight = entry.position <= 5 ? 'rating-card highlight' : 'rating-card'
            const levelClass = entry.currentLevel === 'MYTHIC' ? 'rating-level mythic' : 'rating-level'
            const streakLabel = entry.currentStreak > 0
              ? `Серия ${entry.currentStreak} побед`
              : 'Серия пока не активна'
            return (
              <li key={`${entry.userId}-${entry.position}`} className={cardHighlight}>
                <div className="rating-position">#{entry.position}</div>
                <div className="rating-profile">
                  <div className={entry.photoUrl ? 'rating-avatar' : 'rating-avatar fallback'}>
                    {entry.photoUrl ? (
                      <img src={entry.photoUrl} alt={entry.displayName} loading="lazy" />
                    ) : (
                      getFallbackInitials(entry.displayName)
                    )}
                  </div>
                  <div className="rating-user-info">
                    <span className="rating-name">{entry.displayName}</span>
                    {entry.username ? (
                      <span className="rating-username">@{entry.username}</span>
                    ) : null}
                    <span className={levelClass}>
                      {levelLabels[entry.currentLevel]}
                      {entry.mythicRank ? ` - Mythic #${entry.mythicRank}` : ''}
                    </span>
                  </div>
                </div>
                <div className="rating-stats">
                  <div className="rating-stat-block">
                    <span className="rating-stat-label">Всего очков</span>
                    <span className="rating-stat-value">{numberFormatter.format(entry.totalPoints)}</span>
                  </div>
                  <div className="rating-stat-block">
                    <span className="rating-stat-label">{seasonalLabel}</span>
                    <span className="rating-stat-value">{numberFormatter.format(seasonalValue)}</span>
                  </div>
                  <div className="rating-stat-block">
                    <span className="rating-stat-label">Лучшая серия</span>
                    <span className="rating-stat-value">{numberFormatter.format(entry.maxStreak)}</span>
                  </div>
                  <div className="rating-streak">{streakLabel}</div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {hasMore ? (
        <div className="ratings-footer">
          <button
            type="button"
            className="ratings-load-more"
            onClick={handleLoadMore}
            disabled={activeState.loading}
          >
            {isLoadingMore ? 'Загружаем...' : 'Показать ещё'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

export default RatingsPage
