import { FastifyBaseLogger } from 'fastify'
import {
  MatchEventType,
  PredictionEntryStatus,
  PredictionMarketType,
  Prisma,
} from '@prisma/client'
import { formatTotalLine } from './predictionTotalsService'
import {
  updateExpressItemsForMatch,
  settleExpressBet,
  ExpressSettlementSummary,
} from './expressService'
import { EXPRESS_USER_CACHE_KEY } from './predictionConstants'
import { defaultCache } from '../cache'

type SettlementMatch = {
  id: bigint
  homeScore: number
  awayScore: number
  hasPenaltyShootout: boolean
  penaltyHomeScore: number
  penaltyAwayScore: number
  events: { eventType: MatchEventType }[]
  predictionTemplates: Array<{
    id: bigint
    marketType: PredictionMarketType
    options: Prisma.JsonValue
    basePoints: number
    difficultyMultiplier: Prisma.Decimal | number
    entries: Array<{
      id: bigint
      userId: number
      selection: string
      status: PredictionEntryStatus
      submittedAt: Date
    }>
  }>
}

export type SettlementSummary = {
  userIds: Set<number>
  settled: number
  won: number
  lost: number
  voided: number
  cancelled: number
  // Экспресс-прогнозы
  expressSettlements: ExpressSettlementSummary[]
}

type SettlementContext = {
  outcome: 'ONE' | 'DRAW' | 'TWO'
  totalGoals: number
  eventTypes: Set<string>
  resolvedAt: Date
}

type TemplateContext = {
  basePoints: number
  difficultyMultiplier: number
}

type EntryResolution = {
  status: PredictionEntryStatus
  awardedPoints: number | null
  meta?: Prisma.JsonObject
}

const toNumber = (value: Prisma.Decimal | number | null | undefined): number | null => {
  if (value == null) {
    return null
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  try {
    const numeric = value.toNumber()
    return Number.isFinite(numeric) ? numeric : null
  } catch (_err) {
    return null
  }
}

const ensureRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

const computeAwardedPoints = (basePoints: number, multiplier: number): number => {
  const normalizedMultiplier = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1
  const raw = basePoints * normalizedMultiplier
  if (!Number.isFinite(raw)) {
    return Math.max(0, Math.round(basePoints))
  }
  return Math.max(0, Math.round(raw))
}

/**
 * Получает очки для конкретного выбора из options.choices
 * Шаблоны хранят очки для каждого варианта отдельно в options.choices[].points
 */
const getPointsForSelection = (
  options: Record<string, unknown> | null,
  selection: string,
  fallbackPoints: number
): number => {
  if (!options) {
    return fallbackPoints
  }
  
  const choices = options.choices
  if (!Array.isArray(choices)) {
    return fallbackPoints
  }
  
  const normalizedSelection = selection.trim().toUpperCase()
  
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') {
      continue
    }
    const choiceRecord = choice as Record<string, unknown>
    const value = choiceRecord.value
    if (typeof value === 'string' && value.trim().toUpperCase() === normalizedSelection) {
      const points = choiceRecord.points
      if (typeof points === 'number' && Number.isFinite(points)) {
        return points
      }
    }
  }
  
  return fallbackPoints
}

const normalizeOutcomeSelection = (value: string): 'ONE' | 'DRAW' | 'TWO' | null => {
  const trimmed = value.trim().toUpperCase()
  if (trimmed === 'ONE' || trimmed === '1' || trimmed === 'HOME') {
    return 'ONE'
  }
  if (trimmed === 'DRAW' || trimmed === 'X' || trimmed === '0') {
    return 'DRAW'
  }
  if (trimmed === 'TWO' || trimmed === '2' || trimmed === 'AWAY') {
    return 'TWO'
  }
  return null
}

const determineMatchOutcome = (match: SettlementMatch): 'ONE' | 'DRAW' | 'TWO' => {
  if (match.homeScore > match.awayScore) {
    return 'ONE'
  }
  if (match.homeScore < match.awayScore) {
    return 'TWO'
  }
  if (match.hasPenaltyShootout) {
    if (match.penaltyHomeScore > match.penaltyAwayScore) {
      return 'ONE'
    }
    if (match.penaltyHomeScore < match.penaltyAwayScore) {
      return 'TWO'
    }
  }
  return 'DRAW'
}

