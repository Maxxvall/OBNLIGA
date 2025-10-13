import type { JudgeMatchSummary, MatchEventEntry, MatchLineupEntry } from '../types'
import { translateAdminError } from './adminClient'

const API_BASE = import.meta.env.VITE_ADMIN_API_BASE || 'http://localhost:3000'

interface JudgeLoginResponse {
  ok: boolean
  token?: string
  expiresIn?: number
  error?: string
  errorCode?: string
}

const ensureJudgeToken = (token?: string): string => {
  if (!token) {
    throw new Error('missing_judge_token')
  }
  return token
}

const mapError = (value?: string) => translateAdminError(value)

export const judgeLogin = async (login: string, password: string): Promise<JudgeLoginResponse> => {
  const response = await fetch(`${API_BASE}/api/judge/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ login, password }),
  })

  const payload = (await response.json().catch(() => ({}))) as JudgeLoginResponse

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

interface JudgeResponseEnvelope<T> {
  ok: boolean
  data?: T
  error?: string
}

const judgeRequest = async <T>(
  token: string | undefined,
  path: string,
  init: RequestInit = {}
): Promise<T> => {
  const safeToken = ensureJudgeToken(token)
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${safeToken}`,
      ...(init.headers || {}),
    },
  })

  const raw = await response.text()
  let payload: JudgeResponseEnvelope<T>
  try {
    payload = raw
      ? (JSON.parse(raw) as JudgeResponseEnvelope<T>)
      : ({ ok: response.ok } as JudgeResponseEnvelope<T>)
  } catch (err) {
    payload = { ok: response.ok }
  }

  if (!response.ok || !payload.ok) {
    const code = payload.error || response.statusText || 'request_failed'
    throw new Error(mapError(code))
  }

  return payload.data as T
}

export const fetchJudgeMatches = async (token: string | undefined): Promise<JudgeMatchSummary[]> =>
  judgeRequest<JudgeMatchSummary[]>(token, '/api/judge/matches', { method: 'GET' })

export const fetchJudgeEvents = async (
  token: string | undefined,
  matchId: string
): Promise<MatchEventEntry[]> =>
  judgeRequest<MatchEventEntry[]>(token, `/api/judge/matches/${matchId}/events`, { method: 'GET' })

export const fetchJudgeLineup = async (
  token: string | undefined,
  matchId: string
): Promise<MatchLineupEntry[]> =>
  judgeRequest<MatchLineupEntry[]>(token, `/api/judge/matches/${matchId}/lineup`, { method: 'GET' })

export interface JudgeEventPayload {
  playerId: number
  teamId: number
  minute: number
  eventType: MatchEventEntry['eventType']
  relatedPlayerId?: number | null
}

export const judgeCreateEvent = async (
  token: string | undefined,
  matchId: string,
  payload: JudgeEventPayload
): Promise<MatchEventEntry> =>
  judgeRequest<MatchEventEntry>(token, `/api/judge/matches/${matchId}/events`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const judgeUpdateEvent = async (
  token: string | undefined,
  matchId: string,
  eventId: string,
  payload: Partial<JudgeEventPayload>
): Promise<MatchEventEntry> =>
  judgeRequest<MatchEventEntry>(token, `/api/judge/matches/${matchId}/events/${eventId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })

export const judgeDeleteEvent = async (
  token: string | undefined,
  matchId: string,
  eventId: string
): Promise<void> => {
  await judgeRequest(token, `/api/judge/matches/${matchId}/events/${eventId}`, { method: 'DELETE' })
}

export interface JudgeScorePayload {
  homeScore: number
  awayScore: number
  hasPenaltyShootout?: boolean
  penaltyHomeScore?: number
  penaltyAwayScore?: number
}

export interface JudgeScoreResult {
  id: string
  status: 'FINISHED' | 'LIVE'
  homeScore: number
  awayScore: number
  hasPenaltyShootout: boolean
  penaltyHomeScore: number
  penaltyAwayScore: number
}

export const judgeUpdateScore = async (
  token: string | undefined,
  matchId: string,
  payload: JudgeScorePayload
): Promise<JudgeScoreResult> => {
  const data = await judgeRequest<JudgeScoreResult>(
    token,
    `/api/judge/matches/${matchId}/score`,
    {
    method: 'PUT',
    body: JSON.stringify(payload),
    }
  )

  return {
    id: String(data.id ?? matchId),
    status: data.status === 'LIVE' ? 'LIVE' : 'FINISHED',
    homeScore: data.homeScore ?? 0,
    awayScore: data.awayScore ?? 0,
    hasPenaltyShootout: Boolean(data.hasPenaltyShootout),
    penaltyHomeScore: data.penaltyHomeScore ?? 0,
    penaltyAwayScore: data.penaltyAwayScore ?? 0,
  }
}
