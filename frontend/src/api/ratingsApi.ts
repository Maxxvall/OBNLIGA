import type {
  RatingLeaderboardResponse,
  RatingScopeKey,
  UserRatingSummary,
} from '@shared/types'
import { httpRequest } from './httpClient'

type LeaderboardOptions = {
  page?: number
  pageSize?: number
}

const buildQueryString = (params: Record<string, string | number | undefined>): string => {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined) {
      return
    }
    query.set(key, String(value))
  })
  const serialized = query.toString()
  return serialized.length ? `?${serialized}` : ''
}

export async function fetchRatingLeaderboard(
  scope: RatingScopeKey,
  options: LeaderboardOptions = {},
  version?: string
) {
  const query = buildQueryString({
    scope,
    page: options.page,
    pageSize: options.pageSize,
  })

  return httpRequest<RatingLeaderboardResponse>(`/api/ratings${query}`, { version })
}

export async function fetchMyRating(version?: string) {
  return httpRequest<UserRatingSummary>('/api/users/me/rating', { version, credentials: 'include' })
}
