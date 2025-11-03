import { FastifyInstance } from 'fastify'
import { MatchStatus, PredictionEntryStatus, PredictionMarketType } from '@prisma/client'
import prisma from '../db'
import { defaultCache } from '../cache'
import { buildWeakEtag, matchesIfNoneMatch } from '../utils/httpCaching'
import { extractSessionToken, resolveSessionSubject } from '../utils/session'

const UPCOMING_DEFAULT_DAYS = 6
const UPCOMING_MAX_DAYS = 10
const UPCOMING_CACHE_TTL_SECONDS = 300
const UPCOMING_STALE_SECONDS = 120
const USER_CACHE_TTL_SECONDS = 300
const USER_STALE_SECONDS = 120

const toNumber = (value: unknown): number | null => {
  if (value == null) {
    return null
  }
  if (typeof value === 'number') {
    return value
  }
  if (typeof value === 'object' && 'toNumber' in (value as Record<string, unknown>)) {
    try {
      const maybe = (value as { toNumber: () => number }).toNumber()
      return Number.isFinite(maybe) ? maybe : null
    } catch (err) {
      return null
    }
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const normalizeDays = (raw: unknown): number => {
  const numeric = typeof raw === 'string' ? Number(raw) : Number(raw)
  if (!Number.isFinite(numeric)) {
    return UPCOMING_DEFAULT_DAYS
  }
  const clamped = Math.max(1, Math.min(Math.trunc(numeric), UPCOMING_MAX_DAYS))
  return clamped
}

type ActivePredictionTemplate = {
  id: string
  marketType: PredictionMarketType
  options: unknown
  basePoints: number
  difficultyMultiplier: number | null
  isManual: boolean
  createdAt: string
  updatedAt: string
}

type ActivePredictionMatch = {
  matchId: string
  matchDateTime: string
  status: MatchStatus
  homeClub: {
    id: number
    name: string
    shortName: string | null
    logoUrl: string | null
  }
  awayClub: {
    id: number
    name: string
    shortName: string | null
    logoUrl: string | null
  }
  templates: ActivePredictionTemplate[]
}

type UserPredictionEntryView = {
  id: string
  templateId?: string
  matchId: string
  selection: string
  submittedAt: string
  status: PredictionEntryStatus
  scoreAwarded?: number | null
  resolvedAt?: string | null
  marketType: PredictionMarketType | 'LEGACY_1X2' | 'LEGACY_TOTAL' | 'LEGACY_EVENT'
  matchDateTime: string
  homeClub: {
    id: number
    name: string
    shortName: string | null
    logoUrl: string | null
  }
  awayClub: {
    id: number
    name: string
    shortName: string | null
    logoUrl: string | null
  }
}

const ACTIVE_CACHE_KEY = (days: number) => `predictions:list:${days}`
const USER_CACHE_KEY = (userId: number) => `predictions:user:${userId}`

export default async function predictionRoutes(server: FastifyInstance) {
  server.get('/api/predictions/active', async (request, reply) => {
    const days = normalizeDays((request.query as { days?: string }).days)
    const now = new Date()
    const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)

    const loader = async (): Promise<ActivePredictionMatch[]> => {
      const rows = await prisma.match.findMany({
        where: {
          status: MatchStatus.SCHEDULED,
          matchDateTime: {
            gte: now,
            lte: until,
          },
        },
        orderBy: { matchDateTime: 'asc' },
        include: {
          homeClub: true,
          awayClub: true,
          predictionTemplates: true,
        },
      })

      return rows.map(match => ({
        matchId: match.id.toString(),
        matchDateTime: match.matchDateTime.toISOString(),
        status: match.status,
        homeClub: {
          id: match.homeClub.id,
          name: match.homeClub.name,
          shortName: match.homeClub.shortName ?? null,
          logoUrl: match.homeClub.logoUrl ?? null,
        },
        awayClub: {
          id: match.awayClub.id,
          name: match.awayClub.name,
          shortName: match.awayClub.shortName ?? null,
          logoUrl: match.awayClub.logoUrl ?? null,
        },
        templates: match.predictionTemplates.map(template => ({
          id: template.id.toString(),
          marketType: template.marketType,
          options: template.options,
          basePoints: template.basePoints,
          difficultyMultiplier: toNumber(template.difficultyMultiplier),
          isManual: template.isManual,
          createdAt: template.createdAt.toISOString(),
          updatedAt: template.updatedAt.toISOString(),
        })),
      }))
    }

    const cacheKey = ACTIVE_CACHE_KEY(days)
    const { value, version } = await defaultCache.getWithMeta(cacheKey, loader, {
      ttlSeconds: UPCOMING_CACHE_TTL_SECONDS,
      staleWhileRevalidateSeconds: UPCOMING_STALE_SECONDS,
    })

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
      `public, max-age=${UPCOMING_CACHE_TTL_SECONDS}, stale-while-revalidate=${UPCOMING_STALE_SECONDS}`
    )
    reply.header('ETag', etag)
    reply.header('X-Resource-Version', String(version))

    return reply.send({ ok: true, data: value, meta: { version, days } })
  })

  server.get('/api/predictions/my', async (request, reply) => {
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
    })

    if (!user) {
      return reply.status(404).send({ ok: false, error: 'user_not_found' })
    }

    const cacheKey = USER_CACHE_KEY(user.id)

    const loader = async (): Promise<UserPredictionEntryView[]> => {
      const [entries, legacy] = await Promise.all([
        prisma.predictionEntry.findMany({
          where: { userId: user.id },
          orderBy: { submittedAt: 'desc' },
          take: 100,
          include: {
            template: {
              include: {
                match: {
                  include: {
                    homeClub: true,
                    awayClub: true,
                  },
                },
              },
            },
          },
        }),
        prisma.prediction.findMany({
          where: { userId: user.id },
          orderBy: { predictionDate: 'desc' },
          take: 100,
          include: {
            match: {
              include: {
                homeClub: true,
                awayClub: true,
              },
            },
          },
        }),
      ])

      const entryViews: UserPredictionEntryView[] = entries.map(entry => ({
        id: entry.id.toString(),
        templateId: entry.templateId.toString(),
        matchId: entry.template.matchId.toString(),
        selection: entry.selection,
        submittedAt: entry.submittedAt.toISOString(),
        status: entry.status,
        scoreAwarded: entry.scoreAwarded ?? null,
        resolvedAt: entry.resolvedAt ? entry.resolvedAt.toISOString() : null,
        marketType: entry.template.marketType,
        matchDateTime: entry.template.match.matchDateTime.toISOString(),
        homeClub: {
          id: entry.template.match.homeClub.id,
          name: entry.template.match.homeClub.name,
          shortName: entry.template.match.homeClub.shortName ?? null,
          logoUrl: entry.template.match.homeClub.logoUrl ?? null,
        },
        awayClub: {
          id: entry.template.match.awayClub.id,
          name: entry.template.match.awayClub.name,
          shortName: entry.template.match.awayClub.shortName ?? null,
          logoUrl: entry.template.match.awayClub.logoUrl ?? null,
        },
      }))

      const legacyViews: UserPredictionEntryView[] = legacy.map(prediction => {
        let marketType: UserPredictionEntryView['marketType'] = 'LEGACY_1X2'
        let selection = prediction.result1x2 ?? 'N/A'

        if (prediction.totalGoalsOver != null) {
          marketType = 'LEGACY_TOTAL'
          selection = `OVER_${prediction.totalGoalsOver}`
        } else if (prediction.penaltyYes != null) {
          marketType = 'LEGACY_EVENT'
          selection = prediction.penaltyYes ? 'PENALTY_YES' : 'PENALTY_NO'
        } else if (prediction.redCardYes != null) {
          marketType = 'LEGACY_EVENT'
          selection = prediction.redCardYes ? 'RED_CARD_YES' : 'RED_CARD_NO'
        }

        const status: PredictionEntryStatus =
          prediction.isCorrect == null
            ? PredictionEntryStatus.PENDING
            : prediction.isCorrect
              ? PredictionEntryStatus.WON
              : PredictionEntryStatus.LOST

        return {
          id: prediction.id.toString(),
          matchId: prediction.matchId.toString(),
          selection,
          submittedAt: prediction.predictionDate.toISOString(),
          status,
          scoreAwarded: prediction.pointsAwarded,
          resolvedAt: prediction.updatedAt.toISOString(),
          marketType,
          matchDateTime: prediction.match.matchDateTime.toISOString(),
          homeClub: {
            id: prediction.match.homeClub.id,
            name: prediction.match.homeClub.name,
            shortName: prediction.match.homeClub.shortName ?? null,
            logoUrl: prediction.match.homeClub.logoUrl ?? null,
          },
          awayClub: {
            id: prediction.match.awayClub.id,
            name: prediction.match.awayClub.name,
            shortName: prediction.match.awayClub.shortName ?? null,
            logoUrl: prediction.match.awayClub.logoUrl ?? null,
          },
        }
      })

      return [...entryViews, ...legacyViews].sort((left, right) =>
        right.submittedAt.localeCompare(left.submittedAt)
      )
    }

    const { value, version } = await defaultCache.getWithMeta(cacheKey, loader, {
      ttlSeconds: USER_CACHE_TTL_SECONDS,
      staleWhileRevalidateSeconds: USER_STALE_SECONDS,
    })

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
      `private, max-age=${USER_CACHE_TTL_SECONDS}, stale-while-revalidate=${USER_STALE_SECONDS}`
    )
    reply.header('ETag', etag)
    reply.header('X-Resource-Version', String(version))

    return reply.send({ ok: true, data: value, meta: { version } })
  })
}
