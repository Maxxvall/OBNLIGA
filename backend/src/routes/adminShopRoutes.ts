import { FastifyInstance } from 'fastify'
import { Prisma, ShopOrderStatus, type ShopItem } from '@prisma/client'
import prisma from '../db'
import { adminAuthHook } from '../utils/adminAuth'
import { defaultCache, PUBLIC_SHOP_ITEMS_KEY, shopHistoryCacheKey } from '../cache'
import {
  serializeShopItemView,
  serializeShopOrderView,
  type ShopItemWithImage,
} from '../services/shop/serializers'

const MAX_SHOP_TITLE_LENGTH = 80
const MAX_SHOP_SUBTITLE_LENGTH = 160
const MAX_SHOP_DESCRIPTION_LENGTH = 5000
const MAX_SHOP_PRICE_CENTS = 100_000_00
const SHOP_DEFAULT_MAX_PER_ORDER = 3
const SHOP_MAX_PER_ORDER = 20
const SHOP_DEFAULT_SORT_ORDER = 100
const SHOP_MAX_STOCK_QUANTITY = 10_000
const MAX_SHOP_IMAGE_SIZE_BYTES = 2_000_000
const MAX_SHOP_IMAGE_DIMENSION = 3000
const ALLOWED_SHOP_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const SHOP_ALLOWED_CURRENCIES = new Set(['RUB', 'USD', 'EUR'])
const SHOP_NOTE_MAX_LENGTH = 500
const SHOP_CONFIRMED_BY_MAX_LENGTH = 64

interface ParsedShopImage {
  buffer: Buffer
  mimeType: string
  width: number
  height: number
  size: number
}

class ShopAdminError extends Error {
  status: number
  constructor(code: string, status = 400) {
    super(code)
    this.status = status
  }
}

const hasOwn = (target: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(target, key)

const normalizeTitle = (value: unknown): string => {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) {
    throw new ShopAdminError('shop_title_required')
  }
  if (raw.length > MAX_SHOP_TITLE_LENGTH) {
    throw new ShopAdminError('shop_title_too_long')
  }
  return raw
}

const normalizeSubtitle = (value: unknown): string | null => {
  if (value === undefined || value === null) {
    return null
  }
  const raw = String(value).trim()
  if (!raw) {
    return null
  }
  if (raw.length > MAX_SHOP_SUBTITLE_LENGTH) {
    throw new ShopAdminError('shop_subtitle_too_long')
  }
  return raw
}

const normalizeDescription = (value: unknown): string | null => {
  if (value === undefined || value === null) {
    return null
  }
  const raw = String(value).trim()
  if (!raw) {
    return null
  }
  if (raw.length > MAX_SHOP_DESCRIPTION_LENGTH) {
    throw new ShopAdminError('shop_description_too_long')
  }
  return raw
}

const normalizeCurrencyCode = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) {
    return 'RUB'
  }
  const code = value.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new ShopAdminError('shop_currency_invalid')
  }
  if (!SHOP_ALLOWED_CURRENCIES.has(code)) {
    throw new ShopAdminError('shop_currency_unsupported')
  }
  return code
}

const normalizePriceCents = (value: unknown): number => {
  const price = Number(value)
  if (!Number.isInteger(price) || price <= 0 || price > MAX_SHOP_PRICE_CENTS) {
    throw new ShopAdminError('shop_price_invalid')
  }
  return price
}

const normalizeStockQuantity = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') {
    return null
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > SHOP_MAX_STOCK_QUANTITY) {
    throw new ShopAdminError('shop_stock_invalid')
  }
  return parsed
}

const normalizeMaxPerOrder = (value: unknown): number => {
  if (value === undefined || value === null) {
    return SHOP_DEFAULT_MAX_PER_ORDER
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > SHOP_MAX_PER_ORDER) {
    throw new ShopAdminError('shop_max_per_order_invalid')
  }
  return parsed
}

const normalizeSortOrder = (value: unknown): number => {
  if (value === undefined || value === null) {
    return SHOP_DEFAULT_SORT_ORDER
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10_000) {
    throw new ShopAdminError('shop_sort_order_invalid')
  }
  return parsed
}

