import { create } from 'zustand'
import type {
  LeagueRoundCollection,
  LeagueRoundMatches,
  LeagueMatchView,
  LeagueSeasonSummary,
  LeagueTableResponse,
  LeagueTableGroup,
  LeagueStatsResponse,
  LeagueStatsCategory,
  LeaguePlayerLeaderboardEntry,
  ClubSummaryResponse,
  MatchDetailsHeader,
  MatchDetailsLineups,
  MatchDetailsStats,
  MatchDetailsEvents,
  MatchStatus,
} from '@shared/types'
import { leagueApi } from '../api/leagueApi'
import { clubApi } from '../api/clubApi'
import { matchApi } from '../api/matchApi'
import { readFromStorage, writeToStorage } from '../utils/leaguePersistence'

export type UITab = 'home' | 'league' | 'predictions' | 'leaderboard' | 'shop' | 'profile'
export type LeagueSubTab = 'table' | 'schedule' | 'results' | 'stats'
export type TeamSubTab = 'overview' | 'matches' | 'squad'
export type TeamMatchesMode = 'schedule' | 'results'
export type MatchDetailsTab = 'lineups' | 'events' | 'stats' | 'broadcast'

type TeamViewState = {
  open: boolean
  clubId?: number
  activeTab: TeamSubTab
  matchesMode: TeamMatchesMode
}

type MatchDetailsState = {
  open: boolean
  matchId?: string
  seasonId?: number
  activeTab: MatchDetailsTab
  snapshot?: LeagueMatchView
  header?: MatchDetailsHeader
  lineups?: MatchDetailsLineups
  stats?: MatchDetailsStats
  events?: MatchDetailsEvents
  headerEtag?: string
  lineupsEtag?: string
  statsEtag?: string
  eventsEtag?: string
  loadingHeader: boolean
  loadingLineups: boolean
  loadingStats: boolean
  loadingEvents: boolean
  errorHeader?: string
  errorLineups?: string
  errorStats?: string
  errorEvents?: string
}

const INITIAL_TEAM_VIEW: TeamViewState = {
  open: false,
  clubId: undefined,
  activeTab: 'overview',
  matchesMode: 'schedule',
}

const INITIAL_MATCH_DETAILS: MatchDetailsState = {
  open: false,
  matchId: undefined,
  seasonId: undefined,
  activeTab: 'lineups',
  snapshot: undefined,
  loadingHeader: false,
  loadingLineups: false,
  loadingStats: false,
  loadingEvents: false,
}

const SEASONS_TTL_MS = 55_000
const TABLE_TTL_MS = 30_000
const SCHEDULE_TTL_MS = 12_000
const RESULTS_TTL_MS = 20_000
const STATS_TTL_MS = 300_000
const CLUB_SUMMARY_TTL_MS = 45_000
const DOUBLE_TAP_THRESHOLD_MS = 280

const LEAGUE_POLL_INTERVAL_MS = 10_000
const TEAM_POLL_INTERVAL_MS = 20_000
const MATCH_DETAILS_POLL_INTERVAL_MS = 10_000
const hasWindow = typeof window !== 'undefined'

const areCompetitionsEqual = (
  left: LeagueSeasonSummary['competition'],
  right: LeagueSeasonSummary['competition']
): boolean =>
  left.id === right.id && left.name === right.name && left.type === right.type

const areSeasonsEqual = (left: LeagueSeasonSummary, right: LeagueSeasonSummary): boolean =>
  left.id === right.id &&
  left.name === right.name &&
  left.startDate === right.startDate &&
  left.endDate === right.endDate &&
  left.isActive === right.isActive &&
  left.city === right.city &&
  areCompetitionsEqual(left.competition, right.competition)

const reuseSeason = (
  previous: LeagueSeasonSummary | undefined,
  incoming: LeagueSeasonSummary
): LeagueSeasonSummary => {
  if (!previous) {
    return incoming
  }
  return areSeasonsEqual(previous, incoming) ? previous : incoming
}

const areTableEntriesEqual = (left: LeagueTableResponse['standings'][number], right: LeagueTableResponse['standings'][number]): boolean =>
  left.position === right.position &&
  left.clubId === right.clubId &&
  left.clubName === right.clubName &&
  left.clubShortName === right.clubShortName &&
  left.clubLogoUrl === right.clubLogoUrl &&
  left.matchesPlayed === right.matchesPlayed &&
  left.wins === right.wins &&
  left.draws === right.draws &&
  left.losses === right.losses &&
  left.goalsFor === right.goalsFor &&
  left.goalsAgainst === right.goalsAgainst &&
  left.goalDifference === right.goalDifference &&
  left.points === right.points &&
  (left.groupIndex ?? null) === (right.groupIndex ?? null) &&
  (left.groupLabel ?? '') === (right.groupLabel ?? '')

const areNumberArraysEqual = (left: number[], right: number[]): boolean => {
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }
  return true
}

const mergeTableGroups = (
  previous: LeagueTableGroup[] | undefined,
  incoming: LeagueTableGroup[] | undefined
): LeagueTableGroup[] | undefined => {
  if (!incoming || incoming.length === 0) {
    return undefined
  }
  if (!previous || previous.length === 0) {
    return incoming
  }

  const previousByIndex = new Map<number, LeagueTableGroup>()
  previous.forEach(group => {
    previousByIndex.set(group.groupIndex, group)
  })

  let changed = previous.length !== incoming.length
  const merged = incoming.map(group => {
    const existing = previousByIndex.get(group.groupIndex)
    if (
      existing &&
      existing.label === group.label &&
      existing.qualifyCount === group.qualifyCount &&
      areNumberArraysEqual(existing.clubIds, group.clubIds)
    ) {
      return existing
    }
    changed = true
    return group
  })

  if (!changed) {
    for (let index = 0; index < merged.length; index += 1) {
      if (merged[index] !== previous[index]) {
        changed = true
        break
      }
    }
  }

  if (!changed) {
    return previous
  }

  return merged
}

const mergeLeagueTable = (
  previous: LeagueTableResponse | undefined,
  incoming: LeagueTableResponse
): LeagueTableResponse => {
  if (!previous || previous.season.id !== incoming.season.id) {
    return incoming
  }

  const season = reuseSeason(previous.season, incoming.season)

  const previousEntries = new Map<number, LeagueTableResponse['standings'][number]>()
  previous.standings.forEach(entry => {
    previousEntries.set(entry.clubId, entry)
  })

  const nextStandings = incoming.standings.map(entry => {
    const existing = previousEntries.get(entry.clubId)
    if (existing && areTableEntriesEqual(existing, entry)) {
      return existing
    }
    return entry
  })

  const nextGroups = mergeTableGroups(previous.groups, incoming.groups)

  const unchanged =
    season === previous.season &&
    nextStandings.length === previous.standings.length &&
    nextStandings.every((entry, index) => entry === previous.standings[index]) &&
    nextGroups === previous.groups

  if (unchanged) {
    return previous
  }

  return {
    season,
    standings: nextStandings,
    groups: nextGroups,
  }
}

const areClubsEqual = (
  left: LeagueMatchView['homeClub'],
  right: LeagueMatchView['homeClub']
): boolean =>
  left.id === right.id &&
  left.name === right.name &&
  left.shortName === right.shortName &&
  left.logoUrl === right.logoUrl

