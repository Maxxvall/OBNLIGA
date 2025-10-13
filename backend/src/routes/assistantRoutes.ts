import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import jwt from 'jsonwebtoken'
import { CompetitionType, MatchEventType, MatchStatus, SeriesFormat } from '@prisma/client'
import prisma from '../db'
import { secureEquals } from '../utils/secureEquals'
import { parseBigIntId, parseNumericId } from '../utils/parsers'
import { serializePrisma } from '../utils/serialization'
import { handleMatchFinalization } from '../services/matchAggregation'
import {
  RequestError,
  MATCH_STATISTIC_METRICS,
  MatchStatisticMetric,
  applyStatisticDelta,
  broadcastMatchStatistics,
  cleanupExpiredMatchStatistics,
  createMatchEvent,
  deleteMatchEvent,
  updateMatchEvent,
  broadcastMatchEvents,
  ensureMatchForJudge,
  getMatchStatisticsWithMeta,
  hasMatchStatisticsExpired,
  loadMatchEventsWithRoster,
  loadMatchLineupWithNumbers,
  matchStatsCacheKey,
} from './matchModerationHelpers'
import { defaultCache } from '../cache'

interface AssistantJwtPayload {
  sub: string
  role: 'assistant'
}

type MatchParams = { matchId: string }
type MatchEventParams = { matchId: string; eventId: string }

type EventCreatePayload = {
  playerId?: number
  teamId?: number
  minute?: number
  eventType?: MatchEventType
  relatedPlayerId?: number | null
}

type EventUpdatePayload = Partial<{
  minute: number
  eventType: MatchEventType
  teamId: number
  playerId: number
  relatedPlayerId: number | null
}>

type ScoreUpdatePayload = {
  homeScore?: number
  awayScore?: number
  hasPenaltyShootout?: boolean
  penaltyHomeScore?: number
  penaltyAwayScore?: number
  status?: MatchStatus
}

type StatisticsAdjustPayload = {
  clubId?: number
  metric?: MatchStatisticMetric
  delta?: number
}

declare module 'fastify' {
  interface FastifyRequest {
    assistant?: AssistantJwtPayload
  }
}

const getAssistantSecret = () => process.env.ASSISTANT_JWT_SECRET || process.env.JWT_SECRET || process.env.TELEGRAM_BOT_TOKEN

const getAssistantCredentials = () => ({
  login: process.env.POMOSH_LOGIN,
  password: process.env.POMOSH_PASSWORD,
})

const issueAssistantToken = (payload: AssistantJwtPayload) =>
  jwt.sign(payload, getAssistantSecret(), {
    expiresIn: '12h',
    issuer: 'obnliga-backend',
    audience: 'assistant-portal',
  })

const verifyAssistantToken = async (request: FastifyRequest, reply: FastifyReply) => {
  const authHeader = request.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ ok: false, error: 'unauthorized' })
  }

  const token = authHeader.slice('Bearer '.length)
  try {
    const decoded = jwt.verify(token, getAssistantSecret()) as AssistantJwtPayload
    if (decoded.role !== 'assistant') {
      return reply.status(403).send({ ok: false, error: 'forbidden' })
    }
    request.assistant = decoded
  } catch (err) {
    request.log.warn({ err }, 'assistant token verification failed')
    return reply.status(401).send({ ok: false, error: 'invalid_token' })
  }
}

const normalizeScore = (value: number | undefined, fallback: number | null): number => {
  if (value === undefined) {
    return Math.max(0, fallback ?? 0)
  }
  return Math.max(0, Math.trunc(value))
}

const parsePenaltyScore = (value: unknown, fallback: number): number => {
  if (value === undefined || value === null || value === '') {
    return Math.max(0, fallback)
  }
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new RequestError(400, 'penalty_scores_invalid')
  }
  return Math.max(0, Math.trunc(numeric))
}

const ensureAssistantMatch = (matchId: bigint) =>
  ensureMatchForJudge(matchId, {
    allowedStatuses: [MatchStatus.SCHEDULED, MatchStatus.LIVE],
    errorCode: 'match_not_available',
  })

