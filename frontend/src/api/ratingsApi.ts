import type {
  RatingLeaderboardResponse,
  RatingScopeKey,
  UserRatingSummary,
} from '@shared/types'
import { httpRequest } from './httpClient'

type LeaderboardOptions = {
  page?: number
  pageSize?: number
  force?: boolean
}

const RATING_CACHE_KEY = (scope: RatingScopeKey, page: number, pageSize: number) => 
  `ratings:v2:${scope}:p${page}:s${pageSize}`
const MY_RATING_CACHE_KEY = 'ratings:my:v2'
const RATING_CACHE_INDEX_KEY = 'ratings:cache-index:v2'

// TTL увеличены под Render.com Free tier - рейтинги меняются только после финализации матчей
const RATING_TTL_MS = 120_000 // 2 минуты - свежие данные
const RATING_STALE_MS = 600_000 // 10 минут - устаревшие, но показываем (SWR)
const MY_RATING_TTL_MS = 300_000 // 5 минут - свежие данные
const MY_RATING_STALE_MS = 900_000 // 15 минут - устаревшие, но показываем (SWR)

// Дедупликация запросов (in-flight requests)
const inflightRequests = new Map<string, Promise<any>>()

// Лимиты кэша
const MAX_RATING_CACHE_ENTRIES = 10 // максимум 10 различных комбинаций

type CacheEntry<T> = {
  data: T
  etag?: string
  expiresAt: number
  staleUntil: number
  lastAccess: number
}

type CacheIndex = {
  keys: string[]
  totalSize: number
  lastCleanup: number
}

const readCacheIndex = (): CacheIndex => {
  if (typeof window === 'undefined') return { keys: [], totalSize: 0, lastCleanup: Date.now() }
  try {
    const raw = window.localStorage.getItem(RATING_CACHE_INDEX_KEY)
    if (!raw) return { keys: [], totalSize: 0, lastCleanup: Date.now() }
    const parsed = JSON.parse(raw) as CacheIndex
    return parsed ?? { keys: [], totalSize: 0, lastCleanup: Date.now() }
  } catch (err) {
    return { keys: [], totalSize: 0, lastCleanup: Date.now() }
  }
}

const writeCacheIndex = (index: CacheIndex) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(RATING_CACHE_INDEX_KEY, JSON.stringify(index))
  } catch (err) {
    console.warn('ratingsApi: failed to write cache index', err)
  }
}

const readCache = <T>(key: string): CacheEntry<T> | null => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CacheEntry<T>
    if (!parsed || typeof parsed !== 'object') return null
    
    const updated: CacheEntry<T> = {
      ...parsed,
      lastAccess: Date.now(),
    }
    writeCache(key, updated, true)
    
    return updated
  } catch (err) {
    console.warn('ratingsApi: failed to read cache', err)
    return null
  }
}

const writeCache = <T>(key: string, entry: CacheEntry<T>, skipIndexUpdate = false) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(entry))
    
    if (!skipIndexUpdate) {
      const index = readCacheIndex()
      if (!index.keys.includes(key)) {
        index.keys.push(key)
        index.totalSize = index.keys.length
      }
      
      cleanupCacheIfNeeded(index)
      writeCacheIndex(index)
    }
  } catch (err) {
    console.warn('ratingsApi: failed to write cache', err)
    if (err instanceof Error && err.name === 'QuotaExceededError') {
      const index = readCacheIndex()
      cleanupCache(index, MAX_RATING_CACHE_ENTRIES / 2)
      writeCacheIndex(index)
    }
  }
}

const cleanupCacheIfNeeded = (index: CacheIndex) => {
  const now = Date.now()
  const ONE_HOUR = 3600_000
  
  if (now - index.lastCleanup < ONE_HOUR && index.totalSize < MAX_RATING_CACHE_ENTRIES) {
    return
  }
  
  cleanupCache(index, MAX_RATING_CACHE_ENTRIES)
  index.lastCleanup = now
}

