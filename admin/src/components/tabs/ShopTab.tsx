import React, { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react'
import {
  adminCreateShopItem,
  adminDeleteShopItem,
  adminSetShopItemStatus,
  adminUpdateShopItem,
  adminUpdateShopOrder,
  type AdminShopImagePayload,
} from '../../api/adminClient'
import { useAdminStore } from '../../store/adminStore'
import type { ShopItemView, ShopOrderStatus, ShopOrderView } from '@shared/types'
import { formatDateTime } from '../../utils/date'

type FeedbackState = {
  kind: 'success' | 'error'
  message: string
  meta?: string
} | null

type ItemFormState = {
  title: string
  subtitle: string
  description: string
  price: string
  stockQuantity: string
  maxPerOrder: string
  sortOrder: string
  isActive: boolean
  imagePayload?: AdminShopImagePayload | null
  imageChanged: boolean
  imageUrl: string
}

const ADMIN_SHOP_CURRENCY = 'RUB'

const ORDER_STATUS_LABELS: Record<ShopOrderStatus, string> = {
  PENDING: 'Ожидает',
  CONFIRMED: 'Подтверждён',
  CANCELLED: 'Отменён',
}

const DEFAULT_ITEM_FORM = (): ItemFormState => ({
  title: '',
  subtitle: '',
  description: '',
  price: '',
  stockQuantity: '',
  maxPerOrder: '3',
  sortOrder: '100',
  isActive: true,
  imagePayload: undefined,
  imageChanged: false,
  imageUrl: '',
})

const formatPriceInput = (priceCents: number): string => {
  const value = priceCents / 100
  return value % 1 === 0 ? value.toFixed(0) : value.toFixed(2)
}

const formatMoney = (cents: number, currency: string): string => {
  try {
    const value = cents / 100
    const options: Intl.NumberFormatOptions = {
      style: 'currency',
      currency,
    }
    // if whole rubles (no kopeks) — show without decimals
    if (cents % 100 === 0) {
      options.maximumFractionDigits = 0
    } else {
      options.maximumFractionDigits = 2
    }
    return new Intl.NumberFormat('ru-RU', options).format(value)
  } catch (err) {
    return cents % 100 === 0 ? `${cents / 100} ${currency}` : `${(cents / 100).toFixed(2)} ${currency}`
  }
}

// Inline SVG icons
const IconEdit = ({ width = 16, height = 16 }: { width?: number; height?: number }) => (
  <svg width={width} height={height} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const IconTrash = ({ width = 14, height = 14 }: { width?: number; height?: number }) => (
  <svg width={width} height={height} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 6h18" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <path d="M8 6v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const IconEye = ({ width = 16, height = 16 }: { width?: number; height?: number }) => (
  <svg width={width} height={height} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.2" />
  </svg>
)

const IconEyeOff = ({ width = 16, height = 16 }: { width?: number; height?: number }) => (
  <svg width={width} height={height} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-6 0-10-7-10-7a20.1 20.1 0 0 1 5-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M1 1l22 22" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const readImageFile = (file: File): Promise<{ preview: string; payload: AdminShopImagePayload }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Не удалось прочитать файл изображения'))
    reader.onload = () => {
      const dataUrl = reader.result as string
      const image = new Image()
      image.onload = () => {
        const base64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl
        resolve({
          preview: dataUrl,
          payload: {
            mimeType: file.type || 'image/png',
            base64,
            width: image.width,
            height: image.height,
            size: file.size,
          },
        })
      }
      image.onerror = () => reject(new Error('Не удалось определить размеры изображения'))
      image.src = dataUrl
    }
    reader.readAsDataURL(file)
  })
}

const filterItems = (items: ShopItemView[]): ShopItemView[] => {
  return [...items].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder
    }
    return left.id - right.id
  })
}

const sortOrders = (orders: ShopOrderView[]): ShopOrderView[] =>
  [...orders].sort((left, right) => right.createdAt.localeCompare(left.createdAt))

