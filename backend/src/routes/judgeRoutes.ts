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
  broadcastMatchStatistics,
  createMatchEvent,
  deleteMatchEvent,
  ensureMatchForJudge,
  loadMatchEventsWithRoster,
  loadMatchLineupWithNumbers,
  updateMatchEvent,
} from './matchModerationHelpers'

interface JudgeJwtPayload {
  sub: string
  role: 'judge'
}

type JudgeLoginBody = {
  login?: string
  password?: string
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
}

declare module 'fastify' {
  interface FastifyRequest {
    judge?: JudgeJwtPayload
  }
}

const getJudgeSecret = () =>
  process.env.JUDGE_JWT_SECRET ||
  process.env.JWT_SECRET ||
  process.env.TELEGRAM_BOT_TOKEN ||
  'judge-portal-secret'

const getJudgeCredentials = () => ({
  login: process.env.SUDIA_LOGIN || process.env.JUDGE_LOGIN || 'SUDIA',
  password: process.env.SUDIA_PASSWORD || process.env.JUDGE_PASSWORD || 'SUDIA',
})

const issueJudgeToken = (payload: JudgeJwtPayload) =>
  jwt.sign(payload, getJudgeSecret(), {
    expiresIn: '12h',
    issuer: 'obnliga-backend',
    audience: 'judge-panel',
  })

