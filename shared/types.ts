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
