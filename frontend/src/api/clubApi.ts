import type { ClubSummaryResponse } from '@shared/types'
import { httpRequest } from './httpClient'

type RequestOptions = {
  signal?: AbortSignal
  version?: string
}

export const clubApi = {
  fetchSummary(clubId: number, options?: RequestOptions) {
    return httpRequest<ClubSummaryResponse>(`/api/clubs/${encodeURIComponent(clubId)}/summary`, options)
  },
}
