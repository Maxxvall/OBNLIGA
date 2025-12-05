/**
 * API для подписок на команды и матчи, а также настройки уведомлений.
 * Поддерживает ETag и кэширование для оптимизации.
 */

import { FastifyPluginAsync } from 'fastify'
import type Redis from 'ioredis'
import prisma from '../db'
import { defaultCache } from '../cache'
import { buildWeakEtag, matchesIfNoneMatch } from '../utils/httpCaching'
import { extractSessionToken, resolveSessionSubject } from '../utils/session'
import { scheduleNotificationsForClubSubscription } from './subscriptionHelpers'

// Константы кэширования
const SUBSCRIPTIONS_CACHE_TTL_SECONDS = 300 // 5 минут
const TOGGLE_RATE_LIMIT_SECONDS = 10
const toggleRedis = defaultCache.getRedisClient()

const isToggleRateLimited = async (
  redis: Redis | null,
  userId: number,
  target: string
): Promise<boolean> => {
  if (!redis) return false
  const key = `sub:toggle:${userId}:${target}`
  try {
    const result = await redis.set(key, '1', 'EX', TOGGLE_RATE_LIMIT_SECONDS, 'NX')
    return result === null
  } catch {
    return false
  }
}

// =================== ТИПЫ ===================

interface ClubSubscriptionView {
  id: number
  clubId: number
  clubName: string
  clubShortName: string
  clubLogoUrl: string | null
  createdAt: string
}

interface MatchSubscriptionView {
  id: number
  matchId: string
  homeClubName: string
  awayClubName: string
  matchDateTime: string
  createdAt: string
}

interface NotificationSettingsView {
  enabled: boolean
  remindBefore: number
  matchStartEnabled: boolean
  matchEndEnabled: boolean
  goalEnabled: boolean
}

interface SubscriptionsSummaryView {
  clubs: ClubSubscriptionView[]
  matches: MatchSubscriptionView[]
  settings: NotificationSettingsView
}

// =================== ХЕЛПЕРЫ ===================

const getUserCacheKey = (telegramId: bigint) => `user:${telegramId}:subscriptions`

const invalidateUserCaches = async (telegramId: bigint, scopes: Array<'clubs' | 'matches' | 'summary'>) => {
  const keys = scopes.map(scope => `${getUserCacheKey(telegramId)}:${scope}`)
  await Promise.all(keys.map(key => defaultCache.invalidate(key)))
}

/** Парсит telegramId из строки */
const parseTelegramId = (value: string | null): bigint | null => {
  if (!value) return null
  try {
    return BigInt(value)
  } catch {
    return null
  }
}

/** Получает userId (AppUser.id) по telegramId */
const getUserIdByTelegramId = async (telegramId: bigint): Promise<number | null> => {
  const user = await prisma.appUser.findUnique({
    where: { telegramId },
    select: { id: true },
  })
  return user?.id ?? null
}

/** Получает или создаёт настройки уведомлений */
const getOrCreateNotificationSettings = async (userId: number) => {
  let settings = await prisma.notificationSettings.findUnique({
    where: { userId },
  })

  if (!settings) {
    settings = await prisma.notificationSettings.create({
      data: {
        userId,
        enabled: true,
        remindBefore: 30,
        matchStartEnabled: true,
        matchEndEnabled: false,
        goalEnabled: false,
      },
    })
  }

  return settings
}

// =================== РОУТЫ ===================

