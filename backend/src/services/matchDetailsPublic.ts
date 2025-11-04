/**
 * Public Match Details Service
 * Provides minimal, optimized payloads for frontend match details screen
 * with Redis caching and ETag support
 */

import { randomUUID } from 'crypto'
import prisma from '../db'
import { defaultCache } from '../cache'
import { MatchStatus, LineupRole } from '@prisma/client'

type CachedResult<T> = {
  data: T
  version: number
}

const wrapCachedResult = <T>(value: T | null | undefined, version: number): CachedResult<T> | null => {
  if (value === null || value === undefined) {
    return null
  }
  return {
    data: value,
    version,
  }
}

// Local type definitions (minimal payload for public API)
type MatchDetailsHeader = {
  st: 'SCHEDULED' | 'LIVE' | 'POSTPONED' | 'FINISHED'
  dt: string
  min?: number
  loc?: {
    city?: string
    stadium?: string
  }
  rd?: {
    label?: string | null
    type?: 'REGULAR' | 'PLAYOFF' | null
  }
  ps?: boolean
  ph?: number | null
  pa?: number | null
  ht: { n: string; sn?: string; lg?: string; sc: number }
  at: { n: string; sn?: string; lg?: string; sc: number }
}

type MatchDetailsLineups = {
  ht: { v: number; pl: Array<{ fn: string; ln: string; sn: number }> }
  at: { v: number; pl: Array<{ fn: string; ln: string; sn: number }> }
}

type MatchDetailsStats = {
  ht: { v: number; st: { sh?: number; sot?: number; cor?: number; yc?: number; rc?: number } }
  at: { v: number; st: { sh?: number; sot?: number; cor?: number; yc?: number; rc?: number } }
}

type MatchDetailsEvents = {
  v: number
  ev: Array<{
    id: string
    min: number
    tp: string
    tm: 'home' | 'away'
    pl?: string
    pl2?: string
  }>
}

type MatchDetailsBroadcast = {
  st: 'not_available' | 'available'
  url?: string
}

type MatchCommentPayload = {
  id: string
  userId: string
  authorName: string
  authorPhotoUrl?: string | null
  text: string
  createdAt: string
}

const REDIS_PREFIX = 'pub:md:'
const TTL_HEADER_SECONDS = 6
const TTL_LINEUPS_SECONDS = 15 * 60
const TTL_STATS_SECONDS = 8
const TTL_EVENTS_SECONDS = 6
const TTL_BROADCAST_SECONDS = 24 * 60 * 60 // 1 day
const TTL_COMMENTS_SECONDS = 4 * 60 * 60 // 4 hours

const COMMENTS_LIMIT = 120
const MAX_COMMENT_LENGTH = 100
const MIN_COMMENT_LENGTH = 2
const MAX_AUTHOR_NAME_LENGTH = 64
const MAX_USER_ID_LENGTH = 64
const MAX_PHOTO_URL_LENGTH = 512
const COMMENT_COOLDOWN_SECONDS = 3 * 60

export const matchBroadcastCacheKey = (matchId: bigint | string): string =>
  `${REDIS_PREFIX}${matchId.toString()}:broadcast`

export const matchCommentsCacheKey = (matchId: bigint | string): string =>
  `${REDIS_PREFIX}${matchId.toString()}:comments`

const COMMENT_CACHE_OPTIONS = {
  ttlSeconds: TTL_COMMENTS_SECONDS,
  staleWhileRevalidateSeconds: TTL_COMMENTS_SECONDS,
  lockTimeoutSeconds: 4,
} as const

export class CommentValidationError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message?: string) {
    super(message ?? code)
    this.status = status
    this.code = code
  }
}

const parseMatchId = (value: string): bigint | null => {
  try {
    const numeric = BigInt(value)
    if (numeric <= 0) {
      return null
    }
    return numeric
  } catch (_err) {
    return null
  }
}

const mapMatchStatus = (status: MatchStatus): MatchDetailsHeader['st'] => {
  return status as MatchDetailsHeader['st']
}

const calculateVersion = (updatedAt: Date): number => {
  return Math.floor(updatedAt.getTime() / 1000)
}

