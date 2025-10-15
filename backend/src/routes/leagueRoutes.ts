import { FastifyPluginAsync } from 'fastify'
import prisma from '../db'
import { defaultCache } from '../cache'
import {
  LeagueSeasonSummary,
  LeagueTableResponse,
  SeasonWithCompetition,
  buildLeagueTable,
  fetchLeagueSeasons,
} from '../services/leagueTable'
import {
  PUBLIC_LEAGUE_RESULTS_KEY,
  PUBLIC_LEAGUE_RESULTS_TTL_SECONDS,
  PUBLIC_LEAGUE_SCHEDULE_KEY,
  PUBLIC_LEAGUE_SCHEDULE_TTL_SECONDS,
  type LeagueRoundCollection,
  buildLeagueResults,
  buildLeagueSchedule,
} from '../services/leagueSchedule'
import {
  PUBLIC_LEAGUE_STATS_KEY,
  PUBLIC_LEAGUE_STATS_TTL_SECONDS,
  buildLeagueStats,
} from '../services/leagueStats'
import { buildWeakEtag, matchesIfNoneMatch } from '../utils/httpCaching'

const SEASONS_CACHE_KEY = 'public:league:seasons'
const SEASONS_TTL_SECONDS = 60
const TABLE_TTL_SECONDS = 300

type SeasonResolution =
  | { ok: true; season: SeasonWithCompetition; requestedSeasonId?: number }
  | { ok: false; status: number; error: string }

const resolveSeason = async (seasonIdRaw?: string): Promise<SeasonResolution> => {
  let requestedSeasonId: number | undefined

  if (seasonIdRaw !== undefined) {
    const parsed = Number(seasonIdRaw)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return { ok: false, status: 400, error: 'season_invalid' }
    }
    requestedSeasonId = parsed
  }

  let season: SeasonWithCompetition | null

  if (requestedSeasonId) {
    season = await prisma.season.findUnique({
      where: { id: requestedSeasonId },
      include: { competition: true },
    })
  } else {
    season = await prisma.season.findFirst({
      where: { isActive: true },
      orderBy: { startDate: 'desc' },
      include: { competition: true },
    })
  }

  if (!season) {
    return { ok: false, status: 404, error: 'season_not_found' }
  }

  return { ok: true, season, requestedSeasonId }
}

