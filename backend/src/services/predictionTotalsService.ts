import { MatchStatus, Prisma, PrismaClient } from '@prisma/client'
import prisma from '../db'
import {
  PREDICTION_DEFAULT_TOTAL_LINE,
  PREDICTION_TOTAL_LOOKBACK_MATCHES,
  PREDICTION_TOTAL_MIN_LINE,
  PREDICTION_TOTAL_MAX_LINE,
  PREDICTION_TOTAL_MIN_SAMPLE_SIZE,
} from './predictionConstants'

export type PredictionMatchContext = {
  id: bigint
  matchDateTime: Date
  homeTeamId: number
  awayTeamId: number
  status: MatchStatus
  isFriendly: boolean
}

export type TotalGoalsSample = {
  matchId: bigint
  matchDateTime: Date
  homeTeamId: number
  awayTeamId: number
  totalGoals: number
  weight: number
  isFriendly: boolean
}

export type TotalGoalsLineAlternative = {
  line: number
  formattedLine: string
  delta: number
}

export type TotalGoalsSuggestion = {
  line: number
  fallback: boolean
  sampleSize: number
  averageGoals: number
  standardDeviation: number
  confidence: number
  samples: TotalGoalsSample[]
  generatedAt: Date
  alternatives: TotalGoalsLineAlternative[]
}

const FRIENDLY_SAMPLE_WEIGHT = 0.6
const DEFAULT_SAMPLE_WEIGHT = 1
const MAX_SAMPLES = PREDICTION_TOTAL_LOOKBACK_MATCHES * 2

const clampLine = (value: number): number => {
  if (!Number.isFinite(value)) {
    return PREDICTION_DEFAULT_TOTAL_LINE
  }
  if (value < PREDICTION_TOTAL_MIN_LINE) {
    return PREDICTION_TOTAL_MIN_LINE
  }
  if (value > PREDICTION_TOTAL_MAX_LINE) {
    return PREDICTION_TOTAL_MAX_LINE
  }
  return value
}

const normalizeMatchContext = (
  row: {
    id: bigint
    matchDateTime: Date | null
    homeTeamId: number
    awayTeamId: number
    status: MatchStatus
    isFriendly: boolean
  }
): PredictionMatchContext => ({
  id: row.id,
  matchDateTime: row.matchDateTime ?? new Date(),
  homeTeamId: row.homeTeamId,
  awayTeamId: row.awayTeamId,
  status: row.status,
  isFriendly: row.isFriendly,
})

const roundToTenth = (value: number): number => {
  return Math.round(value * 10) / 10
}

export const formatTotalLine = (line: number): string => {
  const roundedToHalf = Math.round(line * 2) / 2
  const clamped = clampLine(roundedToHalf)
  return clamped.toFixed(1)
}

const buildLineAlternatives = (line: number): TotalGoalsLineAlternative[] => {
  // Округляем динамический тотал до 0.5
  const roundedBase = Math.round(line * 2) / 2
  const normalizedBase = clampLine(roundedBase)
  
  const variants: TotalGoalsLineAlternative[] = []
  
  const pushVariant = (delta: number) => {
    const candidate = Math.round((normalizedBase + delta) * 2) / 2
    const clamped = clampLine(candidate)
    if (variants.some(variant => variant.line === clamped)) {
      return
    }
    variants.push({
      line: clamped,
      formattedLine: clamped.toFixed(1),
      delta: roundToTenth(clamped - normalizedBase),
    })
  }

  // Создаем 3 линии: -1, базовая, +1
  pushVariant(-1)
  pushVariant(0)  // базовая линия
  pushVariant(1)

  return variants
}

const toSample = (row: {
  id: bigint
  matchDateTime: Date | null
  homeTeamId: number
  awayTeamId: number
  homeScore: number
  awayScore: number
  isFriendly: boolean
}): TotalGoalsSample | null => {
  const homeScore = Number(row.homeScore)
  const awayScore = Number(row.awayScore)

  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) {
    return null
  }

  const totalGoals = homeScore + awayScore
  if (!Number.isFinite(totalGoals)) {
    return null
  }

  return {
    matchId: row.id,
    matchDateTime: row.matchDateTime ?? new Date(),
    homeTeamId: row.homeTeamId,
    awayTeamId: row.awayTeamId,
    totalGoals,
    weight: row.isFriendly ? FRIENDLY_SAMPLE_WEIGHT : DEFAULT_SAMPLE_WEIGHT,
    isFriendly: row.isFriendly,
  }
}

