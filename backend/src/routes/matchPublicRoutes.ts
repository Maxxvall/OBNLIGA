/**
 * Public Match Details Routes
 * Provides minimal REST API for match details screen
 */

import type { FastifyPluginCallback, FastifyReply } from 'fastify'
import {
  fetchMatchHeader,
  fetchMatchLineups,
  fetchMatchStats,
  fetchMatchEvents,
  fetchMatchBroadcast,
} from '../services/matchDetailsPublic'

const buildEtag = (version: number) => `"${version}"`

const hasMatchingEtag = (candidate: string | undefined, etag: string) => {
  if (!candidate) {
    return false
  }
  if (candidate.trim() === '*') {
    return true
  }
  const normalized = candidate
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
  return normalized.some(value => value.replace(/^W\//, '') === etag)
}

const setCachingHeaders = (reply: FastifyReply, etag: string, version: number, cacheControl: string) => {
  reply.header('ETag', etag)
  reply.header('X-Resource-Version', String(version))
  reply.header('Cache-Control', cacheControl)
}

const matchPublicRoutes: FastifyPluginCallback = (server, _opts, done) => {
  /**
   * GET /api/public/matches/:id/header
   * Returns match header (status, score, teams, current minute)
   */
  server.get<{ Params: { id: string } }>(
    '/api/public/matches/:id/header',
    async (request, reply) => {
      const { id } = request.params
      const cached = await fetchMatchHeader(id)

      if (!cached) {
        return reply.code(404).send({ ok: false, error: 'Match not found' })
      }

      const { data, version } = cached
      const etag = buildEtag(version)
      const clientEtag = request.headers['if-none-match']
      if (hasMatchingEtag(clientEtag, etag)) {
        setCachingHeaders(reply, etag, version, 'public, max-age=5, stale-while-revalidate=10')
        return reply.code(304).send()
      }

      setCachingHeaders(reply, etag, version, 'public, max-age=5, stale-while-revalidate=10')
      return reply.send({ ok: true, data })
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
      const cached = await fetchMatchLineups(id)

      if (!cached) {
        return reply.code(404).send({ ok: false, error: 'Match not found' })
      }

      const { data, version } = cached
      const etag = buildEtag(version)
      const clientEtag = request.headers['if-none-match']
      if (hasMatchingEtag(clientEtag, etag)) {
        setCachingHeaders(reply, etag, version, 'public, max-age=60, stale-while-revalidate=120')
        return reply.code(304).send()
      }

      setCachingHeaders(reply, etag, version, 'public, max-age=60, stale-while-revalidate=120')
      return reply.send({ ok: true, data })
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
      const cached = await fetchMatchStats(id)

      if (!cached) {
        return reply.code(404).send({ ok: false, error: 'Match not found' })
      }

      const { data, version } = cached
      const etag = buildEtag(version)
      const clientEtag = request.headers['if-none-match']
      if (hasMatchingEtag(clientEtag, etag)) {
        setCachingHeaders(reply, etag, version, 'public, max-age=5, stale-while-revalidate=10')
        return reply.code(304).send()
      }

      setCachingHeaders(reply, etag, version, 'public, max-age=5, stale-while-revalidate=10')
      return reply.send({ ok: true, data })
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
      const cached = await fetchMatchEvents(id)

      if (!cached) {
        return reply.code(404).send({ ok: false, error: 'Match not found' })
      }

      const { data, version } = cached
      const etag = buildEtag(version)
      const clientEtag = request.headers['if-none-match']
      if (hasMatchingEtag(clientEtag, etag)) {
        setCachingHeaders(reply, etag, version, 'public, max-age=5, stale-while-revalidate=10')
        return reply.code(304).send()
      }

      setCachingHeaders(reply, etag, version, 'public, max-age=5, stale-while-revalidate=10')
      return reply.send({ ok: true, data })
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
      const cached = await fetchMatchBroadcast(id)
      const { data, version } = cached
      const etag = buildEtag(version)
      const clientEtag = request.headers['if-none-match']
      if (hasMatchingEtag(clientEtag, etag)) {
        setCachingHeaders(reply, etag, version, 'public, max-age=86400, stale-while-revalidate=86400')
        return reply.code(304).send()
      }

      setCachingHeaders(reply, etag, version, 'public, max-age=86400, stale-while-revalidate=86400')
      return reply.send({ ok: true, data })
    }
  )

  done()
}

export default matchPublicRoutes