const leagueRoutes: FastifyPluginAsync = async fastify => {
  fastify.get('/api/league/seasons', async (_request, reply) => {
    const { value, version } = await defaultCache.getWithMeta<LeagueSeasonSummary[]>(
      SEASONS_CACHE_KEY,
      fetchLeagueSeasons,
      SEASONS_TTL_SECONDS
    )
    const etag = buildWeakEtag(SEASONS_CACHE_KEY, version)

    if (matchesIfNoneMatch(_request.headers, etag)) {
      return reply
        .status(304)
        .header('ETag', etag)
        .header('X-Resource-Version', String(version))
        .send()
    }

    reply.header('ETag', etag)
    reply.header('X-Resource-Version', String(version))
    return reply.send({ ok: true, data: value, meta: { version } })
  })

  fastify.get<{ Querystring: { seasonId?: string } }>('/api/league/table', async (request, reply) => {
    const seasonResolution = await resolveSeason(request.query.seasonId)

    if (!seasonResolution.ok) {
      return reply
        .status(seasonResolution.status)
        .send({ ok: false, error: seasonResolution.error })
    }

    const { season, requestedSeasonId } = seasonResolution

    const cacheKey = requestedSeasonId
      ? `public:league:table:${season.id}`
      : 'public:league:table'
    const { value, version } = await defaultCache.getWithMeta<LeagueTableResponse>(
      cacheKey,
      () => buildLeagueTable(season),
      TABLE_TTL_SECONDS
    )
    const etag = buildWeakEtag(cacheKey, version)

    if (matchesIfNoneMatch(request.headers, etag)) {
      return reply
        .status(304)
        .header('ETag', etag)
        .header('X-Resource-Version', String(version))
        .send()
    }

    reply.header('ETag', etag)
    reply.header('X-Resource-Version', String(version))
    return reply.send({ ok: true, data: value, meta: { version } })
  })

  fastify.get<{ Querystring: { seasonId?: string } }>('/api/league/schedule', async (request, reply) => {
    const seasonResolution = await resolveSeason(request.query.seasonId)

    if (!seasonResolution.ok) {
      return reply
        .status(seasonResolution.status)
        .send({ ok: false, error: seasonResolution.error })
    }

    const { season, requestedSeasonId } = seasonResolution

    const cacheKey = requestedSeasonId
      ? `${PUBLIC_LEAGUE_SCHEDULE_KEY}:${season.id}`
      : PUBLIC_LEAGUE_SCHEDULE_KEY
    const { value, version } = await defaultCache.getWithMeta<LeagueRoundCollection>(
      cacheKey,
      () => buildLeagueSchedule(season),
      PUBLIC_LEAGUE_SCHEDULE_TTL_SECONDS
    )
    const etag = buildWeakEtag(cacheKey, version)

    if (matchesIfNoneMatch(request.headers, etag)) {
      return reply
        .status(304)
        .header('ETag', etag)
        .header('X-Resource-Version', String(version))
        .send()
    }

    reply.header('ETag', etag)
    reply.header('X-Resource-Version', String(version))
    return reply.send({ ok: true, data: value, meta: { version } })
  })

  fastify.get<{ Querystring: { seasonId?: string } }>('/api/league/results', async (request, reply) => {
    const seasonResolution = await resolveSeason(request.query.seasonId)

    if (!seasonResolution.ok) {
      return reply
        .status(seasonResolution.status)
        .send({ ok: false, error: seasonResolution.error })
    }

    const { season, requestedSeasonId } = seasonResolution

    const cacheKey = requestedSeasonId
      ? `${PUBLIC_LEAGUE_RESULTS_KEY}:${season.id}`
      : PUBLIC_LEAGUE_RESULTS_KEY
    const { value, version } = await defaultCache.getWithMeta<LeagueRoundCollection>(
      cacheKey,
      () => buildLeagueResults(season),
      PUBLIC_LEAGUE_RESULTS_TTL_SECONDS
    )
    const etag = buildWeakEtag(cacheKey, version)

    if (matchesIfNoneMatch(request.headers, etag)) {
      return reply
        .status(304)
        .header('ETag', etag)
        .header('X-Resource-Version', String(version))
        .send()
    }

    reply.header('ETag', etag)
    reply.header('X-Resource-Version', String(version))
    return reply.send({ ok: true, data: value, meta: { version } })
  })

  fastify.get<{ Querystring: { seasonId?: string } }>('/api/league/stats', async (request, reply) => {
    const seasonResolution = await resolveSeason(request.query.seasonId)

    if (!seasonResolution.ok) {
      return reply
        .status(seasonResolution.status)
        .send({ ok: false, error: seasonResolution.error })
    }

    const { season, requestedSeasonId } = seasonResolution

    const cacheKey = requestedSeasonId
      ? `${PUBLIC_LEAGUE_STATS_KEY}:${season.id}`
      : PUBLIC_LEAGUE_STATS_KEY
    const { value, version } = await defaultCache.getWithMeta(
      cacheKey,
      () => buildLeagueStats(season),
      PUBLIC_LEAGUE_STATS_TTL_SECONDS
    )
    const etag = buildWeakEtag(cacheKey, version)

    if (matchesIfNoneMatch(request.headers, etag)) {
      return reply
        .status(304)
        .header('ETag', etag)
        .header('X-Resource-Version', String(version))
        .send()
    }

    reply.header('ETag', etag)
    reply.header('X-Resource-Version', String(version))
    return reply.send({ ok: true, data: value, meta: { version } })
  })
}

export default leagueRoutes