const evaluateOutcome = (
  entry: SettlementMatch['predictionTemplates'][number]['entries'][number],
  template: SettlementMatch['predictionTemplates'][number],
  context: SettlementContext,
  templateContext: TemplateContext
): EntryResolution => {
  const selection = normalizeOutcomeSelection(entry.selection)
  if (!selection) {
    return {
      status: PredictionEntryStatus.CANCELLED,
      awardedPoints: null,
  meta: { reason: 'invalid_selection', selection: entry.selection },
    }
  }

  const won = selection === context.outcome
  // Получаем очки из options.choices для конкретного выбора, а не basePoints шаблона
  const options = ensureRecord(template.options)
  const selectionPoints = getPointsForSelection(options, selection, templateContext.basePoints)
  const points = won ? computeAwardedPoints(selectionPoints, templateContext.difficultyMultiplier) : 0
  return {
    status: won ? PredictionEntryStatus.WON : PredictionEntryStatus.LOST,
    awardedPoints: won ? points : 0,
    meta: {
      actualOutcome: context.outcome,
      normalizedSelection: selection,
      selectionPoints,
    },
  }
}

const evaluateTotalGoals = (
  entry: SettlementMatch['predictionTemplates'][number]['entries'][number],
  template: SettlementMatch['predictionTemplates'][number],
  context: SettlementContext,
  templateContext: TemplateContext
): EntryResolution => {
  const options = ensureRecord(template.options)

  let line: number | null = null
  if (typeof options?.line === 'number' && Number.isFinite(options.line)) {
    line = options.line
  } else if (typeof options?.formattedLine === 'string') {
    const parsed = Number(options.formattedLine.replace(',', '.'))
    if (Number.isFinite(parsed)) {
      line = parsed
    }
  }

  const selectionCandidate = entry.selection.trim().toUpperCase().replace(',', '.').replace(/\s+/g, '_')
  const selectionMatch = selectionCandidate.match(/^(OVER|UNDER)(?:_([0-9]+(?:\.[0-9]+)?))?$/)

  if (!line) {
    if (selectionMatch && selectionMatch[2]) {
      const parsed = Number(selectionMatch[2])
      if (Number.isFinite(parsed)) {
        line = parsed
      }
    }
  }

  if (!line || !Number.isFinite(line)) {
    return {
      status: PredictionEntryStatus.CANCELLED,
      awardedPoints: null,
  meta: { reason: 'line_unavailable', selection: entry.selection },
    }
  }

  const formattedLine = typeof options?.formattedLine === 'string' ? options.formattedLine : formatTotalLine(line)
  const expectedOver = `OVER_${formattedLine}`.toUpperCase()
  const expectedUnder = `UNDER_${formattedLine}`.toUpperCase()

  if (!selectionMatch) {
    return {
      status: PredictionEntryStatus.CANCELLED,
      awardedPoints: null,
  meta: { reason: 'selection_malformed', selection: entry.selection, targetLine: line },
    }
  }

  const selectionKind = selectionMatch[1]
  const selectionLine = selectionMatch[2] ? Number(selectionMatch[2]) : null

  if (selectionLine != null && Number.isFinite(selectionLine) && Math.abs(selectionLine - line) > 0.001) {
    return {
      status: PredictionEntryStatus.CANCELLED,
      awardedPoints: null,
      meta: {
        reason: 'line_mismatch',
        selectionLine,
        targetLine: line,
      },
    }
  }

  const normalizedSelection = selectionKind === 'OVER' ? expectedOver : expectedUnder
  const totalGoals = context.totalGoals
  const delta = totalGoals - line

  if (Math.abs(delta) < 0.0001) {
    return {
      status: PredictionEntryStatus.VOID,
      awardedPoints: null,
      meta: {
        outcome: `PUSH_${formattedLine}`,
        totalGoals,
        targetLine: line,
      },
    }
  }

  const actualOutcome = delta > 0 ? expectedOver : expectedUnder
  const won = normalizedSelection === actualOutcome
  // Получаем очки из options.choices для конкретного выбора
  const selectionPoints = getPointsForSelection(options, normalizedSelection, templateContext.basePoints)
  const points = won ? computeAwardedPoints(selectionPoints, templateContext.difficultyMultiplier) : 0

  return {
    status: won ? PredictionEntryStatus.WON : PredictionEntryStatus.LOST,
    awardedPoints: won ? points : 0,
      meta: {
      outcome: actualOutcome,
      totalGoals,
      targetLine: line,
      selectionPoints,
    },
  }
}

