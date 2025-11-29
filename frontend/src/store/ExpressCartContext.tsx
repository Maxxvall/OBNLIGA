import React, { createContext, useCallback, useMemo, useState } from 'react'
import type {
  ExpressConfig,
  ExpressWeekCount,
} from '@shared/types'

/**
 * Элемент корзины экспресса
 */
export interface ExpressCartItem {
  templateId: string
  matchId: string
  selection: string
  /** Локализованная метка выбора (П1, ТБ 2.5, и т.д.) */
  selectionLabel: string
  /** Название рынка */
  marketTitle: string
  /** Краткое название матча (teams) */
  matchLabel: string
  /** ISO datetime */
  matchDateTime: string
  /** Базовые очки */
  basePoints: number
}

/**
 * Состояние корзины экспресса
 */
interface ExpressCartState {
  /** Элементы в корзине */
  items: ExpressCartItem[]
  /** Модалка открыта */
  isModalOpen: boolean
  /** Конфигурация экспрессов */
  config: ExpressConfig | null
  /** Счётчик за неделю */
  weekCount: ExpressWeekCount | null
}

/**
 * Действия корзины экспресса
 */
interface ExpressCartActions {
  /** Добавить элемент в корзину */
  addItem: (item: ExpressCartItem) => void
  /** Удалить элемент из корзины по templateId */
  removeItem: (templateId: string) => void
  /** Очистить корзину */
  clearCart: () => void
  /** Открыть/закрыть модалку */
  setModalOpen: (open: boolean) => void
  /** Установить конфигурацию */
  setConfig: (config: ExpressConfig | null) => void
  /** Установить счётчик за неделю */
  setWeekCount: (count: ExpressWeekCount | null) => void
  /** Проверить, есть ли элемент в корзине */
  hasItem: (templateId: string) => boolean
  /** Проверить, есть ли матч в корзине (для валидации разных матчей) */
  hasMatch: (matchId: string) => boolean
  /** Получить элемент по templateId */
  getItem: (templateId: string) => ExpressCartItem | undefined
  /** Рассчитать множитель для текущего количества элементов */
  getMultiplier: () => number
  /** Проверить, можно ли добавить ещё элемент */
  canAddMore: () => boolean
  /** Проверить, достаточно ли элементов для создания экспресса */
  isReadyToSubmit: () => boolean
  /** Проверить, достигнут ли лимит на неделю */
  isWeeklyLimitReached: () => boolean
}

type ExpressCartContextValue = ExpressCartState & ExpressCartActions

const ExpressCartContext = createContext<ExpressCartContextValue | null>(null)

// Дефолтная конфигурация (если API не отвечает)
const DEFAULT_CONFIG: ExpressConfig = {
  minItems: 2,
  maxItems: 4,
  multipliers: { 2: 1.2, 3: 1.5, 4: 2.5 },
  weeklyLimit: 2,
  periodDays: 6,
}

interface ExpressCartProviderProps {
  children: React.ReactNode
}

export const ExpressCartProvider: React.FC<ExpressCartProviderProps> = ({ children }) => {
  const [items, setItems] = useState<ExpressCartItem[]>([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [config, setConfig] = useState<ExpressConfig | null>(null)
  const [weekCount, setWeekCount] = useState<ExpressWeekCount | null>(null)

  const effectiveConfig = config ?? DEFAULT_CONFIG

  const addItem = useCallback((item: ExpressCartItem) => {
    setItems(prev => {
      // Не добавляем дубликаты по templateId
      if (prev.some(i => i.templateId === item.templateId)) {
        return prev
      }
      // Не добавляем если матч уже есть
      if (prev.some(i => i.matchId === item.matchId)) {
        return prev
      }
      // Не добавляем если достигнут максимум
      if (prev.length >= effectiveConfig.maxItems) {
        return prev
      }
      return [...prev, item]
    })
  }, [effectiveConfig.maxItems])

  const removeItem = useCallback((templateId: string) => {
    setItems(prev => prev.filter(i => i.templateId !== templateId))
  }, [])

  const clearCart = useCallback(() => {
    setItems([])
  }, [])

  const setModalOpen = useCallback((open: boolean) => {
    setIsModalOpen(open)
  }, [])

  const hasItem = useCallback((templateId: string) => {
    return items.some(i => i.templateId === templateId)
  }, [items])

  const hasMatch = useCallback((matchId: string) => {
    return items.some(i => i.matchId === matchId)
  }, [items])

  const getItem = useCallback((templateId: string) => {
    return items.find(i => i.templateId === templateId)
  }, [items])

  const getMultiplier = useCallback(() => {
    const count = items.length
    if (count < effectiveConfig.minItems) return 1
    return effectiveConfig.multipliers[count] ?? 1
  }, [items.length, effectiveConfig])

  const canAddMore = useCallback(() => {
    return items.length < effectiveConfig.maxItems
  }, [items.length, effectiveConfig.maxItems])

  const isReadyToSubmit = useCallback(() => {
    return items.length >= effectiveConfig.minItems && items.length <= effectiveConfig.maxItems
  }, [items.length, effectiveConfig])

  const isWeeklyLimitReached = useCallback(() => {
    if (!weekCount) return false
    return weekCount.remaining <= 0
  }, [weekCount])

  const value = useMemo<ExpressCartContextValue>(() => ({
    items,
    isModalOpen,
    config,
    weekCount,
    addItem,
    removeItem,
    clearCart,
    setModalOpen,
    setConfig,
    setWeekCount,
    hasItem,
    hasMatch,
    getItem,
    getMultiplier,
    canAddMore,
    isReadyToSubmit,
    isWeeklyLimitReached,
  }), [
    items,
    isModalOpen,
    config,
    weekCount,
    addItem,
    removeItem,
    clearCart,
    setModalOpen,
    setConfig,
    setWeekCount,
    hasItem,
    hasMatch,
    getItem,
    getMultiplier,
    canAddMore,
    isReadyToSubmit,
    isWeeklyLimitReached,
  ])

  return (
    <ExpressCartContext.Provider value={value}>
      {children}
    </ExpressCartContext.Provider>
  )
}

export default ExpressCartContext
