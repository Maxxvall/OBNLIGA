import { AchievementMetric, Prisma, PrismaClient } from '@prisma/client'
import prisma from '../db'
import {
  createAchievementRewardJob,
  getCurrentYearSeasonId,
  STREAK_REWARD_CONFIG,
  PREDICTIONS_REWARD_CONFIG,
  SEASON_POINTS_REWARD_CONFIG,
} from './achievementJobProcessor'

const DEFAULT_CLIENT = prisma

const selectTypeByMetric = async (
  metric: AchievementMetric,
  client: Prisma.TransactionClient | PrismaClient = DEFAULT_CLIENT
) => {
  return client.achievementType.findMany({
    where: { metric },
    include: {
      levels: {
        orderBy: { level: 'asc' },
      },
    },
  })
}

const resolveUnlockedLevel = (thresholds: Array<{ level: number; threshold: number }>, value: number) => {
  if (!thresholds.length) {
    return 0
  }
  let unlocked = 0
  for (const entry of thresholds) {
    if (value >= entry.threshold && entry.level > unlocked) {
      unlocked = entry.level
    }
  }
  return unlocked
}

export const incrementAchievementProgress = async (
  userId: number,
  metric: AchievementMetric,
  delta = 1,
  client: Prisma.TransactionClient | PrismaClient = DEFAULT_CLIENT
) => {
  if (delta <= 0) {
    return
  }

  const types = await selectTypeByMetric(metric, client)
  if (!types.length) {
    return
  }

  const now = new Date()

  for (const type of types) {
    const progress = await client.userAchievementProgress.upsert({
      where: {
        achievement_progress_unique: {
          userId,
          achievementId: type.id,
        },
      },
      create: {
        userId,
        achievementId: type.id,
        progressCount: delta,
        currentLevel: 0,
      },
      update: {
        progressCount: { increment: delta },
      },
    })

    const unlockedLevel = resolveUnlockedLevel(type.levels, progress.progressCount)

    if (unlockedLevel > progress.currentLevel) {
      await client.userAchievementProgress.update({
        where: { id: progress.id },
        data: {
          currentLevel: unlockedLevel,
          lastUnlockedAt: now,
        },
      })

      await client.userAchievement.upsert({
        where: {
          userId_achievementTypeId: {
            userId,
            achievementTypeId: type.id,
          },
        },
        update: {
          achievedDate: now,
        },
        create: {
          userId,
          achievementTypeId: type.id,
          achievedDate: now,
        },
      })

      // Создаём job для асинхронного начисления наград
      const seasonId = getCurrentYearSeasonId()

      if (metric === AchievementMetric.DAILY_LOGIN) {
        const points = STREAK_REWARD_CONFIG[unlockedLevel]
        if (points) {
          await createAchievementRewardJob(userId, 'streak', unlockedLevel, points, seasonId, client)
        }
      } else if (metric === AchievementMetric.TOTAL_PREDICTIONS) {
        const points = PREDICTIONS_REWARD_CONFIG[unlockedLevel]
        if (points) {
          await createAchievementRewardJob(userId, 'predictions', unlockedLevel, points, seasonId, client)
        }
      } else if (metric === AchievementMetric.SEASON_POINTS) {
        // Очки за сезонные достижения идут ТОЛЬКО в годовой рейтинг
        const points = SEASON_POINTS_REWARD_CONFIG[unlockedLevel]
        if (points) {
          await createAchievementRewardJob(userId, 'credits', unlockedLevel, points, seasonId, client)
        }
      }
    }
  }
}

/**
 * Синхронизирует прогресс достижения SEASON_POINTS с текущими сезонными очками.
 * Используется при пересчёте рейтингов для обновления прогресса.
 * Устанавливает progressCount равным текущим сезонным очкам (не инкрементирует).
 */
