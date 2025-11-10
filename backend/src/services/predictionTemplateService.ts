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
  PREDICTION_POINTS_BUDGET_MATCH_OUTCOME,
  PREDICTION_POINTS_BUDGET_TOTAL_GOALS,
  PREDICTION_POINTS_BUDGET_PENALTY,
  PREDICTION_POINTS_BUDGET_RED_CARD,
  PREDICTION_PENALTY_DEFAULT_RATE,
  PREDICTION_RED_CARD_DEFAULT_RATE,
  PREDICTION_UPCOMING_MAX_DAYS,
} from './predictionConstants'
import {
  formatTotalLine,
  suggestTotalGoalsLineForMatch,
  PredictionMatchContext,
  TotalGoalsSuggestion,
} from './predictionTotalsService'

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
    relatedEvents: [MatchEventType.PENALTY_GOAL, MatchEventType.PENALTY_MISSED],
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

const MIN_PROBABILITY = 0.01
const MAX_PROBABILITY = 0.99

const RECENT_MATCH_WEIGHTS = [1.5, 1.3, 1.1, 0.9, 0.5]
const DEFAULT_DRAW_RATE = 0.22
const MIN_STRENGTH_VALUE = 0.2
const SEASON_STRENGTH_WEIGHT = 0.6
const DRAW_PRIOR_WEIGHT_SEASON = 8
const DRAW_PRIOR_WEIGHT_TEAM = 3

type ProbabilityEntry = {
  key: string
  label: string
  probability: number
}

const clampProbability = (value: number | null | undefined): number => {
  if (!Number.isFinite(value)) {
    return MIN_PROBABILITY
  }
  if (value === null || value === undefined) {
    return MIN_PROBABILITY
  }
  if (value <= 0) {
    return MIN_PROBABILITY
  }
  if (value >= 1) {
    return MAX_PROBABILITY
  }
  return value
}

const distributeInverseProbabilityPoints = (
  entries: ProbabilityEntry[],
  totalPoints: number
): Map<string, number> => {
  const allocation = new Map<string, number>()
  if (!entries.length || totalPoints <= 0) {
    return allocation
  }

  const normalized = entries.map(entry => ({
    key: entry.key,
    label: entry.label,
    probability: clampProbability(entry.probability),
  }))

  const weights = normalized.map(entry => 1 / entry.probability)
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0)
  const positiveSum = Number.isFinite(weightSum) && weightSum > 0

  if (totalPoints <= normalized.length) {
    const ordering = normalized
      .map((entry, index) => ({
        index,
        priority: positiveSum ? weights[index] : 1,
      }))
      .sort((left, right) => {
        if (right.priority === left.priority) {
          return left.index - right.index
        }
        return right.priority - left.priority
      })

    const points: number[] = normalized.map(() => 0)
    for (let i = 0; i < totalPoints; i += 1) {
      const target = ordering[i % ordering.length]
      points[target.index] += 1
    }
    normalized.forEach((entry, index) => {
      allocation.set(entry.key, points[index])
    })
    return allocation
  }

  const points: number[] = normalized.map(() => 1)
  const remainingPoints = totalPoints - normalized.length
  if (remainingPoints <= 0) {
    normalized.forEach((entry, index) => allocation.set(entry.key, points[index]))
    return allocation
  }

  const distributions = normalized.map((entry, index) => {
    const share = positiveSum ? weights[index] / weightSum : 1 / normalized.length
    const exact = remainingPoints * share
    const base = Math.floor(exact)
    points[index] += base
    return {
      index,
      remainder: exact - base,
    }
  })

  const assigned = points.reduce((sum, value) => sum + value, 0)
  const deficit = totalPoints - assigned
  if (deficit > 0) {
    distributions.sort((left, right) => {
      if (right.remainder === left.remainder) {
        return left.index - right.index
      }
      return right.remainder - left.remainder
    })
    for (let i = 0; i < deficit; i += 1) {
      const target = distributions[i % distributions.length]
      points[target.index] += 1
    }
  }

  normalized.forEach((entry, index) => {
    allocation.set(entry.key, points[index])
  })

  return allocation
}

