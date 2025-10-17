/**
 * Public Match Details Service
 * Provides minimal, optimized payloads for frontend match details screen
 * with Redis caching and ETag support
 */

import prisma from '../db'
import { defaultCache } from '../cache'
import { MatchStatus, LineupRole } from '@prisma/client'

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

const REDIS_PREFIX = 'pub:md:'
const TTL_HEADER_SECONDS = 6
const TTL_LINEUPS_SECONDS = 15 * 60
const TTL_STATS_SECONDS = 8
const TTL_EVENTS_SECONDS = 6
const TTL_BROADCAST_SECONDS = 24 * 60 * 60 // 1 day

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
): Promise<MatchDetailsHeader | null> {
  const key = `${REDIS_PREFIX}${matchId}:header`

  const result = await defaultCache.get(key, async () => {
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

  return result
}

/**
 * Fetch match lineups (both teams)
 */
export async function fetchMatchLineups(
  matchId: string
): Promise<MatchDetailsLineups | null> {
  const key = `${REDIS_PREFIX}${matchId}:lineups`

  const result = await defaultCache.get(key, async () => {
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
      .map((lp, idx) => ({
        fn: lp.person.firstName,
        ln: lp.person.lastName,
        sn: shirtNumbers.get(lp.personId) ?? 0,
      }))

    const awayPlayers = match.lineups
      .filter(lp => lp.clubId === match.awayTeamId)
      .map((lp, idx) => ({
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

  return result
}

/**
 * Fetch match statistics (shots, corners, cards, etc.)
 */
export async function fetchMatchStats(
  matchId: string
): Promise<MatchDetailsStats | null> {
  const key = `${REDIS_PREFIX}${matchId}:stats`

  const result = await defaultCache.get(key, async () => {
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

  return result
}

/**
 * Fetch match events (goals, cards, substitutions)
 */
export async function fetchMatchEvents(
  matchId: string
): Promise<MatchDetailsEvents | null> {
  const key = `${REDIS_PREFIX}${matchId}:events`

  const result = await defaultCache.get(key, async () => {
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
      const team = ev.teamId === match.homeTeamId ? ('home' as const) : ('away' as const)
      const playerName = ev.player
        ? `${ev.player.firstName} ${ev.player.lastName}`
        : undefined

      const relatedName = ev.relatedPerson
        ? `${ev.relatedPerson.firstName} ${ev.relatedPerson.lastName}`
        : undefined

      const event: any = {
        id: ev.id.toString(),
        min: ev.minute,
        tp: ev.eventType as any,
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

  return result
}

/**
 * Fetch broadcast info (stub for now)
 */
export async function fetchMatchBroadcast(
  matchId: string
): Promise<MatchDetailsBroadcast> {
  const key = `${REDIS_PREFIX}${matchId}:broadcast`

  const result = await defaultCache.get(
    key,
    async () => {
      // Stub: always return not_available
      return { st: 'not_available' as const }
    },
    { ttlSeconds: TTL_BROADCAST_SECONDS }
  )

  return result
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
