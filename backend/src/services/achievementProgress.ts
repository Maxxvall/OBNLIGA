import { AchievementMetric, Prisma, PrismaClient } from '@prisma/client'
import prisma from '../db'

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
    }
  }
}
