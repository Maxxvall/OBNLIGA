export const PUBLIC_LEAGUE_TABLE_KEY = 'public:league:table:v2'
export const PUBLIC_LEAGUE_SCHEDULE_KEY = 'public:league:schedule'
export const PUBLIC_LEAGUE_RESULTS_KEY = 'public:league:results'
export const PUBLIC_LEAGUE_STATS_KEY = 'public:league:stats'
export const PUBLIC_LEAGUE_SCORERS_KEY = 'public:league:top-scorers'
export const PUBLIC_LEAGUE_ASSISTS_KEY = 'public:league:top-assists'
export const PUBLIC_LEAGUE_GOAL_CONTRIBUTORS_KEY = 'public:league:goal-contributors'
export const PUBLIC_FRIENDLY_SCHEDULE_KEY = 'public:friendlies:schedule'
export const PUBLIC_FRIENDLY_RESULTS_KEY = 'public:friendlies:results'
export const PUBLIC_RATINGS_CURRENT_KEY = 'public:ratings:current'
export const PUBLIC_RATINGS_YEARLY_KEY = 'public:ratings:yearly'
export const PUBLIC_SHOP_ITEMS_KEY = 'public:shop:items'
export const shopHistoryCacheKey = (userKey: string | number) => `public:shop:history:${userKey}`
export const userCardExtraCacheKey = (userId: number) => `user:card-extra:${userId}`
