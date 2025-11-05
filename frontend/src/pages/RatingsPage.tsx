import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  RatingLeaderboardEntryView,
  RatingLevel,
  RatingScopeKey,
} from '@shared/types'
import { fetchRatingLeaderboard } from '../api/ratingsApi'
import { useAdaptivePolling } from '../utils/useAdaptivePolling'
import '../styles/ratings.css'

type ScopeState = {
  entries: RatingLeaderboardEntryView[]
  total: number
  capturedAt?: string
  currentWindowStart?: string
  currentWindowEnd?: string
  yearlyWindowStart?: string
  yearlyWindowEnd?: string
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
  currentWindowStart: undefined,
  currentWindowEnd: undefined,
  yearlyWindowStart: undefined,
  yearlyWindowEnd: undefined,
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

export function RatingsPage() {
  const [scope, setScope] = useState<RatingScopeKey>('current')
  const [states, setStates] = useState<Record<RatingScopeKey, ScopeState>>({
    current: createInitialScopeState(),
    yearly: createInitialScopeState(),
  })
  const statesRef = useRef(states)

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
  const percentFormatter = useMemo(
    () =>
      new Intl.NumberFormat('ru-RU', {
        style: 'percent',
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
      }),
    []
  )
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

      const response = await fetchRatingLeaderboard(targetScope, { page, pageSize: PAGE_SIZE, force })

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
        return
      }

      const { data, etag: nextVersion, fromCache } = response

      updateStates((prev) => {
        const nextEntries = mergeEntries(prev[targetScope].entries, data.entries, data.page)
        const nextState: ScopeState = {
          ...prev[targetScope],
          entries: nextEntries,
          total: data.total,
          capturedAt: data.capturedAt,
          currentWindowStart: data.currentWindowStart,
          currentWindowEnd: data.currentWindowEnd,
          yearlyWindowStart: data.yearlyWindowStart,
          yearlyWindowEnd: data.yearlyWindowEnd,
          page: data.page,
          pageSize: data.pageSize,
          version: nextVersion ?? prev[targetScope].version,
          loading: false,
          error: undefined,
          fetchedAt: fromCache ? prev[targetScope].fetchedAt : Date.now(),
        }
        return {
          ...prev,
          [targetScope]: nextState,
        }
      })
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
  }, [scope, loadLeaderboard])

  // Адаптивный polling для автообновления рейтинга
  // Интервалы увеличены под Render.com Free tier - данные меняются редко
  useAdaptivePolling(
    () => {
      // Обновлять только если не загружается и есть данные
      const currentState = statesRef.current[scope]
      if (!currentState.loading && currentState.entries.length > 0) {
        loadLeaderboard(scope, 1, false)
      }
    },
    {
      activeInterval: 60000, // 1 минута для активной вкладки
      inactiveInterval: 300000, // 5 минут для неактивной
      backgroundInterval: 600000, // 10 минут для фоновой
      immediate: false, // Не запускать сразу, т.к. useEffect уже загружает
    }
  )

  const activeState = states[scope]
  const hasMore = activeState.entries.length < activeState.total
  const isLoadingInitial = activeState.loading && activeState.entries.length === 0
  const isLoadingMore = activeState.loading && activeState.entries.length > 0
  
  const formattedCurrentWindowStart = activeState.currentWindowStart
    ? dateFormatter.format(new Date(activeState.currentWindowStart))
    : null
  const formattedCurrentWindowEnd = activeState.currentWindowEnd
    ? dateFormatter.format(new Date(activeState.currentWindowEnd))
    : null
  const formattedYearlyWindowStart = activeState.yearlyWindowStart
    ? dateFormatter.format(new Date(activeState.yearlyWindowStart))
    : null
  const formattedYearlyWindowEnd = activeState.yearlyWindowEnd
    ? dateFormatter.format(new Date(activeState.yearlyWindowEnd))
    : null
  const scopePointsLabel = scope === 'current' ? 'Очки сезона' : 'Очки года'

  const handleScopeChange = (nextScope: RatingScopeKey) => {
    if (nextScope === scope) {
      return
    }
    setScope(nextScope)
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
          <div className="ratings-meta">
            {scope === 'current' ? (
              <>
                {formattedCurrentWindowStart && formattedCurrentWindowEnd ? (
                  <span className="ratings-meta-line">
                    Срез от {formattedCurrentWindowStart} до {formattedCurrentWindowEnd}
                  </span>
                ) : null}
              </>
            ) : (
              <>
                {formattedYearlyWindowStart && formattedYearlyWindowEnd ? (
                  <span className="ratings-meta-line">
                    Годовой рейтинг от {formattedYearlyWindowStart} до {formattedYearlyWindowEnd}
                  </span>
                ) : null}
              </>
            )}
          </div>
        </div>
        {activeState.error ? <div className="ratings-error">{activeState.error}</div> : null}
      </header>

      {isLoadingInitial ? (
        <div className="ratings-empty">Загружаем свежий рейтинг...</div>
      ) : activeState.entries.length === 0 ? (
        <div className="ratings-empty">Пока нет данных для отображения рейтинга.</div>
      ) : (
        <div className="ratings-table-container">
          <table className="ratings-table">
            <thead>
              <tr>
                <th className="col-position">Место</th>
                <th>Игрок</th>
                <th>{scopePointsLabel}</th>
                <th>Прогнозы</th>
                <th>% угаданных</th>
                <th>Серии</th>
              </tr>
            </thead>
            <tbody>
              {activeState.entries.map((entry) => {
                const scopePoints = scope === 'current' ? entry.seasonalPoints : entry.yearlyPoints
                const levelClass = entry.currentLevel === 'MYTHIC' ? 'rating-level mythic' : 'rating-level'
                const rawAccuracy = typeof entry.predictionAccuracy === 'number' ? entry.predictionAccuracy : 0
                const clampedAccuracy = Math.min(1, Math.max(0, rawAccuracy))
                const accuracyLabel = percentFormatter.format(clampedAccuracy)
                const rowClass = entry.position <= 3 ? 'ratings-row-top' : undefined
                return (
                  <tr key={`${entry.userId}-${entry.position}`} className={rowClass}>
                    <td className="col-position">#{entry.position}</td>
                    <td>
                      <div className="rating-user">
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
                            {entry.mythicRank ? ` · Mythic #${entry.mythicRank}` : ''}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td
                      className="col-points"
                      title={`Всего очков: ${numberFormatter.format(entry.totalPoints)}`}
                    >
                      {numberFormatter.format(scopePoints)}
                    </td>
                    <td className="col-predictions">
                      <span className="cell-value">{numberFormatter.format(entry.predictionCount)}</span>
                      <span className="cell-meta">Побед: {numberFormatter.format(entry.predictionWins)}</span>
                    </td>
                    <td>{accuracyLabel}</td>
                    <td className="col-streak">
                      <span className="cell-value">{numberFormatter.format(entry.maxStreak)}</span>
                      <span className="cell-meta">
                        Текущая: {numberFormatter.format(entry.currentStreak)}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
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
