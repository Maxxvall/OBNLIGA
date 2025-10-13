import { create } from 'zustand'
import {
  assistantAdjustStatistic,
  assistantCreateEvent,
  assistantDeleteEvent,
  assistantUpdateEvent,
  assistantUpdateScore,
  fetchAssistantEvents,
  fetchAssistantLineup,
  fetchAssistantMatches,
  fetchAssistantStatistics,
} from '../api/assistantClient'
import { wsClient } from '../wsClient'
import type { WsMessage, WsPatchMessage } from '../wsClient'
import type {
  AssistantMatchSummary,
  MatchEventEntry,
  MatchLineupEntry,
  MatchStatisticEntry,
  MatchStatisticMetric,
} from '../types'

const assistantStorageKey = 'obnliga-assistant-token'

const readPersistedToken = (): string | undefined => {
  if (typeof window === 'undefined') return undefined
  try {
    return window.localStorage.getItem(assistantStorageKey) ?? undefined
  } catch (err) {
    console.warn('assistant store: failed to read token', err)
    return undefined
  }
}

type LoadingKey = 'matches' | 'events' | 'lineup' | 'statistics' | 'score' | 'adjust'

interface AssistantState {
  status: 'idle' | 'loading' | 'ready'
  token?: string
  matches: AssistantMatchSummary[]
  selectedMatchId?: string
  events: MatchEventEntry[]
  lineup: MatchLineupEntry[]
  statistics: MatchStatisticEntry[]
  statisticsVersion?: number
  error?: string
  loading: Partial<Record<LoadingKey, boolean>>
  setToken(token?: string): void
  reset(): void
  clearError(): void
  fetchMatches(token?: string): Promise<void>
  selectMatch(token: string | undefined, matchId: string): Promise<void>
  refreshSelected(token?: string): Promise<void>
  createEvent(
    token: string | undefined,
    matchId: string,
    payload: {
      minute: number
      teamId: number
      playerId: number
      eventType: MatchEventEntry['eventType']
      relatedPlayerId?: number
    }
  ): Promise<void>
  updateEvent(
    token: string | undefined,
    matchId: string,
    eventId: string,
    payload: Partial<{
      minute: number
      teamId: number
      playerId: number
      eventType: MatchEventEntry['eventType']
      relatedPlayerId?: number
    }>
  ): Promise<void>
  deleteEvent(token: string | undefined, matchId: string, eventId: string): Promise<void>
  updateScore(
    token: string | undefined,
    matchId: string,
    payload: {
      homeScore: number
      awayScore: number
      hasPenaltyShootout?: boolean
      penaltyHomeScore?: number
      penaltyAwayScore?: number
      status?: 'LIVE' | 'FINISHED'
    }
  ): Promise<void>
  adjustStatistic(
    token: string | undefined,
    matchId: string,
    payload: { clubId: number; metric: MatchStatisticMetric; delta: number }
  ): Promise<void>
  loadEventsInternal(token: string, matchId: string): Promise<void>
  loadLineupInternal(token: string, matchId: string): Promise<void>
  loadStatisticsInternal(token: string, matchId: string): Promise<void>
}

const initialToken = readPersistedToken()

const clearStorageToken = () => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(assistantStorageKey)
  } catch (err) {
    console.warn('assistant store: failed to remove token', err)
  }
}

const writeStorageToken = (token: string) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(assistantStorageKey, token)
  } catch (err) {
    console.warn('assistant store: failed to persist token', err)
  }
}

const emptyState = () => ({
  matches: [] as AssistantMatchSummary[],
  selectedMatchId: undefined,
  events: [] as MatchEventEntry[],
  lineup: [] as MatchLineupEntry[],
  statistics: [] as MatchStatisticEntry[],
  statisticsVersion: undefined as number | undefined,
})

const matchEventsTopic = (matchId: string) => `match:${matchId}:events`
const matchStatsTopic = (matchId: string) => `match:${matchId}:stats`

let subscribedMatchId: string | undefined

const unsubscribeRealtime = (matchId?: string) => {
  const target = matchId ?? subscribedMatchId
  if (!target) return
  wsClient.unsubscribe(matchEventsTopic(target))
  wsClient.unsubscribe(matchStatsTopic(target))
  if (!matchId || subscribedMatchId === matchId) {
    subscribedMatchId = undefined
  }
}

