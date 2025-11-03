import type { ActivePredictionMatch, UserPredictionEntry } from '@shared/types'
import { buildApiUrl, httpRequest } from './httpClient'

const ACTIVE_CACHE_KEY = (days: number) => `predictions:active:v1:${days}`
const MY_CACHE_KEY = 'predictions:my:v1'
const ACTIVE_TTL_MS = 300_000
const MY_TTL_MS = 300_000

type CacheEntry<T> = {
  data: T
  etag?: string
  expiresAt: number
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

  writeCache(MY_CACHE_KEY, {
    data: next,
    etag: undefined,
    expiresAt: Date.now() + MY_TTL_MS,
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

  if (!options.force && cache && cache.expiresAt > now) {
    return {
      data: cache.data,
      fromCache: true,
      etag: cache.etag,
    }
  }

  const response = await httpRequest<ActivePredictionMatch[]>(buildActivePath(days), {
    version: cache?.etag,
    credentials: 'include',
  })

  if (!response.ok) {
    if (cache) {
      return { data: cache.data, fromCache: true, etag: cache.etag }
    }
    return { data: [], fromCache: false }
  }

  if ('notModified' in response && response.notModified) {
    if (cache) {
      writeCache(cacheKey, {
        ...cache,
        expiresAt: Date.now() + ACTIVE_TTL_MS,
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

  writeCache(cacheKey, {
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

  updateMyCacheWithEntry(payload.data)

  return {
    ok: true,
    data: payload.data,
    created: Boolean(payload.meta?.created),
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

    if (cache) {
      return { data: cache.data, fromCache: true, etag: cache.etag }
    }
    return { data: [], fromCache: false }
  }

  if ('notModified' in response && response.notModified) {
    if (cache) {
      writeCache(MY_CACHE_KEY, {
        ...cache,
        expiresAt: Date.now() + MY_TTL_MS,
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

  writeCache(MY_CACHE_KEY, {
    data,
    etag,
    expiresAt: Date.now() + MY_TTL_MS,
  })

  return {
    data,
    fromCache: false,
    etag,
    unauthorized: false,
  }
}
