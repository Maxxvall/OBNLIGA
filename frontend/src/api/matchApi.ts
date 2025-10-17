/**
 * Match Details API Client
 * Provides methods to fetch match details with ETag support
 */

import type {
  MatchDetailsHeader,
  MatchDetailsLineups,
  MatchDetailsStats,
  MatchDetailsEvents,
  MatchDetailsBroadcast,
} from '@shared/types'
import { httpRequest, type ApiResponse } from './httpClient'

type RequestOptions = {
  signal?: AbortSignal
  etag?: string
}

export const matchApi = {
  /**
   * Fetch match header (status, score, teams, current minute)
   */
  fetchHeader(matchId: string, options?: RequestOptions) {
    return httpRequest<MatchDetailsHeader>(
      `/api/public/matches/${matchId}/header`,
      options
    )
  },

  /**
   * Fetch match lineups (both teams)
   */
  fetchLineups(matchId: string, options?: RequestOptions) {
    return httpRequest<MatchDetailsLineups>(
      `/api/public/matches/${matchId}/lineups`,
      options
    )
  },

  /**
   * Fetch match statistics (shots, corners, cards, etc.)
   */
  fetchStats(matchId: string, options?: RequestOptions) {
    return httpRequest<MatchDetailsStats>(
      `/api/public/matches/${matchId}/stats`,
      options
    )
  },

  /**
   * Fetch match events (goals, cards, substitutions)
   */
  fetchEvents(matchId: string, options?: RequestOptions) {
    return httpRequest<MatchDetailsEvents>(
      `/api/public/matches/${matchId}/events`,
      options
    )
  },

  /**
   * Fetch broadcast info (stub)
   */
  fetchBroadcast(matchId: string, options?: RequestOptions) {
    return httpRequest<MatchDetailsBroadcast>(
      `/api/public/matches/${matchId}/broadcast`,
      options
    )
  },
}

export type { ApiResponse }
