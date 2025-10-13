import { FastifyPluginAsync } from 'fastify'
import {
  ClubSummaryNotFoundError,
  getClubSummary,
} from '../services/clubSummary'

const clubRoutes: FastifyPluginAsync = async fastify => {
  fastify.get<{ Params: { clubId: string } }>('/api/clubs/:clubId/summary', async (request, reply) => {
    const raw = request.params.clubId
    const clubId = Number(raw)

    if (!Number.isFinite(clubId) || clubId <= 0) {
      return reply.status(400).send({ ok: false, error: 'club_invalid' })
    }

    try {
      const { value, version } = await getClubSummary(clubId)
      reply.header('X-Resource-Version', version)
      return reply.send({ ok: true, data: value, meta: { version } })
    } catch (err) {
      if (err instanceof ClubSummaryNotFoundError) {
        return reply.status(404).send({ ok: false, error: err.code })
      }
      fastify.log.error({ err, clubId }, 'club summary fetch failed')
      return reply.status(500).send({ ok: false, error: 'club_summary_failed' })
    }
  })
}

export default clubRoutes
