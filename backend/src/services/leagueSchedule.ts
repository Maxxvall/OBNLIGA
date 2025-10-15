import { MatchStatus, RoundType, SeriesStatus } from '@prisma/client'
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
  series?: {
    id: string
    stageName: string
    status: SeriesStatus
    matchNumber: number
    totalMatches: number
    requiredWins: number
    homeWinsBefore: number
    awayWinsBefore: number
    homeWinsAfter: number
    awayWinsAfter: number
    homeClub: ClubSummary
    awayClub: ClubSummary
    homeWinsTotal: number
    awayWinsTotal: number
    winnerClubId: number | null
    homeClubId: number
    awayClubId: number
  }
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
  hasSeries: boolean
  stagePriority: number | null
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

type SeriesMatchSnapshot = {
  id: bigint
  seriesMatchNumber: number | null
  status: MatchStatus
  homeTeamId: number
  awayTeamId: number
  homeScore: number
  awayScore: number
  hasPenaltyShootout: boolean
  penaltyHomeScore: number
  penaltyAwayScore: number
}

type SeriesWithMatches = {
  id: bigint
  stageName: string
  seriesStatus: SeriesStatus
  homeClubId: number
  awayClubId: number
  homeClub: ClubSummary
  awayClub: ClubSummary
  winnerClubId: number | null
  matches: SeriesMatchSnapshot[]
}

type SeriesScoreboardEntry = {
  matchNumber: number
  homeWinsBefore: number
  awayWinsBefore: number
  homeWinsAfter: number
  awayWinsAfter: number
}

type SeriesContext = {
  id: bigint
  stageName: string
  status: SeriesStatus
  totalMatches: number
  requiredWins: number
  homeClub: ClubSummary
  awayClub: ClubSummary
  homeClubId: number
  awayClubId: number
  winnerClubId: number | null
  finalHomeWins: number
  finalAwayWins: number
  scoreboard: Map<number, SeriesScoreboardEntry>
}

type MatchWithRoundView = {
  roundId: number | null
  roundNumber: number | null
  roundLabel: string
  roundType: RoundType | null
  matchDateTime: Date
  view: LeagueMatchView
}

type MatchRecord = {
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
  seriesMatchNumber: number | null
  series: (SeriesWithMatches & { matches: SeriesMatchSnapshot[] }) | null
}

const determineSeriesMatchWinner = (match: SeriesMatchSnapshot): number | null => {
  if (match.homeScore > match.awayScore) return match.homeTeamId
  if (match.homeScore < match.awayScore) return match.awayTeamId
  if (!match.hasPenaltyShootout) return null
  if ((match.penaltyHomeScore ?? 0) > (match.penaltyAwayScore ?? 0)) return match.homeTeamId
  if ((match.penaltyHomeScore ?? 0) < (match.penaltyAwayScore ?? 0)) return match.awayTeamId
  return null
}

const createSeriesContext = (series: SeriesWithMatches): SeriesContext => {
  const sorted = [...series.matches].sort((left, right) => {
    const leftNumber = left.seriesMatchNumber ?? Number.MAX_SAFE_INTEGER
    const rightNumber = right.seriesMatchNumber ?? Number.MAX_SAFE_INTEGER
    if (leftNumber !== rightNumber) {
      return leftNumber - rightNumber
    }
    return left.id === right.id ? 0 : left.id < right.id ? -1 : 1
  })

  let fallbackNumber = 1
  let homeWins = 0
  let awayWins = 0
  const scoreboard = new Map<number, SeriesScoreboardEntry>()

  for (const match of sorted) {
    const matchNumber = match.seriesMatchNumber ?? fallbackNumber
    fallbackNumber = matchNumber + 1
    const entry: SeriesScoreboardEntry = {
      matchNumber,
      homeWinsBefore: homeWins,
      awayWinsBefore: awayWins,
      homeWinsAfter: homeWins,
      awayWinsAfter: awayWins,
    }

    if (match.status === MatchStatus.FINISHED) {
      const winner = determineSeriesMatchWinner(match)
      if (winner === series.homeClubId) {
        homeWins += 1
      } else if (winner === series.awayClubId) {
        awayWins += 1
      }
      entry.homeWinsAfter = homeWins
      entry.awayWinsAfter = awayWins
    }

    scoreboard.set(matchNumber, entry)
  }

  const totalMatches = sorted.length
  const requiredWins = Math.max(1, Math.floor(totalMatches / 2) + 1)
  let winnerClubId = series.winnerClubId ?? null

  if (series.seriesStatus === SeriesStatus.FINISHED) {
    if (homeWins > awayWins) {
      winnerClubId = series.homeClubId
    } else if (awayWins > homeWins) {
      winnerClubId = series.awayClubId
    }
  }

  return {
    id: series.id,
    stageName: series.stageName,
    status: series.seriesStatus,
    totalMatches,
    requiredWins,
    homeClub: series.homeClub,
    awayClub: series.awayClub,
    homeClubId: series.homeClubId,
    awayClubId: series.awayClubId,
    winnerClubId,
    finalHomeWins: homeWins,
    finalAwayWins: awayWins,
    scoreboard,
  }
}

