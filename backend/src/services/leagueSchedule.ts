import { Buffer } from 'node:buffer'
import { MatchStatus, RoundType, SeriesStatus } from '@prisma/client'
import prisma from '../db'
import {
  defaultCache,
  resolveCacheOptions,
  PUBLIC_FRIENDLY_RESULTS_KEY,
  PUBLIC_FRIENDLY_SCHEDULE_KEY,
  PUBLIC_LEAGUE_RESULTS_KEY,
  PUBLIC_LEAGUE_SCHEDULE_KEY,
} from '../cache'
import type { SeasonWithCompetition, LeagueSeasonSummary } from './leagueTable'
import { ensureSeasonSummary } from './leagueTable'

// Keep in sync with shared/types.ts friendly constants
const FRIENDLY_SEASON_ID = -1
const FRIENDLY_COMPETITION_ID = -101
const FRIENDLY_SEASON_NAME = 'Товарищеские матчи'

type ClubSummary = {
  id: number
  name: string
  shortName: string
  logoUrl: string | null
}

type MatchLocation = {
  stadiumId: number | null
  stadiumName: string | null
  city: string | null
}

export type LeagueMatchView = {
  id: string
  matchDateTime: string
  status: MatchStatus
  homeClub: ClubSummary
  awayClub: ClubSummary
  homeScore: number
  awayScore: number
  hasPenaltyShootout: boolean
  penaltyHomeScore: number | null
  penaltyAwayScore: number | null
  location: MatchLocation | null
  series?: {
    id: string
    stageName: string
    status: SeriesStatus
    matchNumber: number
    totalMatches: number
    requiredWins: number
    homeWinsBefore: number
    awayWinsBefore: number
    homeWinsAfter: number
    awayWinsAfter: number
    homeClub: ClubSummary
    awayClub: ClubSummary
    homeWinsTotal: number
    awayWinsTotal: number
    winnerClubId: number | null
    homeClubId: number
    awayClubId: number
  }
}

export type LeagueRoundMatches = {
  roundId: number | null
  roundNumber: number | null
  roundLabel: string
  roundType: RoundType | null
  matches: LeagueMatchView[]
  matchesCount: number
  roundKey: string
  firstMatchAt: string
  lastMatchAt: string
}

export interface LeagueRoundCollection {
  season: LeagueSeasonSummary
  rounds: LeagueRoundMatches[]
  generatedAt: string
  playoffPodium?: PlayoffPodiumData
}


type PublishFn = (topic: string, payload: unknown) => Promise<unknown>

type RoundAccumulator = {
  roundId: number | null
  roundNumber: number | null
  roundLabel: string
  roundType: RoundType | null
  matches: LeagueMatchView[]
  firstMatchAt: number
  lastMatchAt: number
  hasSeries: boolean
  stagePriority: number | null
}

const toBase64Url = (value: string): string =>
  Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/u, '')

const fromBase64Url = (value: string): string => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8')
}

const buildRoundKey = (roundId: number | null, label: string): string => {
  if (roundId !== null && Number.isFinite(roundId)) {
    return `id-${roundId}`
  }
  return `label-${toBase64Url(label)}`
}

export const decodeRoundKey = (
  key: string
): { roundId: number | null; label?: string } | null => {
  if (!key) {
    return null
  }
  if (key.startsWith('id-')) {
    const raw = Number(key.slice(3))
    if (!Number.isFinite(raw) || raw <= 0) {
      return null
    }
    return { roundId: raw }
  }
  if (key.startsWith('label-')) {
    try {
      const label = fromBase64Url(key.slice(6))
      return { roundId: null, label }
    } catch {
      return null
    }
  }
  return null
}

const clubSelect = {
  id: true,
  name: true,
  shortName: true,
  logoUrl: true,
} as const

const roundSelect = {
  id: true,
  roundNumber: true,
  label: true,
  roundType: true,
} as const

const stadiumSelect = {
  id: true,
  name: true,
  city: true,
} as const

const deriveRoundLabel = (
  round: { label: string; roundNumber: number | null } | null | undefined
): string => {
  if (!round) {
    return 'Без тура'
  }
  if (round.label?.trim()) {
    return round.label.trim()
  }
  if (typeof round.roundNumber === 'number' && Number.isFinite(round.roundNumber)) {
    return `Тур ${round.roundNumber}`
  }
  return 'Без тура'
}

type SeriesMatchSnapshot = {
  id: bigint
  seriesMatchNumber: number | null
  status: MatchStatus
  homeTeamId: number
  awayTeamId: number
  homeScore: number
  awayScore: number
  hasPenaltyShootout: boolean
  penaltyHomeScore: number
  penaltyAwayScore: number
}

type SeriesWithMatches = {
  id: bigint
  stageName: string
  seriesStatus: SeriesStatus
  homeClubId: number
  awayClubId: number
  homeClub: ClubSummary
  awayClub: ClubSummary
  winnerClubId: number | null
  matches: SeriesMatchSnapshot[]
}

type SeriesScoreboardEntry = {
  matchNumber: number
  homeWinsBefore: number
  awayWinsBefore: number
  homeWinsAfter: number
  awayWinsAfter: number
}

type SeriesContext = {
  id: bigint
  stageName: string
  status: SeriesStatus
  totalMatches: number
  requiredWins: number
  homeClub: ClubSummary
  awayClub: ClubSummary
  homeClubId: number
  awayClubId: number
  winnerClubId: number | null
  finalHomeWins: number
  finalAwayWins: number
  scoreboard: Map<number, SeriesScoreboardEntry>
}

