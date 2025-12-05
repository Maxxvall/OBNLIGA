/**
 * Компонент кнопки подписки на команду.
 * Компактный, стилизованный под приложение.
 */

import React, { useState, useCallback, useEffect } from 'react'
import {
  subscribeToClub,
  unsubscribeFromClub,
  isSubscribedToClubCached,
  checkClubSubscriptionStatus,
} from '../../api/subscriptionApi'
import './ClubSubscribeButton.css'

interface ClubSubscribeButtonProps {
  clubId: number
  className?: string
  compact?: boolean
}

export const ClubSubscribeButton: React.FC<ClubSubscribeButtonProps> = ({
  clubId,
  className = '',
  compact = false,
}) => {
  // Инициализируем из кэша (optimistic UI)
  const [isSubscribed, setIsSubscribed] = useState<boolean | null>(() => {
    return isSubscribedToClubCached(clubId)
  })
  const [isLoading, setIsLoading] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)
  const [cooldownUntil, setCooldownUntil] = useState(0)

  // Загружаем актуальный статус при монтировании
  useEffect(() => {
    let cancelled = false

    const loadStatus = async () => {
      try {
        const subscribed = await checkClubSubscriptionStatus(clubId)
        if (!cancelled) {
          setIsSubscribed(subscribed)
        }
      } catch (err) {
        console.error('Failed to check subscription status:', err)
        // Оставляем кэшированное значение или null
      }
    }

    void loadStatus()

    return () => {
      cancelled = true
    }
  }, [clubId])

  const handleToggle = useCallback(async () => {
    const now = Date.now()
    if (isLoading || now < cooldownUntil) return

    setIsLoading(true)
    setIsAnimating(true)

    // Optimistic update
    const previousState = isSubscribed
    setIsSubscribed(!isSubscribed)

    try {
      let result
      if (previousState) {
        result = await unsubscribeFromClub(clubId)
      } else {
        result = await subscribeToClub(clubId)
      }

      if (!result.ok) {
        // Rollback on error
        setIsSubscribed(previousState)
        console.error('Subscription toggle failed:', result.error)
      }
    } catch (err) {
      // Rollback on error
      setIsSubscribed(previousState)
      console.error('Subscription toggle error:', err)
    } finally {
      setIsLoading(false)
      setCooldownUntil(Date.now() + 800)
      // Задержка для завершения анимации
      setTimeout(() => setIsAnimating(false), 300)
    }
  }, [clubId, isSubscribed, isLoading, cooldownUntil])

  // Не рендерим, пока не знаем статус
  if (isSubscribed === null) {
    return (
      <button
        type="button"
        className={`club-subscribe-btn ${compact ? 'compact' : ''} loading ${className}`.trim()}
        disabled
        aria-label="Загрузка статуса подписки"
      >
        <span className="club-subscribe-icon">🔔</span>
        {!compact && <span className="club-subscribe-text">...</span>}
      </button>
    )
  }

  return (
    <button
      type="button"
      className={`
        club-subscribe-btn 
        ${compact ? 'compact' : ''} 
        ${isSubscribed ? 'subscribed' : ''} 
        ${isAnimating ? 'animating' : ''}
        ${isLoading ? 'loading' : ''}
        ${className}
      `.trim()}
      onClick={handleToggle}
      disabled={isLoading || Date.now() < cooldownUntil}
      aria-pressed={isSubscribed}
      aria-label={isSubscribed ? 'Отписаться от команды' : 'Подписаться на команду'}
      title={isSubscribed ? 'Отписаться от уведомлений' : 'Подписаться на уведомления'}
    >
      <span className="club-subscribe-icon" aria-hidden="true">
        {isSubscribed ? '🔔' : '🔕'}
      </span>
      {!compact && (
        <span className="club-subscribe-text">
          {isSubscribed ? 'Подписан' : 'Подписаться'}
        </span>
      )}
      {isLoading && <span className="club-subscribe-spinner" aria-hidden="true" />}
    </button>
  )
}

export default ClubSubscribeButton