const subscribeRealtime = (matchId: string) => {
  if (!matchId) return
  if (subscribedMatchId && subscribedMatchId !== matchId) {
    unsubscribeRealtime(subscribedMatchId)
  }
  subscribedMatchId = matchId
  wsClient.subscribe(matchEventsTopic(matchId))
  wsClient.subscribe(matchStatsTopic(matchId))
}

if (initialToken) {
  wsClient.setToken(initialToken)
}

export const useAssistantStore = create<AssistantState>((set, get) => ({
  status: 'idle',
  token: initialToken,
  ...emptyState(),
  error: undefined,
  loading: {},
  setToken(token) {
    if (!token) {
      clearStorageToken()
      unsubscribeRealtime()
      wsClient.setToken(undefined)
      set({ token: undefined, status: 'idle', error: undefined, ...emptyState(), loading: {} })
      return
    }
    writeStorageToken(token)
    wsClient.setToken(token)
    set({ token, status: 'idle', error: undefined })
  },
  reset() {
    clearStorageToken()
    unsubscribeRealtime()
    wsClient.setToken(undefined)
    set({ status: 'idle', token: undefined, error: undefined, ...emptyState(), loading: {} })
  },
  clearError() {
    if (!get().error) return
    set({ error: undefined })
  },
  async fetchMatches(tokenOverride) {
    const token = tokenOverride ?? get().token
    if (!token) {
      unsubscribeRealtime()
      wsClient.setToken(undefined)
      set({
        status: 'idle',
        matches: [],
        selectedMatchId: undefined,
        events: [],
        lineup: [],
        statistics: [],
        statisticsVersion: undefined,
      })
      return
    }
    wsClient.setToken(token)
    set(state => ({
      loading: { ...state.loading, matches: true },
      error: undefined,
      status: 'loading',
    }))
    try {
      const entries = await fetchAssistantMatches(token)
      const currentSelectedId = get().selectedMatchId
      const hasSelected = currentSelectedId
        ? entries.some(match => match.id === currentSelectedId)
        : true
      const nextState: Partial<AssistantState> = { matches: entries, status: 'ready' }
      if (entries.length === 0 || !hasSelected) {
        if (currentSelectedId) {
          unsubscribeRealtime(currentSelectedId)
        } else {
          unsubscribeRealtime()
        }
        Object.assign(nextState, {
          selectedMatchId: undefined,
          events: [],
          lineup: [],
          statistics: [],
          statisticsVersion: undefined,
        })
      }
      set(nextState)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось загрузить матчи'
      set({ error: message, status: 'idle' })
    } finally {
      set(state => ({ loading: { ...state.loading, matches: false } }))
    }
  },
  async selectMatch(tokenOverride, matchId) {
    const token = tokenOverride ?? get().token
    if (!token) return
    wsClient.setToken(token)
    wsClient.connect(token)
    set({ selectedMatchId: matchId })
    subscribeRealtime(matchId)
    await Promise.all([
      get().loadEventsInternal(token, matchId),
      get().loadLineupInternal(token, matchId),
      get().loadStatisticsInternal(token, matchId),
    ])
  },
  async refreshSelected(tokenOverride) {
    const token = tokenOverride ?? get().token
    const { selectedMatchId } = get()
    if (!token || !selectedMatchId) return
    await Promise.all([
      get().loadEventsInternal(token, selectedMatchId),
      get().loadLineupInternal(token, selectedMatchId),
      get().loadStatisticsInternal(token, selectedMatchId),
    ])
  },
  async createEvent(tokenOverride, matchId, payload) {
    const token = tokenOverride ?? get().token
    if (!token) return
    set(state => ({ loading: { ...state.loading, events: true }, error: undefined }))
    try {
      await assistantCreateEvent(token, matchId, payload)
      await get().loadEventsInternal(token, matchId)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось создать событие'
      set({ error: message })
    } finally {
      set(state => ({ loading: { ...state.loading, events: false } }))
    }
  },
  async updateEvent(tokenOverride, matchId, eventId, payload) {
    const token = tokenOverride ?? get().token
    if (!token) return
    set(state => ({ loading: { ...state.loading, events: true }, error: undefined }))
    try {
      await assistantUpdateEvent(token, matchId, eventId, payload)
      await get().loadEventsInternal(token, matchId)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось обновить событие'
      set({ error: message })
    } finally {
      set(state => ({ loading: { ...state.loading, events: false } }))
    }
  },
  async deleteEvent(tokenOverride, matchId, eventId) {
    const token = tokenOverride ?? get().token
    if (!token) return
    set(state => ({ loading: { ...state.loading, events: true }, error: undefined }))
    try {
      await assistantDeleteEvent(token, matchId, eventId)
      await get().loadEventsInternal(token, matchId)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось удалить событие'
      set({ error: message })
    } finally {
      set(state => ({ loading: { ...state.loading, events: false } }))
    }
  },
  async updateScore(tokenOverride, matchId, payload) {
    const token = tokenOverride ?? get().token
    if (!token) return
    set(state => ({ loading: { ...state.loading, score: true }, error: undefined }))
    try {
      await assistantUpdateScore(token, matchId, payload)
      await get().fetchMatches(token)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось обновить счёт'
      set({ error: message })
    } finally {
      set(state => ({ loading: { ...state.loading, score: false } }))
    }
  },
  async adjustStatistic(tokenOverride, matchId, payload) {
    const token = tokenOverride ?? get().token
    if (!token) return
    set(state => ({ loading: { ...state.loading, adjust: true }, error: undefined }))
    try {
      const response = await assistantAdjustStatistic(token, matchId, payload)
      set({ statistics: response.entries, statisticsVersion: response.version })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось изменить статистику'
      set({ error: message })
    } finally {
      set(state => ({ loading: { ...state.loading, adjust: false } }))
    }
  },
  async loadEventsInternal(token: string, matchId: string) {
    set(state => ({ loading: { ...state.loading, events: true }, error: undefined }))
    try {
      const entries = await fetchAssistantEvents(token, matchId)
      set({ events: entries })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось загрузить события'
      set({ error: message })
    } finally {
      set(state => ({ loading: { ...state.loading, events: false } }))
    }
  },
  async loadLineupInternal(token: string, matchId: string) {
    set(state => ({ loading: { ...state.loading, lineup: true }, error: undefined }))
    try {
      const entries = await fetchAssistantLineup(token, matchId)
      set({ lineup: entries })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось загрузить составы'
      set({ error: message })
    } finally {
      set(state => ({ loading: { ...state.loading, lineup: false } }))
    }
  },
  async loadStatisticsInternal(token: string, matchId: string) {
    set(state => ({ loading: { ...state.loading, statistics: true }, error: undefined }))
    try {
      const response = await fetchAssistantStatistics(token, matchId)
      set({ statistics: response.entries, statisticsVersion: response.version })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось загрузить статистику'
      set({ error: message })
    } finally {
      set(state => ({ loading: { ...state.loading, statistics: false } }))
    }
  },
}))

const isPatchMessage = (
  message: WsMessage
): message is WsPatchMessage<MatchEventEntry[] | MatchStatisticEntry[]> => message.type === 'patch'

if (typeof window !== 'undefined') {
  wsClient.on('patch', message => {
    if (!isPatchMessage(message)) return
    const topic = message.topic
    const payload = message.payload
    if (!topic || !payload) return

    const { selectedMatchId } = useAssistantStore.getState()
    if (!selectedMatchId) return

    if (topic === matchEventsTopic(selectedMatchId)) {
      if (payload.type === 'full' && Array.isArray(payload.data)) {
        useAssistantStore.setState({ events: payload.data as MatchEventEntry[] })
      }
      return
    }

    if (topic === matchStatsTopic(selectedMatchId)) {
      if (payload.type === 'full' && Array.isArray(payload.data)) {
        const rawVersion = payload.version
        const numericVersion = typeof rawVersion === 'number' ? rawVersion : Number(rawVersion)
        useAssistantStore.setState(state => ({
          statistics: payload.data as MatchStatisticEntry[],
          statisticsVersion: Number.isNaN(numericVersion)
            ? state.statisticsVersion
            : numericVersion,
        }))
      }
    }
  })
}