export const ShopTab = () => {
  const {
    token,
    data,
    loading,
    fetchShopItems,
    fetchShopOrders,
    loadMoreShopOrders,
    setShopOrderStatusFilter,
    setShopOrderSearch,
    shopOrderStatusFilter,
    shopOrderSearch,
    shopOrdersHasMore,
    upsertShopItem,
    removeShopItem,
    upsertShopOrder,
  } = useAdminStore(state => ({
    token: state.token,
    data: state.data,
    loading: state.loading,
    fetchShopItems: state.fetchShopItems,
    fetchShopOrders: state.fetchShopOrders,
    loadMoreShopOrders: state.loadMoreShopOrders,
    setShopOrderStatusFilter: state.setShopOrderStatusFilter,
    setShopOrderSearch: state.setShopOrderSearch,
    shopOrderStatusFilter: state.shopOrderStatusFilter,
    shopOrderSearch: state.shopOrderSearch,
    shopOrdersHasMore: state.shopOrdersHasMore,
    upsertShopItem: state.upsertShopItem,
    removeShopItem: state.removeShopItem,
    upsertShopOrder: state.upsertShopOrder,
  }))

  const [itemForm, setItemForm] = useState<ItemFormState>(DEFAULT_ITEM_FORM)
  const [editingItemId, setEditingItemId] = useState<number | null>(null)
  const [itemImagePreview, setItemImagePreview] = useState<string | null>(null)
  const [formFeedback, setFormFeedback] = useState<FeedbackState>(null)
  const [itemSaving, setItemSaving] = useState(false)
  const [itemStatusPendingId, setItemStatusPendingId] = useState<number | null>(null)
  const [itemDeletePendingId, setItemDeletePendingId] = useState<number | null>(null)
  const [orderNotes, setOrderNotes] = useState<Record<string, string>>({})
  const [orderFeedback, setOrderFeedback] = useState<Record<string, FeedbackState>>({})
  const [orderSearchDraft, setOrderSearchDraft] = useState(shopOrderSearch ?? '')
  const [orderActionPending, setOrderActionPending] = useState<Record<string, boolean>>({})
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null)

  const items = useMemo(() => filterItems(data.shopItems), [data.shopItems])
  const orders = useMemo(() => sortOrders(data.shopOrders), [data.shopOrders])
  const loadingItems = Boolean(loading.shopItems)
  const loadingOrders = Boolean(loading.shopOrders)
  const activeItemsCount = items.filter(item => item.isActive).length
  const pendingOrdersCount = orders.filter(order => order.status === 'PENDING').length

  useEffect(() => {
    setOrderNotes(
      orders.reduce<Record<string, string>>((acc, order) => {
        acc[order.id] = order.customerNote ?? ''
        return acc
      }, {})
    )
  }, [orders])

  useEffect(() => {
    setOrderSearchDraft(shopOrderSearch ?? '')
  }, [shopOrderSearch])

  useEffect(() => {
    if (!token) {
      return
    }
    if (!data.shopItems.length) {
      void fetchShopItems({ includeInactive: true, force: true }).catch(() => undefined)
    }
    if (!data.shopOrders.length) {
      void fetchShopOrders({ force: true }).catch(() => undefined)
    }
  }, [token, data.shopItems.length, data.shopOrders.length, fetchShopItems, fetchShopOrders])

  const resetItemForm = () => {
    setItemForm(DEFAULT_ITEM_FORM())
    setEditingItemId(null)
    setItemImagePreview(null)
    setFormFeedback(null)
  }

  const handleItemField = (field: keyof ItemFormState) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const value = event.target.value
      setItemForm(state => ({ ...state, [field]: value }))
    }

  const handleItemImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }
    try {
      const { payload } = await readImageFile(file)
      setItemForm(state => ({ ...state, imagePayload: payload, imageChanged: true }))
      setFormFeedback(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось обработать изображение.'
      setFormFeedback({ kind: 'error', message })
    } finally {
      event.target.value = ''
    }
  }

  const handleClearImage = () => {
    setItemForm(state => ({ ...state, imagePayload: null, imageChanged: true, imageUrl: '' }))
    setItemImagePreview(null)
  }

  const pickItemForEdit = (item: ShopItemView) => {
    setEditingItemId(item.id)
    setItemForm({
      title: item.title,
      subtitle: item.subtitle ?? '',
      description: item.description ?? '',
      price: formatPriceInput(item.priceCents),
      stockQuantity: item.stockQuantity === null || item.stockQuantity === undefined ? '' : String(item.stockQuantity),
      maxPerOrder: String(item.maxPerOrder),
      sortOrder: String(item.sortOrder),
      isActive: item.isActive,
      imagePayload: undefined,
      imageChanged: false,
      imageUrl: item.image?.url ?? '',
    })
    // do not preload/preview full image here — admin uses image path only
    setItemImagePreview(null)
    setFormFeedback(null)
  }

  const normalizePrice = (value: string): number | null => {
    const normalized = Number(value.replace(',', '.'))
    if (!Number.isFinite(normalized) || normalized <= 0) {
      return null
    }
    return Math.round(normalized * 100)
  }

  const parseInteger = (value: string): number | null => {
    if (!value.trim()) {
      return null
    }
    const parsed = Number(value)
    if (!Number.isInteger(parsed)) {
      return null
    }
    return parsed
  }

  type ItemPayloadResult =
    | { kind: 'create'; payload: Parameters<typeof adminCreateShopItem>[1] }
    | { kind: 'update'; itemId: number; payload: Parameters<typeof adminUpdateShopItem>[2] }

  const buildItemPayload = (): ItemPayloadResult | null => {
    const title = itemForm.title.trim()
    if (!title) {
      setFormFeedback({ kind: 'error', message: 'Введите название товара.' })
      return null
    }
    const priceCents = normalizePrice(itemForm.price)
    if (priceCents === null) {
      setFormFeedback({ kind: 'error', message: 'Введите корректную цену (например, 499 или 499.99).' })
      return null
    }
    const maxPerOrder = parseInteger(itemForm.maxPerOrder)
    if (maxPerOrder === null || maxPerOrder <= 0) {
      setFormFeedback({ kind: 'error', message: 'Лимит на заказ должен быть положительным числом.' })
      return null
    }
    const sortOrder = parseInteger(itemForm.sortOrder) ?? 100
    const stockQuantity = parseInteger(itemForm.stockQuantity)
    const payloadBase = {
      title,
      subtitle: itemForm.subtitle.trim() || null,
      description: itemForm.description.trim() || null,
      priceCents,
      currencyCode: ADMIN_SHOP_CURRENCY,
      stockQuantity: stockQuantity ?? null,
      maxPerOrder,
      sortOrder,
      isActive: itemForm.isActive,
      imageUrl: itemForm.imageUrl.trim() || undefined,
    }

    if (editingItemId) {
      const updatePayload: Parameters<typeof adminUpdateShopItem>[2] = {
        ...payloadBase,
      }
      if (itemForm.imageChanged) {
        updatePayload.image = itemForm.imagePayload ?? null
      }
      return { kind: 'update', itemId: editingItemId, payload: updatePayload }
    }

    const createPayload: Parameters<typeof adminCreateShopItem>[1] = {
      ...payloadBase,
      image: itemForm.imagePayload,
    }
    return { kind: 'create', payload: createPayload }
  }

  const handleItemSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!token) {
      setFormFeedback({ kind: 'error', message: 'Сессия истекла. Войдите заново.' })
      return
    }
    const source = buildItemPayload()
    if (!source) {
      return
    }
    setItemSaving(true)
    try {
      if (source.kind === 'create') {
        const created = await adminCreateShopItem(token, source.payload)
        upsertShopItem(created)
        resetItemForm()
        setFormFeedback({ kind: 'success', message: 'Товар добавлен в каталог.' })
      } else {
        const updated = await adminUpdateShopItem(token, source.itemId, source.payload)
        upsertShopItem(updated)
        setFormFeedback({ kind: 'success', message: 'Товар обновлён.' })
        setEditingItemId(updated.id)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось сохранить изменения.'
      setFormFeedback({ kind: 'error', message })
    } finally {
      setItemSaving(false)
    }
  }

  const handleToggleItemStatus = async (item: ShopItemView) => {
    if (!token) {
      setFormFeedback({ kind: 'error', message: 'Сессия истекла. Войдите заново.' })
      return
    }
    setItemStatusPendingId(item.id)
    try {
      const updated = await adminSetShopItemStatus(token, item.id, !item.isActive)
      upsertShopItem(updated)
      if (editingItemId === item.id) {
        setItemForm(state => ({ ...state, isActive: updated.isActive }))
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось обновить статус товара.'
      setFormFeedback({ kind: 'error', message })
    } finally {
      setItemStatusPendingId(null)
    }
  }

  const handleDeleteItem = async (item: ShopItemView) => {
    if (!token) {
      setFormFeedback({ kind: 'error', message: 'Сессия истекла. Войдите заново.' })
      return
    }
    const confirmed = typeof window === 'undefined' ? true : window.confirm('Удалить товар без возможности восстановления?')
    if (!confirmed) {
      return
    }
    setItemDeletePendingId(item.id)
    try {
      await adminDeleteShopItem(token, item.id)
      removeShopItem(item.id)
      if (editingItemId === item.id) {
        resetItemForm()
      }
      setFormFeedback({ kind: 'success', message: 'Товар удалён.' })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось удалить товар.'
      setFormFeedback({ kind: 'error', message })
    } finally {
      setItemDeletePendingId(null)
    }
  }

  const handleOrdersRefresh = () => {
    void fetchShopOrders({ force: true, cursor: null }).catch(() => undefined)
  }

  const handleItemsRefresh = () => {
    void fetchShopItems({ force: true, includeInactive: true }).catch(() => undefined)
  }

  const handleStatusFilterChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value as ShopOrderStatus | 'ALL'
    void setShopOrderStatusFilter(value).catch(() => undefined)
  }

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void setShopOrderSearch(orderSearchDraft).catch(() => undefined)
  }

  const setOrderPending = (orderId: string, value: boolean) => {
    setOrderActionPending(state => ({ ...state, [orderId]: value }))
  }

  const setOrderFeedbackFor = (orderId: string, feedback: FeedbackState) => {
    setOrderFeedback(state => ({ ...state, [orderId]: feedback }))
  }

  const handleOrderStatusUpdate = async (order: ShopOrderView, status: ShopOrderStatus) => {
    if (!token) {
      setOrderFeedbackFor(order.id, { kind: 'error', message: 'Сессия истекла. Войдите заново.' })
      return
    }
    setOrderPending(order.id, true)
    setOrderFeedbackFor(order.id, null)
    try {
      const updated = await adminUpdateShopOrder(token, order.id, { status })
      upsertShopOrder(updated)
      setOrderFeedbackFor(order.id, {
        kind: 'success',
        message: status === 'CONFIRMED' ? 'Заказ подтверждён.' : 'Заказ отменён.',
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось обновить заказ.'
      setOrderFeedbackFor(order.id, { kind: 'error', message })
    } finally {
      setOrderPending(order.id, false)
    }
  }

  const handleOrderNoteSave = async (order: ShopOrderView) => {
    if (!token) {
      setOrderFeedbackFor(order.id, { kind: 'error', message: 'Сессия истекла. Войдите заново.' })
      return
    }
    setOrderPending(order.id, true)
    setOrderFeedbackFor(order.id, null)
    try {
      const updated = await adminUpdateShopOrder(token, order.id, {
        customerNote: orderNotes[order.id] ?? '',
      })
      upsertShopOrder(updated)
      setOrderFeedbackFor(order.id, { kind: 'success', message: 'Комментарий сохранён.' })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось сохранить комментарий.'
      setOrderFeedbackFor(order.id, { kind: 'error', message })
    } finally {
      setOrderPending(order.id, false)
    }
  }

  const renderOrderItems = (order: ShopOrderView) => (
    <ul className="shop-order-items" key={`items-${order.id}`}>
      {order.items.map(item => (
        <li key={`${order.id}-${item.itemId}`}>
          <div>
            <strong>{item.title}</strong>
            {item.subtitle ? <span className="shop-order-item-subtitle">{item.subtitle}</span> : null}
          </div>
          <span className="shop-order-item-qty">× {item.quantity}</span>
          <span className="shop-order-item-price">{formatMoney(item.priceCents, order.currencyCode)}</span>
        </li>
      ))}
    </ul>
  )

  const renderOrderUser = (order: ShopOrderView) => {
    if (!order.user) {
      return 'Анонимный пользователь'
    }
    const parts: string[] = []
    if (order.user.firstName) {
      parts.push(order.user.firstName)
    }
    // username may contain leading @ signs in some records — normalize and don't show @
    const rawUsername = order.user.username ? String(order.user.username) : ''
    const username = rawUsername.replace(/^@+/, '')
    if (username) {
      parts.push(username)
    }
    return parts.join(' • ')
  }

  return (
    <div className="tab-sections">
      <header className="tab-header">
        <div>
          <h3>Магазин лиги</h3>
          <p>
            Управляйте каталогом и оперативно обрабатывайте заказы пользователей.
          </p>
        </div>
        <div className="tab-header-actions">
          <button type="button" className="button-ghost" onClick={handleItemsRefresh} disabled={loadingItems}>
            {loadingItems ? 'Обновляем…' : 'Обновить каталог'}
          </button>
          <button type="button" className="button-ghost" onClick={handleOrdersRefresh} disabled={loadingOrders}>
            {loadingOrders ? 'Обновляем…' : 'Обновить заказы'}
          </button>
        </div>
      </header>

      <div className="card-grid-2col">
        <article className="card">
          <header>
            <h4>Новый товар</h4>
            <p>{editingItemId ? 'Отредактируйте товар и сохраните.' : 'Заполните карточку и добавьте в каталог.'}</p>
          </header>
          {formFeedback ? (
          <div className={`inline-feedback ${formFeedback.kind}`}>
            <div>
              <strong>{formFeedback.message}</strong>
              {formFeedback.meta ? <span className="feedback-meta">{formFeedback.meta}</span> : null}
            </div>
            <button type="button" className="feedback-close" onClick={() => setFormFeedback(null)}>
              ×
            </button>
          </div>
        ) : null}
        <form className="stacked" onSubmit={handleItemSubmit}>
          <label>
            Название
            <input value={itemForm.title} onChange={handleItemField('title')} required maxLength={80} placeholder="Например, Фирменный шарф" />
          </label>
          <label>
            Подзаголовок
            <input value={itemForm.subtitle} onChange={handleItemField('subtitle')} maxLength={160} placeholder="В 1-2 словах" />
          </label>
          <label>
            Цена
            <input value={itemForm.price} onChange={handleItemField('price')} inputMode="decimal" placeholder="499 или 499.99" />
          </label>
          <label>
            Остаток
            <input value={itemForm.stockQuantity} onChange={handleItemField('stockQuantity')} inputMode="numeric" placeholder="Пусто = безлимит" />
          </label>
          <label>
            Лимит на заказ
            <input value={itemForm.maxPerOrder} onChange={handleItemField('maxPerOrder')} inputMode="numeric" />
          </label>
          <label>
            Порядок сортировки
            <input value={itemForm.sortOrder} onChange={handleItemField('sortOrder')} inputMode="numeric" />
          </label>
          <label>
            Ссылка на изображение (опционально)
            <input value={itemForm.imageUrl} onChange={handleItemField('imageUrl')} placeholder="https://" />
          </label>
          <label>
            Описание
            <textarea rows={4} value={itemForm.description} onChange={handleItemField('description')} placeholder="Подробности о товаре" />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={itemForm.isActive} onChange={event => setItemForm(state => ({ ...state, isActive: event.target.checked }))} />
            <span>Показывать в витрине</span>
          </label>
          <div className="shop-image-upload">
            <div>
              <label className="button-secondary" htmlFor="shop-image-input">
                Выбрать файл
              </label>
              <input id="shop-image-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleItemImage} />
              {(itemForm.imageUrl || itemForm.imagePayload) ? (
                <button type="button" className="button-ghost" onClick={handleClearImage}>
                  Сбросить изображение
                </button>
              ) : null}
            </div>
            {itemForm.imageUrl ? (
              <div className="shop-image-path">
                <a href={itemForm.imageUrl} target="_blank" rel="noreferrer">Открыть изображение</a>
              </div>
            ) : null}
          </div>
          <div className="form-actions">
            <button className="button-primary" type="submit" disabled={itemSaving}>
              {itemSaving ? 'Сохраняем…' : editingItemId ? 'Сохранить изменения' : 'Добавить товар'}
            </button>
            {editingItemId ? (
              <button type="button" className="button-secondary" onClick={resetItemForm} disabled={itemSaving}>
                Сбросить форму
              </button>
            ) : null}
          </div>
        </form>
      </article>

      <article className="card">
        <header>
          <h4>Каталог</h4>
          <p>Быстрые действия: активируйте, редактируйте или удаляйте товары.</p>
        </header>
        <div className="shop-metrics">
          <span className="status-chip success">Всего: {items.length}</span>
          <span className="status-chip success">Активных: {activeItemsCount}</span>
          <span className={`status-chip ${pendingOrdersCount ? 'pending' : 'muted'}`}>
            {pendingOrdersCount ? `${pendingOrdersCount} ожидают` : 'Нет новых'}
          </span>
        </div>
        {items.length ? (
          <div className="shop-items-table-wrapper">
            <table className="shop-items-table">
              <thead>
                <tr>
                  <th scope="col">Товар</th>
                  <th scope="col">Статус</th>
                  <th scope="col">Цена</th>
                  <th scope="col">Лимит / сортировка</th>
                  <th scope="col">Остаток</th>
                  <th scope="col">Действия</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.title}</strong>
                    </td>
                    <td>
                      <span className={`status-chip ${item.isActive ? 'success' : 'muted'}`} title={item.isActive ? 'Показывается в витрине' : 'Скрыт'}>
                        {item.isActive ? <IconEye /> : <IconEyeOff />}
                      </span>
                    </td>
                    <td>{formatMoney(item.priceCents, item.currencyCode)}</td>
                    <td>
                      <span>{(item.maxPerOrder ?? 0) + '/' + (item.sortOrder ?? 0)}</span>
                    </td>
                    <td>
                      {item.stockQuantity === null || item.stockQuantity === undefined
                        ? 'безлимит'
                        : item.stockQuantity}
                    </td>
                    <td>
                      <div className="shop-item-actions">
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Редактировать"
                          title="Редактировать"
                          onClick={() => pickItemForEdit(item)}
                        >
                          <IconEdit />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={item.isActive ? 'Скрыть' : 'Показать'}
                          title={item.isActive ? 'Скрыть товар' : 'Показать товар'}
                          onClick={() => handleToggleItemStatus(item)}
                          disabled={itemStatusPendingId === item.id}
                        >
                          {itemStatusPendingId === item.id ? '…' : item.isActive ? <IconEyeOff /> : <IconEye />}
                        </button>
                        <button
                          type="button"
                          className="icon-button danger"
                          aria-label="Удалить"
                          title="Удалить"
                          onClick={() => handleDeleteItem(item)}
                          disabled={itemDeletePendingId === item.id}
                        >
                          {itemDeletePendingId === item.id ? '…' : <IconTrash />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>Каталог пока пуст.</p>
        )}
      </article>

      <article className="card card-fullwidth">
        <header className="shop-orders-header">
          <div>
            <h4>Заказы пользователей</h4>
            <p>Обрабатывайте заказы, оставляйте комментарии и подтверждайте оплату.</p>
          </div>
          <form className="shop-order-filters" onSubmit={handleSearchSubmit}>
            <select value={shopOrderStatusFilter} onChange={handleStatusFilterChange}>
              <option value="ALL">Все статусы</option>
              <option value="PENDING">Только ожидают</option>
              <option value="CONFIRMED">Подтверждённые</option>
              <option value="CANCELLED">Отменённые</option>
            </select>
            <input
              type="search"
              placeholder="Поиск по номеру или юзеру"
              value={orderSearchDraft}
              onChange={event => setOrderSearchDraft(event.target.value)}
            />
            <button type="submit" className="button-secondary">
              Найти
            </button>
            <button
              type="button"
              className="button-ghost"
              onClick={() => {
                setOrderSearchDraft('')
                void setShopOrderSearch(undefined).catch(() => undefined)
              }}
            >
              Сбросить
            </button>
          </form>
        </header>
        {orders.length ? (
          <div className="shop-orders-table-wrapper">
            <table className="shop-orders-table">
              <thead>
                <tr>
                  <th scope="col">Заказ</th>
                  <th scope="col">Пользователь</th>
                  <th scope="col">Сумма</th>
                  <th scope="col">Статус</th>
                  <th scope="col">Действия</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(order => {
                  const pending = Boolean(orderActionPending[order.id])
                  const feedback = orderFeedback[order.id]
                  const isExpanded = expandedOrderId === order.id
                  return (
                    <React.Fragment key={order.id}>
                      <tr onClick={() => setExpandedOrderId(isExpanded ? null : order.id)} style={{ cursor: 'pointer' }}>
                        <td>
                          <strong>{order.orderNumber}</strong>
                          <br />
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                            {formatDateTime(order.createdAt)}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: '14px' }}>{renderOrderUser(order)}</span>
                        </td>
                        <td>
                          <strong>{formatMoney(order.totalCents, order.currencyCode)}</strong>
                        </td>
                        <td>
                          <span className={`status-chip ${order.status.toLowerCase()}`}>
                            {ORDER_STATUS_LABELS[order.status]}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="icon-button"
                            title={isExpanded ? 'Свернуть' : 'Развернуть'}
                            aria-label={isExpanded ? 'Свернуть' : 'Развернуть'}
                          >
                            {isExpanded ? '▼' : '▶'}
                          </button>
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr style={{ background: 'rgba(0, 240, 255, 0.06)' }}>
                          <td colSpan={5}>
                            <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                              {renderOrderItems(order)}
                              <label className="shop-order-note">
                                <span style={{ fontSize: '13px', fontWeight: 600 }}>Комментарий администратора</span>
                                <textarea
                                  rows={3}
                                  value={orderNotes[order.id] ?? ''}
                                  onChange={event =>
                                    setOrderNotes(state => ({ ...state, [order.id]: event.target.value }))
                                  }
                                  placeholder="Например, выдан на матче 5 ноября"
                                />
                              </label>
                              {feedback ? (
                                <div className={`inline-feedback ${feedback.kind}`}>
                                  <div>
                                    <strong>{feedback.message}</strong>
                                    {feedback.meta ? (
                                      <span className="feedback-meta">{feedback.meta}</span>
                                    ) : null}
                                  </div>
                                  <button
                                    type="button"
                                    className="feedback-close"
                                    onClick={() => setOrderFeedbackFor(order.id, null)}
                                  >
                                    ×
                                  </button>
                                </div>
                              ) : null}
                              <div className="shop-order-actions">
                                <button
                                  type="button"
                                  className="button-secondary"
                                  onClick={() => handleOrderNoteSave(order)}
                                  disabled={pending}
                                >
                                  {pending ? 'Сохраняем…' : 'Сохранить комментарий'}
                                </button>
                                {order.status === 'PENDING' ? (
                                  <>
                                    <button
                                      type="button"
                                      className="button-primary"
                                      onClick={() => handleOrderStatusUpdate(order, 'CONFIRMED')}
                                      disabled={pending}
                                    >
                                      {pending ? 'Обрабатываем…' : 'Подтвердить'}
                                    </button>
                                    <button
                                      type="button"
                                      className="button-danger"
                                      onClick={() => handleOrderStatusUpdate(order, 'CANCELLED')}
                                      disabled={pending}
                                    >
                                      Отменить
                                    </button>
                                  </>
                                ) : null}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="shop-orders-empty">Заказов не найдено.</p>
        )}
        {shopOrdersHasMore ? (
          <button
            type="button"
            className="button-secondary"
            onClick={() => void loadMoreShopOrders()}
            disabled={loadingOrders}
            style={{ marginTop: '16px', width: '100%' }}
          >
            {loadingOrders ? 'Загружаем…' : 'Загрузить ещё'}
          </button>
        ) : null}
      </article>
      </div>
    </div>
  )
}
