import { create } from 'zustand'
import type {
  MatchDetailsBroadcast,
  MatchDetailsEvents,
  MatchDetailsHeader,
  MatchDetailsLineups,
  MatchDetailsStats,
} from '@shared/types'
import { matchDetailsApi } from '../api/matchDetailsApi'

type FetchOptions = {
  force?: boolean
  background?: boolean
}

type ResourceState<T> = {
  data?: T
  version?: string
  loading: boolean
  error?: string
  loaded: boolean
}

const createResourceState = <T>(): ResourceState<T> => ({
  data: undefined,
  version: undefined,
  loading: false,
  error: undefined,
  loaded: false,
})

type MatchDetailsState = {
  matchId: string | null
  header: ResourceState<MatchDetailsHeader>
  lineups: ResourceState<MatchDetailsLineups>
  events: ResourceState<MatchDetailsEvents>
  stats: ResourceState<MatchDetailsStats>
  broadcast: ResourceState<MatchDetailsBroadcast>
  initialize: (matchId: string) => Promise<void>
  reset: () => void
  fetchHeader: (options?: FetchOptions) => Promise<void>
  fetchLineups: (options?: FetchOptions) => Promise<void>
  fetchEvents: (options?: FetchOptions) => Promise<void>
  fetchStats: (options?: FetchOptions) => Promise<void>
  fetchBroadcast: (options?: FetchOptions) => Promise<void>
}

const initialState = (): Omit<MatchDetailsState, 'initialize' | 'reset' | 'fetchHeader' | 'fetchLineups' | 'fetchEvents' | 'fetchStats' | 'fetchBroadcast'> => ({
  matchId: null,
  header: createResourceState<MatchDetailsHeader>(),
  lineups: createResourceState<MatchDetailsLineups>(),
  events: createResourceState<MatchDetailsEvents>(),
  stats: createResourceState<MatchDetailsStats>(),
  broadcast: createResourceState<MatchDetailsBroadcast>(),
})

