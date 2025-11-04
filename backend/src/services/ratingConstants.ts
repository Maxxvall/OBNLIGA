import { RatingLevel } from '@prisma/client'

export const RATING_LEADERBOARD_TTL_SECONDS = 60
export const RATING_LEADERBOARD_STALE_SECONDS = 120
export const RATING_DEFAULT_PAGE_SIZE = 25
export const RATING_MAX_PAGE_SIZE = 100
export const RATING_SNAPSHOT_LIMIT = 50

export const resolveRatingLevel = (totalPoints: number): RatingLevel => {
  if (totalPoints >= 1300) {
    return RatingLevel.MYTHIC
  }
  if (totalPoints >= 950) {
    return RatingLevel.DIAMOND
  }
  if (totalPoints >= 650) {
    return RatingLevel.PLATINUM
  }
  if (totalPoints >= 350) {
    return RatingLevel.GOLD
  }
  if (totalPoints >= 150) {
    return RatingLevel.SILVER
  }
  return RatingLevel.BRONZE
}

export const ratingScopeKey = (scope: 'CURRENT' | 'YEARLY'): string =>
  scope === 'YEARLY' ? 'yearly' : 'current'