const subscriptionRoutes: FastifyPluginAsync = async fastify => {
  // =================== ПОДПИСКИ НА КОМАНДЫ ===================

  // Получить список подписок пользователя на команды
  fastify.get('/api/subscriptions/clubs', async (request, reply) => {
    const token = extractSessionToken(request)
    if (!token) {
      return reply.status(401).send({ ok: false, error: 'unauthorized' })
    }

    const subject = resolveSessionSubject(token)
    const telegramId = parseTelegramId(subject)
    if (!telegramId) {
      return reply.status(401).send({ ok: false, error: 'invalid_token' })
    }

    const userId = await getUserIdByTelegramId(telegramId)
    if (!userId) {
      return reply.status(401).send({ ok: false, error: 'user_not_found' })
    }

    const cacheKey = `${getUserCacheKey(telegramId)}:clubs`

    try {
      const { value, version } = await defaultCache.getWithMeta(
        cacheKey,
        async () => {
          const subscriptions = await prisma.clubSubscription.findMany({
            where: { userId },
            include: {
              club: {
                select: {
                  id: true,
                  name: true,
                  shortName: true,
                  logoUrl: true,
                },
              },
            },
            orderBy: { createdAt: 'desc' },
          })

          return subscriptions.map(sub => ({
            id: sub.id,
            clubId: sub.club.id,
            clubName: sub.club.name,
            clubShortName: sub.club.shortName,
            clubLogoUrl: sub.club.logoUrl,
            createdAt: sub.createdAt.toISOString(),
          }))
        },
        { ttlSeconds: SUBSCRIPTIONS_CACHE_TTL_SECONDS }
      )

      const etag = buildWeakEtag(cacheKey, version)

      if (matchesIfNoneMatch(request.headers, etag)) {
        return reply.status(304).header('ETag', etag).send()
      }

      return reply
        .header('ETag', etag)
        .header('Cache-Control', 'private, max-age=60')
        .send({ ok: true, data: value })
    } catch (err) {
      fastify.log.error({ err, telegramId: telegramId.toString() }, 'Failed to fetch club subscriptions')
      return reply.status(500).send({ ok: false, error: 'internal_error' })
    }
  })

  // Подписаться на команду
  fastify.post<{ Params: { clubId: string } }>(
    '/api/subscriptions/clubs/:clubId',
    async (request, reply) => {
      const token = extractSessionToken(request)
      if (!token) {
        return reply.status(401).send({ ok: false, error: 'unauthorized' })
      }

      const subject = resolveSessionSubject(token)
      const telegramId = parseTelegramId(subject)
      if (!telegramId) {
        return reply.status(401).send({ ok: false, error: 'invalid_token' })
      }

      const userId = await getUserIdByTelegramId(telegramId)
      if (!userId) {
        return reply.status(401).send({ ok: false, error: 'user_not_found' })
      }

      const clubId = Number(request.params.clubId)
      if (!Number.isFinite(clubId) || clubId <= 0) {
        return reply.status(400).send({ ok: false, error: 'invalid_club_id' })
      }

      if (await isToggleRateLimited(toggleRedis, userId, `club:${clubId}`)) {
        return reply.status(429).send({ ok: false, error: 'rate_limited', retryAfter: TOGGLE_RATE_LIMIT_SECONDS })
      }

      try {
        // Проверяем, что клуб существует
        const club = await prisma.club.findUnique({ where: { id: clubId } })
        if (!club) {
          return reply.status(404).send({ ok: false, error: 'club_not_found' })
        }

        // Проверяем, нет ли уже подписки
        const existing = await prisma.clubSubscription.findUnique({
          where: { userId_clubId: { userId, clubId } },
        })

        if (existing) {
          return reply.send({ ok: true, data: { subscribed: true, alreadySubscribed: true } })
        }

        // Создаём подписку
        await prisma.clubSubscription.create({
          data: { userId, clubId },
        })

        // Планируем уведомления для предстоящих матчей этой команды
        await scheduleNotificationsForClubSubscription(userId, telegramId, clubId)

        // Инвалидируем кэш
        await invalidateUserCaches(telegramId, ['clubs', 'summary'])

        return reply.status(201).send({ ok: true, data: { subscribed: true } })
      } catch (err) {
        fastify.log.error({ err, telegramId: telegramId.toString(), clubId }, 'Failed to subscribe to club')
        return reply.status(500).send({ ok: false, error: 'internal_error' })
      }
    }
  )

  // Отписаться от команды
  fastify.delete<{ Params: { clubId: string } }>(
    '/api/subscriptions/clubs/:clubId',
    async (request, reply) => {
      const token = extractSessionToken(request)
      if (!token) {
        return reply.status(401).send({ ok: false, error: 'unauthorized' })
      }

      const subject = resolveSessionSubject(token)
      const telegramId = parseTelegramId(subject)
      if (!telegramId) {
        return reply.status(401).send({ ok: false, error: 'invalid_token' })
      }

      const userId = await getUserIdByTelegramId(telegramId)
      if (!userId) {
        return reply.status(401).send({ ok: false, error: 'user_not_found' })
      }

      const clubId = Number(request.params.clubId)
      if (!Number.isFinite(clubId) || clubId <= 0) {
        return reply.status(400).send({ ok: false, error: 'invalid_club_id' })
      }

      if (await isToggleRateLimited(toggleRedis, userId, `club:${clubId}`)) {
        return reply.status(429).send({ ok: false, error: 'rate_limited', retryAfter: TOGGLE_RATE_LIMIT_SECONDS })
      }

      try {
        await prisma.$transaction([
          prisma.clubSubscription.deleteMany({
            where: { userId, clubId },
          }),
          prisma.notificationQueue.updateMany({
            where: {
              userId,
              status: 'PENDING',
              match: {
                OR: [{ homeTeamId: clubId }, { awayTeamId: clubId }],
              },
            },
            data: { status: 'CANCELLED' },
          }),
        ])

        // Инвалидируем кэш
        await invalidateUserCaches(telegramId, ['clubs', 'summary'])

        return reply.send({ ok: true, data: { subscribed: false } })
      } catch (err) {
        fastify.log.error({ err, telegramId: telegramId.toString(), clubId }, 'Failed to unsubscribe from club')
        return reply.status(500).send({ ok: false, error: 'internal_error' })
      }
    }
  )

  // Проверить, подписан ли пользователь на команду
  fastify.get<{ Params: { clubId: string } }>(
    '/api/subscriptions/clubs/:clubId/status',
    async (request, reply) => {
      const token = extractSessionToken(request)
      if (!token) {
        return reply.status(401).send({ ok: false, error: 'unauthorized' })
      }

      const subject = resolveSessionSubject(token)
      const telegramId = parseTelegramId(subject)
      if (!telegramId) {
        return reply.status(401).send({ ok: false, error: 'invalid_token' })
      }

      const userId = await getUserIdByTelegramId(telegramId)
      if (!userId) {
        return reply.status(401).send({ ok: false, error: 'user_not_found' })
      }

      const clubId = Number(request.params.clubId)
      if (!Number.isFinite(clubId) || clubId <= 0) {
        return reply.status(400).send({ ok: false, error: 'invalid_club_id' })
      }

      try {
        const subscription = await prisma.clubSubscription.findUnique({
          where: { userId_clubId: { userId, clubId } },
        })

        return reply.send({
          ok: true,
          data: { subscribed: subscription !== null },
        })
      } catch (err) {
        fastify.log.error({ err, telegramId: telegramId.toString(), clubId }, 'Failed to check club subscription')
        return reply.status(500).send({ ok: false, error: 'internal_error' })
      }
    }
  )

  // =================== ПОДПИСКИ НА МАТЧИ ===================

  // Получить список подписок на матчи
  fastify.get('/api/subscriptions/matches', async (request, reply) => {
    const token = extractSessionToken(request)
    if (!token) {
      return reply.status(401).send({ ok: false, error: 'unauthorized' })
    }

    const subject = resolveSessionSubject(token)
    const telegramId = parseTelegramId(subject)
    if (!telegramId) {
      return reply.status(401).send({ ok: false, error: 'invalid_token' })
    }

    const userId = await getUserIdByTelegramId(telegramId)
    if (!userId) {
      return reply.status(401).send({ ok: false, error: 'user_not_found' })
    }

    const cacheKey = `${getUserCacheKey(telegramId)}:matches`

    try {
      const { value, version } = await defaultCache.getWithMeta(
        cacheKey,
        async () => {
          const subscriptions = await prisma.matchSubscription.findMany({
            where: { userId },
            include: {
              match: {
                select: {
                  id: true,
                  matchDateTime: true,
                  homeClub: { select: { name: true } },
                  awayClub: { select: { name: true } },
                },
              },
            },
            orderBy: { createdAt: 'desc' },
          })

          return subscriptions.map(sub => ({
            id: sub.id,
            matchId: sub.match.id.toString(),
            homeClubName: sub.match.homeClub.name,
            awayClubName: sub.match.awayClub.name,
            matchDateTime: sub.match.matchDateTime.toISOString(),
            createdAt: sub.createdAt.toISOString(),
          }))
        },
        { ttlSeconds: SUBSCRIPTIONS_CACHE_TTL_SECONDS }
      )

      const etag = buildWeakEtag(cacheKey, version)

      if (matchesIfNoneMatch(request.headers, etag)) {
        return reply.status(304).header('ETag', etag).send()
      }

      return reply
        .header('ETag', etag)
        .header('Cache-Control', 'private, max-age=60')
        .send({ ok: true, data: value })
    } catch (err) {
      fastify.log.error({ err, telegramId: telegramId.toString() }, 'Failed to fetch match subscriptions')
      return reply.status(500).send({ ok: false, error: 'internal_error' })
    }
  })

  // Подписаться на матч
  fastify.post<{ Params: { matchId: string } }>(
    '/api/subscriptions/matches/:matchId',
    async (request, reply) => {
      const token = extractSessionToken(request)
      if (!token) {
        return reply.status(401).send({ ok: false, error: 'unauthorized' })
      }

      const subject = resolveSessionSubject(token)
      const telegramId = parseTelegramId(subject)
      if (!telegramId) {
        return reply.status(401).send({ ok: false, error: 'invalid_token' })
      }

      const userId = await getUserIdByTelegramId(telegramId)
      if (!userId) {
        return reply.status(401).send({ ok: false, error: 'user_not_found' })
      }

      let matchId: bigint
      try {
        matchId = BigInt(request.params.matchId)
      } catch {
        return reply.status(400).send({ ok: false, error: 'invalid_match_id' })
      }

      if (await isToggleRateLimited(toggleRedis, userId, `match:${matchId.toString()}`)) {
        return reply.status(429).send({ ok: false, error: 'rate_limited', retryAfter: TOGGLE_RATE_LIMIT_SECONDS })
      }

      try {
        const match = await prisma.match.findUnique({ where: { id: matchId } })
        if (!match) {
          return reply.status(404).send({ ok: false, error: 'match_not_found' })
        }

        const existing = await prisma.matchSubscription.findUnique({
          where: { userId_matchId: { userId, matchId } },
        })

        if (existing) {
          return reply.send({ ok: true, data: { subscribed: true, alreadySubscribed: true } })
        }

        await prisma.matchSubscription.create({
          data: { userId, matchId },
        })

        // Планируем уведомление
        const settings = await getOrCreateNotificationSettings(userId)

        if (settings.enabled && match.status === 'SCHEDULED') {
          const scheduledAt = new Date(match.matchDateTime)
          scheduledAt.setMinutes(scheduledAt.getMinutes() - settings.remindBefore)

          if (scheduledAt > new Date()) {
            await prisma.notificationQueue.upsert({
              where: {
                userId_matchId_messageType: {
                  userId,
                  matchId,
                  messageType: 'MATCH_REMINDER',
                },
              },
              create: {
                userId,
                telegramId,
                matchId,
                scheduledAt,
                messageType: 'MATCH_REMINDER',
              },
              update: { scheduledAt, status: 'PENDING' },
            })
          }
        }

        // Инвалидируем кэш
        await invalidateUserCaches(telegramId, ['matches', 'summary'])

        return reply.status(201).send({ ok: true, data: { subscribed: true } })
      } catch (err) {
        fastify.log.error({ err, telegramId: telegramId.toString(), matchId: matchId.toString() }, 'Failed to subscribe to match')
        return reply.status(500).send({ ok: false, error: 'internal_error' })
      }
    }
  )

  // Отписаться от матча
  fastify.delete<{ Params: { matchId: string } }>(
    '/api/subscriptions/matches/:matchId',
    async (request, reply) => {
      const token = extractSessionToken(request)
      if (!token) {
        return reply.status(401).send({ ok: false, error: 'unauthorized' })
      }

      const subject = resolveSessionSubject(token)
      const telegramId = parseTelegramId(subject)
      if (!telegramId) {
        return reply.status(401).send({ ok: false, error: 'invalid_token' })
      }

      const userId = await getUserIdByTelegramId(telegramId)
      if (!userId) {
        return reply.status(401).send({ ok: false, error: 'user_not_found' })
      }

      let matchId: bigint
      try {
        matchId = BigInt(request.params.matchId)
      } catch {
        return reply.status(400).send({ ok: false, error: 'invalid_match_id' })
      }

      if (await isToggleRateLimited(toggleRedis, userId, `match:${matchId.toString()}`)) {
        return reply.status(429).send({ ok: false, error: 'rate_limited', retryAfter: TOGGLE_RATE_LIMIT_SECONDS })
      }

      try {
        await prisma.$transaction([
          prisma.matchSubscription.deleteMany({
            where: { userId, matchId },
          }),
          prisma.notificationQueue.updateMany({
            where: { userId, matchId, status: 'PENDING' },
            data: { status: 'CANCELLED' },
          }),
        ])

        // Инвалидируем кэш
        await invalidateUserCaches(telegramId, ['matches', 'summary'])

        return reply.send({ ok: true, data: { subscribed: false } })
      } catch (err) {
        fastify.log.error({ err, telegramId: telegramId.toString(), matchId: matchId.toString() }, 'Failed to unsubscribe from match')
        return reply.status(500).send({ ok: false, error: 'internal_error' })
      }
    }
  )

  // =================== НАСТРОЙКИ УВЕДОМЛЕНИЙ ===================

  // Получить настройки уведомлений
  fastify.get('/api/notifications/settings', async (request, reply) => {
    const token = extractSessionToken(request)
    if (!token) {
      return reply.status(401).send({ ok: false, error: 'unauthorized' })
    }

    const subject = resolveSessionSubject(token)
    const telegramId = parseTelegramId(subject)
    if (!telegramId) {
      return reply.status(401).send({ ok: false, error: 'invalid_token' })
    }

    const userId = await getUserIdByTelegramId(telegramId)
    if (!userId) {
      return reply.status(401).send({ ok: false, error: 'user_not_found' })
    }

    try {
      const settings = await getOrCreateNotificationSettings(userId)

      const result: NotificationSettingsView = {
        enabled: settings.enabled,
        remindBefore: settings.remindBefore,
        matchStartEnabled: settings.matchStartEnabled,
        matchEndEnabled: settings.matchEndEnabled,
        goalEnabled: settings.goalEnabled,
      }

      await invalidateUserCaches(telegramId, ['summary'])

      return reply.send({ ok: true, data: result })
    } catch (err) {
      fastify.log.error({ err, telegramId: telegramId.toString() }, 'Failed to fetch notification settings')
      return reply.status(500).send({ ok: false, error: 'internal_error' })
    }
  })

  // Обновить настройки уведомлений
  fastify.patch<{
    Body: Partial<NotificationSettingsView>
  }>('/api/notifications/settings', async (request, reply) => {
    const token = extractSessionToken(request)
    if (!token) {
      return reply.status(401).send({ ok: false, error: 'unauthorized' })
    }

    const subject = resolveSessionSubject(token)
    const telegramId = parseTelegramId(subject)
    if (!telegramId) {
      return reply.status(401).send({ ok: false, error: 'invalid_token' })
    }

    const userId = await getUserIdByTelegramId(telegramId)
    if (!userId) {
      return reply.status(401).send({ ok: false, error: 'user_not_found' })
    }

    const body = request.body || {}

    // Валидация remindBefore
    if (body.remindBefore !== undefined) {
      const allowed = [15, 30, 60, 1440] // 15 мин, 30 мин, 1 час, 1 день
      if (!allowed.includes(body.remindBefore)) {
        return reply.status(400).send({
          ok: false,
          error: 'invalid_remind_before',
          message: 'Допустимые значения: 15, 30, 60, 1440',
        })
      }
    }

    try {
      // Получаем или создаём настройки
      await getOrCreateNotificationSettings(userId)

      // Обновляем только переданные поля
      const updateData: Partial<{
        enabled: boolean
        remindBefore: number
        matchStartEnabled: boolean
        matchEndEnabled: boolean
        goalEnabled: boolean
      }> = {}

      if (typeof body.enabled === 'boolean') updateData.enabled = body.enabled
      if (typeof body.remindBefore === 'number') updateData.remindBefore = body.remindBefore
      if (typeof body.matchStartEnabled === 'boolean') updateData.matchStartEnabled = body.matchStartEnabled
      if (typeof body.matchEndEnabled === 'boolean') updateData.matchEndEnabled = body.matchEndEnabled
      if (typeof body.goalEnabled === 'boolean') updateData.goalEnabled = body.goalEnabled

      const settings = await prisma.notificationSettings.update({
        where: { userId },
        data: updateData,
      })

      // Если изменилось время напоминания, пересчитываем scheduledAt для PENDING уведомлений
      if (body.remindBefore !== undefined) {
        const pendingNotifications = await prisma.notificationQueue.findMany({
          where: { userId, status: 'PENDING', messageType: 'MATCH_REMINDER' },
          include: { match: { select: { matchDateTime: true } } },
        })

        for (const notification of pendingNotifications) {
          const newScheduledAt = new Date(notification.match.matchDateTime)
          newScheduledAt.setMinutes(newScheduledAt.getMinutes() - settings.remindBefore)

          if (newScheduledAt > new Date()) {
            await prisma.notificationQueue.update({
              where: { id: notification.id },
              data: { scheduledAt: newScheduledAt },
            })
          } else {
            // Если новое время уже прошло — отменяем
            await prisma.notificationQueue.update({
              where: { id: notification.id },
              data: { status: 'CANCELLED' },
            })
          }
        }
      }

      const result: NotificationSettingsView = {
        enabled: settings.enabled,
        remindBefore: settings.remindBefore,
        matchStartEnabled: settings.matchStartEnabled,
        matchEndEnabled: settings.matchEndEnabled,
        goalEnabled: settings.goalEnabled,
      }

      return reply.send({ ok: true, data: result })
    } catch (err) {
      fastify.log.error({ err, telegramId: telegramId.toString() }, 'Failed to update notification settings')
      return reply.status(500).send({ ok: false, error: 'internal_error' })
    }
  })

  // =================== СВОДКА ПОДПИСОК ===================

  // Получить сводку всех подписок пользователя (для профиля)
  fastify.get('/api/subscriptions/summary', async (request, reply) => {
    const token = extractSessionToken(request)
    if (!token) {
      return reply.status(401).send({ ok: false, error: 'unauthorized' })
    }

    const subject = resolveSessionSubject(token)
    const telegramId = parseTelegramId(subject)
    if (!telegramId) {
      return reply.status(401).send({ ok: false, error: 'invalid_token' })
    }

    const userId = await getUserIdByTelegramId(telegramId)
    if (!userId) {
      return reply.status(401).send({ ok: false, error: 'user_not_found' })
    }

    const cacheKey = `${getUserCacheKey(telegramId)}:summary`

    try {
      const { value, version } = await defaultCache.getWithMeta(
        cacheKey,
        async () => {
          // Загружаем все данные параллельно
          const [clubSubs, matchSubs, settings] = await Promise.all([
            prisma.clubSubscription.findMany({
              where: { userId },
              include: {
                club: { select: { id: true, name: true, shortName: true, logoUrl: true } },
              },
              orderBy: { createdAt: 'desc' },
            }),
            prisma.matchSubscription.findMany({
              where: { userId },
              include: {
                match: {
                  select: {
                    id: true,
                    matchDateTime: true,
                    homeClub: { select: { name: true } },
                    awayClub: { select: { name: true } },
                  },
                },
              },
              orderBy: { createdAt: 'desc' },
            }),
            getOrCreateNotificationSettings(userId),
          ])

          return {
            clubs: clubSubs.map(sub => ({
              id: sub.id,
              clubId: sub.club.id,
              clubName: sub.club.name,
              clubShortName: sub.club.shortName,
              clubLogoUrl: sub.club.logoUrl,
              createdAt: sub.createdAt.toISOString(),
            })),
            matches: matchSubs.map(sub => ({
              id: sub.id,
              matchId: sub.match.id.toString(),
              homeClubName: sub.match.homeClub.name,
              awayClubName: sub.match.awayClub.name,
              matchDateTime: sub.match.matchDateTime.toISOString(),
              createdAt: sub.createdAt.toISOString(),
            })),
            settings: {
              enabled: settings.enabled,
              remindBefore: settings.remindBefore,
              matchStartEnabled: settings.matchStartEnabled,
              matchEndEnabled: settings.matchEndEnabled,
              goalEnabled: settings.goalEnabled,
            },
          } as SubscriptionsSummaryView
        },
        { ttlSeconds: 60 }
      )

      const etag = buildWeakEtag(cacheKey, version)

      if (matchesIfNoneMatch(request.headers, etag)) {
        return reply.status(304).header('ETag', etag).send()
      }

      return reply
        .header('ETag', etag)
        .header('Cache-Control', 'private, max-age=60')
        .send({ ok: true, data: value })
    } catch (err) {
      fastify.log.error({ err, telegramId: telegramId.toString() }, 'Failed to fetch subscriptions summary')
      return reply.status(500).send({ ok: false, error: 'internal_error' })
    }
  })
}

export default subscriptionRoutes
