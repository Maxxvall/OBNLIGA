import {
  Prisma,
  PrismaClient,
  RatingLevel,
  RatingScope,
} from '@prisma/client'
import prisma from '../db'
import {
  PUBLIC_RATINGS_CURRENT_KEY,
  PUBLIC_RATINGS_YEARLY_KEY,
} from '../cache'
import {
  RATING_DEFAULT_PAGE_SIZE,
  RATING_LEADERBOARD_STALE_SECONDS,
  RATING_LEADERBOARD_TTL_SECONDS,
  RATING_MAX_PAGE_SIZE,
  RATING_SNAPSHOT_LIMIT,
  resolveRatingLevel,
} from './ratingConstants'
import { computeRatingWindows, getRatingSettings } from './ratingSettings'

type AggregatedUserRating = {
  userId: number
  totalPoints: number
  seasonalPoints: number
  yearlyPoints: number
  level: RatingLevel
  mythicRank: number | null
  currentStreak: number
  maxStreak: number
  lastPredictionAt: Date | null
  lastResolvedAt: Date | null
  predictionCount: number
  predictionWins: number
}

type AggregationContext = {
  capturedAt: Date
  currentWindowStart: Date
  yearlyWindowStart: Date
  entries: AggregatedUserRating[]
}

const toNumber = (value: unknown): number => {
  if (value == null) {
    return 0
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value === 'bigint') {
    return Number(value)
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const buildUserFilter = (userIds?: number[]) => {
  if (!userIds || userIds.length === 0) {
    return Prisma.empty
  }
  return Prisma.sql`AND pe.user_id = ANY(${userIds})`
}

const buildAdjustmentFilter = (userIds?: number[]) => {
  if (!userIds || userIds.length === 0) {
    return Prisma.empty
  }
  return Prisma.sql`WHERE user_id = ANY(${userIds})`
}

const executeInChunks = async (
  operations: Prisma.PrismaPromise<unknown>[],
  chunkSize = 100
) => {
  if (operations.length === 0) {
    return
  }
  for (let index = 0; index < operations.length; index += chunkSize) {
    const slice = operations.slice(index, index + chunkSize)
    await Promise.all(slice)
  }
}

export type RatingAggregationOptions = {
  userIds?: number[]
}

export const recalculateUserRatings = async (
  options: RatingAggregationOptions = {},
  client: PrismaClient = prisma
): Promise<AggregationContext> => {
  const userIds = options.userIds?.filter(id => Number.isFinite(id))
  const capturedAt = new Date()

  const context: AggregationContext = {
    capturedAt,
    currentWindowStart: capturedAt,
    yearlyWindowStart: capturedAt,
    entries: [],
  }

  await client.$transaction(async tx => {
    const settings = await getRatingSettings(tx)
    const windows = await computeRatingWindows(capturedAt, settings, tx)
    const currentWindowStart = windows.currentWindowStart
    const yearlyWindowStart = windows.yearlyWindowStart

    context.currentWindowStart = currentWindowStart
    context.yearlyWindowStart = yearlyWindowStart

    const userFilter = buildUserFilter(userIds)

    const totals = await tx.$queryRaw<Array<{ user_id: number; total_points: bigint }>>(
      Prisma.sql`
        SELECT pe.user_id, COALESCE(SUM(pe.score_awarded), 0)::bigint AS total_points
        FROM prediction_entry pe
        WHERE pe.status <> 'PENDING'
          AND pe.score_awarded IS NOT NULL
          ${userFilter}
        GROUP BY pe.user_id
      `
    )

    const current = await tx.$queryRaw<Array<{ user_id: number; current_points: bigint }>>(
      Prisma.sql`
        SELECT pe.user_id, COALESCE(SUM(pe.score_awarded), 0)::bigint AS current_points
        FROM prediction_entry pe
        WHERE pe.status <> 'PENDING'
          AND pe.score_awarded IS NOT NULL
          AND pe.resolved_at IS NOT NULL
          AND pe.resolved_at >= ${currentWindowStart}
          ${userFilter}
        GROUP BY pe.user_id
      `
    )

    const yearly = await tx.$queryRaw<Array<{ user_id: number; yearly_points: bigint }>>(
      Prisma.sql`
        SELECT pe.user_id, COALESCE(SUM(pe.score_awarded), 0)::bigint AS yearly_points
        FROM prediction_entry pe
        WHERE pe.status <> 'PENDING'
          AND pe.score_awarded IS NOT NULL
          AND pe.resolved_at IS NOT NULL
          AND pe.resolved_at >= ${yearlyWindowStart}
          ${userFilter}
        GROUP BY pe.user_id
      `
    )

    const adjustments = await tx.$queryRaw<
      Array<{ user_id: number; global_delta: bigint; current_delta: bigint; yearly_delta: bigint }>
    >(
      Prisma.sql`
        SELECT
          user_id,
          COALESCE(SUM(CASE WHEN scope IS NULL THEN delta ELSE 0 END), 0)::bigint AS global_delta,
          COALESCE(SUM(CASE WHEN scope = 'CURRENT' THEN delta ELSE 0 END), 0)::bigint AS current_delta,
          COALESCE(SUM(CASE WHEN scope = 'YEARLY' THEN delta ELSE 0 END), 0)::bigint AS yearly_delta
        FROM admin_point_adjustment
        ${buildAdjustmentFilter(userIds)}
        GROUP BY user_id
      `
    )

    const lastDates = await tx.$queryRaw<
      Array<{ user_id: number; last_submitted_at: Date | null; last_resolved_at: Date | null }>
    >(
      Prisma.sql`
        SELECT
          pe.user_id,
          MAX(pe.submitted_at) AS last_submitted_at,
          MAX(pe.resolved_at) FILTER (WHERE pe.status <> 'PENDING') AS last_resolved_at
        FROM prediction_entry pe
        WHERE true
          ${userFilter}
        GROUP BY pe.user_id
      `
    )

    const predictionStats = await tx.$queryRaw<
      Array<{ user_id: number; resolved_count: bigint; win_count: bigint }>
    >(
      Prisma.sql`
        SELECT
          pe.user_id,
          COUNT(*) FILTER (WHERE pe.status <> 'PENDING')::bigint AS resolved_count,
          COUNT(*) FILTER (WHERE pe.status = 'WON')::bigint AS win_count
        FROM prediction_entry pe
        WHERE true
          ${userFilter}
        GROUP BY pe.user_id
      `
    )

    const maxStreakRows = await tx.$queryRaw<Array<{ user_id: number; max_streak: bigint }>>(
      Prisma.sql`
        WITH resolved AS (
          SELECT
            pe.user_id,
            pe.status,
            pe.resolved_at,
            pe.prediction_entry_id,
            SUM(CASE WHEN pe.status <> 'WON' THEN 1 ELSE 0 END)
              OVER (PARTITION BY pe.user_id ORDER BY pe.resolved_at, pe.prediction_entry_id) AS block
          FROM prediction_entry pe
          WHERE pe.status <> 'PENDING'
            AND pe.resolved_at IS NOT NULL
            ${userFilter}
        )
        SELECT user_id, COALESCE(MAX(streak_len), 0)::bigint AS max_streak
        FROM (
          SELECT user_id, block, COUNT(*) AS streak_len
          FROM resolved
          WHERE status = 'WON'
          GROUP BY user_id, block
        ) streaks
        GROUP BY user_id
      `
    )

    const currentStreakRows = await tx.$queryRaw<Array<{ user_id: number; current_streak: bigint }>>(
      Prisma.sql`
        WITH resolved AS (
          SELECT
            pe.user_id,
            pe.status,
            pe.resolved_at,
            pe.prediction_entry_id,
            SUM(CASE WHEN pe.status <> 'WON' THEN 1 ELSE 0 END)
              OVER (PARTITION BY pe.user_id ORDER BY pe.resolved_at, pe.prediction_entry_id) AS block,
            ROW_NUMBER() OVER (
              PARTITION BY pe.user_id ORDER BY pe.resolved_at DESC, pe.prediction_entry_id DESC
            ) AS rn_desc
          FROM prediction_entry pe
          WHERE pe.status <> 'PENDING'
            AND pe.resolved_at IS NOT NULL
            ${userFilter}
        ),
        latest AS (
          SELECT *
          FROM resolved
          WHERE rn_desc = 1
        )
        SELECT
          l.user_id,
          CASE
            WHEN l.status = 'WON' THEN (
              SELECT COUNT(*)::bigint
              FROM resolved r
              WHERE r.user_id = l.user_id AND r.block = l.block AND r.status = 'WON'
            )
            ELSE 0::bigint
          END AS current_streak
        FROM latest l
      `
    )

    const totalMap = new Map<number, number>()
    totals.forEach(row => totalMap.set(row.user_id, toNumber(row.total_points)))

    const currentMap = new Map<number, number>()
    current.forEach(row => currentMap.set(row.user_id, toNumber(row.current_points)))

    const yearlyMap = new Map<number, number>()
    yearly.forEach(row => yearlyMap.set(row.user_id, toNumber(row.yearly_points)))

    const adjustmentMap = new Map<
      number,
      { global: number; current: number; yearly: number }
    >()
    adjustments.forEach(row => {
      adjustmentMap.set(row.user_id, {
        global: toNumber(row.global_delta),
        current: toNumber(row.current_delta),
        yearly: toNumber(row.yearly_delta),
      })
    })

    const lastDateMap = new Map<
      number,
      { lastPredictionAt: Date | null; lastResolvedAt: Date | null }
    >()
    lastDates.forEach(row => {
      lastDateMap.set(row.user_id, {
        lastPredictionAt: row.last_submitted_at,
        lastResolvedAt: row.last_resolved_at,
      })
    })

    const maxStreakMap = new Map<number, number>()
    maxStreakRows.forEach(row => maxStreakMap.set(row.user_id, toNumber(row.max_streak)))

    const currentStreakMap = new Map<number, number>()
    currentStreakRows.forEach(row => currentStreakMap.set(row.user_id, toNumber(row.current_streak)))

    const predictionStatMap = new Map<number, { count: number; wins: number }>()
    predictionStats.forEach(row =>
      predictionStatMap.set(row.user_id, {
        count: toNumber(row.resolved_count),
        wins: toNumber(row.win_count),
      })
    )

    const userIdSet = new Set<number>()
    totalMap.forEach((_, userId) => userIdSet.add(userId))
    currentMap.forEach((_, userId) => userIdSet.add(userId))
    yearlyMap.forEach((_, userId) => userIdSet.add(userId))
    adjustmentMap.forEach((_, userId) => userIdSet.add(userId))
    lastDateMap.forEach((_, userId) => userIdSet.add(userId))
    maxStreakMap.forEach((_, userId) => userIdSet.add(userId))
    currentStreakMap.forEach((_, userId) => userIdSet.add(userId))
    predictionStatMap.forEach((_, userId) => userIdSet.add(userId))

    if (userIds && userIds.length > 0) {
      userIds.forEach(id => userIdSet.add(id))
    }

    const entries: AggregatedUserRating[] = []

    for (const userId of userIdSet) {
      const totalPoints = (totalMap.get(userId) ?? 0) + (adjustmentMap.get(userId)?.global ?? 0)
      const seasonalPoints =
        (currentMap.get(userId) ?? 0)
        + (adjustmentMap.get(userId)?.global ?? 0)
        + (adjustmentMap.get(userId)?.current ?? 0)
      const yearlyPoints =
        (yearlyMap.get(userId) ?? 0)
        + (adjustmentMap.get(userId)?.global ?? 0)
        + (adjustmentMap.get(userId)?.yearly ?? 0)

      const { lastPredictionAt = null, lastResolvedAt = null } =
        lastDateMap.get(userId) ?? {}
      const currentStreak = currentStreakMap.get(userId) ?? 0
      const maxStreak = Math.max(maxStreakMap.get(userId) ?? 0, currentStreak)

      entries.push({
        userId,
        totalPoints,
        seasonalPoints,
        yearlyPoints,
        level: resolveRatingLevel(totalPoints),
        mythicRank: null,
        currentStreak,
        maxStreak,
        lastPredictionAt,
        lastResolvedAt,
        predictionCount: predictionStatMap.get(userId)?.count ?? 0,
        predictionWins: predictionStatMap.get(userId)?.wins ?? 0,
      })
    }

    entries.sort((left, right) => {
      if (right.totalPoints !== left.totalPoints) {
        return right.totalPoints - left.totalPoints
      }
      if (right.seasonalPoints !== left.seasonalPoints) {
        return right.seasonalPoints - left.seasonalPoints
      }
      if (right.yearlyPoints !== left.yearlyPoints) {
        return right.yearlyPoints - left.yearlyPoints
      }
      return left.userId - right.userId
    })

    let mythicRankCounter = 1
    for (const entry of entries) {
      if (entry.level === RatingLevel.MYTHIC) {
        entry.mythicRank = mythicRankCounter
        mythicRankCounter += 1
      }
    }

    context.entries = entries

    const ratingOperations: Prisma.PrismaPromise<unknown>[] = []
    const streakOperations: Prisma.PrismaPromise<unknown>[] = []

    for (const entry of entries) {
      ratingOperations.push(
        tx.userRating.upsert({
          where: { userId: entry.userId },
          create: {
            userId: entry.userId,
            totalPoints: entry.totalPoints,
            seasonalPoints: entry.seasonalPoints,
            yearlyPoints: entry.yearlyPoints,
            currentLevel: entry.level,
            mythicRank: entry.mythicRank,
            lastRecalculatedAt: capturedAt,
            predictionCount: entry.predictionCount,
            predictionWins: entry.predictionWins,
          },
          update: {
            totalPoints: entry.totalPoints,
            seasonalPoints: entry.seasonalPoints,
            yearlyPoints: entry.yearlyPoints,
            currentLevel: entry.level,
            mythicRank: entry.mythicRank,
            lastRecalculatedAt: capturedAt,
            predictionCount: entry.predictionCount,
            predictionWins: entry.predictionWins,
          },
        })
      )

      streakOperations.push(
        tx.predictionStreak.upsert({
          where: { userId: entry.userId },
          create: {
            userId: entry.userId,
            currentStreak: entry.currentStreak,
            maxStreak: entry.maxStreak,
            lastPredictionAt: entry.lastPredictionAt,
            lastResolvedAt: entry.lastResolvedAt,
          },
          update: {
            currentStreak: entry.currentStreak,
            maxStreak: entry.maxStreak,
            lastPredictionAt: entry.lastPredictionAt,
            lastResolvedAt: entry.lastResolvedAt,
          },
        })
      )
    }

    await executeInChunks(ratingOperations)
    await executeInChunks(streakOperations)

    if (!userIds || userIds.length === 0) {
      const snapshotPayload: Prisma.RatingSnapshotCreateManyInput[] = []

      const currentSorted = [...entries].sort((a, b) => b.seasonalPoints - a.seasonalPoints)
      const yearlySorted = [...entries].sort((a, b) => b.yearlyPoints - a.yearlyPoints)

      const currentLimit = Math.min(RATING_SNAPSHOT_LIMIT, currentSorted.length)
      for (let index = 0; index < currentLimit; index += 1) {
        const entry = currentSorted[index]
        snapshotPayload.push({
          userId: entry.userId,
          scope: RatingScope.CURRENT,
          rank: index + 1,
          points: entry.seasonalPoints,
          capturedAt,
          payload: {
            totalPoints: entry.totalPoints,
            seasonalPoints: entry.seasonalPoints,
            yearlyPoints: entry.yearlyPoints,
            level: entry.level,
          } satisfies Record<string, unknown>,
        })
      }

      const yearlyLimit = Math.min(RATING_SNAPSHOT_LIMIT, yearlySorted.length)
      for (let index = 0; index < yearlyLimit; index += 1) {
        const entry = yearlySorted[index]
        snapshotPayload.push({
          userId: entry.userId,
          scope: RatingScope.YEARLY,
          rank: index + 1,
          points: entry.yearlyPoints,
          capturedAt,
          payload: {
            totalPoints: entry.totalPoints,
            seasonalPoints: entry.seasonalPoints,
            yearlyPoints: entry.yearlyPoints,
            level: entry.level,
          } satisfies Record<string, unknown>,
        })
      }

      if (snapshotPayload.length > 0) {
        await tx.ratingSnapshot.createMany({ data: snapshotPayload })
      }
    }
  }, { timeout: 20_000 })

  return context
}

export type RatingLeaderboardEntry = {
  userId: number
  position: number
  displayName: string
  username: string | null
  photoUrl: string | null
  totalPoints: number
  seasonalPoints: number
  yearlyPoints: number
  currentLevel: RatingLevel
  mythicRank: number | null
  currentStreak: number
  maxStreak: number
  lastPredictionAt: string | null
  lastResolvedAt: string | null
  predictionCount: number
  predictionWins: number
  predictionAccuracy: number
}

export type RatingLeaderboardResult = {
  scope: RatingScope
  total: number
  page: number
  pageSize: number
  capturedAt: Date
  entries: RatingLeaderboardEntry[]
}

type LeaderboardOptions = {
  page?: number
  pageSize?: number
  ensureFresh?: boolean
}

export const loadRatingLeaderboard = async (
  scope: RatingScope,
  options: LeaderboardOptions = {}
): Promise<RatingLeaderboardResult> => {
  const page = Math.max(1, Math.trunc(options.page ?? 1))
  const pageSize = Math.min(
    RATING_MAX_PAGE_SIZE,
    Math.max(1, Math.trunc(options.pageSize ?? RATING_DEFAULT_PAGE_SIZE))
  )

  if (options.ensureFresh && page === 1) {
    await recalculateUserRatings()
  }

  const [total, ratings] = await Promise.all([
    prisma.userRating.count(),
    prisma.userRating.findMany({
      orderBy:
        scope === RatingScope.YEARLY
          ? [{ yearlyPoints: 'desc' }, { totalPoints: 'desc' }]
          : [{ seasonalPoints: 'desc' }, { totalPoints: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            photoUrl: true,
          },
        },
      },
    }),
  ])

  const userIds = ratings.map(row => row.userId)
  const streaks = userIds.length
    ? await prisma.predictionStreak.findMany({
        where: { userId: { in: userIds } },
      })
    : []
  const streakMap = new Map<number, (typeof streaks)[number]>()
  streaks.forEach(item => streakMap.set(item.userId, item))

  const entries: RatingLeaderboardEntry[] = ratings.map((row, index) => {
    const streak = streakMap.get(row.userId)
    const displayName = row.user.firstName?.trim()?.length
      ? row.user.firstName.trim()
      : row.user.username?.trim()?.length
        ? `@${row.user.username.trim()}`
        : `Игрок #${row.userId}`

    const predictionCount = row.predictionCount ?? 0
    const predictionWins = row.predictionWins ?? 0
    const predictionAccuracy = predictionCount > 0 ? predictionWins / predictionCount : 0

    return {
      userId: row.userId,
      position: (page - 1) * pageSize + index + 1,
      displayName,
      username: row.user.username ?? null,
      photoUrl: row.user.photoUrl ?? null,
      totalPoints: row.totalPoints,
      seasonalPoints: row.seasonalPoints,
      yearlyPoints: row.yearlyPoints,
      currentLevel: row.currentLevel,
      mythicRank: row.mythicRank,
      currentStreak: streak?.currentStreak ?? 0,
      maxStreak: streak?.maxStreak ?? 0,
      lastPredictionAt: streak?.lastPredictionAt?.toISOString() ?? null,
      lastResolvedAt: streak?.lastResolvedAt?.toISOString() ?? null,
      predictionCount,
      predictionWins,
      predictionAccuracy,
    }
  })

  const capturedAt = ratings.reduce<Date | null>((acc, row) => {
    if (!row.lastRecalculatedAt) {
      return acc
    }
    if (!acc || row.lastRecalculatedAt > acc) {
      return row.lastRecalculatedAt
    }
    return acc
  }, null) ?? new Date()

  return {
    scope,
    total,
    page,
    pageSize,
    capturedAt,
    entries,
  }
}

export const ratingPublicCacheKey = (
  scope: RatingScope,
  page: number,
  pageSize: number
): string => {
  const base = scope === RatingScope.YEARLY ? PUBLIC_RATINGS_YEARLY_KEY : PUBLIC_RATINGS_CURRENT_KEY
  return `${base}:p${page}:s${pageSize}`
}

export const RATING_CACHE_OPTIONS = {
  ttlSeconds: RATING_LEADERBOARD_TTL_SECONDS,
  staleWhileRevalidateSeconds: RATING_LEADERBOARD_STALE_SECONDS,
}
