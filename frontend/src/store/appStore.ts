import { create } from 'zustand'
import type {
  LeagueRoundCollection,
  LeagueSeasonSummary,
  LeagueTableResponse,
  LeagueStatsResponse,
  LeagueStatsCategory,
  LeaguePlayerLeaderboardEntry,
} from '@shared/types'
import { leagueApi } from '../api/leagueApi'
import { wsClient } from '../wsClient'

export type UITab = 'home' | 'league' | 'predictions' | 'leaderboard' | 'shop' | 'profile'
export type LeagueSubTab = 'table' | 'schedule' | 'results' | 'stats'

const SEASONS_TTL_MS = 55_000
const TABLE_TTL_MS = 240_000
const SCHEDULE_TTL_MS = 7_500
const RESULTS_TTL_MS = 14_000
const STATS_TTL_MS = 300_000
const DOUBLE_TAP_THRESHOLD_MS = 280

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
  return (
    typeof season.id === 'number' &&
    typeof season.name === 'string' &&
    typeof season.startDate === 'string' &&
    typeof season.endDate === 'string' &&
    typeof season.isActive === 'boolean' &&
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
}))

