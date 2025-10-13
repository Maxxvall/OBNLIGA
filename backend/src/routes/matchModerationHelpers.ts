import { FastifyInstance } from 'fastify'
import { MatchEvent, MatchEventType, MatchStatus, Prisma } from '@prisma/client'
import prisma from '../db'
import { defaultCache } from '../cache'
import { serializePrisma } from '../utils/serialization'

export class RequestError extends Error {
  statusCode: number

  constructor(statusCode: number, code: string) {
    super(code)
    this.statusCode = statusCode
    this.name = 'RequestError'
  }
}

export type MatchStatisticMetric =
  | 'totalShots'
  | 'shotsOnTarget'
  | 'corners'
  | 'yellowCards'
  | 'redCards'

export const MATCH_STATISTIC_METRICS: MatchStatisticMetric[] = [
  'totalShots',
  'shotsOnTarget',
  'corners',
  'yellowCards',
  'redCards',
]
export type EventStatisticAdjustments = Partial<Record<MatchStatisticMetric, number>>

export interface MatchEventPayload {
  playerId: number
  teamId: number
  minute: number
  eventType: MatchEventType
  relatedPlayerId?: number | null
}

export interface MatchEventUpdatePayload {
  minute?: number
  eventType?: MatchEventType
  teamId?: number
  playerId?: number
  relatedPlayerId?: number | null
}

export const eventStatisticAdjustments: Partial<Record<MatchEventType, EventStatisticAdjustments>> =
  {
    YELLOW_CARD: { yellowCards: 1 },
    RED_CARD: { redCards: 1 },
    SECOND_YELLOW_CARD: { redCards: 1 },
  }

const MATCH_STATS_CACHE_TTL_SECONDS = Number(process.env.ADMIN_CACHE_TTL_MATCH_STATS ?? '5')
const MATCH_STATS_RETENTION_HOURS = Number(process.env.MATCH_STATS_RETENTION_HOURS ?? '3')
const MATCH_STATS_RETENTION_MS =
  MATCH_STATS_RETENTION_HOURS > 0 ? MATCH_STATS_RETENTION_HOURS * 60 * 60 * 1000 : 0
const MATCH_STATS_CLEANUP_INTERVAL_MS = Number(
  process.env.MATCH_STATS_CLEANUP_INTERVAL_MS ?? '300000'
)

let lastMatchStatsCleanupAt = 0

export const hasMatchStatisticsExpired = (matchDateTime: Date, reference: Date): boolean => {
  if (MATCH_STATS_RETENTION_MS <= 0) {
    return false
  }
  return matchDateTime.getTime() + MATCH_STATS_RETENTION_MS <= reference.getTime()
}

export const cleanupExpiredMatchStatistics = async (now: Date): Promise<number> => {
  if (MATCH_STATS_RETENTION_MS <= 0) {
    return 0
  }
  if (now.getTime() - lastMatchStatsCleanupAt < MATCH_STATS_CLEANUP_INTERVAL_MS) {
    return 0
  }
  lastMatchStatsCleanupAt = now.getTime()
  const cutoff = new Date(now.getTime() - MATCH_STATS_RETENTION_MS)
  const expired = await prisma.matchStatistic.findMany({
    where: { match: { matchDateTime: { lt: cutoff } } },
    select: { matchId: true },
    distinct: ['matchId'],
  })
  if (!expired.length) {
    return 0
  }
  await prisma.matchStatistic.deleteMany({
    where: { matchId: { in: expired.map(entry => entry.matchId) } },
  })
  await Promise.all(
    expired.map(entry =>
      defaultCache.invalidate(matchStatsCacheKey(entry.matchId)).catch(() => undefined)
    )
  )
  return expired.length
}

export const matchStatsCacheKey = (matchId: bigint) => `md:stats:${matchId.toString()}`

