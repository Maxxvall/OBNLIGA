import { MatchEventType, MatchStatus } from '@prisma/client'
import prisma from '../db'
import { defaultCache } from '../cache'
import { buildLeagueTable } from './leagueTable'

export type PublishFn = (topic: string, payload: unknown) => Promise<unknown>

const CLUB_FORM_LIMIT = 5
export const PUBLIC_CLUB_SUMMARY_TTL_SECONDS = 1_200

const clubSelect = {
  id: true,
  name: true,
  shortName: true,
  logoUrl: true,
} as const

const seasonSelect = {
  id: true,
  name: true,
  competition: {
    select: {
      id: true,
      name: true,
    },
  },
} as const

export const publicClubSummaryKey = (clubId: number) => `public:club:${clubId}:summary`

export class ClubSummaryNotFoundError extends Error {
  readonly clubId: number
  readonly code = 'club_not_found'

  constructor(clubId: number) {
    super('club_not_found')
    this.name = 'ClubSummaryNotFoundError'
    this.clubId = clubId
  }
}

type MatchRow = {
  id: bigint
  seasonId: number
  matchDateTime: Date
  homeTeamId: number
  awayTeamId: number
  homeScore: number
  awayScore: number
  hasPenaltyShootout: boolean
  penaltyHomeScore: number | null
  penaltyAwayScore: number | null
  homeClub: {
    id: number
    name: string
    shortName: string | null
    logoUrl: string | null
  }
  awayClub: {
    id: number
    name: string
    shortName: string | null
    logoUrl: string | null
  }
  season: {
    id: number
    name: string
    competition: {
      id: number
      name: string
    }
  }
}

type ClubSummarySnapshot = {
  club: {
    id: number
    name: string
    shortName: string
    logoUrl: string | null
  }
  statistics: {
    tournaments: number
    matchesPlayed: number
    wins: number
    draws: number
    losses: number
    goalsFor: number
    goalsAgainst: number
    yellowCards: number
    redCards: number
    cleanSheets: number
  }
  form: Array<{
    matchId: string
    matchDateTime: string
    isHome: boolean
    result: 'WIN' | 'DRAW' | 'LOSS'
    opponent: {
      id: number
      name: string
      shortName: string
      logoUrl: string | null
    }
    score: {
      home: number
      away: number
      penaltyHome: number | null
      penaltyAway: number | null
    }
    competition: {
      id: number
      name: string
    }
    season: {
      id: number
      name: string
    }
  }>
  squad: Array<{
    playerId: number
    playerName: string
    matches: number
    yellowCards: number
    redCards: number
    assists: number
    goals: number
  }>
  achievements: Array<{
    id: string
    title: string
    subtitle?: string | null
  }>
  generatedAt: string
}

const determineMatchResult = (match: MatchRow, clubId: number): 'WIN' | 'DRAW' | 'LOSS' => {
  const isHome = match.homeTeamId === clubId
  const ownScore = isHome ? match.homeScore : match.awayScore
  const oppScore = isHome ? match.awayScore : match.homeScore

  if (ownScore > oppScore) {
    return 'WIN'
  }
  if (ownScore < oppScore) {
    return 'LOSS'
  }
  if (!match.hasPenaltyShootout) {
    return 'DRAW'
  }

  const ownPenalty = isHome ? match.penaltyHomeScore ?? 0 : match.penaltyAwayScore ?? 0
  const oppPenalty = isHome ? match.penaltyAwayScore ?? 0 : match.penaltyHomeScore ?? 0

  if (ownPenalty > oppPenalty) {
    return 'WIN'
  }
  if (ownPenalty < oppPenalty) {
    return 'LOSS'
  }
  return 'DRAW'
}