type MatchWithRoundView = {
  roundId: number | null
  roundNumber: number | null
  roundLabel: string
  roundType: RoundType | null
  matchDateTime: Date
  view: LeagueMatchView
}

type MatchRecord = {
  id: bigint
  matchDateTime: Date
  status: MatchStatus
  homeScore: number
  awayScore: number
  hasPenaltyShootout: boolean
  penaltyHomeScore: number
  penaltyAwayScore: number
  homeClub: ClubSummary
  awayClub: ClubSummary
  stadium: MatchLocation | null
  round: { id: number; roundNumber: number | null; label: string; roundType: RoundType } | null
  seriesMatchNumber: number | null
  series: (SeriesWithMatches & { matches: SeriesMatchSnapshot[] }) | null
}

const determineSeriesMatchWinner = (match: SeriesMatchSnapshot): number | null => {
  if (match.homeScore > match.awayScore) return match.homeTeamId
  if (match.homeScore < match.awayScore) return match.awayTeamId
  if (!match.hasPenaltyShootout) return null
  if ((match.penaltyHomeScore ?? 0) > (match.penaltyAwayScore ?? 0)) return match.homeTeamId
  if ((match.penaltyHomeScore ?? 0) < (match.penaltyAwayScore ?? 0)) return match.awayTeamId
  return null
}

const createSeriesContext = (series: SeriesWithMatches): SeriesContext => {
  const sorted = [...series.matches].sort((left, right) => {
    const leftNumber = left.seriesMatchNumber ?? Number.MAX_SAFE_INTEGER
    const rightNumber = right.seriesMatchNumber ?? Number.MAX_SAFE_INTEGER
    if (leftNumber !== rightNumber) {
      return leftNumber - rightNumber
    }
    return left.id === right.id ? 0 : left.id < right.id ? -1 : 1
  })

  let fallbackNumber = 1
  let homeWins = 0
  let awayWins = 0
  const scoreboard = new Map<number, SeriesScoreboardEntry>()

  for (const match of sorted) {
    const matchNumber = match.seriesMatchNumber ?? fallbackNumber
    fallbackNumber = matchNumber + 1
    const entry: SeriesScoreboardEntry = {
      matchNumber,
      homeWinsBefore: homeWins,
      awayWinsBefore: awayWins,
      homeWinsAfter: homeWins,
      awayWinsAfter: awayWins,
    }

    if (match.status === MatchStatus.FINISHED) {
      const winner = determineSeriesMatchWinner(match)
      if (winner === series.homeClubId) {
        homeWins += 1
      } else if (winner === series.awayClubId) {
        awayWins += 1
      }
      entry.homeWinsAfter = homeWins
      entry.awayWinsAfter = awayWins
    }

    scoreboard.set(matchNumber, entry)
  }

  const totalMatches = sorted.length
  const requiredWins = Math.max(1, Math.floor(totalMatches / 2) + 1)
  let winnerClubId = series.winnerClubId ?? null

  if (series.seriesStatus === SeriesStatus.FINISHED) {
    if (homeWins > awayWins) {
      winnerClubId = series.homeClubId
    } else if (awayWins > homeWins) {
      winnerClubId = series.awayClubId
    }
  }

  return {
    id: series.id,
    stageName: series.stageName,
    status: series.seriesStatus,
    totalMatches,
    requiredWins,
    homeClub: series.homeClub,
    awayClub: series.awayClub,
    homeClubId: series.homeClubId,
    awayClubId: series.awayClubId,
    winnerClubId,
    finalHomeWins: homeWins,
    finalAwayWins: awayWins,
    scoreboard,
  }
}

const shouldDisplaySeriesMatch = (
  context: SeriesContext,
  entry: SeriesScoreboardEntry,
  status: MatchStatus
): boolean => {
  if (status === MatchStatus.LIVE) {
    return true
  }
  if (context.status === SeriesStatus.FINISHED) {
    return false
  }

  const initialVisible = Math.min(context.totalMatches || entry.matchNumber, context.requiredWins)
  if (entry.matchNumber <= initialVisible) {
    return true
  }

  const finishedBefore = entry.homeWinsBefore + entry.awayWinsBefore
  const precedingMatches = entry.matchNumber - 1
  if (finishedBefore < precedingMatches) {
    return false
  }

  const leaderWins = Math.max(entry.homeWinsBefore, entry.awayWinsBefore)
  if (leaderWins >= context.requiredWins) {
    return false
  }

  return true
}

type PlayoffPodiumClub = {
  id: number
  name: string
  shortName: string
  logoUrl: string | null
}

type PlayoffPodiumData = {
  champion?: PlayoffPodiumClub
  runnerUp?: PlayoffPodiumClub
  thirdPlace?: PlayoffPodiumClub
}

/**
 * Вычисляет пьедестал плей-офф из завершенных серий
 * Для кубков с Gold/Silver - ищет "Финал Золотого кубка" и "3 место Золотого кубка"
 * Для обычных плей-офф - ищет "Финал" и "3 место"
 */
