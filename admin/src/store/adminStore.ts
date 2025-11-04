import { create } from 'zustand'
import {
  adminGet,
  adminLogin,
  adminRequestWithMeta,
  adminPatch,
  AdminApiError,
  lineupLogin,
  translateAdminError,
  adminDelete,
  adminFetchAds,
  adminFetchRatingSettings,
  adminUpdateRatingSettings,
  adminRecalculateRatings,
  adminFetchRatingLeaderboard,
} from '../api/adminClient'
import { assistantLogin } from '../api/assistantClient'
import { judgeLogin } from '../api/judgeClient'
import type { AdBanner, NewsItem } from '@shared/types'
import { wsClient } from '../wsClient'
import type { WsMessage, WsPatchMessage } from '../wsClient'
import {
  AchievementType,
  AppUser,
  Club,
  ClubSeasonStats,
  ClubCareerTotals,
  Competition,
  Disqualification,
  FriendlyMatch,
  MatchSeries,
  MatchSummary,
  Person,
  PlayerCareerStats,
  PlayerSeasonStats,
  Prediction,
  Season,
  Stadium,
  UserAchievement,
  AdminPredictionMatch,
  PredictionTemplateOverrideResponse,
  AdminRatingSettingsSummary,
  AdminRatingLeaderboardResponse,
  AdminRatingSettingsInput,
} from '../types'
import { useAssistantStore } from './assistantStore'

export type AdminTab =
  | 'teams'
  | 'matches'
  | 'stats'
  | 'players'
  | 'news'
  | 'users'
  | 'predictions'
  | 'ratings'

const storageKey = 'obnliga-admin-token'
const lineupStorageKey = 'obnliga-lineup-token'
const judgeStorageKey = 'obnliga-judge-token'
const assistantStorageKey = 'obnliga-assistant-token'
const ADMIN_NEWS_TOPIC = 'home'
const ADMIN_PREDICTIONS_TOPIC = 'admin.predictions'

const readPersistedToken = () => {
  if (typeof window === 'undefined') return undefined
  try {
    const stored = window.localStorage.getItem(storageKey)
    return stored ?? undefined
  } catch (err) {
    console.warn('admin store: failed to read token from storage', err)
    return undefined
  }
}

const readPersistedLineupToken = () => {
  if (typeof window === 'undefined') return undefined
  try {
    const stored = window.localStorage.getItem(lineupStorageKey)
    return stored ?? undefined
  } catch (err) {
    console.warn('admin store: failed to read lineup token', err)
    return undefined
  }
}

const readPersistedJudgeToken = () => {
  if (typeof window === 'undefined') return undefined
  try {
    const stored = window.localStorage.getItem(judgeStorageKey)
    return stored ?? undefined
  } catch (err) {
    console.warn('admin store: failed to read judge token', err)
    return undefined
  }
}

const readPersistedAssistantToken = () => {
  if (typeof window === 'undefined') return undefined
  try {
    const stored = window.localStorage.getItem(assistantStorageKey)
    return stored ?? undefined
  } catch (err) {
    console.warn('admin store: failed to read assistant token', err)
    return undefined
  }
}

const initialAdminToken = readPersistedToken()
const initialLineupToken = readPersistedLineupToken()
const initialJudgeToken = readPersistedJudgeToken()
const initialAssistantToken = readPersistedAssistantToken()

type AuthMode = 'admin' | 'lineup' | 'judge' | 'assistant'

const initialMode: AuthMode | undefined = initialAdminToken
  ? 'admin'
  : initialJudgeToken
    ? 'judge'
    : initialAssistantToken
      ? 'assistant'
      : initialLineupToken
        ? 'lineup'
        : undefined

const initialStatus: AdminState['status'] = initialMode ? 'authenticated' : 'idle'

interface AdminData {
  clubs: Club[]
  persons: Person[]
  stadiums: Stadium[]
  competitions: Competition[]
  seasons: Season[]
  series: MatchSeries[]
  matches: MatchSummary[]
  friendlyMatches: FriendlyMatch[]
  clubStats: ClubSeasonStats[]
  playerStats: PlayerSeasonStats[]
  careerStats: PlayerCareerStats[]
  clubCareerTotals: ClubCareerTotals[]
  users: AppUser[]
  predictions: Prediction[]
  achievementTypes: AchievementType[]
  userAchievements: UserAchievement[]
  disqualifications: Disqualification[]
  news: NewsItem[]
  ads: AdBanner[]
  predictionMatches: AdminPredictionMatch[]
  ratingSettings?: AdminRatingSettingsSummary
  ratingLeaderboard?: AdminRatingLeaderboardResponse
}

interface AdminState {
  status: 'idle' | 'authenticating' | 'authenticated' | 'error'
  mode?: AuthMode
  token?: string
  lineupToken?: string
  judgeToken?: string
  assistantToken?: string
  error?: string
  activeTab: AdminTab
  ratingScope: 'current' | 'yearly'
  ratingPage: number
  ratingPageSize: number
  selectedCompetitionId?: number
  selectedSeasonId?: number
  newsVersion?: number
  data: AdminData
  loading: Record<string, boolean>
  login(login: string, password: string): Promise<void>
  logout(): void
  setTab(tab: AdminTab): void
  clearError(): void
  setSelectedCompetition(competitionId?: number): void
  setSelectedSeason(seasonId?: number): void
  activateSeason(seasonId: number): Promise<void>
  deleteSeason(seasonId: number): Promise<void>
  fetchDictionaries(options?: FetchOptions): Promise<void>
  fetchSeasons(options?: FetchOptions): Promise<void>
  fetchSeries(seasonId?: number, options?: FetchOptions): Promise<void>
  fetchMatches(seasonId?: number, options?: FetchOptions): Promise<void>
  fetchFriendlyMatches(): Promise<void>
  fetchStats(seasonId?: number, competitionId?: number): Promise<void>
  fetchUsers(): Promise<void>
  fetchPredictions(): Promise<void>
  fetchPredictionMatches(options?: FetchOptions & { seasonId?: number }): Promise<void>
  fetchAchievements(): Promise<void>
  fetchDisqualifications(): Promise<void>
  fetchNews(options?: FetchOptions): Promise<void>
  fetchRatingSettings(options?: FetchOptions): Promise<void>
  fetchRatingLeaderboard(options?: FetchOptions & { scope?: 'current' | 'yearly'; page?: number; pageSize?: number }): Promise<void>
  prependNews(item: NewsItem): void
  updateNews(item: NewsItem): void
  removeNews(id: string): void
  fetchAds(options?: FetchOptions): Promise<void>
  upsertAd(item: AdBanner): void
  removeAd(id: string): void
  setRatingScope(scope: 'current' | 'yearly'): Promise<void>
  setRatingPagination(page: number, pageSize?: number): Promise<void>
  updateRatingSettings(
    input: AdminRatingSettingsInput
  ): Promise<{ summary: AdminRatingSettingsSummary; meta?: { recalculated?: boolean; affectedUsers?: number } }>
  recalculateRatings(
    userIds?: number[]
  ): Promise<{ summary: AdminRatingSettingsSummary; meta?: { partial?: boolean; affectedUsers: number } }>
  refreshTab(tab?: AdminTab): Promise<void>
  setPredictionTemplateAuto(matchId: string): Promise<PredictionTemplateOverrideResponse>
  setPredictionTemplateManual(
    matchId: string,
    input: PredictionTemplateManualInput
  ): Promise<PredictionTemplateOverrideResponse>
}