const buildFormEntry = (match: MatchRow, clubId: number): ClubSummarySnapshot['form'][number] => {
  const isHome = match.homeTeamId === clubId
  const opponent = isHome ? match.awayClub : match.homeClub
  const shortName = opponent.shortName?.trim() || opponent.name
  return {
    matchId: match.id.toString(),
    matchDateTime: match.matchDateTime.toISOString(),
    isHome,
    result: determineMatchResult(match, clubId),
    opponent: {
      id: opponent.id,
      name: opponent.name,
      shortName,
      logoUrl: opponent.logoUrl,
    },
    score: {
      home: match.homeScore,
      away: match.awayScore,
      penaltyHome: match.hasPenaltyShootout ? match.penaltyHomeScore : null,
      penaltyAway: match.hasPenaltyShootout ? match.penaltyAwayScore : null,
    },
    competition: {
      id: match.season.competition.id,
      name: match.season.competition.name,
    },
    season: {
      id: match.season.id,
      name: match.season.name,
    },
  }
}

type CupWinners = {
  championId: number | null
  runnerUpId: number | null
  thirdPlaceId: number | null
  cupType: 'gold' | 'silver' | 'regular'
  cupName: string
}

type SeasonAchievementsResult = {
  goldCup: CupWinners | null
  silverCup: CupWinners | null
  regularPlayoff: CupWinners | null
  competitionName: string | null
  seasonName: string
}

// Проверяем, является ли название настоящим финалом (не 1/4, 1/8, 1/2, полуфинал)
const isActualFinal = (stageName: string): boolean => {
  const normalized = stageName.toLowerCase()
  if (!normalized.includes('финал')) return false
  if (normalized.includes('1/4')) return false
  if (normalized.includes('1/8')) return false
  if (normalized.includes('1/2')) return false
  if (normalized.includes('1/16')) return false
  if (normalized.includes('полу')) return false
  if (normalized.includes('semi')) return false
  if (normalized.includes('3 мест') || normalized.includes('третье')) return false
  return true
}

const detectSeasonAchievements = async (seasonId: number): Promise<SeasonAchievementsResult> => {
  const result: SeasonAchievementsResult = {
    goldCup: null,
    silverCup: null,
    regularPlayoff: null,
    competitionName: null,
    seasonName: '',
  }

  // Получаем сезон с соревнованием
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    include: { competition: true },
  })

  if (!season) return result

  result.seasonName = season.name
  if (season.competition) {
    result.competitionName = season.competition.name
  }

  // Получаем все серии плей-офф для этого сезона
  const series = await prisma.matchSeries.findMany({
    where: { seasonId },
    include: {
      homeClub: true,
      awayClub: true,
    },
  })

  if (series.length === 0) {
    return result
  }

  // Проверяем, есть ли кубковый формат с Gold/Silver
  const hasCupFormat = series.some((s) => s.bracketType != null)

  if (hasCupFormat) {
    // Ищем финал Золотого кубка
    const goldFinal = series.find((s) => {
      const normalized = s.stageName.toLowerCase()
      return isActualFinal(s.stageName) && normalized.includes('золот')
    })

    if (goldFinal && goldFinal.winnerClubId) {
      const loserId = goldFinal.winnerClubId === goldFinal.homeClubId
        ? goldFinal.awayClubId
        : goldFinal.homeClubId

      // Ищем 3 место Золотого кубка
      const goldThirdPlace = series.find((s) => {
        const normalized = s.stageName.toLowerCase()
        return normalized.includes('3') && normalized.includes('мест') && normalized.includes('золот')
      })

      result.goldCup = {
        championId: goldFinal.winnerClubId,
        runnerUpId: loserId,
        thirdPlaceId: goldThirdPlace?.winnerClubId ?? null,
        cupType: 'gold',
        cupName: 'Золотом кубке',
      }
    }

    // Ищем финал Серебряного кубка
    const silverFinal = series.find((s) => {
      const normalized = s.stageName.toLowerCase()
      return isActualFinal(s.stageName) && normalized.includes('серебр')
    })

    if (silverFinal && silverFinal.winnerClubId) {
      const loserId = silverFinal.winnerClubId === silverFinal.homeClubId
        ? silverFinal.awayClubId
        : silverFinal.homeClubId

      // Ищем 3 место Серебряного кубка
      const silverThirdPlace = series.find((s) => {
        const normalized = s.stageName.toLowerCase()
        return normalized.includes('3') && normalized.includes('мест') && normalized.includes('серебр')
      })

      result.silverCup = {
        championId: silverFinal.winnerClubId,
        runnerUpId: loserId,
        thirdPlaceId: silverThirdPlace?.winnerClubId ?? null,
        cupType: 'silver',
        cupName: 'Серебряном кубке',
      }
    }
  } else {
    // Обычный плей-офф без Gold/Silver
    const regularFinal = series.find((s) => isActualFinal(s.stageName))

    if (regularFinal && regularFinal.winnerClubId) {
      const loserId = regularFinal.winnerClubId === regularFinal.homeClubId
        ? regularFinal.awayClubId
        : regularFinal.homeClubId

      const thirdPlace = series.find((s) => {
        const normalized = s.stageName.toLowerCase()
        return normalized.includes('3') && normalized.includes('мест')
      })

      result.regularPlayoff = {
        championId: regularFinal.winnerClubId,
        runnerUpId: loserId,
        thirdPlaceId: thirdPlace?.winnerClubId ?? null,
        cupType: 'regular',
        cupName: '',
      }
    }
  }

  return result
}

