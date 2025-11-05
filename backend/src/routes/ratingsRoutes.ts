import { FastifyInstance } from 'fastify'
import { RatingLevel, RatingScope } from '@prisma/client'
import prisma from '../db'
import { defaultCache } from '../cache'
import { buildWeakEtag, matchesIfNoneMatch } from '../utils/httpCaching'
import { extractSessionToken, resolveSessionSubject } from '../utils/session'
import {
  RATING_CACHE_OPTIONS,
  loadRatingLeaderboard,
  ratingPublicCacheKey,
} from '../services/ratingAggregation'
import {
  RATING_DEFAULT_PAGE_SIZE,
  RATING_MAX_PAGE_SIZE,
  ratingScopeKey,
} from '../services/ratingConstants'
import { computeRatingWindows, getRatingSettings } from '../services/ratingSettings'

type RatingsQuery = {
  scope?: string
  page?: string
  pageSize?: string
}

const normalizeScope = (raw?: string): RatingScope => {
  const value = raw?.toUpperCase()
  if (value === RatingScope.YEARLY) {
    return RatingScope.YEARLY
  }
  return RatingScope.CURRENT
}

const toPositiveInteger = (raw: unknown, fallback: number): number => {
  const numeric = typeof raw === 'string' ? Number(raw) : Number(raw)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  const normalized = Math.trunc(numeric)
  return normalized > 0 ? normalized : fallback
}

export default async function ratingsRoutes(server: FastifyInstance) {
  server.get<{ Querystring: RatingsQuery }>('/api/ratings', async (request, reply) => {
    const query = request.query ?? {}
    const scope = normalizeScope(query.scope)
    const page = toPositiveInteger(query.page, 1)
    const pageSizeParam = query.pageSize ? toPositiveInteger(query.pageSize, 1) : undefined
    const normalizedPageSize = Math.min(
      RATING_MAX_PAGE_SIZE,
      pageSizeParam ?? RATING_DEFAULT_PAGE_SIZE
    )

    const cacheKey = ratingPublicCacheKey(scope, page, normalizedPageSize)

    const loader = async () => {
      const [leaderboard, settings] = await Promise.all([
        loadRatingLeaderboard(scope, {
          page,
          pageSize: normalizedPageSize,
          ensureFresh: page === 1,
        }),
        getRatingSettings(),
      ])
      const windows = await computeRatingWindows(leaderboard.capturedAt, settings)

      return {
        scope: ratingScopeKey(leaderboard.scope),
        total: leaderboard.total,
        page: leaderboard.page,
        pageSize: leaderboard.pageSize,
        capturedAt: leaderboard.capturedAt.toISOString(),
        currentWindowStart: windows.currentWindowStart.toISOString(),
        currentWindowEnd: windows.currentWindowEnd.toISOString(),
        yearlyWindowStart: windows.yearlyWindowStart.toISOString(),
        yearlyWindowEnd: windows.yearlyWindowEnd.toISOString(),
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
          predictionCount: entry.predictionCount,
          predictionWins: entry.predictionWins,
          predictionAccuracy: entry.predictionAccuracy,
        })),
      }
    }

    const { value, version } = await defaultCache.getWithMeta(cacheKey, loader, RATING_CACHE_OPTIONS)
    const etag = buildWeakEtag(cacheKey, version)

    if (matchesIfNoneMatch(request.headers, etag)) {
      return reply
        .status(304)
        .header('ETag', etag)
        .header('X-Resource-Version', String(version))
        .send()
    }

    reply.header(
      'Cache-Control',
      `public, max-age=${RATING_CACHE_OPTIONS.ttlSeconds}, stale-while-revalidate=${RATING_CACHE_OPTIONS.staleWhileRevalidateSeconds}`
    )
    reply.header('ETag', etag)
    reply.header('X-Resource-Version', String(version))

    return reply.send({ ok: true, data: value, meta: { version } })
  })

  server.get('/api/users/me/rating', async (request, reply) => {
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

    const cacheKey = `user:rating:${user.id}`

    const loader = async () => {
      const [rating, streak] = await Promise.all([
        prisma.userRating.findUnique({ where: { userId: user.id } }),
        prisma.predictionStreak.findUnique({ where: { userId: user.id } }),
      ])

      if (!rating) {
        return {
          totalPoints: 0,
          seasonalPoints: 0,
          yearlyPoints: 0,
          currentLevel: RatingLevel.BRONZE,
          mythicRank: null as number | null,
          currentStreak: streak?.currentStreak ?? 0,
          maxStreak: streak?.maxStreak ?? 0,
          lastPredictionAt: streak?.lastPredictionAt?.toISOString() ?? null,
          lastResolvedAt: streak?.lastResolvedAt?.toISOString() ?? null,
          lastRecalculatedAt: null as string | null,
          predictionCount: 0,
          predictionWins: 0,
          predictionAccuracy: 0,
        }
      }

      return {
        totalPoints: rating.totalPoints,
        seasonalPoints: rating.seasonalPoints,
        yearlyPoints: rating.yearlyPoints,
        currentLevel: rating.currentLevel,
        mythicRank: rating.mythicRank,
        currentStreak: streak?.currentStreak ?? 0,
        maxStreak: streak?.maxStreak ?? 0,
        lastPredictionAt: streak?.lastPredictionAt?.toISOString() ?? null,
        lastResolvedAt: streak?.lastResolvedAt?.toISOString() ?? null,
        lastRecalculatedAt: rating.lastRecalculatedAt?.toISOString() ?? null,
        predictionCount: (rating as any).predictionCount ?? 0,
        predictionWins: (rating as any).predictionWins ?? 0,
        predictionAccuracy:
          ((rating as any).predictionCount ?? 0) > 0
            ? ((rating as any).predictionWins ?? 0) / (rating as any).predictionCount
            : 0,
      }
    }

    const { value, version } = await defaultCache.getWithMeta(cacheKey, loader, RATING_CACHE_OPTIONS)
    const etag = buildWeakEtag(cacheKey, version)

    if (matchesIfNoneMatch(request.headers, etag)) {
      return reply
        .status(304)
        .header('ETag', etag)
        .header('X-Resource-Version', String(version))
        .send()
    }

    reply.header(
      'Cache-Control',
      `private, max-age=${RATING_CACHE_OPTIONS.ttlSeconds}, stale-while-revalidate=${RATING_CACHE_OPTIONS.staleWhileRevalidateSeconds}`
    )
    reply.header('ETag', etag)
    reply.header('X-Resource-Version', String(version))

    return reply.send({ ok: true, data: value, meta: { version } })
  })
}
