import type { ShopItemView, ShopOrderView } from '@shared/types'
import { httpRequest } from './httpClient'

const SHOP_ITEMS_PATH = '/api/shop/items'
const SHOP_HISTORY_PATH = '/api/shop/orders/history'
const SHOP_ORDER_PATH = '/api/shop/orders'

export const fetchShopItems = (version?: string) =>
  httpRequest<ShopItemView[]>(SHOP_ITEMS_PATH, {
    version,
    credentials: 'include',
  })

export const fetchShopHistory = (version?: string) => {
  return httpRequest<ShopOrderView[]>(SHOP_HISTORY_PATH, {
    version,
    credentials: 'include',
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
  return httpRequest<ShopOrderView>(SHOP_ORDER_PATH, {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json',
    },
  })
}
