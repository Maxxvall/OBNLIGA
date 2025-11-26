/**
 * Сервис обработки очереди задач на выдачу наград за достижения
 * Использует DB-backed очередь с opportunistic processing для render.com
 */

import { AchievementJobStatus, Prisma, RatingScope } from '@prisma/client'
import prisma from '../db'
import { defaultCache } from '../cache'
import { recalculateUserRatings, ratingPublicCacheKey } from './ratingAggregation'
import { RATING_DEFAULT_PAGE_SIZE } from './ratingConstants'

const MAX_JOB_ATTEMPTS = 3
const JOB_BATCH_SIZE = 10

// Типы для payload задачи
interface AchievementRewardJobPayload {
  type: 'achievement_reward'
  userId: number
  group: string
  tier: number
  points: number
  seasonId: number | null
}

// Конфигурация очков для уровней streak
export const STREAK_REWARD_CONFIG: Record<number, number> = {
  1: 20,   // Bronze — 7 дней
  2: 200,  // Silver — 60 дней
  3: 1000, // Gold — 180 дней
}

// Конфигурация очков для уровней predictions (betcount)
export const PREDICTIONS_REWARD_CONFIG: Record<number, number> = {
  1: 50,    // Bronze — 20 прогнозов
  2: 350,   // Silver — 100 прогнозов
  3: 1000,  // Gold — 250 прогнозов
}

// Конфигурация очков для уровней season_points (credits)
// Очки начисляются ТОЛЬКО в годовой рейтинг, не в сезонный
export const SEASON_POINTS_REWARD_CONFIG: Record<number, number> = {
  1: 50,    // Bronze (Форвард) — 200 сезонных очков
  2: 250,   // Silver (Голеадор) — 1000 сезонных очков
  3: 1000,  // Gold (Легенда) — 5000 сезонных очков
}

/**
 * Создаёт задачу на выдачу награды за достижение
 * Gracefully handles case when table doesn't exist yet
 */
