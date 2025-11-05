import {
  MatchEventType,
  MatchStatus,
  PredictionMarketType,
  Prisma,
  PrismaClient,
} from '@prisma/client'
import prisma from '../db'
import { defaultCache } from '../cache'
import {
  ACTIVE_PREDICTION_CACHE_KEY,
  PREDICTION_MATCH_OUTCOME_BASE_POINTS,
  PREDICTION_PENALTY_EVENT_BASE_POINTS,
  PREDICTION_RED_CARD_EVENT_BASE_POINTS,
  PREDICTION_SPECIAL_EVENT_BASE_DIFFICULTY,
  PREDICTION_TOTAL_GOALS_BASE_POINTS,
  PREDICTION_UPCOMING_MAX_DAYS,
} from './predictionConstants'
import {
  formatTotalLine,
  suggestTotalGoalsLineForMatch,
  PredictionMatchContext,
  TotalGoalsSuggestion,
} from './predictionTotalsService'

const MATCH_OUTCOME_CHOICES = [
  { value: 'ONE', label: 'П1' },
  { value: 'DRAW', label: 'Н' },
  { value: 'TWO', label: 'П2' },
]

type SpecialEventDefinition = {
  eventKey: 'penalty' | 'red_card'
  title: string
  description: string
  yesValue: string
  noValue: string
  yesLabel: string
  noLabel: string
  relatedEvents: MatchEventType[]
  basePoints: number
  difficultyMultiplier: number
}

const SPECIAL_EVENT_DEFINITIONS: SpecialEventDefinition[] = [
  {
    eventKey: 'penalty',
    title: 'Пенальти',
    description: 'Будет ли назначен пенальти',
    yesValue: 'PENALTY_YES',
    noValue: 'PENALTY_NO',
    yesLabel: 'Да',
    noLabel: 'Нет',
    relatedEvents: [MatchEventType.PENALTY_GOAL],
    basePoints: PREDICTION_PENALTY_EVENT_BASE_POINTS,
    difficultyMultiplier: PREDICTION_SPECIAL_EVENT_BASE_DIFFICULTY,
  },
  {
    eventKey: 'red_card',
    title: 'Красная карточка',
    description: 'Покажут ли в матче красную карточку или вторую жёлтую',
    yesValue: 'RED_CARD_YES',
    noValue: 'RED_CARD_NO',
    yesLabel: 'Да',
    noLabel: 'Нет',
    relatedEvents: [MatchEventType.RED_CARD, MatchEventType.SECOND_YELLOW_CARD],
    basePoints: PREDICTION_RED_CARD_EVENT_BASE_POINTS,
    difficultyMultiplier: PREDICTION_SPECIAL_EVENT_BASE_DIFFICULTY,
  },
]

const toPredictionMatchContext = (match: MatchWithTemplates): PredictionMatchContext => ({
  id: match.id,
  matchDateTime: match.matchDateTime ?? new Date(),
  homeTeamId: match.homeTeamId,
  awayTeamId: match.awayTeamId,
  status: match.status,
  isFriendly: match.isFriendly,
})

type TemplateRow = {
  id: bigint
  marketType: PredictionMarketType
  options: Prisma.JsonValue
  basePoints: number
  difficultyMultiplier: Prisma.Decimal
  isManual: boolean
  updatedAt: Date
}

type MatchWithTemplates = {
  id: bigint
  matchDateTime: Date | null
  homeTeamId: number
  awayTeamId: number
  status: MatchStatus
  isFriendly: boolean
  predictionTemplates: TemplateRow[]
}

export type MatchTemplateEnsureSummary = {
  matchId: bigint
  createdMarkets: PredictionMarketType[]
  updatedMarkets: PredictionMarketType[]
  skippedManualMarkets: PredictionMarketType[]
  totalSuggestion?: TotalGoalsSuggestion
  changed: boolean
}

export type PredictionTemplateRangeSummary = {
  matchesProcessed: number
  matchesChanged: number
  templatesCreated: number
  templatesUpdated: number
  totalSuggestions: number
}

const buildMatchOutcomeOptions = (): Prisma.JsonObject => ({
  choices: MATCH_OUTCOME_CHOICES,
  valueType: 'enumeration',
})

const buildSpecialEventOptions = (definition: SpecialEventDefinition): Prisma.JsonObject => ({
  kind: 'match_event_boolean',
  version: 1,
  eventKey: definition.eventKey,
  title: definition.title,
  description: definition.description,
  yesValue: definition.yesValue,
  noValue: definition.noValue,
  relatedEvents: definition.relatedEvents,
  choices: [
    { value: definition.yesValue, label: definition.yesLabel },
    { value: definition.noValue, label: definition.noLabel },
  ],
})