type MatchRow = {
  id: bigint
  homeTeamId: number
  awayTeamId: number
  homeScore: number
  awayScore: number
}

type SeasonStrengthRow = {
  clubId: number
  points: number
  wins: number
  losses: number
  goalsFor: number
  goalsAgainst: number
}

const toMatchRow = (row: {
  id: bigint
  homeTeamId: number
  awayTeamId: number
  homeScore: number
  awayScore: number
}): MatchRow => ({
  id: row.id,
  homeTeamId: row.homeTeamId,
  awayTeamId: row.awayTeamId,
  homeScore: row.homeScore,
  awayScore: row.awayScore,
})

const buildSeasonStrengthMap = (rows: SeasonStrengthRow[]): Map<number, number> => {
  if (!rows.length) {
    return new Map()
  }

  const sorted = [...rows].sort((left, right) => {
    if (right.points !== left.points) {
      return right.points - left.points
    }
    const leftDiff = left.goalsFor - left.goalsAgainst
    const rightDiff = right.goalsFor - right.goalsAgainst
    if (rightDiff !== leftDiff) {
      return rightDiff - leftDiff
    }
    return right.goalsFor - left.goalsFor
  })

  const totalClubs = sorted.length
  const maxPoints = sorted.reduce((max, row) => Math.max(max, row.points), 0)
  const maxGoalDiff = sorted.reduce((max, row) => {
    const diff = Math.abs(row.goalsFor - row.goalsAgainst)
    return Math.max(max, diff)
  }, 0)

  const scaleGoalDiff = (value: number): number => {
    if (maxGoalDiff === 0) {
      return 0.5
    }
    const normalized = (value + maxGoalDiff) / (2 * maxGoalDiff)
    return Math.min(Math.max(normalized, 0), 1)
  }

  const strengths = new Map<number, number>()
  for (let index = 0; index < sorted.length; index += 1) {
    const row = sorted[index]
    const positionScore = totalClubs > 1 ? 1 - index / (totalClubs - 1) : 1
    const pointsScore = maxPoints > 0 ? row.points / maxPoints : 0.5
    const goalDiffScore = scaleGoalDiff(row.goalsFor - row.goalsAgainst)
    const composite = 0.5 * pointsScore + 0.3 * positionScore + 0.2 * goalDiffScore
    strengths.set(row.clubId, Math.max(MIN_STRENGTH_VALUE, Math.min(1, composite)))
  }

  return strengths
}

const combineStrengthComponents = (
  seasonStrength: number | undefined,
  recentStrength: number | undefined
): number => {
  const seasonValid = typeof seasonStrength === 'number' && Number.isFinite(seasonStrength)
  const recentValid = typeof recentStrength === 'number' && Number.isFinite(recentStrength)

  if (seasonValid && recentValid) {
    const seasonValue = seasonStrength as number
    const recentValue = recentStrength as number
    const value = SEASON_STRENGTH_WEIGHT * seasonValue + (1 - SEASON_STRENGTH_WEIGHT) * recentValue
    return Math.max(MIN_STRENGTH_VALUE, Math.min(1, value))
  }

  if (seasonValid) {
    const value = seasonStrength as number
    return Math.max(MIN_STRENGTH_VALUE, Math.min(1, value))
  }

  if (recentValid) {
    const value = recentStrength as number
    return Math.max(MIN_STRENGTH_VALUE, Math.min(1, value))
  }

  return 0.5
}

const getMatchPointsForTeam = (match: MatchRow, teamId: number): number => {
  const homeGoals = Number(match.homeScore)
  const awayGoals = Number(match.awayScore)
  if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) {
    return 0
  }
  if (match.homeTeamId === teamId) {
    if (homeGoals > awayGoals) return 3
    if (homeGoals === awayGoals) return 1
    return 0
  }
  if (match.awayTeamId === teamId) {
    if (awayGoals > homeGoals) return 3
    if (homeGoals === awayGoals) return 1
    return 0
  }
  return 0
}

