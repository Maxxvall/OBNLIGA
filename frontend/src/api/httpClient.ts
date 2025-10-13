const API_BASE = import.meta.env.VITE_BACKEND_URL ?? ''

const buildUrl = (path: string) => {
  if (!path.startsWith('/')) {
    throw new Error('API paths must start with "/"')
  }
  return API_BASE ? `${API_BASE}${path}` : path
}

type ApiSuccess<T> = {
  ok: true
  data: T
  version?: string
}

type ApiError = {
  ok: false
  error: string
  status: number
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError

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

export async function httpRequest<T>(path: string, init?: RequestInit): Promise<ApiResponse<T>> {
  const url = buildUrl(path)
  try {
    const response = await fetch(url, {
      ...init,
      headers: init?.headers ? { ...jsonHeaders, ...init.headers } : jsonHeaders,
    })

    const versionHeader = response.headers.get('x-resource-version') ?? undefined
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

    const version = body.meta?.version ?? versionHeader

    return {
      ok: true,
      data: body.data,
      version,
    }
  } catch (err) {
    return {
      ok: false,
      error: parseErrorMessage(err),
      status: 0,
    }
  }
}
