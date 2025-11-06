import type { ActivePredictionMatch, UserPredictionEntry } from '@shared/types'
import { buildApiUrl, httpRequest } from './httpClient'

const ACTIVE_CACHE_KEY = (days: number) => `predictions:active:v2:${days}`
const MY_CACHE_KEY = 'predictions:my:v2'
const CACHE_INDEX_KEY = 'predictions:cache-index:v2'

// TTL увеличены под Render.com Free tier - данные меняются редко (после финализации матчей)
const ACTIVE_TTL_MS = 60_000 // 1 минута - свежие данные
const ACTIVE_STALE_MS = 300_000 // 5 минут - устаревшие, но показываем (SWR)
const MY_TTL_MS = 300_000 // 5 минут - свежие данные
const MY_STALE_MS = 900_000 // 15 минут - устаревшие, но показываем (SWR)

// Дедупликация запросов (in-flight requests)
const inflightRequests = new Map<string, Promise<ActivePredictionsResult | MyPredictionsResult>>()

// Лимиты кэша
const MAX_ACTIVE_CACHE_ENTRIES = 10 // максимум 10 различных days-комбинаций
const MAX_TOTAL_CACHE_SIZE = 50 // максимум 50 записей всего

type CacheEntry<T> = {
  data: T
  etag?: string
  expiresAt: number // время когда данные становятся устаревшими
  staleUntil: number // время когда данные удаляются совсем
  lastAccess: number // для LRU
}

type SubmitPayload = {
  ok: boolean
  data?: UserPredictionEntry
  error?: string
  meta?: {
    created?: boolean
  }
}

type FetchOptions = {
  days?: number
  force?: boolean
}

type CacheIndex = {
  keys: string[]
  totalSize: number
  lastCleanup: number
}

const readCacheIndex = (): CacheIndex => {
  if (typeof window === 'undefined') return { keys: [], totalSize: 0, lastCleanup: Date.now() }
  try {
    const raw = window.localStorage.getItem(CACHE_INDEX_KEY)
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
    window.localStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(index))
  } catch (err) {
    console.warn('predictionsApi: failed to write cache index', err)
  }
}

const readCache = <T>(key: string): CacheEntry<T> | null => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CacheEntry<T>
    if (!parsed || typeof parsed !== 'object') return null
    
    // Обновить lastAccess для LRU
    const updated: CacheEntry<T> = {
      ...parsed,
      lastAccess: Date.now(),
    }
    writeCache(key, updated, true) // skipIndexUpdate = true чтобы избежать рекурсии
    
    return updated
  } catch (err) {
    console.warn('predictionsApi: failed to read cache', err)
    return null
  }
}

const writeCache = <T>(key: string, entry: CacheEntry<T>, skipIndexUpdate = false) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(entry))
    
    if (!skipIndexUpdate) {
      // Обновить индекс
      const index = readCacheIndex()
      if (!index.keys.includes(key)) {
        index.keys.push(key)
        index.totalSize = index.keys.length
      }
      
      // Проверить лимиты и очистить старые записи
      cleanupCacheIfNeeded(index)
      writeCacheIndex(index)
    }
  } catch (err) {
    console.warn('predictionsApi: failed to write cache', err)
    // Попытка очистки при переполнении
    if (err instanceof Error && err.name === 'QuotaExceededError') {
      const index = readCacheIndex()
      cleanupCache(index, MAX_TOTAL_CACHE_SIZE / 2) // Агрессивная очистка
      writeCacheIndex(index)
    }
  }
}

const cleanupCacheIfNeeded = (index: CacheIndex) => {
  const now = Date.now()
  const ONE_HOUR = 3600_000
  
  // Чистим не чаще раза в час
  if (now - index.lastCleanup < ONE_HOUR && index.totalSize < MAX_TOTAL_CACHE_SIZE) {
    return
  }
  
  cleanupCache(index, MAX_TOTAL_CACHE_SIZE)
  index.lastCleanup = now
}

