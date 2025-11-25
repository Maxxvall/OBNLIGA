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

  // Проверка: данные свежие
  const isFresh = cache && cache.expiresAt > now
  // Проверка: данные устаревшие, но ещё можно показать (SWR)
  const isStale = cache && cache.staleUntil > now && cache.expiresAt <= now

  // Если force=false и данные свежие - вернуть из кэша
  if (!force && isFresh) {
    return {
      data: cache.data,
      fromCache: true,
      etag: cache.etag,
    }
  }

  // Если данные устаревшие, но показываемые - запустить фоновое обновление и вернуть старые данные
  if (!force && isStale) {
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

  const url = buildApiUrl(
    `/api/users/me/achievements?limit=${limit}&offset=${offset}&summary=${summary}`
  )

  const response = await httpRequest<{ data: UserAchievementsResponse }>(url, {
    version: cache?.etag,
    credentials: 'include',
    headers: authHeader(),
  })

  if (!response.ok) {
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
    // Сервер вернул 304 - данные не изменились, обновить TTL
    if (cache) {
      const updatedNow = Date.now()
      setCachedAchievements(cacheKey, {
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

  if (!('data' in response)) {
    // Неожиданный ответ - вернуть кэш или пустые данные
    if (cache) {
      return { data: cache.data, fromCache: true, etag: cache.etag }
    }
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

  const data = response.data.data
  const etag = response.version

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

  const response = await httpRequest<{ data: UserAchievementsSummary }>(
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

  if (!('data' in response)) {
    // Неожиданный ответ - вернуть кэш или пустые данные
    if (cache) {
      return { data: cache.data, fromCache: true, etag: cache.etag }
    }
    return {
      data: {
        achievements: [],
        totalUnlocked: 0,
        generatedAt: new Date().toISOString(),
      },
      fromCache: false,
    }
  }

  const data = response.data.data
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
  try {
    if (typeof window === 'undefined') return
    // Удаляем все ключи кэша достижений
    const keys = Object.keys(window.localStorage)
    for (const key of keys) {
      if (key.startsWith('achievements:my:')) {
        window.localStorage.removeItem(key)
      }
    }
  } catch (err) {
    console.warn('Failed to invalidate achievements cache:', err)
  }
}
