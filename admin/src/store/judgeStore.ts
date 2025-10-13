import { create } from 'zustand'
import type { JudgeMatchSummary, MatchEventEntry, MatchLineupEntry } from '../types'
import {
  fetchJudgeMatches,
  fetchJudgeEvents,
  fetchJudgeLineup,
  judgeCreateEvent,
  judgeDeleteEvent,
  judgeUpdateEvent,
  judgeUpdateScore,
  JudgeEventPayload,
  JudgeScorePayload,
} from '../api/judgeClient'
import { translateAdminError } from '../api/adminClient'

const sortEvents = (events: MatchEventEntry[]): MatchEventEntry[] =>
  [...events].sort((left, right) => {
    if (left.minute !== right.minute) {
      return left.minute - right.minute
    }
    return Number(left.id) - Number(right.id)
  })

interface JudgeState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  matches: JudgeMatchSummary[]
  events: MatchEventEntry[]
  lineup: MatchLineupEntry[]
  selectedMatchId?: string
  loading: {
    matches?: boolean
    events?: boolean
    action?: boolean
    lineup?: boolean
  }
  error?: string
  loadMatches(token: string | undefined): Promise<void>
  refreshMatches(token: string | undefined): Promise<void>
  selectMatch(token: string | undefined, matchId: string): Promise<void>
  createEvent(token: string | undefined, matchId: string, payload: JudgeEventPayload): Promise<void>
  updateEvent(
    token: string | undefined,
    matchId: string,
    eventId: string,
    payload: Partial<JudgeEventPayload>
  ): Promise<void>
  deleteEvent(token: string | undefined, matchId: string, eventId: string): Promise<void>
  updateScore(token: string | undefined, matchId: string, payload: JudgeScorePayload): Promise<void>
  reset(): void
  clearError(): void
}

export const useJudgeStore = create<JudgeState>((set, get) => ({
  status: 'idle',
  matches: [],
  events: [],
  lineup: [],
  selectedMatchId: undefined,
  loading: {},
  error: undefined,
  async loadMatches(token) {
    set(state => ({
      status: 'loading',
      loading: { ...state.loading, matches: true },
      error: undefined,
    }))

    try {
      const matches = await fetchJudgeMatches(token)
      const firstMatch = matches[0]

      set(state => ({
        matches,
        status: 'ready',
        loading: { ...state.loading, matches: false },
        selectedMatchId: firstMatch ? firstMatch.id : undefined,
        events: firstMatch ? state.events : [],
        lineup: firstMatch ? state.lineup : [],
      }))

      if (firstMatch) {
        await get().selectMatch(token, firstMatch.id)
      } else {
        set(state => ({
          loading: { ...state.loading, events: false, lineup: false },
          events: [],
          lineup: [],
        }))
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : translateAdminError('request_failed')
      set(state => ({
        status: 'error',
        loading: { ...state.loading, matches: false },
        error: message,
      }))
    }
  },
  async refreshMatches(token) {
    try {
      const matches = await fetchJudgeMatches(token)
      const { selectedMatchId } = get()
      set({ matches })
      if (selectedMatchId && matches.some(match => match.id === selectedMatchId)) {
        return
      }
      const first = matches[0]
      if (first) {
        await get().selectMatch(token, first.id)
      } else {
        set({ selectedMatchId: undefined, events: [], lineup: [] })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : translateAdminError('request_failed')
      set({ error: message })
    }
  },
  async selectMatch(token, matchId) {
    set(state => ({
      selectedMatchId: matchId,
      loading: { ...state.loading, events: true, lineup: true },
      lineup: [],
      error: undefined,
    }))
    try {
      const [events, lineup] = await Promise.all([
        fetchJudgeEvents(token, matchId),
        fetchJudgeLineup(token, matchId),
      ])
      set(state => ({
        events: sortEvents(events),
        lineup,
        loading: { ...state.loading, events: false, lineup: false },
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : translateAdminError('request_failed')
      set(state => ({
        loading: { ...state.loading, events: false, lineup: false },
        lineup: [],
        error: message,
      }))
    }
  },
  async createEvent(token, matchId, payload) {
    set(state => ({ loading: { ...state.loading, action: true }, error: undefined }))
    try {
      const event = await judgeCreateEvent(token, matchId, payload)
      set(state => ({
        events: sortEvents([...state.events, event]),
        loading: { ...state.loading, action: false },
      }))
    } catch (err) {
      const message =
        err instanceof Error ? err.message : translateAdminError('event_create_failed')
      set(state => ({ loading: { ...state.loading, action: false }, error: message }))
    }
  },
  async updateEvent(token, matchId, eventId, payload) {
    set(state => ({ loading: { ...state.loading, action: true }, error: undefined }))
    try {
      const updated = await judgeUpdateEvent(token, matchId, eventId, payload)
      set(state => ({
        events: sortEvents(state.events.map(event => (event.id === updated.id ? updated : event))),
        loading: { ...state.loading, action: false },
      }))
    } catch (err) {
      const message =
        err instanceof Error ? err.message : translateAdminError('event_update_failed')
      set(state => ({ loading: { ...state.loading, action: false }, error: message }))
    }
  },
  async deleteEvent(token, matchId, eventId) {
    set(state => ({ loading: { ...state.loading, action: true }, error: undefined }))
    try {
      await judgeDeleteEvent(token, matchId, eventId)
      set(state => ({
        events: state.events.filter(event => event.id !== eventId),
        loading: { ...state.loading, action: false },
      }))
    } catch (err) {
      const message =
        err instanceof Error ? err.message : translateAdminError('event_delete_failed')
      set(state => ({ loading: { ...state.loading, action: false }, error: message }))
    }
  },
  async updateScore(token, matchId, payload) {
    set(state => ({ loading: { ...state.loading, action: true }, error: undefined }))
    try {
      const result = await judgeUpdateScore(token, matchId, payload)
      set(state => ({
        matches: state.matches.map(match =>
          match.id === result.id
            ? {
                ...match,
                status: result.status,
                homeScore: result.homeScore,
                awayScore: result.awayScore,
                hasPenaltyShootout: result.hasPenaltyShootout,
                penaltyHomeScore: result.penaltyHomeScore,
                penaltyAwayScore: result.penaltyAwayScore,
              }
            : match
        ),
        loading: { ...state.loading, action: false },
      }))
    } catch (err) {
      const message =
        err instanceof Error ? err.message : translateAdminError('match_update_failed')
      set(state => ({ loading: { ...state.loading, action: false }, error: message }))
    }
  },
  reset() {
    set({
      status: 'idle',
      matches: [],
      events: [],
      lineup: [],
      selectedMatchId: undefined,
      loading: {},
      error: undefined,
    })
  },
  clearError() {
    if (get().error) {
      set({ error: undefined })
    }
  },
}))
