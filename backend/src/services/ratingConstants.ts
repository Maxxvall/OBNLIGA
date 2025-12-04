import { RatingLevel } from '@prisma/client'

// Увеличены TTL под Render.com Free tier - рейтинги меняются только после финализации матчей
export const RATING_LEADERBOARD_TTL_SECONDS = 120 // 2 минуты - свежие данные
export const RATING_LEADERBOARD_STALE_SECONDS = 600 // 10 минут - устаревшие данные (SWR)
export const RATING_DEFAULT_PAGE_SIZE = 10
export const RATING_MAX_PAGE_SIZE = 100
export const RATING_SNAPSHOT_LIMIT = 10

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
