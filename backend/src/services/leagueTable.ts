import prisma from '../db'
import { MatchStatus, Prisma, RoundType } from '@prisma/client'

export interface LeagueSeasonSummary {
  id: number
  name: string
  startDate: string
  endDate: string
  isActive: boolean
  city: string | null
  competition: {
    id: number
    name: string
    type: string
  }
}

export interface LeagueTableEntry {
  position: number
  clubId: number
  clubName: string
  clubShortName: string
  clubLogoUrl: string | null
  matchesPlayed: number
  wins: number
  draws: number
  losses: number
  goalsFor: number
  goalsAgainst: number
  goalDifference: number
  points: number
}

export interface LeagueTableResponse {
  season: LeagueSeasonSummary
  standings: LeagueTableEntry[]
}

export type SeasonWithCompetition = Prisma.SeasonGetPayload<{
  include: {
    competition: true
  }
}>

export const ensureSeasonSummary = (season: SeasonWithCompetition): LeagueSeasonSummary => ({
  id: season.id,
  name: season.name,
  startDate: season.startDate.toISOString(),
  endDate: season.endDate.toISOString(),
  isActive: season.isActive,
  city: season.city ?? null,
    competition: {
      id: season.competitionId,
      name: season.competition.name,
      type: season.competition.type,
    },
})

export const fetchLeagueSeasons = async (): Promise<LeagueSeasonSummary[]> => {
  const seasons = await prisma.season.findMany({
    orderBy: [{ startDate: 'desc' }],
    include: { competition: true },
  })
  return seasons.map(ensureSeasonSummary)
}

type MatchOutcome = {
  homeTeamId: number
  awayTeamId: number
  homeScore: number
  awayScore: number
  hasPenaltyShootout: boolean
  penaltyHomeScore: number | null
  penaltyAwayScore: number | null
}

const determineMatchWinnerClubId = (match: MatchOutcome): number | null => {
  if (match.homeScore > match.awayScore) {
    return match.homeTeamId
  }
  if (match.homeScore < match.awayScore) {
    return match.awayTeamId
  }
  if (!match.hasPenaltyShootout) {
    return null
  }
  if ((match.penaltyHomeScore ?? 0) > (match.penaltyAwayScore ?? 0)) {
    return match.homeTeamId
  }
  if ((match.penaltyHomeScore ?? 0) < (match.penaltyAwayScore ?? 0)) {
    return match.awayTeamId
  }
  return null
}

type ComputedClubStats = {
  points: number
  wins: number
  losses: number
  draws: number
  goalsFor: number
  goalsAgainst: number
}

type HeadToHeadEntry = {
  points: number
  goalsFor: number
  goalsAgainst: number
}

