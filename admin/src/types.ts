import type {
  RatingLeaderboardEntryView,
  RatingLeaderboardResponse,
  RatingSeasonView,
  RatingSeasonWinnerView,
  RatingSeasonsCollection,
} from '@shared/types'

export interface Club {
  id: number
  name: string
  shortName: string
  logoUrl?: string | null
}

export interface ClubPlayerLink {
  clubId: number
  personId: number
  defaultShirtNumber?: number | null
  person: Person
}

export interface Person {
  id: number
  firstName: string
  lastName: string
  isPlayer: boolean
  shirtNumber?: number | null
  currentClubId?: number | null
  currentClub?: Club | null
  clubs?: Club[]
}

export type LeaguePlayerStatus = 'NONE' | 'PENDING' | 'VERIFIED'

export interface Stadium {
  id: number
  name: string
  city: string
}

export interface Competition {
  id: number
  name: string
  type: 'LEAGUE' | 'CUP'
  seriesFormat: SeriesFormat
}

export type SeriesFormat =
  | 'SINGLE_MATCH'
  | 'TWO_LEGGED'
  | 'BEST_OF_N'
  | 'DOUBLE_ROUND_PLAYOFF'
  | 'PLAYOFF_BRACKET'
  | 'GROUP_SINGLE_ROUND_PLAYOFF'

export interface SeasonParticipant {
  seasonId: number
  clubId: number
  club: Club
}

export interface SeasonRosterEntry {
  seasonId: number
  clubId: number
  personId: number
  shirtNumber: number
  registrationDate: string
  person: Person
  club: Club
}

export interface Season {
  id: number
  competitionId: number
  name: string
  startDate: string
  endDate: string
  city?: string | null
  seriesFormat?: SeriesFormat | null
  isActive: boolean
  competition: Competition
  participants: SeasonParticipant[]
  rosters?: SeasonRosterEntry[]
  groups?: SeasonGroup[]
}

export interface SeasonAutomationResult {
  seasonId: number
  participantsCreated: number
  matchesCreated: number
  rosterEntriesCreated: number
  seriesCreated: number
  groupsCreated: number
  groupSlotsCreated: number
}

export interface SeasonGroup {
  id: number
  seasonId: number
  groupIndex: number
  label: string
  qualifyCount: number
  slots: SeasonGroupSlot[]
}

export interface SeasonGroupSlot {
  id: number
  groupId: number
  position: number
  clubId?: number | null
  club?: Club | null
}

export interface PlayoffByeSeriesEntry {
  clubId: number
  seed: number
  targetSlot: number
}

export interface PlayoffCreationResult {
  seriesCreated: number
  matchesCreated: number
  byeSeries?: PlayoffByeSeriesEntry[]
}

export interface MatchSeries {
  id: string
  seasonId: number
  stageName: string
  homeClubId: number
  awayClubId: number
  seriesStatus: 'IN_PROGRESS' | 'FINISHED'
  winnerClubId?: number | null
  homeSeed?: number | null
  awaySeed?: number | null
  bracketSlot?: number | null
}

export interface MatchSummary {
  id: string
  seasonId: number
  matchDateTime: string
  homeTeamId: number
  awayTeamId: number
  homeScore: number
  awayScore: number
  hasPenaltyShootout: boolean
  penaltyHomeScore: number
  penaltyAwayScore: number
  status: 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'POSTPONED'
  stadiumId?: number | null
  stadium?: Stadium | null
  refereeId?: number | null
  isArchived: boolean
  season?: { name: string }
  seriesId?: string | null
  seriesMatchNumber?: number | null
  series?: MatchSeries | null
  round?: {
    id: number
    roundType: 'REGULAR' | 'PLAYOFF'
    roundNumber?: number | null
    label: string
  }
  broadcastUrl?: string | null
}

export interface JudgeMatchSummary {
  id: string
  seasonId: number
  matchDateTime: string
  status: 'LIVE' | 'FINISHED'
  homeScore: number
  awayScore: number
  hasPenaltyShootout: boolean
  penaltyHomeScore: number
  penaltyAwayScore: number
  season?: { id: number; name: string; city?: string | null } | null
  round?: {
    id: number
    roundType: 'REGULAR' | 'PLAYOFF'
    roundNumber?: number | null
    label: string
  } | null
  homeClub: Club
  awayClub: Club
  stadium?: { id: number; name: string; city: string } | null
  locationCity?: string | null
}

