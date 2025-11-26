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
import { STREAK_REWARD_CONFIG, PREDICTIONS_REWARD_CONFIG, SEASON_POINTS_REWARD_CONFIG } from '../services/achievementJobProcessor'

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

    console.log('[Achievements API] Request:', { subject, limit, offset, isSummary, cacheKey })

    try {
      const { value: achievements, version } = await defaultCache.getWithMeta(
        cacheKey,
        async () => {
          console.log('[Achievements API] Cache MISS - fetching from DB')
          const user = await prisma.appUser.findUnique({
            where: { telegramId: BigInt(subject) },
          })

          if (!user) {
            return null
          }

          // Получаем ВСЕ типы достижений с уровнями
          const allAchievementTypes = await prisma.achievementType.findMany({
            include: {
              levels: {
                orderBy: { level: 'asc' },
              },
            },
            orderBy: { id: 'asc' },
          })

          // Получаем прогресс пользователя
          const userProgress = await prisma.userAchievementProgress.findMany({
            where: { userId: user.id },
          })

          console.log('[Achievements API] User progress from DB:', userProgress.map(p => ({
            achievementId: p.achievementId,
            progressCount: p.progressCount,
            currentLevel: p.currentLevel,
          })))

          // Создаём map прогресса для быстрого поиска
          const progressMap = new Map(userProgress.map(p => [p.achievementId, p]))

          // Получаем непрочитанные награды для анимации (за последние 24 часа)
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
            // Table may not exist yet
          }

          // Создаём map для быстрого поиска анимаций
          const animationMap = new Map(
            unnotifiedRewards.map(r => [`${r.group}:${r.tier}`, { rewardId: r.id.toString(), points: r.points }])
          )

          // Применяем пагинацию к типам достижений
          const total = allAchievementTypes.length
          const paginatedTypes = allAchievementTypes.slice(offset, offset + limit)

          const items = paginatedTypes.map(type => {
            const progress = progressMap.get(type.id)
            const currentLevel = progress?.currentLevel ?? 0
            const progressCount = progress?.progressCount ?? 0

            // Определяем группу для достижения
            const group = getAchievementGroup(type.metric)

            // Получаем следующий уровень и первый уровень (для locked state)
            const nextLevelData = type.levels.find(l => l.level === currentLevel + 1)
            const firstLevelData = type.levels.find(l => l.level === 1)
            const maxLevel = Math.max(...type.levels.map(l => l.level), 0)

            // Проверяем анимацию
            const animationInfo = animationMap.get(`${group}:${currentLevel}`)

            // Вычисляем иконку
            const iconUrl = getAchievementIconUrl(type.metric, currentLevel)

            // Вычисляем следующий порог
            const nextThreshold = nextLevelData?.threshold ?? firstLevelData?.threshold ?? 0

            const baseResult = {
              achievementId: type.id,
              group,
              currentLevel,
              currentProgress: progressCount,
              nextThreshold,
              iconSrc: iconUrl,
              shortTitle: getAchievementLevelTitle(type.metric, currentLevel),
              shouldPlayAnimation: !!animationInfo,
              animationRewardId: animationInfo?.rewardId ?? null,
              animationPoints: animationInfo?.points ?? null,
            }

            if (isSummary) {
              return baseResult
            }

            // Полная информация
            return {
              ...baseResult,
              achievementName: type.name,
              achievementDescription: type.description,
              lastUnlockedAt: progress?.lastUnlockedAt?.toISOString() ?? null,
              maxLevel,
              isMaxLevel: currentLevel >= maxLevel && maxLevel > 0,
              levels: type.levels.map(l => ({
                id: l.id,
                level: l.level,
                threshold: l.threshold,
                iconUrl: getAchievementIconUrl(type.metric, l.level),
                title: l.title || getAchievementLevelTitle(type.metric, l.level),
                description: l.description,
                points: getAchievementRewardPoints(type.metric, l.level),
              })),
            }
          })

          return {
            achievements: items,
            total,
            hasMore: offset + limit < total,
            totalUnlocked: userProgress.reduce((sum, p) => sum + p.currentLevel, 0),
          }
        },
        300 // 5 min fresh
      )

      if (achievements === null) {
        return reply.status(404).send({ ok: false, error: 'user_not_found' })
      }

      // Добавляем поле generatedAt для клиентского кэша
      const generatedAt = new Date().toISOString()
      const dataWithTimestamp = { ...achievements, generatedAt }

      // Формируем ETag на основе ключа кэша и версии
      const etag = buildWeakEtag(cacheKey, version)

      // Проверяем If-None-Match для возврата 304
      if (matchesIfNoneMatch(request.headers, etag)) {
        return reply
          .status(304)
          .header('ETag', etag)
          .header('X-Resource-Version', String(version))
          .send()
      }

      reply.header('ETag', etag)
      reply.header('X-Resource-Version', String(version))

      return reply.send({
        ok: true,
        data: dataWithTimestamp,
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

        // Инвалидируем кэш достижений (все вариации с limit/offset/summary)
        await defaultCache.invalidatePrefix(`user:achievements:${subject}`).catch(() => undefined)

        return reply.send({ ok: true })
      } catch (err) {
        request.log.error({ err }, 'mark reward notified failed')
        return reply.status(500).send({ ok: false, error: 'internal' })
      }
    }
  )
}

