import {
  AchievementMetric,
  Prisma,
  RatingScope,
} from '@prisma/client'
import prisma from '../db'
import { defaultCache } from '../cache'
import { incrementAchievementProgress } from './achievementProgress'
import { processPendingAchievementJobs } from './achievementJobProcessor'
import type { DailyRewardSummary } from '@shared/types'
import { recalculateUserRatings, ratingPublicCacheKey } from './ratingAggregation'
import { RATING_DEFAULT_PAGE_SIZE } from './ratingConstants'

const DAILY_REWARD_TIMEZONE = process.env.DAILY_REWARD_TIMEZONE ?? 'Europe/Moscow'
const DAILY_REWARD_TIMEZONE_OFFSET_MINUTES = Number.parseInt(
  process.env.DAILY_REWARD_TIMEZONE_OFFSET_MINUTES ?? '180',
  10
)
const DAILY_REWARD_CACHE_OPTIONS = {
  ttlSeconds: 60,
  staleWhileRevalidateSeconds: 600,
}

const rewardConfig = [
  { day: 1, points: 1, animationKey: 'pulse', gradient: ['#ffba7a', '#ffdd9b'] as const },
  { day: 2, points: 3, animationKey: 'spark', gradient: ['#ffd572', '#ffb347'] as const },
  { day: 3, points: 5, animationKey: 'wave', gradient: ['#ff9ceb', '#ff7edc'] as const },
  { day: 4, points: 7, animationKey: 'orbit', gradient: ['#9be7ff', '#5ac8ff'] as const },
  { day: 5, points: 10, animationKey: 'flare', gradient: ['#7af0c6', '#35ddb0'] as const },
  { day: 6, points: 15, animationKey: 'burst', gradient: ['#8e9bff', '#5f6bff'] as const },
  { day: 7, points: 30, animationKey: 'nova', gradient: ['#ff8f70', '#ff3d7f'] as const },
]

const cycleLength = rewardConfig.length

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: DAILY_REWARD_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const parseKey = (key: string) => {
  const [yearStr, monthStr, dayStr] = key.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null
  }
  return { year, month, day }
}

const epochDay = (key: string) => {
  const parts = parseKey(key)
  if (!parts) {
    return null
  }
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000)
}

const diffKeys = (currentKey: string, previousKey: string) => {
  const current = epochDay(currentKey)
  const previous = epochDay(previousKey)
  if (current === null || previous === null) {
    return null
  }
  return current - previous
}

const keyForDate = (date: Date) => dateFormatter.format(date)

const timezoneMidnightUtc = (key: string) => {
  const parts = parseKey(key)
  if (!parts) {
    return null
  }
  const offsetMinutes = Number.isFinite(DAILY_REWARD_TIMEZONE_OFFSET_MINUTES)
    ? DAILY_REWARD_TIMEZONE_OFFSET_MINUTES
    : 180
  const hoursOffset = Math.floor(offsetMinutes / 60)
  const minutesRemainder = offsetMinutes % 60
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day, -hoursOffset, -minutesRemainder, 0)
  return utc
}

const cacheKey = (userId: number) => `user:daily-reward:${userId}`

const getRewardForDay = (day: number) => rewardConfig.find(entry => entry.day === day)

const computeCycleProgress = (
  lastDay: number,
  hasClaimToday: boolean,
  missed: boolean
): number => {
  if (!lastDay || missed) {
    return 0
  }
  if (!hasClaimToday && lastDay === cycleLength) {
    return 0
  }
  return lastDay
}