const getCurrentMinute = (matchDateTime: Date, status: MatchStatus): number | undefined => {
  if (status !== 'LIVE') return undefined
  const elapsed = Date.now() - matchDateTime.getTime()
  const minutes = Math.floor(elapsed / (1000 * 60))
  return Math.max(0, Math.min(120, minutes)) // clamp [0, 120]
}

/**
 * Fetch match header (status, score, time, current minute)
 */
export async function fetchMatchHeader(
  matchId: string
): Promise<CachedResult<MatchDetailsHeader> | null> {
  const key = `${REDIS_PREFIX}${matchId}:header`

  const result = await defaultCache.getWithMeta(key, async () => {
    const match = await prisma.match.findUnique({
      where: { id: BigInt(matchId) },
      select: {
        status: true,
        matchDateTime: true,
        homeScore: true,
        awayScore: true,
        hasPenaltyShootout: true,
        penaltyHomeScore: true,
        penaltyAwayScore: true,
        updatedAt: true,
        round: {
          select: {
            label: true,
            roundType: true,
          },
        },
        stadium: {
          select: {
            name: true,
            city: true,
          },
        },
        homeClub: {
          select: {
            name: true,
            shortName: true,
            logoUrl: true,
          },
        },
        awayClub: {
          select: {
            name: true,
            shortName: true,
            logoUrl: true,
          },
        },
      },
    })

    if (!match) return null

    const status = mapMatchStatus(match.status)
    const currentMin = getCurrentMinute(match.matchDateTime, match.status)
    const location = match.stadium
      ? {
        city: match.stadium.city ?? undefined,
        stadium: match.stadium.name ?? undefined,
      }
      : undefined
    const roundInfo = match.round
      ? {
        label: match.round.label,
        type: match.round.roundType,
      }
      : undefined
    
    const header: MatchDetailsHeader = {
      st: status,
      dt: match.matchDateTime.toISOString(),
      loc: location,
      rd: roundInfo,
      ps: match.hasPenaltyShootout,
      ph: match.hasPenaltyShootout ? match.penaltyHomeScore : undefined,
      pa: match.hasPenaltyShootout ? match.penaltyAwayScore : undefined,
      ht: {
        n: match.homeClub.name,
        sn: match.homeClub.shortName ?? undefined,
        lg: match.homeClub.logoUrl || undefined,
        sc: match.homeScore,
      },
      at: {
        n: match.awayClub.name,
        sn: match.awayClub.shortName ?? undefined,
        lg: match.awayClub.logoUrl || undefined,
        sc: match.awayScore,
      },
    }

    if (currentMin !== undefined) {
      header.min = currentMin
    }

    return header
  }, { ttlSeconds: TTL_HEADER_SECONDS, staleWhileRevalidateSeconds: TTL_HEADER_SECONDS * 2, lockTimeoutSeconds: 4 })

  return wrapCachedResult(result.value, result.version)
}

/**
 * Fetch match lineups (both teams)
 */