const computePlayoffPodium = async (seasonId: number): Promise<PlayoffPodiumData | undefined> => {
  const finishedSeries = await prisma.matchSeries.findMany({
    where: {
      seasonId,
      seriesStatus: SeriesStatus.FINISHED,
      winnerClubId: { not: null },
    },
    select: {
      stageName: true,
      winnerClubId: true,
      homeClubId: true,
      awayClubId: true,
      homeClub: {
        select: { id: true, name: true, shortName: true, logoUrl: true },
      },
      awayClub: {
        select: { id: true, name: true, shortName: true, logoUrl: true },
      },
    },
  })

  if (!finishedSeries.length) {
    return undefined
  }

  // Проверяем кубковый формат (Gold/Silver)
  const hasCupFormat = finishedSeries.some(
    s =>
      s.stageName.toLowerCase().includes('золот') ||
      s.stageName.toLowerCase().includes('серебр')
  )

  let finalSeries: (typeof finishedSeries)[number] | undefined
  let thirdSeries: (typeof finishedSeries)[number] | undefined

  for (const series of finishedSeries) {
    const normalized = series.stageName.toLowerCase()
    const isSemi =
      normalized.includes('1/2') ||
      normalized.includes('semi') ||
      normalized.includes('полу')

    // Финал
    if (!finalSeries && !isSemi && normalized.includes('финал')) {
      if (hasCupFormat) {
        if (normalized.includes('золот')) {
          finalSeries = series
        }
      } else {
        finalSeries = series
      }
    }

    // 3 место
    if (
      !thirdSeries &&
      (normalized.includes('3 место') || normalized.includes('за 3'))
    ) {
      if (hasCupFormat) {
        if (normalized.includes('золот')) {
          thirdSeries = series
        }
      } else {
        thirdSeries = series
      }
    }
  }

  if (!finalSeries || finalSeries.winnerClubId == null) {
    return undefined
  }

  const championIsHome = finalSeries.winnerClubId === finalSeries.homeClubId
  const champion = championIsHome ? finalSeries.homeClub : finalSeries.awayClub
  const runnerUp = championIsHome ? finalSeries.awayClub : finalSeries.homeClub

  const podium: PlayoffPodiumData = {
    champion: {
      id: champion.id,
      name: champion.name,
      shortName: champion.shortName,
      logoUrl: champion.logoUrl,
    },
    runnerUp: {
      id: runnerUp.id,
      name: runnerUp.name,
      shortName: runnerUp.shortName,
      logoUrl: runnerUp.logoUrl,
    },
  }

  if (thirdSeries && thirdSeries.winnerClubId != null) {
    const thirdIsHome = thirdSeries.winnerClubId === thirdSeries.homeClubId
    const thirdClub = thirdIsHome ? thirdSeries.homeClub : thirdSeries.awayClub
    podium.thirdPlace = {
      id: thirdClub.id,
      name: thirdClub.name,
      shortName: thirdClub.shortName,
      logoUrl: thirdClub.logoUrl,
    }
  }

  return podium
}

const deriveSeriesStagePriority = (stageName: string): number => {
  if (!stageName) {
    return 1000
  }

  const normalized = stageName.trim().toLowerCase()
  if (!normalized) {
    return 1000
  }

  const isGold = normalized.includes('золот') || normalized.includes('gold')
  const isSilver = normalized.includes('серебр') || normalized.includes('silver')

  // Финал Золотого кубка → 1, Финал Серебряного кубка → 3
  if (normalized.includes('финал') || normalized.includes('final')) {
    // Исключаем полуфиналы
    const isSemi = normalized.includes('полуфин') || normalized.includes('semi') ||
      normalized.includes('1/2') || normalized.includes('1\\2')
    if (!isSemi) {
      if (isGold) return 1
      if (isSilver) return 3
      return 1
    }
  }

  // 3 место Золотого кубка → 2, 3 место Серебряного кубка → 4
  if (
    normalized.includes('матч за 3') ||
    normalized.includes('треть') ||
    normalized.includes('3 место') ||
    normalized.includes('малый финал') ||
    normalized.includes('small final')
  ) {
    if (isGold) return 2
    if (isSilver) return 4
    return 2
  }

  // Полуфинал Золотого кубка → 5, Полуфинал Серебряного кубка → 6
  if (
    normalized.includes('полуфин') ||
    normalized.includes('semi') ||
    normalized.includes('1/2') ||
    normalized.includes('1\\2')
  ) {
    if (isGold) return 5
    if (isSilver) return 6
    return 5
  }

  // 1/4 финала → 7
  if (normalized.includes('четверть') || normalized.includes('1/4') || normalized.includes('1\\4')) {
    return 7
  }

  // Квалификация → 8
  if (normalized.includes('квалифик') || normalized.includes('qualif')) {
    return 8
  }

  if (normalized.includes('1/8') || normalized.includes('1\\8') || normalized.includes('восьм')) {
    return 9
  }

  if (normalized.includes('1/16') || normalized.includes('1\\16') || normalized.includes('шестнадц')) {
    return 10
  }

  if (normalized.includes('1/32') || normalized.includes('1\\32') || normalized.includes('тридцат')) {
    return 11
  }

  if (normalized.includes('1/64') || normalized.includes('1\\64')) {
    return 12
  }

  if (normalized.includes('плей-ин') || normalized.includes('play-in') || normalized.includes('плейин')) {
    return 20
  }

  return 1000
}