export const useMatchDetailsStore = create<MatchDetailsState>((set, get) => ({
  ...initialState(),
  initialize: async (matchId: string) => {
    const currentId = get().matchId
    if (currentId !== matchId) {
      set({
        matchId,
        header: createResourceState<MatchDetailsHeader>(),
        lineups: createResourceState<MatchDetailsLineups>(),
        events: createResourceState<MatchDetailsEvents>(),
        stats: createResourceState<MatchDetailsStats>(),
        broadcast: createResourceState<MatchDetailsBroadcast>(),
      })
    }
    await Promise.all([get().fetchHeader({ force: true }), get().fetchLineups({ force: true })])
  },
  reset: () => {
    set(initialState())
  },
  fetchHeader: async (options?: FetchOptions) => {
    const state = get()
    const matchId = state.matchId
    if (!matchId) {
      return
    }
    if (state.header.loading) {
      return
    }
    if (!options?.force && state.header.loaded && !options?.background) {
      return
    }
    if (!options?.background) {
      set(prev => ({
        header: {
          ...prev.header,
          loading: true,
          error: undefined,
        },
      }))
    }
    const response = await matchDetailsApi.fetchHeader(matchId, state.header.version)
    if (!matchId || get().matchId !== matchId) {
      return
    }
    if (response.ok && !response.notModified) {
      set({
        header: {
          data: response.data,
          version: response.version,
          loading: false,
          loaded: true,
          error: undefined,
        },
      })
      return
    }
    if (response.ok && response.notModified) {
      set(prev => ({
        header: {
          ...prev.header,
          loading: false,
          loaded: true,
        },
      }))
      return
    }
    set(prev => ({
      header: {
        ...prev.header,
        loading: false,
        loaded: prev.header.loaded,
        error: response.error,
      },
    }))
  },
  fetchLineups: async (options?: FetchOptions) => {
    const state = get()
    const matchId = state.matchId
    if (!matchId) {
      return
    }
    if (state.lineups.loading) {
      return
    }
    if (!options?.force && state.lineups.loaded && !options?.background) {
      return
    }
    if (!options?.background) {
      set(prev => ({
        lineups: {
          ...prev.lineups,
          loading: true,
          error: undefined,
        },
      }))
    }
    const response = await matchDetailsApi.fetchLineups(matchId, state.lineups.version)
    if (!matchId || get().matchId !== matchId) {
      return
    }
    if (response.ok && !response.notModified) {
      set(prev => {
        const previous = prev.lineups.data
        const nextHome = previous && previous.homeTeam.version === response.data.homeTeam.version
          ? previous.homeTeam
          : response.data.homeTeam
        const nextAway = previous && previous.awayTeam.version === response.data.awayTeam.version
          ? previous.awayTeam
          : response.data.awayTeam
        return {
          lineups: {
            data: {
              homeTeam: nextHome,
              awayTeam: nextAway,
            },
            version: response.version,
            loading: false,
            loaded: true,
            error: undefined,
          },
        }
      })
      return
    }
    if (response.ok && response.notModified) {
      set(prev => ({
        lineups: {
          ...prev.lineups,
          loading: false,
          loaded: true,
        },
      }))
      return
    }
    set(prev => ({
      lineups: {
        ...prev.lineups,
        loading: false,
        loaded: prev.lineups.loaded,
        error: response.error,
      },
    }))
  },
  fetchEvents: async (options?: FetchOptions) => {
    const state = get()
    const matchId = state.matchId
    if (!matchId) {
      return
    }
    if (state.events.loading) {
      return
    }
    if (!options?.force && state.events.loaded && !options?.background) {
      return
    }
    if (!options?.background) {
      set(prev => ({
        events: {
          ...prev.events,
          loading: true,
          error: undefined,
        },
      }))
    }
    const response = await matchDetailsApi.fetchEvents(matchId, state.events.version)
    if (!matchId || get().matchId !== matchId) {
      return
    }
    if (response.ok && !response.notModified) {
      set({
        events: {
          data: response.data,
          version: response.version,
          loading: false,
          loaded: true,
          error: undefined,
        },
      })
      return
    }
    if (response.ok && response.notModified) {
      set(prev => ({
        events: {
          ...prev.events,
          loading: false,
          loaded: true,
        },
      }))
      return
    }
    set(prev => ({
      events: {
        ...prev.events,
        loading: false,
        loaded: prev.events.loaded,
        error: response.error,
      },
    }))
  },
  fetchStats: async (options?: FetchOptions) => {
    const state = get()
    const matchId = state.matchId
    if (!matchId) {
      return
    }
    if (state.stats.loading) {
      return
    }
    if (!options?.force && state.stats.loaded && !options?.background) {
      return
    }
    if (!options?.background) {
      set(prev => ({
        stats: {
          ...prev.stats,
          loading: true,
          error: undefined,
        },
      }))
    }
    const response = await matchDetailsApi.fetchStats(matchId, state.stats.version)
    if (!matchId || get().matchId !== matchId) {
      return
    }
    if (response.ok && !response.notModified) {
      set(prev => {
        const previous = prev.stats.data
        const nextHome = previous && previous.homeTeam.version === response.data.homeTeam.version
          ? previous.homeTeam
          : response.data.homeTeam
        const nextAway = previous && previous.awayTeam.version === response.data.awayTeam.version
          ? previous.awayTeam
          : response.data.awayTeam
        return {
          stats: {
            data: {
              homeTeam: nextHome,
              awayTeam: nextAway,
            },
            version: response.version,
            loading: false,
            loaded: true,
            error: undefined,
          },
        }
      })
      return
    }
    if (response.ok && response.notModified) {
      set(prev => ({
        stats: {
          ...prev.stats,
          loading: false,
          loaded: true,
        },
      }))
      return
    }
    set(prev => ({
      stats: {
        ...prev.stats,
        loading: false,
        loaded: prev.stats.loaded,
        error: response.error,
      },
    }))
  },
  fetchBroadcast: async (options?: FetchOptions) => {
    const state = get()
    const matchId = state.matchId
    if (!matchId) {
      return
    }
    if (state.broadcast.loading) {
      return
    }
    if (!options?.force && state.broadcast.loaded && !options?.background) {
      return
    }
    if (!options?.background) {
      set(prev => ({
        broadcast: {
          ...prev.broadcast,
          loading: true,
          error: undefined,
        },
      }))
    }
    const response = await matchDetailsApi.fetchBroadcast(matchId, state.broadcast.version)
    if (!matchId || get().matchId !== matchId) {
      return
    }
    if (response.ok && !response.notModified) {
      set({
        broadcast: {
          data: response.data,
          version: response.version,
          loading: false,
          loaded: true,
          error: undefined,
        },
      })
      return
    }
    if (response.ok && response.notModified) {
      set(prev => ({
        broadcast: {
          ...prev.broadcast,
          loading: false,
          loaded: true,
        },
      }))
      return
    }
    set(prev => ({
      broadcast: {
        ...prev.broadcast,
        loading: false,
        loaded: prev.broadcast.loaded,
        error: response.error,
      },
    }))
  },
}))