const areLocationsEqual = (
  left: LeagueMatchView['location'],
  right: LeagueMatchView['location']
): boolean => {
  if (!left && !right) {
    return true
  }
  if (!left || !right) {
    return false
  }
  return (
    left.stadiumId === right.stadiumId &&
    left.stadiumName === right.stadiumName &&
    left.city === right.city
  )
}

const areSeriesEqual = (
  left: NonNullable<LeagueMatchView['series']>,
  right: NonNullable<LeagueMatchView['series']>
): boolean =>
  left.id === right.id &&
  left.stageName === right.stageName &&
  left.status === right.status &&
  left.matchNumber === right.matchNumber &&
  left.totalMatches === right.totalMatches &&
  left.requiredWins === right.requiredWins &&
  left.homeWinsBefore === right.homeWinsBefore &&
  left.awayWinsBefore === right.awayWinsBefore &&
  left.homeWinsAfter === right.homeWinsAfter &&
  left.awayWinsAfter === right.awayWinsAfter &&
  left.homeWinsTotal === right.homeWinsTotal &&
  left.awayWinsTotal === right.awayWinsTotal &&
  left.winnerClubId === right.winnerClubId &&
  left.homeClubId === right.homeClubId &&
  left.awayClubId === right.awayClubId &&
  areClubsEqual(left.homeClub, right.homeClub) &&
  areClubsEqual(left.awayClub, right.awayClub)

const areMatchesEqual = (left: LeagueMatchView, right: LeagueMatchView): boolean =>
  left.id === right.id &&
  left.matchDateTime === right.matchDateTime &&
  left.status === right.status &&
  left.homeScore === right.homeScore &&
  left.awayScore === right.awayScore &&
  left.hasPenaltyShootout === right.hasPenaltyShootout &&
  left.penaltyHomeScore === right.penaltyHomeScore &&
  left.penaltyAwayScore === right.penaltyAwayScore &&
  areClubsEqual(left.homeClub, right.homeClub) &&
  areClubsEqual(left.awayClub, right.awayClub) &&
  areLocationsEqual(left.location, right.location) &&
  (left.series === right.series ||
    (left.series && right.series ? areSeriesEqual(left.series, right.series) : false))

const mergeRoundMatches = (
  previous: LeagueRoundMatches | undefined,
  incoming: LeagueRoundMatches
): LeagueRoundMatches => {
  if (!previous) {
    return incoming
  }

  const sameMeta =
    previous.roundId === incoming.roundId &&
    previous.roundNumber === incoming.roundNumber &&
    previous.roundLabel === incoming.roundLabel &&
    previous.roundType === incoming.roundType

  const previousMatches = new Map<string, LeagueMatchView>()
  previous.matches.forEach((match: LeagueMatchView) => {
    previousMatches.set(match.id, match)
  })

  let changes = false
  const mergedMatches = incoming.matches.map((match: LeagueMatchView) => {
    const existing = previousMatches.get(match.id)
    if (existing && areMatchesEqual(existing, match)) {
      return existing
    }
    changes = true
    return match
  })

  if (!changes) {
    const sameOrder =
      mergedMatches.length === previous.matches.length &&
      mergedMatches.every((match: LeagueMatchView, index: number) => match === previous.matches[index])
    if (sameMeta && sameOrder) {
      return previous
    }
  }

  if (!changes && sameMeta) {
    return previous
  }

  return {
    ...incoming,
    matches: mergedMatches,
  }
}

const mergeRoundCollection = (
  previous: LeagueRoundCollection | undefined,
  incoming: LeagueRoundCollection
): LeagueRoundCollection => {
  if (!previous || previous.season.id !== incoming.season.id) {
    return incoming
  }

  const season = reuseSeason(previous.season, incoming.season)
  const previousRounds = new Map<string, LeagueRoundMatches>()
  previous.rounds.forEach(round => {
    const key = round.roundId !== null ? String(round.roundId) : round.roundLabel
    previousRounds.set(key, round)
  })

  let changed = season !== previous.season || incoming.generatedAt !== previous.generatedAt

  const mergedRounds = incoming.rounds.map(round => {
    const key = round.roundId !== null ? String(round.roundId) : round.roundLabel
    const existing = previousRounds.get(key)
    if (!existing) {
      changed = true
      return round
    }
    const merged = mergeRoundMatches(existing, round)
    if (merged !== existing) {
      changed = true
    }
    return merged
  })

  if (
    !changed &&
    mergedRounds.length === previous.rounds.length &&
    mergedRounds.every((round: LeagueRoundMatches, index: number) => round === previous.rounds[index])
  ) {
    return previous
  }

  return {
    season,
    rounds: mergedRounds,
    generatedAt: incoming.generatedAt,
  }
}

const STAT_CATEGORIES: LeagueStatsCategory[] = ['goalContribution', 'scorers', 'assists']

const areLeaderboardEntriesEqual = (
  left: LeaguePlayerLeaderboardEntry,
  right: LeaguePlayerLeaderboardEntry
): boolean =>
  left.personId === right.personId &&
  left.firstName === right.firstName &&
  left.lastName === right.lastName &&
  left.clubId === right.clubId &&
  left.clubName === right.clubName &&
  left.clubShortName === right.clubShortName &&
  left.clubLogoUrl === right.clubLogoUrl &&
  left.matchesPlayed === right.matchesPlayed &&
  left.goals === right.goals &&
  left.assists === right.assists &&
  left.penaltyGoals === right.penaltyGoals

const mergeStatsResponse = (
  previous: LeagueStatsResponse | undefined,
  incoming: LeagueStatsResponse
): LeagueStatsResponse => {
  if (!previous || previous.season.id !== incoming.season.id) {
    return incoming
  }

  const season = reuseSeason(previous.season, incoming.season)
  let changed = season !== previous.season || incoming.generatedAt !== previous.generatedAt
  const leaderboards: LeagueStatsResponse['leaderboards'] = {
    goalContribution: [],
    scorers: [],
    assists: [],
  }

  STAT_CATEGORIES.forEach(category => {
    const prevEntries = previous.leaderboards[category] ?? []
    const nextEntries = incoming.leaderboards[category] ?? []
    const prevByKey = new Map<string, LeaguePlayerLeaderboardEntry>()
    prevEntries.forEach(entry => {
      prevByKey.set(`${entry.personId}:${entry.clubId}`, entry)
    })

    let localChanged = prevEntries.length !== nextEntries.length
    const mergedEntries = nextEntries.map(entry => {
      const existing = prevByKey.get(`${entry.personId}:${entry.clubId}`)
      if (existing && areLeaderboardEntriesEqual(existing, entry)) {
        return existing
      }
      localChanged = true
      return entry
    })

    const sameOrder =
      !localChanged &&
      mergedEntries.length === prevEntries.length &&
      mergedEntries.every((entry, index) => entry === prevEntries[index])

    if (sameOrder) {
      leaderboards[category] = prevEntries
    } else {
      leaderboards[category] = mergedEntries
    }

    if (!sameOrder) {
      changed = true
    }
  })

  if (!changed) {
    return previous
  }

  return {
    season,
    generatedAt: incoming.generatedAt,
    leaderboards,
  }
}

