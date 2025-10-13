import prisma from '../db'
import { defaultCache } from '../cache'
import type { SeasonWithCompetition, LeagueSeasonSummary } from './leagueTable'
import { ensureSeasonSummary } from './leagueTable'

export type PublishFn = (topic: string, payload: unknown) => Promise<unknown>

export interface LeaguePlayerLeaderboardEntry {
  personId: number
  firstName: string
  lastName: string
  clubId: number
  clubName: string
  clubShortName: string
  clubLogoUrl: string | null
  matchesPlayed: number
  goals: number
  assists: number
  penaltyGoals: number
}

export type LeagueStatsCategory = 'goalContribution' | 'scorers' | 'assists'

export interface LeagueStatsSnapshot {
  season: LeagueSeasonSummary
  generatedAt: string
  leaderboards: Record<LeagueStatsCategory, LeaguePlayerLeaderboardEntry[]>
}

export const PUBLIC_LEAGUE_STATS_KEY = 'public:league:stats'
export const PUBLIC_LEAGUE_SCORERS_KEY = 'public:league:top-scorers'
export const PUBLIC_LEAGUE_ASSISTS_KEY = 'public:league:top-assists'
export const PUBLIC_LEAGUE_GOAL_CONTRIBUTORS_KEY = 'public:league:goal-contributors'

export const PUBLIC_LEAGUE_STATS_TTL_SECONDS = 30
export const PUBLIC_LEAGUE_LEADERBOARD_TTL_SECONDS = 300
const LEADERBOARD_LIMIT = 15

const personSelect = {
  id: true,
  firstName: true,
  lastName: true,
} as const

const clubSelect = {
  id: true,
  name: true,
  shortName: true,
  logoUrl: true,
} as const

const loadSeasonStats = async (seasonId: number) =>
  prisma.playerSeasonStats.findMany({
    where: { seasonId },
    include: {
      person: { select: personSelect },
      club: { select: clubSelect },
    },
  })

type RawSeasonStat = Awaited<ReturnType<typeof loadSeasonStats>>[number]

type LeaderboardMap = Record<LeagueStatsCategory, LeaguePlayerLeaderboardEntry[]>

const toEntry = (row: RawSeasonStat): LeaguePlayerLeaderboardEntry => ({
  personId: row.personId,
  firstName: row.person.firstName,
  lastName: row.person.lastName,
  clubId: row.clubId,
  clubName: row.club.name,
  clubShortName: row.club.shortName ?? row.club.name,
  clubLogoUrl: row.club.logoUrl ?? null,
  matchesPlayed: row.matchesPlayed,
  goals: row.goals,
  assists: row.assists,
  penaltyGoals: row.penaltyGoals,
})

const sortByGoalContribution = (entries: LeaguePlayerLeaderboardEntry[]) =>
  [...entries].sort((left, right) => {
    const leftTotal = left.goals + left.assists
    const rightTotal = right.goals + right.assists
    if (rightTotal !== leftTotal) return rightTotal - leftTotal
    if (right.goals !== left.goals) return right.goals - left.goals
    const leftCleanGoals = left.goals - (left.penaltyGoals ?? 0)
    const rightCleanGoals = right.goals - (right.penaltyGoals ?? 0)
    if (rightCleanGoals !== leftCleanGoals) return rightCleanGoals - leftCleanGoals
    if (right.assists !== left.assists) return right.assists - left.assists
    if (left.matchesPlayed !== right.matchesPlayed) return left.matchesPlayed - right.matchesPlayed
    const leftName = `${left.lastName} ${left.firstName}`
    const rightName = `${right.lastName} ${right.firstName}`
    return leftName.localeCompare(rightName, 'ru')
  })

const sortByScorers = (entries: LeaguePlayerLeaderboardEntry[]) =>
  [...entries].sort((left, right) => {
    if (right.goals !== left.goals) return right.goals - left.goals
    if (left.matchesPlayed !== right.matchesPlayed) return left.matchesPlayed - right.matchesPlayed
    const leftName = `${left.lastName} ${left.firstName}`
    const rightName = `${right.lastName} ${right.firstName}`
    return leftName.localeCompare(rightName, 'ru')
  })

const sortByAssists = (entries: LeaguePlayerLeaderboardEntry[]) =>
  [...entries].sort((left, right) => {
    if (right.assists !== left.assists) return right.assists - left.assists
    if (left.matchesPlayed !== right.matchesPlayed) return left.matchesPlayed - right.matchesPlayed
    const leftName = `${left.lastName} ${left.firstName}`
    const rightName = `${right.lastName} ${right.firstName}`
    return leftName.localeCompare(rightName, 'ru')
  })