const cleanupCache = (index: CacheIndex, maxSize: number) => {
  if (typeof window === 'undefined') return
  
  const now = Date.now()
  const entries: Array<{ key: string; entry: CacheEntry<unknown> | null }> = []
  
  // Собрать все записи
  for (const key of index.keys) {
    try {
      const raw = window.localStorage.getItem(key)
      if (!raw) continue
      const entry = JSON.parse(raw) as CacheEntry<unknown>
      entries.push({ key, entry })
    } catch (err) {
      // Удалить битую запись
      window.localStorage.removeItem(key)
    }
  }
  
  // Удалить полностью устаревшие
  const validEntries = entries.filter(({ key, entry }) => {
    if (!entry || now > entry.staleUntil) {
      window.localStorage.removeItem(key)
      return false
    }
    return true
  })
  
  // Если всё ещё превышаем лимит - удалить по LRU
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
    // Инвалидировать весь кэш прогнозов
    for (const key of index.keys) {
      window.localStorage.removeItem(key)
    }
    index.keys = []
    index.totalSize = 0
  } else {
    // Инвалидировать по паттерну
    const toRemove = index.keys.filter(key => key.includes(keyPattern))
    for (const key of toRemove) {
      window.localStorage.removeItem(key)
    }
    index.keys = index.keys.filter(key => !key.includes(keyPattern))
    index.totalSize = index.keys.length
  }
  
  writeCacheIndex(index)
}

const updateMyCacheWithEntry = (entry: UserPredictionEntry) => {
  const cache = readCache<UserPredictionEntry[]>(MY_CACHE_KEY)
  const base = cache?.data ?? []
  const next: UserPredictionEntry[] = [...base]
  const matchIndex = next.findIndex(candidate => {
    if (candidate.id === entry.id) {
      return true
    }
    if (candidate.templateId && entry.templateId) {
      return candidate.templateId === entry.templateId
    }
    return false
  })

  if (matchIndex >= 0) {
    next[matchIndex] = entry
  } else {
    next.unshift(entry)
  }

  const now = Date.now()
  writeCache(MY_CACHE_KEY, {
    data: next,
    etag: undefined,
    expiresAt: now + MY_TTL_MS,
    staleUntil: now + MY_STALE_MS,
    lastAccess: now,
  })
}

const ACTIVE_PATH = '/api/predictions/active'
const MY_PATH = '/api/predictions/my'

const buildActivePath = (days: number) => `${ACTIVE_PATH}?days=${encodeURIComponent(days)}`

const buildSubmitUrl = (templateId: string) =>
  buildApiUrl(`/api/predictions/templates/${encodeURIComponent(templateId)}/entry`)

export type ActivePredictionsResult = {
  data: ActivePredictionMatch[]
  fromCache: boolean
  etag?: string
}

export type MyPredictionsResult = {
  data: UserPredictionEntry[]
  fromCache: boolean
  etag?: string
  unauthorized?: boolean
}

export type SubmitPredictionResult = {
  ok: boolean
  data?: UserPredictionEntry
  created?: boolean
  error?: string
  unauthorized?: boolean
  conflict?: boolean
  validationError?: string
}

