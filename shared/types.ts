// Общие типы между backend и frontend (черновые)
export interface Match {
  id: string
  home: string
  away: string
  startsAt?: string
  score?: string
}

export interface User {
  id: string
  displayName?: string
  balance?: number
}

// Prisma/DB-backed user (Telegram)
export interface DbUser {
  id: number
  telegramId: string // хранится как строка, чтобы избежать потери точности
  username?: string | null
  firstName?: string | null
  photoUrl?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface NewsItem {
  id: string
  title: string
  content: string
  coverUrl?: string | null
  sendToTelegram?: boolean
  createdAt: string
}

export interface LeagueSeasonSummary {
  id: number
  name: string
  startDate: string
  endDate: string
  isActive: boolean
  city?: string | null
  competition: {
    id: number
    name: string
    type: 'LEAGUE' | 'CUP'
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

export interface LeagueMatchLocation {
  stadiumId: number | null
  stadiumName: string | null
  city: string | null
}

export interface LeagueMatchView {
  id: string
  matchDateTime: string
  status: 'SCHEDULED' | 'LIVE' | 'POSTPONED' | 'FINISHED'
  homeClub: {
    id: number
    name: string
    shortName: string
    logoUrl: string | null
  }
  awayClub: {
    id: number
    name: string
    shortName: string
    logoUrl: string | null
  }
  homeScore: number
  awayScore: number
  hasPenaltyShootout: boolean
  penaltyHomeScore: number | null
  penaltyAwayScore: number | null
  location: LeagueMatchLocation | null
  series?: {
    id: string
    stageName: string
    status: 'IN_PROGRESS' | 'FINISHED'
    matchNumber: number
    totalMatches: number
    requiredWins: number
    homeWinsBefore: number
    awayWinsBefore: number
    homeWinsAfter: number
    awayWinsAfter: number
    homeClub: {
      id: number
      name: string
      shortName: string
      logoUrl: string | null
    }
    awayClub: {
      id: number
      name: string
      shortName: string
      logoUrl: string | null
    }
    homeWinsTotal: number
    awayWinsTotal: number
    winnerClubId: number | null
    homeClubId: number
    awayClubId: number
  }
}

export interface LeagueRoundMatches {
  roundId: number | null
  roundNumber: number | null
  roundLabel: string
  roundType: 'REGULAR' | 'PLAYOFF' | null
  matches: LeagueMatchView[]
}

export interface LeagueRoundCollection {
  season: LeagueSeasonSummary
  rounds: LeagueRoundMatches[]
  generatedAt: string
}

export type LeagueStatsCategory = 'goalContribution' | 'scorers' | 'assists'

export interface LeaguePlayerLeaderboardEntry {
  personId: number
  firstName: string
  lastName: string
  clubId: number
  clubName: string
  clubShortName: string
  clubLogoUrl: string | null
  matchesPlayed: number
  goals: number
  assists: number
  penaltyGoals: number
}

export interface LeagueStatsLeaderboards {
  goalContribution: LeaguePlayerLeaderboardEntry[]
  scorers: LeaguePlayerLeaderboardEntry[]
  assists: LeaguePlayerLeaderboardEntry[]
}

export interface LeagueStatsResponse {
  season: LeagueSeasonSummary
  generatedAt: string
  leaderboards: LeagueStatsLeaderboards
}

export type ClubMatchResult = 'WIN' | 'DRAW' | 'LOSS'

export interface ClubSummaryFormEntry {
  matchId: string
  matchDateTime: string
  isHome: boolean
  result: ClubMatchResult
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
}

export interface ClubSummaryStatistics {
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

export interface ClubSummaryAchievement {
  id: string
  title: string
  subtitle?: string | null
}

export interface ClubSquadPlayer {
  playerId: number
  playerName: string
  matches: number
  yellowCards: number
  redCards: number
  assists: number
  goals: number
}

export interface ClubSummaryResponse {
  club: {
    id: number
    name: string
    shortName: string
    logoUrl: string | null
  }
  statistics: ClubSummaryStatistics
  form: ClubSummaryFormEntry[]
  achievements: ClubSummaryAchievement[]
  squad?: ClubSquadPlayer[]
  generatedAt: string
}

export type MatchDetailsStatus = 'SCHEDULED' | 'LIVE' | 'POSTPONED' | 'FINISHED'

export interface MatchDetailsHeader {
  status: MatchDetailsStatus
  matchDateTime: string
  updatedAt: string
  currentMinute: number | null
  venue?: {
    city?: string | null
    stadium?: string | null
  }
  homeTeam: {
    name: string
    shortName: string
    logo: string | null
    score: number
    penaltyScore: number | null
  }
  awayTeam: {
    name: string
    shortName: string
    logo: string | null
    score: number
    penaltyScore: number | null
  }
}

export interface MatchDetailsLineupPlayer {
  firstName: string
  lastName: string
  shirtNumber: number | null
}

export interface MatchDetailsLineupTeam {
  version: string
  players: MatchDetailsLineupPlayer[]
}

export interface MatchDetailsLineups {
  homeTeam: MatchDetailsLineupTeam
  awayTeam: MatchDetailsLineupTeam
}

export type MatchDetailsEventType =
  | 'GOAL'
  | 'PENALTY_GOAL'
  | 'OWN_GOAL'
  | 'PENALTY_MISSED'
  | 'YELLOW_CARD'
  | 'SECOND_YELLOW_CARD'
  | 'RED_CARD'
  | 'SUB_IN'
  | 'SUB_OUT'

export type MatchDetailsEventTeam = 'HOME' | 'AWAY'

export interface MatchDetailsEventPlayer {
  firstName: string
  lastName: string
  shirtNumber: number | null
}

export interface MatchDetailsEventItem {
  id: string
  minute: number
  team: MatchDetailsEventTeam
  eventType: MatchDetailsEventType
  primary: MatchDetailsEventPlayer
  secondary?: MatchDetailsEventPlayer | null
}

export interface MatchDetailsEvents {
  version: string
  events: MatchDetailsEventItem[]
}

export interface MatchDetailsStatsEntry {
  shots: number
  shotsOnTarget: number
  corners: number
  yellowCards: number
}

export interface MatchDetailsStatsTeam {
  version: string
  stats: MatchDetailsStatsEntry
}

export interface MatchDetailsStats {
  homeTeam: MatchDetailsStatsTeam
  awayTeam: MatchDetailsStatsTeam
}

export interface MatchDetailsBroadcast {
  status: 'not_available'
}
