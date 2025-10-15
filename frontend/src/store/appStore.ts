import { create } from 'zustand'
import type {
  LeagueRoundCollection,
  LeagueSeasonSummary,
  LeagueTableResponse,
  LeagueStatsResponse,
  LeagueStatsCategory,
  LeaguePlayerLeaderboardEntry,
  ClubSummaryResponse,
} from '@shared/types'
import { leagueApi } from '../api/leagueApi'
import { clubApi } from '../api/clubApi'
import { wsClient } from '../wsClient'

export type UITab = 'home' | 'league' | 'predictions' | 'leaderboard' | 'shop' | 'profile'
export type LeagueSubTab = 'table' | 'schedule' | 'results' | 'stats'
export type TeamSubTab = 'overview' | 'matches' | 'squad'

type TeamViewState = {
  open: boolean
  clubId?: number
  activeTab: TeamSubTab
}

const INITIAL_TEAM_VIEW: TeamViewState = {
  open: false,
  clubId: undefined,
  activeTab: 'overview',
}

const SEASONS_TTL_MS = 55_000
const TABLE_TTL_MS = 240_000
const SCHEDULE_TTL_MS = 7_500
const RESULTS_TTL_MS = 14_000
const STATS_TTL_MS = 300_000
const CLUB_SUMMARY_TTL_MS = 1_200_000
const DOUBLE_TAP_THRESHOLD_MS = 280

const clubSummaryTopic = (clubId: number) => `public:club:${clubId}:summary`

let teamRealtimeCleanup: (() => void) | null = null
let teamRealtimeTopic: string | null = null
let teamRealtimeUnloadRegistered = false

const detachTeamRealtime = () => {
  if (teamRealtimeCleanup) {
    teamRealtimeCleanup()
    teamRealtimeCleanup = null
  }
  if (teamRealtimeTopic) {
    wsClient.unsubscribe(teamRealtimeTopic)
    teamRealtimeTopic = null
  }
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
  realtimeAttached: boolean
  teamView: TeamViewState
  teamSummaries: Record<number, ClubSummaryResponse>
  teamSummaryFetchedAt: Record<number, number>
  teamSummaryLoadingId: number | null
  teamSummaryErrors: Record<number, string | undefined>
  teamRealtimeAttached: boolean
  teamRealtimeClubId?: number
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
  applyRealtimeTable: (table: LeagueTableResponse) => void
  applyRealtimeSchedule: (collection: LeagueRoundCollection) => void
  applyRealtimeResults: (collection: LeagueRoundCollection) => void
  applyRealtimeStats: (params: {
    season: LeagueSeasonSummary
    category: LeagueStatsCategory
    entries: LeaguePlayerLeaderboardEntry[]
    generatedAt?: string
  }) => void
  ensureRealtime: () => void
  openTeamView: (clubId: number) => void
  closeTeamView: () => void
  setTeamSubTab: (tab: TeamSubTab) => void
  fetchClubSummary: (clubId: number, options?: { force?: boolean }) => Promise<FetchResult>
  applyRealtimeClubSummary: (summary: ClubSummaryResponse) => void
  ensureTeamRealtime: () => void
}

const orderSeasons = (items: LeagueSeasonSummary[]) =>
  [...items].sort((left, right) => right.startDate.localeCompare(left.startDate))

const resolveSeasonId = (state: AppState, override?: number) =>
  override ?? state.selectedSeasonId ?? state.activeSeasonId

const isRoundCollection = (payload: unknown): payload is LeagueRoundCollection => {
  if (!payload || typeof payload !== 'object') {
    return false
  }
  const season = (payload as { season?: unknown }).season
  if (!season || typeof season !== 'object' || !(season as { id?: unknown }).id) {
    return false
  }
  return Array.isArray((payload as { rounds?: unknown }).rounds)
}