export const syncSeasonPointsProgress = async (
  userId: number,
  seasonalPoints: number,
  client: Prisma.TransactionClient | PrismaClient = DEFAULT_CLIENT
) => {
  if (seasonalPoints <= 0) {
    return
  }

  const types = await selectTypeByMetric(AchievementMetric.SEASON_POINTS, client)
  if (!types.length) {
    return
  }

  const now = new Date()

  for (const type of types) {
    const progress = await client.userAchievementProgress.upsert({
      where: {
        achievement_progress_unique: {
          userId,
          achievementId: type.id,
        },
      },
      create: {
        userId,
        achievementId: type.id,
        progressCount: seasonalPoints,
        currentLevel: 0,
      },
      update: {
        progressCount: seasonalPoints,
      },
    })

    const unlockedLevel = resolveUnlockedLevel(type.levels, progress.progressCount)

    if (unlockedLevel > progress.currentLevel) {
      await client.userAchievementProgress.update({
        where: { id: progress.id },
        data: {
          currentLevel: unlockedLevel,
          lastUnlockedAt: now,
        },
      })

      await client.userAchievement.upsert({
        where: {
          userId_achievementTypeId: {
            userId,
            achievementTypeId: type.id,
          },
        },
        update: {
          achievedDate: now,
        },
        create: {
          userId,
          achievementTypeId: type.id,
          achievedDate: now,
        },
      })

      // Создаём job для асинхронного начисления наград (только в годовой рейтинг)
      const seasonId = getCurrentYearSeasonId()
      const points = SEASON_POINTS_REWARD_CONFIG[unlockedLevel]
      if (points) {
        await createAchievementRewardJob(userId, 'credits', unlockedLevel, points, seasonId, client)
      }
    }
  }
}

/**
 * Batch-синхронизация прогресса SEASON_POINTS для всех пользователей с рейтингом.
 * Используется после массового пересчёта рейтингов или периодически.
 * Оптимизирована для минимизации транзакций.
 */
export const syncAllSeasonPointsProgress = async (
  client: Prisma.TransactionClient | PrismaClient = DEFAULT_CLIENT
): Promise<number> => {
  // Находим тип достижения SEASON_POINTS
  const achievementType = await client.achievementType.findFirst({
    where: { metric: AchievementMetric.SEASON_POINTS },
    include: {
      levels: {
        orderBy: { level: 'asc' },
      },
    },
  })

  if (!achievementType) {
    return 0
  }

  // Получаем все userRating с seasonalPoints > 0
  const ratings = await client.userRating.findMany({
    where: { seasonalPoints: { gt: 0 } },
    select: { userId: true, seasonalPoints: true },
  })

  if (!ratings.length) {
    return 0
  }

  let syncedCount = 0
  const now = new Date()
  const seasonId = getCurrentYearSeasonId()

  // Обрабатываем batch'ами по 50 пользователей
  const BATCH_SIZE = 50
  for (let i = 0; i < ratings.length; i += BATCH_SIZE) {
    const batch = ratings.slice(i, i + BATCH_SIZE)

    for (const rating of batch) {
      const progress = await client.userAchievementProgress.upsert({
        where: {
          achievement_progress_unique: {
            userId: rating.userId,
            achievementId: achievementType.id,
          },
        },
        create: {
          userId: rating.userId,
          achievementId: achievementType.id,
          progressCount: rating.seasonalPoints,
          currentLevel: 0,
        },
        update: {
          progressCount: rating.seasonalPoints,
        },
      })

      const unlockedLevel = resolveUnlockedLevel(achievementType.levels, progress.progressCount)

      if (unlockedLevel > progress.currentLevel) {
        await client.userAchievementProgress.update({
          where: { id: progress.id },
          data: {
            currentLevel: unlockedLevel,
            lastUnlockedAt: now,
          },
        })

        await client.userAchievement.upsert({
          where: {
            userId_achievementTypeId: {
              userId: rating.userId,
              achievementTypeId: achievementType.id,
            },
          },
          update: {
            achievedDate: now,
          },
          create: {
            userId: rating.userId,
            achievementTypeId: achievementType.id,
            achievedDate: now,
          },
        })

        // Создаём job для асинхронного начисления наград
        const points = SEASON_POINTS_REWARD_CONFIG[unlockedLevel]
        if (points) {
          await createAchievementRewardJob(rating.userId, 'credits', unlockedLevel, points, seasonId, client)
        }
      }

      syncedCount++
    }
  }

  return syncedCount
}
