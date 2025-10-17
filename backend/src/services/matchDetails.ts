import { MatchEventType, MatchStatus } from '@prisma/client'
import { createHash } from 'crypto'
import prisma from '../db'
import type {
  MatchDetailsBroadcast,
  MatchDetailsEventItem,
  MatchDetailsEvents,
  MatchDetailsHeader,
  MatchDetailsLineupPlayer,
  MatchDetailsLineups,
  MatchDetailsStats,
  MatchDetailsStatsEntry,
} from '@shared/types'

export class MatchDetailsError extends Error {
  statusCode: number

  constructor(statusCode: number, code: string) {
    super(code)
    this.name = 'MatchDetailsError'
    this.statusCode = statusCode
  }
}

export type MatchTtlCategory = 'live' | 'scheduled' | 'finished'

type CachedResource<T> = {
  payload: T
  ttlCategory: MatchTtlCategory
  metadata?: {
    availableUntil?: number
  }
}

const LIVE_POLL_MINUTES_LIMIT = 120
const STAT_RETENTION_MS = 60 * 60 * 1000

const computeCurrentMinute = (status: MatchStatus, matchDateTime: Date): number | null => {
  if (status !== MatchStatus.LIVE) {
    return null
  }
  const diffMinutes = Math.floor((Date.now() - matchDateTime.getTime()) / 60000)
  if (!Number.isFinite(diffMinutes)) {
    return null
  }
  if (diffMinutes < 0) {
    return 0
  }
  return Math.min(LIVE_POLL_MINUTES_LIMIT, diffMinutes)
}

const computeTeamVersion = (value: unknown): string => {
  const json = JSON.stringify(value)
  return createHash('sha1').update(json).digest('hex').slice(0, 12)
}

const determineTtlCategory = (status: MatchStatus): MatchTtlCategory => {
  if (status === MatchStatus.LIVE) {
    return 'live'
  }
  if (status === MatchStatus.FINISHED) {
    return 'finished'
  }
  return 'scheduled'
}

const loadMatchBase = async (matchId: bigint) => {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      homeClub: { select: { name: true, shortName: true, logoUrl: true } },
      awayClub: { select: { name: true, shortName: true, logoUrl: true } },
      stadium: { select: { name: true, city: true } },
    },
  })
  if (!match) {
    throw new MatchDetailsError(404, 'match_not_found')
  }
  return match
}

export const buildMatchHeaderEntry = async (
  matchId: bigint
): Promise<CachedResource<MatchDetailsHeader>> => {
  const match = await loadMatchBase(matchId)
  const ttlCategory = determineTtlCategory(match.status)

  const header: MatchDetailsHeader = {
    status: match.status,
    matchDateTime: match.matchDateTime.toISOString(),
    updatedAt: match.updatedAt.toISOString(),
    currentMinute: computeCurrentMinute(match.status, match.matchDateTime),
    venue: match.stadium
      ? {
          city: match.stadium.city,
          stadium: match.stadium.name,
        }
      : undefined,
    homeTeam: {
      name: match.homeClub.name,
      shortName: match.homeClub.shortName,
      logo: match.homeClub.logoUrl,
      score: match.homeScore,
      penaltyScore: match.hasPenaltyShootout ? match.penaltyHomeScore : null,
    },
    awayTeam: {
      name: match.awayClub.name,
      shortName: match.awayClub.shortName,
      logo: match.awayClub.logoUrl,
      score: match.awayScore,
      penaltyScore: match.hasPenaltyShootout ? match.penaltyAwayScore : null,
    },
  }

  return {
    payload: header,
    ttlCategory,
  }
}

const loadRosterNumbers = async (seasonId: number, personIds: number[]) => {
  if (personIds.length === 0) {
    return new Map<number, number>()
  }
  const roster = await prisma.seasonRoster.findMany({
    where: {
      seasonId,
      personId: { in: personIds },
    },
    select: {
      personId: true,
      shirtNumber: true,
    },
  })
  const map = new Map<number, number>()
  roster.forEach(entry => {
    map.set(entry.personId, entry.shirtNumber)
  })
  return map
}

const simplifyName = (value: string): string => value.trim()

export const buildMatchLineupsEntry = async (
  matchId: bigint
): Promise<CachedResource<MatchDetailsLineups>> => {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      status: true,
      seasonId: true,
      homeTeamId: true,
      awayTeamId: true,
    },
  })
  if (!match) {
    throw new MatchDetailsError(404, 'match_not_found')
  }

  const ttlCategory = determineTtlCategory(match.status)

  const lineups = await prisma.matchLineup.findMany({
    where: { matchId },
    orderBy: [{ role: 'asc' }, { personId: 'asc' }],
    select: {
      clubId: true,
      person: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
      personId: true,
    },
  })

  const personIds = lineups.map(entry => entry.personId)
  const shirtNumbers = await loadRosterNumbers(match.seasonId, personIds)

  const homePlayers: MatchDetailsLineupPlayer[] = []
  const awayPlayers: MatchDetailsLineupPlayer[] = []

  for (const entry of lineups) {
    const player: MatchDetailsLineupPlayer = {
      firstName: simplifyName(entry.person.firstName),
      lastName: simplifyName(entry.person.lastName),
      shirtNumber: shirtNumbers.get(entry.personId) ?? null,
    }
    if (entry.clubId === match.homeTeamId) {
      homePlayers.push(player)
    } else if (entry.clubId === match.awayTeamId) {
      awayPlayers.push(player)
    }
  }

  const payload: MatchDetailsLineups = {
    homeTeam: {
      version: computeTeamVersion(homePlayers),
      players: homePlayers,
    },
    awayTeam: {
      version: computeTeamVersion(awayPlayers),
      players: awayPlayers,
    },
  }

  return {
    payload,
    ttlCategory,
  }
}

