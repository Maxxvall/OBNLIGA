import { FastifyInstance, FastifyRequest } from 'fastify'
import prisma from '../db'
import { serializePrisma, isSerializedAppUserPayload } from '../utils/serialization'
import { defaultCache } from '../cache'
import jwt from 'jsonwebtoken'

type UserUpsertBody = {
  userId?: string | number | bigint
  username?: string | null
  photoUrl?: string | null
}

type UserParams = {
  userId?: string
}

type RequestWithSessionCookie = FastifyRequest & {
  cookies?: Record<string, string>
}

const JWT_SECRET = process.env.JWT_SECRET || process.env.TELEGRAM_BOT_TOKEN || 'dev-secret'

function extractSessionToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const tokenCandidate = authHeader.slice(7).trim()
    if (tokenCandidate) {
      return tokenCandidate
    }
  }

  const cookieToken = (request as RequestWithSessionCookie).cookies?.session
  if (typeof cookieToken === 'string' && cookieToken.trim()) {
    return cookieToken.trim()
  }

  return null
}

export default async function (server: FastifyInstance) {
  // Create or update user (idempotent upsert by userId)
  server.post<{ Body: UserUpsertBody }>('/api/users', async (request, reply) => {
    const { userId, username, photoUrl } = request.body || {}
    if (!userId) return reply.status(400).send({ error: 'userId is required' })

    try {
      const user = await prisma.appUser.upsert({
        where: { telegramId: BigInt(userId) },
        create: {
          telegramId: BigInt(userId),
          username,
          firstName: null, // Can be updated later if needed
          photoUrl: photoUrl || null,
        },
        update: {
          username,
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

          // Глобальный топик профилей
          await server.publishTopic('profile', realtimePayload)

          server.log.info({ userId }, 'Published profile updates to WebSocket topics')
        }
      } catch (wsError) {
        server.log.warn({ err: wsError }, 'Failed to publish WebSocket updates')
      }

      return reply.send(serializePrisma(user))
    } catch (err) {
      server.log.error({ err }, 'user upsert failed')
      return reply.status(500).send({ error: 'internal' })
    }
  })

  // Get user by Telegram userId
  server.get<{ Params: UserParams }>('/api/users/:userId', async (request, reply) => {
    const { userId } = request.params || {}
    if (!userId) return reply.status(400).send({ error: 'userId required' })
    try {
      // Use cache for user data (5 min TTL)
      const cacheKey = `user:${userId}`
      const u = await defaultCache.get(
        cacheKey,
        async () => {
          return await prisma.appUser.findUnique({
            where: { telegramId: BigInt(userId) },
            include: {
              leaguePlayer: true,
            },
          })
        },
        300
      ) // 5 minutes TTL

      if (!u) return reply.status(404).send({ error: 'not_found' })
      return reply.send(serializePrisma(u))
    } catch (err) {
      server.log.error({ err }, 'user fetch failed')
      return reply.status(500).send({ error: 'internal' })
    }
  })

  server.post('/api/users/league-player/request', async (request, reply) => {
    const token = extractSessionToken(request)
    if (!token) {
      return reply.status(401).send({ ok: false, error: 'no_token' })
    }

    let subject: string | undefined
    try {
      const decoded = jwt.verify(token, JWT_SECRET)
      subject =
        typeof decoded === 'string'
          ? decoded
          : typeof decoded === 'object' && typeof decoded?.sub === 'string'
          ? decoded.sub
          : undefined
    } catch (err) {
      request.log.warn({ err }, 'league player request: token verification failed')
      return reply.status(401).send({ ok: false, error: 'invalid_token' })
    }

    if (!subject) {
      return reply.status(401).send({ ok: false, error: 'invalid_token' })
    }

    const cacheKey = `user:${subject}`

    try {
      const user = await prisma.appUser.findUnique({
        where: { telegramId: BigInt(subject) },
      })

      if (!user) {
        return reply.status(404).send({ ok: false, error: 'user_not_found' })
      }

      if (user.leaguePlayerStatus === 'VERIFIED') {
        return reply.status(400).send({ ok: false, error: 'already_verified' })
      }

      if (user.leaguePlayerStatus === 'PENDING') {
        return reply.status(409).send({ ok: false, error: 'verification_pending' })
      }

      const updated = await prisma.appUser.update({
        where: { id: user.id },
        data: {
          leaguePlayerStatus: 'PENDING',
          leaguePlayerRequestedAt: new Date(),
        },
        include: { leaguePlayer: true },
      })

      await defaultCache.invalidate(cacheKey)

      return reply.send({ ok: true, user: serializePrisma(updated) })
    } catch (err) {
      request.log.error({ err }, 'league player request failed')
      return reply.status(500).send({ ok: false, error: 'internal' })
    }
  })
}
