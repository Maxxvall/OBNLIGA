import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import LineupPortal from './LineupPortal'
import { setupConsoleFilters } from './utils/consoleFilters'
import { useAppStore } from './store/appStore'

// Типы для Telegram WebApp API
interface TelegramWebApp {
  initDataUnsafe?: {
    start_param?: string
    user?: {
      id: number
      first_name: string
      last_name?: string
      username?: string
    }
  }
}

interface TelegramWindow {
  Telegram?: {
    WebApp?: TelegramWebApp
  }
}

/**
 * Обрабатывает startapp параметр из Telegram для открытия конкретного матча.
 * Формат: match_<matchId> (например, match_12345)
 */
function handleTelegramStartParam(): void {
  try {
    const telegramWindow = window as unknown as TelegramWindow
    const startParam = telegramWindow.Telegram?.WebApp?.initDataUnsafe?.start_param
      ?? new URLSearchParams(window.location.search).get('startapp')

    if (!startParam) return

    // Разбираем формат: match_<matchId>
    const matchPrefix = 'match_'
    if (startParam.startsWith(matchPrefix)) {
      const matchId = startParam.substring(matchPrefix.length)
      if (matchId && /^\d+$/.test(matchId)) {
        // Увеличенная задержка для полной инициализации приложения и сезонов
        const tryOpenMatch = (attempts = 0) => {
          const state = useAppStore.getState()
          // Ждём загрузки сезонов или максимум 3 секунды
          if (state.loading.seasons && attempts < 30) {
            setTimeout(() => tryOpenMatch(attempts + 1), 100)
            return
          }
          state.openMatchDetails(matchId)
        }
        setTimeout(() => tryOpenMatch(), 300)
      }
    }
  } catch (err) {
    console.warn('Failed to handle Telegram start param:', err)
  }
}

const root = createRoot(document.getElementById('root')!)
const isLineupPortal = window.location.pathname.startsWith('/lineup')
const RootComponent = isLineupPortal ? LineupPortal : App

setupConsoleFilters()

// Обрабатываем startapp параметр из Telegram уведомлений
if (!isLineupPortal) {
  handleTelegramStartParam()
}

// Отключаем StrictMode в production для устранения дублированных запросов
// В development оставляем для проверки компонентов
const isDev = import.meta.env.DEV
const AppWrapper = isDev ? (
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>
) : (
  <RootComponent />
)

root.render(AppWrapper)
