import React, { useCallback, useEffect, useRef, useState } from 'react'
import './AchievementCelebration.css'

interface AchievementCelebrationProps {
  iconSrc: string
  levelName: string
  points: number
  onClose: () => void
}

// Упрощённое конфетти на CSS (без canvas-confetti)
function createConfettiParticle(container: HTMLElement): HTMLDivElement {
  const particle = document.createElement('div')
  particle.className = 'confetti-particle'

  // Случайный цвет
  const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DFE6E9']
  const color = colors[Math.floor(Math.random() * colors.length)]
  particle.style.backgroundColor = color

  // Случайная позиция и размер
  particle.style.left = `${Math.random() * 100}%`
  particle.style.width = `${6 + Math.random() * 6}px`
  particle.style.height = `${6 + Math.random() * 6}px`

  // Случайная анимация
  const duration = 2 + Math.random() * 2
  const delay = Math.random() * 0.5
  particle.style.animationDuration = `${duration}s`
  particle.style.animationDelay = `${delay}s`

  container.appendChild(particle)

  // Удаляем после анимации
  setTimeout(() => {
    particle.remove()
  }, (duration + delay) * 1000)

  return particle
}

export default function AchievementCelebration({
  iconSrc,
  levelName,
  points,
  onClose,
}: AchievementCelebrationProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const confettiContainerRef = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(false)
  const closeTimeoutRef = useRef<number | null>(null)

  // Запуск анимации при mount
  useEffect(() => {
    // Небольшая задержка для триггера анимации входа
    const showTimer = setTimeout(() => {
      setIsVisible(true)
    }, 50)

    // Запуск конфетти
    const confettiContainer = confettiContainerRef.current
    if (confettiContainer) {
      // Создаём частицы конфетти
      for (let i = 0; i < 50; i++) {
        setTimeout(() => {
          createConfettiParticle(confettiContainer)
        }, i * 30)
      }
    }

    // Авто-закрытие через 5 секунд
    closeTimeoutRef.current = window.setTimeout(() => {
      handleClose()
    }, 5000)

    return () => {
      clearTimeout(showTimer)
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleClose = useCallback(() => {
    setIsVisible(false)
    // Ждём окончания анимации закрытия
    setTimeout(() => {
      onClose()
    }, 300)
  }, [onClose])

  const handleOverlayClick = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
    }
    handleClose()
  }, [handleClose])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        handleOverlayClick()
      }
    },
    [handleOverlayClick]
  )

  return (
    <div
      ref={overlayRef}
      className={`achievement-celebration-overlay ${isVisible ? 'visible' : ''}`}
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="celebration-title"
      aria-describedby="celebration-desc"
      tabIndex={0}
    >
      <div ref={confettiContainerRef} className="confetti-container" />

      <div className="celebration-content" onClick={e => e.stopPropagation()}>
        <div className={`celebration-icon ${isVisible ? 'animate' : ''}`}>
          <img
            src={iconSrc}
            alt={`Достижение: ${levelName}`}
            width={120}
            height={120}
          />
        </div>

        <h2 id="celebration-title" className="celebration-title">
          Поздравляем!
        </h2>

        <p id="celebration-desc" className="celebration-description">
          Вы достигли уровня <strong>&laquo;{levelName}&raquo;</strong>
          {points > 0 && (
            <>
              {' '} — <span className="celebration-points">+{points} очков</span> (в сезон)
            </>
          )}
        </p>

        <button
          type="button"
          className="celebration-close-btn"
          onClick={handleOverlayClick}
        >
          Отлично!
        </button>
      </div>
    </div>
  )
}