const buildTotalGoalsOptionsForLine = (
  line: number,
  suggestion: TotalGoalsSuggestion
): Prisma.JsonObject => {
  const formattedLine = formatTotalLine(line)
  
  // Рассчитываем вероятность OVER на основе среднего и линии
  const avgGoals = suggestion.averageGoals
  const diff = avgGoals - line
  
  // Простая эвристика: если среднее выше линии - OVER вероятнее, иначе UNDER
  // Используем сигмоиду для расчета вероятности
  const probabilityOver = 1 / (1 + Math.exp(-diff * 2))
  const probabilityUnder = 1 - probabilityOver
  
  // Базовые очки из константы
  const basePoints = PREDICTION_TOTAL_GOALS_BASE_POINTS
  const difficulty = computeTotalDifficultyMultiplier(suggestion)
  
  // Очки обратно пропорциональны вероятности (меньше вероятность = больше очков)
  // Минимальный коэффициент 1.2, максимальный 2.5
  const overMultiplier = Math.max(1.2, Math.min(2.5, 1 / probabilityOver))
  const underMultiplier = Math.max(1.2, Math.min(2.5, 1 / probabilityUnder))
  
  const overPoints = Math.round(basePoints * difficulty * overMultiplier)
  const underPoints = Math.round(basePoints * difficulty * underMultiplier)
  
  const overChoice = { 
    value: `OVER_${formattedLine}`, 
    label: 'Да',
    points: overPoints
  }
  const underChoice = { 
    value: `UNDER_${formattedLine}`, 
    label: 'Нет',
    points: underPoints
  }

  return {
    line,
    formattedLine,
    choices: [overChoice, underChoice],
    sampleSize: suggestion.sampleSize,
    averageGoals: Number(suggestion.averageGoals.toFixed(3)),
    standardDeviation: Number(suggestion.standardDeviation.toFixed(3)),
    confidence: Number(suggestion.confidence.toFixed(3)),
    fallback: suggestion.fallback,
    generatedAt: suggestion.generatedAt.toISOString(),
  }
}

const computeTotalDifficultyMultiplier = (suggestion: TotalGoalsSuggestion): number => {
  if (suggestion.fallback) {
    return 1
  }
  const stdComponent = Math.min(0.75, suggestion.standardDeviation / 3)
  const multiplier = 1 + stdComponent
  return Number(multiplier.toFixed(2))
}

const jsonEquals = (left: Prisma.JsonValue, right: Prisma.JsonValue): boolean => {
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch (_err) {
    return false
  }
}

const extractEventKey = (options: Prisma.JsonValue): string | undefined => {
  if (!options || typeof options !== 'object') {
    return undefined
  }
  const record = options as Record<string, unknown>
  const key = record.eventKey
  return typeof key === 'string' && key.length > 0 ? key : undefined
}