const buildSummary = async (userId: number): Promise<DailyRewardSummary> => {
  const now = new Date()
  const todayKey = keyForDate(now)

  const user = await prisma.appUser.findUnique({
    where: { id: userId },
    select: {
      currentStreak: true,
      lastLoginDate: true,
    },
  })

  if (!user) {
    throw new Error('user_not_found')
  }

  const [lastClaim, aggregates] = await Promise.all([
    prisma.dailyRewardClaim.findFirst({
      where: { userId },
      orderBy: { claimedAt: 'desc' },
    }),
    prisma.dailyRewardClaim.aggregate({
      where: { userId },
      _count: { _all: true },
      _sum: { pointsAwarded: true },
    }),
  ])

  const lastClaimDateKey = user.lastLoginDate ? keyForDate(user.lastLoginDate) : null
  const diffFromLast = lastClaimDateKey ? diffKeys(todayKey, lastClaimDateKey) : null
  const hasClaimToday = diffFromLast === 0
  const missed = diffFromLast !== null && diffFromLast > 1

  const lastDayNumber = lastClaim?.dayNumber ?? 0
  const cycleProgress = computeCycleProgress(lastDayNumber, hasClaimToday, missed)

  let pendingDay = cycleProgress + 1
  if (pendingDay > cycleLength) {
    pendingDay = 1
  }
  if (!lastClaim || missed) {
    pendingDay = 1
  }

  const claimAvailable = !hasClaimToday
  const claimableDay = claimAvailable ? pendingDay : null

  const pendingReward = getRewardForDay(pendingDay) ?? rewardConfig[0]

  const days = rewardConfig.map(entry => {
    let status: DailyRewardSummary['days'][number]['status'] = 'locked'
    if (cycleProgress >= entry.day && (!missed || hasClaimToday)) {
      status = 'claimed'
    } else if (claimAvailable && claimableDay === entry.day) {
      status = 'claimable'
    } else if (hasClaimToday && pendingDay === entry.day) {
      status = 'cooldown'
    } else if (missed && entry.day === 1) {
      status = 'claimable'
    }
    return {
      day: entry.day,
      points: entry.points,
      animationKey: entry.animationKey,
      gradient: entry.gradient,
      status,
    }
  })

  const tomorrow = new Date(now.getTime() + 86400000)
  const nextResetKey = keyForDate(tomorrow)
  const midnightUtc = timezoneMidnightUtc(todayKey)
  const cooldownEndsAt = midnightUtc !== null ? new Date(midnightUtc + 86400000).toISOString() : tomorrow.toISOString()

  const totalClaims = aggregates._count._all ?? 0
  const totalPointsEarned = aggregates._sum.pointsAwarded ?? 0

  const message = missed
    ? 'Цепочка прервана. Начните заново!'
    : claimAvailable
      ? `Доступна награда: +${pendingReward.points} очков`
      : 'Награда уже получена. Возвращайтесь завтра.'

  return {
    streak: user.currentStreak ?? 0,
    effectiveStreak: missed ? 0 : user.currentStreak ?? 0,
    cycleProgress,
    cycleLength,
    claimedToday: hasClaimToday,
    claimAvailable,
    claimableDay,
    nextDay: pendingDay,
    pendingPoints: pendingReward.points,
    totalClaims,
    totalPointsEarned,
    lastClaimedAt: user.lastLoginDate ? user.lastLoginDate.toISOString() : null,
    lastClaimDateKey,
    todayKey,
    nextResetKey,
    cooldownEndsAt,
    timezone: DAILY_REWARD_TIMEZONE,
    missed,
    message,
    lastReward: lastClaim
      ? {
          day: lastClaim.dayNumber,
          points: lastClaim.pointsAwarded,
          animationKey: lastClaim.animationKey,
          claimedAt: lastClaim.claimedAt.toISOString(),
        }
      : null,
    days,
  }
}

export const getDailyRewardSummary = async (userId: number) => {
  return defaultCache.getWithMeta(cacheKey(userId), () => buildSummary(userId), DAILY_REWARD_CACHE_OPTIONS)
}

export class DailyRewardError extends Error {
  readonly code: 'user_not_found' | 'already_claimed' | 'config_missing'
  readonly status: number

  constructor(code: DailyRewardError['code'], status = 400, message?: string) {
    super(message ?? code)
    this.code = code
    this.status = status
  }
}

const createPointAdjustments = (
  tx: Prisma.TransactionClient,
  userId: number,
  points: number,
  day: number
) => {
  const reason = `daily_reward_day_${day}`
  // Create a single global adjustment. Rating aggregation already applies
  // global adjustments to seasonal and yearly totals, so creating scoped
  // duplicates would double-count the same points in seasonal/yearly views.
  return tx.adminPointAdjustment.create({
    data: {
      userId,
      adminIdentifier: 'daily_reward',
      delta: points,
      reason,
    },
  })
}