const verifyJudgeToken = async (request: FastifyRequest, reply: FastifyReply) => {
  const authHeader = request.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ ok: false, error: 'unauthorized' })
  }

  const token = authHeader.slice('Bearer '.length)
  try {
    const decoded = jwt.verify(token, getJudgeSecret()) as JudgeJwtPayload
    if (decoded.role !== 'judge') {
      return reply.status(403).send({ ok: false, error: 'forbidden' })
    }
    request.judge = decoded
  } catch (err) {
    request.log.warn({ err }, 'judge token verification failed')
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

export default async function judgeRoutes(server: FastifyInstance) {
  server.post<{ Body: JudgeLoginBody }>('/api/judge/login', async (request, reply) => {
    const { login, password } = request.body ?? {}

    if (!login || !password) {
      return reply.status(400).send({ ok: false, error: 'login_and_password_required' })
    }

    const expected = getJudgeCredentials()
    const loginMatches = secureEquals(login, expected.login)
    const passwordMatches = secureEquals(password, expected.password)

    if (!loginMatches || !passwordMatches) {
      request.log.warn({ login }, 'judge login failed')
      return reply.status(401).send({ ok: false, error: 'invalid_credentials' })
    }

    const token = issueJudgeToken({ sub: expected.login, role: 'judge' })
    return reply.send({ ok: true, token, expiresIn: 12 * 60 * 60 })
  })

  server.register(
    async judge => {
      judge.addHook('onRequest', verifyJudgeToken)

      judge.get('/me', async (request, reply) => {
        return reply.send({ ok: true, judge: request.judge })
      })

      judge.get('/matches', async (_request, reply) => {
        const now = new Date()
        const windowStart = new Date(now.getTime() - 48 * 60 * 60 * 1000)

        const matches = await prisma.match.findMany({
          where: {
            matchDateTime: {
              gte: windowStart,
              lte: now,
            },
            status: {
              in: [MatchStatus.LIVE, MatchStatus.FINISHED],
            },
          },
          orderBy: { matchDateTime: 'desc' },
          include: {
            season: {
              select: { id: true, name: true },
            },
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

      judge.get<{ Params: MatchParams }>('/matches/:matchId/lineup', async (request, reply) => {
        const matchId = parseBigIntId(request.params.matchId, 'matchId')
        try {
          await ensureMatchForJudge(matchId)
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
          request.log.error({ err, matchId: matchId.toString() }, 'judge lineup fetch failed')
          return reply.status(500).send({ ok: false, error: 'match_lineup_failed' })
        }
      })

      judge.get<{ Params: MatchParams }>('/matches/:matchId/events', async (request, reply) => {
        const matchId = parseBigIntId(request.params.matchId, 'matchId')
        try {
          await ensureMatchForJudge(matchId)
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
          request.log.error({ err, matchId: matchId.toString() }, 'judge events fetch failed')
          return reply.status(500).send({ ok: false, error: 'match_events_failed' })
        }
      })

      judge.post<{ Params: MatchParams; Body: EventCreatePayload }>(
        '/matches/:matchId/events',
        async (request, reply) => {
          const matchId = parseBigIntId(request.params.matchId, 'matchId')
          const body = request.body

          if (!body?.playerId || !body?.teamId || !body?.minute || !body?.eventType) {
            return reply.status(400).send({ ok: false, error: 'event_fields_required' })
          }

          try {
            await ensureMatchForJudge(matchId)
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

            const publishTopic =
              typeof request.server.publishTopic === 'function'
                ? request.server.publishTopic.bind(request.server)
                : undefined
            await handleMatchFinalization(matchId, request.server.log, { publishTopic })
            return reply.send({ ok: true, data: serializePrisma(created.event) })
          } catch (err) {
            if (err instanceof RequestError) {
              return reply.status(err.statusCode).send({ ok: false, error: err.message })
            }
            request.log.error({ err, matchId: matchId.toString() }, 'judge create event failed')
            return reply.status(500).send({ ok: false, error: 'event_create_failed' })
          }
        }
      )

      judge.put<{ Params: MatchEventParams; Body: EventUpdatePayload }>(
        '/matches/:matchId/events/:eventId',
        async (request, reply) => {
          const matchId = parseBigIntId(request.params.matchId, 'matchId')
          const eventId = parseBigIntId(request.params.eventId, 'eventId')
          const body = request.body

        try {
          await ensureMatchForJudge(matchId)
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

          const publishTopic =
            typeof request.server.publishTopic === 'function'
              ? request.server.publishTopic.bind(request.server)
              : undefined
          await handleMatchFinalization(matchId, request.server.log, { publishTopic })
          return reply.send({ ok: true, data: serializePrisma(updated.event) })
        } catch (err) {
          if (err instanceof RequestError) {
            return reply.status(err.statusCode).send({ ok: false, error: err.message })
          }
          request.log.error(
            { err, matchId: matchId.toString(), eventId: eventId.toString() },
            'judge update event failed'
          )
          return reply.status(500).send({ ok: false, error: 'event_update_failed' })
        }
        }
      )

      judge.delete<{ Params: MatchEventParams }>(
        '/matches/:matchId/events/:eventId',
        async (request, reply) => {
          const matchId = parseBigIntId(request.params.matchId, 'matchId')
          const eventId = parseBigIntId(request.params.eventId, 'eventId')

        try {
          await ensureMatchForJudge(matchId)
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
          const publishTopic =
            typeof request.server.publishTopic === 'function'
              ? request.server.publishTopic.bind(request.server)
              : undefined
          await handleMatchFinalization(matchId, request.server.log, { publishTopic })
          return reply.send({ ok: true })
        } catch (err) {
          if (err instanceof RequestError) {
            return reply.status(err.statusCode).send({ ok: false, error: err.message })
          }
          request.log.error(
            { err, matchId: matchId.toString(), eventId: eventId.toString() },
            'judge delete event failed'
          )
          return reply.status(500).send({ ok: false, error: 'event_delete_failed' })
        }
        }
      )

      judge.put<{ Params: MatchParams; Body: ScoreUpdatePayload }>(
        '/matches/:matchId/score',
        async (request, reply) => {
          const matchId = parseBigIntId(request.params.matchId, 'matchId')
          const body = request.body

        let match: Awaited<ReturnType<typeof ensureMatchForJudge>>
        try {
          match = await ensureMatchForJudge(matchId)
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

        try {
          const updated = await prisma.match.update({
            where: { id: matchId },
            data: {
              homeScore: nextHomeScore,
              awayScore: nextAwayScore,
              hasPenaltyShootout: hasPenalty,
              penaltyHomeScore,
              penaltyAwayScore,
            },
          })

          const publishTopic =
            typeof request.server.publishTopic === 'function'
              ? request.server.publishTopic.bind(request.server)
              : undefined
          await handleMatchFinalization(matchId, request.server.log, { publishTopic })
          await broadcastMatchStatistics(request.server, matchId)

          return reply.send({ ok: true, data: serializePrisma(updated) })
        } catch (err) {
          request.log.error({ err, matchId: matchId.toString() }, 'judge score update failed')
          return reply.status(500).send({ ok: false, error: 'match_update_failed' })
        }
      }
      )
    },
    { prefix: '/api/judge' }
  )
}