const ensurePredictionTemplatesForMatchRecord = async (
  match: MatchWithTemplates,
  client: PrismaClient | Prisma.TransactionClient
): Promise<MatchTemplateEnsureSummary> => {
  if (match.status !== MatchStatus.SCHEDULED) {
    return {
      matchId: match.id,
      createdMarkets: [],
      updatedMarkets: [],
      skippedManualMarkets: [],
      changed: false,
      totalSuggestion: undefined,
    }
  }

  const existingByMarket = new Map<PredictionMarketType, TemplateRow>()
  const existingSpecialByEvent = new Map<string, TemplateRow>()
  for (const template of match.predictionTemplates) {
    existingByMarket.set(template.marketType, template)
    if (template.marketType === PredictionMarketType.CUSTOM_BOOLEAN) {
      const eventKey = extractEventKey(template.options)
      if (eventKey) {
        existingSpecialByEvent.set(eventKey, template)
      }
    }
  }

  const createdMarkets: PredictionMarketType[] = []
  const updatedMarkets: PredictionMarketType[] = []
  const skippedManual: PredictionMarketType[] = []

  const desiredOutcomeOptions = buildMatchOutcomeOptions()
  const outcomeTemplate = existingByMarket.get(PredictionMarketType.MATCH_OUTCOME)
  if (!outcomeTemplate) {
    await client.predictionTemplate.create({
      data: {
        matchId: match.id,
        marketType: PredictionMarketType.MATCH_OUTCOME,
        options: desiredOutcomeOptions,
        basePoints: PREDICTION_MATCH_OUTCOME_BASE_POINTS,
        difficultyMultiplier: 1,
        isManual: false,
      },
    })
    createdMarkets.push(PredictionMarketType.MATCH_OUTCOME)
  } else if (outcomeTemplate.isManual) {
    skippedManual.push(PredictionMarketType.MATCH_OUTCOME)
  } else {
    const needsUpdate =
      outcomeTemplate.basePoints !== PREDICTION_MATCH_OUTCOME_BASE_POINTS
        || outcomeTemplate.difficultyMultiplier.toNumber() !== 1
        || !jsonEquals(outcomeTemplate.options, desiredOutcomeOptions)
    if (needsUpdate) {
      await client.predictionTemplate.update({
        where: { id: outcomeTemplate.id },
        data: {
          options: desiredOutcomeOptions,
          basePoints: PREDICTION_MATCH_OUTCOME_BASE_POINTS,
          difficultyMultiplier: 1,
        },
      })
      updatedMarkets.push(PredictionMarketType.MATCH_OUTCOME)
    }
  }

  const suggestion = await suggestTotalGoalsLineForMatch(toPredictionMatchContext(match), client)
  if (!suggestion) {
    return {
      matchId: match.id,
      createdMarkets,
      updatedMarkets,
      skippedManualMarkets: skippedManual,
      changed: createdMarkets.length > 0 || updatedMarkets.length > 0,
      totalSuggestion: undefined,
    }
  }

  // Создаем 3 отдельных template для тоталов (используя alternatives из suggestion)
  const totalLines = suggestion.alternatives.map(alt => alt.line)
  const desiredTotalDifficulty = computeTotalDifficultyMultiplier(suggestion)
  
  // Получаем существующие TOTAL_GOALS templates
  const existingTotals = match.predictionTemplates.filter(
    t => t.marketType === PredictionMarketType.TOTAL_GOALS
  )
  
  // Создаем Map существующих по линии
  const existingByLine = new Map<number, TemplateRow>()
  for (const template of existingTotals) {
    const options = template.options as Record<string, unknown> | null
    if (options && typeof options.line === 'number') {
      existingByLine.set(options.line, template)
    }
  }
  
  // Создаем или обновляем template для каждой линии
  for (const line of totalLines) {
    const desiredOptions = buildTotalGoalsOptionsForLine(line, suggestion)
    const existing = existingByLine.get(line)
    
    if (!existing) {
      await client.predictionTemplate.create({
        data: {
          matchId: match.id,
          marketType: PredictionMarketType.TOTAL_GOALS,
          options: desiredOptions,
          basePoints: PREDICTION_TOTAL_GOALS_BASE_POINTS,
          difficultyMultiplier: desiredTotalDifficulty,
          isManual: false,
        },
      })
      createdMarkets.push(PredictionMarketType.TOTAL_GOALS)
    } else if (existing.isManual) {
      skippedManual.push(PredictionMarketType.TOTAL_GOALS)
    } else {
      const needsUpdate =
        existing.basePoints !== PREDICTION_TOTAL_GOALS_BASE_POINTS
          || Math.abs(existing.difficultyMultiplier.toNumber() - desiredTotalDifficulty) > 0.01
          || !jsonEquals(existing.options, desiredOptions)

      if (needsUpdate) {
        await client.predictionTemplate.update({
          where: { id: existing.id },
          data: {
            options: desiredOptions,
            basePoints: PREDICTION_TOTAL_GOALS_BASE_POINTS,
            difficultyMultiplier: desiredTotalDifficulty,
          },
        })
        updatedMarkets.push(PredictionMarketType.TOTAL_GOALS)
      }
    }
  }
  
  // Удаляем старые template с линиями, которых нет в новом списке
  for (const template of existingTotals) {
    if (template.isManual) continue
    const options = template.options as Record<string, unknown> | null
    const line = options && typeof options.line === 'number' ? options.line : null
    if (line !== null && !totalLines.includes(line)) {
      await client.predictionTemplate.delete({
        where: { id: template.id },
      })
    }
  }

  for (const definition of SPECIAL_EVENT_DEFINITIONS) {
    const desiredOptions = buildSpecialEventOptions(definition)
    const existing = existingSpecialByEvent.get(definition.eventKey)

    if (!existing) {
      await client.predictionTemplate.create({
        data: {
          matchId: match.id,
          marketType: PredictionMarketType.CUSTOM_BOOLEAN,
          options: desiredOptions,
          basePoints: definition.basePoints,
          difficultyMultiplier: definition.difficultyMultiplier,
          isManual: false,
        },
      })
      createdMarkets.push(PredictionMarketType.CUSTOM_BOOLEAN)
      continue
    }

    if (existing.isManual) {
      skippedManual.push(PredictionMarketType.CUSTOM_BOOLEAN)
      continue
    }

    const needsUpdate =
      existing.basePoints !== definition.basePoints
        || Math.abs(existing.difficultyMultiplier.toNumber() - definition.difficultyMultiplier) > 0.01
        || !jsonEquals(existing.options, desiredOptions)

    if (needsUpdate) {
      await client.predictionTemplate.update({
        where: { id: existing.id },
        data: {
          options: desiredOptions,
          basePoints: definition.basePoints,
          difficultyMultiplier: definition.difficultyMultiplier,
          isManual: false,
        },
      })
      updatedMarkets.push(PredictionMarketType.CUSTOM_BOOLEAN)
    }
  }

  return {
    matchId: match.id,
    createdMarkets,
    updatedMarkets,
    skippedManualMarkets: skippedManual,
    changed: createdMarkets.length > 0 || updatedMarkets.length > 0,
    totalSuggestion: suggestion,
  }
}

