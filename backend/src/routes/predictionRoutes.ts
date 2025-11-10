import { FastifyInstance } from 'fastify'
import { MatchStatus, PredictionEntryStatus, PredictionMarketType, Prisma } from '@prisma/client'
import prisma from '../db'
import { defaultCache } from '../cache'
import { buildWeakEtag, matchesIfNoneMatch } from '../utils/httpCaching'
import { extractSessionToken, resolveSessionSubject } from '../utils/session'
import {
  ACTIVE_PREDICTION_CACHE_KEY,
  PREDICTION_MAX_SELECTION_LENGTH,
  PREDICTION_UPCOMING_CACHE_TTL_SECONDS,
  PREDICTION_UPCOMING_DEFAULT_DAYS,
  PREDICTION_UPCOMING_MAX_DAYS,
  PREDICTION_UPCOMING_STALE_SECONDS,
  PREDICTION_USER_CACHE_TTL_SECONDS,
  PREDICTION_USER_STALE_SECONDS,
  PREDICTION_WEEKLY_LIMIT,
  USER_PREDICTION_CACHE_KEY,
} from '../services/predictionConstants'
import { ensurePredictionTemplatesInRange } from '../services/predictionTemplateService'

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
    return PREDICTION_UPCOMING_DEFAULT_DAYS
  }
  const clamped = Math.max(1, Math.min(Math.trunc(numeric), PREDICTION_UPCOMING_MAX_DAYS))
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
  competitionName: string | null
  seasonName: string | null
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
  competitionName: string | null
  seasonName: string | null
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

type EntryWithTemplate = Prisma.PredictionEntryGetPayload<{
  include: {
    template: {
      include: {
        match: {
          include: {
            homeClub: true
            awayClub: true
            season: {
              include: {
                competition: true
              }
            }
          }
        }
      }
    }
  }
}>

type LegacyPrediction = Prisma.PredictionGetPayload<{
  include: {
    match: {
      include: {
        homeClub: true
        awayClub: true
        season: {
          include: {
            competition: true
          }
        }
      }
    }
  }
}>

const ENTRY_WITH_TEMPLATE_INCLUDE = {
  template: {
    include: {
      match: {
        include: {
          homeClub: true,
          awayClub: true,
          season: {
            include: {
              competition: true,
            },
          },
        },
      },
    },
  },
} as const

const selectionFromOptions = (options: unknown): string[] => {
  if (!options) {
    return []
  }

  const normalized = new Set<string>()

  const consume = (value: unknown) => {
    if (typeof value === 'string' && value.trim().length > 0) {
      normalized.add(value.trim())
      return
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      normalized.add(String(value))
      return
    }
    if (value && typeof value === 'object') {
      const candidate = value as { value?: unknown }
      if (typeof candidate.value === 'string' && candidate.value.trim().length > 0) {
        normalized.add(candidate.value.trim())
      }
    }
  }

  const walk = (input: unknown): void => {
    if (Array.isArray(input)) {
      input.forEach(consume)
      return
    }

    if (input && typeof input === 'object') {
      const record = input as Record<string, unknown>
      if (Array.isArray(record.choices)) {
        record.choices.forEach(consume)
      }
      if (Array.isArray(record.options)) {
        record.options.forEach(consume)
      }
      if (Array.isArray(record.values)) {
        record.values.forEach(consume)
      }
    }
  }

  walk(options)
  return Array.from(normalized)
}

const matchIsLocked = (match: { status: MatchStatus; matchDateTime: Date }): boolean => {
  if (match.status !== MatchStatus.SCHEDULED) {
    return true
  }
  const now = Date.now()
  return match.matchDateTime.getTime() <= now
}

const serializeEntry = (entry: EntryWithTemplate): UserPredictionEntryView => ({
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
  competitionName: entry.template.match.season?.competition?.name ?? null,
  seasonName: entry.template.match.season?.name ?? null,
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
})

const serializeLegacyPrediction = (prediction: LegacyPrediction): UserPredictionEntryView => {
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
    competitionName: prediction.match.season?.competition?.name ?? null,
    seasonName: prediction.match.season?.name ?? null,
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
}

