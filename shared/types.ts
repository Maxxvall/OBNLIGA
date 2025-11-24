// Общие типы между backend и frontend (черновые)
export const FRIENDLY_SEASON_ID = -1
export const FRIENDLY_COMPETITION_ID = -101
export const FRIENDLY_SEASON_NAME = 'Товарищеские матчи'

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

export type PredictionMarketType = 'MATCH_OUTCOME' | 'TOTAL_GOALS' | 'CUSTOM_BOOLEAN'

export type PredictionEntryStatus =
  | 'PENDING'
  | 'WON'
  | 'LOST'
  | 'VOID'
  | 'CANCELLED'
  | 'EXPIRED'

export type RatingScopeKey = 'current' | 'yearly'

export type RatingLevel =
  | 'BRONZE'
  | 'SILVER'
  | 'GOLD'
  | 'PLATINUM'
  | 'DIAMOND'
  | 'MYTHIC'

export interface RatingLeaderboardEntryView {
  userId: number
  position: number
  displayName: string
  username: string | null
  photoUrl: string | null
  totalPoints: number
  seasonalPoints: number
  yearlyPoints: number
  currentLevel: RatingLevel
  mythicRank: number | null
  currentStreak: number
  maxStreak: number
  lastPredictionAt: string | null
  lastResolvedAt: string | null
  predictionCount: number
  predictionWins: number
  predictionAccuracy: number
}

export interface RatingLeaderboardResponse {
  scope: RatingScopeKey
  total: number
  page: number
  pageSize: number
  capturedAt: string
  currentWindowStart: string
  currentWindowEnd: string
  yearlyWindowStart: string
  yearlyWindowEnd: string
  entries: RatingLeaderboardEntryView[]
}

export interface RatingSeasonWinnerView {
  userId: number
  rank: number
  scopePoints: number
  totalPoints: number
  predictionCount: number
  predictionWins: number
  displayName: string | null
  username: string | null
  photoUrl: string | null
  createdAt: string | null
}

export interface RatingSeasonView {
  id: string | null
  scope: RatingScopeKey
  startsAt: string | null
  endsAt: string | null
  closedAt: string | null
  durationDays: number
  isActive: boolean
  winners: RatingSeasonWinnerView[]
}

export type RatingSeasonsCollection = Record<
  RatingScopeKey,
  {
    active: RatingSeasonView | null
    history: RatingSeasonView[]
  }
>

export interface UserRatingSummary {
  totalPoints: number
  seasonalPoints: number
  yearlyPoints: number
  currentLevel: RatingLevel
  mythicRank: number | null
  currentStreak: number
  maxStreak: number
  lastPredictionAt: string | null
  lastResolvedAt: string | null
  lastRecalculatedAt: string | null
  predictionCount: number
  predictionWins: number
  predictionAccuracy: number
}

export interface PredictionChoiceOption {
  value: string
  label: string
  description?: string | null
  points?: number | null
  probability?: number | null
}

export interface PredictionTemplateView {
  id: string
  marketType: PredictionMarketType
  options: unknown
  basePoints: number
  difficultyMultiplier: number | null
  isManual: boolean
  createdAt: string
  updatedAt: string
}

export interface ActivePredictionMatch {
  matchId: string
  matchDateTime: string
  status: MatchStatus
  competitionName: string | null
  seasonName: string | null
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
  templates: PredictionTemplateView[]
}

export type UserPredictionMarketType =
  | PredictionMarketType
  | 'LEGACY_1X2'
  | 'LEGACY_TOTAL'
  | 'LEGACY_EVENT'

