import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import prisma from '../db'
import jwt from 'jsonwebtoken'
import {
  parse as parseInitData,
  validate as validateInitData,
  validate3rd as validateInitDataSignature,
} from '@tma.js/init-data-node'
import { PlayerClubCareerStats } from '@prisma/client'
import { serializePrisma, isSerializedAppUserPayload } from '../utils/serialization'
import { defaultCache } from '../cache'

const INIT_DATA_MAX_AGE_SEC = 24 * 60 * 60

type TelegramInitBody =
  | string
  | {
      initData?: unknown
      init_data?: unknown
      [key: string]: unknown
    }
  | null
  | undefined

type TelegramInitQuery = {
  initData?: unknown
  init_data?: unknown
  token?: unknown
  [key: string]: unknown
}

type ReplyWithOptionalSetCookie = FastifyReply & {
  setCookie?: (
    name: string,
    value: string,
    options: {
      httpOnly?: boolean
      path?: string
      sameSite?: 'lax' | 'strict' | 'none'
    }
  ) => unknown
}

type RequestWithSessionCookie = FastifyRequest & {
  cookies?: {
    session?: string
  }
}

type LeaguePlayerStatsPayload = {
  matches: number
  goals: number
  assists: number
  penaltyGoals: number
  yellowCards: number
  redCards: number
}

function aggregateCareerStats(rows: PlayerClubCareerStats[]): LeaguePlayerStatsPayload | null {
  if (!rows.length) {
    return null
  }

  return rows.reduce<LeaguePlayerStatsPayload>(
    (acc, row) => ({
      matches: acc.matches + row.totalMatches,
      goals: acc.goals + row.totalGoals,
      assists: acc.assists + row.totalAssists,
      penaltyGoals: acc.penaltyGoals + row.penaltyGoals,
      yellowCards: acc.yellowCards + row.yellowCards,
      redCards: acc.redCards + row.redCards,
    }),
    { matches: 0, goals: 0, assists: 0, penaltyGoals: 0, yellowCards: 0, redCards: 0 }
  )
}

