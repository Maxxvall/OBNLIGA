/**
 * API routes для экспресс-прогнозов
 */

import { FastifyInstance } from 'fastify'
import prisma from '../db'
import { defaultCache } from '../cache'
import { buildWeakEtag, matchesIfNoneMatch } from '../utils/httpCaching'
import { extractSessionToken, resolveSessionSubject } from '../utils/session'
import {
  EXPRESS_MAX_ITEMS,
  EXPRESS_MIN_ITEMS,
  EXPRESS_MULTIPLIERS,
  EXPRESS_USER_CACHE_KEY,
  EXPRESS_USER_CACHE_TTL_SECONDS,
  EXPRESS_USER_STALE_SECONDS,
  EXPRESS_WEEK_COUNT_CACHE_KEY,
  EXPRESS_WEEK_COUNT_TTL_SECONDS,
  EXPRESS_WEEK_COUNT_STALE_SECONDS,
  EXPRESS_WEEKLY_LIMIT,
  EXPRESS_WEEKLY_LIMIT_DAYS,
} from '../services/predictionConstants'
import {
  createExpressBet,
  CreateExpressItemInput,
  ExpressBetView,
  serializeExpressBet,
  validateExpressInput,
} from '../services/expressService'

type CreateExpressBody = {
  items?: Array<{
    templateId?: string | number
    selection?: string
  }>
}

const EXPRESS_WITH_ITEMS_INCLUDE = {
  items: {
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
  },
} as const

