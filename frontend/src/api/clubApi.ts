import type { ClubSummaryResponse } from '@shared/types'
import { httpRequest } from './httpClient'

export const clubApi = {
  fetchSummary(clubId: number, signal?: AbortSignal) {
    return httpRequest<ClubSummaryResponse>(`/api/clubs/${encodeURIComponent(clubId)}/summary`, {
      signal,
    })
  },
}
