import type { ShopItemView, ShopOrderView } from '@shared/types'
import { httpRequest } from './httpClient'

const SHOP_ITEMS_PATH = '/api/shop/items'
const SHOP_HISTORY_PATH = '/api/shop/orders/history'
const SHOP_ORDER_PATH = '/api/shop/orders'

const readSessionToken = (): string | undefined => {
  if (typeof window === 'undefined') {
    return undefined
  }
  return window.localStorage.getItem('session') ?? undefined
}

export const fetchShopItems = (version?: string) =>
  httpRequest<ShopItemView[]>(SHOP_ITEMS_PATH, {
    version,
    credentials: 'include',
  })

export const fetchShopHistory = (version?: string) => {
  const token = readSessionToken()
  return httpRequest<ShopOrderView[]>(SHOP_HISTORY_PATH, {
    version,
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
}

export type CreateShopOrderPayload = {
  items: Array<{ itemId: number; quantity: number }>
  contact?: {
    username?: string
    firstName?: string
  }
  customerNote?: string
}

export const createShopOrder = (payload: CreateShopOrderPayload) => {
  const token = readSessionToken()
  return httpRequest<ShopOrderView>(SHOP_ORDER_PATH, {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
}