export const buildLeagueTable = async (
  season: SeasonWithCompetition
): Promise<LeagueTableResponse> => {
  const [stats, participants, finishedMatches] = await Promise.all([
    prisma.clubSeasonStats.findMany({
      where: { seasonId: season.id },
      include: { club: true },
    }),
    prisma.seasonParticipant.findMany({
      where: { seasonId: season.id },
      include: { club: true },
    }),
    prisma.match.findMany({
      where: {
        seasonId: season.id,
        status: MatchStatus.FINISHED,
        OR: [{ roundId: null }, { round: { roundType: RoundType.REGULAR } }],
      },
      select: {
        homeTeamId: true,
        awayTeamId: true,
        homeScore: true,
        awayScore: true,
        hasPenaltyShootout: true,
        penaltyHomeScore: true,
        penaltyAwayScore: true,
      },
    }),
  ])

  const statsByClubId = new Map<number, typeof stats[number]>()
  for (const entry of stats) {
    statsByClubId.set(entry.clubId, entry)
  }

  const computedByClubId = new Map<number, ComputedClubStats>()
  const ensureComputed = (clubId: number): ComputedClubStats => {
    let entry = computedByClubId.get(clubId)
    if (!entry) {
      entry = { points: 0, wins: 0, losses: 0, draws: 0, goalsFor: 0, goalsAgainst: 0 }
      computedByClubId.set(clubId, entry)
    }
    return entry
  }

  const headToHead = new Map<number, Map<number, HeadToHeadEntry>>()
  const ensureHeadToHead = (clubId: number, opponentId: number): HeadToHeadEntry => {
    let opponents = headToHead.get(clubId)
    if (!opponents) {
      opponents = new Map<number, HeadToHeadEntry>()
      headToHead.set(clubId, opponents)
    }
    let entry = opponents.get(opponentId)
    if (!entry) {
      entry = { points: 0, goalsFor: 0, goalsAgainst: 0 }
      opponents.set(opponentId, entry)
    }
    return entry
  }

  for (const match of finishedMatches) {
    const home = ensureComputed(match.homeTeamId)
    const away = ensureComputed(match.awayTeamId)

    home.goalsFor += match.homeScore
    home.goalsAgainst += match.awayScore
    away.goalsFor += match.awayScore
    away.goalsAgainst += match.homeScore

    const winnerClubId = determineMatchWinnerClubId(match)
    if (winnerClubId === match.homeTeamId) {
      home.points += 3
      home.wins += 1
      away.losses += 1
    } else if (winnerClubId === match.awayTeamId) {
      away.points += 3
      away.wins += 1
      home.losses += 1
    } else {
      home.points += 1
      away.points += 1
      home.draws += 1
      away.draws += 1
    }

    const directHome = ensureHeadToHead(match.homeTeamId, match.awayTeamId)
    const directAway = ensureHeadToHead(match.awayTeamId, match.homeTeamId)

    directHome.goalsFor += match.homeScore
    directHome.goalsAgainst += match.awayScore
    directAway.goalsFor += match.awayScore
    directAway.goalsAgainst += match.homeScore

    if (winnerClubId === match.homeTeamId) {
      directHome.points += 3
    } else if (winnerClubId === match.awayTeamId) {
      directAway.points += 3
    } else {
      directHome.points += 1
      directAway.points += 1
    }
  }

  const getHeadToHead = (clubId: number, opponentId: number): HeadToHeadEntry => {
    return headToHead.get(clubId)?.get(opponentId) ?? { points: 0, goalsFor: 0, goalsAgainst: 0 }
  }

  const standings: LeagueTableEntry[] = []

  const upsertRow = (clubId: number, club: typeof participants[number]['club']) => {
    const stat = statsByClubId.get(clubId)
    const computed = computedByClubId.get(clubId)
    const statHasData =
      !!stat &&
      (stat.points !== 0 ||
        stat.wins !== 0 ||
        stat.losses !== 0 ||
        stat.goalsFor !== 0 ||
        stat.goalsAgainst !== 0)
    const computedHasData =
      !!computed &&
      (computed.points !== 0 ||
        computed.wins !== 0 ||
        computed.losses !== 0 ||
        computed.draws !== 0 ||
        computed.goalsFor !== 0 ||
        computed.goalsAgainst !== 0)

    const useComputed = computedHasData && (!statHasData || (stat && (
      computed.points !== stat.points ||
      computed.wins !== stat.wins ||
      computed.losses !== stat.losses ||
      computed.goalsFor !== stat.goalsFor ||
      computed.goalsAgainst !== stat.goalsAgainst
    )))

    const points = useComputed ? computed!.points : stat?.points ?? 0
    const wins = useComputed ? computed!.wins : stat?.wins ?? 0
    const losses = useComputed ? computed!.losses : stat?.losses ?? 0
    const goalsFor = useComputed ? computed!.goalsFor : stat?.goalsFor ?? 0
    const goalsAgainst = useComputed ? computed!.goalsAgainst : stat?.goalsAgainst ?? 0
    const draws = useComputed
      ? computed!.draws
      : Math.max(points - wins * 3, 0)
    const matchesPlayed = wins + losses + draws
    const goalDifference = goalsFor - goalsAgainst

    standings.push({
      position: 0,
      clubId,
      clubName: club.name,
      clubShortName: club.shortName || club.name,
      clubLogoUrl: club.logoUrl ?? null,
      matchesPlayed,
      wins,
      draws,
      losses,
      goalsFor,
      goalsAgainst,
      goalDifference,
      points,
    })
  }

  for (const participant of participants) {
    upsertRow(participant.clubId, participant.club)
  }

  for (const stat of stats) {
    if (!standings.some(row => row.clubId === stat.clubId)) {
      upsertRow(stat.clubId, stat.club)
    }
  }

  standings.sort((left, right) => {
    if (right.points !== left.points) return right.points - left.points

    const leftDiff = left.goalDifference
    const rightDiff = right.goalDifference
    if (rightDiff !== leftDiff) return rightDiff - leftDiff

    const leftVsRight = getHeadToHead(left.clubId, right.clubId)
    const rightVsLeft = getHeadToHead(right.clubId, left.clubId)

    if (rightVsLeft.points !== leftVsRight.points) {
      return rightVsLeft.points - leftVsRight.points
    }

    const leftHeadDiff = leftVsRight.goalsFor - leftVsRight.goalsAgainst
    const rightHeadDiff = rightVsLeft.goalsFor - rightVsLeft.goalsAgainst
    if (rightHeadDiff !== leftHeadDiff) {
      return rightHeadDiff - leftHeadDiff
    }

    if (rightVsLeft.goalsFor !== leftVsRight.goalsFor) {
      return rightVsLeft.goalsFor - leftVsRight.goalsFor
    }

    return left.clubName.localeCompare(right.clubName, 'ru')
  })

  standings.forEach((row, index) => {
    row.position = index + 1
  })

  return {
    season: ensureSeasonSummary(season),
    standings,
  }
}