const isTableResponse = (payload: unknown): payload is LeagueTableResponse => {
  if (!payload || typeof payload !== 'object') {
    return false
  }
  const season = (payload as { season?: unknown }).season
  if (!season || typeof season !== 'object' || !(season as { id?: unknown }).id) {
    return false
  }
  return Array.isArray((payload as { standings?: unknown }).standings)
}

const isLeagueSeasonSummary = (value: unknown): value is LeagueSeasonSummary => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const season = value as LeagueSeasonSummary
  const competition = (season as { competition?: unknown }).competition
  const city = (season as { city?: unknown }).city
  return (
    typeof season.id === 'number' &&
    typeof season.name === 'string' &&
    typeof season.startDate === 'string' &&
    typeof season.endDate === 'string' &&
    typeof season.isActive === 'boolean' &&
    (city === undefined || city === null || typeof city === 'string') &&
    !!competition &&
    typeof (competition as { id?: unknown }).id === 'number'
  )
}

const isLeaderboardEntry = (value: unknown): value is LeaguePlayerLeaderboardEntry => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const entry = value as LeaguePlayerLeaderboardEntry
  return (
    typeof entry.personId === 'number' &&
    typeof entry.firstName === 'string' &&
    typeof entry.lastName === 'string' &&
    typeof entry.clubId === 'number' &&
    typeof entry.clubName === 'string' &&
    typeof entry.clubShortName === 'string' &&
    (entry.clubLogoUrl === null || typeof entry.clubLogoUrl === 'string') &&
    typeof entry.matchesPlayed === 'number' &&
    typeof entry.goals === 'number' &&
    typeof entry.assists === 'number' &&
    typeof entry.penaltyGoals === 'number'
  )
}

const isStatsPayload = (payload: unknown): payload is {
  season: LeagueSeasonSummary
  generatedAt?: string
  entries: LeaguePlayerLeaderboardEntry[]
} => {
  if (!payload || typeof payload !== 'object') {
    return false
  }
  const candidate = payload as {
    season?: unknown
    generatedAt?: unknown
    entries?: unknown
  }
  if (!isLeagueSeasonSummary(candidate.season)) {
    return false
  }
  if (candidate.generatedAt !== undefined && typeof candidate.generatedAt !== 'string') {
    return false
  }
  if (!Array.isArray(candidate.entries)) {
    return false
  }
  return candidate.entries.every(isLeaderboardEntry)
}

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

const emptyLeaderboards = (): LeagueStatsResponse['leaderboards'] => ({
  goalContribution: [],
  scorers: [],
  assists: [],
})

