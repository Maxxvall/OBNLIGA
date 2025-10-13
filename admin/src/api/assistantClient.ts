import type {
  AssistantMatchSummary,
  MatchEventEntry,
  MatchLineupEntry,
  MatchStatisticEntry,
  MatchStatisticMetric,
  MatchSummary,
} from '../types'
import { translateAdminError } from './adminClient'

const API_BASE = import.meta.env.VITE_ADMIN_API_BASE || 'http://localhost:3000'

interface AssistantLoginResponse {
  ok: boolean
  token?: string
  expiresIn?: number
  error?: string
  errorCode?: string
}

const ensureToken = (token?: string): string => {
  if (!token) {
    throw new Error('missing_assistant_token')
  }
  return token
}

const mapError = (value?: string) => translateAdminError(value)

export const assistantLogin = async (
  login: string,
  password: string
): Promise<AssistantLoginResponse> => {
  const response = await fetch(`${API_BASE}/api/assistant/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ login, password }),
  })

  const payload = (await response.json().catch(() => ({}))) as AssistantLoginResponse

  if (!response.ok || !payload.ok) {
    return {
      ok: false,
      error: mapError(payload.errorCode || payload.error || 'invalid_credentials'),
      errorCode: payload.errorCode || payload.error || 'invalid_credentials',
    }
  }

  return {
    ok: true,
    token: payload.token,
    expiresIn: payload.expiresIn,
  }
}

interface AssistantResponseEnvelope<T> {
  ok: boolean
  data?: T
  error?: string
  meta?: {
    version?: number
  }
}

const assistantRequest = async <T>(
  token: string | undefined,
  path: string,
  init: RequestInit = {}
): Promise<AssistantResponseEnvelope<T>> => {
  const safeToken = ensureToken(token)
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${safeToken}`,
      ...(init.headers || {}),
    },
  })

  const raw = await response.text()
  let payload: AssistantResponseEnvelope<T>
  try {
    payload = raw
      ? (JSON.parse(raw) as AssistantResponseEnvelope<T>)
      : ({ ok: response.ok } as AssistantResponseEnvelope<T>)
  } catch (err) {
    payload = { ok: response.ok }
  }

  if (!response.ok || !payload.ok) {
    const code = payload.error || response.statusText || 'request_failed'
    throw new Error(mapError(code))
  }

  if (response.headers.has('X-Resource-Version')) {
    const nextVersion = Number(response.headers.get('X-Resource-Version'))
    if (!Number.isNaN(nextVersion)) {
      payload.meta = { ...(payload.meta || {}), version: nextVersion }
    }
  }

  return payload
}

export const fetchAssistantMatches = async (
  token: string | undefined
): Promise<AssistantMatchSummary[]> => {
  const { data } = await assistantRequest<AssistantMatchSummary[]>(
    token,
    '/api/assistant/matches',
    { method: 'GET' }
  )
  return data ?? []
}

export const fetchAssistantEvents = async (
  token: string | undefined,
  matchId: string
): Promise<MatchEventEntry[]> => {
  const { data } = await assistantRequest<MatchEventEntry[]>(
    token,
    `/api/assistant/matches/${matchId}/events`,
    { method: 'GET' }
  )
  return data ?? []
}

export const fetchAssistantLineup = async (
  token: string | undefined,
  matchId: string
): Promise<MatchLineupEntry[]> => {
  const { data } = await assistantRequest<MatchLineupEntry[]>(
    token,
    `/api/assistant/matches/${matchId}/lineup`,
    { method: 'GET' }
  )
  return data ?? []
}

export interface AssistantEventPayload {
  playerId: number
  teamId: number
  minute: number
  eventType: MatchEventEntry['eventType']
  relatedPlayerId?: number | null
}

export const assistantCreateEvent = async (
  token: string | undefined,
  matchId: string,
  payload: AssistantEventPayload
): Promise<MatchEventEntry> => {
  const { data } = await assistantRequest<MatchEventEntry>(
    token,
    `/api/assistant/matches/${matchId}/events`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  )
  if (!data) {
    throw new Error(mapError('event_create_failed'))
  }
  return data
}

export const assistantUpdateEvent = async (
  token: string | undefined,
  matchId: string,
  eventId: string,
  payload: Partial<AssistantEventPayload>
): Promise<MatchEventEntry> => {
  const { data } = await assistantRequest<MatchEventEntry>(
    token,
    `/api/assistant/matches/${matchId}/events/${eventId}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    }
  )
  if (!data) {
    throw new Error(mapError('event_update_failed'))
  }
  return data
}

export const assistantDeleteEvent = async (
  token: string | undefined,
  matchId: string,
  eventId: string
): Promise<void> => {
  await assistantRequest(token, `/api/assistant/matches/${matchId}/events/${eventId}`, {
    method: 'DELETE',
  })
}

export interface AssistantScorePayload {
  homeScore: number
  awayScore: number
  hasPenaltyShootout?: boolean
  penaltyHomeScore?: number
  penaltyAwayScore?: number
  status?: 'LIVE' | 'FINISHED'
}

export interface AssistantScoreResult {
  id: string
  status: 'SCHEDULED' | 'LIVE' | 'FINISHED'
  homeScore: number
  awayScore: number
  hasPenaltyShootout: boolean
  penaltyHomeScore: number
  penaltyAwayScore: number
}

const mapScoreResult = (
  match: Partial<MatchSummary> | undefined,
  fallbackId: string
): AssistantScoreResult => {
  return {
    id: String(match?.id ?? fallbackId),
    status:
      match?.status === 'FINISHED' || match?.status === 'LIVE'
        ? match.status
        : match?.status === 'SCHEDULED'
          ? 'SCHEDULED'
          : 'LIVE',
    homeScore: match?.homeScore ?? 0,
    awayScore: match?.awayScore ?? 0,
    hasPenaltyShootout: Boolean(match?.hasPenaltyShootout),
    penaltyHomeScore: match?.penaltyHomeScore ?? 0,
    penaltyAwayScore: match?.penaltyAwayScore ?? 0,
  }
}

export const assistantUpdateScore = async (
  token: string | undefined,
  matchId: string,
  payload: AssistantScorePayload
): Promise<AssistantScoreResult> => {
  const { data } = await assistantRequest<Partial<MatchSummary>>(
    token,
    `/api/assistant/matches/${matchId}/score`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    }
  )
  return mapScoreResult(data, matchId)
}

export interface AssistantStatisticsResponse {
  entries: MatchStatisticEntry[]
  version?: number
}

export const fetchAssistantStatistics = async (
  token: string | undefined,
  matchId: string
): Promise<AssistantStatisticsResponse> => {
  const response = await assistantRequest<MatchStatisticEntry[]>(
    token,
    `/api/assistant/matches/${matchId}/statistics`,
    {
      method: 'GET',
    }
  )
  return {
    entries: response.data ?? [],
    version: response.meta?.version,
  }
}

export interface AssistantStatisticAdjustPayload {
  clubId: number
  metric: MatchStatisticMetric
  delta: number
}

export const assistantAdjustStatistic = async (
  token: string | undefined,
  matchId: string,
  payload: AssistantStatisticAdjustPayload
): Promise<AssistantStatisticsResponse> => {
  const response = await assistantRequest<MatchStatisticEntry[]>(
    token,
    `/api/assistant/matches/${matchId}/statistics/adjust`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  )
  return {
    entries: response.data ?? [],
    version: response.meta?.version,
  }
}
