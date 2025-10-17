/**
 * Public Match Details Routes
 * Provides minimal REST API for match details screen
 */

import type { FastifyPluginCallback } from 'fastify'
import {
  fetchMatchHeader,
  fetchMatchLineups,
  fetchMatchStats,
  fetchMatchEvents,
  fetchMatchBroadcast,
} from '../services/matchDetailsPublic'

const matchPublicRoutes: FastifyPluginCallback = (server, _opts, done) => {
  /**
   * GET /api/public/matches/:id/header
   * Returns match header (status, score, teams, current minute)
   */
  server.get<{ Params: { id: string } }>(
    '/api/public/matches/:id/header',
    async (request, reply) => {
      const { id } = request.params
      const header = await fetchMatchHeader(id)

      if (!header) {
        return reply.code(404).send({ ok: false, error: 'Match not found' })
      }

      // Calculate ETag based on header content
      const etag = `"${Buffer.from(JSON.stringify(header)).toString('base64').slice(0, 16)}"`
      
      // Check If-None-Match
      const clientEtag = request.headers['if-none-match']
      if (clientEtag && clientEtag === etag) {
        return reply.code(304).send()
      }

      reply.header('ETag', etag)
      reply.header('Cache-Control', 'public, max-age=10')
      return reply.send({ ok: true, data: header })
    }
  )

  /**
   * GET /api/public/matches/:id/lineups
   * Returns match lineups (both teams)
   */
  server.get<{ Params: { id: string } }>(
    '/api/public/matches/:id/lineups',
    async (request, reply) => {
      const { id } = request.params
      const lineups = await fetchMatchLineups(id)

      if (!lineups) {
        return reply.code(404).send({ ok: false, error: 'Match not found' })
      }

      const etag = `"${Buffer.from(JSON.stringify(lineups)).toString('base64').slice(0, 16)}"`
      
      const clientEtag = request.headers['if-none-match']
      if (clientEtag && clientEtag === etag) {
        return reply.code(304).send()
      }

      reply.header('ETag', etag)
      reply.header('Cache-Control', 'public, max-age=600')
      return reply.send({ ok: true, data: lineups })
    }
  )

  /**
   * GET /api/public/matches/:id/stats
   * Returns match statistics (shots, corners, cards)
   */
  server.get<{ Params: { id: string } }>(
    '/api/public/matches/:id/stats',
    async (request, reply) => {
      const { id } = request.params
      const stats = await fetchMatchStats(id)

      if (!stats) {
        return reply.code(404).send({ ok: false, error: 'Match not found' })
      }

      const etag = `"${Buffer.from(JSON.stringify(stats)).toString('base64').slice(0, 16)}"`
      
      const clientEtag = request.headers['if-none-match']
      if (clientEtag && clientEtag === etag) {
        return reply.code(304).send()
      }

      reply.header('ETag', etag)
      reply.header('Cache-Control', 'public, max-age=10')
      return reply.send({ ok: true, data: stats })
    }
  )

  /**
   * GET /api/public/matches/:id/events
   * Returns match events (goals, cards, substitutions)
   */
  server.get<{ Params: { id: string } }>(
    '/api/public/matches/:id/events',
    async (request, reply) => {
      const { id } = request.params
      const events = await fetchMatchEvents(id)

      if (!events) {
        return reply.code(404).send({ ok: false, error: 'Match not found' })
      }

      const etag = `"${Buffer.from(JSON.stringify(events)).toString('base64').slice(0, 16)}"`
      
      const clientEtag = request.headers['if-none-match']
      if (clientEtag && clientEtag === etag) {
        return reply.code(304).send()
      }

      reply.header('ETag', etag)
      reply.header('Cache-Control', 'public, max-age=10')
      return reply.send({ ok: true, data: events })
    }
  )

  /**
   * GET /api/public/matches/:id/broadcast
   * Returns broadcast info (stub)
   */
  server.get<{ Params: { id: string } }>(
    '/api/public/matches/:id/broadcast',
    async (request, reply) => {
      const { id } = request.params
      const broadcast = await fetchMatchBroadcast(id)

      const etag = `"${Buffer.from(JSON.stringify(broadcast)).toString('base64').slice(0, 16)}"`
      
      const clientEtag = request.headers['if-none-match']
      if (clientEtag && clientEtag === etag) {
        return reply.code(304).send()
      }

      reply.header('ETag', etag)
      reply.header('Cache-Control', 'public, max-age=86400')
      return reply.send({ ok: true, data: broadcast })
    }
  )

  done()
}

export default matchPublicRoutes