const evaluateBooleanMarket = (
  entry: SettlementMatch['predictionTemplates'][number]['entries'][number],
  template: SettlementMatch['predictionTemplates'][number],
  context: SettlementContext,
  templateContext: TemplateContext
): EntryResolution => {
  const options = ensureRecord(template.options)
  if (!options) {
    return {
      status: PredictionEntryStatus.CANCELLED,
      awardedPoints: null,
  meta: { reason: 'options_missing' },
    }
  }

  const yesValue = typeof options.yesValue === 'string' ? options.yesValue : undefined
  const noValue = typeof options.noValue === 'string' ? options.noValue : undefined
  if (!yesValue || !noValue) {
    return {
      status: PredictionEntryStatus.CANCELLED,
      awardedPoints: null,
  meta: { reason: 'options_incomplete' },
    }
  }

  const relatedEventsRaw = Array.isArray(options.relatedEvents) ? options.relatedEvents : []
  const relatedEvents = relatedEventsRaw
    .map(item => (typeof item === 'string' ? item : String(item)))
    .map(value => value.toUpperCase())
  const eventOccurred = relatedEvents.some(eventKey => context.eventTypes.has(eventKey))
  const actualValue = (eventOccurred ? yesValue : noValue).trim().toUpperCase()
  const selection = entry.selection.trim().toUpperCase()

  if (!selection) {
    return {
      status: PredictionEntryStatus.CANCELLED,
      awardedPoints: null,
  meta: { reason: 'selection_empty' },
    }
  }

  const won = selection === actualValue
  // Получаем очки из options.choices для конкретного выбора
  const selectionPoints = getPointsForSelection(options, selection, templateContext.basePoints)
  const points = won ? computeAwardedPoints(selectionPoints, templateContext.difficultyMultiplier) : 0

  return {
    status: won ? PredictionEntryStatus.WON : PredictionEntryStatus.LOST,
    awardedPoints: won ? points : 0,
      meta: {
      eventOccurred,
      actualValue,
      relatedEvents,
      selectionPoints,
    },
  }
}

const evaluateEntry = (
  template: SettlementMatch['predictionTemplates'][number],
  entry: SettlementMatch['predictionTemplates'][number]['entries'][number],
  context: SettlementContext,
  logger: FastifyBaseLogger
): EntryResolution => {
  const templateContext: TemplateContext = {
    basePoints: template.basePoints,
    difficultyMultiplier: toNumber(template.difficultyMultiplier) ?? 1,
  }

  switch (template.marketType) {
    case PredictionMarketType.MATCH_OUTCOME:
      return evaluateOutcome(entry, template, context, templateContext)
    case PredictionMarketType.TOTAL_GOALS:
      return evaluateTotalGoals(entry, template, context, templateContext)
    case PredictionMarketType.CUSTOM_BOOLEAN:
      return evaluateBooleanMarket(entry, template, context, templateContext)
    default:
      logger.warn(
        {
          entryId: entry.id.toString(),
          templateId: template.id.toString(),
          marketType: template.marketType,
        },
        'prediction settlement: unsupported market type'
      )
      return {
        status: PredictionEntryStatus.CANCELLED,
        awardedPoints: null,
  meta: { reason: 'unsupported_market', marketType: template.marketType },
      }
  }
}

