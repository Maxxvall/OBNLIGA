import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import {
  defaultCache,
  type CacheFetchOptions,
  publicMatchBroadcastKey,
  publicMatchEventsKey,
  publicMatchHeaderKey,
  publicMatchLineupsKey,
  publicMatchStatsKey,
} from '../cache'
import { buildWeakEtag, matchesIfNoneMatch } from '../utils/httpCaching'
import {
  MatchDetailsError,
  type MatchTtlCategory,
  buildMatchBroadcastEntry,
  buildMatchEventsEntry,
  buildMatchHeaderEntry,
  buildMatchLineupsEntry,
  buildMatchStatsEntry,
} from '../services/matchDetails'

const TEN_SECONDS = 10
const FIVE_MINUTES = 300
const TEN_MINUTES = 600
const THREE_HOURS = 3 * 60 * 60
const ONE_DAY = 24 * 60 * 60

type MatchResource = 'header' | 'lineups' | 'events' | 'stats' | 'broadcast'

type CachedEnvelope<T> = {
  payload: T
  ttlCategory: MatchTtlCategory
  metadata?: {
    availableUntil?: number
  }
}

const TTL_MATRIX: Record<MatchResource, Record<MatchTtlCategory, number>> = {
  header: {
    live: TEN_SECONDS,
    scheduled: FIVE_MINUTES,
    finished: THREE_HOURS,
  },
  lineups: {
    live: TEN_MINUTES,
    scheduled: TEN_MINUTES,
    finished: THREE_HOURS,
  },
  events: {
    live: TEN_SECONDS,
    scheduled: FIVE_MINUTES,
    finished: THREE_HOURS,
  },
  stats: {
    live: TEN_SECONDS,
    scheduled: FIVE_MINUTES,
    finished: THREE_HOURS,
  },
  broadcast: {
    live: ONE_DAY,
    scheduled: ONE_DAY,
    finished: ONE_DAY,
  },
}

const resolveCacheOptions = (
  resource: MatchResource,
  category: MatchTtlCategory
): CacheFetchOptions => {
  const ttlSeconds = TTL_MATRIX[resource][category]
  if (resource === 'broadcast') {
    return {
      ttlSeconds,
      staleWhileRevalidateSeconds: ttlSeconds,
    }
  }
  const staleWhileRevalidateSeconds = Math.max(ttlSeconds, ttlSeconds * 2)
  return {
    ttlSeconds,
    staleWhileRevalidateSeconds,
  }
}

const parseMatchId = (raw: string): bigint => {
  try {
    const numeric = BigInt(raw)
    if (numeric <= 0n) {
      throw new Error('match_id_invalid')
    }
    return numeric
  } catch (err) {
    throw new MatchDetailsError(400, 'match_id_invalid')
  }
}

