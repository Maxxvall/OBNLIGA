/**
 * Сервис архивирования сезонов — создание JSON-снимков для завершённых сезонов
 * и управление процессом архивации
 */
import prisma from '../db'
import { MatchStatus, SeriesStatus, BracketType } from '@prisma/client'
import { defaultCache, PUBLIC_LEAGUE_RESULTS_KEY, PUBLIC_LEAGUE_SCHEDULE_KEY } from '../cache'
import type { SeasonWithCompetition, LeagueTableEntry } from './leagueTable'
import { buildLeagueTable } from './leagueTable'

// =================== ТИПЫ ДЛЯ JSON-СНИМКОВ ===================

/** Краткая информация о клубе в архиве */
export interface ArchiveClubInfo {
  id: number
  name: string
  shortName: string
  logoUrl: string | null
}

/** Сводка сезона */
export interface SeasonArchiveSummary {
  seasonId: number
  seasonName: string
  competitionName: string
  competitionType: 'LEAGUE' | 'CUP'
  startDate: string
  endDate: string
  goldCupWinner: ArchiveClubInfo | null
  goldCupRunnerUp: ArchiveClubInfo | null
  goldCupThirdPlace: ArchiveClubInfo | null
  silverCupWinner: ArchiveClubInfo | null
  silverCupRunnerUp: ArchiveClubInfo | null
  totalMatches: number
  totalGoals: number
  totalYellowCards: number
  totalRedCards: number
  avgGoalsPerMatch: number
}

/** Строка таблицы в архиве */
export interface ArchiveStandingEntry {
  position: number
  clubId: number
  clubName: string
  shortName: string
  logoUrl: string | null
  played: number
  wins: number
  draws: number
  losses: number
  goalsFor: number
  goalsAgainst: number
  points: number
}

/** Таблица в архиве */
export interface SeasonArchiveStandings {
  groups: Array<{
    groupLabel: string
    standings: ArchiveStandingEntry[]
  }>
  overall?: ArchiveStandingEntry[]
}

/** Запись бомбардира/ассистента */
export interface ArchiveLeaderEntry {
  personId: number
  firstName: string
  lastName: string
  clubId: number
  clubName: string
  clubShortName: string
  clubLogoUrl: string | null
  goals: number
  assists: number
  penaltyGoals: number
  matchesPlayed: number
}

/** Матч в сетке плей-офф */
export interface ArchivePlayoffMatch {
  matchId: string
  date: string
  homeScore: number
  awayScore: number
  hasPenalty: boolean
  penaltyHome: number | null
  penaltyAway: number | null
}

/** Серия в сетке плей-офф */
export interface ArchivePlayoffSeries {
  seriesId: string
  homeClub: ArchiveClubInfo
  awayClub: ArchiveClubInfo
  homeWins: number
  awayWins: number
  winnerId: number | null
  matches: ArchivePlayoffMatch[]
}

/** Этап плей-офф */
export interface ArchivePlayoffStage {
  stageName: string
  series: ArchivePlayoffSeries[]
}

/** Данные о сетке плей-офф */
export interface ArchivePlayoffBracket {
  goldBracket: ArchivePlayoffStage[]
  silverBracket: ArchivePlayoffStage[]
}

/** Группа с командами */
export interface ArchiveGroup {
  groupIndex: number
  label: string
  qualifyCount: number
  clubs: ArchiveClubInfo[]
}

/** Краткий итог матча */
export interface ArchiveMatchSummary {
  matchId: string
  date: string
  roundLabel: string
  groupLabel: string | null
  homeClubId: number
  awayClubId: number
  homeScore: number
  awayScore: number
  hasPenalty: boolean
  penaltyHome: number | null
  penaltyAway: number | null
}

/** Достижения команды */
export interface ArchiveTeamAchievement {
  clubId: number
  clubName: string
  achievement: string
  place: number
}

/** Полные данные архива сезона */
export interface SeasonArchiveData {
  summary: SeasonArchiveSummary
  standings: SeasonArchiveStandings
  topScorers: ArchiveLeaderEntry[]
  topAssists: ArchiveLeaderEntry[]
  playoffBracket: ArchivePlayoffBracket
  groups: ArchiveGroup[]
  matchSummaries: ArchiveMatchSummary[]
  achievements: ArchiveTeamAchievement[]
  totalMatches: number
  totalGoals: number
  totalCards: number
  participantsCount: number
}