export const fetchActivePredictions = async (
  options: FetchOptions = {}
): Promise<ActivePredictionsResult> => {
  const days = options.days ?? 6
  const cacheKey = ACTIVE_CACHE_KEY(days)
  const cache = readCache<ActivePredictionMatch[]>(cacheKey)
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
    fetchActivePredictions({ ...options, force: true }).catch(err => {
      console.warn('predictionsApi: background refresh failed', err)
    })
    
    return {
      data: cache.data,
      fromCache: true,
      etag: cache.etag,
    }
  }

  // Дедупликация: проверяем наличие активного запроса
  const inflightKey = `active:${days}:${options.force ? 'force' : 'auto'}`
  const existing = inflightRequests.get(inflightKey)
  if (existing) {
    return existing as Promise<ActivePredictionsResult>
  }

  // Создаём новый запрос и сохраняем в инфлайт
  const requestPromise = (async (): Promise<ActivePredictionsResult> => {
    try {
      const response = await httpRequest<ActivePredictionMatch[]>(buildActivePath(days), {
        version: cache?.etag,
        credentials: 'include',
      })

      if (!response.ok) {
        // При ошибке - вернуть кэш если есть (даже если stale)
        if (cache) {
          return { data: cache.data, fromCache: true, etag: cache.etag }
        }
        return { data: [], fromCache: false }
      }

      if ('notModified' in response && response.notModified) {
        // Сервер вернул 304 - данные не изменились, обновить TTL
        if (cache) {
          const updatedNow = Date.now()
          writeCache(cacheKey, {
            ...cache,
            expiresAt: updatedNow + ACTIVE_TTL_MS,
            staleUntil: updatedNow + ACTIVE_STALE_MS,
            lastAccess: updatedNow,
          })
          return {
            data: cache.data,
            fromCache: true,
            etag: cache.etag,
          }
        }
        return { data: [], fromCache: false }
      }

      const data = Array.isArray(response.data) ? response.data : []
      const etag = response.version

      const cacheNow = Date.now()
      writeCache(cacheKey, {
        data,
        etag,
        expiresAt: cacheNow + ACTIVE_TTL_MS,
        staleUntil: cacheNow + ACTIVE_STALE_MS,
        lastAccess: cacheNow,
      })

      return {
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

export const submitPrediction = async (
  templateId: string,
  selection: string
): Promise<SubmitPredictionResult> => {
  const token =
    typeof window !== 'undefined' ? window.localStorage.getItem('session') ?? undefined : undefined

  if (!token) {
    return {
      ok: false,
      unauthorized: true,
      error: 'no_token',
    }
  }

  const response = await fetch(buildSubmitUrl(templateId), {
    method: 'POST',
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ selection }),
  })

  if (response.status === 401) {
    return {
      ok: false,
      unauthorized: true,
      error: 'unauthorized',
    }
  }

  if (response.status === 409) {
    const payload = (await response.json().catch(() => null)) as SubmitPayload | null
    return {
      ok: false,
      conflict: true,
      error: payload?.error ?? 'conflict',
    }
  }

  if (response.status === 400) {
    const payload = (await response.json().catch(() => null)) as SubmitPayload | null
    return {
      ok: false,
      validationError: payload?.error ?? 'bad_request',
      error: payload?.error ?? 'bad_request',
    }
  }

  if (!response.ok) {
    return {
      ok: false,
      error: 'unknown_error',
    }
  }

  const payload = (await response.json()) as SubmitPayload
  if (!payload?.data) {
    return {
      ok: false,
      error: payload?.error ?? 'invalid_response',
    }
  }

  // Обновить кэш "моих прогнозов"
  updateMyCacheWithEntry(payload.data)
  
  // Инвалидировать кэш активных прогнозов (т.к. изменилось состояние)
  invalidateCache('predictions:active')

  return {
    ok: true,
    data: payload.data,
    created: Boolean(payload.meta?.created),
  }
}

export const fetchMyPredictions = async (options: FetchOptions = {}): Promise<MyPredictionsResult> => {
  const cache = readCache<UserPredictionEntry[]>(MY_CACHE_KEY)
  const now = Date.now()

  const token =
    typeof window !== 'undefined' ? window.localStorage.getItem('session') ?? undefined : undefined

  if (!token) {
    return {
      data: [],
      fromCache: false,
      unauthorized: true,
    }
  }

  // Проверка: данные свежие
  const isFresh = cache && cache.expiresAt > now
  // Проверка: данные устаревшие, но ещё можно показать (SWR)
  const isStale = cache && cache.staleUntil > now && cache.expiresAt <= now

  if (!options.force && isFresh) {
    return {
      data: cache.data,
      fromCache: true,
      etag: cache.etag,
      unauthorized: false,
    }
  }

  // SWR: показать старые данные и обновить в фоне
  if (!options.force && isStale) {
    fetchMyPredictions({ ...options, force: true }).catch(err => {
      console.warn('predictionsApi: background refresh (my) failed', err)
    })
    
    return {
      data: cache.data,
      fromCache: true,
      etag: cache.etag,
      unauthorized: false,
    }
  }

  const response = await httpRequest<UserPredictionEntry[]>(MY_PATH, {
    version: cache?.etag,
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      return {
        data: [],
        fromCache: false,
        unauthorized: true,
      }
    }

    // При ошибке - вернуть кэш если есть
    if (cache) {
      return { data: cache.data, fromCache: true, etag: cache.etag, unauthorized: false }
    }
    return { data: [], fromCache: false }
  }

  if ('notModified' in response && response.notModified) {
    if (cache) {
      const updatedNow = Date.now()
      writeCache(MY_CACHE_KEY, {
        ...cache,
        expiresAt: updatedNow + MY_TTL_MS,
        staleUntil: updatedNow + MY_STALE_MS,
        lastAccess: updatedNow,
      })
      return {
        data: cache.data,
        fromCache: true,
        etag: cache.etag,
        unauthorized: false,
      }
    }
    return { data: [], fromCache: false }
  }

  const data = Array.isArray(response.data) ? response.data : []
  const etag = response.version

  const cacheNow = Date.now()
  writeCache(MY_CACHE_KEY, {
    data,
    etag,
    expiresAt: cacheNow + MY_TTL_MS,
    staleUntil: cacheNow + MY_STALE_MS,
    lastAccess: cacheNow,
  })

  return {
    data,
    fromCache: false,
    etag,
    unauthorized: false,
  }
}

// Экспортировать функцию инвалидации для использования извне
export const invalidatePredictionsCache = invalidateCache