export const invalidateUpcomingPredictionCaches = async (excludeDays?: Set<number>) => {
  const tasks: Promise<unknown>[] = []
  for (let day = 1; day <= PREDICTION_UPCOMING_MAX_DAYS; day += 1) {
    if (excludeDays?.has(day)) {
      continue
    }
    tasks.push(
      defaultCache
        .invalidate(ACTIVE_PREDICTION_CACHE_KEY(day))
        .catch(() => undefined)
    )
  }
  await Promise.all(tasks)
}

export const ensurePredictionTemplatesForMatch = async (
  matchId: bigint,
  client: PrismaClient | Prisma.TransactionClient = prisma,
  options?: { excludeDaysFromCacheInvalidation?: Set<number> }
): Promise<MatchTemplateEnsureSummary> => {
  const match = await client.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      matchDateTime: true,
      homeTeamId: true,
      awayTeamId: true,
      status: true,
      isFriendly: true,
      predictionTemplates: {
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!match) {
    return {
      matchId,
      createdMarkets: [],
      updatedMarkets: [],
      skippedManualMarkets: [],
      changed: false,
      totalSuggestion: undefined,
    }
  }

  const summary = await ensurePredictionTemplatesForMatchRecord(match, client)

  if (summary.changed) {
    await invalidateUpcomingPredictionCaches(options?.excludeDaysFromCacheInvalidation)
  }

  return summary
}

export const ensurePredictionTemplatesInRange = async (
  params: {
    from: Date
    to: Date
    client?: PrismaClient | Prisma.TransactionClient
    excludeDaysFromCacheInvalidation?: Set<number>
  }
): Promise<PredictionTemplateRangeSummary> => {
  const { from, to, client: clientOverride, excludeDaysFromCacheInvalidation } = params
  const client = clientOverride ?? prisma

  const matches = await client.match.findMany({
    where: {
      status: MatchStatus.SCHEDULED,
      matchDateTime: {
        gte: from,
        lte: to,
      },
    },
    orderBy: { matchDateTime: 'asc' },
    select: {
      id: true,
      matchDateTime: true,
      homeTeamId: true,
      awayTeamId: true,
      status: true,
      isFriendly: true,
      predictionTemplates: {
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!matches.length) {
    return {
      matchesProcessed: 0,
      matchesChanged: 0,
      templatesCreated: 0,
      templatesUpdated: 0,
      totalSuggestions: 0,
    }
  }

  let matchesChanged = 0
  let templatesCreated = 0
  let templatesUpdated = 0
  let totalSuggestions = 0

  for (const match of matches) {
    const result = await ensurePredictionTemplatesForMatchRecord(match, client)
    if (result.changed) {
      matchesChanged += 1
      templatesCreated += result.createdMarkets.length
      templatesUpdated += result.updatedMarkets.length
    }
    if (result.totalSuggestion) {
      totalSuggestions += 1
    }
  }

  if (matchesChanged > 0) {
    await invalidateUpcomingPredictionCaches(excludeDaysFromCacheInvalidation)
  }

  return {
    matchesProcessed: matches.length,
    matchesChanged,
    templatesCreated,
    templatesUpdated,
    totalSuggestions,
  }
}
