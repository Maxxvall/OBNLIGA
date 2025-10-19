import type { ClubMatchesResponse, ClubSummaryResponse } from '@shared/types'
import { httpRequest } from './httpClient'

type RequestOptions = {
  signal?: AbortSignal
  version?: string
}

export const clubApi = {
  fetchSummary(clubId: number, options?: RequestOptions) {
    return httpRequest<ClubSummaryResponse>(`/api/clubs/${encodeURIComponent(clubId)}/summary`, options)
  },
  fetchMatches(clubId: number, options?: RequestOptions) {
    return httpRequest<ClubMatchesResponse>(`/api/clubs/${encodeURIComponent(clubId)}/matches`, options)
  },
}