const buildMatchView = (
  match: MatchRecord,
  mode: 'schedule' | 'results',
  cache: Map<bigint, SeriesContext>
): LeagueMatchView | null => {
  const base: LeagueMatchView = {
    id: match.id.toString(),
    matchDateTime: match.matchDateTime.toISOString(),
    status: match.status,
    homeClub: match.homeClub,
    awayClub: match.awayClub,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    hasPenaltyShootout: match.hasPenaltyShootout,
    penaltyHomeScore: match.hasPenaltyShootout ? match.penaltyHomeScore : null,
    penaltyAwayScore: match.hasPenaltyShootout ? match.penaltyAwayScore : null,
    location: match.stadium,
  }

  const seriesData = match.series
  if (!seriesData) {
    return base
  }

  const cacheKey = seriesData.id
  let context = cache.get(cacheKey)
  if (!context) {
    context = createSeriesContext(seriesData)
    cache.set(cacheKey, context)
  }

  const matchNumber = match.seriesMatchNumber ?? context.scoreboard.size + 1
  const scoreboard = context.scoreboard.get(matchNumber) ?? {
    matchNumber,
    homeWinsBefore: 0,
    awayWinsBefore: 0,
    homeWinsAfter: 0,
    awayWinsAfter: 0,
  }

  if (mode === 'schedule' && !shouldDisplaySeriesMatch(context, scoreboard, match.status)) {
    return null
  }

  base.series = {
    id: context.id.toString(),
    stageName: context.stageName,
    status: context.status,
    matchNumber,
    totalMatches: context.totalMatches,
    requiredWins: context.requiredWins,
    homeWinsBefore: scoreboard.homeWinsBefore,
    awayWinsBefore: scoreboard.awayWinsBefore,
    homeWinsAfter: scoreboard.homeWinsAfter,
    awayWinsAfter: scoreboard.awayWinsAfter,
    homeClub: context.homeClub,
    awayClub: context.awayClub,
    homeWinsTotal: context.finalHomeWins,
    awayWinsTotal: context.finalAwayWins,
    winnerClubId: context.winnerClubId,
    homeClubId: context.homeClubId,
    awayClubId: context.awayClubId,
  }

  return base
}

const transformMatches = (
  matches: MatchRecord[],
  mode: 'schedule' | 'results'
): MatchWithRoundView[] => {
  const seriesCache = new Map<bigint, SeriesContext>()
  const result: MatchWithRoundView[] = []

  for (const match of matches) {
    const view = buildMatchView(match, mode, seriesCache)
    if (!view) continue

    result.push({
      roundId: match.round?.id ?? null,
      roundNumber: match.round?.roundNumber ?? null,
      roundLabel: deriveRoundLabel(match.round),
      roundType: match.round?.roundType ?? null,
      matchDateTime: match.matchDateTime,
      view,
    })
  }

  return result
}

const groupMatchViewsByRound = (
  matches: MatchWithRoundView[],
  options: { limit?: number; order: 'asc' | 'desc' }
): LeagueRoundMatches[] => {
  const map = new Map<string, RoundAccumulator>()

  for (const entry of matches) {
    const key = entry.roundId ? `round:${entry.roundId}` : 'round:none'
    const matchTime = entry.matchDateTime.getTime()
    let accumulator = map.get(key)
    if (!accumulator) {
      const initialStagePriority = entry.view.series
        ? deriveSeriesStagePriority(entry.view.series.stageName)
        : null
      const created: RoundAccumulator = {
        roundId: entry.roundId,
        roundNumber: entry.roundNumber,
        roundLabel: entry.roundLabel,
        roundType: entry.roundType,
        matches: [],
        firstMatchAt: matchTime,
        lastMatchAt: matchTime,
        hasSeries: Boolean(entry.view.series),
        stagePriority: initialStagePriority,
      }
      map.set(key, created)
      accumulator = created
    }
    accumulator.firstMatchAt = Math.min(accumulator.firstMatchAt, matchTime)
    accumulator.lastMatchAt = Math.max(accumulator.lastMatchAt, matchTime)
    if (entry.view.series) {
      const priority = deriveSeriesStagePriority(entry.view.series.stageName)
      accumulator.hasSeries = true
      accumulator.stagePriority =
        accumulator.stagePriority === null
          ? priority
          : Math.min(accumulator.stagePriority, priority)
    }
    accumulator.matches.push(entry.view)
  }

  const rounds = Array.from(map.values())
  const sorted = rounds.sort((left, right) => {
    const leftNumber = left.roundNumber ?? Number.POSITIVE_INFINITY
    const rightNumber = right.roundNumber ?? Number.POSITIVE_INFINITY
    if (options.order === 'asc') {
      if (leftNumber !== rightNumber) {
        return leftNumber - rightNumber
      }
      if (left.firstMatchAt !== right.firstMatchAt) {
        return left.firstMatchAt - right.firstMatchAt
      }
      return left.roundLabel.localeCompare(right.roundLabel, 'ru')
    }
    const leftPriority = left.stagePriority ?? Number.POSITIVE_INFINITY
    const rightPriority = right.stagePriority ?? Number.POSITIVE_INFINITY
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority
    }
    const leftDesc = left.roundNumber ?? Number.NEGATIVE_INFINITY
    const rightDesc = right.roundNumber ?? Number.NEGATIVE_INFINITY
    if (leftDesc !== rightDesc) {
      return rightDesc - leftDesc
    }
    if (left.lastMatchAt !== right.lastMatchAt) {
      return right.lastMatchAt - left.lastMatchAt
    }
    return right.roundLabel.localeCompare(left.roundLabel, 'ru')
  })

  const limitCount = typeof options.limit === 'number' ? options.limit : sorted.length
  const initial = sorted.slice(0, limitCount)
  const keyFor = (round: RoundAccumulator) => `${round.roundId ?? 'none'}::${round.roundLabel}`
  const includedKeys = new Set(initial.map(keyFor))

  for (const round of sorted) {
    if (round.roundType === RoundType.PLAYOFF || round.hasSeries) {
      const key = keyFor(round)
      if (!includedKeys.has(key)) {
        includedKeys.add(key)
        initial.push(round)
      }
    }
  }

  const finalRounds = sorted.filter(round => includedKeys.has(keyFor(round)))

  return finalRounds.map(round => ({
    roundId: round.roundId,
    roundNumber: round.roundNumber,
    roundLabel: round.roundLabel,
    roundType: round.roundType,
    matches: round.matches.sort((a, b) => a.matchDateTime.localeCompare(b.matchDateTime)),
    matchesCount: round.matches.length,
    roundKey: buildRoundKey(round.roundId, round.roundLabel),
    firstMatchAt: new Date(round.firstMatchAt).toISOString(),
    lastMatchAt: new Date(round.lastMatchAt).toISOString(),
  }))
}

