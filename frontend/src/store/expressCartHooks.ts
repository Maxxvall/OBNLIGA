/**
 * Хуки и хелперы для работы с корзиной экспресса
 * Вынесены в отдельный файл для совместимости с Fast Refresh
 */
import { useContext } from 'react'
import type {
  ActivePredictionMatch,
  PredictionTemplateView,
} from '@shared/types'
import ExpressCartContext, { type ExpressCartItem } from './ExpressCartContext'

// Интерфейс значения контекста (дублируем для экспорта типа)
export type { ExpressCartItem } from './ExpressCartContext'

/**
 * Хук для доступа к контексту корзины экспресса
 */
export const useExpressCart = () => {
  const context = useContext(ExpressCartContext)
  if (!context) {
    throw new Error('useExpressCart must be used within an ExpressCartProvider')
  }
  return context
}

/**
 * Хелпер для создания элемента корзины из шаблона и матча
 */
export const createCartItem = (
  template: PredictionTemplateView,
  match: ActivePredictionMatch,
  selection: string,
  selectionLabel: string,
  marketTitle: string
): ExpressCartItem => ({
  templateId: template.id,
  matchId: match.matchId,
  selection,
  selectionLabel,
  marketTitle,
  matchLabel: `${match.homeClub.shortName ?? match.homeClub.name} vs ${match.awayClub.shortName ?? match.awayClub.name}`,
  matchDateTime: match.matchDateTime,
  basePoints: template.basePoints,
})