export const useAppStore = create<AppState>((set, get) => ({
  currentTab: 'home',
  leagueSubTab: 'table',
  leagueMenuOpen: false,
  seasons: [],
  seasonsVersion: undefined,
  seasonsFetchedAt: 0,
  tables: {},
  tableVersions: {},
  tableFetchedAt: {},
  schedules: {},
  scheduleVersions: {},
  scheduleFetchedAt: {},
  results: {},
  resultsVersions: {},
  resultsFetchedAt: {},
  stats: {},
  statsVersions: {},
  statsFetchedAt: {},
  selectedSeasonId: undefined,
  activeSeasonId: undefined,
  loading: { seasons: false, table: false, schedule: false, results: false, stats: false },
  errors: {},
  lastLeagueTapAt: 0,
  realtimeAttached: false,
  teamView: { ...INITIAL_TEAM_VIEW },
  teamSummaries: {},
  teamSummaryFetchedAt: {},
  teamSummaryLoadingId: null,
  teamSummaryErrors: {},
  teamRealtimeAttached: false,
  teamRealtimeClubId: undefined,
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
    const response = await leagueApi.fetchSeasons()
    if (!response.ok) {
      set(prev => ({
        loading: { ...prev.loading, seasons: false },
        errors: { ...prev.errors, seasons: response.error },
      }))
      return { ok: false }
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
      void get().fetchLeagueSchedule({ seasonId: nextSelected })
      void get().fetchLeagueResults({ seasonId: nextSelected })
      void get().fetchLeagueStats({ seasonId: nextSelected })
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
    const response = await leagueApi.fetchTable(seasonId)
    if (!response.ok) {
      set(prev => ({
        loading: { ...prev.loading, table: false },
        errors: { ...prev.errors, table: response.error },
      }))
      return { ok: false }
    }
    set(prev => ({
      tables: { ...prev.tables, [seasonId]: response.data },
      tableVersions: { ...prev.tableVersions, [seasonId]: response.version },
      tableFetchedAt: { ...prev.tableFetchedAt, [seasonId]: now },
      loading: { ...prev.loading, table: false },
      activeSeasonId: response.data.season.isActive ? response.data.season.id : prev.activeSeasonId,
    }))
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
    const response = await leagueApi.fetchSchedule(seasonId)
    if (!response.ok) {
      set(prev => ({
        loading: { ...prev.loading, schedule: false },
        errors: { ...prev.errors, schedule: response.error },
      }))
      return { ok: false }
    }
    set(prev => ({
      schedules: { ...prev.schedules, [seasonId]: response.data },
      scheduleVersions: { ...prev.scheduleVersions, [seasonId]: response.version },
      scheduleFetchedAt: { ...prev.scheduleFetchedAt, [seasonId]: now },
      loading: { ...prev.loading, schedule: false },
      activeSeasonId: response.data.season.isActive ? response.data.season.id : prev.activeSeasonId,
    }))
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
    const response = await leagueApi.fetchResults(seasonId)
    if (!response.ok) {
      set(prev => ({
        loading: { ...prev.loading, results: false },
        errors: { ...prev.errors, results: response.error },
      }))
      return { ok: false }
    }
    set(prev => ({
      results: { ...prev.results, [seasonId]: response.data },
      resultsVersions: { ...prev.resultsVersions, [seasonId]: response.version },
      resultsFetchedAt: { ...prev.resultsFetchedAt, [seasonId]: now },
      loading: { ...prev.loading, results: false },
      activeSeasonId: response.data.season.isActive ? response.data.season.id : prev.activeSeasonId,
    }))
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
    const response = await leagueApi.fetchStats(seasonId)
    if (!response.ok) {
      set(prev => ({
        loading: { ...prev.loading, stats: false },
        errors: { ...prev.errors, stats: response.error },
      }))
      return { ok: false }
    }
    set(prev => ({
      stats: { ...prev.stats, [seasonId]: response.data },
      statsVersions: { ...prev.statsVersions, [seasonId]: response.version },
      statsFetchedAt: { ...prev.statsFetchedAt, [seasonId]: now },
      loading: { ...prev.loading, stats: false },
      activeSeasonId: response.data.season.isActive ? response.data.season.id : prev.activeSeasonId,
    }))
    return { ok: true }
  },
  applyRealtimeTable: table => {
    const seasonId = table.season.id
    set(prev => ({
      tables: { ...prev.tables, [seasonId]: table },
      tableVersions: { ...prev.tableVersions, [seasonId]: undefined },
      tableFetchedAt: { ...prev.tableFetchedAt, [seasonId]: Date.now() },
      activeSeasonId: table.season.isActive ? seasonId : prev.activeSeasonId,
    }))
  },
  applyRealtimeSchedule: collection => {
    const seasonId = collection.season.id
    set(prev => ({
      schedules: { ...prev.schedules, [seasonId]: collection },
      scheduleVersions: { ...prev.scheduleVersions, [seasonId]: undefined },
      scheduleFetchedAt: { ...prev.scheduleFetchedAt, [seasonId]: Date.now() },
      activeSeasonId: collection.season.isActive ? seasonId : prev.activeSeasonId,
    }))
  },
  applyRealtimeResults: collection => {
    const seasonId = collection.season.id
    set(prev => ({
      results: { ...prev.results, [seasonId]: collection },
      resultsVersions: { ...prev.resultsVersions, [seasonId]: undefined },
      resultsFetchedAt: { ...prev.resultsFetchedAt, [seasonId]: Date.now() },
      activeSeasonId: collection.season.isActive ? seasonId : prev.activeSeasonId,
    }))
  },
  applyRealtimeStats: ({ season, category, entries, generatedAt }) => {
    const seasonId = season.id
    set(prev => {
      const existing = prev.stats[seasonId]
      const leaderboards = existing ? { ...existing.leaderboards } : emptyLeaderboards()
      leaderboards[category] = entries
      const nextSnapshot: LeagueStatsResponse = {
        season,
        generatedAt: generatedAt ?? existing?.generatedAt ?? new Date().toISOString(),
        leaderboards,
      }
      return {
        stats: { ...prev.stats, [seasonId]: nextSnapshot },
        statsVersions: { ...prev.statsVersions, [seasonId]: undefined },
        statsFetchedAt: { ...prev.statsFetchedAt, [seasonId]: Date.now() },
        activeSeasonId: season.isActive ? seasonId : prev.activeSeasonId,
      }
    })
  },
  ensureRealtime: () => {
    const state = get()
    if (state.realtimeAttached) {
      return
    }

    const unsubTable = wsClient.on('league.table', message => {
      if (!isTableResponse(message.payload)) {
        return
      }
      get().applyRealtimeTable(message.payload)
    })

    const unsubSchedule = wsClient.on('league.schedule', message => {
      if (!isRoundCollection(message.payload)) {
        return
      }
      get().applyRealtimeSchedule(message.payload)
    })

    const unsubResults = wsClient.on('league.results', message => {
      if (!isRoundCollection(message.payload)) {
        return
      }
      get().applyRealtimeResults(message.payload)
    })

    const unsubGoalContribution = wsClient.on('league.goalContribution', message => {
      if (!isStatsPayload(message.payload)) {
        return
      }
      get().applyRealtimeStats({
        season: message.payload.season,
        category: 'goalContribution',
        entries: message.payload.entries,
        generatedAt: message.payload.generatedAt,
      })
    })

    const unsubScorers = wsClient.on('league.scorers', message => {
      if (!isStatsPayload(message.payload)) {
        return
      }
      get().applyRealtimeStats({
        season: message.payload.season,
        category: 'scorers',
        entries: message.payload.entries,
        generatedAt: message.payload.generatedAt,
      })
    })

    const unsubAssists = wsClient.on('league.assists', message => {
      if (!isStatsPayload(message.payload)) {
        return
      }
      get().applyRealtimeStats({
        season: message.payload.season,
        category: 'assists',
        entries: message.payload.entries,
        generatedAt: message.payload.generatedAt,
      })
    })

    wsClient.subscribe('public:league:table')
    wsClient.subscribe('public:league:schedule')
    wsClient.subscribe('public:league:results')
    wsClient.subscribe('public:league:goal-contributors')
    wsClient.subscribe('public:league:top-scorers')
    wsClient.subscribe('public:league:top-assists')

    if (typeof window !== 'undefined') {
      window.addEventListener(
        'beforeunload',
        () => {
          unsubTable()
          unsubSchedule()
          unsubResults()
          unsubGoalContribution()
          unsubScorers()
          unsubAssists()
          wsClient.unsubscribe('public:league:table')
          wsClient.unsubscribe('public:league:schedule')
          wsClient.unsubscribe('public:league:results')
          wsClient.unsubscribe('public:league:goal-contributors')
          wsClient.unsubscribe('public:league:top-scorers')
          wsClient.unsubscribe('public:league:top-assists')
        },
        { once: true }
      )
    }

    set({ realtimeAttached: true })
  },
  openTeamView: clubId => {
    set(prev => ({
      teamView: {
        open: true,
        clubId,
        activeTab: prev.teamView.clubId === clubId ? prev.teamView.activeTab : 'overview',
      },
      teamSummaryErrors: { ...prev.teamSummaryErrors, [clubId]: undefined },
    }))
    get().ensureTeamRealtime()
    void get().fetchClubSummary(clubId)
  },
  closeTeamView: () => {
    const state = get()
    detachTeamRealtime()
    const shouldClearLoading =
      state.teamSummaryLoadingId !== null && state.teamSummaryLoadingId === state.teamView.clubId
    set(prev => ({
      teamView: { ...INITIAL_TEAM_VIEW },
      teamRealtimeAttached: false,
      teamRealtimeClubId: undefined,
      teamSummaryLoadingId: shouldClearLoading ? null : prev.teamSummaryLoadingId,
    }))
  },
  setTeamSubTab: tab => {
    set(prev => ({
      teamView: prev.teamView.open ? { ...prev.teamView, activeTab: tab } : prev.teamView,
    }))
  },
  fetchClubSummary: async (clubId, options) => {
    const state = get()
    const now = Date.now()
    const lastFetched = state.teamSummaryFetchedAt[clubId] ?? 0
    const hasFreshData = now - lastFetched < CLUB_SUMMARY_TTL_MS
    if (!options?.force && state.teamSummaries[clubId] && hasFreshData) {
      get().ensureTeamRealtime()
      return { ok: true }
    }
    if (state.teamSummaryLoadingId === clubId && !options?.force) {
      return { ok: true }
    }
    set(prev => ({
      teamSummaryLoadingId: clubId,
      teamSummaryErrors: { ...prev.teamSummaryErrors, [clubId]: undefined },
    }))

    const response = await clubApi.fetchSummary(clubId)
    if (!response.ok) {
      set(prev => ({
        teamSummaryLoadingId:
          prev.teamSummaryLoadingId === clubId ? null : prev.teamSummaryLoadingId,
        teamSummaryErrors: { ...prev.teamSummaryErrors, [clubId]: response.error },
      }))
      return { ok: false }
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
    set(prev => ({
      teamSummaries: { ...prev.teamSummaries, [clubId]: payload },
      teamSummaryFetchedAt: { ...prev.teamSummaryFetchedAt, [clubId]: fetchedAt },
      teamSummaryLoadingId: prev.teamSummaryLoadingId === clubId ? null : prev.teamSummaryLoadingId,
      teamSummaryErrors: { ...prev.teamSummaryErrors, [clubId]: undefined },
    }))
    get().ensureTeamRealtime()
    return { ok: true }
  },
  applyRealtimeClubSummary: summary => {
    const clubId = summary.club.id
    set(prev => ({
      teamSummaries: { ...prev.teamSummaries, [clubId]: summary },
      teamSummaryFetchedAt: { ...prev.teamSummaryFetchedAt, [clubId]: Date.now() },
      teamSummaryErrors: { ...prev.teamSummaryErrors, [clubId]: undefined },
    }))
  },
  ensureTeamRealtime: () => {
    const state = get()
    const clubId = state.teamView.clubId
    if (!clubId) {
      return
    }
    if (state.teamRealtimeAttached && state.teamRealtimeClubId === clubId) {
      return
    }

    detachTeamRealtime()

    const topic = clubSummaryTopic(clubId)
    const unsubscribe = wsClient.on('club.summary', message => {
      if (typeof message.clubId !== 'number' || message.clubId !== clubId) {
        return
      }
      if (!isClubSummaryResponsePayload(message.payload)) {
        return
      }
      get().applyRealtimeClubSummary(message.payload)
    })
    teamRealtimeCleanup = () => {
      unsubscribe()
      teamRealtimeCleanup = null
    }
    teamRealtimeTopic = topic
    wsClient.subscribe(topic)

    if (!teamRealtimeUnloadRegistered && typeof window !== 'undefined') {
      window.addEventListener(
        'beforeunload',
        () => {
          detachTeamRealtime()
        },
        { once: true }
      )
      teamRealtimeUnloadRegistered = true
    }

    set({ teamRealtimeAttached: true, teamRealtimeClubId: clubId })
  },
}))

