import { FastifyBaseLogger } from 'fastify'
import { RatingScope } from '@prisma/client'
import { defaultCache } from '../cache'
import {
  RATING_CACHE_OPTIONS,
  loadRatingLeaderboard,
  ratingPublicCacheKey,
  recalculateUserRatings,
} from './ratingAggregation'
import {
  RATING_DEFAULT_PAGE_SIZE,
  ratingScopeKey,
} from './ratingConstants'

const SIX_HOURS_MS = 6 * 60 * 60 * 1000
const INITIAL_DELAY_MS = 60 * 1000
const RETRY_DELAY_MS = 5 * 60 * 1000

let timer: NodeJS.Timeout | null = null
let running = false
let started = false

const warmLeaderboardCache = async (logger: FastifyBaseLogger) => {
  const scopes: RatingScope[] = [RatingScope.CURRENT, RatingScope.YEARLY]
  for (const scope of scopes) {
    try {
      const leaderboard = await loadRatingLeaderboard(scope, {
        page: 1,
        pageSize: RATING_DEFAULT_PAGE_SIZE,
      })

      const payload = {
        scope: ratingScopeKey(leaderboard.scope),
        total: leaderboard.total,
        page: leaderboard.page,
        pageSize: leaderboard.pageSize,
        capturedAt: leaderboard.capturedAt.toISOString(),
        entries: leaderboard.entries.map(entry => ({
          userId: entry.userId,
          position: entry.position,
          displayName: entry.displayName,
          username: entry.username,
          photoUrl: entry.photoUrl,
          totalPoints: entry.totalPoints,
          seasonalPoints: entry.seasonalPoints,
          yearlyPoints: entry.yearlyPoints,
          currentLevel: entry.currentLevel,
          mythicRank: entry.mythicRank,
          currentStreak: entry.currentStreak,
          maxStreak: entry.maxStreak,
          lastPredictionAt: entry.lastPredictionAt,
          lastResolvedAt: entry.lastResolvedAt,
        })),
      }

      const cacheKey = ratingPublicCacheKey(scope, 1, RATING_DEFAULT_PAGE_SIZE)
      await defaultCache.set(cacheKey, payload, RATING_CACHE_OPTIONS)
    } catch (err) {
      logger.warn({ err, scope }, 'rating scheduler: failed to warm leaderboard cache')
    }
  }
}

const runAggregation = async (logger: FastifyBaseLogger) => {
  if (running) {
    logger.warn('rating scheduler: aggregation already running — skip overlapping tick')
    return
  }

  running = true
  try {
    const context = await recalculateUserRatings()
    logger.info(
      {
        capturedAt: context.capturedAt.toISOString(),
        currentWindowStart: context.currentWindowStart.toISOString(),
        yearlyWindowStart: context.yearlyWindowStart.toISOString(),
        entries: context.entries.length,
      },
      'rating scheduler: ratings recalculated'
    )
    await warmLeaderboardCache(logger)
  } catch (err) {
    logger.error({ err }, 'rating scheduler: failed to recalculate ratings')
    throw err
  } finally {
    running = false
  }
}

const scheduleNext = (logger: FastifyBaseLogger, delay: number) => {
  if (timer) {
    clearTimeout(timer)
  }

  timer = setTimeout(async () => {
    try {
      await runAggregation(logger)
      scheduleNext(logger, SIX_HOURS_MS)
    } catch (err) {
      logger.error({ err }, 'rating scheduler: aggregation tick failed, retry planned')
      scheduleNext(logger, RETRY_DELAY_MS)
    }
  }, Math.max(0, delay))
}

export const startRatingScheduler = async (logger: FastifyBaseLogger) => {
  if (started) {
    logger.warn('rating scheduler: start requested but scheduler already active')
    return
  }

  started = true
  logger.info({ intervalMs: SIX_HOURS_MS }, 'rating scheduler: starting background recalculation')
  scheduleNext(logger, INITIAL_DELAY_MS)
}

export const stopRatingScheduler = async (logger: FastifyBaseLogger) => {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  running = false
  if (started) {
    logger.info('rating scheduler: stopped')
  }
  started = false
}
