import type {
  LeagueRoundCollection,
  LeagueSeasonSummary,
  LeagueTableResponse,
  LeagueStatsResponse,
} from '@shared/types'
import { httpRequest, type ApiResponse } from './httpClient'

type RequestOptions = {
  signal?: AbortSignal
  version?: string
}

export const leagueApi = {
  fetchSeasons(options?: RequestOptions) {
    return httpRequest<LeagueSeasonSummary[]>('/api/league/seasons', options)
  },
  fetchTable(seasonId?: number, options?: RequestOptions) {
    const query = seasonId ? `?seasonId=${encodeURIComponent(seasonId)}` : ''
    return httpRequest<LeagueTableResponse>(`/api/league/table${query}`, options)
  },
  fetchSchedule(seasonId?: number, options?: RequestOptions) {
    const query = seasonId ? `?seasonId=${encodeURIComponent(seasonId)}` : ''
    return httpRequest<LeagueRoundCollection>(`/api/league/schedule${query}`, options)
  },
  fetchResults(seasonId?: number, options?: RequestOptions) {
    const query = seasonId ? `?seasonId=${encodeURIComponent(seasonId)}` : ''
    return httpRequest<LeagueRoundCollection>(`/api/league/results${query}`, options)
  },
  fetchStats(seasonId?: number, options?: RequestOptions) {
    const query = seasonId ? `?seasonId=${encodeURIComponent(seasonId)}` : ''
    return httpRequest<LeagueStatsResponse>(`/api/league/stats${query}`, options)
  },
}

export type { ApiResponse }