const computeWeightedTeamStrength = (matches: MatchRow[], teamId: number): number => {
  if (!matches.length) {
    return 0.5
  }

  let weightedPoints = 0
  let totalWeight = 0

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    const weight = RECENT_MATCH_WEIGHTS[index] ?? RECENT_MATCH_WEIGHTS[RECENT_MATCH_WEIGHTS.length - 1]
    const points = getMatchPointsForTeam(match, teamId)
    weightedPoints += points * weight
    totalWeight += weight
  }

  if (totalWeight === 0) {
    return 0.5
  }

  const normalized = weightedPoints / (3 * totalWeight)
  return Math.max(MIN_STRENGTH_VALUE, Math.min(1, normalized))
}

const smoothRate = (successes: number, trials: number, priorRate: number, priorWeight: number): number => {
  if (!Number.isFinite(trials) || trials < 0) {
    return priorRate
  }
  if (trials === 0) {
    return priorRate
  }
  return (successes + priorRate * priorWeight) / (trials + priorWeight)
}

const computeDrawRateForMatch = async (
  match: MatchWithTemplates,
  client: PrismaClient | Prisma.TransactionClient,
  recentMatches: MatchRow[]
): Promise<number> => {
  let seasonRate: number | null = null
  const baseline = DEFAULT_DRAW_RATE

  if (match.seasonId) {
    const seasonMatches = await client.match.findMany({
      where: {
        seasonId: match.seasonId,
        status: MatchStatus.FINISHED,
        isFriendly: false,
      },
      select: {
        homeScore: true,
        awayScore: true,
      },
    })

    if (seasonMatches.length > 0) {
      const draws = seasonMatches.filter(row => Number(row.homeScore) === Number(row.awayScore)).length
      const rate = smoothRate(draws, seasonMatches.length, baseline, DRAW_PRIOR_WEIGHT_SEASON)
      seasonRate = clampProbability(rate)
    }
  }

  let teamRate: number | null = null
  if (recentMatches.length > 0) {
    const draws = recentMatches.filter(row => Number(row.homeScore) === Number(row.awayScore)).length
    const prior = seasonRate ?? baseline
    const rate = smoothRate(draws, recentMatches.length, prior, DRAW_PRIOR_WEIGHT_TEAM)
    teamRate = clampProbability(rate)
  }

  if (seasonRate !== null && teamRate !== null) {
    return clampProbability(seasonRate * 0.6 + teamRate * 0.4)
  }
  if (seasonRate !== null) {
    return seasonRate
  }
  if (teamRate !== null) {
    return teamRate
  }
  return clampProbability(baseline)
}

const erf = (x: number): number => {
  const sign = Math.sign(x)
  const absX = Math.abs(x)
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911
  const t = 1 / (1 + p * absX)
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX)
  return sign * y
}

const normalCdf = (value: number, mean: number, std: number): number => {
  if (!Number.isFinite(value) || !Number.isFinite(mean) || !Number.isFinite(std) || std <= 0) {
    return 0.5
  }
  const z = (value - mean) / (std * Math.SQRT2)
  return 0.5 * (1 + erf(z))
}

const computeTotalChoiceProbabilities = (
  line: number,
  suggestion: TotalGoalsSuggestion
): { over: number; under: number } => {
  const meanGoals = Number.isFinite(suggestion.averageGoals) ? suggestion.averageGoals : line
  const stdGoals = Math.max(Number.isFinite(suggestion.standardDeviation) ? suggestion.standardDeviation : 0.5, 0.2)

  const rawUnder = normalCdf(line, meanGoals, stdGoals)
  const rawOver = 1 - rawUnder

  const sampleWeight = Math.max(0, Math.min(1, suggestion.sampleSize / 8))
  const blendedOver = rawOver * sampleWeight + 0.5 * (1 - sampleWeight)
  const blendedUnder = rawUnder * sampleWeight + 0.5 * (1 - sampleWeight)

  let over = Math.min(Math.max(blendedOver, MIN_PROBABILITY), MAX_PROBABILITY)
  let under = Math.min(Math.max(blendedUnder, MIN_PROBABILITY), MAX_PROBABILITY)

  const normalization = over + under
  if (normalization > 0) {
    over /= normalization
    under /= normalization
  } else {
    over = 0.5
    under = 0.5
  }

  return {
    over,
    under,
  }
}

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
  seasonId: number | null
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

