import type {
  MatchDetailsBroadcast,
  MatchDetailsEvents,
  MatchDetailsHeader,
  MatchDetailsLineups,
  MatchDetailsStats,
} from '@shared/types'
import { httpRequest, type ApiResponse } from './httpClient'

const buildMatchUrl = (matchId: string, suffix: string): string => {
  const normalized = encodeURIComponent(matchId)
  return `/api/public/matches/${normalized}/${suffix}`
}

export const matchDetailsApi = {
  fetchHeader(matchId: string, version?: string): Promise<ApiResponse<MatchDetailsHeader>> {
    return httpRequest(buildMatchUrl(matchId, 'header'), {
      version,
    })
  },
  fetchLineups(matchId: string, version?: string): Promise<ApiResponse<MatchDetailsLineups>> {
    return httpRequest(buildMatchUrl(matchId, 'lineups'), {
      version,
    })
  },
  fetchEvents(matchId: string, version?: string): Promise<ApiResponse<MatchDetailsEvents>> {
    return httpRequest(buildMatchUrl(matchId, 'events'), {
      version,
    })
  },
  fetchStats(matchId: string, version?: string): Promise<ApiResponse<MatchDetailsStats>> {
    return httpRequest(buildMatchUrl(matchId, 'stats'), {
      version,
    })
  },
  fetchBroadcast(matchId: string, version?: string): Promise<ApiResponse<MatchDetailsBroadcast>> {
    return httpRequest(buildMatchUrl(matchId, 'broadcast'), {
      version,
    })
  },
}
