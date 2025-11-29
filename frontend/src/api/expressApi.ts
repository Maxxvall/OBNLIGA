/**
 * API клиент для работы с экспресс-прогнозами
 *
 * Реализует кэширование с SWR (Stale-While-Revalidate) паттерном
 * и дедупликацию запросов.
 */

import type {
  ExpressBetView,
  ExpressConfig,
  ExpressWeekCount,
  CreateExpressItemInput,
} from '@shared/types'
import { buildApiUrl, httpRequest } from './httpClient'

// =================== КОНСТАНТЫ КЭША ===================

const EXPRESS_MY_CACHE_KEY = 'express:my:v1'
const EXPRESS_WEEK_COUNT_CACHE_KEY = 'express:weekCount:v1'
const EXPRESS_CONFIG_CACHE_KEY = 'express:config:v1'
const EXPRESS_CACHE_INDEX_KEY = 'express:cache-index:v1'

// TTL для экспрессов (данные меняются редко)
const MY_TTL_MS = 300_000        // 5 минут - свежие данные
const MY_STALE_MS = 900_000      // 15 минут - устаревшие, но показываем
const WEEK_COUNT_TTL_MS = 60_000 // 1 минута - счётчик чаще меняется
const WEEK_COUNT_STALE_MS = 180_000 // 3 минуты
const CONFIG_TTL_MS = 3600_000   // 1 час - конфиг почти не меняется
const CONFIG_STALE_MS = 86400_000 // 24 часа

// Дедупликация запросов
const inflightRequests = new Map<string, Promise<unknown>>()

// =================== ТИПЫ ===================

type CacheEntry<T> = {
  data: T
  etag?: string
  expiresAt: number
  staleUntil: number
  lastAccess: number
}

type CacheIndex = {
  keys: string[]
  lastCleanup: number
}

type FetchOptions = {
  force?: boolean
}

export type MyExpressesResult = {
  data: ExpressBetView[]
  fromCache: boolean
  etag?: string
  unauthorized?: boolean
}

export type WeekCountResult = {
  data: ExpressWeekCount | null
  fromCache: boolean
  unauthorized?: boolean
}

export type ExpressConfigResult = {
  data: ExpressConfig | null
  fromCache: boolean
}

export type CreateExpressResult = {
  ok: boolean
  data?: ExpressBetView
  error?: string
  unauthorized?: boolean
  validationError?: string
}

// =================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===================

const readCacheIndex = (): CacheIndex => {
  if (typeof window === 'undefined') return { keys: [], lastCleanup: Date.now() }
  try {
    const raw = window.localStorage.getItem(EXPRESS_CACHE_INDEX_KEY)
    if (!raw) return { keys: [], lastCleanup: Date.now() }
    return JSON.parse(raw) as CacheIndex
  } catch {
    return { keys: [], lastCleanup: Date.now() }
  }
}

const writeCacheIndex = (index: CacheIndex) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(EXPRESS_CACHE_INDEX_KEY, JSON.stringify(index))
  } catch (err) {
    console.warn('expressApi: failed to write cache index', err)
  }
}

const readCache = <T>(key: string): CacheEntry<T> | null => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CacheEntry<T>
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

const writeCache = <T>(key: string, entry: CacheEntry<T>) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(entry))

    const index = readCacheIndex()
    if (!index.keys.includes(key)) {
      index.keys.push(key)
    }
    writeCacheIndex(index)
  } catch (err) {
    console.warn('expressApi: failed to write cache', err)
  }
}

const removeCache = (key: string) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(key)
    const index = readCacheIndex()
    index.keys = index.keys.filter(k => k !== key)
    writeCacheIndex(index)
  } catch {
    // игнорируем ошибки
  }
}

const invalidateAllExpressCache = () => {
  if (typeof window === 'undefined') return
  const index = readCacheIndex()
  for (const key of index.keys) {
    window.localStorage.removeItem(key)
  }
  index.keys = []
  writeCacheIndex(index)
}