/**
 * Рассчитывает динамические очки для вариантов исхода матча на основе статистики команд
 */
const calculateMatchOutcomePoints = async (
  match: MatchWithTemplates,
  client: PrismaClient | Prisma.TransactionClient
): Promise<Array<{ value: string; label: string; points: number; probability: number }>> => {
  // Получаем статистику команд за последние 5 матчей
  const recentMatchesCount = 5
  const homeStatsRaw = await client.match.findMany({
    where: {
      OR: [
        { homeTeamId: match.homeTeamId },
        { awayTeamId: match.homeTeamId },
      ],
      status: MatchStatus.FINISHED,
      isFriendly: false,
    },
    select: {
      id: true,
      homeTeamId: true,
      awayTeamId: true,
      homeScore: true,
      awayScore: true,
    },
    orderBy: { matchDateTime: 'desc' },
    take: recentMatchesCount,
  })

  const awayStatsRaw = await client.match.findMany({
    where: {
      OR: [
        { homeTeamId: match.awayTeamId },
        { awayTeamId: match.awayTeamId },
      ],
      status: MatchStatus.FINISHED,
      isFriendly: false,
    },
    select: {
      id: true,
      homeTeamId: true,
      awayTeamId: true,
      homeScore: true,
      awayScore: true,
    },
    orderBy: { matchDateTime: 'desc' },
    take: recentMatchesCount,
  })

  const homeStats = homeStatsRaw.map(toMatchRow)
  const awayStats = awayStatsRaw.map(toMatchRow)

  const combinedRecentMatchesMap = new Map<bigint, MatchRow>()
  for (const row of homeStats) {
    combinedRecentMatchesMap.set(row.id, row)
  }
  for (const row of awayStats) {
    if (!combinedRecentMatchesMap.has(row.id)) {
      combinedRecentMatchesMap.set(row.id, row)
    }
  }
  const combinedRecentMatches = Array.from(combinedRecentMatchesMap.values())

  let seasonStrengths: Map<number, number> | null = null
  if (match.seasonId) {
    const seasonRows = await client.clubSeasonStats.findMany({
      where: { seasonId: match.seasonId },
      select: {
        clubId: true,
        points: true,
        wins: true,
        losses: true,
        goalsFor: true,
        goalsAgainst: true,
      },
    })
    seasonStrengths = buildSeasonStrengthMap(seasonRows)
  }

  const homeSeasonStrength = seasonStrengths?.get(match.homeTeamId)
  const awaySeasonStrength = seasonStrengths?.get(match.awayTeamId)
  const homeRecentStrength = computeWeightedTeamStrength(homeStats, match.homeTeamId)
  const awayRecentStrength = computeWeightedTeamStrength(awayStats, match.awayTeamId)
  const homeStrength = combineStrengthComponents(homeSeasonStrength, homeRecentStrength)
  const awayStrength = combineStrengthComponents(awaySeasonStrength, awayRecentStrength)
  const drawRate = await computeDrawRateForMatch(match, client, combinedRecentMatches)

  const adjustedHomeStrength = Math.max(MIN_STRENGTH_VALUE, homeStrength * 1.1)
  const adjustedAwayStrength = Math.max(MIN_STRENGTH_VALUE, awayStrength)

  const rawTotalStrength = adjustedHomeStrength + adjustedAwayStrength + drawRate
  const fallbackTotal = adjustedHomeStrength + adjustedAwayStrength + clampProbability(DEFAULT_DRAW_RATE)
  const totalStrength = Number.isFinite(rawTotalStrength) && rawTotalStrength > 0 ? rawTotalStrength : fallbackTotal

  const probHome = adjustedHomeStrength / totalStrength
  const probAway = adjustedAwayStrength / totalStrength
  const probDraw = drawRate / totalStrength

  const distribution = [
    { key: 'ONE', label: 'П1', probability: clampProbability(probHome) },
    { key: 'DRAW', label: 'Н', probability: clampProbability(probDraw) },
    { key: 'TWO', label: 'П2', probability: clampProbability(probAway) },
  ]

  const pointsMap = distributeInverseProbabilityPoints(
    distribution.map(item => ({ key: item.key, label: item.label, probability: item.probability })),
    PREDICTION_POINTS_BUDGET_MATCH_OUTCOME
  )

  return distribution.map(item => ({
    value: item.key,
    label: item.label,
    probability: Number(item.probability.toFixed(3)),
    points: pointsMap.get(item.key) ?? PREDICTION_MATCH_OUTCOME_BASE_POINTS,
  }))
}