export default async function predictionRoutes(server: FastifyInstance) {
  server.get('/api/predictions/active', async (request, reply) => {
    const days = normalizeDays((request.query as { days?: string }).days)
    const now = new Date()
    const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)

    try {
      await ensurePredictionTemplatesInRange({
        from: now,
        to: until,
      })
    } catch (err) {
      request.server.log.warn(
        { err, days },
        'predictions: failed to ensure templates for active list'
      )
    }

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
          season: {
            include: {
              competition: true,
            },
          },
        },
      })

      return rows.map(match => ({
        matchId: match.id.toString(),
        matchDateTime: match.matchDateTime.toISOString(),
        status: match.status,
        competitionName: match.season?.competition?.name ?? null,
        seasonName: match.season?.name ?? null,
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

  const cacheKey = ACTIVE_PREDICTION_CACHE_KEY(days)
    const { value, version } = await defaultCache.getWithMeta(cacheKey, loader, {
      ttlSeconds: PREDICTION_UPCOMING_CACHE_TTL_SECONDS,
      staleWhileRevalidateSeconds: PREDICTION_UPCOMING_STALE_SECONDS,
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
  `public, max-age=${PREDICTION_UPCOMING_CACHE_TTL_SECONDS}, stale-while-revalidate=${PREDICTION_UPCOMING_STALE_SECONDS}`
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

  const cacheKey = USER_PREDICTION_CACHE_KEY(user.id)

    const loader = async (): Promise<UserPredictionEntryView[]> => {
      const [entries, legacy] = await Promise.all([
        prisma.predictionEntry.findMany({
          where: { userId: user.id },
          orderBy: { submittedAt: 'desc' },
          take: 100,
          include: ENTRY_WITH_TEMPLATE_INCLUDE,
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
                season: {
                  include: {
                    competition: true,
                  },
                },
              },
            },
          },
        }),
      ])

      const entryViews: UserPredictionEntryView[] = entries.map(serializeEntry)
      const legacyViews: UserPredictionEntryView[] = legacy.map(serializeLegacyPrediction)

      return [...entryViews, ...legacyViews].sort((left, right) =>
        right.submittedAt.localeCompare(left.submittedAt)
      )
    }

    const { value, version } = await defaultCache.getWithMeta(cacheKey, loader, {
      ttlSeconds: PREDICTION_USER_CACHE_TTL_SECONDS,
      staleWhileRevalidateSeconds: PREDICTION_USER_STALE_SECONDS,
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
  `private, max-age=${PREDICTION_USER_CACHE_TTL_SECONDS}, stale-while-revalidate=${PREDICTION_USER_STALE_SECONDS}`
    )
    reply.header('ETag', etag)
    reply.header('X-Resource-Version', String(version))

    return reply.send({ ok: true, data: value, meta: { version } })
  })

  server.post('/api/predictions/templates/:templateId/entry', async (request, reply) => {
    const { templateId: rawTemplateId } = request.params as { templateId?: string }
    if (!rawTemplateId) {
      return reply.status(400).send({ ok: false, error: 'missing_template_id' })
    }

    let templateId: bigint
    try {
      templateId = BigInt(rawTemplateId)
    } catch (err) {
      return reply.status(400).send({ ok: false, error: 'invalid_template_id' })
    }

    if (templateId <= 0) {
      return reply.status(400).send({ ok: false, error: 'invalid_template_id' })
    }

    const token = extractSessionToken(request)
    if (!token) {
      return reply.status(401).send({ ok: false, error: 'no_token' })
    }

    const subject = resolveSessionSubject(token)
    if (!subject) {
      return reply.status(401).send({ ok: false, error: 'invalid_token' })
    }

    let telegramId: bigint
    try {
      telegramId = BigInt(subject)
    } catch (err) {
      return reply.status(401).send({ ok: false, error: 'invalid_token' })
    }

    const user = await prisma.appUser.findUnique({
      where: { telegramId },
    })

    if (!user) {
      return reply.status(404).send({ ok: false, error: 'user_not_found' })
    }

    const body = (request.body ?? {}) as { selection?: unknown }
    if (typeof body.selection !== 'string') {
      return reply.status(400).send({ ok: false, error: 'selection_required' })
    }

    const selection = body.selection.trim()
    if (!selection) {
      return reply.status(400).send({ ok: false, error: 'selection_required' })
    }

  if (selection.length > PREDICTION_MAX_SELECTION_LENGTH) {
      return reply.status(400).send({ ok: false, error: 'selection_too_long' })
    }

    // Проверка недельного лимита
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const weeklyCount = await prisma.predictionEntry.count({
      where: {
        userId: user.id,
        submittedAt: {
          gte: weekAgo,
        },
      },
    })

    if (weeklyCount >= PREDICTION_WEEKLY_LIMIT) {
      return reply.status(429).send({ ok: false, error: 'weekly_limit_reached' })
    }

    const template = await prisma.predictionTemplate.findUnique({
      where: { id: templateId },
      include: {
        match: {
          include: {
            homeClub: true,
            awayClub: true,
          },
        },
      },
    })

    if (!template || !template.match) {
      return reply.status(404).send({ ok: false, error: 'template_not_found' })
    }

    if (matchIsLocked({ status: template.match.status, matchDateTime: template.match.matchDateTime })) {
      return reply.status(409).send({ ok: false, error: 'match_locked' })
    }

    const allowedSelections = selectionFromOptions(template.options)
    if (allowedSelections.length === 0) {
      return reply.status(409).send({ ok: false, error: 'template_not_ready' })
    }

    if (!allowedSelections.includes(selection)) {
      return reply.status(400).send({ ok: false, error: 'invalid_selection' })
    }

    const now = new Date()

    type TxResult = { entry: EntryWithTemplate; created: boolean }

    try {
      const result = await prisma.$transaction<TxResult>(async tx => {
        const existing = await tx.predictionEntry.findFirst({
          where: {
            userId: user.id,
            templateId: template.id,
          },
          select: {
            id: true,
            status: true,
          },
        })

        if (existing) {
          if (existing.status !== PredictionEntryStatus.PENDING) {
            throw new Error('ENTRY_LOCKED')
          }

          const updated = await tx.predictionEntry.update({
            where: { id: existing.id },
            data: {
              selection,
              submittedAt: now,
              status: PredictionEntryStatus.PENDING,
              scoreAwarded: null,
              resolvedAt: null,
              resolutionMeta: Prisma.JsonNull,
            },
            include: ENTRY_WITH_TEMPLATE_INCLUDE,
          })

          return { entry: updated, created: false }
        }

        const created = await tx.predictionEntry.create({
          data: {
            templateId: template.id,
            userId: user.id,
            selection,
            submittedAt: now,
            status: PredictionEntryStatus.PENDING,
          },
          include: ENTRY_WITH_TEMPLATE_INCLUDE,
        })

        return { entry: created, created: true }
      })

  await defaultCache.invalidate(USER_PREDICTION_CACHE_KEY(user.id)).catch(() => undefined)

      const view = serializeEntry(result.entry)

      return reply
        .status(result.created ? 201 : 200)
        .send({ ok: true, data: view, meta: { created: result.created } })
    } catch (err) {
      if (err instanceof Error && err.message === 'ENTRY_LOCKED') {
        return reply.status(409).send({ ok: false, error: 'entry_locked' })
      }

      throw err
    }
  })
}