type Setter = (
  partial: Partial<AdminState> | ((state: AdminState) => Partial<AdminState>),
  replace?: boolean
) => void
type Getter = () => AdminState

type FetchKey =
  | 'dictionaries'
  | 'seasons'
  | 'series'
  | 'matches'
  | 'friendlyMatches'
  | 'stats'
  | 'users'
  | 'predictions'
  | 'predictionMatches'
  | 'achievements'
  | 'disqualifications'
  | 'news'
  | 'ads'
  | 'ratingSettings'
  | 'ratingLeaderboard'

type FetchOptions = {
  force?: boolean
}

export type PredictionTemplateManualInput = {
  line: number
  basePoints?: number
  difficultyMultiplier?: number
}

const FETCH_TTL: Record<FetchKey, number> = {
  dictionaries: 60_000,
  seasons: 30_000,
  series: 15_000,
  matches: 10_000,
  friendlyMatches: 45_000,
  stats: 20_000,
  users: 60_000,
  predictions: 60_000,
  predictionMatches: 20_000,
  achievements: 120_000,
  disqualifications: 30_000,
  news: 60_000,
  ads: 60_000,
  ratingSettings: 60_000,
  ratingLeaderboard: 30_000,
}

const DEFAULT_RATING_PAGE_SIZE = 25

const createEmptyData = (): AdminData => ({
  clubs: [],
  persons: [],
  stadiums: [],
  competitions: [],
  seasons: [],
  series: [],
  matches: [],
  friendlyMatches: [],
  clubStats: [],
  playerStats: [],
  careerStats: [],
  clubCareerTotals: [],
  users: [],
  predictions: [],
  achievementTypes: [],
  userAchievements: [],
  disqualifications: [],
  news: [],
  ads: [],
  predictionMatches: [],
  ratingSettings: undefined,
  ratingLeaderboard: undefined,
})