export interface AssistantMatchSummary {
  id: string
  seasonId: number
  matchDateTime: string
  status: 'SCHEDULED' | 'LIVE' | 'FINISHED'
  homeScore: number
  awayScore: number
  hasPenaltyShootout: boolean
  penaltyHomeScore: number
  penaltyAwayScore: number
  season?: { id: number; name: string; city?: string | null } | null
  round?: {
    id: number
    roundType: 'REGULAR' | 'PLAYOFF'
    roundNumber?: number | null
    label: string
  } | null
  homeClub: Club
  awayClub: Club
  stadium?: { id: number; name: string; city: string } | null
  locationCity?: string | null
}

export interface FriendlyMatch {
  id: string
  matchDateTime: string
  status: MatchSummary['status']
  seasonId?: number | null
  season?: { id: number; name: string } | null
  homeTeamId: number
  awayTeamId: number
  homeClubId?: number
  awayClubId?: number
  homeScore: number
  awayScore: number
  hasPenaltyShootout: boolean
  penaltyHomeScore: number
  penaltyAwayScore: number
  homeClub: Club
  awayClub: Club
  eventName?: string | null
  stadiumId?: number | null
  refereeId?: number | null
  stadium?: Stadium | null
  referee?: Person | null
  broadcastUrl?: string | null
  isFriendly: true
}

export interface MatchLineupEntry {
  matchId: string
  personId: number
  clubId: number
  role: 'STARTER' | 'SUBSTITUTE'
  position?: string | null
  shirtNumber?: number | null
  person: Person
  club: Club
}

export interface MatchEventEntry {
  id: string
  matchId: string
  teamId: number
  minute: number
  eventType:
    | 'GOAL'
    | 'PENALTY_GOAL'
    | 'OWN_GOAL'
    | 'PENALTY_MISSED'
    | 'YELLOW_CARD'
    | 'SECOND_YELLOW_CARD'
    | 'RED_CARD'
    | 'SUB_IN'
    | 'SUB_OUT'
  playerId: number
  relatedPlayerId?: number | null
  player: Person
  relatedPerson?: Person | null
  team: Club
}

export type MatchStatisticMetric =
  | 'totalShots'
  | 'shotsOnTarget'
  | 'corners'
  | 'yellowCards'
  | 'redCards'

export interface MatchStatisticEntry {
  matchId: string
  clubId: number
  totalShots: number
  shotsOnTarget: number
  corners: number
  yellowCards: number
  redCards: number
  createdAt: string
  updatedAt: string
  club: Club
}

export interface ClubSeasonStats {
  seasonId: number
  clubId: number
  points: number
  wins: number
  losses: number
  goalsFor: number
  goalsAgainst: number
  club: Club
  season?: Season
  groupIndex?: number | null
  groupLabel?: string | null
}

export interface ClubCareerTotals {
  clubId: number
  club: Club
  tournaments: number
  matchesPlayed: number
  goalsFor: number
  goalsAgainst: number
  yellowCards: number
  redCards: number
  cleanSheets: number
}

export interface PlayerSeasonStats {
  seasonId: number
  personId: number
  clubId: number
  goals: number
  penaltyGoals: number
  assists: number
  yellowCards: number
  redCards: number
  matchesPlayed: number
  person: Person
  club: Club
}

export interface PlayerCareerStats {
  personId: number
  clubId: number
  totalGoals: number
  penaltyGoals: number
  totalMatches: number
  totalAssists: number
  yellowCards: number
  redCards: number
  person: Person
  club: Club
}

export interface AppUser {
  id: number
  telegramId: string
  username?: string | null
  firstName?: string | null
  registrationDate: string
  lastLoginDate?: string | null
  currentStreak: number
  totalPredictions: number
  leaguePlayerStatus: LeaguePlayerStatus
  leaguePlayerRequestedAt?: string | null
  leaguePlayerVerifiedAt?: string | null
  leaguePlayerId?: number | null
  leaguePlayer?: Person | null
}

export interface Prediction {
  id: string
  userId: number
  matchId: string
  predictionDate: string
  result1x2?: 'ONE' | 'DRAW' | 'TWO' | null
  totalGoalsOver?: number | null
  penaltyYes?: boolean | null
  redCardYes?: boolean | null
  isCorrect?: boolean | null
  pointsAwarded: number
  user?: AppUser
}

export interface TotalGoalsSuggestionSampleView {
  matchId: string
  matchDateTime: string
  homeTeamId: number
  awayTeamId: number
  totalGoals: number
  weight: number
  isFriendly: boolean
}