const normalizeEventPlayer = (
  firstName: string,
  lastName: string,
  shirtNumber: number | null
) => ({
  firstName: simplifyName(firstName),
  lastName: simplifyName(lastName),
  shirtNumber,
})

const mapEventTeam = (
  teamId: number,
  homeTeamId: number,
  awayTeamId: number
): 'HOME' | 'AWAY' => {
  if (teamId === homeTeamId) {
    return 'HOME'
  }
  if (teamId === awayTeamId) {
    return 'AWAY'
  }
  return 'HOME'
}

export const buildMatchEventsEntry = async (
  matchId: bigint
): Promise<CachedResource<MatchDetailsEvents>> => {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      status: true,
      seasonId: true,
      homeTeamId: true,
      awayTeamId: true,
    },
  })
  if (!match) {
    throw new MatchDetailsError(404, 'match_not_found')
  }

  const ttlCategory = determineTtlCategory(match.status)

  const events = await prisma.matchEvent.findMany({
    where: { matchId },
    orderBy: [{ minute: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      eventType: true,
      minute: true,
      teamId: true,
      playerId: true,
      relatedPlayerId: true,
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
  })

  const personIds = new Set<number>()
  events.forEach(entry => {
    personIds.add(entry.playerId)
    if (entry.relatedPlayerId) {
      personIds.add(entry.relatedPlayerId)
    }
  })

  const shirtNumbers = await loadRosterNumbers(match.seasonId, Array.from(personIds))

  const items: MatchDetailsEventItem[] = events.map(entry => {
    const team = mapEventTeam(entry.teamId, match.homeTeamId, match.awayTeamId)
    const primary = normalizeEventPlayer(
      entry.player.firstName,
      entry.player.lastName,
      shirtNumbers.get(entry.playerId) ?? null
    )
    const secondary = entry.relatedPlayerId
      ? normalizeEventPlayer(
          entry.relatedPerson?.firstName ?? '',
          entry.relatedPerson?.lastName ?? '',
          shirtNumbers.get(entry.relatedPlayerId) ?? null
        )
      : null
    return {
      id: entry.id.toString(),
      minute: entry.minute,
      eventType: entry.eventType as MatchEventType,
      team,
      primary,
      secondary,
    }
  })

  const payload: MatchDetailsEvents = {
    version: computeTeamVersion(items),
    events: items,
  }

  return {
    payload,
    ttlCategory,
  }
}

const buildStatsEntry = (stats: MatchDetailsStatsEntry, fallbackVersionBase: string) => ({
  version: computeTeamVersion({ base: fallbackVersionBase, stats }),
  stats,
})

export const buildMatchStatsEntry = async (
  matchId: bigint
): Promise<CachedResource<MatchDetailsStats>> => {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      status: true,
      updatedAt: true,
      homeTeamId: true,
      awayTeamId: true,
    },
  })
  if (!match) {
    throw new MatchDetailsError(404, 'match_not_found')
  }

  const ttlCategory = determineTtlCategory(match.status)
  const statistics = await prisma.matchStatistic.findMany({
    where: { matchId },
    select: {
      clubId: true,
      totalShots: true,
      shotsOnTarget: true,
      corners: true,
      yellowCards: true,
    },
  })

  const byClub = new Map<number, MatchDetailsStatsEntry>()
  statistics.forEach(entry => {
    byClub.set(entry.clubId, {
      shots: entry.totalShots,
      shotsOnTarget: entry.shotsOnTarget,
      corners: entry.corners,
      yellowCards: entry.yellowCards,
    })
  })

  const homeStats: MatchDetailsStatsEntry =
    byClub.get(match.homeTeamId) ?? {
      shots: 0,
      shotsOnTarget: 0,
      corners: 0,
      yellowCards: 0,
    }
  const awayStats: MatchDetailsStatsEntry =
    byClub.get(match.awayTeamId) ?? {
      shots: 0,
      shotsOnTarget: 0,
      corners: 0,
      yellowCards: 0,
    }

  const payload: MatchDetailsStats = {
    homeTeam: buildStatsEntry(homeStats, 'home'),
    awayTeam: buildStatsEntry(awayStats, 'away'),
  }

  const metadata = match.status === MatchStatus.FINISHED
    ? { availableUntil: match.updatedAt.getTime() + STAT_RETENTION_MS }
    : undefined

  return {
    payload,
    ttlCategory,
    metadata,
  }
}

export const buildMatchBroadcastEntry = async (
  matchId: bigint
): Promise<CachedResource<MatchDetailsBroadcast>> => {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: { status: true },
  })
  if (!match) {
    throw new MatchDetailsError(404, 'match_not_found')
  }

  const payload: MatchDetailsBroadcast = { status: 'not_available' }

  return {
    payload,
    ttlCategory: determineTtlCategory(match.status),
  }
}