type MatchHeaderSyncPayload = {
  status: MatchStatus
  homeScore: number
  awayScore: number
  hasPenalty: boolean
  penaltyHome: number | null
  penaltyAway: number | null
}

const extractHeaderSyncPayload = (header: MatchDetailsHeader): MatchHeaderSyncPayload => {
  const hasPenalty = Boolean(header.ps)
  return {
    status: header.st,
    homeScore: header.ht.sc,
    awayScore: header.at.sc,
    hasPenalty,
    penaltyHome: hasPenalty ? header.ph ?? null : null,
    penaltyAway: hasPenalty ? header.pa ?? null : null,
  }
}

const applySummaryToMatchView = (
  match: LeagueMatchView,
  summary: MatchHeaderSyncPayload
): LeagueMatchView => {
  const nextPenaltyHome = summary.hasPenalty ? summary.penaltyHome : null
  const nextPenaltyAway = summary.hasPenalty ? summary.penaltyAway : null

  if (
    match.status === summary.status &&
    match.homeScore === summary.homeScore &&
    match.awayScore === summary.awayScore &&
    match.hasPenaltyShootout === summary.hasPenalty &&
    match.penaltyHomeScore === nextPenaltyHome &&
    match.penaltyAwayScore === nextPenaltyAway
  ) {
    return match
  }

  return {
    ...match,
    status: summary.status,
    homeScore: summary.homeScore,
    awayScore: summary.awayScore,
    hasPenaltyShootout: summary.hasPenalty,
    penaltyHomeScore: nextPenaltyHome,
    penaltyAwayScore: nextPenaltyAway,
  }
}

const syncScheduleCollectionWithHeader = (
  collection: LeagueRoundCollection,
  matchId: string,
  summary: MatchHeaderSyncPayload
): LeagueRoundCollection => {
  let changed = false
  const nextRounds: LeagueRoundMatches[] = []

  for (const round of collection.rounds) {
    let matchesChanged = false
    const nextMatches: LeagueMatchView[] = []

    for (const match of round.matches) {
      if (match.id !== matchId) {
        nextMatches.push(match)
        continue
      }

      if (summary.status === 'FINISHED') {
        matchesChanged = true
        changed = true
        continue
      }

      const updatedMatch = applySummaryToMatchView(match, summary)
      if (updatedMatch !== match) {
        matchesChanged = true
        changed = true
        nextMatches.push(updatedMatch)
      } else {
        nextMatches.push(match)
      }
    }

    if (!matchesChanged) {
      nextRounds.push(round)
      continue
    }

    if (summary.status === 'FINISHED' && nextMatches.length === 0) {
      continue
    }

    nextRounds.push({
      ...round,
      matches: nextMatches,
    })
  }

  if (!changed) {
    return collection
  }

  return {
    ...collection,
    rounds: nextRounds,
  }
}

const syncResultsCollectionWithHeader = (
  collection: LeagueRoundCollection,
  matchId: string,
  summary: MatchHeaderSyncPayload
): LeagueRoundCollection => {
  let changed = false
  const nextRounds = collection.rounds.map(round => {
    let matchesChanged = false
    const nextMatches = round.matches.map(match => {
      if (match.id !== matchId) {
        return match
      }
      const updatedMatch = applySummaryToMatchView(match, summary)
      if (updatedMatch !== match) {
        matchesChanged = true
        changed = true
        return updatedMatch
      }
      return match
    })

    if (!matchesChanged) {
      return round
    }

    return {
      ...round,
      matches: nextMatches,
    }
  })

  if (!changed) {
    return collection
  }

  return {
    ...collection,
    rounds: nextRounds,
  }
}

const syncSnapshotWithHeader = (
  snapshot: LeagueMatchView | undefined,
  matchId: string,
  summary: MatchHeaderSyncPayload
): LeagueMatchView | undefined => {
  if (!snapshot || snapshot.id !== matchId) {
    return snapshot
  }
  return applySummaryToMatchView(snapshot, summary)
}

let leaguePollingTimer: number | null = null
let teamPollingTimer: number | null = null
let teamPollingClubId: number | null = null
let unloadCleanupRegistered = false

const clearLeaguePolling = () => {
  if (!hasWindow) {
    leaguePollingTimer = null
    return
  }
  if (leaguePollingTimer !== null) {
    window.clearInterval(leaguePollingTimer)
    leaguePollingTimer = null
  }
}

const clearTeamPolling = () => {
  if (hasWindow && teamPollingTimer !== null) {
    window.clearInterval(teamPollingTimer)
  }
  teamPollingTimer = null
  teamPollingClubId = null
}

const registerUnloadCleanup = () => {
  if (!hasWindow || unloadCleanupRegistered) {
    return
  }
  window.addEventListener(
    'beforeunload',
    () => {
      clearLeaguePolling()
      clearTeamPolling()
    },
    { once: true }
  )
  unloadCleanupRegistered = true
}

const startLeaguePolling = (get: () => AppState) => {
  if (!hasWindow || leaguePollingTimer !== null) {
    return
  }
  registerUnloadCleanup()

  const tick = () => {
    if (typeof document !== 'undefined' && document.hidden) {
      return
    }

    const state = get()
    if (state.currentTab !== 'league') {
      return
    }

    const seasonId = resolveSeasonId(state)
    if (!seasonId) {
      return
    }

    // Запрашиваем данные только для активной подвкладки
    if (state.leagueSubTab === 'table') {
      void state.fetchLeagueTable({ seasonId })
    } else if (state.leagueSubTab === 'schedule') {
      void state.fetchLeagueSchedule({ seasonId })
    } else if (state.leagueSubTab === 'results') {
      void state.fetchLeagueResults({ seasonId })
    } else if (state.leagueSubTab === 'stats') {
      void state.fetchLeagueStats({ seasonId })
    }
  }

  leaguePollingTimer = window.setInterval(tick, LEAGUE_POLL_INTERVAL_MS)
  tick()
}

const startTeamPolling = (get: () => AppState, clubId: number) => {
  if (!hasWindow) {
    return
  }

  registerUnloadCleanup()

  if (teamPollingTimer !== null && teamPollingClubId === clubId) {
    return
  }

  clearTeamPolling()
  teamPollingClubId = clubId

  const tick = () => {
    if (typeof document !== 'undefined' && document.hidden) {
      return
    }

    const state = get()
    if (!state.teamView.open || state.teamView.clubId !== clubId) {
      clearTeamPolling()
      return
    }

    void state.fetchClubSummary(clubId)
  }

  teamPollingTimer = window.setInterval(tick, TEAM_POLL_INTERVAL_MS)
  tick()
}

type FetchResult = { ok: boolean }

interface LoadingState {
  seasons: boolean
  table: boolean
  schedule: boolean
  results: boolean
  stats: boolean
}

interface ErrorState {
  seasons?: string
  table?: string
  schedule?: string
  results?: string
  stats?: string
}

