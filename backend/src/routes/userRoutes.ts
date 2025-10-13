import { FastifyInstance } from 'fastify'
import prisma from '../db'
import { serializePrisma, isSerializedAppUserPayload } from '../utils/serialization'
import { defaultCache } from '../cache'

type UserUpsertBody = {
  userId?: string | number | bigint
  username?: string | null
  photoUrl?: string | null
}

type UserParams = {
  userId?: string
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
          return await prisma.appUser.findUnique({ where: { telegramId: BigInt(userId) } })
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
}