const buildClubAchievements = async (
  clubId: number,
  seasonIds: Set<number>
): Promise<ClubSummarySnapshot['achievements']> => {
  const achievements: ClubSummarySnapshot['achievements'] = []

  // Вспомогательная функция для добавления достижения из кубка
  const addCupAchievement = (
    cup: CupWinners,
    seasonId: number,
    seasonName: string,
    competitionName: string | null
  ) => {
    let place: number | null = null

    if (cup.championId === clubId) {
      place = 1
    } else if (cup.runnerUpId === clubId) {
      place = 2
    } else if (cup.thirdPlaceId === clubId) {
      place = 3
    }

    if (place !== null) {
      let title: string
      if (cup.cupType === 'gold') {
        title = `${place} место в Золотом кубке`
      } else if (cup.cupType === 'silver') {
        title = `${place} место в Серебряном кубке`
      } else {
        title = `${place} место`
      }

      let subtitle: string
      if (competitionName && competitionName !== seasonName) {
        subtitle = `${competitionName} — ${seasonName}`
      } else {
        subtitle = seasonName
      }

      achievements.push({
        id: `season-${seasonId}-${cup.cupType}-place-${place}`,
        title,
        subtitle,
      })
    }
  }

  // Проверяем каждый сезон
  for (const seasonId of seasonIds) {
    const season = await prisma.season.findUnique({
      where: { id: seasonId },
      include: { competition: true },
    })

    if (!season) {
      continue
    }

    // Проверяем, что все матчи сезона завершены
    const hasUnfinishedMatches = await prisma.match.count({
      where: {
        seasonId,
        status: { not: MatchStatus.FINISHED },
        isFriendly: false,
      },
    })

    if (hasUnfinishedMatches > 0) {
      continue // Пропускаем сезоны с незавершёнными матчами
    }

    // Получаем все достижения сезона (Золотой кубок, Серебряный кубок, обычный плей-офф)
    const seasonAchievements = await detectSeasonAchievements(seasonId)

    let hasPlayoffAchievement = false

    // Проверяем Золотой кубок
    if (seasonAchievements.goldCup) {
      addCupAchievement(
        seasonAchievements.goldCup,
        seasonId,
        seasonAchievements.seasonName,
        seasonAchievements.competitionName
      )
      if (
        seasonAchievements.goldCup.championId === clubId ||
        seasonAchievements.goldCup.runnerUpId === clubId ||
        seasonAchievements.goldCup.thirdPlaceId === clubId
      ) {
        hasPlayoffAchievement = true
      }
    }

    // Проверяем Серебряный кубок
    if (seasonAchievements.silverCup) {
      addCupAchievement(
        seasonAchievements.silverCup,
        seasonId,
        seasonAchievements.seasonName,
        seasonAchievements.competitionName
      )
      if (
        seasonAchievements.silverCup.championId === clubId ||
        seasonAchievements.silverCup.runnerUpId === clubId ||
        seasonAchievements.silverCup.thirdPlaceId === clubId
      ) {
        hasPlayoffAchievement = true
      }
    }

    // Проверяем обычный плей-офф (без Gold/Silver)
    if (seasonAchievements.regularPlayoff) {
      addCupAchievement(
        seasonAchievements.regularPlayoff,
        seasonId,
        seasonAchievements.seasonName,
        seasonAchievements.competitionName
      )
      if (
        seasonAchievements.regularPlayoff.championId === clubId ||
        seasonAchievements.regularPlayoff.runnerUpId === clubId ||
        seasonAchievements.regularPlayoff.thirdPlaceId === clubId
      ) {
        hasPlayoffAchievement = true
      }
    }

    // Если в плей-офф нет достижений, проверяем турнирную таблицу
    if (!hasPlayoffAchievement) {
      try {
        const tableData = await buildLeagueTable(season)
        const standings = tableData.standings

        // Находим позицию клуба
        const clubPosition = standings.findIndex((entry) => entry.clubId === clubId)

        // Если клуб в топ-3
        if (clubPosition !== -1 && clubPosition < 3) {
          const tablePlace = clubPosition + 1

          // Формируем subtitle с названием соревнования
          let subtitle: string
          if (season.competition?.name && season.competition.name !== season.name) {
            subtitle = `${season.competition.name} — ${season.name}`
          } else {
            subtitle = season.name
          }

          achievements.push({
            id: `season-${seasonId}-table-place-${tablePlace}`,
            title: `${tablePlace} место`,
            subtitle,
          })
        }
      } catch (err) {
        // Если не удалось построить таблицу, пропускаем этот сезон
        console.warn(`Failed to build league table for season ${seasonId}:`, err)
      }
    }
  }

  // Сортируем достижения: сначала по месту (1, 2, 3), потом по дате сезона
  achievements.sort((a, b) => {
    const placeA = parseInt(a.title.match(/(\d+)/)?.[1] || '999', 10)
    const placeB = parseInt(b.title.match(/(\d+)/)?.[1] || '999', 10)
    return placeA - placeB
  })

  return achievements
}

