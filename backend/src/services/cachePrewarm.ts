import { MatchStatus } from '@prisma/client'
import prisma from '../db'
import { defaultCache } from '../cache/multilevelCache'
import {
  resolveCacheOptions,
  getMatchWindow,
  type MatchWindowPhase,
  type MatchWindowState,
} from '../cache/matchWindowHelper'
import { PUBLIC_LEAGUE_TABLE_KEY, PUBLIC_SHOP_ITEMS_KEY } from '../cache/cacheKeys'
import {
  buildLeagueTable,
  fetchLeagueSeasons,
  type SeasonWithCompetition,
} from './leagueTable'
import { refreshLeagueMatchAggregates, refreshFriendlyAggregates } from './leagueSchedule'
import { refreshLeagueStats } from './leagueStats'
import {
  loadRatingLeaderboard,
  ratingPublicCacheKey,
  RATING_CACHE_OPTIONS,
} from './ratingAggregation'
import { RATING_MAX_PAGE_SIZE } from './ratingConstants'
import { serializeShopItemView } from './shop/serializers'
import { fetchMatchHeader, fetchMatchLineups } from './matchDetailsPublic'

export interface PrewarmResult {
  executed: boolean
  reason: string
  seasons: number[]
  modes: {
    base: boolean
    aggressive: boolean
  }
}

const isActivePhase = (phase: MatchWindowPhase): boolean =>
  phase === 'prewarm' || phase === 'live' || phase === 'post'

const SEASONS_CACHE_KEY = 'public:league:seasons'
const SEASONS_TTL_SECONDS = 60
const BASE_RATING_PAGE_SIZE = Math.min(10, RATING_MAX_PAGE_SIZE)
const SHOP_ITEMS_CACHE_TTL_SECONDS = 45
const SHOP_ITEMS_STALE_SECONDS = 120
const UPCOMING_MATCH_LIMIT = 10

const warmLeagueTable = async (season: SeasonWithCompetition) => {
  const table = await buildLeagueTable(season)
  const tableOptions = await resolveCacheOptions('leagueTable')
  await Promise.all([
    defaultCache.set(PUBLIC_LEAGUE_TABLE_KEY, table, tableOptions),
    defaultCache.set(`${PUBLIC_LEAGUE_TABLE_KEY}:${season.id}`, table, tableOptions),
  ])
  return true
}

const warmLeagueSeasonsList = async () => {
  const seasons = await fetchLeagueSeasons()
  await defaultCache.set(
    SEASONS_CACHE_KEY,
    seasons,
    {
      ttlSeconds: SEASONS_TTL_SECONDS,
      staleWhileRevalidateSeconds: SEASONS_TTL_SECONDS,
    }
  )
}

const warmRatingLeaderboards = async () => {
  const scopes: Array<'CURRENT' | 'YEARLY'> = ['CURRENT', 'YEARLY']
  const tasks = scopes.map(async scope => {
    const leaderboard = await loadRatingLeaderboard(scope, {
      page: 1,
      pageSize: BASE_RATING_PAGE_SIZE,
    })
    const cacheKey = ratingPublicCacheKey(scope, 1, BASE_RATING_PAGE_SIZE)
    await defaultCache.set(cacheKey, leaderboard, RATING_CACHE_OPTIONS)
    return scope
  })
  await Promise.all(tasks)
}

const warmShopItems = async () => {
  const items = await prisma.shopItem.findMany({
    where: { isActive: true },
    orderBy: [
      { sortOrder: 'asc' },
      { id: 'asc' },
    ],
  })
  const payload = items.map(serializeShopItemView)
  await defaultCache.set(
    PUBLIC_SHOP_ITEMS_KEY,
    payload,
    {
      ttlSeconds: SHOP_ITEMS_CACHE_TTL_SECONDS,
      staleWhileRevalidateSeconds: SHOP_ITEMS_STALE_SECONDS,
    }
  )
}

const loadActiveSeason = async (): Promise<SeasonWithCompetition | null> => {
  const season = await prisma.season.findFirst({
    where: { isActive: true, isArchived: false },
    orderBy: { startDate: 'desc' },
    include: { competition: true },
  })
  return season as SeasonWithCompetition | null
}

const warmBaseCaches = async (window: MatchWindowState): Promise<number[]> => {
  const activeSeason = await loadActiveSeason()
  const warmedSeasonIds: number[] = []

  await warmLeagueSeasonsList()

  if (activeSeason) {
    await warmLeagueTable(activeSeason)
    warmedSeasonIds.push(activeSeason.id)
  }

  await warmRatingLeaderboards()
  await warmShopItems()

  return warmedSeasonIds.length ? warmedSeasonIds : window.seasonIds
}

const warmAggressiveCaches = async (window: MatchWindowState): Promise<number[]> => {
  if (!window.seasonIds.length) {
    return []
  }

  const seasons = (await prisma.season.findMany({
    where: { id: { in: window.seasonIds } },
    include: { competition: true },
  })) as SeasonWithCompetition[]

  if (!seasons.length) {
    return []
  }

  const seasonIds: number[] = []

  for (const season of seasons) {
    seasonIds.push(season.id)
    await warmLeagueTable(season)
    await refreshLeagueMatchAggregates(season.id)
    await refreshLeagueStats(season.id)
  }

  await refreshFriendlyAggregates()
  await warmUpcomingMatches(window)

  return seasonIds
}

const warmUpcomingMatches = async (window: MatchWindowState) => {
  const now = new Date()
  const upcoming = await prisma.match.findMany({
    where: {
      matchDateTime: { gte: now },
      status: { in: [MatchStatus.SCHEDULED, MatchStatus.LIVE] },
      isArchived: false,
      isFriendly: false,
      seasonId: { in: window.seasonIds.length ? window.seasonIds : undefined },
    },
    select: { id: true },
    orderBy: { matchDateTime: 'asc' },
    take: UPCOMING_MATCH_LIMIT,
  })

  if (!upcoming.length) {
    return
  }

  await Promise.all(
    upcoming.map(async match => {
      const id = match.id.toString()
      await Promise.all([
        fetchMatchHeader(id).catch(() => undefined),
        fetchMatchLineups(id).catch(() => undefined),
      ])
    })
  )
}

export const maybePrewarmPublicLeagueCaches = async (): Promise<PrewarmResult> => {
  const window = await getMatchWindow()
  const baseSeasons = await warmBaseCaches(window)

  const shouldRunAggressive = isActivePhase(window.phase) && window.seasonIds.length > 0
  let aggressiveSeasons: number[] = []

  if (shouldRunAggressive) {
    aggressiveSeasons = await warmAggressiveCaches(window)
  }

  const seasons = Array.from(new Set([...baseSeasons, ...aggressiveSeasons]))

  return {
    executed: true,
    reason: shouldRunAggressive ? window.phase : 'base_only',
    seasons,
    modes: {
      base: true,
      aggressive: shouldRunAggressive,
    },
  }
}