export async function fetchMatchLineups(
  matchId: string
): Promise<CachedResult<MatchDetailsLineups> | null> {
  const key = `${REDIS_PREFIX}${matchId}:lineups`

  const result = await defaultCache.getWithMeta(key, async () => {
    const match = await prisma.match.findUnique({
      where: { id: BigInt(matchId) },
      select: {
        status: true,
        updatedAt: true,
        seasonId: true,
        homeTeamId: true,
        awayTeamId: true,
        lineups: {
          where: {
            role: {
              in: [LineupRole.STARTER, LineupRole.SUBSTITUTE],
            },
          },
          select: {
            clubId: true,
            personId: true,
            person: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
          orderBy: {
            personId: 'asc',
          },
        },
      },
    })

    if (!match) return null

    const homeVersion = calculateVersion(match.updatedAt)
    const awayVersion = calculateVersion(match.updatedAt)

    const roster = match.seasonId
      ? await prisma.seasonRoster.findMany({
          where: {
            seasonId: match.seasonId,
            clubId: { in: [match.homeTeamId, match.awayTeamId] },
          },
          select: {
            personId: true,
            shirtNumber: true,
          },
        })
      : []

    const shirtNumbers = new Map(roster.map(r => [r.personId, r.shirtNumber]))

    const homePlayers = match.lineups
      .filter(lp => lp.clubId === match.homeTeamId)
      .map(lp => ({
        fn: lp.person.firstName,
        ln: lp.person.lastName,
        sn: shirtNumbers.get(lp.personId) ?? 0,
      }))

    const awayPlayers = match.lineups
      .filter(lp => lp.clubId === match.awayTeamId)
      .map(lp => ({
        fn: lp.person.firstName,
        ln: lp.person.lastName,
        sn: shirtNumbers.get(lp.personId) ?? 0,
      }))

    const lineups: MatchDetailsLineups = {
      ht: {
        v: homeVersion,
        pl: homePlayers,
      },
      at: {
        v: awayVersion,
        pl: awayPlayers,
      },
    }

    return lineups
  }, { ttlSeconds: TTL_LINEUPS_SECONDS, staleWhileRevalidateSeconds: TTL_LINEUPS_SECONDS * 2, lockTimeoutSeconds: 6 })

  return wrapCachedResult(result.value, result.version)
}

/**
 * Fetch match statistics (shots, corners, cards, etc.)
 */
export async function fetchMatchStats(
  matchId: string
): Promise<CachedResult<MatchDetailsStats> | null> {
  const key = `${REDIS_PREFIX}${matchId}:stats`

  const result = await defaultCache.getWithMeta(key, async () => {
    const match = await prisma.match.findUnique({
      where: { id: BigInt(matchId) },
      select: {
        status: true,
        updatedAt: true,
        homeTeamId: true,
        awayTeamId: true,
        statistics: {
          select: {
            clubId: true,
            totalShots: true,
            shotsOnTarget: true,
            corners: true,
            yellowCards: true,
            redCards: true,
          },
        },
      },
    })

    if (!match) return null

    const homeVersion = calculateVersion(match.updatedAt)
    const awayVersion = calculateVersion(match.updatedAt)

    const homeStat = match.statistics.find(s => s.clubId === match.homeTeamId)
    const awayStat = match.statistics.find(s => s.clubId === match.awayTeamId)

    const stats: MatchDetailsStats = {
      ht: {
        v: homeVersion,
        st: {
          sh: homeStat?.totalShots || undefined,
          sot: homeStat?.shotsOnTarget || undefined,
          cor: homeStat?.corners || undefined,
          yc: homeStat?.yellowCards || undefined,
          rc: homeStat?.redCards || undefined,
        },
      },
      at: {
        v: awayVersion,
        st: {
          sh: awayStat?.totalShots || undefined,
          sot: awayStat?.shotsOnTarget || undefined,
          cor: awayStat?.corners || undefined,
          yc: awayStat?.yellowCards || undefined,
          rc: awayStat?.redCards || undefined,
        },
      },
    }

    return stats
  }, { ttlSeconds: TTL_STATS_SECONDS, staleWhileRevalidateSeconds: TTL_STATS_SECONDS * 2, lockTimeoutSeconds: 6 })

  return wrapCachedResult(result.value, result.version)
}

/**
 * Fetch match events (goals, cards, substitutions)
 */
export async function fetchMatchEvents(
  matchId: string
): Promise<CachedResult<MatchDetailsEvents> | null> {
  const key = `${REDIS_PREFIX}${matchId}:events`

  const result = await defaultCache.getWithMeta(key, async () => {
    const match = await prisma.match.findUnique({
      where: { id: BigInt(matchId) },
      select: {
        status: true,
        updatedAt: true,
        homeTeamId: true,
        awayTeamId: true,
        events: {
          select: {
            id: true,
            minute: true,
            eventType: true,
            teamId: true,
            player: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
            relatedPerson: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
          orderBy: [{ minute: 'asc' }, { id: 'asc' }],
        },
      },
    })

    if (!match) return null

    const version = calculateVersion(match.updatedAt)

    const events = match.events.map(ev => {
      const team: 'home' | 'away' = ev.teamId === match.homeTeamId ? 'home' : 'away'
      const playerName = ev.player
        ? `${ev.player.firstName} ${ev.player.lastName}`
        : undefined

      const relatedName = ev.relatedPerson
        ? `${ev.relatedPerson.firstName} ${ev.relatedPerson.lastName}`
        : undefined

      const event: MatchDetailsEvents['ev'][number] = {
        id: ev.id.toString(),
        min: ev.minute,
        tp: ev.eventType,
        tm: team,
      }

      if (playerName) event.pl = playerName
      if (relatedName) event.pl2 = relatedName

      return event
    })

    const result: MatchDetailsEvents = {
      v: version,
      ev: events,
    }

    return result
  }, { ttlSeconds: TTL_EVENTS_SECONDS, staleWhileRevalidateSeconds: TTL_EVENTS_SECONDS * 2, lockTimeoutSeconds: 6 })

  return wrapCachedResult(result.value, result.version)
}

/**
 * Fetch broadcast info (stub for now)
 */
export async function fetchMatchBroadcast(
  matchId: string
): Promise<CachedResult<MatchDetailsBroadcast> | null> {
  const numericMatchId = parseMatchId(matchId)
  if (!numericMatchId) {
    return {
      data: { st: 'not_available' },
      version: 0,
    }
  }

  const key = matchBroadcastCacheKey(numericMatchId)

  const result = await defaultCache.getWithMeta(
    key,
    async () => {
      const match = await prisma.match.findUnique({
        where: { id: numericMatchId },
        select: {
          broadcastUrl: true,
        },
      })

      if (!match) {
        return { st: 'not_available' as const }
      }

      const url = match.broadcastUrl?.trim()
      if (!url) {
        return { st: 'not_available' as const }
      }

      return {
        st: 'available' as const,
        url,
      }
    },
    {
      ttlSeconds: TTL_BROADCAST_SECONDS,
      staleWhileRevalidateSeconds: TTL_BROADCAST_SECONDS,
      lockTimeoutSeconds: 4,
    }
  )

  return {
    data: result.value,
    version: result.version,
  }
}

/**
 * Fetch comments for the broadcast tab (ephemeral Redis payload)
 */
export async function fetchMatchComments(
  matchId: string
): Promise<CachedResult<MatchCommentPayload[]> | null> {
  const numericMatchId = parseMatchId(matchId)
  if (!numericMatchId) {
    return null
  }

  const key = matchCommentsCacheKey(numericMatchId)

  const result = await defaultCache.getWithMeta(
    key,
    async () => [] as MatchCommentPayload[],
    COMMENT_CACHE_OPTIONS
  )

  return {
    data: sanitizeStoredComments(result.value),
    version: result.version,
  }
}

type CommentInputPayload = {
  userId?: string
  text?: string
}

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim()

const sanitizeAuthorName = (value: unknown): string => {
  if (typeof value === 'string') {
    const normalized = normalizeWhitespace(value).slice(0, MAX_AUTHOR_NAME_LENGTH)
    if (normalized.length > 0) {
      return normalized
    }
  }
  return 'Болельщик'
}

const sanitizePhotoUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  return trimmed.slice(0, MAX_PHOTO_URL_LENGTH)
}

const sanitizeStoredComment = (value: unknown): MatchCommentPayload | null => {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' && record.id.trim().length > 0 ? record.id : null
  const userId =
    typeof record.userId === 'string' && record.userId.trim().length > 0 ? record.userId : null
  const text = typeof record.text === 'string' && record.text.trim().length > 0 ? record.text : null
  const createdAt =
    typeof record.createdAt === 'string' && record.createdAt.trim().length > 0
      ? record.createdAt
      : null

  if (!id || !userId || !text || !createdAt) {
    return null
  }

  const authorNameSource =
    typeof record.authorName === 'string'
      ? record.authorName
      : typeof record.displayName === 'string'
        ? record.displayName
        : undefined

  return {
    id,
    userId,
    authorName: sanitizeAuthorName(authorNameSource),
    authorPhotoUrl: sanitizePhotoUrl(record.authorPhotoUrl),
    text,
    createdAt,
  }
}

const sanitizeStoredComments = (value: unknown): MatchCommentPayload[] => {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized: MatchCommentPayload[] = []
  for (const entry of value) {
    const comment = sanitizeStoredComment(entry)
    if (comment) {
      normalized.push(comment)
    }
  }

  if (normalized.length > COMMENTS_LIMIT) {
    return normalized.slice(normalized.length - COMMENTS_LIMIT)
  }

  return normalized
}

/**
 * Append a new comment to Redis storage and bump version
 */
export async function appendMatchComment(
  matchId: string,
  input: CommentInputPayload
): Promise<{ comment: MatchCommentPayload; version: number }> {
  const numericMatchId = parseMatchId(matchId)
  if (!numericMatchId) {
    throw new CommentValidationError(400, 'invalid_match')
  }

  const rawUserId = typeof input.userId === 'string' ? input.userId.trim() : ''
  if (!rawUserId) {
    throw new CommentValidationError(400, 'user_required')
  }
  if (rawUserId.length > MAX_USER_ID_LENGTH) {
    throw new CommentValidationError(400, 'user_too_long')
  }

  let telegramId: bigint
  try {
    telegramId = BigInt(rawUserId)
  } catch (_err) {
    throw new CommentValidationError(400, 'invalid_user')
  }

  const rawText = typeof input.text === 'string' ? input.text.trim() : ''
  if (rawText.length < MIN_COMMENT_LENGTH) {
    throw new CommentValidationError(400, 'text_required')
  }
  const normalizedText = normalizeWhitespace(rawText).slice(0, MAX_COMMENT_LENGTH)

  const match = await prisma.match.findUnique({
    where: { id: numericMatchId },
    select: { id: true },
  })

  if (!match) {
    throw new CommentValidationError(404, 'match_not_found')
  }

  const appUser = await prisma.appUser.findUnique({
    where: { telegramId },
    select: {
      telegramId: true,
      firstName: true,
      photoUrl: true,
    },
  })

  if (!appUser) {
    throw new CommentValidationError(404, 'user_not_found')
  }

  const key = matchCommentsCacheKey(numericMatchId)
  const existing = await defaultCache.getWithMeta(
    key,
    async () => [] as MatchCommentPayload[],
    COMMENT_CACHE_OPTIONS
  )

  const existingComments = sanitizeStoredComments(existing.value)
  const normalizedUserId = appUser.telegramId.toString()

  const lastUserComment = [...existingComments]
    .reverse()
    .find(comment => comment.userId === normalizedUserId)

  if (lastUserComment) {
    const lastTimestamp = Date.parse(lastUserComment.createdAt)
    if (!Number.isNaN(lastTimestamp)) {
      const diffSeconds = (Date.now() - lastTimestamp) / 1000
      if (diffSeconds < COMMENT_COOLDOWN_SECONDS) {
        throw new CommentValidationError(429, 'rate_limited')
      }
    }
  }

  const comment: MatchCommentPayload = {
    id: randomUUID(),
    userId: normalizedUserId,
    authorName: sanitizeAuthorName(appUser.firstName),
    authorPhotoUrl: sanitizePhotoUrl(appUser.photoUrl),
    text: normalizedText,
    createdAt: new Date().toISOString(),
  }

  const nextComments = [...existingComments, comment]
  if (nextComments.length > COMMENTS_LIMIT) {
    nextComments.splice(0, nextComments.length - COMMENTS_LIMIT)
  }

  await defaultCache.set(key, nextComments, COMMENT_CACHE_OPTIONS)

  const updated = await defaultCache.getWithMeta(
    key,
    async () => nextComments,
    COMMENT_CACHE_OPTIONS
  )

  return {
    comment,
    version: updated.version,
  }
}

/**
 * Helper to determine if stats tab should be hidden
 * Stats tab is hidden if:
 * - status = FINISHED
 * - more than 1 hour passed since match end (matchDateTime + ~2h + 1h)
 */
export function shouldHideStats(matchDateTime: Date, status: MatchStatus): boolean {
  if (status !== 'FINISHED') return false

  const matchEnd = new Date(matchDateTime)
  matchEnd.setHours(matchEnd.getHours() + 3) // 2h match duration + 1h grace

  return Date.now() > matchEnd.getTime()
}
