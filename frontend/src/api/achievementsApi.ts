/**
 * Клиент для API достижений пользователя
 * Поддерживает SWR (Stale-While-Revalidate) кэширование
 */

import { buildApiUrl, httpRequest } from './httpClient'
import { authHeader } from './sessionToken'
import type {
  UserAchievementsSummary,
  UserAchievementsResponse,
} from '@shared/types'

// Включить логирование достижений для отладки
const DEBUG_ACHIEVEMENTS = true

function logAchievements(message: string, data?: unknown) {
  if (DEBUG_ACHIEVEMENTS) {
    console.log(`[AchievementsAPI] ${message}`, data ?? '')
  }
}

// TTL для кэша достижений (5m fresh / 15m stale)
const ACHIEVEMENTS_TTL_MS = 5 * 60 * 1000
const ACHIEVEMENTS_STALE_MS = 15 * 60 * 1000

interface CachedAchievements {
  data: UserAchievementsResponse
  etag?: string
  expiresAt: number
  staleUntil: number
  lastAccess: number
}

const CACHE_KEY_PREFIX = 'achievements:my:v2'

function getCacheKey(limit: number, offset: number, summary: boolean): string {
  return `${CACHE_KEY_PREFIX}:${limit}:${offset}:${summary}`
}

function getCachedAchievements(key: string): CachedAchievements | null {
  try {
    if (typeof window === 'undefined') return null
    const item = window.localStorage.getItem(key)
    if (!item) return null
    return JSON.parse(item) as CachedAchievements
  } catch {
    return null
  }
}

function setCachedAchievements(key: string, cache: CachedAchievements): void {
  try {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(key, JSON.stringify(cache))
  } catch (err) {
    console.warn('Failed to cache achievements:', err)
  }
}

/**
 * Результат запроса достижений
 */
export interface AchievementsResult {
  data: UserAchievementsResponse
  fromCache: boolean
  etag?: string
}

/**
 * Получить достижения текущего пользователя (новый API с пагинацией)
 */