const getToken = (): string | undefined => {
  if (typeof window === 'undefined') return undefined
  return window.localStorage.getItem('session') ?? undefined
}

// =================== API PATHS ===================

const EXPRESS_BASE = '/api/predictions/express'
const EXPRESS_MY_PATH = `${EXPRESS_BASE}/my`
const EXPRESS_WEEK_COUNT_PATH = `${EXPRESS_BASE}/week-count`
const EXPRESS_CONFIG_PATH = `${EXPRESS_BASE}/config`

// =================== API ФУНКЦИИ ===================

/**
 * Получить список своих экспрессов
 */
export const fetchMyExpresses = async (
  options: FetchOptions = {}
): Promise<MyExpressesResult> => {
  const cache = readCache<ExpressBetView[]>(EXPRESS_MY_CACHE_KEY)
  const now = Date.now()

  const token = getToken()
  if (!token) {
    return { data: [], fromCache: false, unauthorized: true }
  }

  const isFresh = cache && cache.expiresAt > now
  const isStale = cache && cache.staleUntil > now && cache.expiresAt <= now

  if (!options.force && isFresh) {
    return { data: cache.data, fromCache: true, etag: cache.etag }
  }

  if (!options.force && isStale) {
    // SWR: вернуть старые данные и обновить в фоне
    fetchMyExpresses({ force: true }).catch(err => {
      console.warn('expressApi: background refresh (my) failed', err)
    })
    return { data: cache.data, fromCache: true, etag: cache.etag }
  }

  // Дедупликация
  const inflightKey = 'my:expresses'
  const existing = inflightRequests.get(inflightKey) as Promise<MyExpressesResult> | undefined
  if (existing) {
    return existing
  }

  const requestPromise = (async (): Promise<MyExpressesResult> => {
    try {
      const response = await httpRequest<ExpressBetView[]>(EXPRESS_MY_PATH, {
        version: cache?.etag,
        credentials: 'include',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          return { data: [], fromCache: false, unauthorized: true }
        }
        if (cache) {
          return { data: cache.data, fromCache: true, etag: cache.etag }
        }
        return { data: [], fromCache: false }
      }

      if ('notModified' in response && response.notModified) {
        if (cache) {
          const updatedNow = Date.now()
          writeCache(EXPRESS_MY_CACHE_KEY, {
            ...cache,
            expiresAt: updatedNow + MY_TTL_MS,
            staleUntil: updatedNow + MY_STALE_MS,
            lastAccess: updatedNow,
          })
          return { data: cache.data, fromCache: true, etag: cache.etag }
        }
        return { data: [], fromCache: false }
      }

      const data = Array.isArray(response.data) ? response.data : []
      const etag = response.version

      const cacheNow = Date.now()
      writeCache(EXPRESS_MY_CACHE_KEY, {
        data,
        etag,
        expiresAt: cacheNow + MY_TTL_MS,
        staleUntil: cacheNow + MY_STALE_MS,
        lastAccess: cacheNow,
      })

      return { data, fromCache: false, etag }
    } finally {
      inflightRequests.delete(inflightKey)
    }
  })()

  inflightRequests.set(inflightKey, requestPromise)
  return requestPromise
}

/**
 * Получить счётчик экспрессов за неделю
 */
