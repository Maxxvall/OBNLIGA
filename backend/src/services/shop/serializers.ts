import type { ShopItem, ShopOrder, ShopOrderItem } from '@prisma/client'
import type { ShopItemView, ShopOrderView } from '@shared/types'
import { createHash } from 'crypto'

export type ShopItemWithImage = ShopItem & {
  imageData: Buffer | null
}

export type ShopOrderWithItems = ShopOrder & {
  items: ShopOrderItem[]
}

const toBase64 = (value?: Buffer | null): string | null => {
  if (!value) {
    return null
  }
  return value.toString('base64')
}

const buildImageFingerprint = (image: Buffer | null, updatedAt: Date): string => {
  const hash = createHash('sha1')
  if (image) {
    hash.update(image)
  }
  hash.update(updatedAt.toISOString())
  return hash.digest('hex')
}

export const serializeShopItemView = (item: ShopItemWithImage): ShopItemView => {
  const imageBase64 = toBase64(item.imageData)
  const image =
    imageBase64 || item.imageUrl
      ? {
          mimeType: item.imageMime,
          width: item.imageWidth,
          height: item.imageHeight,
          size: item.imageSize,
          url: item.imageUrl ?? undefined,
          base64: imageBase64 ?? undefined,
          fingerprint: buildImageFingerprint(item.imageData ?? null, item.updatedAt),
          updatedAt: item.updatedAt.toISOString(),
        }
      : null

  return {
    id: item.id,
    slug: item.slug,
    title: item.title,
    subtitle: item.subtitle,
    description: item.description,
    priceCents: item.priceCents,
    currencyCode: item.currencyCode,
    stockQuantity: item.stockQuantity,
    maxPerOrder: item.maxPerOrder,
    sortOrder: item.sortOrder,
    isActive: item.isActive,
    image,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  }
}

export const serializeShopOrderView = (order: ShopOrderWithItems): ShopOrderView => {
  return {
    id: order.id.toString(),
    orderNumber: order.orderNumber,
    status: order.status,
    totalCents: order.totalCents,
    currencyCode: order.currencyCode,
    customerNote: order.customerNote,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    confirmedAt: order.confirmedAt?.toISOString(),
    confirmedBy: order.confirmedBy ?? undefined,
    items: order.items.map(item => ({
      itemId: item.itemId,
      title: item.title,
      subtitle: item.subtitle ?? undefined,
      priceCents: item.priceCents,
      quantity: item.quantity,
      imageUrl: item.imageUrl ?? undefined,
    })),
    user:
      order.userId || order.telegramId
        ? {
            userId: order.userId ?? undefined,
            telegramId: order.telegramId ? order.telegramId.toString() : undefined,
            username: order.username ?? undefined,
            firstName: order.firstName ?? undefined,
          }
        : order.username || order.firstName
          ? {
              username: order.username ?? undefined,
              firstName: order.firstName ?? undefined,
            }
          : undefined,
  }
}
