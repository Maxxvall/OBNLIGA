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
  generatedAt: string
}