export const applyStatisticDelta = async (
  tx: Prisma.TransactionClient,
  matchId: bigint,
  clubId: number,
  metric: MatchStatisticMetric,
  delta: number
): Promise<boolean> => {
  if (!clubId) {
    return false
  }

  let entry = await tx.matchStatistic.findUnique({
    where: { matchId_clubId: { matchId, clubId } },
  })

  if (!entry) {
    if (delta < 0) {
      return false
    }
    entry = await tx.matchStatistic.create({
      data: {
        matchId,
        clubId,
      },
    })
  }

  const current: Record<MatchStatisticMetric, number> = {
    totalShots: entry.totalShots,
    shotsOnTarget: entry.shotsOnTarget,
    corners: entry.corners,
    yellowCards: entry.yellowCards,
    redCards: entry.redCards,
  }

  const updates: Prisma.MatchStatisticUncheckedUpdateInput = {}

  if (metric === 'shotsOnTarget') {
    const nextShotsOnTarget = Math.max(0, current.shotsOnTarget + delta)
    const appliedDelta = nextShotsOnTarget - current.shotsOnTarget
    if (appliedDelta === 0) {
      return false
    }
    const nextTotalShots = Math.max(nextShotsOnTarget, current.totalShots + appliedDelta)
    updates.shotsOnTarget = nextShotsOnTarget
    if (nextTotalShots !== current.totalShots) {
      updates.totalShots = nextTotalShots
    }
  } else if (metric === 'totalShots') {
    const nextTotalShots = Math.max(current.shotsOnTarget, current.totalShots + delta)
    if (nextTotalShots === current.totalShots) {
      return false
    }
    updates.totalShots = nextTotalShots
  } else {
    const nextValue = Math.max(0, current[metric] + delta)
    if (nextValue === current[metric]) {
      return false
    }
    updates[metric] = nextValue
  }

  await tx.matchStatistic.update({
    where: { matchId_clubId: { matchId, clubId } },
    data: updates,
  })

  return true
}

export const applyStatisticAdjustments = async (
  tx: Prisma.TransactionClient,
  matchId: bigint,
  clubId: number,
  adjustments: EventStatisticAdjustments | undefined,
  direction: 1 | -1
): Promise<boolean> => {
  if (!adjustments || !clubId) {
    return false
  }
  let changed = false
  for (const [metric, amount] of Object.entries(adjustments) as Array<
    [MatchStatisticMetric, number]
  >) {
    if (!amount) continue
    const delta = amount * direction
    if (!delta) continue
    const applied = await applyStatisticDelta(tx, matchId, clubId, metric, delta)
    changed = changed || applied
  }
  return changed
}

type MatchWithRelations = Prisma.MatchGetPayload<{
  include: {
    homeClub: { select: { id: true; name: true; shortName: true } }
    awayClub: { select: { id: true; name: true; shortName: true } }
    statistics: {
      include: {
        club: {
          select: { id: true; name: true; shortName: true }
        }
      }
    }
  }
}>

type MatchStatisticView = {
  matchId: string
  clubId: number
  totalShots: number
  shotsOnTarget: number
  corners: number
  yellowCards: number
  redCards: number
  createdAt: Date
  updatedAt: Date
  club: { id: number; name: string; shortName: string | null }
}

const fetchMatchStatisticPayload = async (matchId: bigint): Promise<MatchStatisticView[]> => {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      homeClub: { select: { id: true, name: true, shortName: true } },
      awayClub: { select: { id: true, name: true, shortName: true } },
      statistics: {
        include: {
          club: { select: { id: true, name: true, shortName: true } },
        },
      },
    },
  })

  if (!match) {
    throw new RequestError(404, 'match_not_found')
  }

  let statistics = match.statistics

  const now = new Date()
  await cleanupExpiredMatchStatistics(now).catch(() => undefined)

  if (hasMatchStatisticsExpired(match.matchDateTime, now)) {
    if (statistics.length) {
      await prisma.matchStatistic.deleteMany({ where: { matchId } })
    }
    statistics = []
  }

  const clubFallback = async (clubId: number) => {
    const fallback = await prisma.club.findUnique({
      where: { id: clubId },
      select: { id: true, name: true, shortName: true },
    })
    if (!fallback) {
      throw new RequestError(404, 'match_club_not_found')
    }
    return fallback
  }

  const homeClub = match.homeClub ?? (await clubFallback(match.homeTeamId))
  const awayClub = match.awayClub ?? (await clubFallback(match.awayTeamId))

  const statsByClub = new Map<number, MatchWithRelations['statistics'][number]>()
  for (const entry of statistics) {
    statsByClub.set(entry.clubId, entry)
  }

  const base = [
    { clubId: homeClub.id, club: homeClub },
    { clubId: awayClub.id, club: awayClub },
  ]

  return base.map(({ clubId, club }) => {
    const stat = statsByClub.get(clubId)
    return {
      matchId: match.id.toString(),
      clubId,
      totalShots: stat?.totalShots ?? 0,
      shotsOnTarget: stat?.shotsOnTarget ?? 0,
      corners: stat?.corners ?? 0,
      yellowCards: stat?.yellowCards ?? 0,
      redCards: stat?.redCards ?? 0,
      createdAt: stat?.createdAt ?? match.createdAt,
      updatedAt: stat?.updatedAt ?? match.updatedAt,
      club: {
        id: club.id,
        name: club.name,
        shortName: club.shortName,
      },
    }
  })
}