// =================== ВАЛИДАЦИЯ ===================

export type ArchiveValidationError =
  | 'season_not_found'
  | 'season_already_archived'
  | 'season_has_unfinished_matches'
  | 'season_has_unfinished_series'
  | 'season_is_active'

export interface ArchiveValidationResult {
  valid: boolean
  error?: ArchiveValidationError
  details?: string
}

/**
 * Проверяет готовность сезона к архивации
 */
export const validateSeasonForArchive = async (
  seasonId: number
): Promise<ArchiveValidationResult> => {
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    include: { competition: true },
  })

  if (!season) {
    return { valid: false, error: 'season_not_found' }
  }

  if (season.isArchived) {
    return { valid: false, error: 'season_already_archived' }
  }

  if (season.isActive) {
    return { valid: false, error: 'season_is_active', details: 'Сезон ещё активен' }
  }

  // Проверяем незавершённые матчи
  const unfinishedMatches = await prisma.match.count({
    where: {
      seasonId,
      status: { not: MatchStatus.FINISHED },
      isFriendly: false,
    },
  })

  if (unfinishedMatches > 0) {
    return {
      valid: false,
      error: 'season_has_unfinished_matches',
      details: `${unfinishedMatches} матч(а/ей) не завершено`,
    }
  }

  // Проверяем незавершённые серии плей-офф
  const unfinishedSeries = await prisma.matchSeries.count({
    where: {
      seasonId,
      seriesStatus: { not: SeriesStatus.FINISHED },
    },
  })

  if (unfinishedSeries > 0) {
    return {
      valid: false,
      error: 'season_has_unfinished_series',
      details: `${unfinishedSeries} серия(й) плей-офф не завершена`,
    }
  }

  return { valid: true }
}

// =================== ПОСТРОЕНИЕ АРХИВА ===================

/**
 * Загружает клуб и преобразует в ArchiveClubInfo
 */
const toArchiveClub = (club: {
  id: number
  name: string
  shortName: string
  logoUrl: string | null
}): ArchiveClubInfo => ({
  id: club.id,
  name: club.name,
  shortName: club.shortName,
  logoUrl: club.logoUrl,
})

/**
 * Определяет победителей плей-офф по типу сетки
 */
const findBracketWinners = async (
  seasonId: number,
  bracketType: BracketType
): Promise<{
  champion: ArchiveClubInfo | null
  runnerUp: ArchiveClubInfo | null
  thirdPlace: ArchiveClubInfo | null
}> => {
  const finishedSeries = await prisma.matchSeries.findMany({
    where: {
      seasonId,
      bracketType,
      seriesStatus: SeriesStatus.FINISHED,
      winnerClubId: { not: null },
    },
    include: {
      homeClub: { select: { id: true, name: true, shortName: true, logoUrl: true } },
      awayClub: { select: { id: true, name: true, shortName: true, logoUrl: true } },
    },
  })

  let finalSeries: typeof finishedSeries[number] | undefined
  let thirdSeries: typeof finishedSeries[number] | undefined

  for (const series of finishedSeries) {
    const normalized = series.stageName.toLowerCase()
    const isSemi =
      normalized.includes('1/2') ||
      normalized.includes('semi') ||
      normalized.includes('полу')

    if (!finalSeries && !isSemi && normalized.includes('финал')) {
      finalSeries = series
    }

    if (!thirdSeries && (normalized.includes('3 место') || normalized.includes('за 3'))) {
      thirdSeries = series
    }
  }

  if (!finalSeries || finalSeries.winnerClubId == null) {
    return { champion: null, runnerUp: null, thirdPlace: null }
  }

  const championIsHome = finalSeries.winnerClubId === finalSeries.homeClubId
  const champion = championIsHome ? finalSeries.homeClub : finalSeries.awayClub
  const runnerUp = championIsHome ? finalSeries.awayClub : finalSeries.homeClub

  let thirdPlace: typeof champion | null = null
  if (thirdSeries && thirdSeries.winnerClubId != null) {
    const thirdIsHome = thirdSeries.winnerClubId === thirdSeries.homeClubId
    thirdPlace = thirdIsHome ? thirdSeries.homeClub : thirdSeries.awayClub
  }

  return {
    champion: toArchiveClub(champion),
    runnerUp: toArchiveClub(runnerUp),
    thirdPlace: thirdPlace ? toArchiveClub(thirdPlace) : null,
  }
}

