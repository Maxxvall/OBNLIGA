import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react'
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
  slug: string
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
  slug: '',
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
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(cents / 100)
  } catch (err) {
    return `${(cents / 100).toFixed(2)} ${currency}`
  }
}

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
      const { preview, payload } = await readImageFile(file)
      setItemForm(state => ({ ...state, imagePayload: payload, imageChanged: true }))
      setItemImagePreview(preview)
      setFormFeedback(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось обработать изображение.'
      setFormFeedback({ kind: 'error', message })
    } finally {
      event.target.value = ''
    }
  }

  const handleClearImage = () => {
    setItemForm(state => ({ ...state, imagePayload: null, imageChanged: true }))
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
      slug: item.slug ?? '',
      isActive: item.isActive,
      imagePayload: undefined,
      imageChanged: false,
      imageUrl: item.image?.url ?? '',
    })
    setItemImagePreview(item.image?.url ?? (item.image?.base64 ? `data:${item.image.mimeType};base64,${item.image.base64}` : null))
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
      slug: itemForm.slug.trim() || undefined,
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
    const parts = []
    if (order.user.firstName) {
      parts.push(order.user.firstName)
    }
    if (order.user.username) {
      parts.push(`@${order.user.username}`)
    }
    if (order.user.telegramId) {
      parts.push(`#${order.user.telegramId}`)
    }
    return parts.join(' • ')
  }

  return (
    <div className="tab-sections">
      <header className="tab-header shop-hero">
        <div>
          <p className="shop-hero-pretitle">Магазин лиги</p>
          <h3>Вкладка магазина</h3>
          <p className="shop-hero-note">
            Управляйте каталогом и оперативно обрабатывайте заказы пользователей в одном стиле.
          </p>
          <div className="shop-hero-metrics">
            <span className="status-chip success">Всего товаров: {items.length}</span>
            <span className="status-chip success">Активных: {activeItemsCount}</span>
            <span className={`status-chip ${pendingOrdersCount ? 'pending' : 'muted'}`}>
              {pendingOrdersCount ? `${pendingOrdersCount} заказа ждут` : 'Новых заказов нет'}
            </span>
          </div>
        </div>
        <div className="tab-header-actions shop-header-actions">
          <button type="button" className="button-ghost" onClick={handleItemsRefresh} disabled={loadingItems}>
            {loadingItems ? 'Обновляем каталог…' : 'Обновить каталог'}
          </button>
          <button type="button" className="button-ghost" onClick={handleOrdersRefresh} disabled={loadingOrders}>
            {loadingOrders ? 'Обновляем заказы…' : 'Обновить заказы'}
          </button>
        </div>
      </header>

      <section className="card shop-form-card">
        <header>
          <h4>{editingItemId ? 'Редактирование товара' : 'Новый товар'}</h4>
          <p>
            {editingItemId
              ? 'Измените поля и сохраните — данные обновятся на клиенте моментально.'
              : 'Заполните карточку товара и сохраните её в каталоге.'}
          </p>
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
        <form className="shop-form" onSubmit={handleItemSubmit}>
          <div className="shop-form-grid">
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
              Слаг (опционально)
              <input value={itemForm.slug} onChange={handleItemField('slug')} maxLength={64} placeholder="fan-sharf" />
            </label>
            <label>
              Ссылка на изображение (опционально)
              <input value={itemForm.imageUrl} onChange={handleItemField('imageUrl')} placeholder="https://" />
            </label>
          </div>
          <label>
            Описание
            <textarea rows={5} value={itemForm.description} onChange={handleItemField('description')} placeholder="Подробности о товаре" />
          </label>
          <label className="checkbox-inline">
            <input type="checkbox" checked={itemForm.isActive} onChange={event => setItemForm(state => ({ ...state, isActive: event.target.checked }))} />
            <span>Показывать в витрине</span>
          </label>
          <div className="shop-image-upload">
            <div>
              <label className="button-secondary" htmlFor="shop-image-input">
                {itemImagePreview ? 'Заменить изображение' : 'Загрузить изображение'}
              </label>
              <input id="shop-image-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleItemImage} />
              {itemImagePreview ? (
                <button type="button" className="button-ghost" onClick={handleClearImage}>
                  Сбросить изображение
                </button>
              ) : null}
            </div>
            {itemImagePreview ? (
              <img src={itemImagePreview} alt="Превью товара" className="shop-image-preview" />
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
      </section>

      <section className="card">
        <header>
          <h4>Каталог</h4>
          <p>Быстрые действия: активируйте, редактируйте или удаляйте товары.</p>
        </header>
        {items.length ? (
          <div className="shop-items-grid">
            {items.map(item => (
              <article key={item.id} className="shop-item-card">
                <div className="shop-item-header">
                  <div>
                    <h5>{item.title}</h5>
                    {item.subtitle ? <span className="shop-item-subtitle">{item.subtitle}</span> : null}
                  </div>
                  <span className={`status-chip ${item.isActive ? 'success' : 'muted'}`}>
                    {item.isActive ? 'Витрина' : 'Скрыт'}
                  </span>
                </div>
                <div className="shop-item-body">
                  <div className="shop-item-price">{formatMoney(item.priceCents, item.currencyCode)}</div>
                  <div className="shop-item-meta">
                    <span>Лимит: {item.maxPerOrder}</span>
                    <span>Сортировка: {item.sortOrder}</span>
                  </div>
                  <div className="shop-item-stock">
                    Остаток:{' '}
                    {item.stockQuantity === null || item.stockQuantity === undefined
                      ? 'безлимит'
                      : item.stockQuantity}
                  </div>
                </div>
                <div className="shop-item-actions">
                  <button type="button" className="button-secondary" onClick={() => pickItemForEdit(item)}>
                    Редактировать
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => handleToggleItemStatus(item)}
                    disabled={itemStatusPendingId === item.id}
                  >
                    {itemStatusPendingId === item.id
                      ? 'Сохраняем…'
                      : item.isActive
                        ? 'Скрыть'
                        : 'Показать'}
                  </button>
                  <button
                    type="button"
                    className="button-danger"
                    onClick={() => handleDeleteItem(item)}
                    disabled={itemDeletePendingId === item.id}
                  >
                    {itemDeletePendingId === item.id ? 'Удаляем…' : 'Удалить'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p>Каталог пока пуст.</p>
        )}
      </section>

      <section className="card">
        <header className="shop-orders-header">
          <div>
            <h4>Заказы пользователей</h4>
            <p>Обрабатывайте новые заказы, оставляйте комментарии и подтверждайте оплату.</p>
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
          <div className="shop-orders-list">
            {orders.map(order => {
              const pending = Boolean(orderActionPending[order.id])
              const feedback = orderFeedback[order.id]
              return (
                <article key={order.id} className="shop-order-card">
                  <div className="shop-order-header">
                    <div>
                      <strong>№ {order.orderNumber}</strong>
                      <span>{formatDateTime(order.createdAt)}</span>
                    </div>
                    <span className={`status-chip ${order.status.toLowerCase()}`}>
                      {ORDER_STATUS_LABELS[order.status]}
                    </span>
                  </div>
                  <div className="shop-order-user">{renderOrderUser(order)}</div>
                  {renderOrderItems(order)}
                  <div className="shop-order-total">
                    Итого: <strong>{formatMoney(order.totalCents, order.currencyCode)}</strong>
                  </div>
                  <label className="shop-order-note">
                    Комментарий администратора
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
                        {feedback.meta ? <span className="feedback-meta">{feedback.meta}</span> : null}
                      </div>
                      <button type="button" className="feedback-close" onClick={() => setOrderFeedbackFor(order.id, null)}>
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
                </article>
              )
            })}
            {shopOrdersHasMore ? (
              <button
                type="button"
                className="button-secondary"
                onClick={() => void loadMoreShopOrders()}
                disabled={loadingOrders}
              >
                {loadingOrders ? 'Загружаем…' : 'Загрузить ещё'}
              </button>
            ) : null}
          </div>
        ) : (
          <p className="shop-orders-empty">Заказы не найдены.</p>
        )}
      </section>
    </div>
  )
}
