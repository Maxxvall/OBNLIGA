import { useEffect, useRef, useState } from 'react'

type PollingOptions = {
  /**
   * Интервал обновления когда вкладка активна (мс)
   * @default 30000 (30 секунд)
   */
  activeInterval?: number
  
  /**
   * Интервал обновления когда вкладка неактивна (мс)
   * @default 120000 (2 минуты)
   */
  inactiveInterval?: number
  
  /**
   * Интервал обновления когда окно в фоне (мс)
   * @default 300000 (5 минут)
   */
  backgroundInterval?: number
  
  /**
   * Включить polling сразу
   * @default true
   */
  enabled?: boolean
  
  /**
   * Запустить первый запрос сразу
   * @default true
   */
  immediate?: boolean
}

type PollingState = {
  /** Текущее состояние видимости */
  visibility: 'active' | 'inactive' | 'background'
  
  /** Текущий интервал (мс) */
  currentInterval: number
  
  /** Счётчик тиков */
  tick: number
}

/**
 * Hook для адаптивного polling с учётом активности пользователя.
 * 
 * - Активная вкладка: частые обновления
 * - Неактивная вкладка (видимая): средние обновления
 * - Фоновая вкладка: редкие обновления
 * 
 * @param callback Функция для выполнения при каждом тике
 * @param options Настройки polling
 * @returns Текущее состояние polling
 */
export function useAdaptivePolling(
  callback: () => void | Promise<void>,
  options: PollingOptions = {}
): PollingState {
  const {
    activeInterval = 30000,
    inactiveInterval = 120000,
    backgroundInterval = 300000,
    enabled = true,
    immediate = true,
  } = options

  const [visibility, setVisibility] = useState<'active' | 'inactive' | 'background'>('active')
  const [tick, setTick] = useState(0)
  const callbackRef = useRef(callback)
  const timerRef = useRef<number | null>(null)
  const lastInteractionRef = useRef(Date.now())

  // Обновлять ref callback при каждом рендере
  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  // Отслеживать видимость страницы
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        setVisibility('background')
      } else {
        // Проверить активность
        const timeSinceInteraction = Date.now() - lastInteractionRef.current
        if (timeSinceInteraction < 60000) {
          setVisibility('active')
        } else {
          setVisibility('inactive')
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  // Отслеживать активность пользователя
  useEffect(() => {
    const handleInteraction = () => {
      lastInteractionRef.current = Date.now()
      if (!document.hidden) {
        setVisibility('active')
      }
    }

    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart']
    events.forEach(event => {
      document.addEventListener(event, handleInteraction, { passive: true })
    })

    // Проверять активность каждую минуту
    const activityTimer = window.setInterval(() => {
      if (document.hidden) return
      
      const timeSinceInteraction = Date.now() - lastInteractionRef.current
      if (timeSinceInteraction > 60000) {
        setVisibility('inactive')
      }
    }, 60000)

    return () => {
      events.forEach(event => {
        document.removeEventListener(event, handleInteraction)
      })
      clearInterval(activityTimer)
    }
  }, [])

  // Определить текущий интервал
  const currentInterval =
    visibility === 'active'
      ? activeInterval
      : visibility === 'inactive'
        ? inactiveInterval
        : backgroundInterval

  // Polling loop
  useEffect(() => {
    if (!enabled) {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      return
    }

    const executePoll = async () => {
      try {
        await callbackRef.current()
      } catch (err) {
        console.error('useAdaptivePolling: callback error', err)
      }
      
      setTick(prev => prev + 1)
      
      // Запланировать следующий тик
      timerRef.current = window.setTimeout(executePoll, currentInterval)
    }

    // Первый запуск
    if (immediate && tick === 0) {
      executePoll()
    } else {
      timerRef.current = window.setTimeout(executePoll, currentInterval)
    }

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [enabled, currentInterval, immediate, tick])

  return {
    visibility,
    currentInterval,
    tick,
  }
}
