import { MatchStatus, RoundType } from '@prisma/client'
import prisma from '../db'
import { defaultCache } from '../cache'
import type { SeasonWithCompetition, LeagueSeasonSummary } from './leagueTable'
import { ensureSeasonSummary } from './leagueTable'

type ClubSummary = {
  id: number
  name: string
  shortName: string
  logoUrl: string | null
}

type MatchLocation = {
  stadiumId: number | null
  stadiumName: string | null
  city: string | null
}

export type LeagueMatchView = {
  id: string
  matchDateTime: string
  status: MatchStatus
  homeClub: ClubSummary
  awayClub: ClubSummary
  homeScore: number
  awayScore: number
  hasPenaltyShootout: boolean
  penaltyHomeScore: number | null
  penaltyAwayScore: number | null
  location: MatchLocation | null
}

export type LeagueRoundMatches = {
  roundId: number | null
  roundNumber: number | null
  roundLabel: string
  roundType: RoundType | null
  matches: LeagueMatchView[]
}

export interface LeagueRoundCollection {
  season: LeagueSeasonSummary
  rounds: LeagueRoundMatches[]
  generatedAt: string
}

export const PUBLIC_LEAGUE_SCHEDULE_KEY = 'public:league:schedule'
export const PUBLIC_LEAGUE_RESULTS_KEY = 'public:league:results'
export const PUBLIC_LEAGUE_SCHEDULE_TTL_SECONDS = 8
export const PUBLIC_LEAGUE_RESULTS_TTL_SECONDS = 15

type PublishFn = (topic: string, payload: unknown) => Promise<unknown>

type RoundAccumulator = {
  roundId: number | null
  roundNumber: number | null
  roundLabel: string
  roundType: RoundType | null
  matches: LeagueMatchView[]
  firstMatchAt: number
  lastMatchAt: number
}

const clubSelect = {
  id: true,
  name: true,
  shortName: true,
  logoUrl: true,
} as const

const roundSelect = {
  id: true,
  roundNumber: true,
  label: true,
  roundType: true,
} as const

const stadiumSelect = {
  id: true,
  name: true,
  city: true,
} as const

const deriveRoundLabel = (
  round: { label: string; roundNumber: number | null } | null | undefined
): string => {
  if (!round) {
    return 'Без тура'
  }
  if (round.label?.trim()) {
    return round.label.trim()
  }
  if (typeof round.roundNumber === 'number' && Number.isFinite(round.roundNumber)) {
    return `Тур ${round.roundNumber}`
  }
  return 'Без тура'
}

const buildMatchView = (
  match: {
    id: bigint
    matchDateTime: Date
    status: MatchStatus
    homeScore: number
    awayScore: number
    hasPenaltyShootout: boolean
    penaltyHomeScore: number
    penaltyAwayScore: number
    homeClub: ClubSummary
    awayClub: ClubSummary
    stadium: MatchLocation | null
  }
): LeagueMatchView => {
  return {
    id: match.id.toString(),
    matchDateTime: match.matchDateTime.toISOString(),
    status: match.status,
    homeClub: match.homeClub,
    awayClub: match.awayClub,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    hasPenaltyShootout: match.hasPenaltyShootout,
    penaltyHomeScore: match.hasPenaltyShootout ? match.penaltyHomeScore : null,
    penaltyAwayScore: match.hasPenaltyShootout ? match.penaltyAwayScore : null,
    location: match.stadium,
  }
}

const groupMatchesByRound = (
  matches: Array<{
    id: bigint
    matchDateTime: Date
    status: MatchStatus
    homeScore: number
    awayScore: number
    hasPenaltyShootout: boolean
    penaltyHomeScore: number
    penaltyAwayScore: number
    homeClub: ClubSummary
    awayClub: ClubSummary
    stadium: MatchLocation | null
    round: { id: number; roundNumber: number | null; label: string; roundType: RoundType } | null
  }>,
  options: { limit?: number; order: 'asc' | 'desc' }
): LeagueRoundMatches[] => {
  const map = new Map<string, RoundAccumulator>()

  for (const match of matches) {
    const key = match.round?.id ? `round:${match.round.id}` : 'round:none'
    const roundNumber = match.round?.roundNumber ?? null
    const roundLabel = deriveRoundLabel(match.round)
    const roundType = match.round?.roundType ?? null
    const matchTime = match.matchDateTime.getTime()
    let entry = map.get(key)
    if (!entry) {
      entry = {
        roundId: match.round?.id ?? null,
        roundNumber,
        roundLabel,
        roundType,
        matches: [],
        firstMatchAt: matchTime,
        lastMatchAt: matchTime,
      }
      map.set(key, entry)
    }
    entry.firstMatchAt = Math.min(entry.firstMatchAt, matchTime)
    entry.lastMatchAt = Math.max(entry.lastMatchAt, matchTime)
    entry.matches.push(buildMatchView(match))
  }

  const rounds = Array.from(map.values())
  const sorted = rounds.sort((left, right) => {
    const leftNumber = left.roundNumber ?? Number.POSITIVE_INFINITY
    const rightNumber = right.roundNumber ?? Number.POSITIVE_INFINITY
    if (options.order === 'asc') {
      if (leftNumber !== rightNumber) {
        return leftNumber - rightNumber
      }
      if (left.firstMatchAt !== right.firstMatchAt) {
        return left.firstMatchAt - right.firstMatchAt
      }
      return left.roundLabel.localeCompare(right.roundLabel, 'ru')
    }
    // desc order for results
    const leftDesc = left.roundNumber ?? Number.NEGATIVE_INFINITY
    const rightDesc = right.roundNumber ?? Number.NEGATIVE_INFINITY
    if (leftDesc !== rightDesc) {
      return rightDesc - leftDesc
    }
    if (left.lastMatchAt !== right.lastMatchAt) {
      return right.lastMatchAt - left.lastMatchAt
    }
    return right.roundLabel.localeCompare(left.roundLabel, 'ru')
  })

  const limited = typeof options.limit === 'number' ? sorted.slice(0, options.limit) : sorted

  return limited.map(round => ({
    roundId: round.roundId,
    roundNumber: round.roundNumber,
    roundLabel: round.roundLabel,
    roundType: round.roundType,
    matches: round.matches.sort((a, b) => a.matchDateTime.localeCompare(b.matchDateTime)),
  }))
}

