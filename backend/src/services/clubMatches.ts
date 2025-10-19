import prisma from '../db'
import { defaultCache } from '../cache'
import {
  buildLeagueSchedule,
  buildLeagueResults,
  type LeagueRoundCollection,
  type LeagueRoundMatches,
} from './leagueSchedule'
import { ClubSummaryNotFoundError } from './clubSummary'

const PUBLIC_CLUB_MATCHES_TTL_SECONDS = 1_200

export const publicClubMatchesKey = (clubId: number) => `public:club:${clubId}:matches`

type ClubMatchesRoundAccumulator = {
  round: LeagueRoundMatches
  matchIds: Set<string>
  firstMatchAt: number
  lastMatchAt: number
}

type ClubMatchesSnapshot = {
  clubId: number
  seasons: ClubMatchesSeasonSnapshot[]
  generatedAt: string
}

type ClubMatchesSeasonSnapshot = {
  season: LeagueRoundCollection['season']
  rounds: LeagueRoundMatches[]
}

const createAccumulator = (round: LeagueRoundMatches): ClubMatchesRoundAccumulator => ({
  round: {
    roundId: round.roundId,
    roundNumber: round.roundNumber,
    roundLabel: round.roundLabel,
    roundType: round.roundType,
    matches: [],
  },
  matchIds: new Set<string>(),
  firstMatchAt: Number.POSITIVE_INFINITY,
  lastMatchAt: Number.NEGATIVE_INFINITY,
})

const appendRoundMatches = (
  map: Map<string, ClubMatchesRoundAccumulator>,
  rounds: LeagueRoundMatches[],
  clubId: number
) => {
  rounds.forEach(round => {
    const filteredMatches = round.matches.filter(match =>
      match.homeClub.id === clubId || match.awayClub.id === clubId
    )

    if (filteredMatches.length === 0) {
      return
    }

    const key = round.roundId !== null ? `id:${round.roundId}` : `label:${round.roundLabel}`
    let accumulator = map.get(key)
    if (!accumulator) {
      accumulator = createAccumulator(round)
      map.set(key, accumulator)
    }

    filteredMatches.forEach(match => {
      if (accumulator!.matchIds.has(match.id)) {
        return
      }
      accumulator!.matchIds.add(match.id)
      accumulator!.round.matches.push(match)
      const timestamp = Date.parse(match.matchDateTime)
      if (Number.isFinite(timestamp)) {
        accumulator!.firstMatchAt = Math.min(accumulator!.firstMatchAt, timestamp)
        accumulator!.lastMatchAt = Math.max(accumulator!.lastMatchAt, timestamp)
      }
    })
  })
}

const finalizeRounds = (
  map: Map<string, ClubMatchesRoundAccumulator>
): LeagueRoundMatches[] => {
  const values = Array.from(map.values()).filter(entry => entry.round.matches.length > 0)

  values.forEach(entry => {
    entry.round.matches.sort((left, right) =>
      left.matchDateTime.localeCompare(right.matchDateTime)
    )
    if (!Number.isFinite(entry.firstMatchAt)) {
      entry.firstMatchAt = entry.round.matches.reduce((min, match) => {
        const ts = Date.parse(match.matchDateTime)
        return Number.isFinite(ts) ? Math.min(min, ts) : min
      }, Number.POSITIVE_INFINITY)
    }
    if (!Number.isFinite(entry.lastMatchAt)) {
      entry.lastMatchAt = entry.round.matches.reduce((max, match) => {
        const ts = Date.parse(match.matchDateTime)
        return Number.isFinite(ts) ? Math.max(max, ts) : max
      }, Number.NEGATIVE_INFINITY)
    }
  })

  values.sort((left, right) => {
    const leftTime = Number.isFinite(left.lastMatchAt) ? left.lastMatchAt : left.firstMatchAt
    const rightTime = Number.isFinite(right.lastMatchAt) ? right.lastMatchAt : right.firstMatchAt
    return rightTime - leftTime
  })

  return values.map(entry => entry.round)
}

export const buildClubMatches = async (clubId: number): Promise<ClubMatchesSnapshot | null> => {
  const club = await prisma.club.findUnique({ where: { id: clubId }, select: { id: true } })
  if (!club) {
    return null
  }

  const seasons = await prisma.season.findMany({
    where: {
      matches: {
        some: {
          OR: [{ homeTeamId: clubId }, { awayTeamId: clubId }],
        },
      },
    },
    include: { competition: true },
    orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
  })

  if (!seasons.length) {
    return {
      clubId,
      seasons: [],
      generatedAt: new Date().toISOString(),
    }
  }

  const seasonSnapshots: ClubMatchesSeasonSnapshot[] = []

  for (const season of seasons) {
    const [schedule, results] = await Promise.all([
      buildLeagueSchedule(season, Number.MAX_SAFE_INTEGER),
      buildLeagueResults(season, Number.MAX_SAFE_INTEGER),
    ])

    const accumulator = new Map<string, ClubMatchesRoundAccumulator>()
    appendRoundMatches(accumulator, schedule.rounds, clubId)
    appendRoundMatches(accumulator, results.rounds, clubId)
    const rounds = finalizeRounds(accumulator)

    if (rounds.length === 0) {
      continue
    }

    seasonSnapshots.push({
      season: schedule.season,
      rounds,
    })
  }

  return {
    clubId,
    seasons: seasonSnapshots,
    generatedAt: new Date().toISOString(),
  }
}

export const getClubMatches = async (clubId: number) => {
  const cacheKey = publicClubMatchesKey(clubId)
  const loader = async () => {
    const snapshot = await buildClubMatches(clubId)
    if (!snapshot) {
      throw new ClubSummaryNotFoundError(clubId)
    }
    return snapshot
  }
  return defaultCache.getWithMeta(cacheKey, loader, PUBLIC_CLUB_MATCHES_TTL_SECONDS)
}
