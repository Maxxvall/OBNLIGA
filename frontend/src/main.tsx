import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import LineupPortal from './LineupPortal'
import { setupConsoleFilters } from './utils/consoleFilters'

const root = createRoot(document.getElementById('root')!)
const isLineupPortal = window.location.pathname.startsWith('/lineup')
const RootComponent = isLineupPortal ? LineupPortal : App

setupConsoleFilters()

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