/**
 * Строит сводку сезона
 */
const buildSummary = async (
  season: SeasonWithCompetition,
  matchStats: { totalGoals: number; totalYellowCards: number; totalRedCards: number },
  matchCount: number
): Promise<SeasonArchiveSummary> => {
  // Ищем победителей золотого кубка
  const goldWinners = await findBracketWinners(season.id, BracketType.GOLD)
  
  // Ищем победителей серебряного кубка
  const silverWinners = await findBracketWinners(season.id, BracketType.SILVER)

  return {
    seasonId: season.id,
    seasonName: season.name,
    competitionName: season.competition.name,
    competitionType: season.competition.type as 'LEAGUE' | 'CUP',
    startDate: season.startDate.toISOString(),
    endDate: season.endDate.toISOString(),
    goldCupWinner: goldWinners.champion,
    goldCupRunnerUp: goldWinners.runnerUp,
    goldCupThirdPlace: goldWinners.thirdPlace,
    silverCupWinner: silverWinners.champion,
    silverCupRunnerUp: silverWinners.runnerUp,
    totalMatches: matchCount,
    totalGoals: matchStats.totalGoals,
    totalYellowCards: matchStats.totalYellowCards,
    totalRedCards: matchStats.totalRedCards,
    avgGoalsPerMatch: matchCount > 0 ? Math.round((matchStats.totalGoals / matchCount) * 100) / 100 : 0,
  }
}

/**
 * Преобразует таблицу лиги в формат архива
 */
const buildStandings = (tableEntries: LeagueTableEntry[]): SeasonArchiveStandings => {
  const groupsMap = new Map<string, ArchiveStandingEntry[]>()
  const overall: ArchiveStandingEntry[] = []

  for (const entry of tableEntries) {
    const archiveEntry: ArchiveStandingEntry = {
      position: entry.position,
      clubId: entry.clubId,
      clubName: entry.clubName,
      shortName: entry.clubShortName,
      logoUrl: entry.clubLogoUrl,
      played: entry.matchesPlayed,
      wins: entry.wins,
      draws: entry.draws,
      losses: entry.losses,
      goalsFor: entry.goalsFor,
      goalsAgainst: entry.goalsAgainst,
      points: entry.points,
    }

    overall.push(archiveEntry)

    if (entry.groupLabel) {
      const existing = groupsMap.get(entry.groupLabel) ?? []
      existing.push(archiveEntry)
      groupsMap.set(entry.groupLabel, existing)
    }
  }

  const groups = Array.from(groupsMap.entries()).map(([label, standings]) => ({
    groupLabel: label,
    standings: standings.sort((a, b) => a.position - b.position),
  }))

  return {
    groups,
    overall: overall.sort((a, b) => a.position - b.position),
  }
}

/**
 * Загружает топ бомбардиров сезона
 */
const loadTopScorers = async (seasonId: number, limit = 20): Promise<ArchiveLeaderEntry[]> => {
  const stats = await prisma.playerSeasonStats.findMany({
    where: { seasonId, goals: { gt: 0 } },
    orderBy: [{ goals: 'desc' }, { matchesPlayed: 'asc' }],
    take: limit,
    include: {
      person: { select: { id: true, firstName: true, lastName: true } },
      club: { select: { id: true, name: true, shortName: true, logoUrl: true } },
    },
  })

  return stats.map(stat => ({
    personId: stat.personId,
    firstName: stat.person.firstName,
    lastName: stat.person.lastName,
    clubId: stat.clubId,
    clubName: stat.club.name,
    clubShortName: stat.club.shortName,
    clubLogoUrl: stat.club.logoUrl,
    goals: stat.goals,
    assists: stat.assists,
    penaltyGoals: stat.penaltyGoals,
    matchesPlayed: stat.matchesPlayed,
  }))
}