export const buildLeagueSchedule = async (
  season: SeasonWithCompetition,
  limitRounds = 4
): Promise<LeagueRoundCollection> => {
  const matches = await prisma.match.findMany({
    where: {
      seasonId: season.id,
      status: {
        in: [MatchStatus.SCHEDULED, MatchStatus.LIVE, MatchStatus.POSTPONED],
      },
    },
    orderBy: [{ matchDateTime: 'asc' }],
    include: {
      homeClub: { select: clubSelect },
      awayClub: { select: clubSelect },
      stadium: { select: stadiumSelect },
      round: { select: roundSelect },
      series: {
        select: {
          id: true,
          stageName: true,
          seriesStatus: true,
          homeClubId: true,
          awayClubId: true,
          homeClub: { select: clubSelect },
          awayClub: { select: clubSelect },
          matches: {
            select: {
              id: true,
              seriesMatchNumber: true,
              status: true,
              homeTeamId: true,
              awayTeamId: true,
              homeScore: true,
              awayScore: true,
              hasPenaltyShootout: true,
              penaltyHomeScore: true,
              penaltyAwayScore: true,
            },
            orderBy: { seriesMatchNumber: 'asc' },
          },
        },
      },
    },
  })

  const transformed = transformMatches(
    matches.map(match => ({
      ...match,
      stadium: match.stadium
        ? {
            stadiumId: match.stadium.id,
            stadiumName: match.stadium.name,
            city: match.stadium.city,
          }
        : null,
    })) as MatchRecord[],
    'schedule'
  )

  const grouped = groupMatchViewsByRound(transformed, { limit: limitRounds, order: 'asc' })

  // Вычисляем пьедестал плей-офф для календаря (нужен для отображения пьедестала
  // при завершённом турнире, когда нет предстоящих матчей)
  const playoffPodium = await computePlayoffPodium(season.id)

  return {
    season: ensureSeasonSummary(season),
    rounds: grouped,
    generatedAt: new Date().toISOString(),
    playoffPodium,
  }
}

type MatchSummaryRecord = {
  id: bigint
  matchDateTime: Date
  round: { id: number; roundNumber: number | null; label: string; roundType: RoundType } | null
  series: { stageName: string; seriesStatus: SeriesStatus } | null
}

export const buildLeagueResultsIndex = async (
  season: SeasonWithCompetition
): Promise<LeagueRoundCollection> => {
  const matches = await prisma.match.findMany({
    where: {
      seasonId: season.id,
      status: MatchStatus.FINISHED,
    },
    orderBy: [{ matchDateTime: 'desc' }],
    select: {
      id: true,
      matchDateTime: true,
      round: { select: roundSelect },
      series: {
        select: {
          stageName: true,
          seriesStatus: true,
        },
      },
    },
  }) as MatchSummaryRecord[]

  const map = new Map<string, {
    roundId: number | null
    roundNumber: number | null
    roundLabel: string
    roundType: RoundType | null
    matchCount: number
    firstMatchAt: number
    lastMatchAt: number
    hasSeries: boolean
    stagePriority: number | null
  }>()

  for (const match of matches) {
    const roundInfo = match.round ?? null
    const roundId = roundInfo?.id ?? null
    const roundLabel = deriveRoundLabel(roundInfo)
    const key = buildRoundKey(roundId, roundLabel)
    const timestamp = match.matchDateTime.getTime()
    let accumulator = map.get(key)
    if (!accumulator) {
      const initialPriority = match.series
        ? deriveSeriesStagePriority(match.series.stageName)
        : null
      accumulator = {
        roundId,
        roundNumber: roundInfo?.roundNumber ?? null,
        roundLabel,
        roundType: roundInfo?.roundType ?? null,
        matchCount: 0,
        firstMatchAt: timestamp,
        lastMatchAt: timestamp,
        hasSeries: Boolean(match.series),
        stagePriority: initialPriority,
      }
      map.set(key, accumulator)
    }
    accumulator.matchCount += 1
    accumulator.firstMatchAt = Math.min(accumulator.firstMatchAt, timestamp)
    accumulator.lastMatchAt = Math.max(accumulator.lastMatchAt, timestamp)
    if (match.series) {
      const priority = deriveSeriesStagePriority(match.series.stageName)
      accumulator.hasSeries = true
      accumulator.stagePriority =
        accumulator.stagePriority === null
          ? priority
          : Math.min(accumulator.stagePriority, priority)
    }
  }

  // Сортировка: от новых матчей к старым по дате (lastMatchAt)
  // Это даёт пользователю сразу видеть последние результаты при входе
  const rounds = Array.from(map.values()).sort((left, right) => {
    // Первичный критерий: дата последнего матча (от новых к старым)
    if (left.lastMatchAt !== right.lastMatchAt) {
      return right.lastMatchAt - left.lastMatchAt
    }
    // Вторичный: дата первого матча (от новых к старым)
    if (left.firstMatchAt !== right.firstMatchAt) {
      return right.firstMatchAt - left.firstMatchAt
    }
    // Третичный: label по алфавиту (для стабильности)
    return left.roundLabel.localeCompare(right.roundLabel, 'ru')
  })

  const summaries: LeagueRoundMatches[] = rounds.map(round => ({
    roundId: round.roundId,
    roundNumber: round.roundNumber,
    roundLabel: round.roundLabel,
    roundType: round.roundType,
    matches: [],
    matchesCount: round.matchCount,
    roundKey: buildRoundKey(round.roundId, round.roundLabel),
    firstMatchAt: new Date(round.firstMatchAt).toISOString(),
    lastMatchAt: new Date(round.lastMatchAt).toISOString(),
  }))

  // Вычисляем пьедестал плей-офф для индекса результатов
  const playoffPodium = await computePlayoffPodium(season.id)

  return {
    season: ensureSeasonSummary(season),
    rounds: summaries,
    generatedAt: new Date().toISOString(),
    playoffPodium,
  }
}