export const claimDailyReward = async (userId: number) => {
  let awarded: { day: number; points: number; animationKey: string } | null = null
  const now = new Date()
  const todayKey = keyForDate(now)

  try {
    await prisma.$transaction(async tx => {
      const user = await tx.appUser.findUnique({
        where: { id: userId },
        select: {
          id: true,
          telegramId: true,
          currentStreak: true,
          lastLoginDate: true,
        },
      })

      if (!user) {
        throw new DailyRewardError('user_not_found', 404)
      }

      const lastClaim = await tx.dailyRewardClaim.findFirst({
        where: { userId },
        orderBy: { claimedAt: 'desc' },
      })

      const lastClaimKey = user.lastLoginDate ? keyForDate(user.lastLoginDate) : null
      const diffFromLast = lastClaimKey ? diffKeys(todayKey, lastClaimKey) : null

      if (diffFromLast === 0) {
        throw new DailyRewardError('already_claimed', 409)
      }

      let baseStreak = user.currentStreak ?? 0
      if (!lastClaim || diffFromLast === null || diffFromLast > 1) {
        baseStreak = 0
      }

      let previousDay = lastClaim?.dayNumber ?? 0
      if (!lastClaim || diffFromLast === null || diffFromLast > 1) {
        previousDay = 0
      } else if (diffFromLast === 1 && lastClaim.dayNumber === cycleLength) {
        previousDay = 0
      }

      let nextDay = previousDay + 1
      if (nextDay > cycleLength) {
        nextDay = 1
      }

      const reward = getRewardForDay(nextDay)
      if (!reward) {
        throw new DailyRewardError('config_missing', 500)
      }

      const streakAfter = baseStreak + 1

      await tx.dailyRewardClaim.create({
        data: {
          userId,
          dayNumber: nextDay,
          streakAfter,
          pointsAwarded: reward.points,
          claimDateKey: todayKey,
          animationKey: reward.animationKey,
        },
      })

      await tx.appUser.update({
        where: { id: userId },
        data: {
          currentStreak: streakAfter,
          lastLoginDate: now,
        },
      })

      await createPointAdjustments(tx, userId, reward.points, nextDay)
      await incrementAchievementProgress(userId, AchievementMetric.DAILY_LOGIN, 1, tx)

      awarded = {
        day: nextDay,
        points: reward.points,
        animationKey: reward.animationKey,
      }
    })
  } catch (err) {
    if (err instanceof DailyRewardError) {
      throw err
    }
    if (typeof err === 'object' && err && 'code' in err && err.code === 'P2002') {
      throw new DailyRewardError('already_claimed', 409)
    }
    throw err
  }

  if (!awarded) {
    throw new DailyRewardError('config_missing', 500)
  }

  // Получаем telegramId для инвалидации кэша достижений
  const userForCache = await prisma.appUser.findUnique({
    where: { id: userId },
    select: { telegramId: true },
  })
  const telegramId = userForCache?.telegramId?.toString()

  await defaultCache.invalidate(cacheKey(userId)).catch(() => undefined)
  await defaultCache.invalidate(`user:rating:${userId}`).catch(() => undefined)
  // Инвалидируем кэш достижений (все вариации с limit/offset/summary)
  if (telegramId) {
    await defaultCache.invalidatePrefix(`user:achievements:${telegramId}`).catch(() => undefined)
  }
  await defaultCache.invalidate(
    ratingPublicCacheKey(RatingScope.CURRENT, 1, RATING_DEFAULT_PAGE_SIZE)
  ).catch(() => undefined)
  await defaultCache.invalidate(
    ratingPublicCacheKey(RatingScope.YEARLY, 1, RATING_DEFAULT_PAGE_SIZE)
  ).catch(() => undefined)

  await recalculateUserRatings({ userIds: [userId] })

  // Opportunistic processing: обрабатываем pending задачи на выдачу наград
  await processPendingAchievementJobs(5).catch(() => undefined)

  const { value: summary, version } = await getDailyRewardSummary(userId)
  return { summary, awarded, version }
}

export { DAILY_REWARD_TIMEZONE, DAILY_REWARD_CACHE_OPTIONS, cacheKey as dailyRewardCacheKey }
