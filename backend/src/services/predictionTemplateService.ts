import { MatchStatus, PredictionMarketType, Prisma, PrismaClient } from '@prisma/client'
import prisma from '../db'
import { defaultCache } from '../cache'
import {
  ACTIVE_PREDICTION_CACHE_KEY,
  PREDICTION_MATCH_OUTCOME_BASE_POINTS,
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
  { value: 'ONE', label: 'Победа хозяев' },
  { value: 'DRAW', label: 'Ничья' },
  { value: 'TWO', label: 'Победа гостей' },
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

const buildTotalGoalsOptions = (suggestion: TotalGoalsSuggestion): Prisma.JsonObject => {
  const formattedLine = formatTotalLine(suggestion.line)
  const overChoice = { value: `OVER_${formattedLine}`, label: `Больше ${formattedLine}` }
  const underChoice = { value: `UNDER_${formattedLine}`, label: `Меньше ${formattedLine}` }

  return {
    line: suggestion.line,
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
  for (const template of match.predictionTemplates) {
    existingByMarket.set(template.marketType, template)
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

  const totalTemplate = existingByMarket.get(PredictionMarketType.TOTAL_GOALS)
  const desiredTotalOptions = buildTotalGoalsOptions(suggestion)
  const desiredTotalDifficulty = computeTotalDifficultyMultiplier(suggestion)

  if (!totalTemplate) {
    await client.predictionTemplate.create({
      data: {
        matchId: match.id,
        marketType: PredictionMarketType.TOTAL_GOALS,
        options: desiredTotalOptions,
        basePoints: PREDICTION_TOTAL_GOALS_BASE_POINTS,
        difficultyMultiplier: desiredTotalDifficulty,
        isManual: false,
      },
    })
    createdMarkets.push(PredictionMarketType.TOTAL_GOALS)
  } else if (totalTemplate.isManual) {
    skippedManual.push(PredictionMarketType.TOTAL_GOALS)
  } else {
    const needsUpdate =
      totalTemplate.basePoints !== PREDICTION_TOTAL_GOALS_BASE_POINTS
        || Math.abs(totalTemplate.difficultyMultiplier.toNumber() - desiredTotalDifficulty) > 0.01
        || !jsonEquals(totalTemplate.options, desiredTotalOptions)

    if (needsUpdate) {
      await client.predictionTemplate.update({
        where: { id: totalTemplate.id },
        data: {
          options: desiredTotalOptions,
          basePoints: PREDICTION_TOTAL_GOALS_BASE_POINTS,
          difficultyMultiplier: desiredTotalDifficulty,
        },
      })
      updatedMarkets.push(PredictionMarketType.TOTAL_GOALS)
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