export async function createAchievementRewardJob(
  userId: number,
  group: string,
  tier: number,
  points: number,
  seasonId: number | null,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<void> {
  const payload: AchievementRewardJobPayload = {
    type: 'achievement_reward',
    userId,
    group,
    tier,
    points,
    seasonId,
  }

  try {
    await client.achievementJobs.create({
      data: {
        status: AchievementJobStatus.PENDING,
        payload: payload as unknown as Prisma.InputJsonValue,
        attempts: 0,
      },
    })
  } catch {
    // Table may not exist yet — silently ignore
  }
}

/**
 * Обрабатывает одну задачу награды за достижение
 * Гарантирует идемпотентность через unique constraint
 */
async function processRewardJob(
  job: { id: bigint; payload: unknown },
  client: Prisma.TransactionClient
): Promise<void> {
  const payload = job.payload as AchievementRewardJobPayload

  if (payload.type !== 'achievement_reward') {
    throw new Error(`Unknown job type: ${(payload as { type?: string }).type}`)
  }

  const { userId, group, tier, points, seasonId } = payload

  // Idempotent upsert — если запись уже есть, не создаём дубль
  const existingReward = await client.userAchievementRewards.findFirst({
    where: {
      userId,
      group,
      tier,
      seasonId,
    },
  })

  if (existingReward) {
    // Награда уже выдана — пропускаем
    return
  }

  // Создаём запись о награде
  await client.userAchievementRewards.create({
    data: {
      userId,
      group,
      tier,
      seasonId: seasonId ?? null,
      points,
      notified: false,
    },
  })

  // Создаём adjustment для начисления очков (только для годового сезона — seasonId не null)
  // Если seasonId = null, всё равно начисляем (глобальные достижения)
  await client.adminPointAdjustment.create({
    data: {
      userId,
      adminIdentifier: 'achievement_reward',
      delta: points,
      scope: seasonId ? RatingScope.YEARLY : null,
      reason: `achievement_${group}_tier_${tier}`,
    },
  })
}

/**
 * Обрабатывает пачку pending задач
 * Opportunistic processing — запускается при других запросах
 * Gracefully handles case when table doesn't exist yet
 */
export async function processPendingAchievementJobs(limit = JOB_BATCH_SIZE): Promise<number> {
  let processedCount = 0

  // Используем raw query для SKIP LOCKED
  let pendingJobs: Array<{ achievement_job_id: bigint; payload: unknown }> = []
  try {
    pendingJobs = await prisma.$queryRaw<Array<{ achievement_job_id: bigint; payload: unknown }>>`
      SELECT achievement_job_id, payload
      FROM achievement_jobs
      WHERE status = 'PENDING'
      ORDER BY created_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `
  } catch {
    // Table may not exist yet
    return 0
  }

  if (!pendingJobs.length) {
    return 0
  }

  const jobIds = pendingJobs.map(j => j.achievement_job_id)

  // Помечаем как PROCESSING
  await prisma.achievementJobs.updateMany({
    where: { id: { in: jobIds } },
    data: { status: AchievementJobStatus.PROCESSING },
  })

  // Обрабатываем каждую задачу
  for (const job of pendingJobs) {
    try {
      await prisma.$transaction(async tx => {
        await processRewardJob(
          { id: job.achievement_job_id, payload: job.payload },
          tx
        )
      })

      // Помечаем как DONE
      await prisma.achievementJobs.update({
        where: { id: job.achievement_job_id },
        data: { status: AchievementJobStatus.DONE },
      })

      // Инвалидируем кэш после успешного начисления
      const payload = job.payload as AchievementRewardJobPayload
      const user = await prisma.appUser.findUnique({
        where: { id: payload.userId },
        select: { telegramId: true },
      })

      if (user) {
        await defaultCache.invalidatePrefix(`user:achievements:${user.telegramId}`).catch(() => undefined)
        await defaultCache.invalidate(`user:rating:${payload.userId}`).catch(() => undefined)
        await defaultCache
          .invalidate(ratingPublicCacheKey(RatingScope.CURRENT, 1, RATING_DEFAULT_PAGE_SIZE))
          .catch(() => undefined)
        await defaultCache
          .invalidate(ratingPublicCacheKey(RatingScope.YEARLY, 1, RATING_DEFAULT_PAGE_SIZE))
          .catch(() => undefined)

        await recalculateUserRatings({ userIds: [payload.userId] }).catch(() => undefined)
      }

      processedCount++
    } catch (err) {
      // Увеличиваем attempts и проверяем лимит
      const currentJob = await prisma.achievementJobs.findUnique({
        where: { id: job.achievement_job_id },
        select: { attempts: true },
      })

      const newAttempts = (currentJob?.attempts ?? 0) + 1

      if (newAttempts >= MAX_JOB_ATTEMPTS) {
        await prisma.achievementJobs.update({
          where: { id: job.achievement_job_id },
          data: {
            status: AchievementJobStatus.FAILED,
            attempts: newAttempts,
            error: err instanceof Error ? err.message : String(err),
          },
        })
      } else {
        await prisma.achievementJobs.update({
          where: { id: job.achievement_job_id },
          data: {
            status: AchievementJobStatus.PENDING,
            attempts: newAttempts,
            error: err instanceof Error ? err.message : String(err),
          },
        })
      }
    }
  }

  return processedCount
}

/**
 * Возвращает текущий год как seasonId для годовых достижений
 */
export function getCurrentYearSeasonId(): number {
  return new Date().getFullYear()
}

/**
 * Получает статистику очереди задач
 * Gracefully handles case when table doesn't exist yet
 */
export async function getAchievementJobsStats(): Promise<{
  pending: number
  processing: number
  done: number
  failed: number
}> {
  try {
    const [pending, processing, done, failed] = await Promise.all([
      prisma.achievementJobs.count({ where: { status: AchievementJobStatus.PENDING } }),
      prisma.achievementJobs.count({ where: { status: AchievementJobStatus.PROCESSING } }),
      prisma.achievementJobs.count({ where: { status: AchievementJobStatus.DONE } }),
      prisma.achievementJobs.count({ where: { status: AchievementJobStatus.FAILED } }),
    ])

    return { pending, processing, done, failed }
  } catch {
    // Table may not exist yet
    return { pending: 0, processing: 0, done: 0, failed: 0 }
  }
}