export async function fetchMyAchievementsPaginated(options: {
  limit?: number
  offset?: number
  summary?: boolean
  force?: boolean
} = {}): Promise<AchievementsResult> {
  const limit = options.limit ?? 4
  const offset = options.offset ?? 0
  const summary = options.summary ?? true
  const force = options.force ?? false

  const cacheKey = getCacheKey(limit, offset, summary)
  const cache = getCachedAchievements(cacheKey)
  const now = Date.now()

  logAchievements('fetchMyAchievementsPaginated called', { limit, offset, summary, force, cacheKey })

  // Проверка: данные свежие
  const isFresh = cache && cache.expiresAt > now
  // Проверка: данные устаревшие, но ещё можно показать (SWR)
  const isStale = cache && cache.staleUntil > now && cache.expiresAt <= now

  logAchievements('Cache state', {
    hasCache: !!cache,
    isFresh,
    isStale,
    cacheExpiresAt: cache?.expiresAt ? new Date(cache.expiresAt).toISOString() : null,
    cachedProgress: cache?.data?.achievements?.map(a => ({ group: a.group, progress: a.currentProgress })),
  })

  // Если force=false и данные свежие - вернуть из кэша
  if (!force && isFresh) {
    logAchievements('Returning FRESH cache')
    return {
      data: cache.data,
      fromCache: true,
      etag: cache.etag,
    }
  }

  // Если данные устаревшие, но показываемые - запустить фоновое обновление и вернуть старые данные
  if (!force && isStale) {
    logAchievements('Returning STALE cache, starting background refresh')
    // Фоновое обновление (не блокируем)
    fetchMyAchievementsPaginated({ limit, offset, summary, force: true }).catch(err => {
      console.warn('achievementsApi: background refresh failed', err)
    })

    return {
      data: cache.data,
      fromCache: true,
      etag: cache.etag,
    }
  }

  logAchievements('Making HTTP request to server')

  const url = buildApiUrl(
    `/api/users/me/achievements?limit=${limit}&offset=${offset}&summary=${summary}`
  )

  const response = await httpRequest<UserAchievementsResponse>(url, {
    version: cache?.etag,
    credentials: 'include',
    headers: authHeader(),
  })

  logAchievements('Server response', {
    ok: response.ok,
    notModified: 'notModified' in response ? response.notModified : false,
    hasData: 'data' in response && !!response.data,
  })

  if (!response.ok) {
    logAchievements('Request failed, returning cache or empty')
    // При ошибке - вернуть кэш если есть (даже если stale)
    if (cache) {
      return { data: cache.data, fromCache: true, etag: cache.etag }
    }
    // Вернуть пустые данные
    return {
      data: {
        achievements: [],
        total: 0,
        hasMore: false,
        totalUnlocked: 0,
        generatedAt: new Date().toISOString(),
      },
      fromCache: false,
    }
  }

  if ('notModified' in response && response.notModified) {
    logAchievements('Server returned 304 Not Modified')
    // Сервер вернул 304 - данные не изменились, обновить TTL
    if (cache && cache.data && cache.data.achievements && cache.data.achievements.length > 0) {
      const updatedNow = Date.now()
      setCachedAchievements(cacheKey, {
        ...cache,
        expiresAt: updatedNow + ACHIEVEMENTS_TTL_MS,
        staleUntil: updatedNow + ACHIEVEMENTS_STALE_MS,
        lastAccess: updatedNow,
      })
      logAchievements('Using cached data after 304', {
        achievementsCount: cache.data.achievements.length,
        progress: cache.data.achievements.map(a => ({ group: a.group, progress: a.currentProgress })),
      })
      return {
        data: cache.data,
        fromCache: true,
        etag: cache.etag,
      }
    }
    // Кэш пустой или некорректный - нужно очистить его и запросить заново без ETag
    logAchievements('Cache invalid after 304, clearing and refetching without ETag')
    try {
      window.localStorage.removeItem(cacheKey)
    } catch {
      // Ignore localStorage errors
    }
    // Повторный запрос без ETag
    const freshResponse = await httpRequest<UserAchievementsResponse>(url, {
      credentials: 'include',
      headers: authHeader(),
    })
    if (!freshResponse.ok || !('data' in freshResponse)) {
      return {
        data: {
          achievements: [],
          total: 0,
          hasMore: false,
          totalUnlocked: 0,
          generatedAt: new Date().toISOString(),
        },
        fromCache: false,
      }
    }
    const freshData = freshResponse.data
    const freshEtag = freshResponse.version
    const freshNow = Date.now()
    setCachedAchievements(cacheKey, {
      data: freshData,
      etag: freshEtag,
      expiresAt: freshNow + ACHIEVEMENTS_TTL_MS,
      staleUntil: freshNow + ACHIEVEMENTS_STALE_MS,
      lastAccess: freshNow,
    })
    logAchievements('Fetched fresh data after invalid 304 cache', {
      achievementsCount: freshData.achievements.length,
      progress: freshData.achievements.map(a => ({ group: a.group, progress: a.currentProgress })),
    })
    return {
      data: freshData,
      fromCache: false,
      etag: freshEtag,
    }
  }

  // Проверяем что response.data существует
  if (!('data' in response) || !response.data) {
    logAchievements('No data in response')
    return {
      data: {
        achievements: [],
        total: 0,
        hasMore: false,
        totalUnlocked: 0,
        generatedAt: new Date().toISOString(),
      },
      fromCache: false,
    }
  }

  const data = response.data
  const etag = response.version

  logAchievements('Server returned fresh data', {
    achievementsCount: data.achievements.length,
    progress: data.achievements.map(a => ({ group: a.group, progress: a.currentProgress, nextThreshold: a.nextThreshold })),
  })

  const cacheNow = Date.now()
  setCachedAchievements(cacheKey, {
    data,
    etag,
    expiresAt: cacheNow + ACHIEVEMENTS_TTL_MS,
    staleUntil: cacheNow + ACHIEVEMENTS_STALE_MS,
    lastAccess: cacheNow,
  })

  return {
    data,
    fromCache: false,
    etag,
  }
}

/**
 * Отметить награду как показанную (для анимации)
 */
export async function markRewardNotified(rewardId: string): Promise<boolean> {
  const url = buildApiUrl(`/api/users/me/achievements/${rewardId}/mark-notified`)

  try {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        ...authHeader(),
        'Content-Type': 'application/json',
      },
      // Fastify returns 400 if Content-Type is JSON but body is empty.
      // Send an explicit empty JSON object to avoid FST_ERR_CTP_EMPTY_JSON_BODY.
      body: JSON.stringify({}),
    })

    return response.ok
  } catch {
    return false
  }
}

// Оставляем старый API для обратной совместимости
interface LegacyCachedAchievements {
  data: UserAchievementsSummary
  etag?: string
  expiresAt: number
  staleUntil: number
  lastAccess: number
}