export const buildLeagueSchedule = async (
  season: SeasonWithCompetition,
  limitRounds = 4
): Promise<LeagueRoundCollection> => {
  const matches = await prisma.match.findMany({
    where: {
      seasonId: season.id,
      status: {
        in: [MatchStatus.SCHEDULED, MatchStatus.LIVE, MatchStatus.POSTPONED],
      },
    },
    orderBy: [{ matchDateTime: 'asc' }],
    include: {
      homeClub: { select: clubSelect },
      awayClub: { select: clubSelect },
      stadium: { select: stadiumSelect },
      round: { select: roundSelect },
    },
  })

  const grouped = groupMatchesByRound(
    matches.map(match => ({
      ...match,
      stadium: match.stadium
        ? {
            stadiumId: match.stadium.id,
            stadiumName: match.stadium.name,
            city: match.stadium.city,
          }
        : null,
    })),
    { limit: limitRounds, order: 'asc' }
  )

  return {
    season: ensureSeasonSummary(season),
    rounds: grouped,
    generatedAt: new Date().toISOString(),
  }
}

export const buildLeagueResults = async (
  season: SeasonWithCompetition,
  limitRounds = 4
): Promise<LeagueRoundCollection> => {
  const matches = await prisma.match.findMany({
    where: {
      seasonId: season.id,
      status: MatchStatus.FINISHED,
    },
    orderBy: [{ matchDateTime: 'desc' }],
    include: {
      homeClub: { select: clubSelect },
      awayClub: { select: clubSelect },
      stadium: { select: stadiumSelect },
      round: { select: roundSelect },
    },
  })

  const grouped = groupMatchesByRound(
    matches.map(match => ({
      ...match,
      stadium: match.stadium
        ? {
            stadiumId: match.stadium.id,
            stadiumName: match.stadium.name,
            city: match.stadium.city,
          }
        : null,
    })),
    { limit: limitRounds, order: 'desc' }
  )

  return {
    season: ensureSeasonSummary(season),
    rounds: grouped,
    generatedAt: new Date().toISOString(),
  }
}

export const refreshLeagueMatchAggregates = async (
  seasonId: number,
  options?: { publishTopic?: PublishFn }
): Promise<{ schedule: LeagueRoundCollection; results: LeagueRoundCollection } | null> => {
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    include: { competition: true },
  })

  if (!season) {
    return null
  }

  const [schedule, results] = await Promise.all([
    buildLeagueSchedule(season),
    buildLeagueResults(season),
  ])

  await Promise.all([
    defaultCache.set(PUBLIC_LEAGUE_SCHEDULE_KEY, schedule, PUBLIC_LEAGUE_SCHEDULE_TTL_SECONDS),
    defaultCache.set(
      `${PUBLIC_LEAGUE_SCHEDULE_KEY}:${seasonId}`,
      schedule,
      PUBLIC_LEAGUE_SCHEDULE_TTL_SECONDS
    ),
    defaultCache.set(PUBLIC_LEAGUE_RESULTS_KEY, results, PUBLIC_LEAGUE_RESULTS_TTL_SECONDS),
    defaultCache.set(
      `${PUBLIC_LEAGUE_RESULTS_KEY}:${seasonId}`,
      results,
      PUBLIC_LEAGUE_RESULTS_TTL_SECONDS
    ),
  ])

  if (options?.publishTopic) {
    await Promise.all([
      options.publishTopic(PUBLIC_LEAGUE_SCHEDULE_KEY, {
        type: 'league.schedule',
        seasonId: schedule.season.id,
        payload: schedule,
      }).catch(() => undefined),
      options.publishTopic(PUBLIC_LEAGUE_RESULTS_KEY, {
        type: 'league.results',
        seasonId: results.season.id,
        payload: results,
      }).catch(() => undefined),
    ])
  }

  return { schedule, results }
}