export const getMatchStatisticsWithMeta = (matchId: bigint) =>
  defaultCache.getWithMeta(
    matchStatsCacheKey(matchId),
    () => fetchMatchStatisticPayload(matchId),
    MATCH_STATS_CACHE_TTL_SECONDS
  )

export const broadcastMatchStatistics = async (server: FastifyInstance, matchId: bigint) => {
  await defaultCache.invalidate(matchStatsCacheKey(matchId)).catch(() => undefined)
  const { value, version } = await getMatchStatisticsWithMeta(matchId)
  const serialized = serializePrisma(value)
  const topic = `match:${matchId.toString()}:stats`
  if (typeof server.publishTopic === 'function') {
    await server.publishTopic(topic, { type: 'full', version, data: serialized })
  }
  return { serialized, version }
}

export const broadcastMatchEvents = async (server: FastifyInstance, matchId: bigint) => {
  const events = await loadMatchEventsWithRoster(matchId)
  const serialized = serializePrisma(events)
  if (typeof server.publishTopic === 'function') {
    await server.publishTopic(`match:${matchId.toString()}:events`, {
      type: 'full',
      data: serialized,
    })
  }
  return serialized
}

export const loadMatchEventsWithRoster = async (matchId: bigint) => {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: { seasonId: true },
  })
  if (!match) {
    throw new RequestError(404, 'match_not_found')
  }

  const events = await prisma.matchEvent.findMany({
    where: { matchId },
    orderBy: [{ minute: 'asc' }, { id: 'asc' }],
    include: {
      player: true,
      relatedPerson: true,
      team: true,
    },
  })

  if (events.length === 0) {
    return []
  }

  const personIds = new Set<number>()
  for (const event of events) {
    personIds.add(event.playerId)
    if (event.relatedPlayerId) {
      personIds.add(event.relatedPlayerId)
    }
  }

  const rosterNumbers = await prisma.seasonRoster.findMany({
    where: {
      seasonId: match.seasonId,
      personId: { in: Array.from(personIds) },
    },
    select: { personId: true, shirtNumber: true },
  })

  const shirtMap = new Map<number, number>()
  rosterNumbers.forEach(entry => {
    shirtMap.set(entry.personId, entry.shirtNumber)
  })

  return events.map(event => {
    const playerShirt = shirtMap.get(event.playerId) ?? null
    const relatedShirt = event.relatedPlayerId
      ? (shirtMap.get(event.relatedPlayerId) ?? null)
      : null
    return {
      ...event,
      player: {
        ...event.player,
        shirtNumber: playerShirt,
      },
      relatedPerson: event.relatedPerson
        ? {
            ...event.relatedPerson,
            shirtNumber: relatedShirt,
          }
        : event.relatedPerson,
    }
  })
}

export const createMatchEvent = async (
  matchId: bigint,
  payload: MatchEventPayload
): Promise<{ event: MatchEvent; statAdjusted: boolean }> => {
  return prisma.$transaction(async tx => {
    const event = await tx.matchEvent.create({
      data: {
        matchId,
        playerId: payload.playerId,
        teamId: payload.teamId,
        minute: payload.minute,
        eventType: payload.eventType,
        relatedPlayerId: payload.relatedPlayerId ?? null,
      },
    })

    const adjustments = eventStatisticAdjustments[event.eventType]
    const statAdjusted = await applyStatisticAdjustments(tx, matchId, event.teamId, adjustments, 1)
    return { event, statAdjusted }
  })
}

