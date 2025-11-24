/**
 * Клиент для API достижений пользователя
 * Поддерживает SWR (Stale-While-Revalidate) кэширование
 */

import { buildApiUrl, httpRequest } from './httpClient'
import { authHeader } from './sessionToken'
import type { UserAchievementsSummary } from '@shared/types'

// TTL для кэша достижений (5m fresh / 15m stale)
const ACHIEVEMENTS_TTL_MS = 5 * 60 * 1000
const ACHIEVEMENTS_STALE_MS = 15 * 60 * 1000

interface CachedAchievements {
  data: UserAchievementsSummary
  etag?: string
  expiresAt: number
  staleUntil: number
  lastAccess: number
}

const CACHE_KEY = 'achievements:my:v1'

function getCachedAchievements(): CachedAchievements | null {
  try {
    if (typeof window === 'undefined') return null
    const item = window.localStorage.getItem(CACHE_KEY)
    if (!item) return null
    return JSON.parse(item) as CachedAchievements
  } catch {
    return null
  }
}

function setCachedAchievements(cache: CachedAchievements): void {
  try {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch (err) {
    console.warn('Failed to cache achievements:', err)
  }
}

/**
 * Результат запроса достижений
 */
export interface AchievementsResult {
  data: UserAchievementsSummary
  fromCache: boolean
  etag?: string
}

/**
 * Получить достижения текущего пользователя
 * SWR: возвращает закэшированные данные мгновенно, обновляет в фоне если устарели
 */
export async function fetchMyAchievements(options: { force?: boolean } = {}): Promise<AchievementsResult> {
  const cache = getCachedAchievements()
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
      setCachedAchievements({
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
  setCachedAchievements({
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
    window.localStorage.removeItem(CACHE_KEY)
  } catch (err) {
    console.warn('Failed to invalidate achievements cache:', err)
  }
}
