import { FastifyInstance } from 'fastify'
import prisma from '../db'
import { serializePrisma, isSerializedAppUserPayload } from '../utils/serialization'
import { defaultCache } from '../cache'
import { extractSessionToken, resolveSessionSubject } from '../utils/session'
import { buildWeakEtag, matchesIfNoneMatch } from '../utils/httpCaching'
import {
  DAILY_REWARD_CACHE_OPTIONS,
  dailyRewardCacheKey,
  getDailyRewardSummary,
  claimDailyReward,
  DailyRewardError,
} from '../services/dailyRewards'
import { STREAK_REWARD_CONFIG } from '../services/achievementJobProcessor'

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

    const subject = resolveSessionSubject(token)
    if (!subject) {
      request.log.warn('league player request: token verification failed')
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

  server.get('/api/users/me/daily-reward', async (request, reply) => {
    const token = extractSessionToken(request)
    if (!token) {
      return reply.status(401).send({ ok: false, error: 'no_token' })
    }

    const subject = resolveSessionSubject(token)
    if (!subject) {
      return reply.status(401).send({ ok: false, error: 'invalid_token' })
    }

    const user = await prisma.appUser.findUnique({
      where: { telegramId: BigInt(subject) },
      select: { id: true },
    })

    if (!user) {
      return reply.status(404).send({ ok: false, error: 'user_not_found' })
    }

    const { value, version } = await getDailyRewardSummary(user.id)
    const etag = buildWeakEtag(dailyRewardCacheKey(user.id), version)

    if (matchesIfNoneMatch(request.headers, etag)) {
      return reply
        .status(304)
        .header('ETag', etag)
        .header('X-Resource-Version', String(version))
        .send()
    }

    reply.header(
      'Cache-Control',
      `private, max-age=${DAILY_REWARD_CACHE_OPTIONS.ttlSeconds}, stale-while-revalidate=${DAILY_REWARD_CACHE_OPTIONS.staleWhileRevalidateSeconds}`
    )
    reply.header('ETag', etag)
    reply.header('X-Resource-Version', String(version))

    return reply.send({ ok: true, data: value, meta: { version } })
  })

  server.post('/api/users/me/daily-reward/claim', async (request, reply) => {
    const token = extractSessionToken(request)
    if (!token) {
      return reply.status(401).send({ ok: false, error: 'no_token' })
    }

    const subject = resolveSessionSubject(token)
    if (!subject) {
      return reply.status(401).send({ ok: false, error: 'invalid_token' })
    }

    const user = await prisma.appUser.findUnique({
      where: { telegramId: BigInt(subject) },
      select: { id: true },
    })

    if (!user) {
      return reply.status(404).send({ ok: false, error: 'user_not_found' })
    }

    try {
      const result = await claimDailyReward(user.id)
      const etag = buildWeakEtag(dailyRewardCacheKey(user.id), result.version)
      reply.header('ETag', etag)
      reply.header('X-Resource-Version', String(result.version))
      return reply.send({
        ok: true,
        data: {
          summary: result.summary,
          awarded: result.awarded,
        },
        meta: { version: result.version },
      })
    } catch (err) {
      if (err instanceof DailyRewardError) {
        return reply.status(err.status).send({ ok: false, error: err.code })
      }
      request.log.error({ err }, 'daily reward claim failed')
      return reply.status(500).send({ ok: false, error: 'internal' })
    }
  })

  // Get user achievements progress with pagination and summary support
  server.get('/api/users/me/achievements', async (request, reply) => {
    const token = extractSessionToken(request)
    if (!token) {
      return reply.status(401).send({ ok: false, error: 'no_token' })
    }

    const subject = resolveSessionSubject(token)
    if (!subject) {
      request.log.warn('user achievements: token verification failed')
      return reply.status(401).send({ ok: false, error: 'invalid_token' })
    }

    const query = request.query as {
      limit?: string
      offset?: string
      summary?: string
    }
    const limit = Math.min(50, Math.max(1, parseInt(query.limit ?? '50', 10) || 50))
    const offset = Math.max(0, parseInt(query.offset ?? '0', 10) || 0)
    const isSummary = query.summary === 'true'

    const cacheKey = `user:achievements:${subject}:${limit}:${offset}:${isSummary}`

    try {
      const achievements = await defaultCache.get(
        cacheKey,
        async () => {
          const user = await prisma.appUser.findUnique({
            where: { telegramId: BigInt(subject) },
          })

          if (!user) {
            return null
          }

          // Получаем прогресс достижений с пагинацией
          const [progress, total] = await Promise.all([
            prisma.userAchievementProgress.findMany({
              where: { userId: user.id },
              include: {
                achievement: {
                  include: {
                    levels: {
                      orderBy: { level: 'asc' },
                    },
                  },
                },
              },
              skip: offset,
              take: limit,
              orderBy: { achievementId: 'asc' },
            }),
            prisma.userAchievementProgress.count({ where: { userId: user.id } }),
          ])

          // Получаем непрочитанные награды для анимации (за последние 24 часа)
          // Gracefully handle case when table doesn't exist yet
          let unnotifiedRewards: { id: bigint; group: string; tier: number; points: number }[] = []
          try {
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
            unnotifiedRewards = await prisma.userAchievementReward.findMany({
              where: {
                userId: user.id,
                notified: false,
                createdAt: { gte: oneDayAgo },
              },
              select: {
                id: true,
                group: true,
                tier: true,
                points: true,
              },
            })
          } catch {
            // Table may not exist yet — ignore and return empty
          }

          // Создаём map для быстрого поиска анимаций
          const animationMap = new Map(
            unnotifiedRewards.map(r => [`${r.group}:${r.tier}`, { rewardId: r.id.toString(), points: r.points }])
          )

          const items = progress.map(p => {
            const currentLevelData = p.achievement.levels.find(l => l.level === p.currentLevel)
            const nextLevelData = p.achievement.levels.find(l => l.level === p.currentLevel + 1)
            const maxLevel = Math.max(...p.achievement.levels.map(l => l.level), 0)

            // Проверяем, есть ли непрочитанная награда для этого достижения
            // Для streak группа = 'streak', tier = currentLevel
            const group = p.achievement.metric === 'DAILY_LOGIN' ? 'streak' : p.achievement.name.toLowerCase()
            const animationInfo = animationMap.get(`${group}:${p.currentLevel}`)

            // Вычисляем иконку для streak на основе уровня
            let iconUrl = currentLevelData?.iconUrl ?? null
            if (p.achievement.metric === 'DAILY_LOGIN') {
              iconUrl = getStreakIconUrl(p.currentLevel)
            }

            const baseResult = {
              achievementId: p.achievementId,
              group,
              currentLevel: p.currentLevel,
              currentProgress: p.progressCount,
              nextThreshold: nextLevelData?.threshold ?? (currentLevelData?.threshold ?? 0),
              iconSrc: iconUrl,
              shortTitle: currentLevelData?.title ?? getStreakLevelTitle(p.currentLevel),
              shouldPlayAnimation: !!animationInfo,
              animationRewardId: animationInfo?.rewardId ?? null,
              animationPoints: animationInfo?.points ?? null,
            }

            if (isSummary) {
              return baseResult
            }

            // Полная информация для не-summary запросов
            return {
              ...baseResult,
              achievementName: p.achievement.name,
              achievementDescription: p.achievement.description,
              lastUnlockedAt: p.lastUnlockedAt?.toISOString() ?? null,
              maxLevel,
              isMaxLevel: p.currentLevel >= maxLevel && maxLevel > 0,
              levels: p.achievement.levels.map(l => ({
                id: l.id,
                level: l.level,
                threshold: l.threshold,
                iconUrl: p.achievement.metric === 'DAILY_LOGIN' ? getStreakIconUrl(l.level) : l.iconUrl,
                title: l.title || getStreakLevelTitle(l.level),
                description: l.description,
                points: p.achievement.metric === 'DAILY_LOGIN' ? (STREAK_REWARD_CONFIG[l.level] ?? 0) : 0,
              })),
            }
          })

          return {
            achievements: items,
            total,
            hasMore: offset + limit < total,
            totalUnlocked: progress.reduce((sum, p) => sum + p.currentLevel, 0),
          }
        },
        300 // 5 min fresh
      )

      if (achievements === null) {
        return reply.status(404).send({ ok: false, error: 'user_not_found' })
      }

      return reply.send({
        ok: true,
        data: {
          ...achievements,
          generatedAt: new Date().toISOString(),
        },
      })
    } catch (err) {
      request.log.error({ err }, 'user achievements fetch failed')
      return reply.status(500).send({ ok: false, error: 'internal' })
    }
  })

  // Mark achievement reward as notified (для анимации)
  server.post<{ Params: { rewardId: string } }>(
    '/api/users/me/achievements/:rewardId/mark-notified',
    async (request, reply) => {
      const token = extractSessionToken(request)
      if (!token) {
        return reply.status(401).send({ ok: false, error: 'no_token' })
      }

      const subject = resolveSessionSubject(token)
      if (!subject) {
        return reply.status(401).send({ ok: false, error: 'invalid_token' })
      }

      const rewardIdParam = request.params.rewardId
      const rewardId = BigInt(rewardIdParam)

      try {
        const user = await prisma.appUser.findUnique({
          where: { telegramId: BigInt(subject) },
          select: { id: true },
        })

        if (!user) {
          return reply.status(404).send({ ok: false, error: 'user_not_found' })
        }

        // Обновляем только если награда принадлежит пользователю
        // Gracefully handle case when table doesn't exist yet
        try {
          const updated = await prisma.userAchievementReward.updateMany({
            where: {
              id: rewardId,
              userId: user.id,
              notified: false,
            },
            data: { notified: true },
          })

          if (updated.count === 0) {
            return reply.status(404).send({ ok: false, error: 'reward_not_found' })
          }
        } catch {
          // Table may not exist yet
          return reply.status(404).send({ ok: false, error: 'reward_not_found' })
        }

        // Инвалидируем кэш достижений
        await defaultCache.invalidate(`user:achievements:${subject}`).catch(() => undefined)

        return reply.send({ ok: true })
      } catch (err) {
        request.log.error({ err }, 'mark reward notified failed')
        return reply.status(500).send({ ok: false, error: 'internal' })
      }
    }
  )
}

// Вспомогательные функции для streak достижений
function getStreakIconUrl(level: number): string {
  switch (level) {
    case 0:
      return '/achievements/streak-locked.png'
    case 1:
      return '/achievements/streak-bronze.png'
    case 2:
      return '/achievements/streak-silver.png'
    case 3:
      return '/achievements/streak-gold.png'
    default:
      return '/achievements/streak-locked.png'
  }
}

function getStreakLevelTitle(level: number): string {
  switch (level) {
    case 0:
      return 'Скамейка'
    case 1:
      return 'Запасной'
    case 2:
      return 'Основной'
    case 3:
      return 'Капитан'
    default:
      return 'Скамейка'
  }
}