const buildLeaderboards = (rows: RawSeasonStat[]): LeaderboardMap => {
  const entries = rows.map(toEntry)
  const goalContribution = sortByGoalContribution(entries)
    .filter(entry => entry.matchesPlayed > 0 && entry.goals + entry.assists > 0)
    .slice(0, LEADERBOARD_LIMIT)
  const scorers = sortByScorers(entries)
    .filter(entry => entry.matchesPlayed > 0 && entry.goals > 0)
    .slice(0, LEADERBOARD_LIMIT)
  const assists = sortByAssists(entries)
    .filter(entry => entry.matchesPlayed > 0 && entry.assists > 0)
    .slice(0, LEADERBOARD_LIMIT)
  return {
    goalContribution,
    scorers,
    assists,
  }
}

const warmLeaderboardCaches = async (snapshot: LeagueStatsSnapshot) => {
  const tasks = [
    defaultCache.set(
      PUBLIC_LEAGUE_SCORERS_KEY,
      snapshot.leaderboards.scorers,
      PUBLIC_LEAGUE_LEADERBOARD_TTL_SECONDS
    ),
    defaultCache.set(
      `${PUBLIC_LEAGUE_SCORERS_KEY}:${snapshot.season.id}`,
      snapshot.leaderboards.scorers,
      PUBLIC_LEAGUE_LEADERBOARD_TTL_SECONDS
    ),
    defaultCache.set(
      PUBLIC_LEAGUE_ASSISTS_KEY,
      snapshot.leaderboards.assists,
      PUBLIC_LEAGUE_LEADERBOARD_TTL_SECONDS
    ),
    defaultCache.set(
      `${PUBLIC_LEAGUE_ASSISTS_KEY}:${snapshot.season.id}`,
      snapshot.leaderboards.assists,
      PUBLIC_LEAGUE_LEADERBOARD_TTL_SECONDS
    ),
    defaultCache.set(
      PUBLIC_LEAGUE_GOAL_CONTRIBUTORS_KEY,
      snapshot.leaderboards.goalContribution,
      PUBLIC_LEAGUE_LEADERBOARD_TTL_SECONDS
    ),
    defaultCache.set(
      `${PUBLIC_LEAGUE_GOAL_CONTRIBUTORS_KEY}:${snapshot.season.id}`,
      snapshot.leaderboards.goalContribution,
      PUBLIC_LEAGUE_LEADERBOARD_TTL_SECONDS
    ),
  ]

  await Promise.all(tasks.map(task => task.catch(() => undefined)))
}

export const buildLeagueStats = async (
  season: SeasonWithCompetition
): Promise<LeagueStatsSnapshot> => {
  const rows = await loadSeasonStats(season.id)
  const leaderboards = buildLeaderboards(rows)
  const snapshot: LeagueStatsSnapshot = {
    season: ensureSeasonSummary(season),
    generatedAt: new Date().toISOString(),
    leaderboards,
  }
  await warmLeaderboardCaches(snapshot)
  return snapshot
}

export const refreshLeagueStats = async (
  seasonId: number,
  options?: { publishTopic?: PublishFn }
): Promise<LeagueStatsSnapshot | null> => {
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    include: { competition: true },
  })

  if (!season) {
    return null
  }

  const snapshot = await buildLeagueStats(season)

  await Promise.all(
    [
      defaultCache.set(PUBLIC_LEAGUE_STATS_KEY, snapshot, PUBLIC_LEAGUE_STATS_TTL_SECONDS),
      defaultCache.set(
        `${PUBLIC_LEAGUE_STATS_KEY}:${seasonId}`,
        snapshot,
        PUBLIC_LEAGUE_STATS_TTL_SECONDS
      ),
    ].map(task => task.catch(() => undefined))
  )

  if (options?.publishTopic) {
    const publishTasks = [
      options.publishTopic(PUBLIC_LEAGUE_GOAL_CONTRIBUTORS_KEY, {
        type: 'league.goalContribution',
        seasonId: snapshot.season.id,
        payload: {
          season: snapshot.season,
          generatedAt: snapshot.generatedAt,
          entries: snapshot.leaderboards.goalContribution,
        },
      }),
      options.publishTopic(PUBLIC_LEAGUE_SCORERS_KEY, {
        type: 'league.scorers',
        seasonId: snapshot.season.id,
        payload: {
          season: snapshot.season,
          generatedAt: snapshot.generatedAt,
          entries: snapshot.leaderboards.scorers,
        },
      }),
      options.publishTopic(PUBLIC_LEAGUE_ASSISTS_KEY, {
        type: 'league.assists',
        seasonId: snapshot.season.id,
        payload: {
          season: snapshot.season,
          generatedAt: snapshot.generatedAt,
          entries: snapshot.leaderboards.assists,
        },
      }),
    ]
    await Promise.all(publishTasks.map(task => task.catch(() => undefined)))
  }

  return snapshot
}