interface AppState {
  currentTab: UITab
  leagueSubTab: LeagueSubTab
  leagueMenuOpen: boolean
  seasons: LeagueSeasonSummary[]
  seasonsVersion?: string
  seasonsFetchedAt: number
  tables: Record<number, LeagueTableResponse>
  tableVersions: Record<number, string | undefined>
  tableFetchedAt: Record<number, number>
  schedules: Record<number, LeagueRoundCollection>
  scheduleVersions: Record<number, string | undefined>
  scheduleFetchedAt: Record<number, number>
  results: Record<number, LeagueRoundCollection>
  resultsVersions: Record<number, string | undefined>
  resultsFetchedAt: Record<number, number>
  stats: Record<number, LeagueStatsResponse>
  statsVersions: Record<number, string | undefined>
  statsFetchedAt: Record<number, number>
  selectedSeasonId?: number
  activeSeasonId?: number
  loading: LoadingState
  errors: ErrorState
  lastLeagueTapAt: number
  leaguePollingAttached: boolean
  teamView: TeamViewState
  teamSummaries: Record<number, ClubSummaryResponse>
  teamSummaryFetchedAt: Record<number, number>
  teamSummaryVersions: Record<number, string | undefined>
  teamSummaryLoadingId: number | null
  teamSummaryErrors: Record<number, string | undefined>
  teamPollingAttached: boolean
  teamPollingClubId?: number
  matchDetails: MatchDetailsState
  matchDetailsPollingAttached: boolean
  setTab: (tab: UITab) => void
  setLeagueSubTab: (tab: LeagueSubTab) => void
  toggleLeagueMenu: (force?: boolean) => void
  tapLeagueNav: (now: number) => void
  closeLeagueMenu: () => void
  setSelectedSeason: (seasonId: number) => void
  fetchLeagueSeasons: (options?: { force?: boolean }) => Promise<FetchResult>
  fetchLeagueTable: (options?: { seasonId?: number; force?: boolean }) => Promise<FetchResult>
  fetchLeagueSchedule: (options?: { seasonId?: number; force?: boolean }) => Promise<FetchResult>
  fetchLeagueResults: (options?: { seasonId?: number; force?: boolean }) => Promise<FetchResult>
  fetchLeagueStats: (options?: { seasonId?: number; force?: boolean }) => Promise<FetchResult>
  ensureLeaguePolling: () => void
  stopLeaguePolling: () => void
  openTeamView: (clubId: number) => void
  closeTeamView: () => void
  setTeamSubTab: (tab: TeamSubTab) => void
  setTeamMatchesMode: (mode: TeamMatchesMode) => void
  fetchClubSummary: (clubId: number, options?: { force?: boolean }) => Promise<FetchResult>
  ensureTeamPolling: () => void
  stopTeamPolling: () => void
  openMatchDetails: (matchId: string, snapshot?: LeagueMatchView, seasonId?: number) => void
  closeMatchDetails: () => void
  setMatchDetailsTab: (tab: MatchDetailsTab) => void
  fetchMatchHeader: (matchId: string, options?: { force?: boolean }) => Promise<FetchResult>
  fetchMatchLineups: (matchId: string, options?: { force?: boolean }) => Promise<FetchResult>
  fetchMatchStats: (matchId: string, options?: { force?: boolean }) => Promise<FetchResult>
  fetchMatchEvents: (matchId: string, options?: { force?: boolean }) => Promise<FetchResult>
  ensureMatchDetailsPolling: () => void
  stopMatchDetailsPolling: () => void
}

const orderSeasons = (items: LeagueSeasonSummary[]) =>
  [...items].sort((left, right) => right.startDate.localeCompare(left.startDate))

const resolveSeasonId = (state: AppState, override?: number) =>
  override ?? state.selectedSeasonId ?? state.activeSeasonId

const isClubSummaryStatistics = (
  value: unknown
): value is ClubSummaryResponse['statistics'] => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const stats = value as Record<string, unknown>
  return (
    typeof stats.tournaments === 'number' &&
    typeof stats.matchesPlayed === 'number' &&
    typeof stats.wins === 'number' &&
    typeof stats.draws === 'number' &&
    typeof stats.losses === 'number' &&
    typeof stats.goalsFor === 'number' &&
    typeof stats.goalsAgainst === 'number' &&
    typeof stats.yellowCards === 'number' &&
    typeof stats.redCards === 'number' &&
    typeof stats.cleanSheets === 'number'
  )
}

const isClubSummaryFormEntry = (
  value: unknown
): value is ClubSummaryResponse['form'][number] => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const entry = value as Record<string, unknown>
  const opponent = entry.opponent as Record<string, unknown> | undefined
  const score = entry.score as Record<string, unknown> | undefined
  const competition = entry.competition as Record<string, unknown> | undefined
  const season = entry.season as Record<string, unknown> | undefined
  const result = entry.result

  return (
    typeof entry.matchId === 'string' &&
    typeof entry.matchDateTime === 'string' &&
    typeof entry.isHome === 'boolean' &&
    (result === 'WIN' || result === 'DRAW' || result === 'LOSS') &&
    opponent != null &&
    typeof opponent.id === 'number' &&
    typeof opponent.name === 'string' &&
    typeof opponent.shortName === 'string' &&
    (opponent.logoUrl === null || typeof opponent.logoUrl === 'string') &&
    score != null &&
    typeof score.home === 'number' &&
    typeof score.away === 'number' &&
    (score.penaltyHome === null || typeof score.penaltyHome === 'number') &&
    (score.penaltyAway === null || typeof score.penaltyAway === 'number') &&
    competition != null &&
    typeof competition.id === 'number' &&
    typeof competition.name === 'string' &&
    season != null &&
    typeof season.id === 'number' &&
    typeof season.name === 'string'
  )
}

const isClubSummaryAchievement = (
  value: unknown
): value is ClubSummaryResponse['achievements'][number] => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const achievement = value as Record<string, unknown>
  return (
    typeof achievement.id === 'string' &&
    typeof achievement.title === 'string' &&
    (achievement.subtitle === undefined || achievement.subtitle === null || typeof achievement.subtitle === 'string')
  )
}

const isClubSummaryResponsePayload = (
  payload: unknown
): payload is ClubSummaryResponse => {
  if (!payload || typeof payload !== 'object') {
    return false
  }
  const candidate = payload as Record<string, unknown>
  const club = candidate.club as Record<string, unknown> | undefined
  if (
    !club ||
    typeof club.id !== 'number' ||
    typeof club.name !== 'string' ||
    typeof club.shortName !== 'string' ||
    !(club.logoUrl === null || typeof club.logoUrl === 'string')
  ) {
    return false
  }
  if (!isClubSummaryStatistics(candidate.statistics)) {
    return false
  }
  const form = candidate.form
  if (!Array.isArray(form) || !form.every(isClubSummaryFormEntry)) {
    return false
  }
  const achievements = candidate.achievements
  if (!Array.isArray(achievements) || !achievements.every(isClubSummaryAchievement)) {
    return false
  }
  return typeof candidate.generatedAt === 'string'
}

