import type { UserCardExtraView } from '@shared/types'
import { buildApiUrl, httpRequest } from './httpClient'
import type { ApiResponse } from './httpClient'

const FRESH_TTL_MS = 60_000
const STALE_TTL_MS = 300_000
const PREFETCH_DEBOUNCE_MS = 300
const PREFETCH_LIMIT_PER_MINUTE = 5

export type UserCardExtraSuccess = {
  ok: true
  data: UserCardExtraView
  fromCache: boolean
  etag?: string
}

export type UserCardExtraError = {
  ok: false
  error: string
}

export type UserCardExtraResult = UserCardExtraSuccess | UserCardExtraError

type CacheEntry = {
  data: UserCardExtraView
  etag?: string
  expiresAt: number
  staleUntil: number
}

const memoryCache = new Map<number, CacheEntry>()
const inflightRequests = new Map<number, Promise<UserCardExtraResult>>()
const prefetchTimers = new Map<number, number>()
const prefetchTimestamps: number[] = []

const getCacheState = (userId: number) => {
  const entry = memoryCache.get(userId)
  if (!entry) return null
  const now = Date.now()
  if (entry.expiresAt > now) return { state: 'fresh' as const, entry }
  if (entry.staleUntil > now) return { state: 'stale' as const, entry }
  return null
}

const saveToCache = (userId: number, data: UserCardExtraView, etag?: string) => {
  const now = Date.now()
  memoryCache.set(userId, {
    data,
    etag,
    expiresAt: now + FRESH_TTL_MS,
    staleUntil: now + STALE_TTL_MS,
  })
}

const toResult = (
  response: ApiResponse<UserCardExtraView>,
  userId: number,
  cached?: CacheEntry
): UserCardExtraResult => {
  const now = Date.now()

  if ('notModified' in response && response.notModified) {
    if (!cached) {
      return { ok: false, error: 'not_modified_without_cache' }
    }
    memoryCache.set(userId, {
      ...cached,
      expiresAt: now + FRESH_TTL_MS,
      staleUntil: now + STALE_TTL_MS,
    })
    return { ok: true, data: cached.data, fromCache: true, etag: cached.etag }
  }

  if (!response.ok || !('data' in response)) {
    return { ok: false, error: response.error ?? 'request_failed' }
  }

  const etag = response.version
  saveToCache(userId, response.data, etag)
  return { ok: true, data: response.data, fromCache: false, etag }
}

export const fetchUserCardExtra = async (
  userId: number,
  options: { force?: boolean } = {}
): Promise<UserCardExtraResult> => {
  if (!Number.isFinite(userId) || userId <= 0) {
    return { ok: false, error: 'invalid_user_id' }
  }

  const cacheState = getCacheState(userId)

  if (!options.force && cacheState?.state === 'fresh') {
    return { ok: true, data: cacheState.entry.data, fromCache: true, etag: cacheState.entry.etag }
  }

  if (!options.force && cacheState?.state === 'stale') {
    void fetchUserCardExtra(userId, { force: true })
    return { ok: true, data: cacheState.entry.data, fromCache: true, etag: cacheState.entry.etag }
  }

  const existing = inflightRequests.get(userId)
  if (existing) {
    return existing
  }

  const cached = cacheState?.entry
  const promise = (async () => {
    const response = await httpRequest<UserCardExtraView>(
      buildApiUrl(`/api/users/${userId}/card-extra`),
      {
        version: cached?.etag,
      }
    )

    const result = toResult(response, userId, cached)
    return result
  })()

  inflightRequests.set(userId, promise)

  try {
    const result = await promise
    return result
  } finally {
    inflightRequests.delete(userId)
  }
}

export const prefetchUserCardExtra = (userId: number) => {
  if (typeof window === 'undefined') return
  if (!Number.isFinite(userId) || userId <= 0) return
  if (!window.matchMedia || !window.matchMedia('(hover: hover)').matches) return

  const cacheState = getCacheState(userId)
  if (cacheState?.state === 'fresh') return
  if (inflightRequests.has(userId)) return
  if (prefetchTimers.has(userId)) return

  const now = Date.now()
  while (prefetchTimestamps.length && now - prefetchTimestamps[0] > 60_000) {
    prefetchTimestamps.shift()
  }
  if (prefetchTimestamps.length >= PREFETCH_LIMIT_PER_MINUTE) return

  const timerId = window.setTimeout(() => {
    prefetchTimers.delete(userId)
    prefetchTimestamps.push(Date.now())
    void fetchUserCardExtra(userId).catch(() => undefined)
  }, PREFETCH_DEBOUNCE_MS)

  prefetchTimers.set(userId, timerId)
}