const cleanupCache = (index: CacheIndex, maxSize: number) => {
  if (typeof window === 'undefined') return
  
  const now = Date.now()
  const entries: Array<{ key: string; entry: CacheEntry<unknown> | null }> = []
  
  for (const key of index.keys) {
    try {
      const raw = window.localStorage.getItem(key)
      if (!raw) continue
      const entry = JSON.parse(raw) as CacheEntry<unknown>
      entries.push({ key, entry })
    } catch (err) {
      window.localStorage.removeItem(key)
    }
  }
  
  const validEntries = entries.filter(({ key, entry }) => {
    if (!entry || now > entry.staleUntil) {
      window.localStorage.removeItem(key)
      return false
    }
    return true
  })
  
  if (validEntries.length > maxSize) {
    validEntries.sort((a, b) => (a.entry?.lastAccess ?? 0) - (b.entry?.lastAccess ?? 0))
    const toRemove = validEntries.slice(0, validEntries.length - maxSize)
    for (const { key } of toRemove) {
      window.localStorage.removeItem(key)
    }
    index.keys = validEntries.slice(validEntries.length - maxSize).map(e => e.key)
  } else {
    index.keys = validEntries.map(e => e.key)
  }
  
  index.totalSize = index.keys.length
}

const invalidateCache = (keyPattern?: string) => {
  if (typeof window === 'undefined') return
  const index = readCacheIndex()
  
  if (!keyPattern) {
    for (const key of index.keys) {
      window.localStorage.removeItem(key)
    }
    index.keys = []
    index.totalSize = 0
  } else {
    const toRemove = index.keys.filter(key => key.includes(keyPattern))
    for (const key of toRemove) {
      window.localStorage.removeItem(key)
    }
    index.keys = index.keys.filter(key => !key.includes(keyPattern))
    index.totalSize = index.keys.length
  }
  
  writeCacheIndex(index)
}

const buildQueryString = (params: Record<string, string | number | undefined>): string => {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined) {
      return
    }
    query.set(key, String(value))
  })
  const serialized = query.toString()
  return serialized.length ? `?${serialized}` : ''
}

export async function fetchRatingLeaderboard(
  scope: RatingScopeKey,
  options: LeaderboardOptions = {}
) {
  const page = options.page ?? 1
  const pageSize = options.pageSize ?? 20
  const cacheKey = RATING_CACHE_KEY(scope, page, pageSize)
  const cache = readCache<RatingLeaderboardResponse>(cacheKey)
  const now = Date.now()

  const isFresh = cache && cache.expiresAt > now
  const isStale = cache && cache.staleUntil > now && cache.expiresAt <= now

  if (!options.force && isFresh) {
    return {
      ok: true as const,
      data: cache.data,
      fromCache: true,
      etag: cache.etag,
    }
  }

  if (!options.force && isStale) {
    fetchRatingLeaderboard(scope, { ...options, force: true }).catch(err => {
      console.warn('ratingsApi: background refresh failed', err)
    })
    
    return {
      ok: true as const,
      data: cache.data,
      fromCache: true,
      etag: cache.etag,
    }
  }

  // Дедупликация: проверяем наличие активного запроса
  const inflightKey = `leaderboard:${scope}:${page}:${pageSize}:${options.force ? 'force' : 'auto'}`
  const existing = inflightRequests.get(inflightKey)
  if (existing) {
    return existing
  }

  // Создаём новый запрос и сохраняем в инфлайт
  const requestPromise = (async () => {
    try {
      const query = buildQueryString({
        scope,
        page,
        pageSize,
      })

      // Логирование для диагностики
      if (cache?.etag) {
        console.log('[ratingsApi] Sending request with ETag:', cache.etag)
      } else {
        console.log('[ratingsApi] Sending request WITHOUT ETag (cache:', cache ? 'exists' : 'none', ')')
      }

      const response = await httpRequest<RatingLeaderboardResponse>(`/api/ratings${query}`, { 
        version: cache?.etag,
      })

      console.log('[ratingsApi] Response:', response.ok ? (('notModified' in response && response.notModified) ? '304 Not Modified' : '200 OK') : 'Error')

      if (!response.ok) {
        if (cache) {
          return {
            ok: true as const,
            data: cache.data,
            fromCache: true,
            etag: cache.etag,
          }
        }
        return {
          ok: false as const,
          error: response.error,
        }
      }

      if ('notModified' in response && response.notModified) {
        if (cache) {
          const updatedNow = Date.now()
          writeCache(cacheKey, {
            ...cache,
            expiresAt: updatedNow + RATING_TTL_MS,
            staleUntil: updatedNow + RATING_STALE_MS,
            lastAccess: updatedNow,
          })
          return {
            ok: true as const,
            data: cache.data,
            fromCache: true,
            etag: cache.etag,
          }
        }
        return {
          ok: false as const,
          error: 'not_modified_but_no_cache',
        }
      }

      const data = response.data
      const etag = response.version

      console.log('[ratingsApi] Saving to cache with ETag:', etag)

      const cacheNow = Date.now()
      writeCache(cacheKey, {
        data,
        etag,
        expiresAt: cacheNow + RATING_TTL_MS,
        staleUntil: cacheNow + RATING_STALE_MS,
        lastAccess: cacheNow,
      })

      return {
        ok: true as const,
        data,
        fromCache: false,
        etag,
      }
    } finally {
      // Удаляем запрос из инфлайт после завершения
      inflightRequests.delete(inflightKey)
    }
  })()

  inflightRequests.set(inflightKey, requestPromise)
  return requestPromise
}