/**
 * Загружает топ ассистентов сезона
 */
const loadTopAssists = async (seasonId: number, limit = 20): Promise<ArchiveLeaderEntry[]> => {
  const stats = await prisma.playerSeasonStats.findMany({
    where: { seasonId, assists: { gt: 0 } },
    orderBy: [{ assists: 'desc' }, { matchesPlayed: 'asc' }],
    take: limit,
    include: {
      person: { select: { id: true, firstName: true, lastName: true } },
      club: { select: { id: true, name: true, shortName: true, logoUrl: true } },
    },
  })

  return stats.map(stat => ({
    personId: stat.personId,
    firstName: stat.person.firstName,
    lastName: stat.person.lastName,
    clubId: stat.clubId,
    clubName: stat.club.name,
    clubShortName: stat.club.shortName,
    clubLogoUrl: stat.club.logoUrl,
    goals: stat.goals,
    assists: stat.assists,
    penaltyGoals: stat.penaltyGoals,
    matchesPlayed: stat.matchesPlayed,
  }))
}

/**
 * Строит данные сетки плей-офф для конкретного типа сетки
 */
const buildBracketStages = async (
  seasonId: number,
  bracketType: BracketType
): Promise<ArchivePlayoffStage[]> => {
  const series = await prisma.matchSeries.findMany({
    where: { seasonId, bracketType },
    include: {
      homeClub: { select: { id: true, name: true, shortName: true, logoUrl: true } },
      awayClub: { select: { id: true, name: true, shortName: true, logoUrl: true } },
      matches: {
        where: { status: MatchStatus.FINISHED },
        orderBy: { seriesMatchNumber: 'asc' },
        select: {
          id: true,
          matchDateTime: true,
          homeScore: true,
          awayScore: true,
          hasPenaltyShootout: true,
          penaltyHomeScore: true,
          penaltyAwayScore: true,
        },
      },
    },
  })

  // Группируем по stageName
  const stagesMap = new Map<string, typeof series>()
  for (const s of series) {
    const existing = stagesMap.get(s.stageName) ?? []
    existing.push(s)
    stagesMap.set(s.stageName, existing)
  }

  const stages: ArchivePlayoffStage[] = []
  for (const [stageName, seriesList] of stagesMap.entries()) {
    const archiveSeries: ArchivePlayoffSeries[] = seriesList.map(s => {
      // Подсчёт побед в серии
      let homeWins = 0
      let awayWins = 0

      for (const match of s.matches) {
        if (match.homeScore > match.awayScore) {
          if (s.homeClubId === s.homeClubId) homeWins++
          else awayWins++
        } else if (match.homeScore < match.awayScore) {
          if (s.awayClubId === s.awayClubId) awayWins++
          else homeWins++
        } else if (match.hasPenaltyShootout) {
          if ((match.penaltyHomeScore ?? 0) > (match.penaltyAwayScore ?? 0)) {
            homeWins++
          } else {
            awayWins++
          }
        }
      }

      return {
        seriesId: s.id.toString(),
        homeClub: toArchiveClub(s.homeClub),
        awayClub: toArchiveClub(s.awayClub),
        homeWins,
        awayWins,
        winnerId: s.winnerClubId,
        matches: s.matches.map(m => ({
          matchId: m.id.toString(),
          date: m.matchDateTime.toISOString(),
          homeScore: m.homeScore,
          awayScore: m.awayScore,
          hasPenalty: m.hasPenaltyShootout,
          penaltyHome: m.hasPenaltyShootout ? m.penaltyHomeScore : null,
          penaltyAway: m.hasPenaltyShootout ? m.penaltyAwayScore : null,
        })),
      }
    })

    stages.push({ stageName, series: archiveSeries })
  }

  return stages
}

/**
 * Строит данные сетки плей-офф
 */
