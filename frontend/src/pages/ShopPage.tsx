import React, { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../store/appStore'
import '../shop.css'

const NOTE_LIMIT = 500
const SHOP_CURRENCY = 'RUB'

type ShopSubTab = 'catalog' | 'history'

const formatPrice = (priceCents: number): string => {
  try {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: SHOP_CURRENCY,
      minimumFractionDigits: 0,
    }).format(priceCents / 100)
  } catch (err) {
    const value = (priceCents / 100).toFixed(0)
    return `${value} ${SHOP_CURRENCY}`
  }
}

const resolveItemLimit = (options?: { maxPerOrder?: number; stockQuantity?: number | null }): number => {
  if (!options) {
    return 99
  }
  const perOrderLimit = options.maxPerOrder && options.maxPerOrder > 0 ? options.maxPerOrder : 99
  const stockLimit =
    typeof options.stockQuantity === 'number' && options.stockQuantity >= 0
      ? options.stockQuantity
      : 99
  return Math.max(0, Math.min(perOrderLimit, stockLimit))
}

export default function ShopPage() {
  const [activeTab, setActiveTab] = useState<ShopSubTab>('catalog')
  const [cartOpen, setCartOpen] = useState(false)
  const [note, setNote] = useState('')
  const [orderSuccess, setOrderSuccess] = useState<string | null>(null)

  const shopItems = useAppStore(state => state.shopItems)
  const shopItemsLoading = useAppStore(state => state.shopItemsLoading)
  const shopItemsError = useAppStore(state => state.shopItemsError)
  const fetchShopItems = useAppStore(state => state.fetchShopItems)

  const shopHistory = useAppStore(state => state.shopHistory)
  const shopHistoryLoading = useAppStore(state => state.shopHistoryLoading)
  const shopHistoryError = useAppStore(state => state.shopHistoryError)
  const fetchShopHistory = useAppStore(state => state.fetchShopHistory)

  const shopCart = useAppStore(state => state.shopCart)
  const addToCart = useAppStore(state => state.addToCart)
  const updateCartItem = useAppStore(state => state.updateCartItem)
  const removeFromCart = useAppStore(state => state.removeFromCart)
  const clearCart = useAppStore(state => state.clearCart)

  const shopContact = useAppStore(state => state.shopContact)
  const setShopContact = useAppStore(state => state.setShopContact)
  const submitShopOrder = useAppStore(state => state.submitShopOrder)
  const shopOrderSubmitting = useAppStore(state => state.shopOrderSubmitting)
  const shopOrderError = useAppStore(state => state.shopOrderError)

  useEffect(() => {
    void fetchShopItems()
  }, [fetchShopItems])

  useEffect(() => {
    if (activeTab === 'history') {
      void fetchShopHistory()
    }
  }, [activeTab, fetchShopHistory])

  const itemsSorted = useMemo(() => {
    if (!shopItems.length) {
      return []
    }
    return [...shopItems].sort((left, right) => {
      if (left.sortOrder === right.sortOrder) {
        return left.id - right.id
      }
      return left.sortOrder - right.sortOrder
    })
  }, [shopItems])

  const cartDetails = useMemo(() => {
    if (!shopItems.length) {
      return Object.values(shopCart).map(entry => ({ entry, item: undefined }))
    }
    const map = new Map(shopItems.map(item => [item.id, item]))
    return Object.values(shopCart).map(entry => ({ entry, item: map.get(entry.itemId) }))
  }, [shopCart, shopItems])

  const cartCount = useMemo(() => {
    return cartDetails.reduce((sum, row) => sum + row.entry.quantity, 0)
  }, [cartDetails])

  const cartTotal = useMemo(() => {
    return cartDetails.reduce((sum, row) => {
      if (!row.item) {
        return sum
      }
      return sum + row.entry.quantity * row.item.priceCents
    }, 0)
  }, [cartDetails])

  const handleSubmitOrder = async () => {
    setOrderSuccess(null)
    const result = await submitShopOrder({ note })
    if (result.ok) {
      setOrderSuccess('Заказ отправлен, мы скоро свяжемся с вами.')
      setNote('')
    }
  }

  const renderCatalog = () => {
    if (shopItemsLoading && !shopItems.length) {
      return <div className="shop-placeholder">Загружаем товары...</div>
    }
    if (shopItemsError && !shopItems.length) {
      return (
        <div className="shop-placeholder">
          <p>Не удалось загрузить каталог.</p>
          <button className="shop-secondary" onClick={() => fetchShopItems({ force: true })}>
            Повторить запрос
          </button>
        </div>
      )
    }
    if (!shopItems.length) {
      return <div className="shop-placeholder">Каталог пока пуст — загляните позже.</div>
    }
    return (
      <div className="shop-grid">
        {itemsSorted.map(item => {
          const limit = resolveItemLimit({
            maxPerOrder: item.maxPerOrder,
            stockQuantity: item.stockQuantity ?? null,
          })
          const inStock = item.isActive && (item.stockQuantity === null || (item.stockQuantity ?? 0) > 0)
          const disabled = !inStock || limit === 0
          const current = shopCart[item.id]?.quantity ?? 0
          return (
            <article key={item.id} className="shop-card">
              {item.image?.url && (
                <img src={item.image.url} alt={item.title} className="shop-card-image" loading="lazy" />
              )}
              <div className="shop-card-body">
                <div className="shop-card-header">
                  <span className="shop-chip">#{item.sortOrder.toString().padStart(2, '0')}</span>
                  {!item.isActive && <span className="shop-chip warning">Скрыто</span>}
                </div>
                <h3>{item.title}</h3>
                {item.subtitle && <p className="shop-subtitle">{item.subtitle}</p>}
                {item.description && <p className="shop-description">{item.description}</p>}
                <div className="shop-card-footer">
                  <div>
                    <div className="shop-price">{formatPrice(item.priceCents)}</div>
                    {item.stockQuantity !== null ? (
                      <span className="shop-stock">В наличии: {item.stockQuantity}</span>
                    ) : (
                      <span className="shop-stock">Под заказ</span>
                    )}
                  </div>
                  <button
                    className="shop-primary"
                    onClick={() => addToCart(item.id, 1)}
                    disabled={disabled}
                  >
                    {current > 0 ? 'В корзине' : 'Добавить'}
                  </button>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    )
  }

  const renderHistory = () => {
    if (shopHistoryLoading && !shopHistory.length) {
      return <div className="shop-placeholder">Собираем историю заказов...</div>
    }
    if (shopHistoryError === 'unauthorized') {
      return (
        <div className="shop-placeholder">
          Авторизуйтесь через Telegram WebApp, чтобы увидеть историю заказов.
        </div>
      )
    }
    if (shopHistoryError) {
      return (
        <div className="shop-placeholder">
          <p>Не удалось загрузить историю.</p>
          <button className="shop-secondary" onClick={() => fetchShopHistory({ force: true })}>
            Повторить запрос
          </button>
        </div>
      )
    }
    if (!shopHistory.length) {
      return <div className="shop-placeholder">Вы ещё не оформляли заказы.</div>
    }
    return (
      <div className="shop-history-list">
        {shopHistory.map(order => (
          <article key={order.id} className="shop-history-card">
            <header>
              <div>
                <strong>{order.orderNumber}</strong>
                <span>от {new Date(order.createdAt).toLocaleDateString('ru-RU')}</span>
              </div>
              <span className={`shop-status ${order.status.toLowerCase()}`}>
                {order.status === 'PENDING' && 'В обработке'}
                {order.status === 'CONFIRMED' && 'Подтверждён'}
                {order.status === 'CANCELLED' && 'Отменён'}
              </span>
            </header>
            <div className="shop-history-content">
              <ul>
                {order.items.map(item => (
                  <li key={`${order.id}-${item.itemId}`}>
                    <span>{item.title}</span>
                    <span>
                      {item.quantity} × {formatPrice(item.priceCents)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="shop-total-row">
                Итого: {formatPrice(order.totalCents)}
              </div>
              {order.customerNote && <p className="shop-note">Комментарий: {order.customerNote}</p>}
            </div>
          </article>
        ))}
      </div>
    )
  }

  const renderCart = () => {
    if (!cartOpen) {
      return null
    }
    return (
      <div className="shop-cart-overlay" role="dialog" aria-modal>
        <div className="shop-cart-modal">
          <header>
            <div>
              <h3>Корзина</h3>
              <span>{cartCount} позиций</span>
            </div>
            <button className="shop-icon" onClick={() => setCartOpen(false)} aria-label="Закрыть">
              ×
            </button>
          </header>
          {cartDetails.length === 0 ? (
            <div className="shop-placeholder small">Добавьте товары и возвращайтесь сюда.</div>
          ) : (
            <>
              <div className="shop-cart-list">
                {cartDetails.map(({ entry, item }) => {
                  const limit = resolveItemLimit({
                    maxPerOrder: item?.maxPerOrder,
                    stockQuantity: item?.stockQuantity ?? null,
                  })
                  return (
                    <div key={entry.itemId} className="shop-cart-item">
                      <div>
                        <strong>{item?.title ?? `ID ${entry.itemId}`}</strong>
                        {item && (
                          <span className="shop-price light">
                            {formatPrice(item.priceCents)}
                          </span>
                        )}
                      </div>
                      <div className="shop-cart-actions">
                        <button
                          className="shop-icon"
                          onClick={() => updateCartItem(entry.itemId, entry.quantity - 1)}
                          aria-label="Уменьшить количество"
                        >
                          −
                        </button>
                        <span>{entry.quantity}</span>
                        <button
                          className="shop-icon"
                          onClick={() => updateCartItem(entry.itemId, entry.quantity + 1)}
                          disabled={limit > 0 && entry.quantity >= limit}
                          aria-label="Увеличить количество"
                        >
                          +
                        </button>
                        <button
                          className="shop-secondary"
                          onClick={() => removeFromCart(entry.itemId)}
                        >
                          Удалить
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="shop-cart-form">
                <label>
                  Telegram username
                  <input
                    type="text"
                    value={shopContact.username ?? ''}
                    placeholder="@username"
                    onChange={event => setShopContact({ ...shopContact, username: event.target.value })}
                  />
                </label>
                <label>
                  Имя
                  <input
                    type="text"
                    value={shopContact.firstName ?? ''}
                    placeholder="Имя, чтобы с вами связаться"
                    onChange={event => setShopContact({ ...shopContact, firstName: event.target.value })}
                  />
                </label>
                <label>
                  Комментарий (необязательно)
                  <textarea
                    value={note}
                    maxLength={NOTE_LIMIT}
                    onChange={event => setNote(event.target.value)}
                    placeholder="Укажите размер или пожелания по доставке"
                  />
                  <span className="shop-hint">{note.length}/{NOTE_LIMIT}</span>
                </label>
                {shopOrderError && <div className="shop-error">{shopOrderError}</div>}
                {orderSuccess && <div className="shop-success">{orderSuccess}</div>}
                <div className="shop-total-row">
                  Итого: {formatPrice(cartTotal)}
                </div>
                <div className="shop-cart-buttons">
                  <button className="shop-secondary" onClick={clearCart} disabled={!cartDetails.length}>
                    Очистить
                  </button>
                  <button
                    className="shop-primary"
                    onClick={handleSubmitOrder}
                    disabled={!cartDetails.length || shopOrderSubmitting}
                  >
                    {shopOrderSubmitting ? 'Отправляем...' : 'Оформить заказ'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <section className="shop-page">
      <header className="shop-hero">
        <div>
          <p className="shop-pretitle">Магазин лиги</p>
          <h2>Атрибутика, абонементы и спецпредложения</h2>
          <p>Выбирайте товары, оформляйте заказ и ожидайте подтверждение от администраторов.</p>
        </div>
        <button className="shop-primary ghost" onClick={() => fetchShopItems({ force: true })}>
          Обновить каталог
        </button>
      </header>

      <div className="shop-tabs">
        <button
          className={activeTab === 'catalog' ? 'active' : ''}
          onClick={() => setActiveTab('catalog')}
        >
          Каталог
        </button>
        <button className={activeTab === 'history' ? 'active' : ''} onClick={() => setActiveTab('history')}>
          История заказов
        </button>
      </div>

      <div className="shop-content">
        {activeTab === 'catalog' ? renderCatalog() : renderHistory()}
      </div>

      <button className="shop-cart-fab" onClick={() => setCartOpen(true)}>
        <span>Корзина</span>
        <strong>{cartCount}</strong>
      </button>

      {renderCart()}
    </section>
  )
}
