import prisma from '../db'
import { defaultCache } from '../cache/multilevelCache'
import {
  resolveCacheOptions,
  getMatchWindow,
  type MatchWindowPhase,
} from '../cache/matchWindowHelper'
import { PUBLIC_LEAGUE_TABLE_KEY } from '../cache/cacheKeys'
import { buildLeagueTable, type SeasonWithCompetition } from './leagueTable'
import { refreshLeagueMatchAggregates } from './leagueSchedule'
import { refreshLeagueStats } from './leagueStats'

export interface PrewarmResult {
  executed: boolean
  reason: string
  seasons: number[]
}

const isActivePhase = (phase: MatchWindowPhase): boolean =>
  phase === 'prewarm' || phase === 'live' || phase === 'post'

const warmLeagueTable = async (season: SeasonWithCompetition) => {
  const table = await buildLeagueTable(season)
  const tableOptions = await resolveCacheOptions('leagueTable')
  await Promise.all([
    defaultCache.set(PUBLIC_LEAGUE_TABLE_KEY, table, tableOptions),
    defaultCache.set(`${PUBLIC_LEAGUE_TABLE_KEY}:${season.id}`, table, tableOptions),
  ])
  return true
}

export const maybePrewarmPublicLeagueCaches = async (): Promise<PrewarmResult> => {
  const window = await getMatchWindow()

  if (!isActivePhase(window.phase)) {
    return { executed: false, reason: 'idle_window', seasons: [] }
  }

  if (!window.seasonIds.length) {
    return { executed: false, reason: 'no_seasons', seasons: [] }
  }

  const seasons = (await prisma.season.findMany({
    where: { id: { in: window.seasonIds } },
    include: { competition: true },
  })) as SeasonWithCompetition[]

  if (!seasons.length) {
    return { executed: false, reason: 'missing_seasons', seasons: [] }
  }

  for (const season of seasons) {
  await warmLeagueTable(season)
    await refreshLeagueMatchAggregates(season.id)
    await refreshLeagueStats(season.id)
  }

  return { executed: true, reason: window.phase, seasons: window.seasonIds }
}