const buildMatchOutcomeOptions = async (
  match: MatchWithTemplates,
  client: PrismaClient | Prisma.TransactionClient
): Promise<Prisma.JsonObject> => {
  const choices = await calculateMatchOutcomePoints(match, client)
  return {
    choices,
    valueType: 'enumeration',
  }
}

/**
 * Рассчитывает динамические очки для событий пенальти/красных карточек
 */
const computeSpecialEventProbability = async (
  match: MatchWithTemplates,
  definition: SpecialEventDefinition,
  client: PrismaClient | Prisma.TransactionClient
): Promise<{ yes: number; no: number; sampleSize: number }> => {
  // Получаем статистику событий за последние матчи команд
  const recentMatchesCount = 5
  const homeMatchIds = await client.match.findMany({
    where: {
      OR: [
        { homeTeamId: match.homeTeamId },
        { awayTeamId: match.homeTeamId },
      ],
      status: MatchStatus.FINISHED,
      isFriendly: false,
    },
    select: { id: true },
    orderBy: { matchDateTime: 'desc' },
    take: recentMatchesCount,
  })

  const awayMatchIds = await client.match.findMany({
    where: {
      OR: [
        { homeTeamId: match.awayTeamId },
        { awayTeamId: match.awayTeamId },
      ],
      status: MatchStatus.FINISHED,
      isFriendly: false,
    },
    select: { id: true },
    orderBy: { matchDateTime: 'desc' },
    take: recentMatchesCount,
  })

  const allMatchIds = [...new Set([...homeMatchIds.map(m => m.id), ...awayMatchIds.map(m => m.id)])]

  const defaultRate = definition.eventKey === 'penalty'
    ? PREDICTION_PENALTY_DEFAULT_RATE
    : PREDICTION_RED_CARD_DEFAULT_RATE

  let clubRate: number | null = null
  if (allMatchIds.length > 0) {
    const eventsCount = await client.matchEvent.count({
      where: {
        matchId: { in: allMatchIds },
        eventType: { in: definition.relatedEvents },
      },
    })
    clubRate = eventsCount / allMatchIds.length
  }

  let seasonRate: number | null = null
  if (match.seasonId) {
    const seasonMatchCount = await client.match.count({
      where: {
        seasonId: match.seasonId,
        status: MatchStatus.FINISHED,
        isFriendly: false,
      },
    })
    if (seasonMatchCount > 0) {
      const seasonEventsCount = await client.matchEvent.count({
        where: {
          eventType: { in: definition.relatedEvents },
          match: {
            seasonId: match.seasonId,
            status: MatchStatus.FINISHED,
            isFriendly: false,
          },
        },
      })
      seasonRate = seasonEventsCount / seasonMatchCount
    }
  }

  let finalRate: number
  if (clubRate !== null && seasonRate !== null) {
    const clubRatio = Math.min(1, allMatchIds.length / recentMatchesCount)
    const clubWeight = 0.7 * clubRatio
    const seasonWeight = 1 - clubWeight
    finalRate = clubWeight * clubRate + seasonWeight * seasonRate
  } else if (clubRate !== null) {
    finalRate = clubRate
  } else if (seasonRate !== null) {
    finalRate = seasonRate
  } else {
    finalRate = defaultRate
  }

  const yesProbability = clampProbability(finalRate)
  return {
    yes: yesProbability,
    no: clampProbability(1 - yesProbability),
    sampleSize: allMatchIds.length,
  }
}