const fetchRecentMatchesForClub = async (
  client: PrismaClient | Prisma.TransactionClient,
  clubId: number,
  cutoff: Date
) => {
  return client.match.findMany({
    where: {
      status: MatchStatus.FINISHED,
      matchDateTime: { lt: cutoff },
      OR: [{ homeTeamId: clubId }, { awayTeamId: clubId }],
    },
    orderBy: { matchDateTime: 'desc' },
    take: PREDICTION_TOTAL_LOOKBACK_MATCHES,
    select: {
      id: true,
      matchDateTime: true,
      homeTeamId: true,
      awayTeamId: true,
      homeScore: true,
      awayScore: true,
      isFriendly: true,
    },
  })
}

const mergeSamples = (
  homeSamples: TotalGoalsSample[],
  awaySamples: TotalGoalsSample[]
): TotalGoalsSample[] => {
  const merged = new Map<string, TotalGoalsSample>()
  const insert = (sample: TotalGoalsSample) => {
    const key = sample.matchId.toString()
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, sample)
      return
    }
    if (sample.weight > existing.weight) {
      merged.set(key, sample)
    }
  }

  homeSamples.forEach(insert)
  awaySamples.forEach(insert)

  return Array.from(merged.values())
    .sort((left, right) => right.matchDateTime.getTime() - left.matchDateTime.getTime())
    .slice(0, MAX_SAMPLES)
}

const computeStandardDeviation = (samples: TotalGoalsSample[], mean: number): number => {
  if (!samples.length) {
    return 0
  }

  const variance =
    samples.reduce((acc, sample) => {
      const diff = sample.totalGoals - mean
      return acc + diff * diff
    }, 0) / samples.length

  return Math.sqrt(Math.max(variance, 0))
}

export const suggestTotalGoalsLineForMatch = async (
  matchOrContext: bigint | PredictionMatchContext,
  client: PrismaClient | Prisma.TransactionClient = prisma
): Promise<TotalGoalsSuggestion | null> => {
  const rawContext =
    typeof matchOrContext === 'bigint'
      ? await client.match.findUnique({
          where: { id: matchOrContext },
          select: {
            id: true,
            matchDateTime: true,
            homeTeamId: true,
            awayTeamId: true,
            status: true,
            isFriendly: true,
          },
        })
      : matchOrContext

  if (!rawContext) {
    return null
  }

  const matchContext = normalizeMatchContext({
    id: rawContext.id,
    matchDateTime: rawContext.matchDateTime ?? null,
    homeTeamId: rawContext.homeTeamId,
    awayTeamId: rawContext.awayTeamId,
    status: rawContext.status,
    isFriendly: rawContext.isFriendly,
  })

  const { matchDateTime, homeTeamId, awayTeamId } = matchContext
  const cutoff = matchDateTime ?? new Date()

  const [homeRows, awayRows] = await Promise.all([
    fetchRecentMatchesForClub(client, homeTeamId, cutoff),
    fetchRecentMatchesForClub(client, awayTeamId, cutoff),
  ])

  const homeSamples = homeRows
    .map(toSample)
    .filter((sample): sample is TotalGoalsSample => Boolean(sample))
  const awaySamples = awayRows
    .map(toSample)
    .filter((sample): sample is TotalGoalsSample => Boolean(sample))

  const samples = mergeSamples(homeSamples, awaySamples)
  const sampleSize = samples.length

  if (!sampleSize) {
    return {
      line: PREDICTION_DEFAULT_TOTAL_LINE,
      fallback: true,
      sampleSize: 0,
      averageGoals: PREDICTION_DEFAULT_TOTAL_LINE,
      standardDeviation: 0,
      confidence: 0,
      samples: [],
      generatedAt: new Date(),
      alternatives: buildLineAlternatives(PREDICTION_DEFAULT_TOTAL_LINE),
    }
  }

  const totalWeight = samples.reduce((acc, sample) => acc + sample.weight, 0)
  const weightedGoals = samples.reduce((acc, sample) => acc + sample.totalGoals * sample.weight, 0)

  const averageGoals = totalWeight > 0 ? weightedGoals / totalWeight : PREDICTION_DEFAULT_TOTAL_LINE
  const standardDeviation = computeStandardDeviation(samples, averageGoals)
  const confidence = Math.min(1, sampleSize / MAX_SAMPLES)

  const fallback = sampleSize < PREDICTION_TOTAL_MIN_SAMPLE_SIZE
  const rawLine = fallback
    ? PREDICTION_DEFAULT_TOTAL_LINE
    : roundToTenth(clampLine(averageGoals))
  const line = roundToTenth(clampLine(rawLine))
  const alternatives = buildLineAlternatives(line)

  return {
    line,
    fallback,
    sampleSize,
    averageGoals,
    standardDeviation,
    confidence,
    samples,
    generatedAt: new Date(),
    alternatives,
  }
}

export const computeTotalLineAlternatives = (
  line: number
): TotalGoalsLineAlternative[] => buildLineAlternatives(line)