export interface UserPredictionEntry {
  id: string
  templateId?: string
  matchId: string
  selection: string
  submittedAt: string
  status: PredictionEntryStatus
  scoreAwarded?: number | null
  resolvedAt?: string | null
  marketType: UserPredictionMarketType
  matchDateTime: string
  competitionName: string | null
  seasonName: string | null
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

export interface AdBannerImage {
  mimeType: string
  base64: string
  width: number
  height: number
  size: number
}

export interface AdBanner {
  id: string
  title: string
  subtitle?: string | null
  targetUrl?: string | null
  image: AdBannerImage
  displayOrder: number
  isActive: boolean
  startsAt?: string | null
  endsAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface PublicAdBanner {
  id: string
  title: string
  subtitle?: string | null
  targetUrl?: string | null
  image: AdBannerImage
  displayOrder: number
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
  groupIndex?: number | null
  groupLabel?: string | null
}

export interface LeagueTableResponse {
  season: LeagueSeasonSummary
  standings: LeagueTableEntry[]
  groups?: LeagueTableGroup[]
}

export interface LeagueTableGroup {
  groupIndex: number
  label: string
  qualifyCount: number
  clubIds: number[]
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
  matchesCount?: number
  roundKey?: string
  firstMatchAt?: string
  lastMatchAt?: string
}

export interface LeagueRoundCollection {
  season: LeagueSeasonSummary
  rounds: LeagueRoundMatches[]
  generatedAt: string
}

export interface ClubMatchCompactTeam {
  i: number
  n: string
  l: string | null
}

export interface ClubMatchCompactScore {
  h: number | null
  a: number | null
}

export interface ClubMatchCompact {
  i: string
  d: string
  st: MatchStatus
  h: ClubMatchCompactTeam
  a: ClubMatchCompactTeam
  sc: ClubMatchCompactScore
}

export interface ClubMatchesSeasonCompact {
  i: number
  n: string
  m: ClubMatchCompact[]
}

export interface ClubMatchesResponse {
  c: number
  s: ClubMatchesSeasonCompact[]
  g: string
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

// ============================================================
// Public Match Details API Types (optimized, minimal payload)
// ============================================================

export type MatchStatus = 'SCHEDULED' | 'LIVE' | 'POSTPONED' | 'FINISHED'

export interface MatchDetailsHeader {
  st: MatchStatus // status
  dt: string // matchDateTime (ISO)
  min?: number // currentMinute (only for LIVE)
  loc?: {
    city?: string
    stadium?: string
  }
  rd?: {
    label?: string | null
    type?: 'REGULAR' | 'PLAYOFF' | null
  }
  ps?: boolean // has penalty shootout
  ph?: number | null // penalty home score
  pa?: number | null // penalty away score
  ht: {
    // homeTeam
    n: string // name
    sn?: string // shortName
    lg?: string // logo URL
    sc: number // score
  }
  at: {
    // awayTeam
    n: string
    sn?: string
    lg?: string
    sc: number
  }
}

export interface MatchDetailsLineupPlayer {
  fn: string // firstName
  ln: string // lastName
  sn: number // shirtNumber
}

export interface MatchDetailsLineups {
  ht: {
    // homeTeam
    v: number // version
    pl: MatchDetailsLineupPlayer[] // players
  }
  at: {
    // awayTeam
    v: number
    pl: MatchDetailsLineupPlayer[]
  }
}

export interface MatchDetailsTeamStats {
  sh?: number // shots
  sot?: number // shotsOnTarget
  cor?: number // corners
  yc?: number // yellowCards
  rc?: number // redCards
  fk?: number // freeKicks
  of?: number // offsides
}

export interface MatchDetailsStats {
  ht: {
    // homeTeam
    v: number // version
    st: MatchDetailsTeamStats // stats
  }
  at: {
    // awayTeam
    v: number
    st: MatchDetailsTeamStats
  }
}

export type MatchEventType =
  | 'GOAL'
  | 'PENALTY_GOAL'
  | 'OWN_GOAL'
  | 'YELLOW_CARD'
  | 'RED_CARD'
  | 'SUBSTITUTION'

export interface MatchDetailsEvent {
  id: string
  min: number // minute
  tp: MatchEventType // type
  tm: 'home' | 'away' // team
  pl?: string // player name (optional for some events)
  pl2?: string // second player (for substitution: player in)
}

export interface MatchDetailsEvents {
  v: number // version (for entire event list)
  ev: MatchDetailsEvent[] // events
}

export interface MatchDetailsBroadcast {
  st: 'not_available' | 'available' // status
  url?: string // broadcast URL if available
}

export interface MatchComment {
  id: string
  userId: string
  authorName: string
  authorPhotoUrl?: string | null
  text: string
  createdAt: string
}

// ============================================================
// User Achievements API Types
// ============================================================

export interface UserAchievementLevel {
  id: number
  level: number
  threshold: number
  iconUrl: string | null
  title: string
  description: string | null
}

export interface UserAchievementProgress {
  achievementId: number
  achievementName: string
  achievementDescription: string | null
  currentLevel: number
  progressCount: number
  lastUnlockedAt: string | null
  levels: UserAchievementLevel[]
}

export interface UserAchievementsSummary {
  achievements: UserAchievementProgress[]
  totalUnlocked: number
  generatedAt: string
}

// ============================================================
// Daily reward system shared types
// ============================================================

export type DailyRewardDayStatus = 'claimed' | 'claimable' | 'locked' | 'cooldown'

export interface DailyRewardDayView {
  day: number
  points: number
  animationKey: string
  gradient?: readonly [string, string]
  status: DailyRewardDayStatus
}

export interface DailyRewardSummary {
  streak: number
  effectiveStreak: number
  cycleProgress: number
  cycleLength: number
  claimedToday: boolean
  claimAvailable: boolean
  claimableDay: number | null
  nextDay: number
  pendingPoints: number
  totalClaims: number
  totalPointsEarned: number
  lastClaimedAt: string | null
  lastClaimDateKey: string | null
  todayKey: string
  nextResetKey: string
  cooldownEndsAt: string
  cooldownSeconds: number
  timezone: string
  missed: boolean
  message?: string | null
  serverTime: string
  lastReward?: {
    day: number
    points: number
    animationKey: string
    claimedAt: string
  } | null
  days: DailyRewardDayView[]
}

export interface DailyRewardClaimResponse {
  summary: DailyRewardSummary
  awarded: {
    day: number
    points: number
    animationKey: string
  }
}

// ============================================================
// Shop module shared types
// ============================================================

export interface ShopItemImageView {
  mimeType: string | null
  width: number | null
  height: number | null
  size: number | null
  url?: string | null
  base64?: string | null
  fingerprint: string
  updatedAt: string
}

export interface ShopItemView {
  id: number
  slug?: string | null
  title: string
  subtitle?: string | null
  description?: string | null
  priceCents: number
  currencyCode: string
  stockQuantity?: number | null
  maxPerOrder: number
  sortOrder: number
  isActive: boolean
  image?: ShopItemImageView | null
  createdAt: string
  updatedAt: string
}

export type ShopOrderStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED'

export interface ShopOrderItemView {
  itemId: number
  title: string
  subtitle?: string | null
  priceCents: number
  quantity: number
  imageUrl?: string | null
}

export interface ShopOrderUserView {
  userId?: number | null
  telegramId?: string | null
  username?: string | null
  firstName?: string | null
}

export interface ShopOrderView {
  id: string
  orderNumber: string
  status: ShopOrderStatus
  totalCents: number
  currencyCode: string
  customerNote?: string | null
  createdAt: string
  updatedAt: string
  confirmedAt?: string | null
  confirmedBy?: string | null
  items: ShopOrderItemView[]
  user?: ShopOrderUserView | null
}
