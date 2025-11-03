import type {
  ActivePredictionMatch,
  UserPredictionEntry,
} from '@shared/types'

const ACTIVE_CACHE_KEY = 'predictions:active:v1'
const MY_CACHE_KEY = 'predictions:my:v1'
const ACTIVE_TTL_MS = 300_000
const MY_TTL_MS = 300_000

type CacheEntry<T> = {
  data: T
  etag?: string
  expiresAt: number
}

type ActivePayload = {
  ok: boolean
  data: ActivePredictionMatch[]
  meta?: {
    version?: number
    days?: number
  }
}

type MyPayload = {
  ok: boolean
  data: UserPredictionEntry[]
  error?: string
}

type FetchOptions = {
  days?: number
  force?: boolean
}

const readCache = <T>(key: string): CacheEntry<T> | null => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CacheEntry<T>
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch (err) {
    console.warn('predictionsApi: failed to read cache', err)
    return null
  }
}

const writeCache = <T>(key: string, entry: CacheEntry<T>) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(entry))
  } catch (err) {
    console.warn('predictionsApi: failed to write cache', err)
  }
}

const buildActiveUrl = (days: number) => {
  const url = new URL('/api/predictions/active', window.location.origin)
  url.searchParams.set('days', String(days))
  return url.toString()
}

const buildMyUrl = () => new URL('/api/predictions/my', window.location.origin).toString()

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

export const fetchActivePredictions = async (
  options: FetchOptions = {}
): Promise<ActivePredictionsResult> => {
  const days = options.days ?? 6
  const cache = readCache<ActivePredictionMatch[]>(ACTIVE_CACHE_KEY)
  const now = Date.now()

  if (!options.force && cache && cache.expiresAt > now) {
    return {
      data: cache.data,
      fromCache: true,
      etag: cache.etag,
    }
  }

  const headers: Record<string, string> = {}
  if (cache?.etag) {
    headers['If-None-Match'] = cache.etag
  }

  const response = await fetch(buildActiveUrl(days), {
    method: 'GET',
    credentials: 'include',
    headers,
  })

  if (response.status === 304 && cache) {
    writeCache(ACTIVE_CACHE_KEY, {
      ...cache,
      expiresAt: Date.now() + ACTIVE_TTL_MS,
    })
    return {
      data: cache.data,
      fromCache: true,
      etag: cache.etag,
    }
  }

  if (!response.ok) {
    if (cache) {
      return { data: cache.data, fromCache: true, etag: cache.etag }
    }
    return { data: [], fromCache: false }
  }

  const payload = (await response.json()) as ActivePayload
  const etag = response.headers.get('ETag') ?? undefined
  const data = Array.isArray(payload?.data) ? payload.data : []

  writeCache(ACTIVE_CACHE_KEY, {
    data,
    etag,
    expiresAt: Date.now() + ACTIVE_TTL_MS,
  })

  return {
    data,
    fromCache: false,
    etag,
  }
}

export const fetchMyPredictions = async (): Promise<MyPredictionsResult> => {
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

  if (cache && cache.expiresAt > now) {
    return {
      data: cache.data,
      fromCache: true,
      etag: cache.etag,
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  }

  if (cache?.etag) {
    headers['If-None-Match'] = cache.etag
  }

  const response = await fetch(buildMyUrl(), {
    method: 'GET',
    credentials: 'include',
    headers,
  })

  if (response.status === 401 || response.status === 403) {
    return {
      data: [],
      fromCache: false,
      unauthorized: true,
    }
  }

  if (response.status === 304 && cache) {
    writeCache(MY_CACHE_KEY, {
      ...cache,
      expiresAt: Date.now() + MY_TTL_MS,
    })
    return {
      data: cache.data,
      fromCache: true,
      etag: cache.etag,
    }
  }

  if (!response.ok) {
    if (cache) {
      return { data: cache.data, fromCache: true, etag: cache.etag }
    }
    return { data: [], fromCache: false }
  }

  const payload = (await response.json()) as MyPayload
  const etag = response.headers.get('ETag') ?? undefined
  const data = Array.isArray(payload?.data) ? payload.data : []

  writeCache(MY_CACHE_KEY, {
    data,
    etag,
    expiresAt: Date.now() + MY_TTL_MS,
  })

  return {
    data,
    fromCache: false,
    etag,
  }
}
