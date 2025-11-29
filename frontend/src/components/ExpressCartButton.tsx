import React from 'react'
import { useExpressCart } from '../store/expressCartHooks'
import './ExpressCartButton.css'

/**
 * Плавающая кнопка корзины экспресса с бейджем количества элементов.
 * Отображается только когда есть элементы в корзине.
 */
const ExpressCartButton: React.FC = () => {
  const { items, setModalOpen, getMultiplier, isReadyToSubmit } = useExpressCart()

  if (items.length === 0) {
    return null
  }

  const multiplier = getMultiplier()
  const ready = isReadyToSubmit()

  return (
    <button
      type="button"
      className={`express-cart-fab ${ready ? 'ready' : ''}`}
      onClick={() => setModalOpen(true)}
      aria-label={`Открыть корзину экспресса (${items.length} событий)`}
    >
      <span className="express-cart-fab-icon">
        {/* Иконка корзины/сборки */}
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
          <line x1="3" y1="6" x2="21" y2="6" />
          <path d="M16 10a4 4 0 01-8 0" />
        </svg>
      </span>
      <span className="express-cart-fab-badge">{items.length}</span>
      {ready && (
        <span className="express-cart-fab-multiplier">×{multiplier}</span>
      )}
    </button>
  )
}

export default ExpressCartButton