export interface TotalGoalsLineAlternativeView {
  line: number
  formattedLine: string
  delta: number
}

export interface TotalGoalsSuggestionView {
  line: number
  fallback: boolean
  sampleSize: number
  averageGoals: number
  standardDeviation: number
  confidence: number
  generatedAt: string
  alternatives: TotalGoalsLineAlternativeView[]
  samples: TotalGoalsSuggestionSampleView[]
}

export interface AdminPredictionTemplate {
  id: string
  matchId: string
  marketType: 'MATCH_OUTCOME' | 'TOTAL_GOALS' | 'CUSTOM_BOOLEAN'
  options: unknown
  basePoints: number
  difficultyMultiplier: number
  isManual: boolean
  createdBy?: string | null
  createdAt: string
  updatedAt: string
}

export interface AdminPredictionMatch {
  matchId: string
  matchDateTime: string
  status: MatchSummary['status']
  homeClub: Club
  awayClub: Club
  templates: AdminPredictionTemplate[]
  suggestion?: TotalGoalsSuggestionView | null
}

export interface PredictionTemplateOverrideResponse {
  mode: 'auto' | 'manual'
  template: AdminPredictionTemplate | null
  suggestion: TotalGoalsSuggestionView | null
  summary?: PredictionTemplateEnsureSummaryView
}

export interface PredictionTemplateEnsureSummaryView {
  matchId: string
  createdMarkets: Array<'MATCH_OUTCOME' | 'TOTAL_GOALS' | 'CUSTOM_BOOLEAN'>
  updatedMarkets: Array<'MATCH_OUTCOME' | 'TOTAL_GOALS' | 'CUSTOM_BOOLEAN'>
  skippedManualMarkets: Array<'MATCH_OUTCOME' | 'TOTAL_GOALS' | 'CUSTOM_BOOLEAN'>
  changed: boolean
  totalSuggestion?: TotalGoalsSuggestionView
}

export interface AchievementType {
  id: number
  name: string
  description?: string | null
  requiredValue: number
  metric: 'DAILY_LOGIN' | 'TOTAL_PREDICTIONS' | 'CORRECT_PREDICTIONS'
}

export interface UserAchievement {
  userId: number
  achievementTypeId: number
  achievedDate: string
  user: AppUser
  achievementType: AchievementType
}

export interface Disqualification {
  id: string
  personId: number
  clubId?: number | null
  reason: 'RED_CARD' | 'SECOND_YELLOW' | 'ACCUMULATED_CARDS' | 'OTHER'
  sanctionDate: string
  banDurationMatches: number
  matchesMissed: number
  isActive: boolean
  person: Person
  club?: Club | null
  matchesRemaining: number
}

export interface LineupPortalMatch {
  id: string
  matchDateTime: string
  status: 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'POSTPONED'
  season: { id: number; name: string }
  round?: { id: number; label: string | null }
  homeClub: { id: number; name: string; shortName: string; logoUrl?: string | null }
  awayClub: { id: number; name: string; shortName: string; logoUrl?: string | null }
}

export interface LineupPortalRosterEntry {
  personId: number
  person: { id: number; firstName: string; lastName: string }
  shirtNumber: number
  selected: boolean
  disqualification: null | {
    reason: 'RED_CARD' | 'ACCUMULATED_CARDS' | 'OTHER'
    sanctionDate: string
    banDurationMatches: number
    matchesMissed: number
    matchesRemaining: number
  }
}

export interface AdminRatingSettingsSummary {
  settings: {
    currentScopeDays: number
    yearlyScopeDays: number
    updatedAt: string
    defaults: {
      currentScopeDays: number
      yearlyScopeDays: number
    }
  }
  windows: {
    anchor: string
    currentWindowStart: string
    yearlyWindowStart: string
  }
  totals: {
    ratedUsers: number
    mythicPlayers: number
  }
  lastRecalculatedAt: string
}

export interface AdminRatingSettingsInput {
  currentScopeDays: number
  yearlyScopeDays: number
  recalculate?: boolean
}

export type AdminRatingLeaderboardResponse = RatingLeaderboardResponse
export type AdminRatingLeaderboardEntry = RatingLeaderboardEntryView
export type AdminRatingSeasonView = RatingSeasonView
export type AdminRatingSeasonWinner = RatingSeasonWinnerView
export type AdminRatingSeasonsCollection = RatingSeasonsCollection