export const useAppStore = create<AppState>((set, get) => ({
  currentTab: 'home',
  leagueSubTab: 'table',
  leagueMenuOpen: false,
  seasons: [],
  seasonsVersion: undefined,
  seasonsFetchedAt: 0,
  tables: readFromStorage('tables') ?? {},
  tableVersions: readFromStorage('tableVersions') ?? {},
  tableFetchedAt: {},
  schedules: readFromStorage('schedules') ?? {},
  scheduleVersions: readFromStorage('scheduleVersions') ?? {},
  scheduleFetchedAt: {},
  results: readFromStorage('results') ?? {},
  resultsVersions: readFromStorage('resultsVersions') ?? {},
  resultsFetchedAt: {},
  stats: readFromStorage('stats') ?? {},
  statsVersions: readFromStorage('statsVersions') ?? {},
  statsFetchedAt: {},
  selectedSeasonId: undefined,
  activeSeasonId: undefined,
  loading: { seasons: false, table: false, schedule: false, results: false, stats: false },
  errors: {},
  lastLeagueTapAt: 0,
  leaguePollingAttached: false,
  teamView: { ...INITIAL_TEAM_VIEW },
  teamSummaries: {},
  teamSummaryFetchedAt: {},
  teamSummaryVersions: {},
  teamSummaryLoadingId: null,
  teamSummaryErrors: {},
  teamPollingAttached: false,
  teamPollingClubId: undefined,
  matchDetails: { ...INITIAL_MATCH_DETAILS },
  matchDetailsPollingAttached: false,
  setTab: tab => {
    set(state => ({
      currentTab: tab,
      leagueMenuOpen: tab === 'league' ? state.leagueMenuOpen : false,
    }))
  },
  setLeagueSubTab: tab => set({ leagueSubTab: tab }),
  toggleLeagueMenu: force => {
    set(state => {
      if (typeof force === 'boolean') {
        return { leagueMenuOpen: force }
      }
      if (state.currentTab !== 'league') {
        return { leagueMenuOpen: state.leagueMenuOpen }
      }
      return { leagueMenuOpen: !state.leagueMenuOpen }
    })
  },
  tapLeagueNav: now => {
    const state = get()
    if (state.currentTab !== 'league') {
      set({ currentTab: 'league', lastLeagueTapAt: now, leagueMenuOpen: false })
      return
    }
    if (state.leagueMenuOpen) {
      set({ leagueMenuOpen: false, lastLeagueTapAt: now })
      return
    }
    const delta = now - state.lastLeagueTapAt
    if (delta > 0 && delta <= DOUBLE_TAP_THRESHOLD_MS) {
      set({ leagueMenuOpen: true, lastLeagueTapAt: 0 })
      return
    }
    set({ lastLeagueTapAt: now })
  },
  closeLeagueMenu: () => set({ leagueMenuOpen: false }),
  setSelectedSeason: seasonId => {
    const seasons = get().seasons
    if (!seasons.some(season => season.id === seasonId)) {
      return
    }
    set({ selectedSeasonId: seasonId })
  },
  fetchLeagueSeasons: async options => {
    const state = get()
    if (state.loading.seasons) {
      return { ok: true }
    }
    const now = Date.now()
    if (!options?.force && state.seasonsFetchedAt && now - state.seasonsFetchedAt < SEASONS_TTL_MS) {
      return { ok: true }
    }
    set(prev => ({
      loading: { ...prev.loading, seasons: true },
      errors: { ...prev.errors, seasons: undefined },
    }))
    const requestVersion = options?.force ? undefined : state.seasonsVersion
    const response = await leagueApi.fetchSeasons({ version: requestVersion })
    if (!response.ok) {
      set(prev => ({
        loading: { ...prev.loading, seasons: false },
        errors: { ...prev.errors, seasons: response.error },
      }))
      return { ok: false }
    }
    if (!('data' in response)) {
      if (state.seasons.length === 0) {
        set(prev => ({
          loading: { ...prev.loading, seasons: false },
          errors: { ...prev.errors, seasons: 'empty_cache' },
        }))
        return { ok: false }
      }
      set(prev => ({
        seasonsFetchedAt: now,
        loading: { ...prev.loading, seasons: false },
      }))
      return { ok: true }
    }
    const ordered = orderSeasons(response.data)
    const active = ordered.find(season => season.isActive)
    const previousSelected = state.selectedSeasonId
    const nextSelected = previousSelected && ordered.some(season => season.id === previousSelected)
      ? previousSelected
      : active?.id ?? ordered[0]?.id
    set(prev => ({
      seasons: ordered,
      seasonsVersion: response.version,
      seasonsFetchedAt: now,
      activeSeasonId: active?.id,
      selectedSeasonId: nextSelected,
      loading: { ...prev.loading, seasons: false },
    }))
    if (nextSelected) {
      void get().fetchLeagueTable({ seasonId: nextSelected })
    }
    return { ok: true }
  },
  fetchLeagueTable: async options => {
    const state = get()
    const seasonId = resolveSeasonId(state, options?.seasonId)
    if (!seasonId) {
      return { ok: false }
    }
    if (state.loading.table && !options?.force) {
      return { ok: true }
    }
    const now = Date.now()
    const lastFetched = state.tableFetchedAt[seasonId] ?? 0
    if (!options?.force && lastFetched && now - lastFetched < TABLE_TTL_MS) {
      return { ok: true }
    }
    set(prev => ({
      loading: { ...prev.loading, table: true },
      errors: { ...prev.errors, table: undefined },
    }))
    const currentVersion = state.tableVersions[seasonId]
    const requestVersion = options?.force ? undefined : currentVersion
    const response = await leagueApi.fetchTable(seasonId, {
      version: requestVersion,
    })
    if (!response.ok) {
      set(prev => ({
        loading: { ...prev.loading, table: false },
        errors: { ...prev.errors, table: response.error },
      }))
      return { ok: false }
    }
    if (!('data' in response)) {
      if (!state.tables[seasonId]) {
        set(prev => ({
          loading: { ...prev.loading, table: false },
          errors: { ...prev.errors, table: 'empty_cache' },
        }))
        return { ok: false }
      }
      set(prev => ({
        tableFetchedAt: { ...prev.tableFetchedAt, [seasonId]: now },
        loading: { ...prev.loading, table: false },
      }))
      return { ok: true }
    }
    const nextVersion = response.version ?? state.tableVersions[seasonId]
    set(prev => {
      const nextTable = mergeLeagueTable(prev.tables[seasonId], response.data)
      const nextTables = { ...prev.tables, [seasonId]: nextTable }
      const nextTableVersions = { ...prev.tableVersions, [seasonId]: nextVersion }
      
      writeToStorage('tables', nextTables)
      writeToStorage('tableVersions', nextTableVersions)
      
      return {
        tables: nextTables,
        tableVersions: nextTableVersions,
        tableFetchedAt: { ...prev.tableFetchedAt, [seasonId]: now },
        loading: { ...prev.loading, table: false },
        activeSeasonId: nextTable.season.isActive ? nextTable.season.id : prev.activeSeasonId,
      }
    })
    return { ok: true }
  },
  fetchLeagueSchedule: async options => {
    const state = get()
    const seasonId = resolveSeasonId(state, options?.seasonId)
    if (!seasonId) {
      return { ok: false }
    }
    if (state.loading.schedule && !options?.force) {
      return { ok: true }
    }
    const now = Date.now()
    const lastFetched = state.scheduleFetchedAt[seasonId] ?? 0
    if (!options?.force && lastFetched && now - lastFetched < SCHEDULE_TTL_MS) {
      return { ok: true }
    }
    set(prev => ({
      loading: { ...prev.loading, schedule: true },
      errors: { ...prev.errors, schedule: undefined },
    }))
    const requestVersion = options?.force ? undefined : state.scheduleVersions[seasonId]
    const response = await leagueApi.fetchSchedule(seasonId, {
      version: requestVersion,
    })
    if (!response.ok) {
      set(prev => ({
        loading: { ...prev.loading, schedule: false },
        errors: { ...prev.errors, schedule: response.error },
      }))
      return { ok: false }
    }
    if (!('data' in response)) {
      if (!state.schedules[seasonId]) {
        set(prev => ({
          loading: { ...prev.loading, schedule: false },
          errors: { ...prev.errors, schedule: 'empty_cache' },
        }))
        return { ok: false }
      }
      set(prev => ({
        scheduleFetchedAt: { ...prev.scheduleFetchedAt, [seasonId]: now },
        loading: { ...prev.loading, schedule: false },
      }))
      return { ok: true }
    }
    const nextVersion = response.version ?? state.scheduleVersions[seasonId]
    set(prev => {
      const nextSchedule = mergeRoundCollection(prev.schedules[seasonId], response.data)
      const nextSchedules = { ...prev.schedules, [seasonId]: nextSchedule }
      const nextScheduleVersions = { ...prev.scheduleVersions, [seasonId]: nextVersion }
      
      writeToStorage('schedules', nextSchedules)
      writeToStorage('scheduleVersions', nextScheduleVersions)
      
      return {
        schedules: nextSchedules,
        scheduleVersions: nextScheduleVersions,
        scheduleFetchedAt: { ...prev.scheduleFetchedAt, [seasonId]: now },
        loading: { ...prev.loading, schedule: false },
        activeSeasonId: nextSchedule.season.isActive ? nextSchedule.season.id : prev.activeSeasonId,
      }
    })
    return { ok: true }
  },
  fetchLeagueResults: async options => {
    const state = get()
    const seasonId = resolveSeasonId(state, options?.seasonId)
    if (!seasonId) {
      return { ok: false }
    }
    if (state.loading.results && !options?.force) {
      return { ok: true }
    }
    const now = Date.now()
    const lastFetched = state.resultsFetchedAt[seasonId] ?? 0
    if (!options?.force && lastFetched && now - lastFetched < RESULTS_TTL_MS) {
      return { ok: true }
    }
    set(prev => ({
      loading: { ...prev.loading, results: true },
      errors: { ...prev.errors, results: undefined },
    }))
    const requestVersion = options?.force ? undefined : state.resultsVersions[seasonId]
    const response = await leagueApi.fetchResults(seasonId, {
      version: requestVersion,
    })
    if (!response.ok) {
      set(prev => ({
        loading: { ...prev.loading, results: false },
        errors: { ...prev.errors, results: response.error },
      }))
      return { ok: false }
    }
    if (!('data' in response)) {
      if (!state.results[seasonId]) {
        set(prev => ({
          loading: { ...prev.loading, results: false },
          errors: { ...prev.errors, results: 'empty_cache' },
        }))
        return { ok: false }
      }
      set(prev => ({
        resultsFetchedAt: { ...prev.resultsFetchedAt, [seasonId]: now },
        loading: { ...prev.loading, results: false },
      }))
      return { ok: true }
    }
    const nextVersion = response.version ?? state.resultsVersions[seasonId]
    set(prev => {
      const nextResults = mergeRoundCollection(prev.results[seasonId], response.data)
      const nextResultsMap = { ...prev.results, [seasonId]: nextResults }
      const nextResultsVersions = { ...prev.resultsVersions, [seasonId]: nextVersion }
      
      writeToStorage('results', nextResultsMap)
      writeToStorage('resultsVersions', nextResultsVersions)
      
      return {
        results: nextResultsMap,
        resultsVersions: nextResultsVersions,
        resultsFetchedAt: { ...prev.resultsFetchedAt, [seasonId]: now },
        loading: { ...prev.loading, results: false },
        activeSeasonId: nextResults.season.isActive ? nextResults.season.id : prev.activeSeasonId,
      }
    })
    return { ok: true }
  },
  fetchLeagueStats: async options => {
    const state = get()
    const seasonId = resolveSeasonId(state, options?.seasonId)
    if (!seasonId) {
      return { ok: false }
    }
    if (state.loading.stats && !options?.force) {
      return { ok: true }
    }
    const now = Date.now()
    const lastFetched = state.statsFetchedAt[seasonId] ?? 0
    if (!options?.force && lastFetched && now - lastFetched < STATS_TTL_MS) {
      return { ok: true }
    }
    set(prev => ({
      loading: { ...prev.loading, stats: true },
      errors: { ...prev.errors, stats: undefined },
    }))
    const requestVersion = options?.force ? undefined : state.statsVersions[seasonId]
    const response = await leagueApi.fetchStats(seasonId, {
      version: requestVersion,
    })
    if (!response.ok) {
      set(prev => ({
        loading: { ...prev.loading, stats: false },
        errors: { ...prev.errors, stats: response.error },
      }))
      return { ok: false }
    }
    if (!('data' in response)) {
      if (!state.stats[seasonId]) {
        set(prev => ({
          loading: { ...prev.loading, stats: false },
          errors: { ...prev.errors, stats: 'empty_cache' },
        }))
        return { ok: false }
      }
      set(prev => ({
        statsFetchedAt: { ...prev.statsFetchedAt, [seasonId]: now },
        loading: { ...prev.loading, stats: false },
      }))
      return { ok: true }
    }
    const nextVersion = response.version ?? state.statsVersions[seasonId]
    set(prev => {
      const nextStats = mergeStatsResponse(prev.stats[seasonId], response.data)
      const nextStatsMap = { ...prev.stats, [seasonId]: nextStats }
      const nextStatsVersions = { ...prev.statsVersions, [seasonId]: nextVersion }
      
      writeToStorage('stats', nextStatsMap)
      writeToStorage('statsVersions', nextStatsVersions)
      
      return {
        stats: nextStatsMap,
        statsVersions: nextStatsVersions,
        statsFetchedAt: { ...prev.statsFetchedAt, [seasonId]: now },
        loading: { ...prev.loading, stats: false },
        activeSeasonId: nextStats.season.isActive ? nextStats.season.id : prev.activeSeasonId,
      }
    })
    return { ok: true }
  },
  ensureLeaguePolling: () => {
    const state = get()
    if (state.leaguePollingAttached) {
      return
    }
    startLeaguePolling(get)
    set({ leaguePollingAttached: true })
  },
  stopLeaguePolling: () => {
    clearLeaguePolling()
    set({ leaguePollingAttached: false })
  },
  openTeamView: clubId => {
    set(prev => {
      const sameClub = prev.teamView.clubId === clubId
      return {
        teamView: {
          open: true,
          clubId,
          activeTab: sameClub ? prev.teamView.activeTab : 'overview',
          matchesMode: sameClub ? prev.teamView.matchesMode : 'schedule',
        },
        teamSummaryErrors: { ...prev.teamSummaryErrors, [clubId]: undefined },
      }
    })
    get().ensureTeamPolling()
    void get().fetchClubSummary(clubId)
  },
  closeTeamView: () => {
    const state = get()
    get().stopTeamPolling()
    const shouldClearLoading =
      state.teamSummaryLoadingId !== null && state.teamSummaryLoadingId === state.teamView.clubId
    set(prev => ({
      teamView: { ...INITIAL_TEAM_VIEW },
      teamPollingAttached: false,
      teamPollingClubId: undefined,
      teamSummaryLoadingId: shouldClearLoading ? null : prev.teamSummaryLoadingId,
    }))
  },
  setTeamSubTab: tab => {
    set(prev => ({
      teamView: prev.teamView.open ? { ...prev.teamView, activeTab: tab } : prev.teamView,
    }))
  },
  setTeamMatchesMode: mode => {
    set(prev => ({
      teamView: prev.teamView.open ? { ...prev.teamView, matchesMode: mode } : prev.teamView,
    }))
  },
  fetchClubSummary: async (clubId, options) => {
    const state = get()
    const now = Date.now()
    const lastFetched = state.teamSummaryFetchedAt[clubId] ?? 0
    const hasFreshData = now - lastFetched < CLUB_SUMMARY_TTL_MS
    if (!options?.force && state.teamSummaries[clubId] && hasFreshData) {
      get().ensureTeamPolling()
      return { ok: true }
    }
    if (state.teamSummaryLoadingId === clubId && !options?.force) {
      return { ok: true }
    }
    set(prev => ({
      teamSummaryLoadingId: clubId,
      teamSummaryErrors: { ...prev.teamSummaryErrors, [clubId]: undefined },
    }))

    const requestVersion = options?.force ? undefined : state.teamSummaryVersions[clubId]
    const response = await clubApi.fetchSummary(clubId, {
      version: requestVersion,
    })
    if (!response.ok) {
      set(prev => ({
        teamSummaryLoadingId:
          prev.teamSummaryLoadingId === clubId ? null : prev.teamSummaryLoadingId,
        teamSummaryErrors: { ...prev.teamSummaryErrors, [clubId]: response.error },
      }))
      return { ok: false }
    }
    if (!('data' in response)) {
      if (!state.teamSummaries[clubId]) {
        set(prev => ({
          teamSummaryLoadingId:
            prev.teamSummaryLoadingId === clubId ? null : prev.teamSummaryLoadingId,
          teamSummaryErrors: { ...prev.teamSummaryErrors, [clubId]: 'empty_cache' },
        }))
        return { ok: false }
      }
      set(prev => ({
        teamSummaryFetchedAt: { ...prev.teamSummaryFetchedAt, [clubId]: Date.now() },
        teamSummaryLoadingId:
          prev.teamSummaryLoadingId === clubId ? null : prev.teamSummaryLoadingId,
        teamSummaryErrors: { ...prev.teamSummaryErrors, [clubId]: undefined },
      }))
      get().ensureTeamPolling()
      return { ok: true }
    }

    const payload = response.data as unknown
    if (!isClubSummaryResponsePayload(payload)) {
      set(prev => ({
        teamSummaryLoadingId:
          prev.teamSummaryLoadingId === clubId ? null : prev.teamSummaryLoadingId,
        teamSummaryErrors: { ...prev.teamSummaryErrors, [clubId]: 'invalid_payload' },
      }))
      return { ok: false }
    }

    const fetchedAt = Date.now()
    const nextVersion = response.version ?? state.teamSummaryVersions[clubId]
    set(prev => ({
      teamSummaries: { ...prev.teamSummaries, [clubId]: payload },
      teamSummaryVersions: { ...prev.teamSummaryVersions, [clubId]: nextVersion },
      teamSummaryFetchedAt: { ...prev.teamSummaryFetchedAt, [clubId]: fetchedAt },
      teamSummaryLoadingId: prev.teamSummaryLoadingId === clubId ? null : prev.teamSummaryLoadingId,
      teamSummaryErrors: { ...prev.teamSummaryErrors, [clubId]: undefined },
    }))
    get().ensureTeamPolling()
    return { ok: true }
  },
  ensureTeamPolling: () => {
    const state = get()
    const clubId = state.teamView.clubId
    if (!clubId) {
      get().stopTeamPolling()
      return
    }
    if (state.teamPollingAttached && state.teamPollingClubId === clubId) {
      return
    }
    startTeamPolling(get, clubId)
    set({ teamPollingAttached: true, teamPollingClubId: clubId })
  },
  stopTeamPolling: () => {
    clearTeamPolling()
    set({ teamPollingAttached: false, teamPollingClubId: undefined })
  },
  openMatchDetails: (matchId, snapshot, seasonId) => {
    const state = get()
    state.stopLeaguePolling()
    const resolvedSeasonId = seasonId ?? state.matchDetails.seasonId ?? state.selectedSeasonId ?? state.activeSeasonId
    set({
      matchDetails: {
        ...INITIAL_MATCH_DETAILS,
        open: true,
        matchId,
        seasonId: resolvedSeasonId,
        snapshot,
      },
    })
    void get().fetchMatchHeader(matchId)
    void get().fetchMatchLineups(matchId)
    if (snapshot?.status === 'LIVE' || snapshot?.status === 'FINISHED') {
      void get().fetchMatchEvents(matchId)
      void get().fetchMatchStats(matchId)
    }
  },
  closeMatchDetails: () => {
    get().stopMatchDetailsPolling()
    set({ matchDetails: { ...INITIAL_MATCH_DETAILS }, matchDetailsPollingAttached: false })
    get().ensureLeaguePolling()
  },
  setMatchDetailsTab: tab => {
    set(prev => ({
      matchDetails: prev.matchDetails.open
        ? { ...prev.matchDetails, activeTab: tab }
        : prev.matchDetails,
    }))
    const state = get()
    const matchId = state.matchDetails.matchId
    if (!matchId) return

    // Lazy load data for the tab
    if (tab === 'lineups' && !state.matchDetails.lineups) {
      void get().fetchMatchLineups(matchId)
    } else if (tab === 'events' && !state.matchDetails.events) {
      void get().fetchMatchEvents(matchId)
    } else if (tab === 'stats' && !state.matchDetails.stats) {
      void get().fetchMatchStats(matchId)
    }
  },
  fetchMatchHeader: async (matchId, options) => {
    const state = get()
    if (state.matchDetails.loadingHeader && !options?.force) {
      return { ok: true }
    }

    set(prev => ({
      matchDetails: { ...prev.matchDetails, loadingHeader: true, errorHeader: undefined },
    }))

    const requestEtag = options?.force ? undefined : state.matchDetails.headerEtag
    const response = await matchApi.fetchHeader(matchId, {
      etag: requestEtag,
    })

    if (!response.ok) {
      set(prev => ({
        matchDetails: { ...prev.matchDetails, loadingHeader: false, errorHeader: response.error },
      }))
      return { ok: false }
    }

    if (!('data' in response)) {
      // 304 Not Modified - data is still fresh
      set(prev => ({
        matchDetails: { ...prev.matchDetails, loadingHeader: false },
      }))
      get().ensureMatchDetailsPolling()
      return { ok: true }
    }

    const previousStatus = state.matchDetails.header?.st ?? state.matchDetails.snapshot?.status
    const seasonIdForFetch =
      state.matchDetails.seasonId ?? state.selectedSeasonId ?? state.activeSeasonId
    const summary = extractHeaderSyncPayload(response.data)

    set(prev => {
      const targetSeasonId =
        prev.matchDetails.seasonId ?? prev.selectedSeasonId ?? prev.activeSeasonId

      let schedulesMap = prev.schedules
      let resultsMap = prev.results
      let scheduleChanged = false
      let resultsChanged = false

      if (targetSeasonId) {
        const currentSchedule = prev.schedules[targetSeasonId]
        if (currentSchedule) {
          const patchedSchedule = syncScheduleCollectionWithHeader(
            currentSchedule,
            matchId,
            summary
          )
          if (patchedSchedule !== currentSchedule) {
            schedulesMap = { ...prev.schedules, [targetSeasonId]: patchedSchedule }
            scheduleChanged = true
          }
        }

        const currentResults = prev.results[targetSeasonId]
        if (currentResults) {
          const patchedResults = syncResultsCollectionWithHeader(
            currentResults,
            matchId,
            summary
          )
          if (patchedResults !== currentResults) {
            resultsMap = { ...prev.results, [targetSeasonId]: patchedResults }
            resultsChanged = true
          }
        }
      }

      if (scheduleChanged) {
        writeToStorage('schedules', schedulesMap)
      }
      if (resultsChanged) {
        writeToStorage('results', resultsMap)
      }

      const nextSnapshot = syncSnapshotWithHeader(prev.matchDetails.snapshot, matchId, summary)

      return {
        ...prev,
        schedules: scheduleChanged ? schedulesMap : prev.schedules,
        results: resultsChanged ? resultsMap : prev.results,
        matchDetails: {
          ...prev.matchDetails,
          header: response.data,
          headerEtag: response.version,
          loadingHeader: false,
          errorHeader: undefined,
          snapshot: nextSnapshot,
        },
      }
    })
    const headerStatus = response.data.st
    if (headerStatus === 'LIVE' || headerStatus === 'FINISHED') {
      const current = get().matchDetails
      if (!current.events && !current.loadingEvents) {
        void get().fetchMatchEvents(matchId)
      }
      if (!current.stats && !current.loadingStats) {
        void get().fetchMatchStats(matchId)
      }
    }
    if (headerStatus === 'FINISHED' && previousStatus !== 'FINISHED' && seasonIdForFetch) {
      void get().fetchLeagueSchedule({ seasonId: seasonIdForFetch, force: true })
      void get().fetchLeagueResults({ seasonId: seasonIdForFetch, force: true })
    }
    get().ensureMatchDetailsPolling()
    return { ok: true }
  },
  fetchMatchLineups: async (matchId, options) => {
    const state = get()
    if (state.matchDetails.loadingLineups && !options?.force) {
      return { ok: true }
    }

    set(prev => ({
      matchDetails: { ...prev.matchDetails, loadingLineups: true, errorLineups: undefined },
    }))

    const requestEtag = options?.force ? undefined : state.matchDetails.lineupsEtag
    const response = await matchApi.fetchLineups(matchId, {
      etag: requestEtag,
    })

    if (!response.ok) {
      set(prev => ({
        matchDetails: {
          ...prev.matchDetails,
          loadingLineups: false,
          errorLineups: response.error,
        },
      }))
      return { ok: false }
    }

    if (!('data' in response)) {
      set(prev => ({
        matchDetails: { ...prev.matchDetails, loadingLineups: false },
      }))
      return { ok: true }
    }

    set(prev => ({
      matchDetails: {
        ...prev.matchDetails,
        lineups: response.data,
        lineupsEtag: response.version,
        loadingLineups: false,
        errorLineups: undefined,
      },
    }))
    return { ok: true }
  },
  fetchMatchStats: async (matchId, options) => {
    const state = get()
    if (state.matchDetails.loadingStats && !options?.force) {
      return { ok: true }
    }

    set(prev => ({
      matchDetails: { ...prev.matchDetails, loadingStats: true, errorStats: undefined },
    }))

    const requestEtag = options?.force ? undefined : state.matchDetails.statsEtag
    const response = await matchApi.fetchStats(matchId, {
      etag: requestEtag,
    })

    if (!response.ok) {
      set(prev => ({
        matchDetails: { ...prev.matchDetails, loadingStats: false, errorStats: response.error },
      }))
      return { ok: false }
    }

    if (!('data' in response)) {
      set(prev => ({
        matchDetails: { ...prev.matchDetails, loadingStats: false },
      }))
      return { ok: true }
    }

    set(prev => ({
      matchDetails: {
        ...prev.matchDetails,
        stats: response.data,
        statsEtag: response.version,
        loadingStats: false,
        errorStats: undefined,
      },
    }))
    return { ok: true }
  },
  fetchMatchEvents: async (matchId, options) => {
    const state = get()
    if (state.matchDetails.loadingEvents && !options?.force) {
      return { ok: true }
    }

    set(prev => ({
      matchDetails: { ...prev.matchDetails, loadingEvents: true, errorEvents: undefined },
    }))

    const requestEtag = options?.force ? undefined : state.matchDetails.eventsEtag
    const response = await matchApi.fetchEvents(matchId, {
      etag: requestEtag,
    })

    if (!response.ok) {
      set(prev => ({
        matchDetails: { ...prev.matchDetails, loadingEvents: false, errorEvents: response.error },
      }))
      return { ok: false }
    }

    if (!('data' in response)) {
      set(prev => ({
        matchDetails: { ...prev.matchDetails, loadingEvents: false },
      }))
      return { ok: true }
    }

    set(prev => ({
      matchDetails: {
        ...prev.matchDetails,
        events: response.data,
        eventsEtag: response.version,
        loadingEvents: false,
        errorEvents: undefined,
      },
    }))
    return { ok: true }
  },
  ensureMatchDetailsPolling: () => {
    const state = get()
    if (!state.matchDetails.open || !state.matchDetails.matchId) {
      get().stopMatchDetailsPolling()
      return
    }

    const isLive = state.matchDetails.header?.st === 'LIVE'
    if (!isLive) {
      get().stopMatchDetailsPolling()
      return
    }

    if (state.matchDetailsPollingAttached) {
      return
    }

    startMatchDetailsPolling(get)
    set({ matchDetailsPollingAttached: true })
  },
  stopMatchDetailsPolling: () => {
    clearMatchDetailsPolling()
    set({ matchDetailsPollingAttached: false })
  },
}))

// Match Details Polling
let matchDetailsPollingIntervalId: number | undefined

function startMatchDetailsPolling(get: () => AppState) {
  clearMatchDetailsPolling()
  matchDetailsPollingIntervalId = window.setInterval(() => {
    const state = get()
    if (!state.matchDetails.open || !state.matchDetails.matchId) {
      clearMatchDetailsPolling()
      return
    }
    const isLive = state.matchDetails.header?.st === 'LIVE'
    if (!isLive) {
      clearMatchDetailsPolling()
      return
    }
    void get().fetchMatchHeader(state.matchDetails.matchId, { force: false })
    if (state.matchDetails.activeTab === 'events') {
      void get().fetchMatchEvents(state.matchDetails.matchId, { force: false })
    }
    if (state.matchDetails.activeTab === 'stats') {
      void get().fetchMatchStats(state.matchDetails.matchId, { force: false })
    }
  }, MATCH_DETAILS_POLL_INTERVAL_MS)
}

function clearMatchDetailsPolling() {
  if (matchDetailsPollingIntervalId !== undefined) {
    clearInterval(matchDetailsPollingIntervalId)
    matchDetailsPollingIntervalId = undefined
  }
}