export default async function (server: FastifyInstance) {
  // Simple CORS preflight handlers for auth endpoints (used when frontend is served from a different origin)
  server.options('/api/auth/telegram-init', async (request, reply) => {
    const origin = (request.headers.origin as string) || '*'
    reply.header('Access-Control-Allow-Origin', origin)
    reply.header('Access-Control-Allow-Credentials', 'true')
    reply.header('Access-Control-Allow-Methods', 'POST, OPTIONS')
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    reply.header('Access-Control-Max-Age', '600')
    return reply.status(204).send()
  })
  server.options('/api/auth/me', async (request, reply) => {
    const origin = (request.headers.origin as string) || '*'
    reply.header('Access-Control-Allow-Origin', origin)
    reply.header('Access-Control-Allow-Credentials', 'true')
    reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS')
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    reply.header('Access-Control-Max-Age', '600')
    return reply.status(204).send()
  })
  server.post('/api/auth/telegram-init', async (request, reply) => {
    const rawBody = request.body as TelegramInitBody
    const bodyObject =
      rawBody && typeof rawBody === 'object' ? (rawBody as Record<string, unknown>) : undefined
    // Accept initData from multiple possible places (body, query, header)
    const q = ((request.query as TelegramInitQuery | undefined) ?? {}) as TelegramInitQuery
    const headerInit = (request.headers['x-telegram-init-data'] ||
      request.headers['x-telegram-initdata']) as string | undefined
    const rawCandidate =
      bodyObject?.initData ||
      bodyObject?.init_data ||
      q.initData ||
      q.init_data ||
      headerInit ||
      (typeof rawBody === 'string' ? rawBody : undefined)
    if (!rawCandidate) return reply.status(400).send({ error: 'initData required' })

    const botToken = process.env.TELEGRAM_BOT_TOKEN
    if (!botToken) {
      server.log.warn('TELEGRAM_BOT_TOKEN not set; cannot verify initData')
      return reply.status(500).send({ error: 'server misconfigured' })
    }

    const rawInitData = String(rawCandidate || '')
    const trimmedInitData = rawInitData.trim()

    let userId: string | undefined
    let username: string | undefined
    let firstName: string | undefined
    let photoUrl: string | undefined
    let authDateSec: number | undefined
    let verificationMethod: 'hash' | 'signature' | 'json' | undefined

    try {
      if (!trimmedInitData) {
        throw new Error('empty_init_data')
      }

      if (trimmedInitData.startsWith('{')) {
        // JSON payload — fallback for dev environments when initData string is unavailable.
        verificationMethod = 'json'
        const parsed = JSON.parse(trimmedInitData)
        const u = parsed?.user
        if (!u?.id) {
          throw new Error('json_payload_missing_user')
        }
        userId = String(u.id)
        username = u.username
        firstName = u.first_name
        photoUrl = u.photo_url || u.photoUrl
        if (u.auth_date) authDateSec = Number(u.auth_date)
        server.log.warn(
          { userId },
          'telegram-init: accepted JSON user payload without signature (dev fallback)'
        )
        server.log.info(
          { userId, username, photoUrl, verificationMethod },
          'telegram-init: initData processed via JSON payload'
        )
      } else {
        // Signed initData — verify using hash and fall back to Telegram signature.
        const maxAge = INIT_DATA_MAX_AGE_SEC
        try {
          validateInitData(trimmedInitData, botToken, { expiresIn: maxAge })
          verificationMethod = 'hash'
        } catch (hashErr) {
          const botId = Number.parseInt(botToken.split(':')[0] ?? '', 10)
          server.log.warn(
            { err: hashErr },
            'telegram-init: hash verification failed, attempting signature fallback'
          )
          if (!Number.isFinite(botId)) {
            throw hashErr
          }
          await validateInitDataSignature(trimmedInitData, botId, { expiresIn: maxAge })
          verificationMethod = 'signature'
        }

        const parsed = parseInitData(trimmedInitData)
        const parsedUser = parsed?.user
        if (parsedUser?.id != null) {
          userId = String(parsedUser.id)
        }
        if (parsedUser) {
          username = typeof parsedUser.username === 'string' ? parsedUser.username : undefined
          firstName = typeof parsedUser.first_name === 'string' ? parsedUser.first_name : undefined
          const parsedPhoto = parsedUser.photo_url
          if (typeof parsedPhoto === 'string' && parsedPhoto.length) {
            photoUrl = parsedPhoto
          }
        }
        const parsedAuth = parsed?.auth_date
        if (parsedAuth instanceof Date) {
          authDateSec = Math.floor(parsedAuth.getTime() / 1000)
        }

        server.log.info(
          { userId, username, photoUrl, verificationMethod },
          'telegram-init: initData verified'
        )
      }
    } catch (err) {
      server.log.warn({ err, rawCandidate }, 'initData verification failed')
      return reply.status(403).send({ error: 'invalid_init_data' })
    }

    if (authDateSec) {
      const nowSec = Math.floor(Date.now() / 1000)
      if (nowSec - authDateSec > INIT_DATA_MAX_AGE_SEC) {
        server.log.info({ auth_date: authDateSec }, 'telegram-init: auth_date expired')
        return reply.status(403).send({ error: 'init_data_expired' })
      }
    }

    if (!userId) return reply.status(400).send({ error: 'user id missing' })

    try {
      const user = await prisma.appUser.upsert({
        where: { telegramId: BigInt(userId) },
        create: {
          telegramId: BigInt(userId),
          username,
          firstName: firstName || null,
          photoUrl: photoUrl || null,
        },
        update: {
          username,
          firstName: firstName || undefined,
          photoUrl: photoUrl || undefined,
        },
      })

      // Invalidate cache after upsert
      const userCacheKey = `user:${userId}`
      await defaultCache.invalidate(userCacheKey)

      // Publish real-time updates для WebSocket subscribers
      try {
        const userPayload = serializePrisma(user)

        if (!isSerializedAppUserPayload(userPayload)) {
          server.log.warn({ userPayload }, 'Unexpected user payload shape after serialization')
        } else {
          const realtimePayload = {
            type: 'profile_updated' as const,
            telegramId: userPayload.telegramId,
            username: userPayload.username,
            firstName: userPayload.firstName,
            photoUrl: userPayload.photoUrl,
            updatedAt: userPayload.updatedAt,
          }

          // Персональный топик пользователя
          await server.publishTopic(`user:${userId}`, realtimePayload)

          // Глобальный топик профилей (для админки, статистики и т.д.)
          await server.publishTopic('profile', realtimePayload)

          server.log.info({ userId }, 'Published profile updates to WebSocket topics')
        }
      } catch (wsError) {
        server.log.warn({ err: wsError }, 'Failed to publish WebSocket updates')
        // Не прерываем выполнение, WebSocket не критичен для auth flow
      }

      // Create a JWT session token (short lived) and set as httpOnly cookie
      const jwtSecret = process.env.JWT_SECRET || process.env.TELEGRAM_BOT_TOKEN || 'dev-secret'
      const token = jwt.sign({ sub: String(user.telegramId), username: user.username }, jwtSecret, {
        expiresIn: '7d',
      })

      // set cookie (httpOnly). Fastify reply.setCookie requires fastify-cookie plugin; we fallback to header if not present.
      try {
        // try set cookie if plugin available
        const replyWithCookie = reply as ReplyWithOptionalSetCookie
        replyWithCookie.setCookie?.('session', token, {
          httpOnly: true,
          path: '/',
          sameSite: 'lax',
        })
      } catch (e) {
        // fallback: send token in body only
      }

      const serializedUser = serializePrisma(user)
      const origin = (request.headers.origin as string) || '*'
      reply.header('Access-Control-Allow-Origin', origin)
      reply.header('Access-Control-Allow-Credentials', 'true')
      return reply.send({ ok: true, user: serializedUser, token })
    } catch (err) {
      server.log.error({ err }, 'telegram-init upsert failed')
      return reply.status(500).send({ error: 'internal' })
    }
  })

  // Get current user by JWT (cookie, Authorization header, or ?token=)
  server.get('/api/auth/me', async (request, reply) => {
    const authHeader = (request.headers && (request.headers.authorization as string)) || ''
    const queryParams = ((request.query as TelegramInitQuery | undefined) ?? {}) as TelegramInitQuery
    const qToken = typeof queryParams.token === 'string' ? queryParams.token : undefined
    const cookieToken = (request as RequestWithSessionCookie).cookies?.session
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : qToken || cookieToken
    if (!token) return reply.status(401).send({ error: 'no_token' })
    const jwtSecret = process.env.JWT_SECRET || process.env.TELEGRAM_BOT_TOKEN || 'dev-secret'
    try {
      const jwtPayload = jwt.verify(token, jwtSecret)
      const sub =
        typeof jwtPayload === 'string'
          ? jwtPayload
          : typeof jwtPayload?.sub === 'string'
          ? jwtPayload.sub
          : undefined
      if (!sub) return reply.status(401).send({ error: 'bad_token' })

      // Use cache for user data (5 min TTL)
      const cacheKey = `user:${sub}`
      const u = await defaultCache.get(
        cacheKey,
        async () => {
          return await prisma.appUser.findUnique({
            where: { telegramId: BigInt(sub) },
            include: {
              leaguePlayer: true,
            },
          })
        },
        300
      ) // 5 minutes TTL

      if (!u) return reply.status(404).send({ error: 'not_found' })
      const serializedUser = serializePrisma(u) as Record<string, unknown>

      const leaguePlayerId = u.leaguePlayerId
      if (typeof leaguePlayerId === 'number') {
        try {
          const career = await prisma.playerClubCareerStats.findMany({
            where: { personId: leaguePlayerId },
          })
          const aggregated = aggregateCareerStats(career)
          if (aggregated) {
            serializedUser.leaguePlayerStats = aggregated
          }
        } catch (err) {
          request.log.error({ err, leaguePlayerId }, 'failed to load league player stats')
        }
      }

      const origin = (request.headers.origin as string) || '*'
      reply.header('Access-Control-Allow-Origin', origin)
      reply.header('Access-Control-Allow-Credentials', 'true')
      return reply.send({ ok: true, user: serializedUser })
    } catch (e) {
      const msg = e instanceof Error ? e.message : undefined
      return reply.status(401).send({ error: 'invalid_token', detail: msg })
    }
  })
}
