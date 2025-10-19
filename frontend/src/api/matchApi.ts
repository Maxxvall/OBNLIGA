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
  version?: string
}

const mapRequestOptions = (options?: RequestOptions) => {
  if (!options) {
    return undefined
  }
  const { etag, version, ...rest } = options
  const resolvedVersion = version ?? etag
  return resolvedVersion ? { ...rest, version: resolvedVersion } : rest
}

export const matchApi = {
  /**
   * Fetch match header (status, score, teams, current minute)
   */
  fetchHeader(matchId: string, options?: RequestOptions) {
    return httpRequest<MatchDetailsHeader>(
      `/api/public/matches/${matchId}/header`,
      mapRequestOptions(options)
    )
  },

  /**
   * Fetch match lineups (both teams)
   */
  fetchLineups(matchId: string, options?: RequestOptions) {
    return httpRequest<MatchDetailsLineups>(
      `/api/public/matches/${matchId}/lineups`,
      mapRequestOptions(options)
    )
  },

  /**
   * Fetch match statistics (shots, corners, cards, etc.)
   */
  fetchStats(matchId: string, options?: RequestOptions) {
    return httpRequest<MatchDetailsStats>(
      `/api/public/matches/${matchId}/stats`,
      mapRequestOptions(options)
    )
  },

  /**
   * Fetch match events (goals, cards, substitutions)
   */
  fetchEvents(matchId: string, options?: RequestOptions) {
    return httpRequest<MatchDetailsEvents>(
      `/api/public/matches/${matchId}/events`,
      mapRequestOptions(options)
    )
  },

  /**
   * Fetch broadcast info (stub)
   */
  fetchBroadcast(matchId: string, options?: RequestOptions) {
    return httpRequest<MatchDetailsBroadcast>(
      `/api/public/matches/${matchId}/broadcast`,
      mapRequestOptions(options)
    )
  },
}

export type { ApiResponse }