export const fetchWeekCount = async (
  options: FetchOptions = {}
): Promise<WeekCountResult> => {
  const cache = readCache<ExpressWeekCount>(EXPRESS_WEEK_COUNT_CACHE_KEY)
  const now = Date.now()

  const token = getToken()
  if (!token) {
    return { data: null, fromCache: false, unauthorized: true }
  }

  const isFresh = cache && cache.expiresAt > now
  const isStale = cache && cache.staleUntil > now && cache.expiresAt <= now

  if (!options.force && isFresh) {
    return { data: cache.data, fromCache: true }
  }

  if (!options.force && isStale) {
    fetchWeekCount({ force: true }).catch(err => {
      console.warn('expressApi: background refresh (weekCount) failed', err)
    })
    return { data: cache.data, fromCache: true }
  }

  const inflightKey = 'weekCount:expresses'
  const existing = inflightRequests.get(inflightKey) as Promise<WeekCountResult> | undefined
  if (existing) {
    return existing
  }

  const requestPromise = (async (): Promise<WeekCountResult> => {
    try {
      const response = await httpRequest<ExpressWeekCount>(EXPRESS_WEEK_COUNT_PATH, {
        credentials: 'include',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          return { data: null, fromCache: false, unauthorized: true }
        }
        if (cache) {
          return { data: cache.data, fromCache: true }
        }
        return { data: null, fromCache: false }
      }

      const data = response.data ?? null
      const cacheNow = Date.now()

      if (data) {
        writeCache(EXPRESS_WEEK_COUNT_CACHE_KEY, {
          data,
          expiresAt: cacheNow + WEEK_COUNT_TTL_MS,
          staleUntil: cacheNow + WEEK_COUNT_STALE_MS,
          lastAccess: cacheNow,
        })
      }

      return { data, fromCache: false }
    } finally {
      inflightRequests.delete(inflightKey)
    }
  })()

  inflightRequests.set(inflightKey, requestPromise)
  return requestPromise
}

/**
 * Получить конфигурацию экспрессов
 */
export const fetchExpressConfig = async (
  options: FetchOptions = {}
): Promise<ExpressConfigResult> => {
  const cache = readCache<ExpressConfig>(EXPRESS_CONFIG_CACHE_KEY)
  const now = Date.now()

  const isFresh = cache && cache.expiresAt > now
  const isStale = cache && cache.staleUntil > now && cache.expiresAt <= now

  if (!options.force && isFresh) {
    return { data: cache.data, fromCache: true }
  }

  if (!options.force && isStale) {
    fetchExpressConfig({ force: true }).catch(err => {
      console.warn('expressApi: background refresh (config) failed', err)
    })
    return { data: cache.data, fromCache: true }
  }

  const inflightKey = 'config:expresses'
  const existing = inflightRequests.get(inflightKey) as Promise<ExpressConfigResult> | undefined
  if (existing) {
    return existing
  }

  const requestPromise = (async (): Promise<ExpressConfigResult> => {
    try {
      const response = await httpRequest<ExpressConfig>(EXPRESS_CONFIG_PATH, {
        credentials: 'include',
      })

      if (!response.ok) {
        if (cache) {
          return { data: cache.data, fromCache: true }
        }
        return { data: null, fromCache: false }
      }

      const data = response.data ?? null
      const cacheNow = Date.now()

      if (data) {
        writeCache(EXPRESS_CONFIG_CACHE_KEY, {
          data,
          expiresAt: cacheNow + CONFIG_TTL_MS,
          staleUntil: cacheNow + CONFIG_STALE_MS,
          lastAccess: cacheNow,
        })
      }

      return { data, fromCache: false }
    } finally {
      inflightRequests.delete(inflightKey)
    }
  })()

  inflightRequests.set(inflightKey, requestPromise)
  return requestPromise
}

/**
 * Создать экспресс-прогноз
 */