export const buildClubSummary = async (clubId: number): Promise<ClubSummarySnapshot | null> => {
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: clubSelect,
  })

  if (!club) {
    return null
  }

  const [participants, matches, yellowCards, redCards, squadData] = await Promise.all([
    prisma.seasonParticipant.findMany({
      where: { clubId },
      select: { seasonId: true },
    }),
    prisma.match.findMany({
      where: {
        status: MatchStatus.FINISHED,
        OR: [{ homeTeamId: clubId }, { awayTeamId: clubId }],
        isFriendly: false,
      },
      orderBy: [{ matchDateTime: 'desc' }],
      include: {
        season: { select: seasonSelect },
        homeClub: { select: clubSelect },
        awayClub: { select: clubSelect },
      },
    }),
    prisma.matchEvent.count({
      where: {
        teamId: clubId,
        eventType: MatchEventType.YELLOW_CARD,
        match: { status: MatchStatus.FINISHED, isFriendly: false },
      },
    }),
    prisma.matchEvent.count({
      where: {
        teamId: clubId,
        eventType: MatchEventType.RED_CARD,
        match: { status: MatchStatus.FINISHED, isFriendly: false },
      },
    }),
    prisma.playerClubCareerStats.findMany({
      where: { clubId },
      orderBy: { totalMatches: 'desc' },
      include: {
        person: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    }),
  ])

  const seasonIds = new Set<number>()
  for (const participant of participants) {
    seasonIds.add(participant.seasonId)
  }

  const officialMatches: MatchRow[] = matches
    .filter(match => match.seasonId !== null && match.season !== null)
    .map(match => ({
      id: match.id,
      seasonId: match.seasonId as number,
      matchDateTime: match.matchDateTime,
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      hasPenaltyShootout: match.hasPenaltyShootout,
      penaltyHomeScore: match.hasPenaltyShootout ? match.penaltyHomeScore : null,
      penaltyAwayScore: match.hasPenaltyShootout ? match.penaltyAwayScore : null,
      homeClub: {
        id: match.homeClub.id,
        name: match.homeClub.name,
        shortName: match.homeClub.shortName ?? null,
        logoUrl: match.homeClub.logoUrl ?? null,
      },
      awayClub: {
        id: match.awayClub.id,
        name: match.awayClub.name,
        shortName: match.awayClub.shortName ?? null,
        logoUrl: match.awayClub.logoUrl ?? null,
      },
      season: {
        id: match.season!.id,
        name: match.season!.name,
        competition: match.season!.competition,
      },
    }))

  let wins = 0
  let draws = 0
  let losses = 0
  let goalsFor = 0
  let goalsAgainst = 0
  let cleanSheets = 0

  for (const match of officialMatches) {
    seasonIds.add(match.seasonId)
    const isHome = match.homeTeamId === clubId
    const ownScore = isHome ? match.homeScore : match.awayScore
    const oppScore = isHome ? match.awayScore : match.homeScore
    goalsFor += ownScore
    goalsAgainst += oppScore
    if (oppScore === 0) {
      cleanSheets += 1
    }
    const result = determineMatchResult(match, clubId)
    if (result === 'WIN') {
      wins += 1
    } else if (result === 'LOSS') {
      losses += 1
    } else {
      draws += 1
    }
  }

  const tournaments = seasonIds.size
  const matchesPlayed = officialMatches.length

  const squad = squadData.map((player) => ({
    playerId: player.personId,
    playerName: `${player.person.firstName} ${player.person.lastName}`,
    matches: player.totalMatches,
    yellowCards: player.yellowCards,
    redCards: player.redCards,
    assists: player.totalAssists,
    goals: player.totalGoals,
  }))

  // Генерируем достижения (топ-3 места в завершенных сезонах)
  const achievements = await buildClubAchievements(clubId, seasonIds)

  const summary: ClubSummarySnapshot = {
    club: {
      id: club.id,
      name: club.name,
      shortName: club.shortName?.trim() || club.name,
      logoUrl: club.logoUrl ?? null,
    },
    statistics: {
      tournaments,
      matchesPlayed,
      wins,
      draws,
      losses,
      goalsFor,
      goalsAgainst,
      yellowCards,
      redCards,
      cleanSheets,
    },
    form: officialMatches.slice(0, CLUB_FORM_LIMIT).map(match => buildFormEntry(match, clubId)),
    squad,
    achievements,
    generatedAt: new Date().toISOString(),
  }

  return summary
}

export const getClubSummary = async (clubId: number) => {
  const cacheKey = publicClubSummaryKey(clubId)
  const loader = async () => {
    const summary = await buildClubSummary(clubId)
    if (!summary) {
      throw new ClubSummaryNotFoundError(clubId)
    }
    return summary
  }
  return defaultCache.getWithMeta(cacheKey, loader, PUBLIC_CLUB_SUMMARY_TTL_SECONDS)
}

export const refreshClubSummary = async (
  clubId: number,
  options?: { publishTopic?: PublishFn }
): Promise<ClubSummarySnapshot | null> => {
  const summary = await buildClubSummary(clubId)
  if (!summary) {
    return null
  }

  const cacheKey = publicClubSummaryKey(clubId)

  await defaultCache.set(cacheKey, summary, PUBLIC_CLUB_SUMMARY_TTL_SECONDS)

  if (options?.publishTopic) {
    try {
      await options.publishTopic(cacheKey, {
        type: 'club.summary',
        clubId,
        payload: summary,
      })
    } catch (err) {
      // предупреждение будет зафиксировано выше по стеку логгера
    }
  }

  return summary
}
