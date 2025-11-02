import { MatchEventType, MatchStatus } from '@prisma/client'
import prisma from '../db'
import { defaultCache } from '../cache'

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
    achievements: [],
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