export const createExpress = async (
  items: CreateExpressItemInput[]
): Promise<CreateExpressResult> => {
  const token = getToken()
  if (!token) {
    return { ok: false, unauthorized: true, error: 'no_token' }
  }

  try {
    const response = await fetch(buildApiUrl(EXPRESS_BASE), {
      method: 'POST',
      credentials: 'include',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ items }),
    })

    if (response.status === 401 || response.status === 403) {
      return { ok: false, unauthorized: true, error: 'unauthorized' }
    }

    if (response.status === 400) {
      const payload = await response.json().catch(() => null) as {
        ok?: boolean
        error?: string
      } | null
      return {
        ok: false,
        validationError: payload?.error ?? 'bad_request',
        error: payload?.error ?? 'bad_request',
      }
    }

    if (response.status === 409) {
      const payload = await response.json().catch(() => null) as {
        ok?: boolean
        error?: string
      } | null
      return {
        ok: false,
        validationError: payload?.error ?? 'weekly_limit_reached',
        error: payload?.error ?? 'weekly_limit_reached',
      }
    }

    if (!response.ok) {
      return { ok: false, error: 'unknown_error' }
    }

    const payload = await response.json() as {
      ok: boolean
      data?: ExpressBetView
      error?: string
    }

    if (!payload?.data) {
      return { ok: false, error: payload?.error ?? 'invalid_response' }
    }

    // Инвалидировать кэш после создания
    invalidateMyExpressCache()
    invalidateWeekCountCache()

    return { ok: true, data: payload.data }
  } catch (err) {
    console.error('expressApi: createExpress failed', err)
    return { ok: false, error: 'network_error' }
  }
}

/**
 * Получить экспресс по ID
 */
export const fetchExpressById = async (
  id: string
): Promise<{ data: ExpressBetView | null; error?: string; unauthorized?: boolean }> => {
  const token = getToken()
  if (!token) {
    return { data: null, unauthorized: true, error: 'no_token' }
  }

  try {
    const response = await httpRequest<ExpressBetView>(`${EXPRESS_BASE}/${id}`, {
      credentials: 'include',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { data: null, unauthorized: true }
      }
      if (response.status === 404) {
        return { data: null, error: 'not_found' }
      }
      return { data: null, error: 'unknown_error' }
    }

    return { data: response.data ?? null }
  } catch (err) {
    console.error('expressApi: fetchExpressById failed', err)
    return { data: null, error: 'network_error' }
  }
}

// =================== ИНВАЛИДАЦИЯ КЭША ===================

export const invalidateMyExpressCache = () => {
  removeCache(EXPRESS_MY_CACHE_KEY)
}

export const invalidateWeekCountCache = () => {
  removeCache(EXPRESS_WEEK_COUNT_CACHE_KEY)
}

export const invalidateExpressCache = invalidateAllExpressCache

// =================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ UI ===================

/**
 * Перевод ошибки создания экспресса
 */
export const translateExpressError = (code?: string): string => {
  switch (code) {
  case 'no_token':
  case 'unauthorized':
    return 'Войдите в профиль, чтобы создать экспресс.'
  case 'too_few_items':
    return 'В экспрессе должно быть минимум 2 события.'
  case 'too_many_items':
    return 'В экспрессе максимум 4 события.'
  case 'duplicate_templates':
    return 'В экспрессе нельзя повторять одно событие.'
  case 'same_match_templates':
    return 'События должны быть из разных матчей.'
  case 'template_not_found':
    return 'Событие не найдено или уже недоступно.'
  case 'match_locked':
    return 'Один из матчей уже начался.'
  case 'invalid_selection':
    return 'Некорректный выбор для одного из событий.'
  case 'weekly_limit_reached':
    return 'Достигнут лимит 2 экспресса за 6 дней.'
  default:
    return 'Не удалось создать экспресс. Попробуйте позже.'
  }
}

/**
 * Получить множитель для количества событий
 */
export const getMultiplierForItemCount = (
  count: number,
  config?: ExpressConfig | null
): number => {
  if (config?.multipliers) {
    return config.multipliers[count] ?? 1
  }
  // Дефолтные множители
  const defaults: Record<number, number> = {
    2: 1.2,
    3: 1.5,
    4: 2.5,
  }
  return defaults[count] ?? 1
}

/**
 * Форматирование множителя для отображения
 */
export const formatMultiplier = (multiplier: number): string => {
  return `×${multiplier.toFixed(1)}`
}