const buildSpecialEventOptions = async (
  match: MatchWithTemplates,
  definition: SpecialEventDefinition,
  client: PrismaClient | Prisma.TransactionClient
): Promise<Prisma.JsonObject> => {
  const probability = await computeSpecialEventProbability(match, definition, client)
  const budget = definition.eventKey === 'penalty'
    ? PREDICTION_POINTS_BUDGET_PENALTY
    : PREDICTION_POINTS_BUDGET_RED_CARD

  const entries: ProbabilityEntry[] = [
    {
      key: definition.yesValue,
      label: definition.yesLabel,
      probability: probability.yes,
    },
    {
      key: definition.noValue,
      label: definition.noLabel,
      probability: probability.no,
    },
  ]

  const pointsMap = distributeInverseProbabilityPoints(entries, budget)
  return {
    kind: 'match_event_boolean',
    version: 1,
    eventKey: definition.eventKey,
    title: definition.title,
    description: definition.description,
    yesValue: definition.yesValue,
    noValue: definition.noValue,
    relatedEvents: definition.relatedEvents,
    sampleSize: probability.sampleSize,
    eventProbability: Number(probability.yes.toFixed(3)),
    choices: [
      {
        value: definition.yesValue,
        label: definition.yesLabel,
        points: pointsMap.get(definition.yesValue) ?? definition.basePoints,
        probability: Number(probability.yes.toFixed(3)),
      },
      {
        value: definition.noValue,
        label: definition.noLabel,
        points: pointsMap.get(definition.noValue) ?? definition.basePoints,
        probability: Number(probability.no.toFixed(3)),
      },
    ],
  }
}

const buildTotalGoalsOptionsForLine = (
  line: number,
  suggestion: TotalGoalsSuggestion,
  pointsBySelection: Map<string, number>,
  deltaOverride?: number
): Prisma.JsonObject => {
  const formattedLine = formatTotalLine(line)
  const normalizedBase = Number(formatTotalLine(suggestion.line))
  const resolvedDelta = (() => {
    if (typeof deltaOverride === 'number' && Number.isFinite(deltaOverride)) {
      return Number((Math.round(deltaOverride * 10) / 10).toFixed(1))
    }
    const diff = line - normalizedBase
    return Number((Math.round(diff * 10) / 10).toFixed(1))
  })()
  const probability = computeTotalChoiceProbabilities(line, suggestion)
  const overValue = `OVER_${formattedLine}`
  const underValue = `UNDER_${formattedLine}`
  const overPoints = pointsBySelection.get(overValue) ?? PREDICTION_TOTAL_GOALS_BASE_POINTS
  const underPoints = pointsBySelection.get(underValue) ?? PREDICTION_TOTAL_GOALS_BASE_POINTS
  
  return {
    line,
    formattedLine,
    delta: resolvedDelta,
    choices: [
      {
        value: overValue,
        label: 'Больше',
        points: overPoints,
        probability: Number(probability.over.toFixed(3)),
      },
      {
        value: underValue,
        label: 'Меньше',
        points: underPoints,
        probability: Number(probability.under.toFixed(3)),
      },
    ],
    sampleSize: suggestion.sampleSize,
    averageGoals: Number(suggestion.averageGoals.toFixed(3)),
    standardDeviation: Number(suggestion.standardDeviation.toFixed(3)),
    confidence: Number(suggestion.confidence.toFixed(3)),
    fallback: suggestion.fallback,
    generatedAt: suggestion.generatedAt.toISOString(),
    probabilityOver: Number(probability.over.toFixed(3)),
    probabilityUnder: Number(probability.under.toFixed(3)),
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
    const normalize = (value: Prisma.JsonValue): unknown => {
      if (value === null || value === undefined) {
        return value
      }
      if (Array.isArray(value)) {
        return value.map(item => normalize(item))
      }
      if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, Prisma.JsonValue>)
          .filter(([key]) => key !== 'generatedAt')
          .sort(([a], [b]) => a.localeCompare(b))

        const normalized: Record<string, unknown> = {}
        for (const [key, val] of entries) {
          normalized[key] = normalize(val)
        }
        return normalized
      }
      return value
    }

    const leftNormalized = normalize(left)
    const rightNormalized = normalize(right)
    return JSON.stringify(leftNormalized) === JSON.stringify(rightNormalized)
  } catch (_err) {
    return false
  }
}