const adminStoreCreator = (set: Setter, get: Getter): AdminState => {
  const fetchTimestamps: Record<string, number> = {}
  const fetchPromises: Record<string, Promise<void> | undefined> = {}

  const composeCacheKey = (scope: FetchKey, parts: Array<string | number | undefined>) => {
    const extras = parts
      .filter(part => part !== undefined && part !== null && part !== '')
      .map(part => (typeof part === 'number' ? part.toString() : String(part)))
    return [scope, ...extras].join('|')
  }

  const resetFetchCache = () => {
    for (const key of Object.keys(fetchTimestamps)) {
      delete fetchTimestamps[key]
    }
  }

  const mapAuthError = (value: string) => {
    if (value?.toLowerCase().includes('fetch')) {
      return 'Нет соединения с сервером. Проверьте подключение.'
    }
    return translateAdminError(value)
  }

  const sortAdsList = (items: AdBanner[]): AdBanner[] =>
    [...items].sort((left, right) => {
      if (left.displayOrder !== right.displayOrder) {
        return left.displayOrder - right.displayOrder
      }
      if (left.updatedAt !== right.updatedAt) {
        return right.updatedAt.localeCompare(left.updatedAt)
      }
      return right.id.localeCompare(left.id)
    })

  const run = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    set(state => ({
      loading: { ...state.loading, [key]: true },
      error: undefined,
    }))
    try {
      const result = await fn()
      set(state => ({ loading: { ...state.loading, [key]: false } }))
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'request_failed'
      set(state => ({
        loading: { ...state.loading, [key]: false },
        error: message,
      }))
      throw err
    }
  }

  const runCachedFetch = async (
    scope: FetchKey,
    parts: Array<string | number | undefined>,
    fetcher: () => Promise<void>,
    ttlOverride?: number
  ) => {
    const cacheKey = composeCacheKey(scope, parts)
    const ttl = ttlOverride ?? FETCH_TTL[scope]
    const last = fetchTimestamps[cacheKey]
    if (ttl > 0 && last && Date.now() - last < ttl) {
      return
    }

    const existing = fetchPromises[cacheKey]
    if (existing) {
      await existing
      return
    }

    const task = (async () => {
      try {
        await run(scope, fetcher)
        fetchTimestamps[cacheKey] = Date.now()
      } finally {
        fetchPromises[cacheKey] = undefined
      }
    })()

    fetchPromises[cacheKey] = task
    await task
  }

  const ensureToken = (): string => {
    const token = get().token
    if (!token) {
      throw new Error('missing_token')
    }
    return token
  }

  let realtimeListenerAttached = false

  const isPatchMessage = (message: WsMessage): message is WsPatchMessage<unknown> =>
    message.type === 'patch'

  const handleAdminPatch = (message: WsMessage) => {
    if (!isPatchMessage(message)) return
    if (get().mode !== 'admin') return

    const payload = message.payload
    if (!payload || typeof payload !== 'object') {
      return
    }

    const patch = payload as { type?: unknown; payload?: unknown }
    const patchType = typeof patch.type === 'string' ? patch.type : undefined

    if (message.topic === ADMIN_NEWS_TOPIC) {
      if (patchType === 'news.full') {
        const rawNews = patch.payload
        if (!rawNews || typeof rawNews !== 'object') {
          return
        }
        const news = rawNews as NewsItem
        const cacheKey = composeCacheKey('news', [])
        fetchTimestamps[cacheKey] = Date.now()
        const current = get().data.news
        const existingIndex = current.findIndex(entry => entry.id === news.id)
        if (existingIndex >= 0) {
          set(state => {
            const nextNews = state.data.news.slice()
            nextNews[existingIndex] = news
            return {
              data: {
                ...state.data,
                news: nextNews,
              },
            }
          })
        } else {
          set(state => ({
            data: {
              ...state.data,
              news: [news, ...state.data.news],
            },
          }))
        }
        return
      }

      if (patchType === 'news.remove') {
        const rawPayload = patch.payload as { id?: string | number } | undefined
        const rawId = rawPayload?.id
        if (rawId === undefined || rawId === null) {
          return
        }
        const id = typeof rawId === 'string' ? rawId : rawId.toString()
        const current = get().data.news
        if (!current.some(entry => entry.id === id)) {
          return
        }
        const cacheKey = composeCacheKey('news', [])
        fetchTimestamps[cacheKey] = Date.now()
        set(state => ({
          data: {
            ...state.data,
            news: state.data.news.filter(entry => entry.id !== id),
          },
        }))
        return
      }

      if (patchType === 'ads.full') {
        const rawAd = patch.payload
        if (!rawAd || typeof rawAd !== 'object') {
          return
        }
        const ad = rawAd as AdBanner
        const cacheKey = composeCacheKey('ads', [])
        fetchTimestamps[cacheKey] = Date.now()
        set(state => {
          const nextAds = state.data.ads.filter(entry => entry.id !== ad.id)
          nextAds.push(ad)
          return {
            data: {
              ...state.data,
              ads: sortAdsList(nextAds),
            },
          }
        })
        return
      }

      if (patchType === 'ads.remove') {
        const rawPayload = patch.payload as { id?: string | number } | undefined
        const rawId = rawPayload?.id
        if (rawId === undefined || rawId === null) {
          return
        }
        const id = typeof rawId === 'string' ? rawId : rawId.toString()
        const cacheKey = composeCacheKey('ads', [])
        fetchTimestamps[cacheKey] = Date.now()
        set(state => ({
          data: {
            ...state.data,
            ads: state.data.ads.filter(entry => entry.id !== id),
          },
        }))
      }
      return
    }

    if (message.topic === ADMIN_PREDICTIONS_TOPIC) {
      if (patchType === 'prediction.template.override') {
        const rawPayload = patch.payload as
          | { matchId?: string; override?: PredictionTemplateOverrideResponse }
          | undefined
        const matchId = rawPayload?.matchId
        const override = rawPayload?.override
        if (!matchId || !override) {
          return
        }
        const applied = applyPredictionTemplateOverride(matchId, override)
        if (!applied) {
          void get().fetchPredictionMatches({ force: true }).catch(() => undefined)
        }
      }
    }

    if (patchType === 'news.full') {
      const rawNews = patch.payload
      if (!rawNews || typeof rawNews !== 'object') {
        return
      }
      const news = rawNews as NewsItem
      const cacheKey = composeCacheKey('news', [])
      fetchTimestamps[cacheKey] = Date.now()
      const current = get().data.news
      const existingIndex = current.findIndex(entry => entry.id === news.id)
      if (existingIndex >= 0) {
        set(state => {
          const nextNews = state.data.news.slice()
          nextNews[existingIndex] = news
          return {
            data: {
              ...state.data,
              news: nextNews,
            },
          }
        })
      } else {
        set(state => ({
          data: {
            ...state.data,
            news: [news, ...state.data.news],
          },
        }))
      }
      return
    }

    if (patchType === 'news.remove') {
      const rawPayload = patch.payload as { id?: string | number } | undefined
      const rawId = rawPayload?.id
      if (rawId === undefined || rawId === null) {
        return
      }
      const id = typeof rawId === 'string' ? rawId : rawId.toString()
      const current = get().data.news
      if (!current.some(entry => entry.id === id)) {
        return
      }
      const cacheKey = composeCacheKey('news', [])
      fetchTimestamps[cacheKey] = Date.now()
      set(state => ({
        data: {
          ...state.data,
          news: state.data.news.filter(entry => entry.id !== id),
        },
      }))
      return
    }

    if (patchType === 'ads.full') {
      const rawAd = patch.payload
      if (!rawAd || typeof rawAd !== 'object') {
        return
      }
      const ad = rawAd as AdBanner
      const cacheKey = composeCacheKey('ads', [])
      fetchTimestamps[cacheKey] = Date.now()
      set(state => {
        const nextAds = state.data.ads.filter(entry => entry.id !== ad.id)
        nextAds.push(ad)
        return {
          data: {
            ...state.data,
            ads: sortAdsList(nextAds),
          },
        }
      })
      return
    }

    if (patchType === 'ads.remove') {
      const rawPayload = patch.payload as { id?: string | number } | undefined
      const rawId = rawPayload?.id
      if (rawId === undefined || rawId === null) {
        return
      }
      const id = typeof rawId === 'string' ? rawId : rawId.toString()
      const cacheKey = composeCacheKey('ads', [])
      fetchTimestamps[cacheKey] = Date.now()
      set(state => ({
        data: {
          ...state.data,
          ads: state.data.ads.filter(entry => entry.id !== id),
        },
      }))
    }
  }

  const attachRealtimeListener = () => {
    if (realtimeListenerAttached || typeof window === 'undefined') {
      return
    }
    wsClient.on('patch', handleAdminPatch)
    realtimeListenerAttached = true
  }

  const ensureAdminRealtime = (token?: string) => {
    if (typeof window === 'undefined' || !token) {
      return
    }
    attachRealtimeListener()
    wsClient.setToken(token)
    wsClient.connect(token)
    wsClient.subscribe(ADMIN_NEWS_TOPIC)
    wsClient.subscribe(ADMIN_PREDICTIONS_TOPIC)
  }

  const releaseAdminRealtime = () => {
    if (typeof window === 'undefined') {
      return
    }
    wsClient.unsubscribe(ADMIN_PREDICTIONS_TOPIC)
    wsClient.unsubscribe(ADMIN_NEWS_TOPIC)
    wsClient.setToken(undefined)
  }

  const applyPredictionTemplateOverride = (
    matchId: string,
    override: PredictionTemplateOverrideResponse
  ): boolean => {
    const normalizedMatchId = matchId.toString()
    const targetMarket = override.template?.marketType ?? 'TOTAL_GOALS'
    const activeSeasonId = get().selectedSeasonId
    const cacheKey = composeCacheKey('predictionMatches', [
      activeSeasonId ? `season:${activeSeasonId}` : undefined,
    ])
    fetchTimestamps[cacheKey] = Date.now()

    let applied = false
    set(state => {
      const matches = state.data.predictionMatches
      const matchIndex = matches.findIndex(entry => entry.matchId === normalizedMatchId)
      if (matchIndex === -1) {
        return {}
      }

      const current = matches[matchIndex]
      const filteredTemplates = targetMarket
        ? current.templates.filter(template => template.marketType !== targetMarket)
        : current.templates.slice()

      const nextTemplates =
        override.template && targetMarket
          ? [...filteredTemplates, override.template]
          : filteredTemplates

      const nextMatches = matches.slice()
      nextMatches[matchIndex] = {
        ...current,
        templates: nextTemplates,
        suggestion: override.suggestion ?? null,
      }

      applied = true
      return {
        data: {
          ...state.data,
          predictionMatches: nextMatches,
        },
      }
    })

    return applied
  }

  const store: AdminState = {
    status: initialStatus,
    mode: initialMode,
    token: initialMode === 'admin' ? initialAdminToken : undefined,
    lineupToken: initialMode === 'lineup' ? initialLineupToken : undefined,
    judgeToken: initialMode === 'judge' ? initialJudgeToken : undefined,
    assistantToken: initialMode === 'assistant' ? initialAssistantToken : undefined,
    error: undefined,
    activeTab: 'teams',
  ratingScope: 'current',
  ratingPage: 1,
  ratingPageSize: DEFAULT_RATING_PAGE_SIZE,
    selectedCompetitionId: undefined,
    selectedSeasonId: undefined,
    newsVersion: undefined,
    data: createEmptyData(),
    loading: {},
    async login(login: string, password: string) {
      set({ status: 'authenticating', error: undefined })
      releaseAdminRealtime()
      try {
        const adminResult = await adminLogin(login, password)

        if (adminResult.ok) {
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(storageKey, adminResult.token)
            window.localStorage.removeItem(lineupStorageKey)
            window.localStorage.removeItem(judgeStorageKey)
            window.localStorage.removeItem(assistantStorageKey)
          }
          resetFetchCache()
          set({
            status: 'authenticated',
            mode: 'admin',
            token: adminResult.token,
            lineupToken: undefined,
            judgeToken: undefined,
            assistantToken: undefined,
            error: undefined,
          })
          useAssistantStore.getState().reset()
          ensureAdminRealtime(adminResult.token)
          try {
            await Promise.all([get().fetchDictionaries(), get().fetchSeasons()])
          } catch (err) {
            // Ошибка загрузки данных отображается через store.error
          }
          return
        }

        const adminErrorCode = adminResult.errorCode ?? 'invalid_credentials'
        if (adminErrorCode !== 'invalid_credentials') {
          throw new Error(adminResult.error ?? translateAdminError(adminErrorCode))
        }

        const judgeResult = await judgeLogin(login, password)
        if (judgeResult.ok && judgeResult.token) {
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(judgeStorageKey, judgeResult.token)
            window.localStorage.removeItem(storageKey)
            window.localStorage.removeItem(lineupStorageKey)
            window.localStorage.removeItem(assistantStorageKey)
          }

          resetFetchCache()
          set({
            status: 'authenticated',
            mode: 'judge',
            token: undefined,
            lineupToken: undefined,
            judgeToken: judgeResult.token,
            assistantToken: undefined,
            error: undefined,
            data: createEmptyData(),
            loading: {},
          })
          useAssistantStore.getState().reset()
          return
        }

        const judgeErrorCode = judgeResult.errorCode ?? 'invalid_credentials'
        if (judgeErrorCode !== 'invalid_credentials') {
          throw new Error(judgeResult.error ?? translateAdminError(judgeErrorCode))
        }

        const assistantResult = await assistantLogin(login, password)
        if (assistantResult.ok && assistantResult.token) {
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(assistantStorageKey, assistantResult.token)
            window.localStorage.removeItem(storageKey)
            window.localStorage.removeItem(lineupStorageKey)
            window.localStorage.removeItem(judgeStorageKey)
          }

          useAssistantStore.getState().setToken(assistantResult.token)
          resetFetchCache()
          set({
            status: 'authenticated',
            mode: 'assistant',
            token: undefined,
            lineupToken: undefined,
            judgeToken: undefined,
            assistantToken: assistantResult.token,
            error: undefined,
            data: createEmptyData(),
            loading: {},
          })
          return
        }

        const assistantErrorCode = assistantResult.errorCode ?? 'invalid_credentials'
        if (assistantErrorCode !== 'invalid_credentials') {
          throw new Error(assistantResult.error ?? translateAdminError(assistantErrorCode))
        }

        const lineupResult = await lineupLogin(login, password)
        if (!lineupResult.ok || !lineupResult.token) {
          const lineupErrorCode = lineupResult.errorCode ?? 'invalid_credentials'
          const lineupMessage = lineupResult.error ?? translateAdminError(lineupErrorCode)
          throw new Error(lineupMessage)
        }

        if (typeof window !== 'undefined') {
          window.localStorage.setItem(lineupStorageKey, lineupResult.token)
          window.localStorage.removeItem(storageKey)
          window.localStorage.removeItem(judgeStorageKey)
          window.localStorage.removeItem(assistantStorageKey)
        }

        useAssistantStore.getState().reset()
        resetFetchCache()
        set({
          status: 'authenticated',
          mode: 'lineup',
          token: undefined,
          lineupToken: lineupResult.token,
          judgeToken: undefined,
          assistantToken: undefined,
          error: undefined,
          data: createEmptyData(),
          loading: {},
        })
      } catch (err) {
        const rawMessage = err instanceof Error ? err.message : 'auth_failed'
        const message = mapAuthError(rawMessage)
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem(storageKey)
          window.localStorage.removeItem(lineupStorageKey)
          window.localStorage.removeItem(judgeStorageKey)
          window.localStorage.removeItem(assistantStorageKey)
        }
        useAssistantStore.getState().reset()
        set({
          status: 'error',
          mode: undefined,
          error: message,
          token: undefined,
          lineupToken: undefined,
          judgeToken: undefined,
          assistantToken: undefined,
          data: createEmptyData(),
          loading: {},
        })
      }
    },
    logout() {
      resetFetchCache()
      releaseAdminRealtime()
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(storageKey)
        window.localStorage.removeItem(lineupStorageKey)
        window.localStorage.removeItem(judgeStorageKey)
        window.localStorage.removeItem(assistantStorageKey)
      }
      useAssistantStore.getState().reset()
      set({
        status: 'idle',
        mode: undefined,
        token: undefined,
        lineupToken: undefined,
        judgeToken: undefined,
        assistantToken: undefined,
        activeTab: 'teams',
        selectedSeasonId: undefined,
        newsVersion: undefined,
        error: undefined,
        data: createEmptyData(),
        loading: {},
      })
    },
    setTab(tab: AdminTab) {
      if (get().mode !== 'admin') return
      set({ activeTab: tab })
      void get()
        .refreshTab(tab)
        .catch(() => undefined)
    },
    clearError() {
      if (get().error) {
        const hasToken = Boolean(get().token || get().lineupToken || get().judgeToken)
        set({ error: undefined, status: hasToken ? 'authenticated' : 'idle' })
      }
    },
    setSelectedCompetition(competitionId?: number) {
      if (get().mode !== 'admin') return
      set({ selectedCompetitionId: competitionId })
      const seasons = get().data.seasons
      if (competitionId) {
        const firstSeason = seasons.find(season => season.competitionId === competitionId)
        if (firstSeason) {
          get().setSelectedSeason(firstSeason.id)
          return
        }
      }
      const fallbackSeason = seasons[0]
      get().setSelectedSeason(fallbackSeason?.id)
    },
    setSelectedSeason(seasonId?: number) {
      if (get().mode !== 'admin') return
      const seasons = get().data.seasons
      const season = seasons.find(item => item.id === seasonId)
      set({
        selectedSeasonId: seasonId,
        selectedCompetitionId: season ? season.competitionId : get().selectedCompetitionId,
      })
      void (async () => {
        try {
          await Promise.all([
            get().fetchSeries(seasonId),
            get().fetchMatches(seasonId),
            get().fetchStats(seasonId, season?.competitionId),
          ])
        } catch (err) {
          // Ошибка уже зафиксирована в стейте run()
        }
      })()
    },
    async activateSeason(seasonId: number) {
      if (get().mode !== 'admin') return
      const targetId = Number(seasonId)
      if (!Number.isFinite(targetId) || targetId <= 0) {
        return
      }
      set(state => ({
        loading: { ...state.loading, activateSeason: true },
        error: undefined,
      }))
      try {
        const token = ensureToken()
        const response = await adminPatch<{
          seasonId: number
          season: Season
        }>(token, `/api/admin/seasons/${targetId}/activate`)
        const activatedSeason = response.season
        set(state => ({
          data: {
            ...state.data,
            seasons: state.data.seasons.map(season =>
              season.id === targetId
                ? { ...season, isActive: true }
                : { ...season, isActive: false }
            ),
          },
          selectedSeasonId: targetId,
        }))
        await Promise.all([
          get().fetchSeasons({ force: true }),
          get().fetchMatches(targetId, { force: true }),
          get().fetchStats(targetId, activatedSeason?.competitionId ?? get().selectedCompetitionId),
        ])
      } catch (error) {
        const message =
          error instanceof AdminApiError ? error.message : translateAdminError('request_failed')
        set({ error: message, status: 'error' })
      } finally {
        set(state => ({
          loading: { ...state.loading, activateSeason: false },
        }))
      }
    },
    async deleteSeason(seasonId: number) {
      if (get().mode !== 'admin') return
      const targetId = Number(seasonId)
      if (!Number.isFinite(targetId) || targetId <= 0) {
        return
      }

      set(state => ({
        loading: { ...state.loading, deleteSeason: true },
        error: undefined,
      }))

      try {
        const token = ensureToken()
        await adminDelete(token, `/api/admin/seasons/${targetId}`)

        resetFetchCache()

        set(state => {
          const remainingSeasons = state.data.seasons.filter(season => season.id !== targetId)
          const selectedSeasonId =
            state.selectedSeasonId === targetId ? undefined : state.selectedSeasonId

          return {
            data: {
              ...state.data,
              seasons: remainingSeasons,
              matches: state.data.matches.filter(match => match.seasonId !== targetId),
              series: state.data.series.filter(series => series.seasonId !== targetId),
              clubStats: state.data.clubStats.filter(entry => entry.seasonId !== targetId),
              playerStats: state.data.playerStats.filter(entry => entry.seasonId !== targetId),
            },
            selectedSeasonId,
          }
        })

        await get().fetchSeasons({ force: true })

        const stateAfterRefresh = get()
        const requiresSelection = stateAfterRefresh.selectedSeasonId === undefined

        if (requiresSelection && stateAfterRefresh.data.seasons.length) {
          const fallbackSeason =
            stateAfterRefresh.data.seasons.find(season => season.isActive) ??
            stateAfterRefresh.data.seasons[0]

          if (fallbackSeason) {
            set({ selectedSeasonId: fallbackSeason.id })
            await Promise.all([
              get().fetchSeries(fallbackSeason.id, { force: true }),
              get().fetchMatches(fallbackSeason.id, { force: true }),
              get().fetchStats(fallbackSeason.id, fallbackSeason.competitionId),
            ])
          }
        }
      } catch (error) {
        const message =
          error instanceof AdminApiError ? error.message : translateAdminError('request_failed')
        set({ error: message, status: 'error' })
      } finally {
        set(state => ({
          loading: { ...state.loading, deleteSeason: false },
        }))
      }
    },
    async fetchDictionaries(options?: FetchOptions) {
      if (get().mode !== 'admin') return
      await runCachedFetch(
        'dictionaries',
        [],
        async () => {
          const token = ensureToken()
          const [clubs, persons, stadiums, competitions] = await Promise.all([
            adminGet<Club[]>(token, '/api/admin/clubs'),
            adminGet<Person[]>(token, '/api/admin/persons'),
            adminGet<Stadium[]>(token, '/api/admin/stadiums'),
            adminGet<Competition[]>(token, '/api/admin/competitions'),
          ])
          set(state => {
            let selectedCompetitionId = state.selectedCompetitionId
            if (
              selectedCompetitionId &&
              !competitions.some(competition => competition.id === selectedCompetitionId)
            ) {
              selectedCompetitionId = competitions[0]?.id
            }

            return {
              data: {
                ...state.data,
                clubs,
                persons,
                stadiums,
                competitions,
              },
              selectedCompetitionId,
            }
          })
        },
        options?.force ? 0 : undefined
      )
    },
    async fetchSeasons(options?: FetchOptions) {
      if (get().mode !== 'admin') return
      await runCachedFetch(
        'seasons',
        [],
        async () => {
          const token = ensureToken()
          const seasons = await adminGet<Season[]>(token, '/api/admin/seasons')
          set(state => {
            const nextSeason =
              seasons.find(season => season.id === state.selectedSeasonId) ?? seasons[0]
            return {
              data: { ...state.data, seasons },
              selectedSeasonId: nextSeason?.id,
              selectedCompetitionId: nextSeason?.competitionId ?? state.selectedCompetitionId,
            }
          })
        },
        options?.force ? 0 : undefined
      )
    },
    async fetchSeries(seasonId?: number, options?: FetchOptions) {
      if (get().mode !== 'admin') return
      const activeSeason = seasonId ?? get().selectedSeasonId
      await runCachedFetch(
        'series',
        [activeSeason ? `season:${activeSeason}` : undefined],
        async () => {
          const token = ensureToken()
          const query = activeSeason ? `?seasonId=${activeSeason}` : ''
          const series = await adminGet<MatchSeries[]>(token, `/api/admin/series${query}`)
          set(state => ({ data: { ...state.data, series } }))
        },
        options?.force ? 0 : undefined
      )
    },
    async fetchMatches(seasonId?: number, options?: FetchOptions) {
      if (get().mode !== 'admin') return
      const activeSeason = seasonId ?? get().selectedSeasonId
      await runCachedFetch(
        'matches',
        [activeSeason ? `season:${activeSeason}` : undefined],
        async () => {
          const token = ensureToken()
          const query = activeSeason ? `?seasonId=${activeSeason}` : ''
          const matches = await adminGet<MatchSummary[]>(token, `/api/admin/matches${query}`)
          set(state => ({ data: { ...state.data, matches } }))
        },
        options?.force ? 0 : undefined
      )
    },
    async fetchFriendlyMatches() {
      if (get().mode !== 'admin') return
      await runCachedFetch('friendlyMatches', [], async () => {
        const token = ensureToken()
        const friendlyMatches = await adminGet<FriendlyMatch[]>(
          token,
          '/api/admin/friendly-matches'
        )
        set(state => ({ data: { ...state.data, friendlyMatches } }))
      })
    },
    async fetchStats(seasonId?: number, competitionId?: number) {
      if (get().mode !== 'admin') return
      const activeSeason = seasonId ?? get().selectedSeasonId
      const activeCompetition = competitionId ?? get().selectedCompetitionId
      await runCachedFetch(
        'stats',
        [
          activeSeason ? `season:${activeSeason}` : undefined,
          activeCompetition ? `competition:${activeCompetition}` : undefined,
        ],
        async () => {
          const token = ensureToken()
          const params = new URLSearchParams()
          if (activeSeason) {
            params.set('seasonId', String(activeSeason))
          } else if (activeCompetition) {
            params.set('competitionId', String(activeCompetition))
          }
          const seasonQuery = params.size ? `?${params.toString()}` : ''
          const careerQuery = activeCompetition ? `?competitionId=${activeCompetition}` : ''
          const [clubStats, playerStats, careerStats, clubCareerTotals] = await Promise.all([
            adminGet<ClubSeasonStats[]>(token, `/api/admin/stats/club-season${seasonQuery}`),
            adminGet<PlayerSeasonStats[]>(token, `/api/admin/stats/player-season${seasonQuery}`),
            adminGet<PlayerCareerStats[]>(token, `/api/admin/stats/player-career${careerQuery}`),
            adminGet<ClubCareerTotals[]>(token, '/api/admin/stats/club-career'),
          ])
          set(state => ({
            data: { ...state.data, clubStats, playerStats, careerStats, clubCareerTotals },
          }))
        }
      )
    },
    async fetchUsers() {
      if (get().mode !== 'admin') return
      await runCachedFetch('users', [], async () => {
        const token = ensureToken()
        const users = await adminGet<AppUser[]>(token, '/api/admin/users')
        set(state => ({ data: { ...state.data, users } }))
      })
    },
    async fetchPredictions() {
      if (get().mode !== 'admin') return
      await runCachedFetch('predictions', [], async () => {
        const token = ensureToken()
        const predictions = await adminGet<Prediction[]>(token, '/api/admin/predictions')
        set(state => ({ data: { ...state.data, predictions } }))
      })
    },
    async fetchPredictionMatches(options?: FetchOptions & { seasonId?: number }) {
      if (get().mode !== 'admin') return
      const resolvedSeasonId = options?.seasonId ?? get().selectedSeasonId
      await runCachedFetch(
        'predictionMatches',
        [resolvedSeasonId ? `season:${resolvedSeasonId}` : undefined],
        async () => {
          const token = ensureToken()
          const params = new URLSearchParams()
          if (resolvedSeasonId) {
            params.set('seasonId', String(resolvedSeasonId))
          }
          const query = params.size ? `?${params.toString()}` : ''
          const predictionMatches = await adminGet<AdminPredictionMatch[]>(
            token,
            `/api/admin/predictions/matches${query}`
          )
          set(state => ({ data: { ...state.data, predictionMatches } }))
        },
        options?.force ? 0 : undefined
      )
    },
    async fetchAchievements() {
      if (get().mode !== 'admin') return
      await runCachedFetch('achievements', [], async () => {
        const token = ensureToken()
        const [achievementTypes, userAchievements] = await Promise.all([
          adminGet<AchievementType[]>(token, '/api/admin/achievements/types'),
          adminGet<UserAchievement[]>(token, '/api/admin/achievements/users'),
        ])
        set(state => ({
          data: { ...state.data, achievementTypes, userAchievements },
        }))
      })
    },
    async fetchDisqualifications() {
      if (get().mode !== 'admin') return
      await runCachedFetch('disqualifications', [], async () => {
        const token = ensureToken()
        const disqualifications = await adminGet<Disqualification[]>(
          token,
          '/api/admin/disqualifications'
        )
        set(state => ({ data: { ...state.data, disqualifications } }))
      })
    },
    async fetchAds(options?: FetchOptions) {
      if (get().mode !== 'admin') return
      await runCachedFetch(
        'ads',
        [],
        async () => {
          const token = ensureToken()
          const ads = await adminFetchAds(token)
          set(state => ({
            data: { ...state.data, ads: sortAdsList(ads) },
          }))
        },
        options?.force ? 0 : undefined
      )
    },
    upsertAd(item: AdBanner) {
      const cacheKey = composeCacheKey('ads', [])
      fetchTimestamps[cacheKey] = Date.now()
      set(state => {
        const nextAds = state.data.ads.filter(entry => entry.id !== item.id)
        nextAds.push(item)
        return {
          data: { ...state.data, ads: sortAdsList(nextAds) },
        }
      })
    },
    removeAd(id: string) {
      const cacheKey = composeCacheKey('ads', [])
      fetchTimestamps[cacheKey] = Date.now()
      set(state => ({
        data: {
          ...state.data,
          ads: state.data.ads.filter(entry => entry.id !== id),
        },
      }))
    },
    async setRatingScope(scope: 'current' | 'yearly') {
      if (get().mode !== 'admin') return
      if (get().ratingScope === scope) return
      set({ ratingScope: scope, ratingPage: 1 })
      await get().fetchRatingLeaderboard({ scope, page: 1, pageSize: get().ratingPageSize, force: true })
    },
    async setRatingPagination(page: number, pageSize?: number) {
      if (get().mode !== 'admin') return
      const normalizedPage = Number.isFinite(page) && page > 0 ? Math.trunc(page) : 1
      const normalizedSize =
        pageSize && Number.isFinite(pageSize) && pageSize > 0 ? Math.trunc(pageSize) : get().ratingPageSize
      set({ ratingPage: normalizedPage, ratingPageSize: normalizedSize })
      await get().fetchRatingLeaderboard({
        scope: get().ratingScope,
        page: normalizedPage,
        pageSize: normalizedSize,
        force: true,
      })
    },
    async updateRatingSettings(input: AdminRatingSettingsInput) {
      if (get().mode !== 'admin') {
        throw new AdminApiError('missing_token')
      }
      const token = ensureToken()
      const { data: summary, meta } = await run('ratingSettingsUpdate', () =>
        adminUpdateRatingSettings(token, input)
      )
      set(state => ({
        data: { ...state.data, ratingSettings: summary },
      }))
      fetchTimestamps[composeCacheKey('ratingSettings', [])] = Date.now()
      await get().fetchRatingLeaderboard({
        scope: get().ratingScope,
        page: get().ratingPage,
        pageSize: get().ratingPageSize,
        force: true,
      })
      const normalizedMeta = meta
        ? {
            recalculated: Boolean((meta as { recalculated?: boolean }).recalculated),
            affectedUsers:
              typeof (meta as { affectedUsers?: number }).affectedUsers === 'number'
                ? (meta as { affectedUsers?: number }).affectedUsers
                : undefined,
          }
        : undefined
      return { summary, meta: normalizedMeta }
    },
    async recalculateRatings(userIds?: number[]) {
      if (get().mode !== 'admin') {
        throw new AdminApiError('missing_token')
      }
      const token = ensureToken()
      const payload = userIds && userIds.length ? { userIds } : undefined
      const { data: summary, meta } = await run('ratingRecalculate', () =>
        adminRecalculateRatings(token, payload)
      )
      set(state => ({
        data: { ...state.data, ratingSettings: summary },
      }))
      fetchTimestamps[composeCacheKey('ratingSettings', [])] = Date.now()
      await get().fetchRatingLeaderboard({
        scope: get().ratingScope,
        page: get().ratingPage,
        pageSize: get().ratingPageSize,
        force: true,
      })
      const normalizedMeta =
        meta && typeof (meta as { affectedUsers?: number }).affectedUsers === 'number'
          ? {
              partial: Boolean((meta as { partial?: boolean }).partial),
              affectedUsers: (meta as { affectedUsers: number }).affectedUsers,
            }
          : undefined
      return { summary, meta: normalizedMeta }
    },
    async setPredictionTemplateAuto(matchId: string) {
      if (get().mode !== 'admin') {
        throw new AdminApiError('missing_token')
      }
      const token = ensureToken()
      const result = await run('predictionTemplate', () =>
        adminPatch<PredictionTemplateOverrideResponse>(
          token,
          `/api/admin/matches/${matchId}/prediction-template`,
          { mode: 'auto' }
        )
      )

      const applied = applyPredictionTemplateOverride(matchId, result)
      if (!applied) {
        await get().fetchPredictionMatches({ force: true })
      }

      return result
    },
    async setPredictionTemplateManual(matchId: string, input: PredictionTemplateManualInput) {
      if (get().mode !== 'admin') {
        throw new AdminApiError('missing_token')
      }
      const token = ensureToken()
      const payload: {
        mode: 'manual'
        line: number
        basePoints?: number
        difficultyMultiplier?: number
      } = {
        mode: 'manual',
        line: input.line,
      }
      if (input.basePoints !== undefined) {
        payload.basePoints = input.basePoints
      }
      if (input.difficultyMultiplier !== undefined) {
        payload.difficultyMultiplier = input.difficultyMultiplier
      }

      const result = await run('predictionTemplate', () =>
        adminPatch<PredictionTemplateOverrideResponse>(
          token,
          `/api/admin/matches/${matchId}/prediction-template`,
          payload
        )
      )

      const applied = applyPredictionTemplateOverride(matchId, result)
      if (!applied) {
        await get().fetchPredictionMatches({ force: true })
      }

      return result
    },
    async fetchNews(options?: FetchOptions) {
      if (get().mode !== 'admin') return
      await runCachedFetch(
        'news',
        [],
        async () => {
          const token = ensureToken()
          const { data: news, version } = await adminRequestWithMeta<NewsItem[]>(
            token,
            '/api/news',
            {
              cache: 'no-store',
              headers: {
                'Cache-Control': 'no-cache',
                Pragma: 'no-cache',
              },
            }
          )
          set(state => ({
            data: { ...state.data, news },
            newsVersion: version ?? state.newsVersion,
          }))
        },
        options?.force ? 0 : undefined
      )
    },
    async fetchRatingSettings(options?: FetchOptions) {
      if (get().mode !== 'admin') return
      await runCachedFetch(
        'ratingSettings',
        [],
        async () => {
          const token = ensureToken()
          const summary = await adminFetchRatingSettings(token)
          set(state => ({
            data: { ...state.data, ratingSettings: summary },
          }))
        },
        options?.force ? 0 : undefined
      )
    },
    async fetchRatingLeaderboard(options?: FetchOptions & { scope?: 'current' | 'yearly'; page?: number; pageSize?: number }) {
      if (get().mode !== 'admin') return
      const scope = options?.scope ?? get().ratingScope
      const page = options?.page ?? get().ratingPage
      const pageSize = options?.pageSize ?? get().ratingPageSize

      await runCachedFetch(
        'ratingLeaderboard',
        [scope, page, pageSize],
        async () => {
          const token = ensureToken()
          const leaderboard = await adminFetchRatingLeaderboard(token, {
            scope,
            page,
            pageSize,
          })
          set(state => ({
            ratingScope: scope,
            ratingPage: page,
            ratingPageSize: pageSize,
            data: { ...state.data, ratingLeaderboard: leaderboard },
          }))
        },
        options?.force ? 0 : undefined
      )
    },
    prependNews(item: NewsItem) {
      const cacheKey = composeCacheKey('news', [])
      fetchTimestamps[cacheKey] = Date.now()
      set(state => ({
        data: {
          ...state.data,
          news: [item, ...state.data.news.filter(existing => existing.id !== item.id)],
        },
      }))
    },
    updateNews(item: NewsItem) {
      const cacheKey = composeCacheKey('news', [])
      fetchTimestamps[cacheKey] = Date.now()
      set(state => ({
        data: {
          ...state.data,
          news: state.data.news.map(existing => (existing.id === item.id ? item : existing)),
        },
      }))
    },
    removeNews(id: string) {
      const cacheKey = composeCacheKey('news', [])
      fetchTimestamps[cacheKey] = Date.now()
      set(state => ({
        data: {
          ...state.data,
          news: state.data.news.filter(existing => existing.id !== id),
        },
      }))
    },
    async refreshTab(tab?: AdminTab) {
      if (get().mode !== 'admin') return
      const target = tab ?? get().activeTab
      if (!get().token) return
      switch (target) {
        case 'teams':
          await Promise.all([get().fetchDictionaries(), get().fetchSeasons()])
          break
        case 'matches': {
          await get().fetchSeasons()
          const season = get().selectedSeasonId
          await Promise.all([
            get().fetchSeries(season),
            get().fetchMatches(season),
            get().fetchFriendlyMatches(),
          ])
          break
        }
        case 'stats': {
          await get().fetchSeasons()
          const season = get().selectedSeasonId
          const competitionId = get().selectedCompetitionId
          await get().fetchStats(season, competitionId)
          break
        }
        case 'players': {
          await Promise.all([get().fetchDictionaries(), get().fetchDisqualifications()])
          break
        }
        case 'news':
          await Promise.all([get().fetchNews({ force: true }), get().fetchAds({ force: true })])
          break
        case 'users':
          await Promise.all([
            get().fetchUsers(),
            get().fetchPredictions(),
            get().fetchAchievements(),
          ])
          break
        case 'predictions': {
          await Promise.all([get().fetchPredictionMatches({ force: true })])
          break
        }
        case 'ratings': {
          await Promise.all([
            get().fetchRatingSettings({ force: true }),
            get().fetchRatingLeaderboard({ force: true }),
          ])
          break
        }
        default:
          break
      }
    },
  }

  if (typeof window !== 'undefined') {
    attachRealtimeListener()
    if (initialMode === 'admin' && initialAdminToken) {
      ensureAdminRealtime(initialAdminToken)
    }
  }

  if (initialMode === 'admin' && initialAdminToken) {
    let booted = false
    setTimeout(() => {
      if (booted) return
      booted = true
      store.refreshTab('teams').catch(() => undefined)
    }, 0)
  }

  return store
}

export const useAdminStore = create<AdminState>()(adminStoreCreator)
