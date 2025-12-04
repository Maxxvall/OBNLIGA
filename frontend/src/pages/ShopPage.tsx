import React, { useEffect, useMemo, useState, useRef } from 'react'
import { useAppStore } from '../store/appStore'
import '../shop.css'
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

  const [limitNotice, setLimitNotice] = useState<string | null>(null)
  const limitTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (limitTimerRef.current) {
        window.clearTimeout(limitTimerRef.current)
      }
    }
  }, [])

  const handleSubmitOrder = async () => {
    setOrderSuccess(null)
    const result = await submitShopOrder()
    if (result.ok) {
      setOrderSuccess('Заказ отправлен, мы скоро свяжемся с вами.')
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
      return (
        <div className="shop-placeholder shop-placeholder-centered">
          <p className="shop-empty-text">Каталог пока пуст — загляните позже.</p>
        </div>
      )
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
          const imageUrl = item.image?.url
          const imageBase64 = item.image?.base64
          const imageMime = item.image?.mimeType ?? 'image/png'
          const heroImageSrc = imageUrl ?? (imageBase64 ? `data:${imageMime};base64,${imageBase64}` : undefined)
          return (
            <article key={item.id} className="shop-card">
              <div className="shop-card-visual">
                {heroImageSrc && (
                  <img src={heroImageSrc} alt={item.title} className="shop-card-image" loading="lazy" />
                )}
                {!item.isActive ? (
                  <span className="shop-chip warning shop-chip-overlay">Скрыто</span>
                ) : null}
                {item.stockQuantity !== null ? (
                  <span className="shop-stock-overlay">В наличии: {item.stockQuantity}</span>
                ) : (
                  <span className="shop-stock-overlay">Под заказ</span>
                )}
              </div>
              <h3 className="shop-card-title">{item.title}</h3>
              <div className="shop-card-body">
                {/* subtitle intentionally hidden per design request */}
                {item.description && <p className="shop-description">{item.description}</p>}
                <div className="shop-card-footer">
                  <div>
                    <div className="shop-price">{formatPrice(item.priceCents)}</div>
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
        <div className="shop-placeholder shop-placeholder-centered">
          <p className="shop-error-text">Не удалось загрузить историю.</p>
        </div>
      )
    }
    if (!shopHistory.length) {
      return (
        <div className="shop-placeholder shop-placeholder-centered">
          <p className="shop-empty-text">Вы ещё не оформляли заказы.</p>
        </div>
      )
    }
    return (
      <div className="shop-history-list">
        {shopHistory.map(order => (
          <article key={order.id} className="shop-history-card">
            <header>
              <div>
                <strong>{order.orderNumber}</strong>{' '}
                <span>от {new Date(order.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <span className={`shop-status ${order.status.toLowerCase()}`}>
                {order.status === 'PENDING' && 'В обработке'}
                {order.status === 'CONFIRMED' && 'Подтверждён'}
                {order.status === 'CANCELLED' && 'Отменён'}
              </span>
            </header>
            <div className="shop-history-content">
              <ul className="shop-order-items">
                {order.items.map(item => (
                  <li key={`${order.id}-${item.itemId}`}>
                    <div>
                      <strong>{item.title}</strong>
                      {item.subtitle ? <span className="shop-order-item-subtitle">{item.subtitle}</span> : null}
                    </div>
                    <span className="shop-order-item-qty">× {item.quantity}</span>
                    <span className="shop-order-item-price">{formatPrice(item.priceCents)}</span>
                  </li>
                ))}
              </ul>
              <div className="shop-total-row">
                Итого: <strong>{formatPrice(order.totalCents)}</strong>
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
          {limitNotice ? <div className="shop-limit-notice">{limitNotice}</div> : null}
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
                      <div className="shop-cart-item-left">
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
                          onClick={() => {
                            if (limit > 0 && entry.quantity >= limit) {
                              setLimitNotice(`На этот товар установлен лимит ${limit} шт. в один заказ`)
                              if (limitTimerRef.current) {
                                window.clearTimeout(limitTimerRef.current)
                              }
                              limitTimerRef.current = window.setTimeout(() => setLimitNotice(null), 5000)
                              return
                            }
                            updateCartItem(entry.itemId, entry.quantity + 1)
                          }}
                          disabled={limit === 0}
                          aria-label="Увеличить количество"
                        >
                          +
                        </button>
                        <button
                          className="shop-delete"
                          onClick={() => removeFromCart(entry.itemId)}
                        >
                          Удалить
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
              {shopOrderError && <div className="shop-error">{shopOrderError}</div>}
              {orderSuccess && <div className="shop-success">{orderSuccess}</div>}
              <div className="shop-total-row">
                Итого: {formatPrice(cartTotal)}
              </div>
              <div className="shop-cart-buttons">
                <button className="shop-clear" onClick={clearCart} disabled={!cartDetails.length}>
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
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <section className="shop-page">
      <header className="shop-hero">
        <div className="shop-hero-content">
          <div>
            <h2>Магазин</h2>
            <p className="shop-hero-subtitle">Сувениры и мерч лиги. Доставка обсуждается с менеджером после заказа.</p>
          </div>
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
        </div>
      </header>

      <div className="shop-content">
        {activeTab === 'catalog' ? renderCatalog() : renderHistory()}
      </div>

      {cartCount > 0 ? (
        <button className="shop-cart-fab" onClick={() => setCartOpen(true)}>
          <span>Корзина</span>
          <strong>{cartCount}</strong>
        </button>
      ) : null}

      {renderCart()}
    </section>
  )
}
