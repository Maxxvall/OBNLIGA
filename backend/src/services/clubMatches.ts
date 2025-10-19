import prisma from '../db'
import { defaultCache } from '../cache'
import {
  buildLeagueSchedule,
  buildLeagueResults,
  type LeagueRoundMatches,
} from './leagueSchedule'
import { ClubSummaryNotFoundError } from './clubSummary'

const PUBLIC_CLUB_MATCHES_TTL_SECONDS = 86_400

export const publicClubMatchesKey = (clubId: number) => `public:club:${clubId}:matches`

type ClubMatchCompact = {
  d: string
  st: 'SCHEDULED' | 'LIVE' | 'POSTPONED' | 'FINISHED'
  r: string | null
  h: { n: string }
  a: { n: string }
  sc: { h: number | null; a: number | null }
}

type ClubMatchesSeasonSnapshot = {
  n: string
  m: ClubMatchCompact[]
}

type ClubMatchesSnapshot = {
  c: number
  g: string
  s: ClubMatchesSeasonSnapshot[]
}

const pickDisplayName = (name: string, shortName?: string | null) => {
  if (shortName && shortName.trim().length <= 10) {
    return shortName
  }
  return name
}

const toCompactMatch = (match: LeagueRoundMatches['matches'][number], roundLabel: string): ClubMatchCompact => {
  const isScheduled = match.status === 'SCHEDULED'
  return {
    d: match.matchDateTime,
    st: match.status,
    r: roundLabel || null,
    h: {
      n: pickDisplayName(match.homeClub.name, match.homeClub.shortName),
    },
    a: {
      n: pickDisplayName(match.awayClub.name, match.awayClub.shortName),
    },
    sc: {
      h: isScheduled ? null : match.homeScore,
      a: isScheduled ? null : match.awayScore,
    },
  }
}

const collectMatches = (
  rounds: LeagueRoundMatches[],
  clubId: number,
  store: Map<string, ClubMatchCompact>
) => {
  for (const round of rounds) {
    for (const match of round.matches) {
      if (match.homeClub.id !== clubId && match.awayClub.id !== clubId) {
        continue
      }
      const compact = toCompactMatch(match, round.roundLabel)
      store.set(match.id, compact)
    }
  }
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
      c: clubId,
      s: [],
      g: new Date().toISOString(),
    }
  }

  const seasonSnapshots: ClubMatchesSeasonSnapshot[] = []

  for (const season of seasons) {
    const [schedule, results] = await Promise.all([
      buildLeagueSchedule(season, Number.MAX_SAFE_INTEGER),
      buildLeagueResults(season, Number.MAX_SAFE_INTEGER),
    ])

    const matches = new Map<string, ClubMatchCompact>()
    collectMatches(schedule.rounds, clubId, matches)
    collectMatches(results.rounds, clubId, matches)

    if (!matches.size) {
      continue
    }

    const sorted = Array.from(matches.values()).sort((left, right) =>
      right.d.localeCompare(left.d)
    )

    seasonSnapshots.push({
      n: schedule.season.name,
      m: sorted,
    })
  }

  return {
    c: clubId,
    s: seasonSnapshots,
    g: new Date().toISOString(),
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