export const updateMatchEvent = async (
  matchId: bigint,
  eventId: bigint,
  payload: MatchEventUpdatePayload
): Promise<{ event: MatchEvent; statAdjusted: boolean }> => {
  return prisma.$transaction(async tx => {
    const before = await tx.matchEvent.findUnique({ where: { id: eventId } })
    if (!before) {
      throw new RequestError(404, 'event_not_found')
    }

    const event = await tx.matchEvent.update({
      where: { id: eventId },
      data: {
        minute: payload.minute ?? undefined,
        eventType: payload.eventType ?? undefined,
        teamId: payload.teamId ?? undefined,
        playerId: payload.playerId ?? undefined,
        relatedPlayerId: payload.relatedPlayerId ?? undefined,
      },
    })

    let statAdjusted = false
    const beforeAdjustments = eventStatisticAdjustments[before.eventType]
    const afterAdjustments = eventStatisticAdjustments[event.eventType]

    if (before.teamId !== event.teamId || before.eventType !== event.eventType) {
      if (beforeAdjustments) {
        const changed = await applyStatisticAdjustments(
          tx,
          matchId,
          before.teamId,
          beforeAdjustments,
          -1
        )
        statAdjusted = statAdjusted || changed
      }

      if (afterAdjustments) {
        const changed = await applyStatisticAdjustments(
          tx,
          matchId,
          event.teamId,
          afterAdjustments,
          1
        )
        statAdjusted = statAdjusted || changed
      }
    }

    return { event, statAdjusted }
  })
}

export const deleteMatchEvent = async (
  matchId: bigint,
  eventId: bigint
): Promise<{ statAdjusted: boolean; deleted: true }> => {
  return prisma.$transaction(async tx => {
    const existing = await tx.matchEvent.findUnique({ where: { id: eventId } })
    if (!existing) {
      throw new RequestError(404, 'event_not_found')
    }

    await tx.matchEvent.delete({ where: { id: eventId } })

    let statAdjusted = false
    const adjustments = eventStatisticAdjustments[existing.eventType]
    if (adjustments) {
      const changed = await applyStatisticAdjustments(tx, matchId, existing.teamId, adjustments, -1)
      statAdjusted = statAdjusted || changed
    }

    return { statAdjusted, deleted: true as const }
  })
}

export const ensureMatchForJudge = async (
  matchId: bigint,
  options?: {
    allowedStatuses?: MatchStatus[]
    errorCode?: string
  }
) => {
  const allowed = options?.allowedStatuses ?? [MatchStatus.LIVE, MatchStatus.FINISHED]
  const defaultError =
    allowed.includes(MatchStatus.LIVE) &&
    allowed.includes(MatchStatus.FINISHED) &&
    allowed.length === 2
      ? 'match_not_finished'
      : 'match_not_available'
  const errorCode = options?.errorCode ?? defaultError

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      homeClub: true,
      awayClub: true,
      season: {
        include: {
          competition: {
            select: {
              id: true,
              name: true,
              type: true,
              seriesFormat: true,
            },
          },
        },
      },
    },
  })

  if (!match) {
    throw new RequestError(404, 'match_not_found')
  }

  if (!allowed.includes(match.status)) {
    throw new RequestError(409, errorCode)
  }

  return match
}

export const loadMatchLineupWithNumbers = async (matchId: bigint) => {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: { seasonId: true },
  })
  if (!match) {
    throw new RequestError(404, 'match_not_found')
  }

  const lineup = await prisma.matchLineup.findMany({
    where: { matchId },
    orderBy: [{ role: 'asc' }, { personId: 'asc' }],
    include: {
      person: true,
      club: true,
    },
  })

  if (lineup.length === 0) {
    return []
  }

  const rosterNumbers = await prisma.seasonRoster.findMany({
    where: {
      seasonId: match.seasonId,
      personId: { in: lineup.map(entry => entry.personId) },
    },
    select: { personId: true, shirtNumber: true },
  })

  const shirtMap = new Map<number, number>()
  rosterNumbers.forEach(entry => {
    shirtMap.set(entry.personId, entry.shirtNumber)
  })

  return lineup.map(entry => {
    const shirtNumber = shirtMap.get(entry.personId) ?? null
    return {
      ...entry,
      shirtNumber,
      person: {
        ...entry.person,
        shirtNumber,
      },
    }
  })
}

export { MATCH_STATS_CACHE_TTL_SECONDS }