const shouldDisplaySeriesMatch = (
  context: SeriesContext,
  entry: SeriesScoreboardEntry,
  status: MatchStatus
): boolean => {
  if (status === MatchStatus.LIVE) {
    return true
  }
  if (context.status === SeriesStatus.FINISHED) {
    return false
  }

  const initialVisible = Math.min(context.totalMatches || entry.matchNumber, context.requiredWins)
  if (entry.matchNumber <= initialVisible) {
    return true
  }

  const finishedBefore = entry.homeWinsBefore + entry.awayWinsBefore
  const precedingMatches = entry.matchNumber - 1
  if (finishedBefore < precedingMatches) {
    return false
  }

  const leaderWins = Math.max(entry.homeWinsBefore, entry.awayWinsBefore)
  if (leaderWins >= context.requiredWins) {
    return false
  }

  return true
}

const deriveSeriesStagePriority = (stageName: string): number => {
  if (!stageName) {
    return 1000
  }

  const normalized = stageName.trim().toLowerCase()
  if (!normalized) {
    return 1000
  }

  if (
    normalized.includes('матч за 3') ||
    normalized.includes('треть') ||
    normalized.includes('3 место') ||
    normalized.includes('малый финал') ||
    normalized.includes('small final')
  ) {
    return 2
  }

  if (
    normalized.includes('полуфин') ||
    normalized.includes('semi') ||
    normalized.includes('1/2') ||
    normalized.includes('1\\2')
  ) {
    return 3
  }

  if (normalized.includes('четверть') || normalized.includes('1/4') || normalized.includes('1\\4')) {
    return 4
  }

  if (normalized.includes('1/8') || normalized.includes('1\\8') || normalized.includes('восьм')) {
    return 5
  }

  if (normalized.includes('1/16') || normalized.includes('1\\16') || normalized.includes('шестнадц')) {
    return 6
  }

  if (normalized.includes('1/32') || normalized.includes('1\\32') || normalized.includes('тридцат')) {
    return 7
  }

  if (normalized.includes('1/64') || normalized.includes('1\\64')) {
    return 8
  }

  if (normalized.includes('плей-ин') || normalized.includes('play-in') || normalized.includes('плейин')) {
    return 20
  }

  if (normalized.includes('финал') || normalized.includes('final')) {
    return 1
  }

  return 1000
}

