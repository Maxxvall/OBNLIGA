export type LeaguePlayerStatus = 'NONE' | 'PENDING' | 'VERIFIED'

export interface LeaguePlayerProfile {
  id: number
  firstName: string
  lastName: string
}

export interface LeaguePlayerStats {
  matches: number
  goals: number
  assists: number
  penaltyGoals: number
  yellowCards: number
  redCards: number
}

export interface LeaguePlayerCareerEntry {
  clubId: number
  clubName: string
  clubShortName: string
  clubLogoUrl: string | null
  fromYear: number | null
  toYear: number | null
  matches: number
  assists: number
  goals: number
  penaltyGoals: number
  yellowCards: number
  redCards: number
}

export interface ProfileUser {
  telegramId?: string
  username?: string | null
  firstName?: string | null
  photoUrl?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  leaguePlayerStatus?: LeaguePlayerStatus
  leaguePlayerRequestedAt?: string | null
  leaguePlayerVerifiedAt?: string | null
  leaguePlayerId?: number | null
  leaguePlayer?: LeaguePlayerProfile | null
  leaguePlayerStats?: LeaguePlayerStats | null
  leaguePlayerCareer?: LeaguePlayerCareerEntry[] | null
}

const isNullableString = (value: unknown): value is string | null | undefined => {
  return value === undefined || value === null || typeof value === 'string'
}

const getNullableString = (value: unknown): string | null | undefined => {
  if (value === undefined || value === null) {
    return value as undefined | null
  }
  return typeof value === 'string' ? value : undefined
}

const isLeagueStatus = (value: unknown): value is LeaguePlayerStatus => {
  return value === 'NONE' || value === 'PENDING' || value === 'VERIFIED'
}

const isLeaguePlayerProfile = (value: unknown): value is LeaguePlayerProfile => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'number' &&
    typeof record.firstName === 'string' &&
    typeof record.lastName === 'string'
  )
}

const isLeaguePlayerStats = (value: unknown): value is LeaguePlayerStats => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  const keys: Array<keyof LeaguePlayerStats> = [
    'matches',
    'goals',
    'assists',
    'penaltyGoals',
    'yellowCards',
    'redCards',
  ]
  return keys.every(key => typeof record[key] === 'number')
}

const isLeaguePlayerCareerEntry = (value: unknown): value is LeaguePlayerCareerEntry => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const record = value as Record<string, unknown>
  const numberOrNull = (candidate: unknown) => candidate === null || typeof candidate === 'number'
  return (
    typeof record.clubId === 'number' &&
    typeof record.clubName === 'string' &&
    typeof record.clubShortName === 'string' &&
    (record.clubLogoUrl === null || typeof record.clubLogoUrl === 'string') &&
    numberOrNull(record.fromYear) &&
    numberOrNull(record.toYear) &&
    typeof record.matches === 'number' &&
    typeof record.assists === 'number' &&
    typeof record.goals === 'number' &&
    typeof record.penaltyGoals === 'number' &&
    typeof record.yellowCards === 'number' &&
    typeof record.redCards === 'number'
  )
}

export const isProfileUser = (value: unknown): value is ProfileUser => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (!isNullableString(record.telegramId)) return false
  if (!isNullableString(record.username)) return false
  if (!isNullableString(record.firstName)) return false
  if (!isNullableString(record.photoUrl)) return false
  if (!isNullableString(record.createdAt)) return false
  if (!isNullableString(record.updatedAt)) return false
  return true
}

export const normalizeProfilePayload = (value: unknown): ProfileUser | null => {
  if (!isProfileUser(value)) return null
  const record = value as ProfileUser & Record<string, unknown>
  const normalized: ProfileUser = {
    telegramId: record.telegramId,
    username: record.username ?? null,
    firstName: record.firstName ?? null,
    photoUrl: record.photoUrl ?? null,
    createdAt: record.createdAt ?? null,
    updatedAt: record.updatedAt ?? null,
  }

  if (isLeagueStatus(record.leaguePlayerStatus)) {
    normalized.leaguePlayerStatus = record.leaguePlayerStatus
  }

  if (typeof record.leaguePlayerId === 'number') {
    normalized.leaguePlayerId = record.leaguePlayerId
  }

  const requestedAt = getNullableString((record as Record<string, unknown>).leaguePlayerRequestedAt)
  if (requestedAt !== undefined) {
    normalized.leaguePlayerRequestedAt = requestedAt ?? null
  }

  const verifiedAt = getNullableString((record as Record<string, unknown>).leaguePlayerVerifiedAt)
  if (verifiedAt !== undefined) {
    normalized.leaguePlayerVerifiedAt = verifiedAt ?? null
  }

  const leaguePlayerRaw = (record as Record<string, unknown>).leaguePlayer
  normalized.leaguePlayer = isLeaguePlayerProfile(leaguePlayerRaw) ? leaguePlayerRaw : null

  const statsRaw = (record as Record<string, unknown>).leaguePlayerStats
  normalized.leaguePlayerStats = isLeaguePlayerStats(statsRaw) ? statsRaw : null

  const careerRaw = (record as Record<string, unknown>).leaguePlayerCareer
  if (Array.isArray(careerRaw)) {
    const parsed = careerRaw.filter(isLeaguePlayerCareerEntry)
    normalized.leaguePlayerCareer = parsed
  } else if (careerRaw === null) {
    normalized.leaguePlayerCareer = null
  } else {
    normalized.leaguePlayerCareer = []
  }

  return normalized
}

export const readProfileUser = (payload: unknown): ProfileUser | null => {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  if ('user' in record) {
    const candidate = (record as { user?: unknown }).user
    const normalized = normalizeProfilePayload(candidate)
    if (normalized) {
      return normalized
    }
  }
  return normalizeProfilePayload(payload)
}