export const buildLeagueResultsForRound = async (
  season: SeasonWithCompetition,
  context: { roundId: number | null; label?: string }
): Promise<LeagueRoundCollection | null> => {
  const where = {
    seasonId: season.id,
    status: MatchStatus.FINISHED,
    ...(context.roundId !== null ? { roundId: context.roundId } : { roundId: null }),
  }

  const matches = await prisma.match.findMany({
    where,
    orderBy: [{ matchDateTime: 'desc' }],
    include: {
      homeClub: { select: clubSelect },
      awayClub: { select: clubSelect },
      stadium: { select: stadiumSelect },
      round: { select: roundSelect },
      series: {
        select: {
          id: true,
          stageName: true,
          seriesStatus: true,
          homeClubId: true,
          awayClubId: true,
          homeClub: { select: clubSelect },
          awayClub: { select: clubSelect },
          matches: {
            select: {
              id: true,
              seriesMatchNumber: true,
              status: true,
              homeTeamId: true,
              awayTeamId: true,
              homeScore: true,
              awayScore: true,
              hasPenaltyShootout: true,
              penaltyHomeScore: true,
              penaltyAwayScore: true,
            },
            orderBy: { seriesMatchNumber: 'asc' },
          },
        },
      },
    },
  })

  if (!matches.length) {
    return null
  }

  const transformed = transformMatches(
    matches.map(match => ({
      ...match,
      stadium: match.stadium
        ? {
            stadiumId: match.stadium.id,
            stadiumName: match.stadium.name,
            city: match.stadium.city,
          }
        : null,
    })) as MatchRecord[],
    'results'
  )

  const grouped = groupMatchViewsByRound(transformed, { order: 'desc' })
  const expectedKey = buildRoundKey(context.roundId, context.label ?? grouped[0]?.roundLabel ?? 'Без тура')
  const targetRound = grouped.find(round => round.roundKey === expectedKey) ?? grouped[0]
  if (!targetRound) {
    return null
  }

  return {
    season: ensureSeasonSummary(season),
    rounds: [targetRound],
    generatedAt: new Date().toISOString(),
  }
}

export const buildLeagueResultsFull = async (
  season: SeasonWithCompetition
): Promise<LeagueRoundCollection> => {
  const matches = await prisma.match.findMany({
    where: {
      seasonId: season.id,
      status: MatchStatus.FINISHED,
    },
    orderBy: [{ matchDateTime: 'desc' }],
    include: {
      homeClub: { select: clubSelect },
      awayClub: { select: clubSelect },
      stadium: { select: stadiumSelect },
      round: { select: roundSelect },
      series: {
        select: {
          id: true,
          stageName: true,
          seriesStatus: true,
          homeClubId: true,
          awayClubId: true,
          homeClub: { select: clubSelect },
          awayClub: { select: clubSelect },
          matches: {
            select: {
              id: true,
              seriesMatchNumber: true,
              status: true,
              homeTeamId: true,
              awayTeamId: true,
              homeScore: true,
              awayScore: true,
              hasPenaltyShootout: true,
              penaltyHomeScore: true,
              penaltyAwayScore: true,
            },
            orderBy: { seriesMatchNumber: 'asc' },
          },
        },
      },
    },
  })

  if (!matches.length) {
    return {
      season: ensureSeasonSummary(season),
      rounds: [],
      generatedAt: new Date().toISOString(),
    }
  }

  const transformed = transformMatches(
    matches.map(match => ({
      ...match,
      stadium: match.stadium
        ? {
            stadiumId: match.stadium.id,
            stadiumName: match.stadium.name,
            city: match.stadium.city,
          }
        : null,
    })) as MatchRecord[],
    'results'
  )

  const grouped = groupMatchViewsByRound(transformed, { order: 'desc' })

  return {
    season: ensureSeasonSummary(season),
    rounds: grouped,
    generatedAt: new Date().toISOString(),
  }
}

