import { FastifyPluginAsync } from 'fastify'
import {
  ClubSummaryNotFoundError,
  getClubSummary,
  publicClubSummaryKey,
  refreshClubSummary,
} from '../services/clubSummary'
import { getClubMatches, publicClubMatchesKey } from '../services/clubMatches'
import { buildWeakEtag, matchesIfNoneMatch } from '../utils/httpCaching'

const clubRoutes: FastifyPluginAsync = async fastify => {
  // Endpoint для принудительного обновления summary (для отладки)
  fastify.get<{ Params: { clubId: string } }>('/api/clubs/:clubId/summary/refresh', async (request, reply) => {
    const raw = request.params.clubId
    const clubId = Number(raw)

    if (!Number.isFinite(clubId) || clubId <= 0) {
      return reply.status(400).send({ ok: false, error: 'club_invalid' })
    }

    try {
      const value = await refreshClubSummary(clubId)
      if (!value) {
        return reply.status(404).send({ ok: false, error: 'club_not_found' })
      }
      return reply.send({ ok: true, data: value })
    } catch (err) {
      fastify.log.error({ err, clubId }, 'club summary refresh failed')
      return reply.status(500).send({ ok: false, error: 'club_summary_refresh_failed' })
    }
  })

  fastify.get<{ Params: { clubId: string } }>('/api/clubs/:clubId/summary', async (request, reply) => {
    const raw = request.params.clubId
    const clubId = Number(raw)

    if (!Number.isFinite(clubId) || clubId <= 0) {
      return reply.status(400).send({ ok: false, error: 'club_invalid' })
    }

    try {
      const { value, version } = await getClubSummary(clubId)
      const cacheKey = publicClubSummaryKey(clubId)
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
    } catch (err) {
      if (err instanceof ClubSummaryNotFoundError) {
        return reply.status(404).send({ ok: false, error: err.code })
      }
      fastify.log.error({ err, clubId }, 'club summary fetch failed')
      return reply.status(500).send({ ok: false, error: 'club_summary_failed' })
    }
  })

  fastify.get<{ Params: { clubId: string } }>('/api/clubs/:clubId/matches', async (request, reply) => {
    const raw = request.params.clubId
    const clubId = Number(raw)

    if (!Number.isFinite(clubId) || clubId <= 0) {
      return reply.status(400).send({ ok: false, error: 'club_invalid' })
    }

    try {
      const { value, version } = await getClubMatches(clubId)
      const cacheKey = publicClubMatchesKey(clubId)
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
    } catch (err) {
      if (err instanceof ClubSummaryNotFoundError) {
        return reply.status(404).send({ ok: false, error: err.code })
      }
      fastify.log.error({ err, clubId }, 'club matches fetch failed')
      return reply.status(500).send({ ok: false, error: 'club_matches_failed' })
    }
  })
}

export default clubRoutes
