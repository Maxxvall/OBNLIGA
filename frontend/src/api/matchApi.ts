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
  MatchComment,
} from '@shared/types'
import { httpRequest, type ApiResponse } from './httpClient'

export type MatchFullResponse = {
  header?: MatchDetailsHeader
  lineups?: MatchDetailsLineups
  stats?: MatchDetailsStats
  events?: MatchDetailsEvents
  broadcast?: MatchDetailsBroadcast
  comments?: MatchComment[]
  versions: {
    header?: string
    lineups?: string
    stats?: string
    events?: string
    broadcast?: string
    comments?: string
  }
  links?: Partial<Record<'stats' | 'events' | 'broadcast' | 'comments', string>>
}

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

  /**
   * Fetch match comments (latest chronologically ascending)
   */
  fetchComments(matchId: string, options?: RequestOptions) {
    return httpRequest<MatchComment[]>(
      `/api/public/matches/${matchId}/comments`,
      mapRequestOptions(options)
    )
  },

  /**
   * Fetch aggregated match payload (header + lineups + optional lazy parts)
   */
  fetchFull(matchId: string, options?: RequestOptions) {
    return httpRequest<MatchFullResponse>(
      `/api/matches/${matchId}/full`,
      mapRequestOptions(options)
    )
  },

  /**
   * Submit a new match comment
   */
  submitComment(
    matchId: string,
    payload: { userId: string; text: string }
  ) {
    return httpRequest<MatchComment>(`/api/public/matches/${matchId}/comments`, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {
        'Content-Type': 'application/json',
      },
    })
  },

  /**
   * Sync broadcast watch time to server
   */
  syncWatchTime(matchId: string, watchedSeconds: number) {
    return httpRequest<{ totalSeconds: number }>(
      '/api/broadcast/sync-watch-time',
      {
        method: 'POST',
        body: JSON.stringify({ matchId, watchedSeconds }),
        headers: {
          'Content-Type': 'application/json',
        },
      }
    )
  },
}

export type { ApiResponse }