const normalizeSlug = (value: unknown): string | null => {
  if (value === undefined || value === null) {
    return null
  }
  const raw = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!raw) {
    return null
  }
  if (raw.length > 64) {
    throw new ShopAdminError('shop_slug_too_long')
  }
  return raw
}

const normalizeImageUrl = (value: unknown): string | null => {
  if (value === undefined || value === null) {
    return null
  }
  const raw = String(value).trim()
  if (!raw) {
    return null
  }
  if (raw.length > 2000) {
    throw new ShopAdminError('shop_image_url_invalid')
  }
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('invalid')
    }
  } catch (err) {
    throw new ShopAdminError('shop_image_url_invalid')
  }
  return raw
}

const decodeShopImagePayload = (value: unknown, required: boolean): ParsedShopImage | null => {
  if (value === undefined || value === null) {
    if (required) {
      throw new ShopAdminError('shop_image_required')
    }
    return null
  }
  if (typeof value !== 'object' || value === null) {
    throw new ShopAdminError('shop_image_invalid')
  }
  const payload = value as Record<string, unknown>
  const mimeTypeRaw = typeof payload.mimeType === 'string' ? payload.mimeType.trim().toLowerCase() : ''
  if (!mimeTypeRaw) {
    throw new ShopAdminError('shop_image_mime_required')
  }
  if (!ALLOWED_SHOP_IMAGE_MIME_TYPES.has(mimeTypeRaw)) {
    throw new ShopAdminError('shop_image_mime_unsupported')
  }
  let base64 = typeof payload.base64 === 'string' ? payload.base64.trim() : ''
  if (!base64) {
    throw new ShopAdminError('shop_image_base64_required')
  }
  const commaIndex = base64.indexOf(',')
  if (base64.startsWith('data:') && commaIndex !== -1) {
    base64 = base64.slice(commaIndex + 1)
  }
  let buffer: Buffer
  try {
    buffer = Buffer.from(base64, 'base64')
  } catch (err) {
    throw new ShopAdminError('shop_image_invalid')
  }
  if (!buffer.length || buffer.length > MAX_SHOP_IMAGE_SIZE_BYTES) {
    throw new ShopAdminError('shop_image_too_large')
  }
  const widthValue = Number(payload.width)
  const heightValue = Number(payload.height)
  if (!Number.isInteger(widthValue) || !Number.isInteger(heightValue)) {
    throw new ShopAdminError('shop_image_dimensions_invalid')
  }
  const width = Math.trunc(widthValue)
  const height = Math.trunc(heightValue)
  if (
    width <= 0 ||
    height <= 0 ||
    width > MAX_SHOP_IMAGE_DIMENSION ||
    height > MAX_SHOP_IMAGE_DIMENSION
  ) {
    throw new ShopAdminError('shop_image_dimensions_invalid')
  }
  const sizeValue = Number(payload.size)
  if (!Number.isInteger(sizeValue) || sizeValue <= 0) {
    throw new ShopAdminError('shop_image_size_invalid')
  }
  const declared = Math.trunc(sizeValue)
  if (Math.abs(declared - buffer.length) > 64) {
    throw new ShopAdminError('shop_image_size_mismatch')
  }
  return {
    buffer,
    mimeType: mimeTypeRaw,
    width,
    height,
    size: buffer.length,
  }
}

const normalizeConfirmedBy = (value: unknown): string | null => {
  if (value === undefined || value === null) {
    return null
  }
  const raw = String(value).trim()
  if (!raw) {
    return null
  }
  if (raw.length > SHOP_CONFIRMED_BY_MAX_LENGTH) {
    throw new ShopAdminError('shop_confirmed_by_too_long')
  }
  return raw
}

const normalizeCustomerNote = (value: unknown): string | null => {
  if (value === undefined || value === null) {
    return null
  }
  const raw = String(value).trim()
  if (!raw) {
    return null
  }
  if (raw.length > SHOP_NOTE_MAX_LENGTH) {
    throw new ShopAdminError('shop_note_too_long')
  }
  return raw
}