const parseLineOption = (options: Record<string, unknown> | null): number | null => {
  if (!options) {
    return null
  }

  const normalizeNumeric = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
    if (typeof value === 'string') {
      const numeric = Number(value.replace(',', '.'))
      if (Number.isFinite(numeric)) {
        return numeric
      }
    }
    return null
  }

  const record = options as { line?: unknown; formattedLine?: unknown }

  const direct = normalizeNumeric(record.line)
  if (direct !== null) {
    return Number(formatTotalLine(direct))
  }

  const formatted = normalizeNumeric(record.formattedLine)
  if (formatted !== null) {
    return Number(formatTotalLine(formatted))
  }

  return null
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

  const desiredOutcomeOptions = await buildMatchOutcomeOptions(match, client)
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
  const totalAlternatives: { line: number; delta: number }[] = []
  const seenLines = new Set<number>()
  for (const alternative of suggestion.alternatives) {
    const normalizedLine = Number(formatTotalLine(alternative.line))
    if (seenLines.has(normalizedLine)) {
      continue
    }
    seenLines.add(normalizedLine)
    const normalizedDelta = Number(
      (Math.round((alternative.delta ?? 0) * 10) / 10).toFixed(1)
    )
    totalAlternatives.push({ line: normalizedLine, delta: normalizedDelta })
  }
  const totalChoiceEntries: ProbabilityEntry[] = []
  for (const { line } of totalAlternatives) {
    const probabilities = computeTotalChoiceProbabilities(line, suggestion)
    const formattedLine = formatTotalLine(line)
    totalChoiceEntries.push({
      key: `OVER_${formattedLine}`,
      label: 'Больше',
      probability: probabilities.over,
    })
    totalChoiceEntries.push({
      key: `UNDER_${formattedLine}`,
      label: 'Меньше',
      probability: probabilities.under,
    })
  }
  const totalPointsMap = distributeInverseProbabilityPoints(
    totalChoiceEntries,
    PREDICTION_POINTS_BUDGET_TOTAL_GOALS
  )
  const desiredTotalDifficulty = computeTotalDifficultyMultiplier(suggestion)
  
  // Получаем существующие TOTAL_GOALS templates
  const existingTotals = match.predictionTemplates.filter(
    t => t.marketType === PredictionMarketType.TOTAL_GOALS
  )
  
  // Создаем Map существующих по линии
  const existingByLine = new Map<number, TemplateRow>()
  for (const template of existingTotals) {
    const options = template.options as Record<string, unknown> | null
    const parsedLine = parseLineOption(options)
    if (parsedLine !== null) {
      existingByLine.set(parsedLine, template)
    }
  }
  
  // Создаем или обновляем template для каждой линии
  for (const { line, delta } of totalAlternatives) {
    const desiredOptions = buildTotalGoalsOptionsForLine(line, suggestion, totalPointsMap, delta)
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
  const activeLines = new Set(totalAlternatives.map(item => item.line))

  for (const template of existingTotals) {
    if (template.isManual) continue
    const options = template.options as Record<string, unknown> | null
    const parsedLine = parseLineOption(options)
    if (parsedLine !== null && !activeLines.has(parsedLine)) {
      await client.predictionTemplate.delete({
        where: { id: template.id },
      })
    }
  }

  for (const definition of SPECIAL_EVENT_DEFINITIONS) {
    const desiredOptions = await buildSpecialEventOptions(match, definition, client)
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
      seasonId: true,
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
      seasonId: true,
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
