const CART_KEY = 'obnliga_shop_cart_v1'
const CONTACT_KEY = 'obnliga_shop_contact_v1'

export interface StoredCartEntry {
  itemId: number
  quantity: number
}

export type StoredCart = Record<number, StoredCartEntry>

export interface StoredContact {
  username?: string
  firstName?: string
}

const hasWindow = typeof window !== 'undefined'

export const readCartFromStorage = (): StoredCart => {
  if (!hasWindow) {
    return {}
  }
  try {
    const raw = window.localStorage.getItem(CART_KEY)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw) as StoredCart | unknown
    if (!parsed || typeof parsed !== 'object') {
      window.localStorage.removeItem(CART_KEY)
      return {}
    }
    const entries: StoredCart = {}
    Object.entries(parsed as Record<string, StoredCartEntry>).forEach(([key, value]) => {
      if (!value || typeof value !== 'object') {
        return
      }
      const itemId = Number((value as StoredCartEntry).itemId)
      const quantity = Number((value as StoredCartEntry).quantity)
      if (!Number.isInteger(itemId) || itemId <= 0 || !Number.isInteger(quantity) || quantity <= 0) {
        return
      }
      entries[itemId] = { itemId, quantity }
    })
    return entries
  } catch {
    return {}
  }
}

export const writeCartToStorage = (cart: StoredCart): void => {
  if (!hasWindow) {
    return
  }
  try {
    window.localStorage.setItem(CART_KEY, JSON.stringify(cart))
  } catch (err) {
    console.warn('shopCart: failed to persist cart', err)
  }
}

export const readContactFromStorage = (): StoredContact => {
  if (!hasWindow) {
    return {}
  }
  try {
    const raw = window.localStorage.getItem(CONTACT_KEY)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw) as StoredContact | unknown
    if (!parsed || typeof parsed !== 'object') {
      window.localStorage.removeItem(CONTACT_KEY)
      return {}
    }
    const contact = parsed as StoredContact
    return {
      username: typeof contact.username === 'string' ? contact.username : undefined,
      firstName: typeof contact.firstName === 'string' ? contact.firstName : undefined,
    }
  } catch {
    return {}
  }
}

export const writeContactToStorage = (contact: StoredContact): void => {
  if (!hasWindow) {
    return
  }
  try {
    window.localStorage.setItem(CONTACT_KEY, JSON.stringify(contact))
  } catch (err) {
    console.warn('shopCart: failed to persist contact', err)
  }
}