const buildPlayoffBracket = async (seasonId: number): Promise<ArchivePlayoffBracket> => {
  const goldBracket = await buildBracketStages(seasonId, BracketType.GOLD)
  const silverBracket = await buildBracketStages(seasonId, BracketType.SILVER)

  return { goldBracket, silverBracket }
}

/**
 * Загружает информацию о группах сезона
 */
const loadGroups = async (seasonId: number): Promise<ArchiveGroup[]> => {
  const seasonGroups = await prisma.seasonGroup.findMany({
    where: { seasonId },
    include: {
      slots: {
        orderBy: { position: 'asc' },
        include: {
          club: { select: { id: true, name: true, shortName: true, logoUrl: true } },
        },
      },
    },
    orderBy: { groupIndex: 'asc' },
  })

  return seasonGroups.map(group => ({
    groupIndex: group.groupIndex,
    label: group.label,
    qualifyCount: group.qualifyCount,
    clubs: group.slots
      .filter(slot => slot.club !== null)
      .map(slot => toArchiveClub(slot.club!)),
  }))
}

/**
 * Загружает краткие итоги всех матчей сезона
 */
const loadMatchSummaries = async (seasonId: number): Promise<ArchiveMatchSummary[]> => {
  const matches = await prisma.match.findMany({
    where: { seasonId, status: MatchStatus.FINISHED, isFriendly: false },
    orderBy: { matchDateTime: 'desc' },
    select: {
      id: true,
      matchDateTime: true,
      homeTeamId: true,
      awayTeamId: true,
      homeScore: true,
      awayScore: true,
      hasPenaltyShootout: true,
      penaltyHomeScore: true,
      penaltyAwayScore: true,
      round: { select: { label: true } },
      seasonGroup: { select: { label: true } },
    },
  })

  return matches.map(m => ({
    matchId: m.id.toString(),
    date: m.matchDateTime.toISOString(),
    roundLabel: m.round?.label ?? 'Без тура',
    groupLabel: m.seasonGroup?.label ?? null,
    homeClubId: m.homeTeamId,
    awayClubId: m.awayTeamId,
    homeScore: m.homeScore,
    awayScore: m.awayScore,
    hasPenalty: m.hasPenaltyShootout,
    penaltyHome: m.hasPenaltyShootout ? m.penaltyHomeScore : null,
    penaltyAway: m.hasPenaltyShootout ? m.penaltyAwayScore : null,
  }))
}

/**
 * Подсчитывает статистику матчей (голы, карточки)
 */
const computeMatchStats = async (
  seasonId: number
): Promise<{ totalGoals: number; totalYellowCards: number; totalRedCards: number }> => {
  // Подсчёт голов из матчей
  const matches = await prisma.match.findMany({
    where: { seasonId, status: MatchStatus.FINISHED, isFriendly: false },
    select: { homeScore: true, awayScore: true },
  })

  const totalGoals = matches.reduce((sum, m) => sum + m.homeScore + m.awayScore, 0)

  // Подсчёт карточек из событий
  const cardCounts = await prisma.matchEvent.groupBy({
    by: ['eventType'],
    where: {
      match: { seasonId, status: MatchStatus.FINISHED, isFriendly: false },
      eventType: { in: ['YELLOW_CARD', 'SECOND_YELLOW_CARD', 'RED_CARD'] },
    },
    _count: { eventType: true },
  })

  let totalYellowCards = 0
  let totalRedCards = 0

  for (const card of cardCounts) {
    if (card.eventType === 'YELLOW_CARD' || card.eventType === 'SECOND_YELLOW_CARD') {
      totalYellowCards += card._count.eventType
    }
    if (card.eventType === 'RED_CARD' || card.eventType === 'SECOND_YELLOW_CARD') {
      totalRedCards += card._count.eventType
    }
  }

  return { totalGoals, totalYellowCards, totalRedCards }
}

/**
 * Строит достижения команд (места в турнире)
 */
