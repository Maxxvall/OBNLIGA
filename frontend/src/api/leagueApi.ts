import type {
  LeagueRoundCollection,
  LeagueSeasonSummary,
  LeagueTableResponse,
  LeagueStatsResponse,
} from '@shared/types'
import { httpRequest, type ApiResponse } from './httpClient'

export const leagueApi = {
  fetchSeasons(signal?: AbortSignal) {
    return httpRequest<LeagueSeasonSummary[]>('/api/league/seasons', { signal })
  },
  fetchTable(seasonId?: number, signal?: AbortSignal) {
    const query = seasonId ? `?seasonId=${encodeURIComponent(seasonId)}` : ''
    return httpRequest<LeagueTableResponse>(`/api/league/table${query}`, { signal })
  },
  fetchSchedule(seasonId?: number, signal?: AbortSignal) {
    const query = seasonId ? `?seasonId=${encodeURIComponent(seasonId)}` : ''
    return httpRequest<LeagueRoundCollection>(`/api/league/schedule${query}`, { signal })
  },
  fetchResults(seasonId?: number, signal?: AbortSignal) {
    const query = seasonId ? `?seasonId=${encodeURIComponent(seasonId)}` : ''
    return httpRequest<LeagueRoundCollection>(`/api/league/results${query}`, { signal })
  },
  fetchStats(seasonId?: number, signal?: AbortSignal) {
    const query = seasonId ? `?seasonId=${encodeURIComponent(seasonId)}` : ''
    return httpRequest<LeagueStatsResponse>(`/api/league/stats${query}`, { signal })
  },
}

export type { ApiResponse }