type FriendlyMatchRecord = {
  id: bigint
  matchDateTime: Date
  status: MatchStatus
  homeScore: number
  awayScore: number
  hasPenaltyShootout: boolean
  penaltyHomeScore: number
  penaltyAwayScore: number
  homeClub: ClubSummary
  awayClub: ClubSummary
  stadium: MatchLocation | null
}

type FriendlyMatchView = {
  view: LeagueMatchView
  timestamp: number
  status: MatchStatus
}

const FRIENDLY_ROUND_LIMIT = 4

const friendlyDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
})

const mapFriendlyMatch = (match: FriendlyMatchRecord): FriendlyMatchView => {
  const timestamp = match.matchDateTime.getTime()
  const view: LeagueMatchView = {
    id: match.id.toString(),
    matchDateTime: match.matchDateTime.toISOString(),
    status: match.status,
    homeClub: match.homeClub,
    awayClub: match.awayClub,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    hasPenaltyShootout: match.hasPenaltyShootout,
    penaltyHomeScore: match.hasPenaltyShootout ? match.penaltyHomeScore : null,
    penaltyAwayScore: match.hasPenaltyShootout ? match.penaltyAwayScore : null,
    location: match.stadium,
  }

  return {
    view,
    timestamp,
    status: match.status,
  }
}

const groupFriendlyViews = (
  matches: FriendlyMatchView[],
  direction: 'asc' | 'desc',
  limit: number
): LeagueRoundMatches[] => {
  if (!matches.length) {
    return []
  }

  const buckets = new Map<
    string,
    {
      label: string
      orderTimestamp: number
      firstTimestamp: number
      lastTimestamp: number
      matches: LeagueMatchView[]
    }
  >()

  for (const entry of matches) {
    const date = new Date(entry.timestamp)
    const key = date.toISOString().slice(0, 10)
    const label = friendlyDateFormatter.format(date)
    const existing = buckets.get(key)
    if (existing) {
      if (direction === 'asc') {
        existing.orderTimestamp = Math.min(existing.orderTimestamp, entry.timestamp)
        existing.firstTimestamp = Math.min(existing.firstTimestamp, entry.timestamp)
        existing.lastTimestamp = Math.max(existing.lastTimestamp, entry.timestamp)
      } else {
        existing.orderTimestamp = Math.max(existing.orderTimestamp, entry.timestamp)
        existing.firstTimestamp = Math.min(existing.firstTimestamp, entry.timestamp)
        existing.lastTimestamp = Math.max(existing.lastTimestamp, entry.timestamp)
      }
      existing.matches.push(entry.view)
    } else {
      buckets.set(key, {
        label,
        orderTimestamp: entry.timestamp,
        firstTimestamp: entry.timestamp,
        lastTimestamp: entry.timestamp,
        matches: [entry.view],
      })
    }
  }

  const sortedGroups = Array.from(buckets.values()).sort((left, right) => {
    if (left.orderTimestamp === right.orderTimestamp) {
      return left.label.localeCompare(right.label, 'ru')
    }
    return direction === 'asc'
      ? left.orderTimestamp - right.orderTimestamp
      : right.orderTimestamp - left.orderTimestamp
  })

  const limited = sortedGroups.slice(0, limit)

  return limited.map(group => ({
    roundId: null,
    roundNumber: null,
    roundLabel: group.label,
    roundType: null,
    matches:
      direction === 'asc'
        ? [...group.matches].sort((a, b) => a.matchDateTime.localeCompare(b.matchDateTime))
        : [...group.matches].sort((a, b) => b.matchDateTime.localeCompare(a.matchDateTime)),
    matchesCount: group.matches.length,
    roundKey: buildRoundKey(null, group.label),
    firstMatchAt: new Date(group.firstTimestamp).toISOString(),
    lastMatchAt: new Date(group.lastTimestamp).toISOString(),
  }))
}

const buildFriendlySeasonSummary = (matches: FriendlyMatchView[]): LeagueSeasonSummary => {
  if (!matches.length) {
    const nowIso = new Date().toISOString()
    return {
      id: FRIENDLY_SEASON_ID,
      name: FRIENDLY_SEASON_NAME,
      startDate: nowIso,
      endDate: nowIso,
      isActive: false,
      city: null,
      competition: {
        id: FRIENDLY_COMPETITION_ID,
        name: FRIENDLY_SEASON_NAME,
        type: 'LEAGUE',
      },
    }
  }

  const sorted = [...matches].sort((left, right) => left.timestamp - right.timestamp)
  const startDate = new Date(sorted[0].timestamp).toISOString()
  const endDate = new Date(sorted[sorted.length - 1].timestamp).toISOString()
  const isActive = matches.some(entry =>
    entry.status === MatchStatus.SCHEDULED ||
    entry.status === MatchStatus.LIVE ||
    entry.status === MatchStatus.POSTPONED
  )

  return {
    id: FRIENDLY_SEASON_ID,
    name: FRIENDLY_SEASON_NAME,
    startDate,
    endDate,
    isActive,
    city: null,
    competition: {
      id: FRIENDLY_COMPETITION_ID,
      name: FRIENDLY_SEASON_NAME,
      type: 'LEAGUE',
    },
  }
}