const buildAchievements = (
  summary: SeasonArchiveSummary,
  standings: SeasonArchiveStandings
): ArchiveTeamAchievement[] => {
  const achievements: ArchiveTeamAchievement[] = []

  // Добавляем победителей кубков
  if (summary.goldCupWinner) {
    achievements.push({
      clubId: summary.goldCupWinner.id,
      clubName: summary.goldCupWinner.name,
      achievement: 'Победитель Золотого кубка',
      place: 1,
    })
  }

  if (summary.goldCupRunnerUp) {
    achievements.push({
      clubId: summary.goldCupRunnerUp.id,
      clubName: summary.goldCupRunnerUp.name,
      achievement: 'Финалист Золотого кубка',
      place: 2,
    })
  }

  if (summary.goldCupThirdPlace) {
    achievements.push({
      clubId: summary.goldCupThirdPlace.id,
      clubName: summary.goldCupThirdPlace.name,
      achievement: '3 место Золотого кубка',
      place: 3,
    })
  }

  if (summary.silverCupWinner) {
    achievements.push({
      clubId: summary.silverCupWinner.id,
      clubName: summary.silverCupWinner.name,
      achievement: 'Победитель Серебряного кубка',
      place: 1,
    })
  }

  if (summary.silverCupRunnerUp) {
    achievements.push({
      clubId: summary.silverCupRunnerUp.id,
      clubName: summary.silverCupRunnerUp.name,
      achievement: 'Финалист Серебряного кубка',
      place: 2,
    })
  }

  // Добавляем места по таблице (топ-3)
  if (standings.overall && standings.overall.length > 0) {
    const top3 = standings.overall.slice(0, 3)
    for (const entry of top3) {
      achievements.push({
        clubId: entry.clubId,
        clubName: entry.clubName,
        achievement: `${entry.position} место в общей таблице`,
        place: entry.position,
      })
    }
  }

  return achievements
}

/**
 * Собирает полный снимок архива сезона
 */
export const buildSeasonArchive = async (seasonId: number): Promise<SeasonArchiveData | null> => {
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    include: { competition: true },
  })

  if (!season) {
    return null
  }

  // Параллельно загружаем все данные
  const [
    tableResponse,
    matchStats,
    matchCount,
    participantsCount,
    topScorers,
    topAssists,
    playoffBracket,
    groups,
    matchSummaries,
  ] = await Promise.all([
    buildLeagueTable(season),
    computeMatchStats(seasonId),
    prisma.match.count({ where: { seasonId, status: MatchStatus.FINISHED, isFriendly: false } }),
    prisma.seasonParticipant.count({ where: { seasonId } }),
    loadTopScorers(seasonId),
    loadTopAssists(seasonId),
    buildPlayoffBracket(seasonId),
    loadGroups(seasonId),
    loadMatchSummaries(seasonId),
  ])

  const summary = await buildSummary(season, matchStats, matchCount)
  const standings = buildStandings(tableResponse.standings)
  const achievements = buildAchievements(summary, standings)

  return {
    summary,
    standings,
    topScorers,
    topAssists,
    playoffBracket,
    groups,
    matchSummaries,
    achievements,
    totalMatches: matchCount,
    totalGoals: matchStats.totalGoals,
    totalCards: matchStats.totalYellowCards + matchStats.totalRedCards,
    participantsCount,
  }
}

// =================== АРХИВАЦИЯ ===================

export interface ArchiveSeasonResult {
  success: boolean
  archiveId?: string
  seasonId?: number
  archivedAt?: string
  error?: ArchiveValidationError | 'archive_build_failed'
  details?: string
}

/**
 * Архивирует сезон: создаёт снимок, устанавливает флаги, инвалидирует кеш
 */