const buildMatchView = (
  match: MatchRecord,
  mode: 'schedule' | 'results',
  cache: Map<bigint, SeriesContext>
): LeagueMatchView | null => {
  const base: LeagueMatchView = {
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

  const seriesData = match.series
  if (!seriesData) {
    return base
  }

  const cacheKey = seriesData.id
  let context = cache.get(cacheKey)
  if (!context) {
    context = createSeriesContext(seriesData)
    cache.set(cacheKey, context)
  }

  const matchNumber = match.seriesMatchNumber ?? context.scoreboard.size + 1
  const scoreboard = context.scoreboard.get(matchNumber) ?? {
    matchNumber,
    homeWinsBefore: 0,
    awayWinsBefore: 0,
    homeWinsAfter: 0,
    awayWinsAfter: 0,
  }

  if (mode === 'schedule' && !shouldDisplaySeriesMatch(context, scoreboard, match.status)) {
    return null
  }

  base.series = {
    id: context.id.toString(),
    stageName: context.stageName,
    status: context.status,
    matchNumber,
    totalMatches: context.totalMatches,
    requiredWins: context.requiredWins,
    homeWinsBefore: scoreboard.homeWinsBefore,
    awayWinsBefore: scoreboard.awayWinsBefore,
    homeWinsAfter: scoreboard.homeWinsAfter,
    awayWinsAfter: scoreboard.awayWinsAfter,
    homeClub: context.homeClub,
    awayClub: context.awayClub,
    homeWinsTotal: context.finalHomeWins,
    awayWinsTotal: context.finalAwayWins,
    winnerClubId: context.winnerClubId,
    homeClubId: context.homeClubId,
    awayClubId: context.awayClubId,
  }

  return base
}

const transformMatches = (
  matches: MatchRecord[],
  mode: 'schedule' | 'results'
): MatchWithRoundView[] => {
  const seriesCache = new Map<bigint, SeriesContext>()
  const result: MatchWithRoundView[] = []

  for (const match of matches) {
    const view = buildMatchView(match, mode, seriesCache)
    if (!view) continue

    result.push({
      roundId: match.round?.id ?? null,
      roundNumber: match.round?.roundNumber ?? null,
      roundLabel: deriveRoundLabel(match.round),
      roundType: match.round?.roundType ?? null,
      matchDateTime: match.matchDateTime,
      view,
    })
  }

  return result
}

const groupMatchViewsByRound = (
  matches: MatchWithRoundView[],
  options: { limit?: number; order: 'asc' | 'desc' }
): LeagueRoundMatches[] => {
  const map = new Map<string, RoundAccumulator>()

  for (const entry of matches) {
    const key = entry.roundId ? `round:${entry.roundId}` : 'round:none'
    const matchTime = entry.matchDateTime.getTime()
    let accumulator = map.get(key)
    if (!accumulator) {
      const initialStagePriority = entry.view.series
        ? deriveSeriesStagePriority(entry.view.series.stageName)
        : null
      const created: RoundAccumulator = {
        roundId: entry.roundId,
        roundNumber: entry.roundNumber,
        roundLabel: entry.roundLabel,
        roundType: entry.roundType,
        matches: [],
        firstMatchAt: matchTime,
        lastMatchAt: matchTime,
        hasSeries: Boolean(entry.view.series),
        stagePriority: initialStagePriority,
      }
      map.set(key, created)
      accumulator = created
    }
    accumulator.firstMatchAt = Math.min(accumulator.firstMatchAt, matchTime)
    accumulator.lastMatchAt = Math.max(accumulator.lastMatchAt, matchTime)
    if (entry.view.series) {
      const priority = deriveSeriesStagePriority(entry.view.series.stageName)
      accumulator.hasSeries = true
      accumulator.stagePriority =
        accumulator.stagePriority === null
          ? priority
          : Math.min(accumulator.stagePriority, priority)
    }
    accumulator.matches.push(entry.view)
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
    const leftPriority = left.stagePriority ?? Number.POSITIVE_INFINITY
    const rightPriority = right.stagePriority ?? Number.POSITIVE_INFINITY
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority
    }
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

  const limitCount = typeof options.limit === 'number' ? options.limit : sorted.length
  const initial = sorted.slice(0, limitCount)
  const keyFor = (round: RoundAccumulator) => `${round.roundId ?? 'none'}::${round.roundLabel}`
  const includedKeys = new Set(initial.map(keyFor))

  for (const round of sorted) {
    if (round.roundType === RoundType.PLAYOFF || round.hasSeries) {
      const key = keyFor(round)
      if (!includedKeys.has(key)) {
        includedKeys.add(key)
        initial.push(round)
      }
    }
  }

  const finalRounds = sorted.filter(round => includedKeys.has(keyFor(round)))

  return finalRounds.map(round => ({
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
      series: {
        select: {
          id: true,
          stageName: true,
          seriesStatus: true,
          homeClubId: true,
          awayClubId: true,
          homeClub: { select: clubSelect },
          awayClub: { select: clubSelect },
          matches: {
            select: {
              id: true,
              seriesMatchNumber: true,
              status: true,
              homeTeamId: true,
              awayTeamId: true,
              homeScore: true,
              awayScore: true,
              hasPenaltyShootout: true,
              penaltyHomeScore: true,
              penaltyAwayScore: true,
            },
            orderBy: { seriesMatchNumber: 'asc' },
          },
        },
      },
    },
  })

  const transformed = transformMatches(
    matches.map(match => ({
      ...match,
      stadium: match.stadium
        ? {
            stadiumId: match.stadium.id,
            stadiumName: match.stadium.name,
            city: match.stadium.city,
          }
        : null,
    })) as MatchRecord[],
    'schedule'
  )

  const grouped = groupMatchViewsByRound(transformed, { limit: limitRounds, order: 'asc' })

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
      series: {
        select: {
          id: true,
          stageName: true,
          seriesStatus: true,
          homeClubId: true,
          awayClubId: true,
          homeClub: { select: clubSelect },
          awayClub: { select: clubSelect },
          matches: {
            select: {
              id: true,
              seriesMatchNumber: true,
              status: true,
              homeTeamId: true,
              awayTeamId: true,
              homeScore: true,
              awayScore: true,
              hasPenaltyShootout: true,
              penaltyHomeScore: true,
              penaltyAwayScore: true,
            },
            orderBy: { seriesMatchNumber: 'asc' },
          },
        },
      },
    },
  })

  const transformed = transformMatches(
    matches.map(match => ({
      ...match,
      stadium: match.stadium
        ? {
            stadiumId: match.stadium.id,
            stadiumName: match.stadium.name,
            city: match.stadium.city,
          }
        : null,
    })) as MatchRecord[],
    'results'
  )

  const grouped = groupMatchViewsByRound(transformed, { limit: limitRounds, order: 'desc' })

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