// Вспомогательные функции для streak достижений
// Helper функции для достижений
function getAchievementGroup(metric: string): string {
  switch (metric) {
    case 'DAILY_LOGIN':
      return 'streak'
    case 'TOTAL_PREDICTIONS':
      return 'predictions'
    case 'CORRECT_PREDICTIONS':
      return 'accuracy'
    case 'SEASON_POINTS':
      return 'credits'
    default:
      return metric.toLowerCase()
  }
}

function getAchievementIconUrl(metric: string, level: number): string {
  switch (metric) {
    case 'DAILY_LOGIN':
      return getStreakIconUrl(level)
    case 'TOTAL_PREDICTIONS':
      return getPredictionsIconUrl(level)
    case 'SEASON_POINTS':
      return getSeasonPointsIconUrl(level)
    default:
      return '/achievements/default-locked.png'
  }
}

function getAchievementLevelTitle(metric: string, level: number): string {
  switch (metric) {
    case 'DAILY_LOGIN':
      return getStreakLevelTitle(level)
    case 'TOTAL_PREDICTIONS':
      return getPredictionsLevelTitle(level)
    case 'SEASON_POINTS':
      return getSeasonPointsLevelTitle(level)
    default:
      return `Уровень ${level}`
  }
}

function getAchievementRewardPoints(metric: string, level: number): number {
  switch (metric) {
    case 'DAILY_LOGIN':
      return STREAK_REWARD_CONFIG[level] ?? 0
    case 'TOTAL_PREDICTIONS':
      return PREDICTIONS_REWARD_CONFIG[level] ?? 0
    case 'SEASON_POINTS':
      return SEASON_POINTS_REWARD_CONFIG[level] ?? 0
    default:
      return 0
  }
}

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

function getPredictionsIconUrl(level: number): string {
  switch (level) {
    case 0:
      return '/achievements/betcount-locked.png'
    case 1:
      return '/achievements/betcount-bronze.png'
    case 2:
      return '/achievements/betcount-silver.png'
    case 3:
      return '/achievements/betcount-gold.png'
    default:
      return '/achievements/betcount-locked.png'
  }
}

function getPredictionsLevelTitle(level: number): string {
  switch (level) {
    case 0:
      return 'Новичок'
    case 1:
      return 'Любитель'
    case 2:
      return 'Знаток'
    case 3:
      return 'Эксперт'
    default:
      return 'Новичок'
  }
}

function getSeasonPointsIconUrl(level: number): string {
  switch (level) {
    case 0:
      return '/achievements/credits-locked.png'
    case 1:
      return '/achievements/credits-bronze.png'
    case 2:
      return '/achievements/credits-silver.png'
    case 3:
      return '/achievements/credits-gold.png'
    default:
      return '/achievements/credits-locked.png'
  }
}

function getSeasonPointsLevelTitle(level: number): string {
  switch (level) {
    case 0:
      return 'Дебютант'
    case 1:
      return 'Форвард'
    case 2:
      return 'Голеадор'
    case 3:
      return 'Легенда'
    default:
      return 'Дебютант'
  }
}
