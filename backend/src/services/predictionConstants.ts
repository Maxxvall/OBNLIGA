export const PREDICTION_UPCOMING_DEFAULT_DAYS = 6
export const PREDICTION_UPCOMING_MAX_DAYS = 10
// Увеличены TTL под Render.com Free tier - данные меняются редко (в основном после финализации матчей)
export const PREDICTION_UPCOMING_CACHE_TTL_SECONDS = 60 // 1 минута - свежие данные
export const PREDICTION_UPCOMING_STALE_SECONDS = 300 // 5 минут - устаревшие данные (SWR)
export const PREDICTION_USER_CACHE_TTL_SECONDS = 300 // 5 минут - личные данные
export const PREDICTION_USER_STALE_SECONDS = 900 // 15 минут - устаревшие данные (SWR)
export const PREDICTION_MAX_SELECTION_LENGTH = 64
export const PREDICTION_WEEKLY_LIMIT = 10

export const PREDICTION_DEFAULT_TOTAL_LINE = 2.5
export const PREDICTION_TOTAL_LOOKBACK_MATCHES = 5
export const PREDICTION_TOTAL_MIN_SAMPLE_SIZE = 3
export const PREDICTION_TOTAL_MIN_LINE = 0.5
export const PREDICTION_TOTAL_MAX_LINE = 15

export const PREDICTION_MATCH_OUTCOME_BASE_POINTS = 10
export const PREDICTION_TOTAL_GOALS_BASE_POINTS = 12
export const PREDICTION_PENALTY_EVENT_BASE_POINTS = 8
export const PREDICTION_RED_CARD_EVENT_BASE_POINTS = 9

export const PREDICTION_SPECIAL_EVENT_BASE_DIFFICULTY = 1

export const PREDICTION_POINTS_BUDGET_MATCH_OUTCOME = 120
export const PREDICTION_POINTS_BUDGET_TOTAL_GOALS = 120
export const PREDICTION_POINTS_BUDGET_PENALTY = 30
export const PREDICTION_POINTS_BUDGET_RED_CARD = 30
export const PREDICTION_POINTS_BUDGET_TOTAL = 300

export const PREDICTION_PENALTY_DEFAULT_RATE = 0.2
export const PREDICTION_RED_CARD_DEFAULT_RATE = 0.25

export const ACTIVE_PREDICTION_CACHE_KEY = (days: number) => `predictions:list:${days}`
export const USER_PREDICTION_CACHE_KEY = (userId: number) => `predictions:user:${userId}`
