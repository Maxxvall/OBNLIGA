import { FastifyPluginAsync } from 'fastify'
import prisma from '../db'
import {
  defaultCache,
  resolveCacheOptions,
  PUBLIC_FRIENDLY_RESULTS_KEY,
  PUBLIC_FRIENDLY_SCHEDULE_KEY,
  PUBLIC_LEAGUE_RESULTS_KEY,
  PUBLIC_LEAGUE_SCHEDULE_KEY,
  PUBLIC_LEAGUE_STATS_KEY,
  PUBLIC_LEAGUE_TABLE_KEY,
} from '../cache'
import {
  LeagueSeasonSummary,
  LeagueTableResponse,
  SeasonWithCompetition,
  buildLeagueTable,
  fetchLeagueSeasons,
} from '../services/leagueTable'
import {
  type LeagueRoundCollection,
  buildFriendlyResults,
  buildFriendlySchedule,
  buildLeagueResultsForRound,
  buildLeagueResultsIndex,
  buildLeagueSchedule,
  decodeRoundKey,
} from '../services/leagueSchedule'
import { buildLeagueStats } from '../services/leagueStats'
import { buildWeakEtag, matchesIfNoneMatch } from '../utils/httpCaching'

const SEASONS_CACHE_KEY = 'public:league:seasons'
const SEASONS_TTL_SECONDS = 60
const TABLE_CACHE_RESOURCE = 'leagueTable' as const

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
    // При запросе конкретного сезона — возвращаем его даже если он архивирован
    season = await prisma.season.findUnique({
      where: { id: requestedSeasonId },
      include: { competition: true },
    })
  } else {
    // При поиске активного сезона — исключаем архивированные
    season = await prisma.season.findFirst({
      where: { isActive: true, isArchived: false },
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
    reply.header('Cache-Control', 'no-cache')
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
      ? `${PUBLIC_LEAGUE_TABLE_KEY}:${season.id}`
      : PUBLIC_LEAGUE_TABLE_KEY
    const cacheOptions = await resolveCacheOptions(TABLE_CACHE_RESOURCE)
    const { value, version } = await defaultCache.getWithMeta<LeagueTableResponse>(
      cacheKey,
      () => buildLeagueTable(season),
      cacheOptions
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
    reply.header('Cache-Control', 'no-cache')
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
    const cacheOptions = await resolveCacheOptions('leagueSchedule')
    const { value, version } = await defaultCache.getWithMeta<LeagueRoundCollection>(
      cacheKey,
      () => buildLeagueSchedule(season),
      cacheOptions
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
    reply.header('Cache-Control', 'no-cache')
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
    const cacheOptions = await resolveCacheOptions('leagueResults')
    const { value, version } = await defaultCache.getWithMeta<LeagueRoundCollection>(
      cacheKey,
      () => buildLeagueResultsIndex(season),
      cacheOptions
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

  fastify.get<{ Querystring: { seasonId?: string; roundKey?: string } }>(
    '/api/league/results/round',
    async (request, reply) => {
      const seasonResolution = await resolveSeason(request.query.seasonId)

      if (!seasonResolution.ok) {
        return reply
          .status(seasonResolution.status)
          .send({ ok: false, error: seasonResolution.error })
      }

      const roundKey = request.query.roundKey ?? ''
      const decoded = decodeRoundKey(roundKey)
      if (!decoded) {
        return reply.status(400).send({ ok: false, error: 'round_key_invalid' })
      }

      const { season, requestedSeasonId } = seasonResolution
      const cacheKeyBase = requestedSeasonId
        ? `${PUBLIC_LEAGUE_RESULTS_KEY}:${season.id}`
        : PUBLIC_LEAGUE_RESULTS_KEY
      const cacheKey = `${cacheKeyBase}:round:${roundKey}`
      const cacheOptions = await resolveCacheOptions('leagueResults')

      const fetchRound = async () => {
        const data = await buildLeagueResultsForRound(season, decoded)
        if (!data || data.rounds.length === 0) {
          throw new Error('round_not_found')
        }
        return data
      }

      try {
        const { value, version } = await defaultCache.getWithMeta<LeagueRoundCollection>(
          cacheKey,
          fetchRound,
          cacheOptions
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
      } catch (error) {
        if (error instanceof Error && error.message === 'round_not_found') {
          return reply.status(404).send({ ok: false, error: 'round_not_found' })
        }
        throw error
      }
    }
  )

  fastify.get('/api/league/friendlies/schedule', async (request, reply) => {
    const cacheKey = PUBLIC_FRIENDLY_SCHEDULE_KEY
    const cacheOptions = await resolveCacheOptions('friendliesSchedule')
    const { value, version } = await defaultCache.getWithMeta<LeagueRoundCollection>(
      cacheKey,
      () => buildFriendlySchedule(),
      cacheOptions
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
    reply.header('Cache-Control', 'no-cache')
    return reply.send({ ok: true, data: value, meta: { version } })
  })

  fastify.get('/api/league/friendlies/results', async (request, reply) => {
    const cacheKey = PUBLIC_FRIENDLY_RESULTS_KEY
    const cacheOptions = await resolveCacheOptions('friendliesResults')
    const { value, version } = await defaultCache.getWithMeta<LeagueRoundCollection>(
      cacheKey,
      () => buildFriendlyResults(),
      cacheOptions
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
    reply.header('Cache-Control', 'no-cache')
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
    const cacheOptions = await resolveCacheOptions('leagueStats')
    const { value, version } = await defaultCache.getWithMeta(
      cacheKey,
      () => buildLeagueStats(season),
      cacheOptions
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
    reply.header('Cache-Control', 'no-cache')
    return reply.send({ ok: true, data: value, meta: { version } })
  })

  // ============================================================
  // Season Archive (публичный доступ к архивам сезонов)
  // ============================================================

  fastify.get<{ Params: { seasonId: string } }>(
    '/api/archive/seasons/:seasonId',
    async (request, reply) => {
      const seasonIdRaw = request.params.seasonId
      const seasonId = Number(seasonIdRaw)

      if (!Number.isFinite(seasonId) || seasonId <= 0) {
        return reply.status(400).send({ ok: false, error: 'season_id_invalid' })
      }

      const { getSeasonArchive, isSeasonArchived } = await import('../services/seasonArchive')
      const { ARCHIVE_TTL_SECONDS } = await import('../cache')

      // Проверяем, архивирован ли сезон
      const archived = await isSeasonArchived(seasonId)
      if (!archived) {
        return reply.status(404).send({ ok: false, error: 'archive_not_found' })
      }

      // Кеширование архивных данных с длинным TTL (30 дней)
      const cacheKey = `public:archive:season:${seasonId}`

      const { value, version } = await defaultCache.getWithMeta(
        cacheKey,
        () => getSeasonArchive(seasonId),
        ARCHIVE_TTL_SECONDS
      )

      if (!value) {
        return reply.status(404).send({ ok: false, error: 'archive_not_found' })
      }

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
      reply.header('Cache-Control', 'public, max-age=86400') // 24 часа клиентский кеш
      return reply.send({ ok: true, data: value, meta: { version } })
    }
  )
}

export default leagueRoutes