const buildSummary = (): SettlementSummary => ({
  userIds: new Set<number>(),
  settled: 0,
  won: 0,
  lost: 0,
  voided: 0,
  cancelled: 0,
  expressSettlements: [],
})

export const settlePredictionEntries = async (
  match: SettlementMatch,
  tx: Prisma.TransactionClient,
  logger: FastifyBaseLogger
): Promise<SettlementSummary> => {
  const summary = buildSummary()

  if (!match.predictionTemplates.length) {
    return summary
  }

  const outcome = determineMatchOutcome(match)
  const totalGoals = Math.max(0, match.homeScore + match.awayScore)
  const eventTypes = new Set<string>()
  for (const event of match.events) {
    eventTypes.add(event.eventType.toUpperCase())
  }

  const context: SettlementContext = {
    outcome,
    totalGoals,
    eventTypes,
    resolvedAt: new Date(),
  }

  for (const template of match.predictionTemplates) {
    if (!template.entries.length) {
      continue
    }

    for (const entry of template.entries) {
      if (entry.status !== PredictionEntryStatus.PENDING) {
        continue
      }

      const resolution = evaluateEntry(template, entry, context, logger)
      const metaPayload: Prisma.JsonObject = {
        matchId: match.id.toString(),
        templateId: template.id.toString(),
        marketType: template.marketType,
        selection: entry.selection,
        basePoints: template.basePoints,
        difficultyMultiplier: toNumber(template.difficultyMultiplier) ?? 1,
        status: resolution.status,
        awardedPoints: resolution.awardedPoints,
        resolvedAt: context.resolvedAt.toISOString(),
      } as Prisma.JsonObject
      const finalMeta: Prisma.JsonObject = resolution.meta
        ? { ...metaPayload, ...resolution.meta }
        : metaPayload

      const updateResult = await tx.predictionEntry.updateMany({
        where: {
          id: entry.id,
          status: PredictionEntryStatus.PENDING,
        },
        data: {
          status: resolution.status,
          scoreAwarded: resolution.awardedPoints,
          resolvedAt: context.resolvedAt,
          resolutionMeta: finalMeta,
        },
      })

      if (updateResult.count === 0) {
        continue
      }

      summary.settled += 1
      summary.userIds.add(entry.userId)

      if (resolution.status === PredictionEntryStatus.WON) {
        summary.won += 1
      } else if (resolution.status === PredictionEntryStatus.LOST) {
        summary.lost += 1
      } else if (resolution.status === PredictionEntryStatus.VOID) {
        summary.voided += 1
      } else if (resolution.status === PredictionEntryStatus.CANCELLED) {
        summary.cancelled += 1
      }

      if (resolution.status === PredictionEntryStatus.CANCELLED && resolution.meta?.reason) {
        logger.warn(
          {
            entryId: entry.id.toString(),
            templateId: template.id.toString(),
            matchId: match.id.toString(),
            reason: resolution.meta.reason,
          },
          'prediction settlement: entry cancelled'
        )
      }
    }
  }

  // Обновляем элементы экспрессов для этого матча
  // Передаём контекст матча чтобы каждый элемент экспресса был расчитан индивидуально
  try {
    const expressIdsToSettle = await updateExpressItemsForMatch(
      match.id,
      { outcome, totalGoals, eventTypes },
      tx,
      logger
    )

    // Расчитываем экспрессы у которых все элементы теперь расчитаны
    for (const expressId of expressIdsToSettle) {
      try {
        const expressResult = await settleExpressBet(expressId, tx, logger)
        if (expressResult) {
          summary.expressSettlements.push(expressResult)
          summary.userIds.add(expressResult.userId)
          // Инвалидируем кэш экспрессов пользователя
          await defaultCache.invalidate(EXPRESS_USER_CACHE_KEY(expressResult.userId)).catch(() => undefined)
        }
      } catch (err) {
        logger.error(
          { err, expressId: expressId.toString(), matchId: match.id.toString() },
          'prediction settlement: failed to settle express bet'
        )
      }
    }
  } catch (err) {
    logger.error(
      { err, matchId: match.id.toString() },
      'prediction settlement: failed to update express items'
    )
  }

  return summary
}