const matchDetailsRoutes: FastifyPluginAsync = async fastify => {
  const handle = async <T>(
    request: FastifyRequest,
    reply: FastifyReply,
    resource: MatchResource,
    cacheKey: string,
    loader: () => Promise<CachedEnvelope<T>>,
    opts?: { enforceAvailabilityCutoff?: boolean; notAvailableError?: string }
  ) => {
    let loaded = false
    const { value, version } = await defaultCache.getWithMeta<CachedEnvelope<T>>(
      cacheKey,
      async () => {
        const computed = await loader()
        loaded = true
        return computed
      },
      { ttlSeconds: 0 }
    )

    if (loaded) {
      const options = resolveCacheOptions(resource, value.ttlCategory)
      await defaultCache.set(cacheKey, value, options).catch(() => undefined)
    }

    if (opts?.enforceAvailabilityCutoff && value.metadata?.availableUntil) {
      if (Date.now() > value.metadata.availableUntil) {
        await defaultCache.invalidate(cacheKey).catch(() => undefined)
        const errorCode = opts.notAvailableError ?? 'resource_not_available'
        return reply.status(404).send({ ok: false, error: errorCode })
      }
    }

    const etag = buildWeakEtag(cacheKey, version)
    if (matchesIfNoneMatch(request.headers, etag)) {
      return reply
        .status(304)
        .header('ETag', etag)
        .header('X-Resource-Version', String(version))
        .send()
    }

    reply
      .header('ETag', etag)
      .header('X-Resource-Version', String(version))
      .header('Cache-Control', 'no-cache')

    return reply.send({ ok: true, data: value.payload, meta: { version } })
  }

  fastify.get<{ Params: { matchId: string } }>('/api/public/matches/:matchId/header', async (request, reply) => {
    let matchId: bigint
    try {
      matchId = parseMatchId(request.params.matchId)
    } catch (err) {
      const code = err instanceof MatchDetailsError ? err.message : 'match_id_invalid'
      return reply.status(400).send({ ok: false, error: code })
    }

    const cacheKey = publicMatchHeaderKey(matchId)

    try {
      return await handle(
        request,
        reply,
        'header',
        cacheKey,
        () => buildMatchHeaderEntry(matchId)
      )
    } catch (err) {
      if (err instanceof MatchDetailsError) {
        return reply.status(err.statusCode).send({ ok: false, error: err.message })
      }
      request.log.error({ err }, 'failed to load match header')
      return reply.status(500).send({ ok: false, error: 'internal_error' })
    }
  })

  fastify.get<{ Params: { matchId: string } }>('/api/public/matches/:matchId/lineups', async (request, reply) => {
    let matchId: bigint
    try {
      matchId = parseMatchId(request.params.matchId)
    } catch (err) {
      const code = err instanceof MatchDetailsError ? err.message : 'match_id_invalid'
      return reply.status(400).send({ ok: false, error: code })
    }

    const cacheKey = publicMatchLineupsKey(matchId)

    try {
      return await handle(
        request,
        reply,
        'lineups',
        cacheKey,
        () => buildMatchLineupsEntry(matchId)
      )
    } catch (err) {
      if (err instanceof MatchDetailsError) {
        return reply.status(err.statusCode).send({ ok: false, error: err.message })
      }
      request.log.error({ err }, 'failed to load match lineups')
      return reply.status(500).send({ ok: false, error: 'internal_error' })
    }
  })

  fastify.get<{ Params: { matchId: string } }>('/api/public/matches/:matchId/events', async (request, reply) => {
    let matchId: bigint
    try {
      matchId = parseMatchId(request.params.matchId)
    } catch (err) {
      const code = err instanceof MatchDetailsError ? err.message : 'match_id_invalid'
      return reply.status(400).send({ ok: false, error: code })
    }

    const cacheKey = publicMatchEventsKey(matchId)

    try {
      return await handle(
        request,
        reply,
        'events',
        cacheKey,
        () => buildMatchEventsEntry(matchId)
      )
    } catch (err) {
      if (err instanceof MatchDetailsError) {
        return reply.status(err.statusCode).send({ ok: false, error: err.message })
      }
      request.log.error({ err }, 'failed to load match events')
      return reply.status(500).send({ ok: false, error: 'internal_error' })
    }
  })

  fastify.get<{ Params: { matchId: string } }>('/api/public/matches/:matchId/stats', async (request, reply) => {
    let matchId: bigint
    try {
      matchId = parseMatchId(request.params.matchId)
    } catch (err) {
      const code = err instanceof MatchDetailsError ? err.message : 'match_id_invalid'
      return reply.status(400).send({ ok: false, error: code })
    }

    const cacheKey = publicMatchStatsKey(matchId)

    try {
      return await handle(
        request,
        reply,
        'stats',
        cacheKey,
        () => buildMatchStatsEntry(matchId),
        { enforceAvailabilityCutoff: true, notAvailableError: 'stats_not_available' }
      )
    } catch (err) {
      if (err instanceof MatchDetailsError) {
        return reply.status(err.statusCode).send({ ok: false, error: err.message })
      }
      request.log.error({ err }, 'failed to load match stats')
      return reply.status(500).send({ ok: false, error: 'internal_error' })
    }
  })

  fastify.get<{ Params: { matchId: string } }>('/api/public/matches/:matchId/broadcast', async (request, reply) => {
    let matchId: bigint
    try {
      matchId = parseMatchId(request.params.matchId)
    } catch (err) {
      const code = err instanceof MatchDetailsError ? err.message : 'match_id_invalid'
      return reply.status(400).send({ ok: false, error: code })
    }

    const cacheKey = publicMatchBroadcastKey(matchId)

    try {
      return await handle(
        request,
        reply,
        'broadcast',
        cacheKey,
        () => buildMatchBroadcastEntry(matchId)
      )
    } catch (err) {
      if (err instanceof MatchDetailsError) {
        return reply.status(err.statusCode).send({ ok: false, error: err.message })
      }
      request.log.error({ err }, 'failed to load match broadcast stub')
      return reply.status(500).send({ ok: false, error: 'internal_error' })
    }
  })
}

export default matchDetailsRoutes