export const archiveSeason = async (
  seasonId: number,
  adminIdentifier: string
): Promise<ArchiveSeasonResult> => {
  // Валидация
  const validation = await validateSeasonForArchive(seasonId)
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error,
      details: validation.details,
    }
  }

  // Собираем архив
  const archiveData = await buildSeasonArchive(seasonId)
  if (!archiveData) {
    return {
      success: false,
      error: 'archive_build_failed',
      details: 'Не удалось собрать данные для архива',
    }
  }

  const now = new Date()

  // Транзакция: создаём архив и обновляем сезон
  const result = await prisma.$transaction(async tx => {
    // Создаём запись архива
    const archive = await tx.seasonArchive.create({
      data: {
        seasonId,
        archivedAt: now,
        archivedBy: adminIdentifier,
        schemaVersion: 1,
        summary: archiveData.summary as object,
        standings: archiveData.standings as object,
        topScorers: archiveData.topScorers as object[],
        topAssists: archiveData.topAssists as object[],
        playoffBracket: archiveData.playoffBracket as object,
        groups: archiveData.groups as object[],
        matchSummaries: archiveData.matchSummaries as object[],
        achievements: archiveData.achievements as object[],
        totalMatches: archiveData.totalMatches,
        totalGoals: archiveData.totalGoals,
        totalCards: archiveData.totalCards,
        participantsCount: archiveData.participantsCount,
      },
    })

    // Обновляем сезон
    await tx.season.update({
      where: { id: seasonId },
      data: {
        isArchived: true,
        archivedAt: now,
        archivedBy: adminIdentifier,
      },
    })

    // Помечаем матчи как архивированные
    await tx.match.updateMany({
      where: { seasonId },
      data: { isArchived: true },
    })

    return archive
  })

  // Инвалидируем кеш
  await invalidateSeasonCaches(seasonId)

  return {
    success: true,
    archiveId: result.id.toString(),
    seasonId,
    archivedAt: now.toISOString(),
  }
}

/**
 * Инвалидирует кеши, связанные с сезоном
 */
const invalidateSeasonCaches = async (seasonId: number): Promise<void> => {
  const cacheKeys = [
    `${PUBLIC_LEAGUE_RESULTS_KEY}:${seasonId}`,
    `${PUBLIC_LEAGUE_SCHEDULE_KEY}:${seasonId}`,
    `public:league:table:v2:${seasonId}`,
    `public:league:stats:${seasonId}`,
    `public:league:top-scorers:${seasonId}`,
    `public:league:top-assists:${seasonId}`,
    `public:league:goal-contributors:${seasonId}`,
  ]

  await Promise.all(
    cacheKeys.map(key => defaultCache.invalidate(key).catch(() => undefined))
  )
}

// =================== ПОЛУЧЕНИЕ АРХИВА ===================

export interface SeasonArchiveResponse {
  seasonId: number
  archivedAt: string
  archivedBy: string | null
  schemaVersion: number
  summary: SeasonArchiveSummary
  standings: SeasonArchiveStandings
  topScorers: ArchiveLeaderEntry[]
  topAssists: ArchiveLeaderEntry[]
  playoffBracket: ArchivePlayoffBracket
  groups: ArchiveGroup[]
  matchSummaries: ArchiveMatchSummary[]
  achievements: ArchiveTeamAchievement[]
  totalMatches: number
  totalGoals: number
  totalCards: number
  participantsCount: number
}

/**
 * Получает архив сезона по ID
 */
export const getSeasonArchive = async (
  seasonId: number
): Promise<SeasonArchiveResponse | null> => {
  const archive = await prisma.seasonArchive.findUnique({
    where: { seasonId },
  })

  if (!archive) {
    return null
  }

  return {
    seasonId: archive.seasonId,
    archivedAt: archive.archivedAt.toISOString(),
    archivedBy: archive.archivedBy,
    schemaVersion: archive.schemaVersion,
    summary: archive.summary as unknown as SeasonArchiveSummary,
    standings: archive.standings as unknown as SeasonArchiveStandings,
    topScorers: archive.topScorers as unknown as ArchiveLeaderEntry[],
    topAssists: archive.topAssists as unknown as ArchiveLeaderEntry[],
    playoffBracket: archive.playoffBracket as unknown as ArchivePlayoffBracket,
    groups: archive.groups as unknown as ArchiveGroup[],
    matchSummaries: archive.matchSummaries as unknown as ArchiveMatchSummary[],
    achievements: archive.achievements as unknown as ArchiveTeamAchievement[],
    totalMatches: archive.totalMatches,
    totalGoals: archive.totalGoals,
    totalCards: archive.totalCards,
    participantsCount: archive.participantsCount,
  }
}

/**
 * Проверяет, архивирован ли сезон
 */
export const isSeasonArchived = async (seasonId: number): Promise<boolean> => {
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    select: { isArchived: true },
  })

  return season?.isArchived ?? false
}