export default async function expressRoutes(server: FastifyInstance) {
  /**
   * POST /api/predictions/express
   * Создание экспресс-прогноза
   */
  server.post('/api/predictions/express', async (request, reply) => {
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
    } catch {
      return reply.status(401).send({ ok: false, error: 'invalid_token' })
    }

    const user = await prisma.appUser.findUnique({
      where: { telegramId },
    })

    if (!user) {
      return reply.status(404).send({ ok: false, error: 'user_not_found' })
    }

    const body = (request.body ?? {}) as CreateExpressBody

    // Валидация body
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return reply.status(400).send({ ok: false, error: 'items_required' })
    }

    // Парсинг items
    const items: CreateExpressItemInput[] = []
    for (const item of body.items) {
      if (!item.templateId || !item.selection) {
        return reply.status(400).send({ ok: false, error: 'invalid_item' })
      }

      let templateId: bigint
      try {
        templateId = BigInt(item.templateId)
      } catch {
        return reply.status(400).send({ ok: false, error: 'invalid_template_id' })
      }

      if (templateId <= 0) {
        return reply.status(400).send({ ok: false, error: 'invalid_template_id' })
      }

      if (typeof item.selection !== 'string' || !item.selection.trim()) {
        return reply.status(400).send({ ok: false, error: 'invalid_selection' })
      }

      items.push({
        templateId,
        selection: item.selection.trim(),
      })
    }

    try {
      const result = await prisma.$transaction(async tx => {
        // Валидация
        const { result: validation } = await validateExpressInput({ userId: user.id, items }, tx)
        if (!validation.valid) {
          return { error: validation.error as string, details: validation.details }
        }

        // Создание экспресса
        const express = await createExpressBet({ userId: user.id, items }, tx, request.log)
        return { express }
      })

      if ('error' in result && result.error) {
        const errorMap: Record<string, number> = {
          too_few_items: 400,
          too_many_items: 400,
          duplicate_templates: 400,
          same_match_templates: 400,
          template_not_found: 404,
          match_locked: 409,
          invalid_selection: 400,
          weekly_limit_reached: 429,
        }

        const status = errorMap[result.error] ?? 400
        return reply.status(status).send({ ok: false, error: result.error, details: result.details })
      }

      // Инвалидируем кэш экспрессов пользователя и счётчика
      await Promise.all([
        defaultCache.invalidate(EXPRESS_USER_CACHE_KEY(user.id)).catch(() => undefined),
        defaultCache.invalidate(EXPRESS_WEEK_COUNT_CACHE_KEY(user.id)).catch(() => undefined),
      ])

      const view = serializeExpressBet(result.express!)

      return reply.status(201).send({ ok: true, data: view })
    } catch (err) {
      if (err instanceof Error) {
        const knownErrors = [
          'too_few_items',
          'too_many_items',
          'duplicate_templates',
          'same_match_templates',
          'template_not_found',
          'match_locked',
          'invalid_selection',
          'weekly_limit_reached',
        ]
        if (knownErrors.includes(err.message)) {
          return reply.status(400).send({ ok: false, error: err.message })
        }
      }
      throw err
    }
  })

  /**
   * GET /api/predictions/express/my
   * Получение своих экспрессов
   */
  server.get('/api/predictions/express/my', async (request, reply) => {
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

    const cacheKey = EXPRESS_USER_CACHE_KEY(user.id)

    const loader = async (): Promise<ExpressBetView[]> => {
      const expressBets = await prisma.expressBet.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: EXPRESS_WITH_ITEMS_INCLUDE,
      })

      return expressBets.map(serializeExpressBet)
    }

    const { value, version } = await defaultCache.getWithMeta(cacheKey, loader, {
      ttlSeconds: EXPRESS_USER_CACHE_TTL_SECONDS,
      staleWhileRevalidateSeconds: EXPRESS_USER_STALE_SECONDS,
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
      `private, max-age=${EXPRESS_USER_CACHE_TTL_SECONDS}, stale-while-revalidate=${EXPRESS_USER_STALE_SECONDS}`
    )
    reply.header('ETag', etag)
    reply.header('X-Resource-Version', String(version))

    return reply.send({ ok: true, data: value, meta: { version } })
  })

  /**
   * GET /api/predictions/express/week-count
   * Получение количества экспрессов за неделю (для UI)
   */
  server.get('/api/predictions/express/week-count', async (request, reply) => {
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

    const cacheKey = EXPRESS_WEEK_COUNT_CACHE_KEY(user.id)

    type WeekCountData = {
      count: number
      limit: number
      remaining: number
      periodDays: number
    }

    const loader = async (): Promise<WeekCountData> => {
      const limitDate = new Date(Date.now() - EXPRESS_WEEKLY_LIMIT_DAYS * 24 * 60 * 60 * 1000)

      const count = await prisma.expressBet.count({
        where: {
          userId: user.id,
          createdAt: { gte: limitDate },
        },
      })

      return {
        count,
        limit: EXPRESS_WEEKLY_LIMIT,
        remaining: Math.max(0, EXPRESS_WEEKLY_LIMIT - count),
        periodDays: EXPRESS_WEEKLY_LIMIT_DAYS,
      }
    }

    const { value, version } = await defaultCache.getWithMeta(cacheKey, loader, {
      ttlSeconds: EXPRESS_WEEK_COUNT_TTL_SECONDS,
      staleWhileRevalidateSeconds: EXPRESS_WEEK_COUNT_STALE_SECONDS,
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
      `private, max-age=${EXPRESS_WEEK_COUNT_TTL_SECONDS}, stale-while-revalidate=${EXPRESS_WEEK_COUNT_STALE_SECONDS}`
    )
    reply.header('ETag', etag)
    reply.header('X-Resource-Version', String(version))

    return reply.send({ ok: true, data: value, meta: { version } })
  })

  /**
   * GET /api/predictions/express/config
   * Получение конфигурации экспрессов (для UI)
   */
  server.get('/api/predictions/express/config', async (_request, reply) => {
    return reply.send({
      ok: true,
      data: {
        minItems: EXPRESS_MIN_ITEMS,
        maxItems: EXPRESS_MAX_ITEMS,
        multipliers: EXPRESS_MULTIPLIERS,
        weeklyLimit: EXPRESS_WEEKLY_LIMIT,
        periodDays: EXPRESS_WEEKLY_LIMIT_DAYS,
      },
    })
  })

  /**
   * GET /api/predictions/express/:id
   * Получение конкретного экспресса по ID
   */
  server.get('/api/predictions/express/:id', async (request, reply) => {
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

    const { id: rawId } = request.params as { id?: string }
    if (!rawId) {
      return reply.status(400).send({ ok: false, error: 'missing_id' })
    }

    let expressId: bigint
    try {
      expressId = BigInt(rawId)
    } catch {
      return reply.status(400).send({ ok: false, error: 'invalid_id' })
    }

    const express = await prisma.expressBet.findUnique({
      where: { id: expressId },
      include: EXPRESS_WITH_ITEMS_INCLUDE,
    })

    if (!express) {
      return reply.status(404).send({ ok: false, error: 'express_not_found' })
    }

    // Проверяем что экспресс принадлежит пользователю
    if (express.userId !== user.id) {
      return reply.status(403).send({ ok: false, error: 'forbidden' })
    }

    const view = serializeExpressBet(express)

    return reply.send({ ok: true, data: view })
  })
}
