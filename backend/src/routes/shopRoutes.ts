import { FastifyInstance } from 'fastify'
import prisma from '../db'
import { defaultCache, PUBLIC_SHOP_ITEMS_KEY, shopHistoryCacheKey } from '../cache'
import { buildWeakEtag, matchesIfNoneMatch } from '../utils/httpCaching'
import { extractSessionToken, resolveSessionSubject } from '../utils/session'
import type { ShopItemView, ShopOrderView } from '@shared/types'
import { serializeShopItemView, serializeShopOrderView } from '../services/shop/serializers'

const SHOP_ITEMS_CACHE_TTL_SECONDS = 45
const SHOP_HISTORY_CACHE_TTL_SECONDS = 30
const SHOP_RESPONSE_MAX_AGE_SECONDS = 10
const SHOP_RESPONSE_STALE_SECONDS = 120
const SHOP_NOTE_MAX_LENGTH = 500

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const loadPublicShopItems = async (): Promise<ShopItemView[]> => {
  const rows = await prisma.shopItem.findMany({
    where: { isActive: true },
    orderBy: [
      { sortOrder: 'asc' },
      { id: 'asc' },
    ],
  })
  return rows.map(serializeShopItemView)
}



const fetchOrderHistory = async (telegramId: bigint): Promise<ShopOrderView[]> => {
  const rows = await prisma.shopOrder.findMany({
    where: {
      OR: [
        { telegramId },
        {
          user: {
            telegramId,
          },
        },
      ],
    },
    include: {
      items: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return rows.map(serializeShopOrderView)
}

const parseTelegramId = (value: string | null): bigint | null => {
  if (!value) {
    return null
  }
  try {
    return BigInt(value)
  } catch (err) {
    return null
  }
}

export default async function shopRoutes(server: FastifyInstance) {
  server.get('/api/shop/items', async (request, reply) => {
    const { value, version } = await defaultCache.getWithMeta(
      PUBLIC_SHOP_ITEMS_KEY,
      loadPublicShopItems,
      {
        ttlSeconds: SHOP_ITEMS_CACHE_TTL_SECONDS,
        staleWhileRevalidateSeconds: SHOP_RESPONSE_STALE_SECONDS,
      }
    )

    const etag = buildWeakEtag(PUBLIC_SHOP_ITEMS_KEY, version)
    if (matchesIfNoneMatch(request.headers, etag)) {
      return reply.status(304).header('ETag', etag).header('X-Resource-Version', String(version)).send()
    }

    reply
      .header(
        'Cache-Control',
        `public, max-age=${SHOP_RESPONSE_MAX_AGE_SECONDS}, stale-while-revalidate=${SHOP_RESPONSE_STALE_SECONDS}`
      )
      .header('ETag', etag)
      .header('X-Resource-Version', String(version))

    return reply.send({ ok: true, data: value, meta: { version } })
  })

  server.get('/api/shop/orders/history', async (request, reply) => {
    const token = extractSessionToken(request)
    if (!token) {
      return reply.status(401).send({ ok: false, error: 'unauthorized' })
    }

    const subject = resolveSessionSubject(token)
    if (!subject) {
      return reply.status(401).send({ ok: false, error: 'invalid_token' })
    }

    const telegramId = parseTelegramId(subject)
    if (!telegramId) {
      return reply.status(401).send({ ok: false, error: 'invalid_token' })
    }

    const cacheKey = shopHistoryCacheKey(telegramId.toString())
    const { value, version } = await defaultCache.getWithMeta(
      cacheKey,
      () => fetchOrderHistory(telegramId),
      {
        ttlSeconds: SHOP_HISTORY_CACHE_TTL_SECONDS,
        staleWhileRevalidateSeconds: SHOP_HISTORY_CACHE_TTL_SECONDS * 2,
      }
    )
    const etag = buildWeakEtag(cacheKey, version)

    if (matchesIfNoneMatch(request.headers, etag)) {
      return reply.status(304).header('ETag', etag).header('X-Resource-Version', String(version)).send()
    }

    reply
      .header('Cache-Control', 'private, max-age=0, must-revalidate')
      .header('ETag', etag)
      .header('X-Resource-Version', String(version))

    return reply.send({ ok: true, data: value, meta: { version } })
  })

  server.post('/api/shop/orders', async (request, reply) => {
    const body = (request.body ?? {}) as {
      items?: Array<{ itemId?: unknown; quantity?: unknown }>
      contact?: { username?: unknown; firstName?: unknown }
      customerNote?: unknown
    }

    const itemsInput = Array.isArray(body.items) ? body.items : []
    if (!itemsInput.length) {
      return reply.status(400).send({ ok: false, error: 'shop_items_required' })
    }

    const normalizedItems: Array<{ itemId: number; quantity: number }> = []
    const seen = new Set<number>()
    for (const entry of itemsInput) {
      const itemId = Number(entry?.itemId)
      const quantity = Number(entry?.quantity)
      if (!Number.isInteger(itemId) || itemId <= 0) {
        return reply.status(400).send({ ok: false, error: 'shop_item_invalid' })
      }
      if (!Number.isInteger(quantity) || quantity <= 0) {
        return reply.status(400).send({ ok: false, error: 'shop_quantity_invalid' })
      }
      if (seen.has(itemId)) {
        return reply.status(400).send({ ok: false, error: 'shop_duplicate_item' })
      }
      seen.add(itemId)
      normalizedItems.push({ itemId, quantity })
    }

    const token = extractSessionToken(request)
    const subject = token ? resolveSessionSubject(token) : null
    const telegramId = parseTelegramId(subject)

    const contactUsernameRaw = normalizeString(body.contact?.username)
    const contactFirstNameRaw = normalizeString(body.contact?.firstName)

    if (!telegramId && !contactUsernameRaw) {
      return reply.status(400).send({ ok: false, error: 'shop_contact_required' })
    }

    const customerNote = normalizeString(body.customerNote)
    if (customerNote.length > SHOP_NOTE_MAX_LENGTH) {
      return reply.status(400).send({ ok: false, error: 'shop_note_too_long' })
    }

    const dbItems = await prisma.shopItem.findMany({
      where: { id: { in: normalizedItems.map(item => item.itemId) } },
    })

    if (dbItems.length !== normalizedItems.length) {
      return reply.status(404).send({ ok: false, error: 'shop_item_not_found' })
    }

    const dbMap = new Map(dbItems.map(item => [item.id, item]))
    const orderLines: Array<{ record: (typeof dbItems)[number]; quantity: number }> = []

    for (const input of normalizedItems) {
      const record = dbMap.get(input.itemId)
      if (!record || !record.isActive) {
        return reply.status(400).send({ ok: false, error: 'shop_item_inactive' })
      }
      if (record.maxPerOrder > 0 && input.quantity > record.maxPerOrder) {
        return reply.status(400).send({ ok: false, error: 'shop_limit_exceeded' })
      }
      if (record.stockQuantity !== null && input.quantity > record.stockQuantity) {
        return reply.status(409).send({ ok: false, error: 'shop_not_enough_stock' })
      }
      orderLines.push({ record, quantity: input.quantity })
    }

    const currencies = new Set(orderLines.map(line => line.record.currencyCode))
    if (currencies.size > 1) {
      return reply.status(400).send({ ok: false, error: 'shop_currency_mismatch' })
    }

    const totalCents = orderLines.reduce((sum, line) => sum + line.record.priceCents * line.quantity, 0)
    if (totalCents <= 0) {
      return reply.status(400).send({ ok: false, error: 'shop_total_invalid' })
    }

    let userRecord: { id: number; telegramId: bigint; username: string | null; firstName: string | null } | null = null
    if (telegramId) {
      userRecord = await prisma.appUser.findUnique({ where: { telegramId } })
    }

    const username = (contactUsernameRaw || userRecord?.username || '').replace(/^@+/g, '')
    const normalizedUsername = username ? `@${username}` : null
    const normalizedFirstName = contactFirstNameRaw || userRecord?.firstName || null

    if (!normalizedUsername) {
      return reply.status(400).send({ ok: false, error: 'shop_contact_required' })
    }

    try {
      const created = await prisma.$transaction(async tx => {
        // create order with temporary orderNumber, we'll set human-friendly number after create
        const order = await tx.shopOrder.create({
          data: {
            orderNumber: '',
            userId: userRecord?.id ?? null,
            telegramId: telegramId ?? null,
            username: normalizedUsername,
            firstName: normalizedFirstName,
            totalCents,
            currencyCode: orderLines[0].record.currencyCode,
            customerNote: customerNote || null,
            items: {
              create: orderLines.map(line => ({
                itemId: line.record.id,
                title: line.record.title,
                subtitle: line.record.subtitle,
                priceCents: line.record.priceCents,
                quantity: line.quantity,
                imageUrl: line.record.imageUrl,
              })),
            },
          },
          include: { items: true },
        })

        for (const line of orderLines) {
          if (line.record.stockQuantity === null) {
            continue
          }
          const updated = await tx.shopItem.updateMany({
            where: {
              id: line.record.id,
              stockQuantity: {
                gte: line.quantity,
              },
            },
            data: {
              stockQuantity: { decrement: line.quantity },
            },
          })
          if (updated.count === 0) {
            throw new Error('shop_not_enough_stock')
          }
        }

        // set human-friendly order number like "Заказ #<id>"
        const updatedOrder = await tx.shopOrder.update({
          where: { id: order.id },
          data: { orderNumber: `Заказ #${order.id}` },
          include: { items: true },
        })

        return updatedOrder
      })

      const payload = serializeShopOrderView(created)
      await defaultCache.invalidate(PUBLIC_SHOP_ITEMS_KEY)
      if (telegramId) {
        await defaultCache.invalidate(shopHistoryCacheKey(telegramId.toString()))
      }
      return reply.status(201).send({ ok: true, data: payload })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'shop_order_failed'
      if (message === 'shop_not_enough_stock') {
        return reply.status(409).send({ ok: false, error: 'shop_not_enough_stock' })
      }
      request.log.error({ err }, 'shop order creation failed')
      return reply.status(500).send({ ok: false, error: 'shop_order_failed' })
    }
  })
}
