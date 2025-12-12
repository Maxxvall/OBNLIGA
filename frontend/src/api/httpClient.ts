const API_BASE = import.meta.env.VITE_BACKEND_URL ?? ''

let httpAuthToken: string | null = null

export const setHttpAuthToken = (token: string | null): void => {
  httpAuthToken = typeof token === 'string' && token.trim().length > 0 ? token.trim() : null
}

export const getHttpAuthHeaders = (): Record<string, string> => {
  return httpAuthToken ? { Authorization: `Bearer ${httpAuthToken}` } : {}
}

export const buildApiUrl = (path: string): string => {
  if (typeof path !== 'string') {
    throw new Error('API path must be a string')
  }

  const trimmed = path.trim()
  if (trimmed.length === 0) {
    throw new Error('API path must not be empty')
  }

  const isAbsoluteUrl = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)
  if (isAbsoluteUrl) {
    return trimmed
  }

  const normalizedPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return API_BASE ? `${API_BASE}${normalizedPath}` : normalizedPath
}

type ApiSuccess<T> = {
  ok: true
  data: T
  version?: string
  notModified?: false
}

type ApiNotModified = {
  ok: true
  notModified: true
}

type ApiError = {
  ok: false
  error: string
  status: number
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError | ApiNotModified

const jsonHeaders = {
  Accept: 'application/json',
}

const parseErrorMessage = (value: unknown): string => {
  if (value instanceof Error) {
    return value.message || 'unknown_error'
  }
  if (typeof value === 'string') {
    return value || 'unknown_error'
  }
  if (value && typeof value === 'object' && 'message' in value) {
    const message = (value as { message?: unknown }).message
    if (typeof message === 'string' && message.length > 0) {
      return message
    }
  }
  return 'unknown_error'
}

type HttpRequestOptions = Omit<RequestInit, 'headers'> & {
  headers?: HeadersInit
  version?: string
}

export async function httpRequest<T>(path: string, options?: HttpRequestOptions): Promise<ApiResponse<T>> {
  const url = buildApiUrl(path)
  const { version, headers, ...rest } = options ?? {}
  const requestHeaders: Record<string, string> = headers
    ? { ...jsonHeaders, ...(headers as Record<string, string>) }
    : { ...jsonHeaders }

  // Telegram mobile WebView can block third-party cookies; fall back to Bearer when available.
  if (httpAuthToken && !('Authorization' in requestHeaders)) {
    requestHeaders.Authorization = `Bearer ${httpAuthToken}`
  }

  if (version) {
    requestHeaders['If-None-Match'] = version
  }
  try {
    const response = await fetch(url, {
      ...rest,
      cache: 'default',
      credentials: rest.credentials ?? 'include',
      headers: requestHeaders,
    })

    if (response.status === 304) {
      return { ok: true, notModified: true }
    }

    const versionHeader = response.headers.get('x-resource-version') ?? undefined
    const etagHeader = response.headers.get('etag') ?? undefined

    const text = await response.text()
    let json: unknown
    if (text) {
      try {
        json = JSON.parse(text)
      } catch (err) {
        return {
          ok: false,
          error: 'invalid_json',
          status: response.status,
        }
      }
    }

    if (!response.ok) {
      const errorCode = typeof json === 'object' && json !== null && 'error' in json
        ? String((json as { error?: unknown }).error ?? 'http_error')
        : 'http_error'
      return {
        ok: false,
        error: errorCode,
        status: response.status,
      }
    }

    if (!json || typeof json !== 'object') {
      return {
        ok: false,
        error: 'empty_response',
        status: response.status,
      }
    }

    const body = json as { ok?: boolean; data?: T; error?: string; meta?: { version?: string } }
    if (!body.ok || !body.data) {
      return {
        ok: false,
        error: body.error ?? 'response_error',
        status: response.status,
      }
    }

    const metaVersion = body.meta?.version
    const versionValue =
      etagHeader ?? versionHeader ?? (metaVersion !== undefined ? String(metaVersion) : undefined)

    return {
      ok: true,
      data: body.data,
      version: versionValue,
    }
  } catch (err) {
    return {
      ok: false,
      error: parseErrorMessage(err),
      status: 0,
    }
  }
}
