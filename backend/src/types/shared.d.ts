declare module '@shared/types' {
  export interface ShopItemImageView {
    mimeType: string | null
    width: number | null
    height: number | null
    size: number | null
    url?: string | null
    base64?: string | null
    fingerprint: string
    updatedAt: string
  }

  export interface ShopItemView {
    id: number
    slug?: string | null
    title: string
    subtitle?: string | null
    description?: string | null
    priceCents: number
    currencyCode: string
    stockQuantity?: number | null
    maxPerOrder: number
    sortOrder: number
    isActive: boolean
    image?: ShopItemImageView | null
    createdAt: string
    updatedAt: string
  }

  export type ShopOrderStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED'

  export interface ShopOrderItemView {
    itemId: number
    title: string
    subtitle?: string | null
    priceCents: number
    quantity: number
    imageUrl?: string | null
  }

  export interface ShopOrderUserView {
    userId?: number | null
    telegramId?: string | null
    username?: string | null
    firstName?: string | null
  }

  export interface ShopOrderView {
    id: string
    orderNumber: string
    status: ShopOrderStatus
    totalCents: number
    currencyCode: string
    customerNote?: string | null
    createdAt: string
    updatedAt: string
    confirmedAt?: string | null
    confirmedBy?: string | null
    items: ShopOrderItemView[]
    user?: ShopOrderUserView | null
  }
}