export async function fetchMyRating(options: { force?: boolean } = {}) {
  const cache = readCache<UserRatingSummary>(MY_RATING_CACHE_KEY)
  const now = Date.now()

  const isFresh = cache && cache.expiresAt > now
  const isStale = cache && cache.staleUntil > now && cache.expiresAt <= now

  if (!options.force && isFresh) {
    return {
      ok: true as const,
      data: cache.data,
      fromCache: true,
      etag: cache.etag,
    }
  }

  if (!options.force && isStale) {
    fetchMyRating({ force: true }).catch(err => {
      console.warn('ratingsApi: background refresh (my) failed', err)
    })
    
    return {
      ok: true as const,
      data: cache.data,
      fromCache: true,
      etag: cache.etag,
    }
  }

  const response = await httpRequest<UserRatingSummary>('/api/users/me/rating', { 
    version: cache?.etag,
    credentials: 'include',
  })

  if (!response.ok) {
    if (cache) {
      return {
        ok: true as const,
        data: cache.data,
        fromCache: true,
        etag: cache.etag,
      }
    }
    return {
      ok: false as const,
      error: response.error,
    }
  }

  if ('notModified' in response && response.notModified) {
    if (cache) {
      const updatedNow = Date.now()
      writeCache(MY_RATING_CACHE_KEY, {
        ...cache,
        expiresAt: updatedNow + MY_RATING_TTL_MS,
        staleUntil: updatedNow + MY_RATING_STALE_MS,
        lastAccess: updatedNow,
      })
      return {
        ok: true as const,
        data: cache.data,
        fromCache: true,
        etag: cache.etag,
      }
    }
    return {
      ok: false as const,
      error: 'no_cache_for_304',
    }
  }

  const cacheNow = Date.now()
  writeCache(MY_RATING_CACHE_KEY, {
    data: response.data,
    etag: response.version,
    expiresAt: cacheNow + MY_RATING_TTL_MS,
    staleUntil: cacheNow + MY_RATING_STALE_MS,
    lastAccess: cacheNow,
  })

  return {
    ok: true as const,
    data: response.data,
    fromCache: false,
    etag: response.version,
  }
}

export const invalidateRatingsCache = invalidateCache
