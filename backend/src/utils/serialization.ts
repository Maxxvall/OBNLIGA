export interface SerializedAppUserPayload {
  id: number
  telegramId: string
  username: string | null
  firstName: string | null
  photoUrl: string | null
  updatedAt: string
  leaguePlayerStatus?: string | null
  leaguePlayerRequestedAt?: string | null
  leaguePlayerVerifiedAt?: string | null
  leaguePlayerId?: number | null
}

export function serializePrisma<T>(input: T): unknown {
  return serializeAny(input)
}

function serializeAny(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(item => serializeAny(item))
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, val]) => [
      key,
      serializeAny(val),
    ])
    return Object.fromEntries(entries)
  }
  return value
}

export function isSerializedAppUserPayload(value: unknown): value is SerializedAppUserPayload {
  if (!value || typeof value !== 'object') return false

  const payload = value as Record<string, unknown>
  const hasId = typeof payload.id === 'number'
  const hasTelegramId = typeof payload.telegramId === 'string'
  const hasUpdatedAt = typeof payload.updatedAt === 'string'

  if (!hasId || !hasTelegramId || !hasUpdatedAt) {
    return false
  }

  const username = payload.username
  const firstName = payload.firstName
  const photoUrl = payload.photoUrl
  const leaguePlayerStatus = payload.leaguePlayerStatus
  const leaguePlayerRequestedAt = payload.leaguePlayerRequestedAt
  const leaguePlayerVerifiedAt = payload.leaguePlayerVerifiedAt
  const leaguePlayerId = payload.leaguePlayerId

  const usernameOk = username === null || typeof username === 'string' || username === undefined
  const firstNameOk = firstName === null || typeof firstName === 'string' || firstName === undefined
  const photoUrlOk = photoUrl === null || typeof photoUrl === 'string' || photoUrl === undefined
  const statusOk =
    leaguePlayerStatus === null ||
    typeof leaguePlayerStatus === 'string' ||
    leaguePlayerStatus === undefined
  const requestedAtOk =
    leaguePlayerRequestedAt === null ||
    typeof leaguePlayerRequestedAt === 'string' ||
    leaguePlayerRequestedAt === undefined
  const verifiedAtOk =
    leaguePlayerVerifiedAt === null ||
    typeof leaguePlayerVerifiedAt === 'string' ||
    leaguePlayerVerifiedAt === undefined
  const leaguePlayerIdOk =
    leaguePlayerId === null || typeof leaguePlayerId === 'number' || leaguePlayerId === undefined

  return usernameOk && firstNameOk && photoUrlOk && statusOk && requestedAtOk && verifiedAtOk && leaguePlayerIdOk
}