const buildFriendlyCollection = async (
  mode: 'schedule' | 'results',
  limitRounds = FRIENDLY_ROUND_LIMIT
): Promise<LeagueRoundCollection> => {
  const isScheduleMode = mode === 'schedule'
  const statusFilter = isScheduleMode
    ? {
        in: [MatchStatus.SCHEDULED, MatchStatus.LIVE, MatchStatus.POSTPONED] as MatchStatus[],
      }
    : MatchStatus.FINISHED

  const records = await prisma.match.findMany({
    where: {
      isFriendly: true,
      status: statusFilter,
    },
    orderBy: [{ matchDateTime: isScheduleMode ? 'asc' : 'desc' }],
    include: {
      homeClub: { select: clubSelect },
      awayClub: { select: clubSelect },
      stadium: { select: stadiumSelect },
    },
  })

  const friendlyRecords: FriendlyMatchRecord[] = records.map(record => ({
    id: record.id,
    matchDateTime: record.matchDateTime,
    status: record.status,
    homeScore: record.homeScore,
    awayScore: record.awayScore,
    hasPenaltyShootout: record.hasPenaltyShootout,
    penaltyHomeScore: record.penaltyHomeScore,
    penaltyAwayScore: record.penaltyAwayScore,
    homeClub: record.homeClub,
    awayClub: record.awayClub,
    stadium: record.stadium
      ? {
          stadiumId: record.stadium.id,
          stadiumName: record.stadium.name,
          city: record.stadium.city,
        }
      : null,
  }))

  const views = friendlyRecords.map(mapFriendlyMatch)
  const rounds = groupFriendlyViews(views, isScheduleMode ? 'asc' : 'desc', limitRounds)
  const season = buildFriendlySeasonSummary(views)

  return {
    season,
    rounds,
    generatedAt: new Date().toISOString(),
  }
}

export const buildFriendlySchedule = async (
  limitRounds = FRIENDLY_ROUND_LIMIT
): Promise<LeagueRoundCollection> => buildFriendlyCollection('schedule', limitRounds)

export const buildFriendlyResults = async (
  limitRounds = FRIENDLY_ROUND_LIMIT
): Promise<LeagueRoundCollection> => buildFriendlyCollection('results', limitRounds)

export const refreshFriendlyAggregates = async (
  options?: { publishTopic?: PublishFn }
): Promise<{ schedule: LeagueRoundCollection; results: LeagueRoundCollection }> => {
  const [schedule, results] = await Promise.all([
    buildFriendlySchedule(),
    buildFriendlyResults(),
  ])

  const [scheduleOptions, resultsOptions] = await Promise.all([
    resolveCacheOptions('friendliesSchedule'),
    resolveCacheOptions('friendliesResults'),
  ])

  await Promise.all([
    defaultCache.set(PUBLIC_FRIENDLY_SCHEDULE_KEY, schedule, scheduleOptions),
    defaultCache.set(PUBLIC_FRIENDLY_RESULTS_KEY, results, resultsOptions),
  ])

  if (options?.publishTopic) {
    await Promise.all([
      options
        .publishTopic(PUBLIC_FRIENDLY_SCHEDULE_KEY, {
          type: 'friendlies.schedule',
          payload: schedule,
        })
        .catch(() => undefined),
      options
        .publishTopic(PUBLIC_FRIENDLY_RESULTS_KEY, {
          type: 'friendlies.results',
          payload: results,
        })
        .catch(() => undefined),
    ])
  }

  return { schedule, results }
}

export const refreshLeagueMatchAggregates = async (
  seasonId: number,
  options?: { publishTopic?: PublishFn }
): Promise<{ schedule: LeagueRoundCollection; results: LeagueRoundCollection } | null> => {
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    include: { competition: true },
  })

  if (!season) {
    return null
  }

  const [schedule, results] = await Promise.all([
    buildLeagueSchedule(season),
    buildLeagueResultsIndex(season),
  ])

  const [scheduleOptions, resultsOptions] = await Promise.all([
    resolveCacheOptions('leagueSchedule'),
    resolveCacheOptions('leagueResults'),
  ])

  const roundCacheInvalidate = results.rounds
    .map(round => round.roundKey)
    .filter(Boolean)
    .map(key =>
      defaultCache.invalidate(`${PUBLIC_LEAGUE_RESULTS_KEY}:${seasonId}:round:${key}`).catch(() => undefined)
    )

  await Promise.all([
    defaultCache.set(PUBLIC_LEAGUE_SCHEDULE_KEY, schedule, scheduleOptions),
    defaultCache.set(`${PUBLIC_LEAGUE_SCHEDULE_KEY}:${seasonId}`, schedule, scheduleOptions),
    defaultCache.set(PUBLIC_LEAGUE_RESULTS_KEY, results, resultsOptions),
    defaultCache.set(`${PUBLIC_LEAGUE_RESULTS_KEY}:${seasonId}`, results, resultsOptions),
    ...roundCacheInvalidate,
  ])

  if (options?.publishTopic) {
    await Promise.all([
      options.publishTopic(PUBLIC_LEAGUE_SCHEDULE_KEY, {
        type: 'league.schedule',
        seasonId: schedule.season.id,
        payload: schedule,
      }).catch(() => undefined),
      options.publishTopic(PUBLIC_LEAGUE_RESULTS_KEY, {
        type: 'league.results',
        seasonId: results.season.id,
        payload: results,
      }).catch(() => undefined),
    ])
  }

  return { schedule, results }
}
