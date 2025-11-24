import { buildApiUrl, httpRequest } from './httpClient'
import { authHeader } from './sessionToken'
import type { ApiResponse } from './httpClient'
import type { DailyRewardClaimResponse, DailyRewardSummary } from '@shared/types'

const CACHE_KEY = 'daily-reward-summary:v1'
const FRESH_TTL_MS = 60 * 1000
const STALE_TTL_MS = 10 * 60 * 1000

type CachedReward = {
  data: DailyRewardSummary
  etag?: string
  expiresAt: number
  staleUntil: number
}

const readCache = (): CachedReward | null => {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as CachedReward
  } catch (err) {
    console.warn('dailyRewardApi: failed to read cache', err)
    return null
  }
}

const writeCache = (payload: CachedReward) => {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(payload))
  } catch (err) {
    console.warn('dailyRewardApi: failed to write cache', err)
  }
}

const clearCache = () => {
  try {
    window.localStorage.removeItem(CACHE_KEY)
  } catch (err) {
    console.warn('dailyRewardApi: failed to clear cache', err)
  }
}

const hasData = <T>(response: ApiResponse<T>): response is Extract<ApiResponse<T>, { data: T }> => {
  return 'data' in response
}

export const fetchDailyRewardSummary = async (options: { force?: boolean } = {}) => {
  if (typeof window === 'undefined') {
    return { data: null, fromCache: false as const }
  }

  const cache = readCache()
  const now = Date.now()

  if (!options.force && cache && cache.expiresAt > now) {
    return { data: cache.data, fromCache: true as const, etag: cache.etag }
  }

  if (!options.force && cache && cache.staleUntil > now) {
    void fetchDailyRewardSummary({ force: true })
    return { data: cache.data, fromCache: true as const, etag: cache.etag }
  }

  const response = await httpRequest<DailyRewardSummary>(buildApiUrl('/api/users/me/daily-reward'), {
    version: cache?.etag,
    headers: authHeader(),
    credentials: 'include',
  })

  if ('notModified' in response && response.notModified) {
    if (cache) {
      const refreshed: CachedReward = {
        data: cache.data,
        etag: cache.etag,
        expiresAt: now + FRESH_TTL_MS,
        staleUntil: now + STALE_TTL_MS,
      }
      writeCache(refreshed)
      return { data: cache.data, fromCache: true as const, etag: cache.etag }
    }
    throw new Error('daily_reward_not_modified_without_cache')
  }

  if (!response.ok) {
    if (response.status === 401) {
      clearCache()
    }
    throw new Error(response.error ?? 'daily_reward_error')
  }

  if (!hasData(response)) {
    throw new Error('daily_reward_invalid_payload')
  }

  const summary = response.data
  const etag = response.version
  const cached: CachedReward = {
    data: summary,
    etag,
    expiresAt: now + FRESH_TTL_MS,
    staleUntil: now + STALE_TTL_MS,
  }
  writeCache(cached)

  return { data: summary, fromCache: false as const, etag }
}

export const claimDailyReward = async (): Promise<DailyRewardClaimResponse> => {
  const response = await httpRequest<DailyRewardClaimResponse>(
    buildApiUrl('/api/users/me/daily-reward/claim'),
    {
      method: 'POST',
      body: JSON.stringify({}),
      headers: {
        'Content-Type': 'application/json',
        ...authHeader(),
      },
      credentials: 'include',
    }
  )

  if ('notModified' in response && response.notModified) {
    throw new Error('unexpected_not_modified_on_claim')
  }

  if (!response.ok || !hasData(response)) {
    throw new Error(response.error ?? 'daily_reward_claim_failed')
  }

  const now = Date.now()
  const summary = response.data.summary
  const etag = response.version
  const cachePayload: CachedReward = {
    data: summary,
    etag,
    expiresAt: now + FRESH_TTL_MS,
    staleUntil: now + STALE_TTL_MS,
  }
  writeCache(cachePayload)

  return response.data
}