const LEGACY_CACHE_KEY = 'achievements:my:v1'

function getLegacyCachedAchievements(): LegacyCachedAchievements | null {
  try {
    if (typeof window === 'undefined') return null
    const item = window.localStorage.getItem(LEGACY_CACHE_KEY)
    if (!item) return null
    return JSON.parse(item) as LegacyCachedAchievements
  } catch {
    return null
  }
}

function setLegacyCachedAchievements(cache: LegacyCachedAchievements): void {
  try {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(LEGACY_CACHE_KEY, JSON.stringify(cache))
  } catch (err) {
    console.warn('Failed to cache achievements:', err)
  }
}

export interface LegacyAchievementsResult {
  data: UserAchievementsSummary
  fromCache: boolean
  etag?: string
}

/**
 * Получить достижения текущего пользователя (устаревший API для обратной совместимости)
 * SWR: возвращает закэшированные данные мгновенно, обновляет в фоне если устарели
 */
export async function fetchMyAchievements(options: { force?: boolean } = {}): Promise<LegacyAchievementsResult> {
  const cache = getLegacyCachedAchievements()
  const now = Date.now()

  // Проверка: данные свежие
  const isFresh = cache && cache.expiresAt > now
  // Проверка: данные устаревшие, но ещё можно показать (SWR)
  const isStale = cache && cache.staleUntil > now && cache.expiresAt <= now

  // Если force=false и данные свежие - вернуть из кэша
  if (!options.force && isFresh) {
    return {
      data: cache.data,
      fromCache: true,
      etag: cache.etag,
    }
  }

  // Если данные устаревшие, но показываемые - запустить фоновое обновление и вернуть старые данные
  if (!options.force && isStale) {
    // Фоновое обновление (не блокируем)
    fetchMyAchievements({ force: true }).catch(err => {
      console.warn('achievementsApi: background refresh failed', err)
    })

    return {
      data: cache.data,
      fromCache: true,
      etag: cache.etag,
    }
  }

  const response = await httpRequest<UserAchievementsSummary>(
    buildApiUrl('/api/users/me/achievements'),
    {
      version: cache?.etag,
      credentials: 'include',
      headers: authHeader(),
    }
  )

  if (!response.ok) {
    // При ошибке - вернуть кэш если есть (даже если stale)
    if (cache) {
      return { data: cache.data, fromCache: true, etag: cache.etag }
    }
    // Вернуть пустые данные
    return {
      data: {
        achievements: [],
        totalUnlocked: 0,
        generatedAt: new Date().toISOString(),
      },
      fromCache: false,
    }
  }

  if ('notModified' in response && response.notModified) {
    // Сервер вернул 304 - данные не изменились, обновить TTL
    if (cache) {
      const updatedNow = Date.now()
      setLegacyCachedAchievements({
        ...cache,
        expiresAt: updatedNow + ACHIEVEMENTS_TTL_MS,
        staleUntil: updatedNow + ACHIEVEMENTS_STALE_MS,
        lastAccess: updatedNow,
      })
      return {
        data: cache.data,
        fromCache: true,
        etag: cache.etag,
      }
    }
  }

  // После проверки notModified гарантированно имеем ApiSuccess
  if (!('data' in response)) {
    // Fallback - не должно случиться но для TypeScript
    return {
      data: {
        achievements: [],
        totalUnlocked: 0,
        generatedAt: new Date().toISOString(),
      },
      fromCache: false,
    }
  }

  const data = response.data
  const etag = response.version

  const cacheNow = Date.now()
  setLegacyCachedAchievements({
    data,
    etag,
    expiresAt: cacheNow + ACHIEVEMENTS_TTL_MS,
    staleUntil: cacheNow + ACHIEVEMENTS_STALE_MS,
    lastAccess: cacheNow,
  })

  return {
    data,
    fromCache: false,
    etag,
  }
}

/**
 * Инвалидация кэша достижений (для вызова после изменения прогресса)
 */
export function invalidateAchievementsCache(): void {
  logAchievements('Invalidating achievements cache')
  try {
    if (typeof window === 'undefined') return
    // Удаляем все ключи кэша достижений
    const keys = Object.keys(window.localStorage)
    let removedCount = 0
    for (const key of keys) {
      if (key.startsWith('achievements:my:')) {
        window.localStorage.removeItem(key)
        removedCount++
      }
    }
    logAchievements(`Removed ${removedCount} cache keys`)
  } catch (err) {
    console.warn('Failed to invalidate achievements cache:', err)
  }
}
