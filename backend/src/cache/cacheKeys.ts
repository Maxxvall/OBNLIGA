export const PUBLIC_LEAGUE_TABLE_KEY = 'public:league:table'
export const PUBLIC_LEAGUE_SCHEDULE_KEY = 'public:league:schedule'
export const PUBLIC_LEAGUE_RESULTS_KEY = 'public:league:results'
export const PUBLIC_LEAGUE_STATS_KEY = 'public:league:stats'
export const PUBLIC_LEAGUE_SCORERS_KEY = 'public:league:top-scorers'
export const PUBLIC_LEAGUE_ASSISTS_KEY = 'public:league:top-assists'
export const PUBLIC_LEAGUE_GOAL_CONTRIBUTORS_KEY = 'public:league:goal-contributors'

const normalizeMatchId = (matchId: string | number | bigint): string => {
	if (typeof matchId === 'bigint') {
		return matchId.toString()
	}
	return String(matchId)
}

export const publicMatchHeaderKey = (matchId: string | number | bigint) =>
	`pub:md:${normalizeMatchId(matchId)}:header`

export const publicMatchLineupsKey = (matchId: string | number | bigint) =>
	`pub:md:${normalizeMatchId(matchId)}:lineups`

export const publicMatchStatsKey = (matchId: string | number | bigint) =>
	`pub:md:${normalizeMatchId(matchId)}:stats`

export const publicMatchEventsKey = (matchId: string | number | bigint) =>
	`pub:md:${normalizeMatchId(matchId)}:events`

export const publicMatchBroadcastKey = (matchId: string | number | bigint) =>
	`pub:md:${normalizeMatchId(matchId)}:broadcast`