export default async function assistantRoutes(server: FastifyInstance) {
  server.post('/api/assistant/login', async (request, reply) => {
    const { login, password } = (request.body || {}) as { login?: string; password?: string }

    if (!login || !password) {
      return reply.status(400).send({ ok: false, error: 'login_and_password_required' })
    }

    const expected = getAssistantCredentials()
    if (!expected.login || !expected.password) {
      request.log.error('POMOSH_LOGIN or POMOSH_PASSWORD env variables are not configured')
      return reply.status(503).send({ ok: false, error: 'assistant_auth_unavailable' })
    }
    const loginMatches = secureEquals(login, expected.login)
    const passwordMatches = secureEquals(password, expected.password)

    if (!loginMatches || !passwordMatches) {
      request.log.warn({ login }, 'assistant login failed')
      return reply.status(401).send({ ok: false, error: 'invalid_credentials' })
    }

  const token = issueAssistantToken({ sub: expected.login as string, role: 'assistant' })
    return reply.send({ ok: true, token, expiresIn: 12 * 60 * 60 })
  })

  server.register(
    async assistant => {
      assistant.addHook('onRequest', verifyAssistantToken)

      assistant.get('/matches', async (_request, reply) => {
        const now = new Date()
        const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000)

        const matches = await prisma.match.findMany({
          where: {
            OR: [
              {
                status: MatchStatus.SCHEDULED,
                matchDateTime: {
                  gte: new Date(now.getTime() - 60 * 60 * 1000),
                  lte: windowEnd,
                },
              },
              { status: MatchStatus.LIVE },
            ],
          },
          orderBy: { matchDateTime: 'asc' },
          include: {
            season: { select: { id: true, name: true } },
            round: true,
            homeClub: true,
            awayClub: true,
          },
        })

        const payload = matches.map(match => ({
          id: match.id.toString(),
          seasonId: match.seasonId,
          matchDateTime: match.matchDateTime.toISOString(),
          status: match.status,
          homeScore: match.homeScore ?? 0,
          awayScore: match.awayScore ?? 0,
          hasPenaltyShootout: match.hasPenaltyShootout,
          penaltyHomeScore: match.penaltyHomeScore ?? 0,
          penaltyAwayScore: match.penaltyAwayScore ?? 0,
          season: match.season ? { id: match.season.id, name: match.season.name } : null,
          round: match.round
            ? {
                id: match.round.id,
                roundType: match.round.roundType,
                roundNumber: match.round.roundNumber,
                label: match.round.label,
              }
            : null,
          homeClub: {
            id: match.homeClub.id,
            name: match.homeClub.name,
            shortName: match.homeClub.shortName,
            logoUrl: match.homeClub.logoUrl,
          },
          awayClub: {
            id: match.awayClub.id,
            name: match.awayClub.name,
            shortName: match.awayClub.shortName,
            logoUrl: match.awayClub.logoUrl,
          },
        }))

        return reply.send({ ok: true, data: serializePrisma(payload) })
      })

      assistant.get<{ Params: MatchParams }>('/matches/:matchId/lineup', async (request, reply) => {
        const matchId = parseBigIntId(request.params.matchId, 'matchId')
        try {
          await ensureAssistantMatch(matchId)
        } catch (err) {
          if (err instanceof RequestError) {
            return reply.status(err.statusCode).send({ ok: false, error: err.message })
          }
          throw err
        }

        try {
          const lineup = await loadMatchLineupWithNumbers(matchId)
          return reply.send({ ok: true, data: serializePrisma(lineup) })
        } catch (err) {
          if (err instanceof RequestError) {
            return reply.status(err.statusCode).send({ ok: false, error: err.message })
          }
          request.log.error({ err, matchId: matchId.toString() }, 'assistant lineup fetch failed')
          return reply.status(500).send({ ok: false, error: 'match_lineup_failed' })
        }
      })

      assistant.get<{ Params: MatchParams }>(
        '/matches/:matchId/events',
        async (request, reply) => {
          const matchId = parseBigIntId(request.params.matchId, 'matchId')
        try {
          await ensureAssistantMatch(matchId)
        } catch (err) {
          if (err instanceof RequestError) {
            return reply.status(err.statusCode).send({ ok: false, error: err.message })
          }
          throw err
        }

          try {
            const events = await loadMatchEventsWithRoster(matchId)
            return reply.send({ ok: true, data: serializePrisma(events) })
          } catch (err) {
            request.log.error({ err, matchId: matchId.toString() }, 'assistant events fetch failed')
            return reply.status(500).send({ ok: false, error: 'match_events_failed' })
          }
        }
      )

      assistant.post<{ Params: MatchParams; Body: EventCreatePayload }>(
        '/matches/:matchId/events',
        async (request, reply) => {
          const matchId = parseBigIntId(request.params.matchId, 'matchId')
          const body = request.body

        if (!body?.playerId || !body?.teamId || !body?.minute || !body?.eventType) {
          return reply.status(400).send({ ok: false, error: 'event_fields_required' })
        }

        try {
          await ensureAssistantMatch(matchId)
        } catch (err) {
          if (err instanceof RequestError) {
            return reply.status(err.statusCode).send({ ok: false, error: err.message })
          }
          throw err
        }

        try {
          const created = await createMatchEvent(matchId, {
            playerId: parseNumericId(body.playerId, 'playerId'),
            teamId: parseNumericId(body.teamId, 'teamId'),
            minute: parseNumericId(body.minute, 'minute'),
            eventType: body.eventType,
            relatedPlayerId: body.relatedPlayerId ?? null,
          })

          if (created.statAdjusted) {
            await broadcastMatchStatistics(request.server, matchId)
          }

          try {
            await broadcastMatchEvents(request.server, matchId)
          } catch (err) {
            request.log.warn(
              { err, matchId: matchId.toString() },
              'assistant events broadcast failed'
            )
          }

          return reply.send({ ok: true, data: serializePrisma(created.event) })
        } catch (err) {
          if (err instanceof RequestError) {
            return reply.status(err.statusCode).send({ ok: false, error: err.message })
          }
          request.log.error({ err, matchId: matchId.toString() }, 'assistant create event failed')
          return reply.status(500).send({ ok: false, error: 'event_create_failed' })
        }
        }
      )

      assistant.put<{ Params: MatchEventParams; Body: EventUpdatePayload }>(
        '/matches/:matchId/events/:eventId',
        async (request, reply) => {
          const matchId = parseBigIntId(request.params.matchId, 'matchId')
          const eventId = parseBigIntId(request.params.eventId, 'eventId')
          const body = request.body

        try {
          await ensureAssistantMatch(matchId)
        } catch (err) {
          if (err instanceof RequestError) {
            return reply.status(err.statusCode).send({ ok: false, error: err.message })
          }
          throw err
        }

        try {
          const updated = await updateMatchEvent(matchId, eventId, {
            minute: body.minute,
            eventType: body.eventType,
            teamId: body.teamId,
            playerId: body.playerId,
            relatedPlayerId: body.relatedPlayerId,
          })

          if (updated.statAdjusted) {
            await broadcastMatchStatistics(request.server, matchId)
          }

          try {
            await broadcastMatchEvents(request.server, matchId)
          } catch (err) {
            request.log.warn(
              { err, matchId: matchId.toString() },
              'assistant events broadcast failed'
            )
          }

          return reply.send({ ok: true, data: serializePrisma(updated.event) })
        } catch (err) {
          if (err instanceof RequestError) {
            return reply.status(err.statusCode).send({ ok: false, error: err.message })
          }
          request.log.error(
            { err, matchId: matchId.toString(), eventId: eventId.toString() },
            'assistant update event failed'
          )
          return reply.status(500).send({ ok: false, error: 'event_update_failed' })
        }
        }
      )

      assistant.delete<{ Params: MatchEventParams }>(
        '/matches/:matchId/events/:eventId',
        async (request, reply) => {
          const matchId = parseBigIntId(request.params.matchId, 'matchId')
          const eventId = parseBigIntId(request.params.eventId, 'eventId')

        try {
          await ensureAssistantMatch(matchId)
        } catch (err) {
          if (err instanceof RequestError) {
            return reply.status(err.statusCode).send({ ok: false, error: err.message })
          }
          throw err
        }

        try {
          const result = await deleteMatchEvent(matchId, eventId)
          if (result.statAdjusted) {
            await broadcastMatchStatistics(request.server, matchId)
          }
          try {
            await broadcastMatchEvents(request.server, matchId)
          } catch (err) {
            request.log.warn(
              { err, matchId: matchId.toString(), eventId: eventId.toString() },
              'assistant events broadcast failed'
            )
          }
          return reply.send({ ok: true })
        } catch (err) {
          if (err instanceof RequestError) {
            return reply.status(err.statusCode).send({ ok: false, error: err.message })
          }
          request.log.error(
            { err, matchId: matchId.toString(), eventId: eventId.toString() },
            'assistant delete event failed'
          )
          return reply.status(500).send({ ok: false, error: 'event_delete_failed' })
        }
        }
      )

      assistant.put<{ Params: MatchParams; Body: ScoreUpdatePayload }>(
        '/matches/:matchId/score',
        async (request, reply) => {
          const matchId = parseBigIntId(request.params.matchId, 'matchId')
          const body = request.body

        let match
        try {
          match = await ensureMatchForJudge(matchId, {
            allowedStatuses: [MatchStatus.SCHEDULED, MatchStatus.LIVE],
            errorCode: 'match_not_available',
          })
        } catch (err) {
          if (err instanceof RequestError) {
            return reply.status(err.statusCode).send({ ok: false, error: err.message })
          }
          throw err
        }

        const nextHomeScore = normalizeScore(body.homeScore, match.homeScore)
        const nextAwayScore = normalizeScore(body.awayScore, match.awayScore)

        const hasPenalty =
          typeof body.hasPenaltyShootout === 'boolean'
            ? body.hasPenaltyShootout
            : match.hasPenaltyShootout
        let penaltyHomeScore = match.penaltyHomeScore ?? 0
        let penaltyAwayScore = match.penaltyAwayScore ?? 0

        const competition = match.season?.competition
        const isBestOfSeries =
          competition?.type === CompetitionType.LEAGUE &&
          (competition.seriesFormat === SeriesFormat.BEST_OF_N ||
            competition.seriesFormat === SeriesFormat.DOUBLE_ROUND_PLAYOFF)

        if (hasPenalty) {
          if (!match.seriesId || !isBestOfSeries) {
            return reply.status(409).send({ ok: false, error: 'penalty_shootout_not_available' })
          }

          if (nextHomeScore !== nextAwayScore) {
            return reply.status(409).send({ ok: false, error: 'penalty_requires_draw' })
          }

          try {
            penaltyHomeScore = parsePenaltyScore(body.penaltyHomeScore, penaltyHomeScore)
            penaltyAwayScore = parsePenaltyScore(body.penaltyAwayScore, penaltyAwayScore)
          } catch (err) {
            if (err instanceof RequestError) {
              return reply.status(err.statusCode).send({ ok: false, error: err.message })
            }
            return reply.status(400).send({ ok: false, error: 'penalty_scores_invalid' })
          }

          if (penaltyHomeScore === penaltyAwayScore) {
            return reply.status(409).send({ ok: false, error: 'penalty_scores_required' })
          }
        } else {
          penaltyHomeScore = 0
          penaltyAwayScore = 0
        }

        const statusUpdate = body.status && body.status !== match.status ? body.status : undefined
        if (
          statusUpdate &&
          statusUpdate !== MatchStatus.LIVE &&
          statusUpdate !== MatchStatus.FINISHED
        ) {
          return reply.status(400).send({ ok: false, error: 'status_update_invalid' })
        }

        if (statusUpdate === MatchStatus.LIVE && match.status !== MatchStatus.SCHEDULED) {
          return reply.status(409).send({ ok: false, error: 'status_transition_invalid' })
        }

        if (statusUpdate === MatchStatus.FINISHED && match.status !== MatchStatus.LIVE) {
          return reply.status(409).send({ ok: false, error: 'status_transition_invalid' })
        }

        try {
          const updated = await prisma.match.update({
            where: { id: matchId },
            data: {
              homeScore: nextHomeScore,
              awayScore: nextAwayScore,
              hasPenaltyShootout: hasPenalty,
              penaltyHomeScore,
              penaltyAwayScore,
              status: statusUpdate ?? match.status,
            },
          })

          if (statusUpdate === MatchStatus.FINISHED) {
            const publishTopic =
              typeof request.server.publishTopic === 'function'
                ? request.server.publishTopic.bind(request.server)
                : undefined
            await handleMatchFinalization(matchId, request.server.log, { publishTopic })
          }

          return reply.send({ ok: true, data: serializePrisma(updated) })
        } catch (err) {
          request.log.error({ err, matchId: matchId.toString() }, 'assistant score update failed')
          return reply.status(500).send({ ok: false, error: 'match_update_failed' })
        }
        }
      )

      assistant.get<{ Params: MatchParams }>(
        '/matches/:matchId/statistics',
        async (request, reply) => {
          const matchId = parseBigIntId(request.params.matchId, 'matchId')
        try {
          await ensureAssistantMatch(matchId)
        } catch (err) {
          if (err instanceof RequestError) {
            return reply.status(err.statusCode).send({ ok: false, error: err.message })
          }
          throw err
        }

        try {
          const { value, version } = await getMatchStatisticsWithMeta(matchId)
          const serialized = serializePrisma(value)
          reply.header('X-Resource-Version', String(version))
          return reply.send({ ok: true, data: serialized, meta: { version } })
        } catch (err) {
          if (err instanceof RequestError) {
            return reply.status(err.statusCode).send({ ok: false, error: err.message })
          }
          request.log.error({ err, matchId: matchId.toString() }, 'assistant stats fetch failed')
          return reply.status(500).send({ ok: false, error: 'match_statistics_failed' })
        }
        }
      )

      assistant.post<{ Params: MatchParams; Body: StatisticsAdjustPayload }>(
        '/matches/:matchId/statistics/adjust',
        async (request, reply) => {
          const matchId = parseBigIntId(request.params.matchId, 'matchId')
          const body = request.body

        try {
          await ensureAssistantMatch(matchId)
        } catch (err) {
          if (err instanceof RequestError) {
            return reply.status(err.statusCode).send({ ok: false, error: err.message })
          }
          throw err
        }

        const clubId = body?.clubId !== undefined ? parseNumericId(body.clubId, 'clubId') : null
        if (!clubId) {
          return reply.status(400).send({ ok: false, error: 'clubId_required' })
        }

  const metric = body?.metric
        if (!metric || !MATCH_STATISTIC_METRICS.includes(metric)) {
          return reply.status(400).send({ ok: false, error: 'metric_invalid' })
        }

        const rawDelta = body?.delta
        if (
          typeof rawDelta !== 'number' ||
          Number.isNaN(rawDelta) ||
          !Number.isFinite(rawDelta) ||
          rawDelta === 0
        ) {
          return reply.status(400).send({ ok: false, error: 'delta_invalid' })
        }
        const delta = Math.max(-20, Math.min(20, Math.trunc(rawDelta)))

        const now = new Date()
        await cleanupExpiredMatchStatistics(now).catch(() => undefined)

        const match = await prisma.match.findUnique({
          where: { id: matchId },
          select: {
            id: true,
            homeTeamId: true,
            awayTeamId: true,
            status: true,
            matchDateTime: true,
          },
        })

        if (!match) {
          return reply.status(404).send({ ok: false, error: 'match_not_found' })
        }

        if (hasMatchStatisticsExpired(match.matchDateTime, now)) {
          await prisma.matchStatistic.deleteMany({ where: { matchId } }).catch(() => undefined)
          await defaultCache.invalidate(matchStatsCacheKey(matchId)).catch(() => undefined)
          return reply.status(409).send({ ok: false, error: 'match_statistics_expired' })
        }

        if (clubId !== match.homeTeamId && clubId !== match.awayTeamId) {
          return reply.status(400).send({ ok: false, error: 'club_not_in_match' })
        }

        let adjusted = false
        try {
          adjusted = await prisma.$transaction(tx =>
            applyStatisticDelta(tx, matchId, clubId, metric, delta)
          )
        } catch (err) {
          request.log.error(
            { err, matchId: matchId.toString(), clubId, metric, delta },
            'assistant stat adjust failed'
          )
          return reply.status(500).send({ ok: false, error: 'match_statistics_update_failed' })
        }

        if (adjusted) {
          try {
            const { serialized, version } = await broadcastMatchStatistics(request.server, matchId)
            reply.header('X-Resource-Version', String(version))
            return reply.send({ ok: true, data: serialized, meta: { version } })
          } catch (err) {
            if (err instanceof RequestError) {
              return reply.status(err.statusCode).send({ ok: false, error: err.message })
            }
            request.log.error(
              { err, matchId: matchId.toString() },
              'assistant stats broadcast failed'
            )
            return reply.status(500).send({ ok: false, error: 'match_statistics_failed' })
          }
        }

        try {
          const { value, version } = await getMatchStatisticsWithMeta(matchId)
          const serialized = serializePrisma(value)
          reply.header('X-Resource-Version', String(version))
          return reply.send({ ok: true, data: serialized, meta: { version } })
        } catch (err) {
          if (err instanceof RequestError) {
            return reply.status(err.statusCode).send({ ok: false, error: err.message })
          }
          request.log.error({ err, matchId: matchId.toString() }, 'assistant stats reload failed')
          return reply.status(500).send({ ok: false, error: 'match_statistics_failed' })
        }
        }
      )
    },
    { prefix: '/api/assistant' }
  )
}