const parseOrderStatus = (value: unknown): ShopOrderStatus | null => {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim().toUpperCase()
  if (!normalized) {
    return null
  }
  if (!Object.prototype.hasOwnProperty.call(ShopOrderStatus, normalized)) {
    throw new ShopAdminError('shop_status_invalid')
  }
  return normalized as ShopOrderStatus
}

const invalidateCatalogCache = async () => {
  try {
    await defaultCache.invalidate(PUBLIC_SHOP_ITEMS_KEY)
  } catch (err) {
    /* ignore */
  }
}

const invalidateHistoryCache = async (telegramId: bigint | null) => {
  if (!telegramId) {
    return
  }
  try {
    await defaultCache.invalidate(shopHistoryCacheKey(telegramId.toString()))
  } catch (err) {
    /* ignore */
  }
}

const serializeItem = (item: ShopItem) => serializeShopItemView(item as ShopItemWithImage)

export default async function adminShopRoutes(server: FastifyInstance) {
  server.register(
    async admin => {
      admin.addHook('onRequest', adminAuthHook)

      admin.get('/items', async (request, reply) => {
        const includeInactiveParam = (request.query as { includeInactive?: string })?.includeInactive ?? ''
        const includeInactive = ['true', '1', 'yes'].includes(includeInactiveParam.toLowerCase())
        const items = await prisma.shopItem.findMany({
          where: includeInactive ? {} : { isActive: true },
          orderBy: [
            { sortOrder: 'asc' },
            { id: 'asc' },
          ],
        })
        return reply.send({ ok: true, data: items.map(serializeItem) })
      })

      admin.get('/items/:itemId', async (request, reply) => {
        const itemId = Number((request.params as { itemId?: string }).itemId)
        if (!Number.isInteger(itemId) || itemId <= 0) {
          return reply.status(400).send({ ok: false, error: 'shop_item_invalid' })
        }
        const item = await prisma.shopItem.findUnique({ where: { id: itemId } })
        if (!item) {
          return reply.status(404).send({ ok: false, error: 'shop_item_not_found' })
        }
          return reply.send({ ok: true, data: serializeItem(item) })
      })

      admin.post('/items', async (request, reply) => {
        const body = (request.body ?? {}) as Record<string, unknown>
        try {
          const data = {
            slug: normalizeSlug(body.slug),
            title: normalizeTitle(body.title),
            subtitle: normalizeSubtitle(body.subtitle),
            description: normalizeDescription(body.description),
            priceCents: normalizePriceCents(body.priceCents),
            currencyCode: normalizeCurrencyCode(body.currencyCode),
            stockQuantity: normalizeStockQuantity(body.stockQuantity),
            maxPerOrder: normalizeMaxPerOrder(body.maxPerOrder),
            sortOrder: normalizeSortOrder(body.sortOrder),
            isActive: hasOwn(body, 'isActive') ? Boolean(body.isActive) : true,
            imageUrl: normalizeImageUrl(body.imageUrl),
          }

          const image = decodeShopImagePayload(body.image, false)

          const created = await prisma.shopItem.create({
            data: {
              ...data,
              imageData: image?.buffer ?? null,
              imageMime: image?.mimeType ?? null,
              imageWidth: image?.width ?? null,
              imageHeight: image?.height ?? null,
              imageSize: image?.size ?? null,
            },
          })

          await invalidateCatalogCache()

          reply.status(201)
          return reply.send({ ok: true, data: serializeItem(created) })
        } catch (err) {
          if (err instanceof ShopAdminError) {
            return reply.status(err.status).send({ ok: false, error: err.message })
          }
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            return reply.status(409).send({ ok: false, error: 'shop_slug_taken' })
          }
          request.log.error({ err }, 'shop item create failed')
          return reply.status(500).send({ ok: false, error: 'shop_item_create_failed' })
        }
      })

      admin.put('/items/:itemId', async (request, reply) => {
        const itemId = Number((request.params as { itemId?: string }).itemId)
        if (!Number.isInteger(itemId) || itemId <= 0) {
          return reply.status(400).send({ ok: false, error: 'shop_item_invalid' })
        }
        const body = (request.body ?? {}) as Record<string, unknown>
        const data: Prisma.ShopItemUpdateInput = {}
        try {
          if (hasOwn(body, 'title')) {
            data.title = normalizeTitle(body.title)
          }
          if (hasOwn(body, 'subtitle')) {
            data.subtitle = normalizeSubtitle(body.subtitle)
          }
          if (hasOwn(body, 'description')) {
            data.description = normalizeDescription(body.description)
          }
          if (hasOwn(body, 'slug')) {
            data.slug = normalizeSlug(body.slug)
          }
          if (hasOwn(body, 'priceCents')) {
            data.priceCents = normalizePriceCents(body.priceCents)
          }
          if (hasOwn(body, 'currencyCode')) {
            data.currencyCode = normalizeCurrencyCode(body.currencyCode)
          }
          if (hasOwn(body, 'stockQuantity')) {
            data.stockQuantity = normalizeStockQuantity(body.stockQuantity)
          }
          if (hasOwn(body, 'maxPerOrder')) {
            data.maxPerOrder = normalizeMaxPerOrder(body.maxPerOrder)
          }
          if (hasOwn(body, 'sortOrder')) {
            data.sortOrder = normalizeSortOrder(body.sortOrder)
          }
          if (hasOwn(body, 'isActive')) {
            data.isActive = Boolean(body.isActive)
          }
          if (hasOwn(body, 'imageUrl')) {
            data.imageUrl = normalizeImageUrl(body.imageUrl)
          }

          const imageProvided = hasOwn(body, 'image')
          let imagePayload: ParsedShopImage | null = null
          if (imageProvided) {
            imagePayload = decodeShopImagePayload(body.image, false)
            if (imagePayload) {
              data.imageData = imagePayload.buffer
              data.imageMime = imagePayload.mimeType
              data.imageWidth = imagePayload.width
              data.imageHeight = imagePayload.height
              data.imageSize = imagePayload.size
            } else {
              data.imageData = null
              data.imageMime = null
              data.imageWidth = null
              data.imageHeight = null
              data.imageSize = null
            }
          }

          const updated = await prisma.shopItem.update({
            where: { id: itemId },
            data,
          })

          await invalidateCatalogCache()

          return reply.send({ ok: true, data: serializeItem(updated) })
        } catch (err) {
          if (err instanceof ShopAdminError) {
            return reply.status(err.status).send({ ok: false, error: err.message })
          }
          if (err instanceof Prisma.PrismaClientKnownRequestError) {
            if (err.code === 'P2002') {
              return reply.status(409).send({ ok: false, error: 'shop_slug_taken' })
            }
            if (err.code === 'P2025') {
              return reply.status(404).send({ ok: false, error: 'shop_item_not_found' })
            }
          }
          request.log.error({ err }, 'shop item update failed')
          return reply.status(500).send({ ok: false, error: 'shop_item_update_failed' })
        }
      })

      admin.patch('/items/:itemId/status', async (request, reply) => {
        const itemId = Number((request.params as { itemId?: string }).itemId)
        if (!Number.isInteger(itemId) || itemId <= 0) {
          return reply.status(400).send({ ok: false, error: 'shop_item_invalid' })
        }
        const { isActive } = (request.body ?? {}) as { isActive?: boolean }
        if (typeof isActive !== 'boolean') {
          return reply.status(400).send({ ok: false, error: 'shop_status_invalid' })
        }
        try {
          const updated = await prisma.shopItem.update({
            where: { id: itemId },
            data: { isActive },
          })
          await invalidateCatalogCache()
          return reply.send({ ok: true, data: serializeItem(updated) })
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
            return reply.status(404).send({ ok: false, error: 'shop_item_not_found' })
          }
          request.log.error({ err }, 'shop item status update failed')
          return reply.status(500).send({ ok: false, error: 'shop_item_update_failed' })
        }
      })

      admin.delete('/items/:itemId', async (request, reply) => {
        const itemId = Number((request.params as { itemId?: string }).itemId)
        if (!Number.isInteger(itemId) || itemId <= 0) {
          return reply.status(400).send({ ok: false, error: 'shop_item_invalid' })
        }
        try {
          await prisma.shopItem.delete({ where: { id: itemId } })
          await invalidateCatalogCache()
          return reply.send({ ok: true })
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError) {
            if (err.code === 'P2025') {
              return reply.status(404).send({ ok: false, error: 'shop_item_not_found' })
            }
            if (err.code === 'P2003') {
              return reply.status(409).send({ ok: false, error: 'shop_item_in_use' })
            }
          }
          request.log.error({ err }, 'shop item delete failed')
          return reply.status(500).send({ ok: false, error: 'shop_item_delete_failed' })
        }
      })

      admin.get('/orders', async (request, reply) => {
        const query = (request.query ?? {}) as {
          status?: string
          search?: string
          limit?: string
          cursor?: string
        }
        let statusFilter: ShopOrderStatus | undefined
        try {
          const parsedStatus = parseOrderStatus(query.status)
          if (parsedStatus) {
            statusFilter = parsedStatus
          }
        } catch (err) {
          if (err instanceof ShopAdminError) {
            return reply.status(err.status).send({ ok: false, error: err.message })
          }
        }

        const limitValue = Number(query.limit)
        const take = Number.isInteger(limitValue) ? Math.min(Math.max(limitValue, 1), 50) : 25

        let cursorId: bigint | undefined
        if (query.cursor) {
          try {
            cursorId = BigInt(query.cursor)
          } catch (err) {
            return reply.status(400).send({ ok: false, error: 'shop_cursor_invalid' })
          }
        }

        const where: Prisma.ShopOrderWhereInput = {}
        if (statusFilter) {
          where.status = statusFilter
        }
        const searchTerm = typeof query.search === 'string' ? query.search.trim() : ''
        if (searchTerm) {
          const filters: Prisma.ShopOrderWhereInput[] = [
            { orderNumber: { contains: searchTerm, mode: 'insensitive' } },
            { username: { contains: searchTerm, mode: 'insensitive' } },
            { firstName: { contains: searchTerm, mode: 'insensitive' } },
          ]
          if (/^\d+$/.test(searchTerm)) {
            try {
              const tg = BigInt(searchTerm)
              filters.push({ telegramId: tg })
            } catch (err) {
              // ignore
            }
          }
          where.OR = filters
        }

        const orders = await prisma.shopOrder.findMany({
          where,
          include: { items: true },
          orderBy: { createdAt: 'desc' },
          take: take + 1,
          ...(cursorId
            ? {
                cursor: { id: cursorId },
                skip: 1,
              }
            : {}),
        })

        const hasMore = orders.length > take
        const slice = hasMore ? orders.slice(0, take) : orders
        const nextCursor = hasMore ? slice[slice.length - 1].id.toString() : null

        return reply.send({
          ok: true,
          data: slice.map(serializeShopOrderView),
          meta: { nextCursor },
        })
      })

      admin.get('/orders/:orderId', async (request, reply) => {
        const orderIdParam = (request.params as { orderId?: string }).orderId
        let orderId: bigint
        try {
          orderId = BigInt(orderIdParam ?? '')
        } catch (err) {
          return reply.status(400).send({ ok: false, error: 'shop_order_invalid' })
        }
        const order = await prisma.shopOrder.findUnique({
          where: { id: orderId },
          include: { items: true },
        })
        if (!order) {
          return reply.status(404).send({ ok: false, error: 'shop_order_not_found' })
        }
        return reply.send({ ok: true, data: serializeShopOrderView(order) })
      })

      admin.patch('/orders/:orderId', async (request, reply) => {
        const orderIdParam = (request.params as { orderId?: string }).orderId
        let orderId: bigint
        try {
          orderId = BigInt(orderIdParam ?? '')
        } catch (err) {
          return reply.status(400).send({ ok: false, error: 'shop_order_invalid' })
        }

        const body = (request.body ?? {}) as Record<string, unknown>
        const statusProvided = hasOwn(body, 'status')
        const noteProvided = hasOwn(body, 'customerNote')
        const confirmedByProvided = hasOwn(body, 'confirmedBy')

        if (!statusProvided && !noteProvided && !confirmedByProvided) {
          return reply.status(400).send({ ok: false, error: 'shop_update_empty' })
        }

        let nextStatus: ShopOrderStatus | null = null
        try {
          if (statusProvided) {
            nextStatus = parseOrderStatus(body.status)
            if (!nextStatus) {
              throw new ShopAdminError('shop_status_invalid')
            }
            if (nextStatus === ShopOrderStatus.PENDING) {
              throw new ShopAdminError('shop_status_invalid')
            }
          }
        } catch (err) {
          if (err instanceof ShopAdminError) {
            return reply.status(err.status).send({ ok: false, error: err.message })
          }
        }

        let nextNote: string | null | undefined
        if (noteProvided) {
          try {
            nextNote = normalizeCustomerNote(body.customerNote)
          } catch (err) {
            if (err instanceof ShopAdminError) {
              return reply.status(err.status).send({ ok: false, error: err.message })
            }
          }
        }

        let nextConfirmedBy: string | null | undefined
        if (confirmedByProvided) {
          try {
            nextConfirmedBy = normalizeConfirmedBy(body.confirmedBy)
          } catch (err) {
            if (err instanceof ShopAdminError) {
              return reply.status(err.status).send({ ok: false, error: err.message })
            }
          }
        }

        try {
          const result = await prisma.$transaction(async tx => {
            const existing = await tx.shopOrder.findUnique({
              where: { id: orderId },
              include: {
                items: {
                  include: {
                    item: true,
                  },
                },
              },
            })
            if (!existing) {
              throw new ShopAdminError('shop_order_not_found', 404)
            }

            const updateData: Prisma.ShopOrderUpdateInput = {}
            let changedStatus = false

            if (nextStatus) {
              if (existing.status !== ShopOrderStatus.PENDING) {
                throw new ShopAdminError('shop_order_locked', 409)
              }
              if (existing.status !== nextStatus) {
                changedStatus = true
                updateData.status = nextStatus
                updateData.confirmedAt =
                  nextStatus === ShopOrderStatus.CONFIRMED ? new Date() : null
                updateData.confirmedBy =
                  nextStatus === ShopOrderStatus.CONFIRMED
                    ? nextConfirmedBy ?? request.admin?.sub ?? 'admin'
                    : nextConfirmedBy ?? null
              }
            } else if (nextConfirmedBy !== undefined) {
              updateData.confirmedBy = nextConfirmedBy
            }

            if (nextNote !== undefined) {
              updateData.customerNote = nextNote
            }

            if (!Object.keys(updateData).length) {
              return { order: existing, restocked: false }
            }

            const updated = await tx.shopOrder.update({
              where: { id: orderId },
              data: updateData,
              include: { items: true },
            })

            if (changedStatus && nextStatus === ShopOrderStatus.CANCELLED) {
              for (const item of existing.items) {
                if (item.item?.stockQuantity !== null) {
                  await tx.shopItem.update({
                    where: { id: item.itemId },
                    data: {
                      stockQuantity: {
                        increment: item.quantity,
                      },
                    },
                  })
                }
              }
            }

            return { order: updated, restocked: changedStatus && nextStatus === ShopOrderStatus.CANCELLED }
          })

          if (result.restocked) {
            await invalidateCatalogCache()
          }
          if (nextStatus === ShopOrderStatus.CONFIRMED || nextStatus === ShopOrderStatus.CANCELLED) {
            await invalidateHistoryCache(result.order.telegramId)
          } else if (noteProvided) {
            await invalidateHistoryCache(result.order.telegramId)
          }

          return reply.send({ ok: true, data: serializeShopOrderView(result.order) })
        } catch (err) {
          if (err instanceof ShopAdminError) {
            return reply.status(err.status).send({ ok: false, error: err.message })
          }
          request.log.error({ err }, 'shop order update failed')
          return reply.status(500).send({ ok: false, error: 'shop_order_update_failed' })
        }
      })
    },
    { prefix: '/api/admin/shop' }
  )
}
