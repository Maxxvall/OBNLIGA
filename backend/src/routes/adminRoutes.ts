import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import prisma from '../db'
import jwt from 'jsonwebtoken'
import {
  AchievementMetric,
  CompetitionType,
  DisqualificationReason,
  LineupRole,
  MatchEvent,
  MatchEventType,
  MatchStatus,
  Prisma,
  RoundType,
  SeriesFormat,
  SeriesStatus,
} from '@prisma/client'
import { handleMatchFinalization, rebuildCareerStatsForClubs } from '../services/matchAggregation'
import { buildLeagueTable } from '../services/leagueTable'
import {
  PUBLIC_LEAGUE_RESULTS_KEY,
  PUBLIC_LEAGUE_SCHEDULE_KEY,
  refreshLeagueMatchAggregates,
} from '../services/leagueSchedule'
import { createSeasonPlayoffs, runSeasonAutomation } from '../services/seasonAutomation'
import { serializePrisma } from '../utils/serialization'
import { defaultCache } from '../cache'
import { deliverTelegramNewsNow, enqueueTelegramNewsJob } from '../queue/newsWorker'
import { secureEquals } from '../utils/secureEquals'
import { parseBigIntId, parseNumericId, parseOptionalNumericId } from '../utils/parsers'
import {
  RequestError,
  broadcastMatchStatistics,
  createMatchEvent,
  deleteMatchEvent,
  cleanupExpiredMatchStatistics,
  hasMatchStatisticsExpired,
  MatchStatisticMetric,
  MATCH_STATISTIC_METRICS,
  getMatchStatisticsWithMeta,
  loadMatchLineupWithNumbers,
  matchStatsCacheKey,
  updateMatchEvent,
  applyStatisticDelta,
} from './matchModerationHelpers'

declare module 'fastify' {
  interface FastifyRequest {
    admin?: {
      sub: string
      role: string
    }
  }
}

const getJwtSecret = () =>
  process.env.JWT_SECRET || process.env.TELEGRAM_BOT_TOKEN || 'admin-dev-secret'

class TransferError extends Error {
  constructor(code: string) {
    super(code)
    this.name = 'TransferError'
  }
}

type TransferSummary = {
  personId: number
  person: { id: number; firstName: string; lastName: string }
  fromClubId: number | null
  toClubId: number | null
  fromClub: { id: number; name: string; shortName: string } | null
  toClub: { id: number; name: string; shortName: string } | null
  status: 'moved' | 'skipped'
  reason?: 'same_club'
}

type AdminTestLoginBody = {
  userId?: number | string
  username?: string | null
  firstName?: string | null
}

type NewsCreateBody = {
  title?: string
  content?: string
  coverUrl?: string | null
  sendToTelegram?: boolean
}

type NewsUpdateBody = {
  title?: string | null
  content?: string | null
  coverUrl?: string | null
  sendToTelegram?: boolean
}

type NewsParams = {
  newsId: string
}

const normalizeShirtNumber = (value: number | null | undefined): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }
  const normalized = Math.floor(value)
  if (normalized <= 0) {
    return null
  }
  return Math.min(normalized, 999)
}

const assignSeasonShirtNumber = (preferred: number | null, taken: Set<number>): number => {
  if (typeof preferred === 'number' && preferred > 0 && !taken.has(preferred)) {
    taken.add(preferred)
    return preferred
  }
  let candidate = typeof preferred === 'number' && preferred > 0 ? preferred : 1
  if (candidate < 1) candidate = 1
  for (let offset = 0; offset < 999; offset += 1) {
    const value = ((candidate - 1 + offset) % 999) + 1
    if (!taken.has(value)) {
      taken.add(value)
      return value
    }
  }
  let fallback = 1
  while (taken.has(fallback)) {
    fallback += 1
  }
  taken.add(fallback)
  return fallback
}

const shouldSyncSeasonRoster = (season: { endDate: Date }): boolean => {
  const now = new Date()
  return season.endDate >= now
}

const syncClubSeasonRosters = async (
  tx: Prisma.TransactionClient,
  clubId: number
): Promise<number[]> => {
  const clubPlayers = await tx.clubPlayer.findMany({
    where: { clubId },
    orderBy: [{ defaultShirtNumber: 'asc' }, { personId: 'asc' }],
  })

  const desiredNumbers = new Map<number, number | null>()
  for (const player of clubPlayers) {
    desiredNumbers.set(player.personId, normalizeShirtNumber(player.defaultShirtNumber))
  }

  const currentParticipants = await tx.seasonParticipant.findMany({
    where: { clubId },
    include: {
      season: {
        select: {
          id: true,
          endDate: true,
        },
      },
    },
  })

  const clubPlayerIds = new Set(clubPlayers.map(player => player.personId))
  const updatedSeasonIds: number[] = []

  for (const participant of currentParticipants) {
    const season = participant.season
    if (!season || !shouldSyncSeasonRoster(season)) {
      continue
    }

    const rosterEntries = await tx.seasonRoster.findMany({
      where: { seasonId: season.id, clubId },
      orderBy: [{ shirtNumber: 'asc' }],
    })

    const obsoleteEntries = rosterEntries.filter(entry => !clubPlayerIds.has(entry.personId))
    if (obsoleteEntries.length) {
      await tx.seasonRoster.deleteMany({
        where: {
          seasonId: season.id,
          clubId,
          personId: { in: obsoleteEntries.map(entry => entry.personId) },
        },
      })
    }

    const activeEntries = rosterEntries.filter(entry => clubPlayerIds.has(entry.personId))
    const entryByPerson = new Map(activeEntries.map(entry => [entry.personId, entry]))
    const takenNumbers = new Set<number>(activeEntries.map(entry => entry.shirtNumber))

    const updates: Array<{ personId: number; shirtNumber: number }> = []
    const creations: Array<{ personId: number; shirtNumber: number }> = []

    for (const player of clubPlayers) {
      const preferred = desiredNumbers.get(player.personId) ?? null
      const existing = entryByPerson.get(player.personId)
      if (existing) {
        if (
          typeof preferred === 'number' &&
          preferred > 0 &&
          preferred !== existing.shirtNumber &&
          !takenNumbers.has(preferred)
        ) {
          takenNumbers.delete(existing.shirtNumber)
          takenNumbers.add(preferred)
          updates.push({ personId: player.personId, shirtNumber: preferred })
        }
        continue
      }

      const assigned = assignSeasonShirtNumber(preferred, takenNumbers)
      creations.push({ personId: player.personId, shirtNumber: assigned })
    }

    if (updates.length) {
      for (const update of updates) {
        await tx.seasonRoster.update({
          where: {
            seasonId_clubId_personId: {
              seasonId: season.id,
              clubId,
              personId: update.personId,
            },
          },
          data: { shirtNumber: update.shirtNumber },
        })
      }
    }

    if (creations.length) {
      await tx.seasonRoster.createMany({
        data: creations.map(entry => ({
          seasonId: season.id,
          clubId,
          personId: entry.personId,
          shirtNumber: entry.shirtNumber,
          registrationDate: new Date(),
        })),
        skipDuplicates: true,
      })
    }

    if (obsoleteEntries.length || updates.length || creations.length) {
      updatedSeasonIds.push(season.id)
    }
  }

  return Array.from(new Set(updatedSeasonIds))
}

const formatNameToken = (token: string): string => {
  return token
    .split('-')
    .filter(part => part.length > 0)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('-')
}

const normalizePersonName = (value: string): string => {
  return value
    .split(/\s+/)
    .filter(chunk => chunk.length > 0)
    .map(formatNameToken)
    .join(' ')
}

const parseFullNameLine = (line: string): { firstName: string; lastName: string } => {
  const parts = line.trim().split(/\s+/)
  if (parts.length < 2) {
    throw new Error('invalid_full_name')
  }
  const lastNameRaw = parts[0]
  const firstNameRaw = parts.slice(1).join(' ')
  const lastName = normalizePersonName(lastNameRaw)
  const firstName = normalizePersonName(firstNameRaw)
  if (!firstName || !lastName) {
    throw new Error('invalid_full_name')
  }
  return { firstName, lastName }
}

const sendSerialized = <T>(reply: FastifyReply, data: T) =>
  reply.send({ ok: true, data: serializePrisma(data) })

const SEASON_STATS_CACHE_TTL_SECONDS = Number(process.env.ADMIN_CACHE_TTL_SEASON_STATS ?? '60')
const CAREER_STATS_CACHE_TTL_SECONDS = Number(process.env.ADMIN_CACHE_TTL_CAREER_STATS ?? '180')
const NEWS_CACHE_KEY = 'news:all'

const seasonStatsCacheKey = (seasonId: number, suffix: string) => `season:${seasonId}:${suffix}`
const competitionStatsCacheKey = (competitionId: number, suffix: string) =>
  `competition:${competitionId}:${suffix}`
const PUBLIC_LEAGUE_SEASONS_KEY = 'public:league:seasons'
const PUBLIC_LEAGUE_TABLE_KEY = 'public:league:table'
const PUBLIC_LEAGUE_TABLE_TTL_SECONDS = 300
const leagueStatsCacheKey = (suffix: string) => `league:${suffix}`

const matchStatisticMetrics: MatchStatisticMetric[] = MATCH_STATISTIC_METRICS

async function loadSeasonClubStats(seasonId: number) {
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    include: {
      competition: true,
      participants: { include: { club: true } },
      groups: {
        include: {
          slots: {
            include: {
              club: {
                select: { id: true, name: true, shortName: true, logoUrl: true },
              },
            },
          },
        },
        orderBy: { groupIndex: 'asc' },
      },
    },
  })

  if (!season) {
    throw new RequestError(404, 'season_not_found')
  }

  const rawStats = await prisma.clubSeasonStats.findMany({
    where: { seasonId },
    include: { club: true },
  })

  const finishedMatches = await prisma.match.findMany({
    where: {
      seasonId,
      status: MatchStatus.FINISHED,
      OR: [{ roundId: null }, { round: { roundType: RoundType.REGULAR } }],
    },
    select: {
      homeTeamId: true,
      awayTeamId: true,
      homeScore: true,
      awayScore: true,
    },
  })

  const statsByClub = new Map<number, (typeof rawStats)[number]>()
  for (const stat of rawStats) {
    statsByClub.set(stat.clubId, stat)
  }

  type ComputedClubStats = {
    points: number
    wins: number
    losses: number
    goalsFor: number
    goalsAgainst: number
  }

  const computedStats = new Map<number, ComputedClubStats>()
  const ensureComputed = (clubId: number): ComputedClubStats => {
    let entry = computedStats.get(clubId)
    if (!entry) {
      entry = { points: 0, wins: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 }
      computedStats.set(clubId, entry)
    }
    return entry
  }

  for (const match of finishedMatches) {
    const home = ensureComputed(match.homeTeamId)
    const away = ensureComputed(match.awayTeamId)

    home.goalsFor += match.homeScore
    home.goalsAgainst += match.awayScore
    away.goalsFor += match.awayScore
    away.goalsAgainst += match.homeScore

    if (match.homeScore > match.awayScore) {
      home.points += 3
      home.wins += 1
      away.losses += 1
    } else if (match.homeScore < match.awayScore) {
      away.points += 3
      away.wins += 1
      home.losses += 1
    } else {
      home.points += 1
      away.points += 1
    }
  }

  const seasonGroups = (season.groups ?? []).map(group => ({
    id: group.id,
    seasonId: season.id,
    groupIndex: group.groupIndex,
    label: group.label,
    qualifyCount: group.qualifyCount,
    slots: [...group.slots]
      .sort((left, right) => left.position - right.position)
      .map(slot => ({
        id: slot.id,
        groupId: slot.groupId,
        position: slot.position,
        clubId: slot.clubId,
        club: slot.club
          ? {
              id: slot.club.id,
              name: slot.club.name,
              shortName: slot.club.shortName,
              logoUrl: slot.club.logoUrl,
            }
          : null,
      })),
  }))

  const groupMembership = new Map<number, { groupIndex: number; label: string }>()
  for (const group of seasonGroups) {
    for (const slot of group.slots) {
      if (slot.clubId) {
        groupMembership.set(slot.clubId, { groupIndex: group.groupIndex, label: group.label })
      }
    }
  }

  const seasonPayload = {
    id: season.id,
    competitionId: season.competitionId,
    name: season.name,
    startDate: season.startDate,
    endDate: season.endDate,
    competition: season.competition,
    groups: seasonGroups,
  }

  const rows = season.participants.map(participant => {
    const computed = computedStats.get(participant.clubId)
    const stat = statsByClub.get(participant.clubId)
    const membership = groupMembership.get(participant.clubId)
    return {
      seasonId: season.id,
      clubId: participant.clubId,
      points: computed?.points ?? stat?.points ?? 0,
      wins: computed?.wins ?? stat?.wins ?? 0,
      losses: computed?.losses ?? stat?.losses ?? 0,
      goalsFor: computed?.goalsFor ?? stat?.goalsFor ?? 0,
      goalsAgainst: computed?.goalsAgainst ?? stat?.goalsAgainst ?? 0,
      club: participant.club,
      season: seasonPayload,
      groupIndex: membership?.groupIndex ?? null,
      groupLabel: membership?.label ?? null,
    }
  })

  for (const stat of rawStats) {
    if (rows.some(row => row.clubId === stat.clubId)) continue
    const computed = computedStats.get(stat.clubId)
    const membership = groupMembership.get(stat.clubId)
    rows.push({
      seasonId: season.id,
      clubId: stat.clubId,
      points: computed?.points ?? stat.points,
      wins: computed?.wins ?? stat.wins,
      losses: computed?.losses ?? stat.losses,
      goalsFor: computed?.goalsFor ?? stat.goalsFor,
      goalsAgainst: computed?.goalsAgainst ?? stat.goalsAgainst,
      club: stat.club,
      season: seasonPayload,
      groupIndex: membership?.groupIndex ?? null,
      groupLabel: membership?.label ?? null,
    })
  }

  type HeadToHeadEntry = { points: number; goalsFor: number; goalsAgainst: number }
  const headToHead = new Map<number, Map<number, HeadToHeadEntry>>()
  const ensureHeadToHead = (clubId: number, opponentId: number): HeadToHeadEntry => {
    let opponents = headToHead.get(clubId)
    if (!opponents) {
      opponents = new Map<number, HeadToHeadEntry>()
      headToHead.set(clubId, opponents)
    }
    let record = opponents.get(opponentId)
    if (!record) {
      record = { points: 0, goalsFor: 0, goalsAgainst: 0 }
      opponents.set(opponentId, record)
    }
    return record
  }

  for (const match of finishedMatches) {
    const home = ensureHeadToHead(match.homeTeamId, match.awayTeamId)
    const away = ensureHeadToHead(match.awayTeamId, match.homeTeamId)

    home.goalsFor += match.homeScore
    home.goalsAgainst += match.awayScore
    away.goalsFor += match.awayScore
    away.goalsAgainst += match.homeScore

    if (match.homeScore > match.awayScore) {
      home.points += 3
    } else if (match.homeScore < match.awayScore) {
      away.points += 3
    } else {
      home.points += 1
      away.points += 1
    }
  }

  const getHeadToHead = (clubId: number, opponentId: number): HeadToHeadEntry => {
    return headToHead.get(clubId)?.get(opponentId) ?? { points: 0, goalsFor: 0, goalsAgainst: 0 }
  }

  rows.sort((left, right) => {
    if (right.points !== left.points) return right.points - left.points

    const leftDiff = left.goalsFor - left.goalsAgainst
    const rightDiff = right.goalsFor - right.goalsAgainst
    if (rightDiff !== leftDiff) return rightDiff - leftDiff

    const leftVsRight = getHeadToHead(left.clubId, right.clubId)
    const rightVsLeft = getHeadToHead(right.clubId, left.clubId)

    if (rightVsLeft.points !== leftVsRight.points) return rightVsLeft.points - leftVsRight.points

    const leftHeadDiff = leftVsRight.goalsFor - leftVsRight.goalsAgainst
    const rightHeadDiff = rightVsLeft.goalsFor - rightVsLeft.goalsAgainst
    if (rightHeadDiff !== leftHeadDiff) return rightHeadDiff - leftHeadDiff

    if (rightVsLeft.goalsFor !== leftVsRight.goalsFor)
      return rightVsLeft.goalsFor - leftVsRight.goalsFor

    return right.goalsFor - left.goalsFor
  })

  return serializePrisma(rows)
}

async function getSeasonClubStats(seasonId: number) {
  return defaultCache.getWithMeta(
    seasonStatsCacheKey(seasonId, 'club-stats'),
    () => loadSeasonClubStats(seasonId),
    SEASON_STATS_CACHE_TTL_SECONDS
  )
}

async function loadClubCareerTotals(competitionId?: number) {
  const seasons = await prisma.season.findMany({
    where: competitionId ? { competitionId } : undefined,
    select: { id: true },
  })

  if (!seasons.length) {
    return []
  }

  const seasonIds = seasons.map(season => season.id)

  const participants = await prisma.seasonParticipant.findMany({
    where: { seasonId: { in: seasonIds } },
    select: { seasonId: true, clubId: true },
  })

  const clubIdSet = new Set<number>()
  for (const participant of participants) {
    clubIdSet.add(participant.clubId)
  }

  const matches = await prisma.match.findMany({
    where: {
      seasonId: { in: seasonIds },
      status: MatchStatus.FINISHED,
    },
    select: {
      seasonId: true,
      homeTeamId: true,
      awayTeamId: true,
      homeScore: true,
      awayScore: true,
    },
  })

  for (const match of matches) {
    clubIdSet.add(match.homeTeamId)
    clubIdSet.add(match.awayTeamId)
  }

  const yellowCardGroups = await prisma.matchEvent.groupBy({
    by: ['teamId'],
    where: {
      match: {
        seasonId: { in: seasonIds },
        status: MatchStatus.FINISHED,
      },
      eventType: MatchEventType.YELLOW_CARD,
    },
    _count: { _all: true },
  })

  const redCardGroups = await prisma.matchEvent.groupBy({
    by: ['teamId'],
    where: {
      match: {
        seasonId: { in: seasonIds },
        status: MatchStatus.FINISHED,
      },
      eventType: MatchEventType.RED_CARD,
    },
    _count: { _all: true },
  })

  for (const entry of yellowCardGroups) {
    if (entry.teamId != null) {
      clubIdSet.add(entry.teamId)
    }
  }

  for (const entry of redCardGroups) {
    if (entry.teamId != null) {
      clubIdSet.add(entry.teamId)
    }
  }

  const clubIds = Array.from(clubIdSet)
  if (!clubIds.length) {
    return []
  }

  const clubs = await prisma.club.findMany({
    where: { id: { in: clubIds } },
    select: { id: true, name: true, shortName: true, logoUrl: true },
  })

  type TotalsEntry = {
    clubId: number
    club?: (typeof clubs)[number]
    seasonIds: Set<number>
    goalsFor: number
    goalsAgainst: number
    yellowCards: number
    redCards: number
    cleanSheets: number
    matchesPlayed: number
  }

  const clubInfo = new Map(clubs.map(club => [club.id, club]))
  const totals = new Map<number, TotalsEntry>()

  const ensureClub = (clubId: number): TotalsEntry | undefined => {
    const club = clubInfo.get(clubId)
    if (!club) return undefined
    let entry = totals.get(clubId)
    if (!entry) {
      entry = {
        clubId,
        club,
        seasonIds: new Set<number>(),
        goalsFor: 0,
        goalsAgainst: 0,
        yellowCards: 0,
        redCards: 0,
        cleanSheets: 0,
        matchesPlayed: 0,
      }
      totals.set(clubId, entry)
    }
    return entry
  }

  for (const participant of participants) {
    const entry = ensureClub(participant.clubId)
    entry?.seasonIds.add(participant.seasonId)
  }

  for (const match of matches) {
    const home = ensureClub(match.homeTeamId)
    const away = ensureClub(match.awayTeamId)

    if (home) {
      home.matchesPlayed += 1
      home.goalsFor += match.homeScore
      home.goalsAgainst += match.awayScore
      if (match.awayScore === 0) {
        home.cleanSheets += 1
      }
    }

    if (away) {
      away.matchesPlayed += 1
      away.goalsFor += match.awayScore
      away.goalsAgainst += match.homeScore
      if (match.homeScore === 0) {
        away.cleanSheets += 1
      }
    }
  }

  for (const entry of yellowCardGroups) {
    if (entry.teamId == null) continue
    const totalsEntry = ensureClub(entry.teamId)
    if (totalsEntry) {
      totalsEntry.yellowCards += entry._count._all
    }
  }

  for (const entry of redCardGroups) {
    if (entry.teamId == null) continue
    const totalsEntry = ensureClub(entry.teamId)
    if (totalsEntry) {
      totalsEntry.redCards += entry._count._all
    }
  }

  const rows = Array.from(totals.values()).map(entry => ({
    clubId: entry.clubId,
    club: entry.club!,
    tournaments: entry.seasonIds.size,
    goalsFor: entry.goalsFor,
    goalsAgainst: entry.goalsAgainst,
    yellowCards: entry.yellowCards,
    redCards: entry.redCards,
    cleanSheets: entry.cleanSheets,
    matchesPlayed: entry.matchesPlayed,
  }))

  rows.sort((left, right) => {
    if (right.tournaments !== left.tournaments) return right.tournaments - left.tournaments
    const leftDiff = left.goalsFor - left.goalsAgainst
    const rightDiff = right.goalsFor - right.goalsAgainst
    if (rightDiff !== leftDiff) return rightDiff - leftDiff
    if (right.goalsFor !== left.goalsFor) return right.goalsFor - left.goalsFor
    return left.club.name.localeCompare(right.club.name, 'ru')
  })

  return serializePrisma(rows)
}

async function getClubCareerTotals(competitionId?: number) {
  const cacheKey = competitionId
    ? competitionStatsCacheKey(competitionId, 'club-career')
    : 'league:club-career'
  return defaultCache.getWithMeta(
    cacheKey,
    () => loadClubCareerTotals(competitionId),
    CAREER_STATS_CACHE_TTL_SECONDS
  )
}

async function loadSeasonPlayerStats(seasonId: number) {
  const stats = await prisma.playerSeasonStats.findMany({
    where: { seasonId },
    include: { person: true, club: true },
    orderBy: [{ goals: 'desc' }, { matchesPlayed: 'asc' }, { assists: 'desc' }],
  })
  return serializePrisma(stats)
}

async function getSeasonPlayerStats(seasonId: number) {
  return defaultCache.getWithMeta(
    seasonStatsCacheKey(seasonId, 'player-stats'),
    () => loadSeasonPlayerStats(seasonId),
    SEASON_STATS_CACHE_TTL_SECONDS
  )
}

async function loadPlayerCareerStats(params: { competitionId?: number; clubId?: number }) {
  const { competitionId, clubId } = params

  let clubFilter: number[] | undefined

  if (competitionId) {
    const seasons = await prisma.season.findMany({
      where: { competitionId },
      select: { id: true },
    })

    if (!seasons.length) {
      return []
    }

    const participants = await prisma.seasonParticipant.findMany({
      where: { seasonId: { in: seasons.map(entry => entry.id) } },
      select: { clubId: true },
    })

    clubFilter = Array.from(new Set(participants.map(entry => entry.clubId)))
    if (!clubFilter.length) {
      return []
    }
  }

  const stats = await prisma.playerClubCareerStats.findMany({
    where: {
      ...(clubId ? { clubId } : {}),
      ...(clubFilter && clubFilter.length ? { clubId: { in: clubFilter } } : {}),
    },
    include: { person: true, club: true },
    orderBy: [{ totalGoals: 'desc' }, { totalAssists: 'desc' }],
  })

  return serializePrisma(stats)
}

async function getPlayerCareerStats(params: { competitionId?: number; clubId?: number }) {
  const cacheKey = params.clubId
    ? `club:${params.clubId}:player-career`
    : params.competitionId
      ? competitionStatsCacheKey(params.competitionId, 'player-career')
      : 'league:player-career'

  return defaultCache.getWithMeta(
    cacheKey,
    () => loadPlayerCareerStats(params),
    CAREER_STATS_CACHE_TTL_SECONDS
  )
}

const adminAuthHook = async (request: FastifyRequest, reply: FastifyReply) => {
  const authHeader = request.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ ok: false, error: 'unauthorized' })
  }
  const token = authHeader.slice('Bearer '.length)
  try {
    const payload = jwt.verify(token, getJwtSecret()) as { sub: string; role?: string }
    if (!payload.role || payload.role !== 'admin') {
      return reply.status(403).send({ ok: false, error: 'forbidden' })
    }
    request.admin = { sub: payload.sub, role: payload.role }
  } catch (err) {
    return reply.status(401).send({ ok: false, error: 'invalid_token' })
  }
}

export default async function (server: FastifyInstance) {
  server.post('/api/admin/login', async (request, reply) => {
    const { login, password } = (request.body || {}) as { login?: string; password?: string }

    if (!login || !password) {
      return reply.status(400).send({ ok: false, error: 'login_and_password_required' })
    }

    const expectedLogin = process.env.LOGIN_ADMIN
    const expectedPassword = process.env.PASSWORD_ADMIN

    if (!expectedLogin || !expectedPassword) {
      server.log.error('LOGIN_ADMIN or PASSWORD_ADMIN env variables are not configured')
      return reply.status(503).send({ ok: false, error: 'admin_auth_unavailable' })
    }

    const loginMatches = secureEquals(login, expectedLogin)
    const passwordMatches = secureEquals(password, expectedPassword)

    if (!loginMatches || !passwordMatches) {
      server.log.warn({ login }, 'admin login failed')
      return reply.status(401).send({ ok: false, error: 'invalid_credentials' })
    }

    const token = jwt.sign({ sub: 'admin', role: 'admin' }, getJwtSecret(), {
      expiresIn: '2h',
      issuer: 'obnliga-backend',
      audience: 'admin-dashboard',
    })

    return reply.send({ ok: true, token, expiresIn: 7200 })
  })

  server.post('/api/admin/test-login', async (request, reply) => {
    const headerSecret = (request.headers['x-admin-secret'] || '') as string
    const adminSecret = process.env.ADMIN_SECRET
    if (!adminSecret || headerSecret !== adminSecret) {
      return reply.status(403).send({ error: 'forbidden' })
    }

    const body = request.body as AdminTestLoginBody | undefined
    const userIdValue = body?.userId

    const userIdNumber =
      typeof userIdValue === 'string'
        ? Number(userIdValue)
        : typeof userIdValue === 'number'
          ? userIdValue
          : undefined

    if (userIdNumber === undefined || !Number.isFinite(userIdNumber) || userIdNumber <= 0) {
      return reply.status(400).send({ error: 'userId required' })
    }

    const userIdInt = Math.trunc(userIdNumber)
    const normalizedUsername =
      typeof body?.username === 'string' && body.username.trim().length > 0
        ? body.username
        : null
    const normalizedFirstName =
      typeof body?.firstName === 'string' && body.firstName.trim().length > 0
        ? body.firstName
        : null

    try {
      const user = await prisma.appUser.upsert({
        where: { id: userIdInt },
        create: {
          id: userIdInt,
          telegramId: BigInt(userIdInt),
          username: normalizedUsername,
          firstName: normalizedFirstName,
        },
        update: {
          username: normalizedUsername,
          firstName: normalizedFirstName,
        },
      })

      const token = jwt.sign({ sub: String(user.id), role: 'admin-tester' }, getJwtSecret(), {
        expiresIn: '7d',
      })
      return reply.send({ ok: true, user, token })
    } catch (err) {
      server.log.error({ err }, 'admin test-login failed')
      return reply.status(500).send({ error: 'internal' })
    }
  })

  server.register(
    async (admin: FastifyInstance) => {
      admin.addHook('onRequest', adminAuthHook)

      // Admin profile info
      admin.get('/me', async (request, reply) => {
        return reply.send({ ok: true, admin: request.admin })
      })

      // News management
      admin.post<{ Body: NewsCreateBody }>('/news', async (request, reply) => {
        const body = request.body ?? {}

        const title = body.title?.trim() ?? ''
        const content = body.content?.trim() ?? ''
        const coverUrlRaw = body.coverUrl ?? null
        const normalizedCoverUrl = coverUrlRaw ? String(coverUrlRaw).trim() : ''
        const coverUrl = normalizedCoverUrl.length > 0 ? normalizedCoverUrl : null
        const sendToTelegram = Boolean(body.sendToTelegram)

        if (!title) {
          return reply.status(400).send({ ok: false, error: 'news_title_required' })
        }
        if (title.length > 100) {
          return reply.status(400).send({ ok: false, error: 'news_title_too_long' })
        }
        if (!content) {
          return reply.status(400).send({ ok: false, error: 'news_content_required' })
        }

        const news = await prisma.news.create({
          data: {
            title,
            content,
            coverUrl,
            sendToTelegram,
          },
        })

        await defaultCache.invalidate(NEWS_CACHE_KEY)

        if (sendToTelegram) {
          try {
            const enqueueResult = await enqueueTelegramNewsJob({
              newsId: news.id.toString(),
              title: news.title,
              content: news.content,
              coverUrl: news.coverUrl ?? undefined,
            })

            if (!enqueueResult?.queued) {
              const directResult = await deliverTelegramNewsNow(
                {
                  newsId: news.id.toString(),
                  title: news.title,
                  content: news.content,
                  coverUrl: news.coverUrl ?? undefined,
                },
                admin.log
              )

              if (!directResult.delivered) {
                const details = {
                  newsId: news.id.toString(),
                  reason: directResult.reason,
                  sentCount: directResult.sentCount,
                  failedCount: directResult.failedCount,
                }
                const message =
                  directResult.reason === 'no_recipients'
                    ? 'telegram delivery skipped — no recipients'
                    : 'telegram delivery skipped — direct fallback unavailable'
                admin.log.warn(details, message)
              } else {
                admin.log.info(
                  {
                    newsId: news.id.toString(),
                    sentCount: directResult.sentCount,
                    failedCount: directResult.failedCount,
                  },
                  'telegram direct delivery completed'
                )
              }
            }
          } catch (err) {
            admin.log.error({ err, newsId: news.id.toString() }, 'failed to deliver telegram news')
          }
        }

        try {
          const payload = serializePrisma(news)
          if (typeof admin.publishTopic === 'function') {
            await admin.publishTopic('home', {
              type: 'news.full',
              payload,
            })
          }
        } catch (err) {
          admin.log.warn({ err }, 'failed to publish news websocket update')
        }

        reply.status(201)
        return sendSerialized(reply, news)
      })

      admin.patch<{ Params: NewsParams; Body: NewsUpdateBody }>(
        '/news/:newsId',
        async (request, reply) => {
          let newsId: bigint
          try {
            newsId = parseBigIntId(request.params.newsId, 'newsId')
          } catch (err) {
            return reply.status(400).send({ ok: false, error: 'news_id_invalid' })
          }

          const body = request.body ?? {}

          const existing = await prisma.news.findUnique({ where: { id: newsId } })
          if (!existing) {
            return reply.status(404).send({ ok: false, error: 'news_not_found' })
          }

          const updates: Record<string, unknown> = {}

          if (Object.prototype.hasOwnProperty.call(body, 'title')) {
            const raw = body.title?.trim() ?? ''
            if (!raw) {
              return reply.status(400).send({ ok: false, error: 'news_title_required' })
            }
            if (raw.length > 100) {
              return reply.status(400).send({ ok: false, error: 'news_title_too_long' })
            }
            if (raw !== existing.title) {
              updates.title = raw
            }
          }

          if (Object.prototype.hasOwnProperty.call(body, 'content')) {
            const raw = body.content?.trim() ?? ''
            if (!raw) {
              return reply.status(400).send({ ok: false, error: 'news_content_required' })
            }
            if (raw !== existing.content) {
              updates.content = raw
            }
          }

          if (Object.prototype.hasOwnProperty.call(body, 'coverUrl')) {
            const rawValue = body.coverUrl ?? null
            const normalized = rawValue === null ? null : String(rawValue).trim()
            const coverUrl = normalized && normalized.length > 0 ? normalized : null
            if (coverUrl !== (existing.coverUrl ?? null)) {
              updates.coverUrl = coverUrl
            }
          }

          if (Object.prototype.hasOwnProperty.call(body, 'sendToTelegram')) {
            const next = Boolean(body.sendToTelegram)
            if (next !== existing.sendToTelegram) {
              updates.sendToTelegram = next
            }
          }

          if (Object.keys(updates).length === 0) {
            return reply.status(400).send({ ok: false, error: 'news_update_payload_empty' })
          }

          const news = await prisma.news.update({
            where: { id: newsId },
            data: updates,
          })

          await defaultCache.invalidate(NEWS_CACHE_KEY)

          try {
            const payload = serializePrisma(news)
            if (typeof admin.publishTopic === 'function') {
              await admin.publishTopic('home', {
                type: 'news.full',
                payload,
              })
            }
          } catch (err) {
            admin.log.warn({ err }, 'failed to publish news update websocket event')
          }

          return sendSerialized(reply, news)
        }
      )

      admin.delete<{ Params: NewsParams }>('/news/:newsId', async (request, reply) => {
        let newsId: bigint
        try {
          newsId = parseBigIntId(request.params.newsId, 'newsId')
        } catch (err) {
          return reply.status(400).send({ ok: false, error: 'news_id_invalid' })
        }

        const existing = await prisma.news.findUnique({ where: { id: newsId } })
        if (!existing) {
          return reply.status(404).send({ ok: false, error: 'news_not_found' })
        }

        const deleted = await prisma.news.delete({ where: { id: newsId } })

        await defaultCache.invalidate(NEWS_CACHE_KEY)

        try {
          if (typeof admin.publishTopic === 'function') {
            await admin.publishTopic('home', {
              type: 'news.remove',
              payload: { id: deleted.id.toString() },
            })
          }
        } catch (err) {
          admin.log.warn({ err }, 'failed to publish news remove websocket event')
        }

        return sendSerialized(reply, deleted)
      })

      // Clubs CRUD
      admin.get('/clubs', async (_request, reply) => {
        const clubs = await prisma.club.findMany({ orderBy: { name: 'asc' } })
        return reply.send({ ok: true, data: clubs })
      })

      admin.post('/clubs', async (request, reply) => {
        const body = request.body as { name?: string; shortName?: string; logoUrl?: string }
        const name = body?.name?.trim()
        const shortName = body?.shortName?.trim()
        const logoUrl = body?.logoUrl?.trim()

        if (!name || !shortName) {
          return reply.status(400).send({ ok: false, error: 'name_and_short_name_required' })
        }

        try {
          const club = await prisma.club.create({
            data: {
              name,
              shortName,
              logoUrl: logoUrl || null,
            },
          })
          return reply.send({ ok: true, data: club })
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError) {
            if (err.code === 'P2002') {
              return reply.status(409).send({ ok: false, error: 'club_duplicate' })
            }
            if (err.code === 'P2000') {
              return reply.status(400).send({ ok: false, error: 'club_field_too_long' })
            }
          }
          request.server.log.error({ err }, 'club create failed')
          return reply.status(500).send({ ok: false, error: 'create_failed' })
        }
      })

      admin.put('/clubs/:clubId', async (request, reply) => {
        const clubId = parseNumericId((request.params as any).clubId, 'clubId')
        const body = request.body as { name?: string; shortName?: string; logoUrl?: string }
        try {
          const club = await prisma.club.update({
            where: { id: clubId },
            data: {
              name: body.name?.trim(),
              shortName: body.shortName?.trim(),
              logoUrl: body.logoUrl?.trim(),
            },
          })
          return reply.send({ ok: true, data: club })
        } catch (err) {
          request.server.log.error({ err }, 'club update failed')
          return reply.status(500).send({ ok: false, error: 'update_failed' })
        }
      })

      admin.delete('/clubs/:clubId', async (request, reply) => {
        const clubId = parseNumericId((request.params as any).clubId, 'clubId')
        const hasParticipants = await prisma.seasonParticipant.findFirst({ where: { clubId } })
        const hasFinishedMatches = await prisma.match.count({
          where: {
            status: MatchStatus.FINISHED,
            OR: [{ homeTeamId: clubId }, { awayTeamId: clubId }],
          },
        })
        if (hasParticipants) {
          return reply.status(409).send({ ok: false, error: 'club_in_active_season' })
        }
        if (hasFinishedMatches > 0) {
          return reply.status(409).send({ ok: false, error: 'club_in_finished_matches' })
        }
        await prisma.club.delete({ where: { id: clubId } })
        return reply.send({ ok: true })
      })

      admin.get('/clubs/:clubId/players', async (request, reply) => {
        const clubId = parseNumericId((request.params as any).clubId, 'clubId')
        const players = await prisma.clubPlayer.findMany({
          where: { clubId },
          orderBy: [{ defaultShirtNumber: 'asc' }, { personId: 'asc' }],
          include: { person: true },
        })
        return reply.send({ ok: true, data: players })
      })

      admin.put('/clubs/:clubId/players', async (request, reply) => {
        const clubId = parseNumericId((request.params as any).clubId, 'clubId')
        const body = request.body as {
          players?: Array<{ personId?: number; defaultShirtNumber?: number | null }>
        }

        const entries = Array.isArray(body?.players) ? body.players : []

        const normalized: Array<{ personId: number; defaultShirtNumber: number | null }> = []
        const seenPersons = new Set<number>()

        for (const entry of entries) {
          if (!entry?.personId || entry.personId <= 0) {
            return reply.status(400).send({ ok: false, error: 'personId_required' })
          }
          if (seenPersons.has(entry.personId)) {
            return reply.status(409).send({ ok: false, error: 'duplicate_person' })
          }
          seenPersons.add(entry.personId)

          const shirtNumber =
            entry.defaultShirtNumber && entry.defaultShirtNumber > 0
              ? Math.floor(entry.defaultShirtNumber)
              : null
          normalized.push({ personId: entry.personId, defaultShirtNumber: shirtNumber })
        }

        try {
          await prisma.$transaction(async tx => {
            if (!normalized.length) {
              await tx.clubPlayer.deleteMany({ where: { clubId } })
              await syncClubSeasonRosters(tx, clubId)
              return
            }

            const personIds = normalized.map(item => item.personId)

            await tx.clubPlayer.deleteMany({
              where: { clubId, personId: { notIn: personIds } },
            })

            for (const item of normalized) {
              await tx.clubPlayer.upsert({
                where: { clubId_personId: { clubId, personId: item.personId } },
                create: {
                  clubId,
                  personId: item.personId,
                  defaultShirtNumber: item.defaultShirtNumber,
                },
                update: {
                  defaultShirtNumber: item.defaultShirtNumber,
                },
              })
              await tx.playerClubCareerStats.upsert({
                where: { personId_clubId: { personId: item.personId, clubId } },
                create: {
                  personId: item.personId,
                  clubId,
                  totalGoals: 0,
                  totalMatches: 0,
                  totalAssists: 0,
                  yellowCards: 0,
                  redCards: 0,
                },
                update: {},
              })
            }

            await syncClubSeasonRosters(tx, clubId)
          })
        } catch (err) {
          const prismaErr = err as Prisma.PrismaClientKnownRequestError
          if (prismaErr?.code === 'P2002') {
            return reply.status(409).send({ ok: false, error: 'duplicate_shirt_number' })
          }
          request.server.log.error({ err }, 'club players update failed')
          return reply.status(500).send({ ok: false, error: 'club_players_update_failed' })
        }

        const players = await prisma.clubPlayer.findMany({
          where: { clubId },
          orderBy: [{ defaultShirtNumber: 'asc' }, { personId: 'asc' }],
          include: { person: true },
        })

        return reply.send({ ok: true, data: players })
      })

      admin.post('/clubs/:clubId/players/import', async (request, reply) => {
        const clubId = parseNumericId((request.params as any).clubId, 'clubId')
        const body = request.body as { lines?: unknown; text?: unknown }

        const rawLines: string[] = []
        if (Array.isArray(body?.lines)) {
          for (const item of body.lines) {
            if (typeof item === 'string') rawLines.push(item)
          }
        }
        if (typeof body?.text === 'string') {
          rawLines.push(
            ...body.text
              .split(/\r?\n/)
              .map(line => line.trim())
              .filter(line => line.length > 0)
          )
        }

        const normalizedLines = rawLines.map(line => line.trim()).filter(line => line.length > 0)
        if (!normalizedLines.length) {
          return reply.status(400).send({ ok: false, error: 'no_names_provided' })
        }
        if (normalizedLines.length > 200) {
          return reply.status(400).send({ ok: false, error: 'too_many_names' })
        }

        const parsedNames: Array<{ firstName: string; lastName: string }> = []
        try {
          for (const line of normalizedLines) {
            parsedNames.push(parseFullNameLine(line))
          }
        } catch (err) {
          return reply.status(400).send({ ok: false, error: 'invalid_full_name' })
        }

        const club = await prisma.club.findUnique({ where: { id: clubId } })
        if (!club) {
          return reply.status(404).send({ ok: false, error: 'club_not_found' })
        }

        try {
          await prisma.$transaction(async tx => {
            const nameKey = (firstName: string, lastName: string) =>
              `${lastName.toLowerCase()}|${firstName.toLowerCase()}`

            const uniqueEntries: Array<{ key: string; firstName: string; lastName: string }> = []
            const seenNames = new Set<string>()
            for (const entry of parsedNames) {
              const key = nameKey(entry.firstName, entry.lastName)
              if (seenNames.has(key)) continue
              seenNames.add(key)
              uniqueEntries.push({ key, firstName: entry.firstName, lastName: entry.lastName })
            }

            const existingPlayers = await tx.clubPlayer.findMany({
              where: { clubId },
              select: { defaultShirtNumber: true, personId: true },
            })

            const takenNumbers = new Set<number>()
            const clubPersonIds = new Set<number>()
            for (const player of existingPlayers) {
              if (player.defaultShirtNumber && player.defaultShirtNumber > 0) {
                takenNumbers.add(player.defaultShirtNumber)
              }
              clubPersonIds.add(player.personId)
            }

            const personsByKey = new Map<string, { id: number }>()
            if (uniqueEntries.length) {
              const existingPersons = await tx.person.findMany({
                where: {
                  OR: uniqueEntries.map(entry => ({
                    firstName: entry.firstName,
                    lastName: entry.lastName,
                  })),
                },
              })
              for (const person of existingPersons) {
                personsByKey.set(nameKey(person.firstName, person.lastName), person)
              }
            }

            const allocateNumber = () => {
              let candidate = 1
              while (takenNumbers.has(candidate)) {
                candidate += 1
              }
              takenNumbers.add(candidate)
              return candidate
            }

            for (const entry of uniqueEntries) {
              let person = personsByKey.get(entry.key)
              if (!person) {
                person = await tx.person.create({
                  data: {
                    firstName: entry.firstName,
                    lastName: entry.lastName,
                    isPlayer: true,
                  },
                })
                personsByKey.set(entry.key, person)
              }

              if (clubPersonIds.has(person.id)) {
                continue
              }

              await tx.clubPlayer.create({
                data: {
                  clubId,
                  personId: person.id,
                  defaultShirtNumber: allocateNumber(),
                },
              })
              await tx.playerClubCareerStats.upsert({
                where: { personId_clubId: { personId: person.id, clubId } },
                create: {
                  personId: person.id,
                  clubId,
                  totalGoals: 0,
                  totalMatches: 0,
                  totalAssists: 0,
                  yellowCards: 0,
                  redCards: 0,
                },
                update: {},
              })
              clubPersonIds.add(person.id)
            }

            await syncClubSeasonRosters(tx, clubId)
          })
        } catch (err) {
          request.server.log.error({ err }, 'club players import failed')
          return reply.status(500).send({ ok: false, error: 'club_players_import_failed' })
        }

        const players = await prisma.clubPlayer.findMany({
          where: { clubId },
          orderBy: [{ defaultShirtNumber: 'asc' }, { personId: 'asc' }],
          include: { person: true },
        })

        return sendSerialized(reply, players)
      })

      // Persons CRUD
      admin.get('/persons', async (request, reply) => {
        const { isPlayer } = request.query as { isPlayer?: string }
        const personsRaw = await prisma.person.findMany({
          where: typeof isPlayer === 'string' ? { isPlayer: isPlayer === 'true' } : undefined,
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
          include: {
            clubAffiliations: {
              orderBy: { createdAt: 'asc' },
              include: {
                club: {
                  select: {
                    id: true,
                    name: true,
                    shortName: true,
                    logoUrl: true,
                  },
                },
              },
            },
          },
        })

        const persons = personsRaw.map(person => {
          const { clubAffiliations, ...rest } = person
          const primary = clubAffiliations[0]
          const clubs = clubAffiliations.map(aff => ({
            id: aff.club.id,
            name: aff.club.name,
            shortName: aff.club.shortName,
            logoUrl: aff.club.logoUrl ?? null,
          }))

          return {
            ...rest,
            currentClubId: primary?.clubId ?? null,
            currentClub: primary
              ? {
                  id: primary.club.id,
                  name: primary.club.name,
                  shortName: primary.club.shortName,
                  logoUrl: primary.club.logoUrl ?? null,
                }
              : null,
            clubs,
          }
        })

        return reply.send({ ok: true, data: persons })
      })

      admin.post('/persons', async (request, reply) => {
        const body = request.body as { firstName?: string; lastName?: string; isPlayer?: boolean }
        if (!body?.firstName || !body?.lastName) {
          return reply.status(400).send({ ok: false, error: 'first_and_last_name_required' })
        }
        const person = await prisma.person.create({
          data: {
            firstName: body.firstName.trim(),
            lastName: body.lastName.trim(),
            isPlayer: body.isPlayer ?? true,
          },
        })
        return reply.send({ ok: true, data: person })
      })

      admin.put('/persons/:personId', async (request, reply) => {
        const personId = parseNumericId((request.params as any).personId, 'personId')
        const body = request.body as { firstName?: string; lastName?: string; isPlayer?: boolean }
        try {
          const person = await prisma.person.update({
            where: { id: personId },
            data: {
              firstName: body.firstName?.trim(),
              lastName: body.lastName?.trim(),
              isPlayer: body.isPlayer,
            },
          })
          return reply.send({ ok: true, data: person })
        } catch (err) {
          request.server.log.error({ err }, 'person update failed')
          return reply.status(500).send({ ok: false, error: 'update_failed' })
        }
      })

      admin.delete('/persons/:personId', async (request, reply) => {
        const personId = parseNumericId((request.params as any).personId, 'personId')
        const roster = await prisma.seasonRoster.findFirst({ where: { personId } })
        const lineup = await prisma.matchLineup.findFirst({ where: { personId } })
        if (roster || lineup) {
          return reply.status(409).send({ ok: false, error: 'person_has_history' })
        }
        await prisma.person.delete({ where: { id: personId } })
        return reply.send({ ok: true })
      })

      admin.post('/player-transfers', async (request, reply) => {
        const body = request.body as {
          transfers?: Array<{ personId?: number; toClubId?: number; fromClubId?: number | null }>
        }

        const entries = Array.isArray(body?.transfers) ? body.transfers : []
        if (!entries.length) {
          return reply.status(400).send({ ok: false, error: 'transfer_payload_empty' })
        }

        const normalized: Array<{ personId: number; toClubId: number; fromClubId: number | null }> =
          []
        const seenPersons = new Set<number>()

        try {
          for (const entry of entries) {
            const rawPersonId = entry?.personId
            const rawToClubId = entry?.toClubId
            const rawFromClubId = entry?.fromClubId

            let personId: number
            let toClubId: number
            try {
              personId = parseNumericId(rawPersonId as number, 'personId')
            } catch (err) {
              throw new TransferError('transfer_invalid_person')
            }

            try {
              toClubId = parseNumericId(rawToClubId as number, 'clubId')
            } catch (err) {
              throw new TransferError('transfer_invalid_club')
            }

            const fromClubId = parseOptionalNumericId(rawFromClubId, 'clubId')

            if (seenPersons.has(personId)) {
              throw new TransferError('transfer_duplicate_person')
            }
            seenPersons.add(personId)

            normalized.push({ personId, toClubId, fromClubId })
          }
        } catch (err) {
          if (err instanceof TransferError) {
            return reply.status(400).send({ ok: false, error: err.message })
          }
          throw err
        }

        const applied: TransferSummary[] = []
        const skipped: TransferSummary[] = []
        const affectedClubIds = new Set<number>()

        try {
          await prisma.$transaction(async tx => {
            for (const transfer of normalized) {
              const person = await tx.person.findUnique({
                where: { id: transfer.personId },
                include: {
                  clubAffiliations: {
                    include: {
                      club: {
                        select: {
                          id: true,
                          name: true,
                          shortName: true,
                        },
                      },
                    },
                    orderBy: { createdAt: 'asc' },
                  },
                },
              })

              if (!person) {
                throw new TransferError('transfer_person_not_found')
              }
              if (!person.isPlayer) {
                throw new TransferError('transfer_person_not_player')
              }

              const targetClub = await tx.club.findUnique({
                where: { id: transfer.toClubId },
                select: { id: true, name: true, shortName: true },
              })

              if (!targetClub) {
                throw new TransferError('transfer_club_not_found')
              }

              const affiliations = person.clubAffiliations || []
              let fromClubId = transfer.fromClubId
              let fromClub =
                fromClubId !== null
                  ? (affiliations.find(aff => aff.clubId === fromClubId)?.club ?? null)
                  : null

              if (fromClubId !== null && !fromClub) {
                throw new TransferError('transfer_from_club_mismatch')
              }

              if (fromClubId === null && affiliations.length > 0) {
                fromClubId = affiliations[0].clubId
                fromClub = affiliations[0].club
              }

              if (fromClubId === targetClub.id) {
                skipped.push({
                  personId: person.id,
                  person: { id: person.id, firstName: person.firstName, lastName: person.lastName },
                  fromClubId,
                  toClubId: targetClub.id,
                  fromClub: fromClub
                    ? { id: fromClub.id, name: fromClub.name, shortName: fromClub.shortName }
                    : null,
                  toClub: {
                    id: targetClub.id,
                    name: targetClub.name,
                    shortName: targetClub.shortName,
                  },
                  status: 'skipped',
                  reason: 'same_club',
                })
                continue
              }

              if (fromClubId !== null) {
                await tx.clubPlayer.deleteMany({
                  where: { clubId: fromClubId, personId: person.id },
                })
                affectedClubIds.add(fromClubId)
              }

              await tx.clubPlayer.upsert({
                where: { clubId_personId: { clubId: targetClub.id, personId: person.id } },
                create: {
                  clubId: targetClub.id,
                  personId: person.id,
                  defaultShirtNumber: null,
                },
                update: {
                  defaultShirtNumber: null,
                },
              })

              await tx.playerClubCareerStats.upsert({
                where: { personId_clubId: { personId: person.id, clubId: targetClub.id } },
                create: {
                  personId: person.id,
                  clubId: targetClub.id,
                  totalGoals: 0,
                  totalMatches: 0,
                  totalAssists: 0,
                  yellowCards: 0,
                  redCards: 0,
                },
                update: {},
              })

              affectedClubIds.add(targetClub.id)

              applied.push({
                personId: person.id,
                person: { id: person.id, firstName: person.firstName, lastName: person.lastName },
                fromClubId,
                toClubId: targetClub.id,
                fromClub: fromClub
                  ? { id: fromClub.id, name: fromClub.name, shortName: fromClub.shortName }
                  : null,
                toClub: {
                  id: targetClub.id,
                  name: targetClub.name,
                  shortName: targetClub.shortName,
                },
                status: 'moved',
              })
            }

            for (const clubId of affectedClubIds) {
              await syncClubSeasonRosters(tx, clubId)
            }
          })
        } catch (err) {
          if (err instanceof TransferError) {
            return reply.status(400).send({ ok: false, error: err.message })
          }
          request.server.log.error({ err }, 'player transfers failed')
          return reply.status(500).send({ ok: false, error: 'transfer_failed' })
        }

        let newsPayload: unknown = null
        if (applied.length) {
          try {
            const dateLabel = new Date().toLocaleDateString('ru-RU')
            const lines = applied
              .map(entry => {
                const fromLabel = entry.fromClub ? entry.fromClub.shortName : 'свободного статуса'
                const toLabel = entry.toClub ? entry.toClub.shortName : 'без клуба'
                return `• ${entry.person.lastName} ${entry.person.firstName}: ${fromLabel} → ${toLabel}`
              })
              .join('\n')

            const first = applied[0]
            const targetLabel = first.toClub ? first.toClub.shortName : 'новый клуб'
            const title =
              applied.length === 1
                ? `Трансфер: ${first.person.lastName} ${first.person.firstName} → ${targetLabel}`
                : `Трансферы (${dateLabel})`
            const content = `Завершены трансферные изменения:\n\n${lines}`

            const news = await prisma.news.create({
              data: {
                title,
                content,
                coverUrl: null,
                sendToTelegram: false,
              },
            })

            await defaultCache.invalidate(NEWS_CACHE_KEY)

            try {
              const payload = serializePrisma(news)
              await (admin as any).publishTopic?.('home', {
                type: 'news.full',
                payload,
              })
              newsPayload = payload
            } catch (publishErr) {
              admin.log.warn(
                { err: publishErr },
                'failed to publish transfer news websocket update'
              )
              newsPayload = serializePrisma(news)
            }
          } catch (newsErr) {
            admin.log.error({ err: newsErr }, 'failed to create transfer news')
          }
        }

        return reply.send({
          ok: true,
          data: {
            results: [...applied, ...skipped],
            movedCount: applied.length,
            skippedCount: skipped.length,
            affectedClubIds: Array.from(affectedClubIds),
            news: newsPayload,
          },
        })
      })

      // Stadiums
      admin.get('/stadiums', async (_request, reply) => {
        const stadiums = await prisma.stadium.findMany({ orderBy: { name: 'asc' } })
        return reply.send({ ok: true, data: stadiums })
      })

      admin.post('/stadiums', async (request, reply) => {
        const body = request.body as { name?: string; city?: string }
        if (!body?.name || !body?.city) {
          return reply.status(400).send({ ok: false, error: 'name_and_city_required' })
        }
        const stadium = await prisma.stadium.create({
          data: { name: body.name.trim(), city: body.city.trim() },
        })
        return reply.send({ ok: true, data: stadium })
      })

      admin.put('/stadiums/:stadiumId', async (request, reply) => {
        const stadiumId = parseNumericId((request.params as any).stadiumId, 'stadiumId')
        const body = request.body as { name?: string; city?: string }
        try {
          const stadium = await prisma.stadium.update({
            where: { id: stadiumId },
            data: { name: body.name?.trim(), city: body.city?.trim() },
          })
          return reply.send({ ok: true, data: stadium })
        } catch (err) {
          request.server.log.error({ err }, 'stadium update failed')
          return reply.status(500).send({ ok: false, error: 'update_failed' })
        }
      })

      admin.delete('/stadiums/:stadiumId', async (request, reply) => {
        const stadiumId = parseNumericId((request.params as any).stadiumId, 'stadiumId')
        const hasMatches = await prisma.match.findFirst({ where: { stadiumId } })
        if (hasMatches) {
          return reply.status(409).send({ ok: false, error: 'stadium_used_in_matches' })
        }
        await prisma.stadium.delete({ where: { id: stadiumId } })
        return reply.send({ ok: true })
      })

      // Competitions
      admin.get('/competitions', async (_request, reply) => {
        const competitions = await prisma.competition.findMany({ orderBy: { name: 'asc' } })
        return reply.send({ ok: true, data: competitions })
      })

      admin.post('/competitions', async (request, reply) => {
        const body = request.body as {
          name?: string
          type?: CompetitionType
          seriesFormat?: SeriesFormat
        }
        if (!body?.name || !body?.type || !body?.seriesFormat) {
          return reply.status(400).send({ ok: false, error: 'name_type_series_format_required' })
        }
        const competition = await prisma.competition.create({
          data: {
            name: body.name.trim(),
            type: body.type,
            seriesFormat: body.seriesFormat,
          },
        })
        return reply.send({ ok: true, data: competition })
      })

      admin.put('/competitions/:competitionId', async (request, reply) => {
        const competitionId = parseNumericId((request.params as any).competitionId, 'competitionId')
        const body = request.body as {
          name?: string
          type?: CompetitionType
          seriesFormat?: SeriesFormat
        }
        const hasActiveSeason = await prisma.season.findFirst({ where: { competitionId } })
        if (hasActiveSeason && body.seriesFormat && hasActiveSeason) {
          return reply.status(409).send({ ok: false, error: 'series_format_locked' })
        }
        const competition = await prisma.competition.update({
          where: { id: competitionId },
          data: {
            name: body.name?.trim(),
            type: body.type,
            seriesFormat: body.seriesFormat,
          },
        })
        return reply.send({ ok: true, data: competition })
      })

      admin.delete('/competitions/:competitionId', async (request, reply) => {
        const competitionId = parseNumericId((request.params as any).competitionId, 'competitionId')
        try {
          let seasonIds: number[] = []
          await prisma.$transaction(async tx => {
            const seasons = await tx.season.findMany({
              where: { competitionId },
              select: { id: true },
            })
            seasonIds = seasons.map(season => season.id)

            let clubIds: number[] = []
            if (seasonIds.length) {
              const participants = await tx.seasonParticipant.findMany({
                where: { seasonId: { in: seasonIds } },
                select: { clubId: true },
              })
              clubIds = Array.from(new Set(participants.map(entry => entry.clubId)))
            }

            await tx.season.deleteMany({ where: { competitionId } })
            await tx.competition.delete({ where: { id: competitionId } })

            if (clubIds.length) {
              await rebuildCareerStatsForClubs(clubIds, tx)
            }
          }, { timeout: 20000 })
          const cacheKeys = new Set<string>([
            `competition:${competitionId}:club-stats`,
            `competition:${competitionId}:player-stats`,
            `competition:${competitionId}:player-career`,
            ...seasonIds.flatMap(seasonId => [
              `season:${seasonId}:club-stats`,
              `season:${seasonId}:player-stats`,
              `season:${seasonId}:player-career`,
            ]),
          ])
          await Promise.all(
            Array.from(cacheKeys).map(key => defaultCache.invalidate(key).catch(() => undefined))
          )
          return reply.send({ ok: true })
        } catch (err) {
          request.server.log.error({ err, competitionId }, 'competition delete failed')
          return reply.status(500).send({ ok: false, error: 'competition_delete_failed' })
        }
      })

      // Seasons & configuration
      admin.get('/seasons', async (_request, reply) => {
        const seasons = await prisma.season.findMany({
          orderBy: [{ startDate: 'desc' }],
          include: {
            competition: true,
            participants: { include: { club: true } },
            rosters: {
              include: {
                person: true,
                club: true,
              },
              orderBy: [{ clubId: 'asc' }, { shirtNumber: 'asc' }],
            },
            groups: {
              include: {
                slots: {
                  include: {
                    club: {
                      select: { id: true, name: true, shortName: true, logoUrl: true },
                    },
                  },
                },
              },
              orderBy: { groupIndex: 'asc' },
            },
          },
        })
        return reply.send({ ok: true, data: seasons })
      })

      admin.post('/seasons', async (request, reply) => {
        const body = request.body as {
          competitionId?: number
          name?: string
          startDate?: string
          endDate?: string
          city?: string | null
        }
        if (!body?.competitionId || !body?.name || !body?.startDate || !body?.endDate) {
          return reply.status(400).send({ ok: false, error: 'season_fields_required' })
        }
        const competition = await prisma.competition.findUnique({
          where: { id: body.competitionId },
        })
        if (!competition) {
          return reply.status(404).send({ ok: false, error: 'competition_not_found' })
        }
        const cityValueRaw = typeof body.city === 'string' ? body.city.trim() : ''
        const normalizedCity = cityValueRaw ? cityValueRaw : null
        const season = await prisma.season.create({
          data: {
            competitionId: body.competitionId,
            name: body.name.trim(),
            startDate: new Date(body.startDate),
            endDate: new Date(body.endDate),
            city: normalizedCity,
            seriesFormat: competition.seriesFormat,
          },
        })
        return reply.send({ ok: true, data: season })
      })

      admin.post('/seasons/auto', async (request, reply) => {
        const body = request.body as {
          competitionId?: number
          seasonName?: string
          startDate?: string
          matchDayOfWeek?: number
          matchTime?: string
          clubIds?: number[]
          seriesFormat?: string
          city?: string | null
          groupStage?: {
            groupCount?: number
            groupSize?: number
            qualifyCount?: number
            groups?: Array<{
              groupIndex?: number
              label?: string
              qualifyCount?: number
              slots?: Array<{
                position?: number
                clubId?: number
              }>
            }>
          }
        }

        if (
          !body?.competitionId ||
          !body?.seasonName ||
          !body?.startDate ||
          typeof body.matchDayOfWeek !== 'number'
        ) {
          return reply.status(400).send({ ok: false, error: 'automation_fields_required' })
        }

        let clubIds = Array.isArray(body.clubIds)
          ? body.clubIds.map(id => Number(id)).filter(id => Number.isFinite(id) && id > 0)
          : []

        const competition = await prisma.competition.findUnique({
          where: { id: body.competitionId },
        })
        if (!competition) {
          return reply.status(404).send({ ok: false, error: 'competition_not_found' })
        }

        const allowedFormats = new Set(Object.values(SeriesFormat))
        const requestedFormat = typeof body.seriesFormat === 'string' ? body.seriesFormat : null
        const seriesFormat =
          requestedFormat && allowedFormats.has(requestedFormat as SeriesFormat)
            ? (requestedFormat as SeriesFormat)
            : competition.seriesFormat

        let groupStageConfig:
          | {
              groupCount: number
              groupSize: number
              qualifyCount: number
              groups: Array<{
                groupIndex: number
                label: string
                qualifyCount: number
                slots: Array<{ position: number; clubId: number }>
              }>
            }
          | undefined

        if (seriesFormat === SeriesFormat.GROUP_SINGLE_ROUND_PLAYOFF) {
          const rawGroupStage = body.groupStage
          if (!rawGroupStage || typeof rawGroupStage !== 'object') {
            return reply.status(400).send({ ok: false, error: 'group_stage_required' })
          }

          const rawGroups = Array.isArray(rawGroupStage.groups) ? rawGroupStage.groups : []
          const parsedGroups = rawGroups.map((group: any, index: number) => {
            const slotsRaw = Array.isArray(group?.slots) ? group.slots : []
            const slots = slotsRaw.map((slot: any, slotIndex: number) => ({
              position: Number(slot?.position ?? slotIndex + 1),
              clubId: Number(slot?.clubId ?? 0),
            }))
            return {
              groupIndex: Number(group?.groupIndex ?? index + 1),
              label: typeof group?.label === 'string' ? group.label : `Группа ${index + 1}`,
              qualifyCount: Number(group?.qualifyCount ?? rawGroupStage?.qualifyCount ?? 0),
              slots,
            }
          })

          groupStageConfig = {
            groupCount: Number(rawGroupStage.groupCount ?? parsedGroups.length),
            groupSize: Number(rawGroupStage.groupSize ?? parsedGroups[0]?.slots.length ?? 0),
            qualifyCount: Number(rawGroupStage.qualifyCount ?? parsedGroups[0]?.qualifyCount ?? 0),
            groups: parsedGroups,
          }

          clubIds = []
          for (const group of parsedGroups) {
            for (const slot of group.slots) {
              if (Number.isFinite(slot.clubId) && slot.clubId > 0) {
                clubIds.push(slot.clubId)
              }
            }
          }
        }

        if (clubIds.length < 2) {
          return reply.status(400).send({ ok: false, error: 'automation_needs_participants' })
        }

        const matchDay = Number(body.matchDayOfWeek)
        const normalizedMatchDay = ((matchDay % 7) + 7) % 7

        try {
          const result = await runSeasonAutomation(prisma, request.log, {
            competition,
            clubIds,
            seasonName: body.seasonName,
            startDateISO: body.startDate,
            matchDayOfWeek: normalizedMatchDay,
            matchTime: body.matchTime,
            city: typeof body.city === 'string' ? body.city.trim() : undefined,
            seriesFormat,
            groupStage: groupStageConfig,
          })

          return reply.send({ ok: true, data: result })
        } catch (err) {
          const error = err as Error & { code?: string }
          request.server.log.error({ err }, 'season automation failed')
          if (typeof error.message === 'string' && error.message.startsWith('group_stage_')) {
            return reply.status(400).send({ ok: false, error: error.message })
          }
          if ((error.message as string) === 'not_enough_participants') {
            return reply.status(400).send({ ok: false, error: 'automation_needs_participants' })
          }
          return reply.status(500).send({ ok: false, error: 'automation_failed' })
        }
      })

      admin.post('/seasons/:seasonId/playoffs', async (request, reply) => {
        const seasonId = parseNumericId((request.params as any).seasonId, 'seasonId')
        const body = request.body as { bestOfLength?: number }
        const bestOfLength = typeof body?.bestOfLength === 'number' ? body.bestOfLength : undefined

        try {
          const result = await createSeasonPlayoffs(prisma, request.log, { seasonId, bestOfLength })
          return reply.send({ ok: true, data: result })
        } catch (err) {
          const error = err as Error
          switch (error.message) {
            case 'season_not_found':
              return reply.status(404).send({ ok: false, error: 'season_not_found' })
            case 'playoffs_not_supported':
              return reply.status(409).send({ ok: false, error: 'playoffs_not_supported' })
            case 'series_already_exist':
              return reply.status(409).send({ ok: false, error: 'playoffs_already_exists' })
            case 'matches_not_finished':
              return reply.status(409).send({ ok: false, error: 'regular_season_not_finished' })
            case 'not_enough_participants':
            case 'not_enough_pairs':
              return reply.status(409).send({ ok: false, error: 'not_enough_participants' })
            default:
              request.server.log.error({ err, seasonId }, 'playoffs creation failed')
              return reply.status(500).send({ ok: false, error: 'playoffs_creation_failed' })
          }
        }
      })

      admin.put('/seasons/:seasonId', async (request, reply) => {
        const seasonId = parseNumericId((request.params as any).seasonId, 'seasonId')
        const body = request.body as {
          name?: string
          startDate?: string
          endDate?: string
          city?: string | null
        }
        const matchesPlayed = await prisma.match.findFirst({
          where: { seasonId, status: MatchStatus.FINISHED },
        })
        if (matchesPlayed && (body.startDate || body.endDate)) {
          return reply.status(409).send({ ok: false, error: 'season_dates_locked' })
        }
        const cityValue =
          body.city === undefined
            ? undefined
            : body.city === null
              ? null
              : typeof body.city === 'string'
                ? body.city.trim() || null
                : undefined
        const season = await prisma.season.update({
          where: { id: seasonId },
          data: {
            name: body.name?.trim(),
            startDate: body.startDate ? new Date(body.startDate) : undefined,
            endDate: body.endDate ? new Date(body.endDate) : undefined,
            city: cityValue,
          },
        })
        return reply.send({ ok: true, data: season })
      })

      admin.delete('/seasons/:seasonId', async (request, reply) => {
        const seasonId = parseNumericId((request.params as any).seasonId, 'seasonId')
        let competitionId: number | null = null

        try {
          await prisma.$transaction(
            async tx => {
              const season = await tx.season.findUnique({
                where: { id: seasonId },
                include: {
                  participants: { select: { clubId: true } },
                },
              })

              if (!season) {
                throw new RequestError(404, 'season_not_found')
              }

              if (season.isActive) {
                throw new RequestError(409, 'season_is_active')
              }

              competitionId = season.competitionId
              const clubIds = Array.from(new Set(season.participants.map(entry => entry.clubId)))

              await tx.season.delete({ where: { id: seasonId } })

              if (clubIds.length) {
                await rebuildCareerStatsForClubs(clubIds, tx)
              }
            },
            { timeout: 20000 }
          )

          const cacheKeys = new Set<string>([
            `season:${seasonId}:club-stats`,
            `season:${seasonId}:player-stats`,
            `season:${seasonId}:player-career`,
            leagueStatsCacheKey('club-career'),
            leagueStatsCacheKey('player-career'),
          ])

          if (competitionId) {
            cacheKeys.add(`competition:${competitionId}:club-stats`)
            cacheKeys.add(`competition:${competitionId}:player-stats`)
            cacheKeys.add(`competition:${competitionId}:player-career`)
          }

          await Promise.all(
            Array.from(cacheKeys).map(key => defaultCache.invalidate(key).catch(() => undefined))
          )

          await defaultCache.invalidate(PUBLIC_LEAGUE_SEASONS_KEY)
          await defaultCache.invalidate(PUBLIC_LEAGUE_TABLE_KEY)
          await defaultCache.invalidate(`${PUBLIC_LEAGUE_TABLE_KEY}:${seasonId}`)
          await defaultCache.invalidate(PUBLIC_LEAGUE_SCHEDULE_KEY)
          await defaultCache.invalidate(`${PUBLIC_LEAGUE_SCHEDULE_KEY}:${seasonId}`)
          await defaultCache.invalidate(PUBLIC_LEAGUE_RESULTS_KEY)
          await defaultCache.invalidate(`${PUBLIC_LEAGUE_RESULTS_KEY}:${seasonId}`)

          return reply.send({ ok: true })
        } catch (err) {
          if (err instanceof RequestError) {
            return reply.status(err.statusCode).send({ ok: false, error: err.message })
          }
          request.server.log.error({ err, seasonId }, 'season delete failed')
          return reply.status(500).send({ ok: false, error: 'season_delete_failed' })
        }
      })

      admin.post('/seasons/:seasonId/participants', async (request, reply) => {
        const seasonId = parseNumericId((request.params as any).seasonId, 'seasonId')
        const body = request.body as { clubId?: number }
        if (!body?.clubId) {
          return reply.status(400).send({ ok: false, error: 'clubId_required' })
        }
        try {
          const participant = await prisma.seasonParticipant.create({
            data: { seasonId, clubId: body.clubId },
          })
          return reply.send({ ok: true, data: participant })
        } catch (err) {
          request.server.log.error({ err }, 'season participant create failed')
          return reply.status(409).send({ ok: false, error: 'participant_exists_or_invalid' })
        }
      })

      admin.delete('/seasons/:seasonId/participants/:clubId', async (request, reply) => {
        const { seasonId: seasonParam, clubId: clubParam } = request.params as any
        const seasonId = parseNumericId(seasonParam, 'seasonId')
        const clubId = parseNumericId(clubParam, 'clubId')
        const matchPlayed = await prisma.match.findFirst({
          where: { seasonId, OR: [{ homeTeamId: clubId }, { awayTeamId: clubId }] },
        })
        if (matchPlayed) {
          return reply.status(409).send({ ok: false, error: 'club_already_played' })
        }
        await prisma.seasonParticipant.delete({ where: { seasonId_clubId: { seasonId, clubId } } })
        return reply.send({ ok: true })
      })

      admin.post('/seasons/:seasonId/roster', async (request, reply) => {
        const seasonId = parseNumericId((request.params as any).seasonId, 'seasonId')
        const body = request.body as {
          clubId?: number
          personId?: number
          shirtNumber?: number
          registrationDate?: string
        }
        if (!body?.clubId || !body?.personId || !body?.shirtNumber) {
          return reply.status(400).send({ ok: false, error: 'roster_fields_required' })
        }
        const person = await prisma.person.findUnique({ where: { id: body.personId } })
        if (!person?.isPlayer) {
          return reply.status(409).send({ ok: false, error: 'person_is_not_player' })
        }
        const entry = await prisma.seasonRoster.create({
          data: {
            seasonId,
            clubId: body.clubId,
            personId: body.personId,
            shirtNumber: body.shirtNumber,
            registrationDate: body.registrationDate ? new Date(body.registrationDate) : new Date(),
          },
        })
        return reply.send({ ok: true, data: entry })
      })

      admin.put('/seasons/:seasonId/roster/:personId', async (request, reply) => {
        const { seasonId: seasonParam, personId: personParam } = request.params as any
        const seasonId = parseNumericId(seasonParam, 'seasonId')
        const personId = parseNumericId(personParam, 'personId')
        const body = request.body as { clubId?: number; shirtNumber?: number }
        if (!body?.clubId || !body?.shirtNumber) {
          return reply.status(400).send({ ok: false, error: 'club_and_shirt_required' })
        }
        const entry = await prisma.seasonRoster.update({
          where: { seasonId_clubId_personId: { seasonId, clubId: body.clubId, personId } },
          data: { shirtNumber: body.shirtNumber },
        })
        return reply.send({ ok: true, data: entry })
      })

      admin.delete('/seasons/:seasonId/roster/:personId', async (request, reply) => {
        const { seasonId: seasonParam, personId: personParam } = request.params as any
        const { clubId: clubQuery } = request.query as { clubId?: string }
        if (!clubQuery) {
          return reply.status(400).send({ ok: false, error: 'clubId_required' })
        }
        const seasonId = parseNumericId(seasonParam, 'seasonId')
        const personId = parseNumericId(personParam, 'personId')
        const clubId = parseNumericId(clubQuery, 'clubId')
        await prisma.seasonRoster.delete({
          where: { seasonId_clubId_personId: { seasonId, clubId, personId } },
        })
        return reply.send({ ok: true })
      })

      // Match series management
      admin.get('/series', async (request, reply) => {
        const { seasonId } = request.query as { seasonId?: string }
        const where = seasonId ? { seasonId: Number(seasonId) } : undefined
        const series = await prisma.matchSeries.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }],
          include: { season: true },
        })
        return sendSerialized(reply, series)
      })

      admin.post('/series', async (request, reply) => {
        const body = request.body as {
          seasonId?: number
          stageName?: string
          homeClubId?: number
          awayClubId?: number
        }
        if (!body?.seasonId || !body?.stageName || !body?.homeClubId || !body?.awayClubId) {
          return reply.status(400).send({ ok: false, error: 'series_fields_required' })
        }
        const series = await prisma.matchSeries.create({
          data: {
            seasonId: body.seasonId,
            stageName: body.stageName.trim(),
            homeClubId: body.homeClubId,
            awayClubId: body.awayClubId,
            seriesStatus: SeriesStatus.IN_PROGRESS,
          },
        })
        return sendSerialized(reply, series)
      })

      admin.put('/series/:seriesId', async (request, reply) => {
        const seriesId = parseBigIntId((request.params as any).seriesId, 'seriesId')
        const body = request.body as { seriesStatus?: SeriesStatus; winnerClubId?: number }
        const series = await prisma.matchSeries.update({
          where: { id: seriesId },
          data: {
            seriesStatus: body.seriesStatus,
            winnerClubId: body.winnerClubId,
          },
        })
        return sendSerialized(reply, series)
      })

      admin.delete('/series/:seriesId', async (request, reply) => {
        const seriesId = parseBigIntId((request.params as any).seriesId, 'seriesId')
        const hasMatches = await prisma.match.findFirst({ where: { seriesId } })
        if (hasMatches) {
          return reply.status(409).send({ ok: false, error: 'series_has_matches' })
        }
        await prisma.matchSeries.delete({ where: { id: seriesId } })
        return reply.send({ ok: true })
      })

      // Matches
      admin.get('/matches', async (request, reply) => {
        const { seasonId, competitionId } = request.query as {
          seasonId?: string
          competitionId?: string
        }

        const where: Prisma.MatchWhereInput = {}
        if (seasonId) {
          where.seasonId = Number(seasonId)
        }
        if (competitionId) {
          where.season = { competitionId: Number(competitionId) }
        }

        const matches = await prisma.match.findMany({
          where: Object.keys(where).length ? where : undefined,
          orderBy: [{ matchDateTime: 'desc' }],
          include: {
            season: { select: { name: true, competitionId: true } },
            series: true,
            stadium: true,
            round: true,
          },
        })
        return sendSerialized(reply, matches)
      })


      admin.patch<{ Params: { seasonId: string } }>('/seasons/:seasonId/activate', async (request, reply) => {
        const rawSeasonId = request.params?.seasonId
        const seasonId = Number(rawSeasonId)
        if (!Number.isFinite(seasonId) || seasonId <= 0) {
          return reply.status(400).send({ ok: false, error: 'season_invalid' })
        }

        const season = await prisma.season.findUnique({
          where: { id: seasonId },
          include: { competition: true },
        })

        if (!season) {
          return reply.status(404).send({ ok: false, error: 'season_not_found' })
        }

        let previousActiveSeasonId: number | null = null
        await prisma.$transaction(async tx => {
          const previousActive = await tx.season.findFirst({
            where: { isActive: true },
            select: { id: true },
          })
          previousActiveSeasonId = previousActive?.id ?? null
          await tx.season.updateMany({ where: { isActive: true }, data: { isActive: false } })
          await tx.season.update({ where: { id: seasonId }, data: { isActive: true } })
        })

        const activatedSeason = { ...season, isActive: true }
        const table = await buildLeagueTable(activatedSeason)

        await defaultCache.invalidate(PUBLIC_LEAGUE_SEASONS_KEY)
        await defaultCache.invalidate(PUBLIC_LEAGUE_TABLE_KEY)
        await defaultCache.invalidate(`${PUBLIC_LEAGUE_TABLE_KEY}:${seasonId}`)
        await defaultCache.invalidate(PUBLIC_LEAGUE_SCHEDULE_KEY)
        await defaultCache.invalidate(`${PUBLIC_LEAGUE_SCHEDULE_KEY}:${seasonId}`)
        await defaultCache.invalidate(PUBLIC_LEAGUE_RESULTS_KEY)
        await defaultCache.invalidate(`${PUBLIC_LEAGUE_RESULTS_KEY}:${seasonId}`)
        if (previousActiveSeasonId && previousActiveSeasonId !== seasonId) {
          await defaultCache.invalidate(`${PUBLIC_LEAGUE_TABLE_KEY}:${previousActiveSeasonId}`)
          await defaultCache.invalidate(
            `${PUBLIC_LEAGUE_SCHEDULE_KEY}:${previousActiveSeasonId}`
          )
          await defaultCache.invalidate(
            `${PUBLIC_LEAGUE_RESULTS_KEY}:${previousActiveSeasonId}`
          )
        }
        await defaultCache.set(PUBLIC_LEAGUE_TABLE_KEY, table, PUBLIC_LEAGUE_TABLE_TTL_SECONDS)
        await defaultCache.set(
          `${PUBLIC_LEAGUE_TABLE_KEY}:${seasonId}`,
          table,
          PUBLIC_LEAGUE_TABLE_TTL_SECONDS
        )

        const publishTopic =
          typeof admin.publishTopic === 'function' ? admin.publishTopic.bind(admin) : undefined

        await refreshLeagueMatchAggregates(seasonId, { publishTopic })

        if (typeof admin.publishTopic === 'function') {
          try {
            await admin.publishTopic(PUBLIC_LEAGUE_TABLE_KEY, {
              type: 'league.table',
              seasonId: table.season.id,
              payload: table,
            })
          } catch (err) {
            admin.log.warn({ err }, 'failed to broadcast league table update')
          }
        }

        return sendSerialized(reply, {
          seasonId: table.season.id,
          season: activatedSeason,
          table,
        })
      })
      admin.post('/matches', async (request, reply) => {
        const body = request.body as {
          seasonId?: number
          seriesId?: bigint
          seriesMatchNumber?: number
          matchDateTime?: string
          homeTeamId?: number
          awayTeamId?: number
          stadiumId?: number
          refereeId?: number
          roundId?: number | null
        }
        if (!body?.seasonId || !body?.matchDateTime || !body?.homeTeamId || !body?.awayTeamId) {
          return reply.status(400).send({ ok: false, error: 'match_fields_required' })
        }
        const match = await prisma.match.create({
          data: {
            seasonId: body.seasonId,
            seriesId: body.seriesId ?? null,
            seriesMatchNumber: body.seriesMatchNumber ?? null,
            matchDateTime: new Date(body.matchDateTime),
            homeTeamId: body.homeTeamId,
            awayTeamId: body.awayTeamId,
            stadiumId: body.stadiumId ?? null,
            refereeId: body.refereeId ?? null,
            roundId: body.roundId ?? null,
            status: MatchStatus.SCHEDULED,
          },
        })

        const publishTopic =
          typeof admin.publishTopic === 'function' ? admin.publishTopic.bind(admin) : undefined

        try {
          await refreshLeagueMatchAggregates(match.seasonId, { publishTopic })
        } catch (err) {
          admin.log.warn(
            { err, seasonId: match.seasonId },
            'failed to refresh league aggregates after match create'
          )
        }

        return sendSerialized(reply, match)
      })

      admin.get('/friendly-matches', async (_request, reply) => {
        const friendlyMatches = await prisma.friendlyMatch.findMany({
          orderBy: [{ matchDateTime: 'desc' }],
          include: {
            stadium: true,
            referee: true,
          },
        })
        return sendSerialized(reply, friendlyMatches)
      })

      admin.post('/friendly-matches', async (request, reply) => {
        const body = request.body as {
          matchDateTime?: string
          homeTeamName?: string
          awayTeamName?: string
          stadiumId?: number
          refereeId?: number
          eventName?: string
        }

        const matchDate = body?.matchDateTime ? new Date(body.matchDateTime) : null
        const homeName = body?.homeTeamName?.trim()
        const awayName = body?.awayTeamName?.trim()

        if (!homeName || !awayName || !matchDate || Number.isNaN(matchDate.getTime())) {
          return reply.status(400).send({ ok: false, error: 'friendly_match_fields_required' })
        }

        if (homeName.toLowerCase() === awayName.toLowerCase()) {
          return reply.status(400).send({ ok: false, error: 'friendly_match_same_teams' })
        }

        const stadiumId = body?.stadiumId ? parseNumericId(body.stadiumId, 'stadiumId') : null
        const refereeId = body?.refereeId ? parseNumericId(body.refereeId, 'refereeId') : null
        const eventName = body?.eventName?.trim()

        const friendlyMatch = await prisma.friendlyMatch.create({
          data: {
            matchDateTime: matchDate,
            homeTeamName: homeName,
            awayTeamName: awayName,
            stadiumId,
            refereeId,
            eventName: eventName && eventName.length ? eventName : null,
          },
        })

        return sendSerialized(reply, friendlyMatch)
      })

      admin.delete('/friendly-matches/:matchId', async (request, reply) => {
        const matchId = parseBigIntId((request.params as any).matchId, 'matchId')
        const existing = await prisma.friendlyMatch.findUnique({ where: { id: matchId } })
        if (!existing) {
          return reply.status(404).send({ ok: false, error: 'friendly_match_not_found' })
        }
        await prisma.friendlyMatch.delete({ where: { id: matchId } })
        return reply.send({ ok: true })
      })

      admin.put('/matches/:matchId', async (request, reply) => {
        const matchId = parseBigIntId((request.params as any).matchId, 'matchId')
        const body = request.body as Partial<{
          matchDateTime: string
          homeScore: number
          awayScore: number
          status: MatchStatus
          stadiumId: number | null
          refereeId: number | null
          roundId: number | null
          isArchived: boolean
          hasPenaltyShootout: boolean
          penaltyHomeScore: number
          penaltyAwayScore: number
        }>

        const existing = await prisma.match.findUnique({
          where: { id: matchId },
          include: {
            season: {
              include: {
                competition: true,
              },
            },
          },
        })
        if (!existing) {
          return reply.status(404).send({ ok: false, error: 'match_not_found' })
        }

        const nextStatus = body.status ?? existing.status
        const scoreUpdateRequested = body.homeScore !== undefined || body.awayScore !== undefined
        const existingFinished = existing.status === MatchStatus.FINISHED
        const finishingNow = nextStatus === MatchStatus.FINISHED && !existingFinished
        const scoreUpdateAllowed = nextStatus === MatchStatus.LIVE || finishingNow

        if (scoreUpdateRequested && !scoreUpdateAllowed) {
          return reply
            .status(409)
            .send({
              ok: false,
              error: 'Изменение счёта доступно только при статусе «Идёт» до финального сохранения',
            })
        }

        const data: Prisma.MatchUncheckedUpdateInput = {
          matchDateTime: body.matchDateTime ? new Date(body.matchDateTime) : undefined,
          status: body.status ?? undefined,
          stadiumId: body.stadiumId ?? undefined,
          refereeId: body.refereeId ?? undefined,
          roundId: body.roundId ?? undefined,
          isArchived: typeof body.isArchived === 'boolean' ? body.isArchived : undefined,
        }

        const normalizeScore = (value: number | undefined, fallback: number | null): number => {
          if (value === undefined) {
            return Math.max(0, fallback ?? 0)
          }
          return Math.max(0, Math.trunc(value))
        }

        const shouldApplyScore = scoreUpdateRequested && scoreUpdateAllowed
        const appliedHomeScore = shouldApplyScore
          ? normalizeScore(body.homeScore, existing.homeScore)
          : existing.homeScore
        const appliedAwayScore = shouldApplyScore
          ? normalizeScore(body.awayScore, existing.awayScore)
          : existing.awayScore

        if (shouldApplyScore) {
          data.homeScore = appliedHomeScore
          data.awayScore = appliedAwayScore
        }

        const parsePenaltyScore = (value: unknown, fallback: number): number => {
          if (value === undefined || value === null || value === '') {
            return Math.max(0, fallback)
          }
          const numeric = typeof value === 'number' ? value : Number(value)
          if (!Number.isFinite(numeric) || numeric < 0) {
            throw new Error('penalty_scores_invalid')
          }
          return Math.max(0, Math.trunc(numeric))
        }

        const competition = existing.season?.competition
        const isBestOfSeries =
          competition?.type === CompetitionType.LEAGUE &&
          (competition.seriesFormat === SeriesFormat.BEST_OF_N ||
            competition.seriesFormat === SeriesFormat.DOUBLE_ROUND_PLAYOFF)

        const penaltyToggleRequested = body.hasPenaltyShootout !== undefined
        const penaltyScoreProvided =
          body.penaltyHomeScore !== undefined || body.penaltyAwayScore !== undefined
        const targetHasPenaltyShootout = penaltyToggleRequested
          ? Boolean(body.hasPenaltyShootout)
          : existing.hasPenaltyShootout

        let penaltyHomeScore = existing.penaltyHomeScore
        let penaltyAwayScore = existing.penaltyAwayScore

        if (targetHasPenaltyShootout) {
          if (!existing.seriesId || !isBestOfSeries) {
            return reply.status(409).send({ ok: false, error: 'penalty_shootout_not_available' })
          }

          if (appliedHomeScore !== appliedAwayScore) {
            return reply.status(409).send({ ok: false, error: 'penalty_requires_draw' })
          }

          try {
            penaltyHomeScore = parsePenaltyScore(body.penaltyHomeScore, penaltyHomeScore)
            penaltyAwayScore = parsePenaltyScore(body.penaltyAwayScore, penaltyAwayScore)
          } catch (err) {
            return reply.status(400).send({ ok: false, error: 'penalty_scores_invalid' })
          }

          if (penaltyHomeScore === penaltyAwayScore) {
            return reply.status(409).send({ ok: false, error: 'penalty_scores_required' })
          }
        } else if (penaltyToggleRequested || existing.hasPenaltyShootout || penaltyScoreProvided) {
          penaltyHomeScore = 0
          penaltyAwayScore = 0
        }

        data.hasPenaltyShootout = targetHasPenaltyShootout
        data.penaltyHomeScore = targetHasPenaltyShootout ? penaltyHomeScore : 0
        data.penaltyAwayScore = targetHasPenaltyShootout ? penaltyAwayScore : 0

        const updated = await prisma.match.update({
          where: { id: matchId },
          data,
        })

        const publishTopic =
          typeof request.server.publishTopic === 'function'
            ? request.server.publishTopic.bind(request.server)
            : undefined

        if (nextStatus !== MatchStatus.FINISHED || existing.status === MatchStatus.FINISHED) {
          try {
            await refreshLeagueMatchAggregates(existing.seasonId, { publishTopic })
          } catch (err) {
            request.server.log.warn(
              { err, matchId: matchId.toString(), seasonId: existing.seasonId },
              'failed to refresh league aggregates after match update'
            )
          }
        }

        if (body.status === MatchStatus.FINISHED && existing.status !== MatchStatus.FINISHED) {
          await handleMatchFinalization(matchId, request.server.log, { publishTopic })
        }

        return sendSerialized(reply, updated)
      })

      admin.delete('/matches/:matchId', async (request, reply) => {
        const matchId = parseBigIntId((request.params as any).matchId, 'matchId')
        const match = await prisma.match.findUnique({ where: { id: matchId } })
        if (!match) return reply.status(404).send({ ok: false, error: 'match_not_found' })
        if (match.status === MatchStatus.FINISHED) {
          return reply.status(409).send({ ok: false, error: 'finished_match_locked' })
        }
        await prisma.match.delete({ where: { id: matchId } })

        const publishTopic =
          typeof request.server.publishTopic === 'function'
            ? request.server.publishTopic.bind(request.server)
            : undefined

        try {
          await refreshLeagueMatchAggregates(match.seasonId, { publishTopic })
        } catch (err) {
          request.server.log.warn(
            { err, matchId: matchId.toString(), seasonId: match.seasonId },
            'failed to refresh league aggregates after match delete'
          )
        }

        return reply.send({ ok: true })
      })

      // Lineups
      admin.get('/matches/:matchId/lineup', async (request, reply) => {
        const matchId = parseBigIntId((request.params as any).matchId, 'matchId')
        try {
          const enriched = await loadMatchLineupWithNumbers(matchId)
          return sendSerialized(reply, enriched)
        } catch (err) {
          if (err instanceof RequestError) {
            return reply.status(err.statusCode).send({ ok: false, error: err.message })
          }
          request.log.error({ err, matchId: matchId.toString() }, 'match lineup fetch failed')
          return reply.status(500).send({ ok: false, error: 'match_lineup_failed' })
        }
      })

      admin.put('/matches/:matchId/lineup', async (request, reply) => {
        const matchId = parseBigIntId((request.params as any).matchId, 'matchId')
        const body = request.body as {
          personId?: number
          clubId?: number
          role?: LineupRole
          position?: string
        }
        if (!body?.personId || !body?.clubId || !body?.role) {
          return reply.status(400).send({ ok: false, error: 'lineup_fields_required' })
        }
        const entry = await prisma.matchLineup.upsert({
          where: { matchId_personId: { matchId, personId: body.personId } },
          create: {
            matchId,
            personId: body.personId,
            clubId: body.clubId,
            role: body.role,
            position: body.position ?? null,
          },
          update: {
            clubId: body.clubId,
            role: body.role,
            position: body.position ?? null,
          },
        })
        return sendSerialized(reply, entry)
      })

      admin.delete('/matches/:matchId/lineup/:personId', async (request, reply) => {
        const matchId = parseBigIntId((request.params as any).matchId, 'matchId')
        const personId = parseNumericId((request.params as any).personId, 'personId')
        await prisma.matchLineup.delete({ where: { matchId_personId: { matchId, personId } } })
        return reply.send({ ok: true })
      })

      admin.get('/matches/:matchId/statistics', async (request, reply) => {
        const matchId = parseBigIntId((request.params as any).matchId, 'matchId')
        try {
          const { value, version } = await getMatchStatisticsWithMeta(matchId)
          const serialized = serializePrisma(value)
          reply.header('X-Resource-Version', String(version))
          return reply.send({ ok: true, data: serialized, meta: { version } })
        } catch (err) {
          if (err instanceof RequestError) {
            return reply.status(err.statusCode).send({ ok: false, error: err.message })
          }
          request.server.log.error(
            { err, matchId: matchId.toString() },
            'match statistics fetch failed'
          )
          return reply.status(500).send({ ok: false, error: 'match_statistics_failed' })
        }
      })

      admin.post('/matches/:matchId/statistics/adjust', async (request, reply) => {
        const matchId = parseBigIntId((request.params as any).matchId, 'matchId')
        const body = request.body as {
          clubId?: number
          metric?: string
          delta?: number
        }

        const clubId = body?.clubId !== undefined ? parseNumericId(body.clubId, 'clubId') : null
        if (!clubId) {
          return reply.status(400).send({ ok: false, error: 'clubId_required' })
        }

        const metric = body?.metric as MatchStatisticMetric | undefined
        if (!metric || !matchStatisticMetrics.includes(metric)) {
          return reply.status(400).send({ ok: false, error: 'metric_invalid' })
        }

        const rawDelta = body?.delta
        if (
          typeof rawDelta !== 'number' ||
          Number.isNaN(rawDelta) ||
          !Number.isFinite(rawDelta) ||
          rawDelta === 0
        ) {
          return reply.status(400).send({ ok: false, error: 'delta_invalid' })
        }
        const delta = Math.max(-20, Math.min(20, Math.trunc(rawDelta)))

        const now = new Date()
        await cleanupExpiredMatchStatistics(now).catch(() => undefined)

        const match = await prisma.match.findUnique({
          where: { id: matchId },
          select: {
            id: true,
            homeTeamId: true,
            awayTeamId: true,
            status: true,
            matchDateTime: true,
          },
        })

        if (!match) {
          return reply.status(404).send({ ok: false, error: 'match_not_found' })
        }

        if (hasMatchStatisticsExpired(match.matchDateTime, now)) {
          await prisma.matchStatistic.deleteMany({ where: { matchId } }).catch(() => undefined)
          await defaultCache.invalidate(matchStatsCacheKey(matchId)).catch(() => undefined)
          return reply
            .status(409)
            .send({ ok: false, error: 'Статистика матча устарела и была удалена' })
        }

        if (clubId !== match.homeTeamId && clubId !== match.awayTeamId) {
          return reply.status(400).send({ ok: false, error: 'club_not_in_match' })
        }

        let adjusted = false
        try {
          adjusted = await prisma.$transaction(tx =>
            applyStatisticDelta(tx, matchId, clubId, metric, delta)
          )
        } catch (err) {
          request.server.log.error(
            { err, matchId: matchId.toString(), clubId, metric, delta },
            'match statistic adjust failed'
          )
          return reply.status(500).send({ ok: false, error: 'match_statistics_update_failed' })
        }

        if (adjusted) {
          try {
            const { serialized, version } = await broadcastMatchStatistics(request.server, matchId)
            reply.header('X-Resource-Version', String(version))
            return reply.send({ ok: true, data: serialized, meta: { version } })
          } catch (err) {
            if (err instanceof RequestError) {
              return reply.status(err.statusCode).send({ ok: false, error: err.message })
            }
            request.server.log.error(
              { err, matchId: matchId.toString() },
              'match statistics reload failed'
            )
            return reply.status(500).send({ ok: false, error: 'match_statistics_failed' })
          }
        }

        try {
          const { value, version } = await getMatchStatisticsWithMeta(matchId)
          const serialized = serializePrisma(value)
          reply.header('X-Resource-Version', String(version))
          return reply.send({ ok: true, data: serialized, meta: { version } })
        } catch (err) {
          if (err instanceof RequestError) {
            return reply.status(err.statusCode).send({ ok: false, error: err.message })
          }
          request.server.log.error(
            { err, matchId: matchId.toString() },
            'match statistics reload failed'
          )
          return reply.status(500).send({ ok: false, error: 'match_statistics_failed' })
        }
      })

      // Events
      admin.get('/matches/:matchId/events', async (request, reply) => {
        const matchId = parseBigIntId((request.params as any).matchId, 'matchId')
        const match = await prisma.match.findUnique({
          where: { id: matchId },
          select: { seasonId: true },
        })
        if (!match) {
          return reply.status(404).send({ ok: false, error: 'match_not_found' })
        }

        const events = await prisma.matchEvent.findMany({
          where: { matchId },
          orderBy: [{ minute: 'asc' }, { id: 'asc' }],
          include: {
            player: true,
            relatedPerson: true,
            team: true,
          },
        })

        if (events.length === 0) {
          return sendSerialized(reply, events)
        }

        const personIds = new Set<number>()
        for (const event of events) {
          personIds.add(event.playerId)
          if (event.relatedPlayerId) {
            personIds.add(event.relatedPlayerId)
          }
        }

        const rosterNumbers = await prisma.seasonRoster.findMany({
          where: {
            seasonId: match.seasonId,
            personId: { in: Array.from(personIds) },
          },
          select: { personId: true, shirtNumber: true },
        })

        const shirtMap = new Map<number, number>()
        rosterNumbers.forEach(entry => {
          shirtMap.set(entry.personId, entry.shirtNumber)
        })

        const enriched = events.map(event => {
          const playerShirt = shirtMap.get(event.playerId) ?? null
          const relatedShirt = event.relatedPlayerId
            ? (shirtMap.get(event.relatedPlayerId) ?? null)
            : null
          return {
            ...event,
            player: {
              ...event.player,
              shirtNumber: playerShirt,
            },
            relatedPerson: event.relatedPerson
              ? {
                  ...event.relatedPerson,
                  shirtNumber: relatedShirt,
                }
              : event.relatedPerson,
          }
        })

        return sendSerialized(reply, enriched)
      })

      admin.post('/matches/:matchId/events', async (request, reply) => {
        const matchId = parseBigIntId((request.params as any).matchId, 'matchId')
        const body = request.body as {
          playerId?: number
          teamId?: number
          minute?: number
          eventType?: MatchEventType
          relatedPlayerId?: number | null
        }
        if (!body?.playerId || !body?.teamId || !body?.minute || !body?.eventType) {
          return reply.status(400).send({ ok: false, error: 'event_fields_required' })
        }

        let created: { event: MatchEvent; statAdjusted: boolean }
        try {
          created = await createMatchEvent(matchId, {
            playerId: body.playerId,
            teamId: body.teamId,
            minute: body.minute,
            eventType: body.eventType,
            relatedPlayerId: body.relatedPlayerId ?? null,
          })
        } catch (err) {
          if (err instanceof RequestError) {
            return reply.status(err.statusCode).send({ ok: false, error: err.message })
          }
          request.server.log.error(
            { err, matchId: matchId.toString() },
            'match event create failed'
          )
          return reply.status(500).send({ ok: false, error: 'event_create_failed' })
        }

        if (created.statAdjusted) {
          await broadcastMatchStatistics(request.server, matchId).catch(err => {
            request.server.log.error(
              { err, matchId: matchId.toString() },
              'match statistics broadcast failed'
            )
          })
        }

        const match = await prisma.match.findUnique({ where: { id: matchId } })
        if (match?.status === MatchStatus.FINISHED) {
          const publishTopic =
            typeof request.server.publishTopic === 'function'
              ? request.server.publishTopic.bind(request.server)
              : undefined
          await handleMatchFinalization(matchId, request.server.log, { publishTopic })
        }

        return sendSerialized(reply, created.event)
      })

      admin.put('/matches/:matchId/events/:eventId', async (request, reply) => {
        const matchId = parseBigIntId((request.params as any).matchId, 'matchId')
        const eventId = parseBigIntId((request.params as any).eventId, 'eventId')
        const body = request.body as Partial<{
          minute: number
          eventType: MatchEventType
          teamId: number
          playerId: number
          relatedPlayerId: number | null
        }>

        let updated: { event: MatchEvent; statAdjusted: boolean }
        try {
          updated = await updateMatchEvent(matchId, eventId, {
            minute: body.minute,
            eventType: body.eventType,
            teamId: body.teamId,
            playerId: body.playerId,
            relatedPlayerId: body.relatedPlayerId,
          })
        } catch (err) {
          if (err instanceof RequestError) {
            return reply.status(err.statusCode).send({ ok: false, error: err.message })
          }
          request.server.log.error(
            { err, matchId: matchId.toString(), eventId: eventId.toString() },
            'match event update failed'
          )
          return reply.status(500).send({ ok: false, error: 'event_update_failed' })
        }

        if (updated.statAdjusted) {
          await broadcastMatchStatistics(request.server, matchId).catch(err => {
            request.server.log.error(
              { err, matchId: matchId.toString() },
              'match statistics broadcast failed'
            )
          })
        }

        const match = await prisma.match.findUnique({ where: { id: matchId } })
        if (match?.status === MatchStatus.FINISHED) {
          const publishTopic =
            typeof request.server.publishTopic === 'function'
              ? request.server.publishTopic.bind(request.server)
              : undefined
          await handleMatchFinalization(matchId, request.server.log, { publishTopic })
        }

        return sendSerialized(reply, updated.event)
      })

      admin.delete('/matches/:matchId/events/:eventId', async (request, reply) => {
        const matchId = parseBigIntId((request.params as any).matchId, 'matchId')
        const eventId = parseBigIntId((request.params as any).eventId, 'eventId')
        let result: { statAdjusted: boolean; deleted: true }
        try {
          result = await deleteMatchEvent(matchId, eventId)
        } catch (err) {
          if (err instanceof RequestError) {
            return reply.status(err.statusCode).send({ ok: false, error: err.message })
          }
          request.server.log.error(
            { err, matchId: matchId.toString(), eventId: eventId.toString() },
            'match event delete failed'
          )
          return reply.status(500).send({ ok: false, error: 'event_delete_failed' })
        }

        if (result.statAdjusted) {
          await broadcastMatchStatistics(request.server, matchId).catch(err => {
            request.server.log.error(
              { err, matchId: matchId.toString() },
              'match statistics broadcast failed'
            )
          })
        }

        const match = await prisma.match.findUnique({ where: { id: matchId } })
        if (match?.status === MatchStatus.FINISHED) {
          const publishTopic =
            typeof request.server.publishTopic === 'function'
              ? request.server.publishTopic.bind(request.server)
              : undefined
          await handleMatchFinalization(matchId, request.server.log, { publishTopic })
        }

        return reply.send({ ok: true })
      })

      // Stats read-only
      admin.get('/stats/club-season', async (request, reply) => {
        const { seasonId, competitionId } = request.query as {
          seasonId?: string
          competitionId?: string
        }

        let resolvedSeasonId: number | undefined
        if (seasonId) {
          const numeric = Number(seasonId)
          if (Number.isFinite(numeric) && numeric > 0) {
            resolvedSeasonId = numeric
          }
        } else if (competitionId) {
          const numeric = Number(competitionId)
          if (Number.isFinite(numeric) && numeric > 0) {
            const latestSeason = await prisma.season.findFirst({
              where: { competitionId: numeric },
              orderBy: { startDate: 'desc' },
            })
            resolvedSeasonId = latestSeason?.id
          }
        }

        if (!resolvedSeasonId) {
          return reply.status(400).send({ ok: false, error: 'season_or_competition_required' })
        }

        try {
          const { value, version } = await getSeasonClubStats(resolvedSeasonId)
          reply.header('X-Resource-Version', String(version))
          return reply.send({ ok: true, data: value, meta: { version } })
        } catch (err) {
          if (err instanceof RequestError) {
            return reply.status(err.statusCode).send({ ok: false, error: err.message })
          }
          throw err
        }
      })

      admin.get('/stats/club-career', async (request, reply) => {
        const { competitionId } = request.query as { competitionId?: string }

        let resolvedCompetitionId: number | undefined
        if (competitionId) {
          const numeric = Number(competitionId)
          if (!Number.isFinite(numeric) || numeric <= 0) {
            return reply.status(400).send({ ok: false, error: 'competition_invalid' })
          }
          resolvedCompetitionId = numeric
        }

        const { value, version } = await getClubCareerTotals(resolvedCompetitionId)
        reply.header('X-Resource-Version', String(version))
        return reply.send({ ok: true, data: value, meta: { version } })
      })

      admin.get('/stats/player-season', async (request, reply) => {
        const { seasonId, competitionId } = request.query as {
          seasonId?: string
          competitionId?: string
        }

        let resolvedSeasonId: number | undefined
        if (seasonId) {
          const numeric = Number(seasonId)
          if (Number.isFinite(numeric) && numeric > 0) {
            resolvedSeasonId = numeric
          }
        } else if (competitionId) {
          const numeric = Number(competitionId)
          if (Number.isFinite(numeric) && numeric > 0) {
            const latestSeason = await prisma.season.findFirst({
              where: { competitionId: numeric },
              orderBy: { startDate: 'desc' },
            })
            resolvedSeasonId = latestSeason?.id
          }
        }

        if (!resolvedSeasonId) {
          return reply.status(400).send({ ok: false, error: 'season_or_competition_required' })
        }

        const { value, version } = await getSeasonPlayerStats(resolvedSeasonId)
        reply.header('X-Resource-Version', String(version))
        return reply.send({ ok: true, data: value, meta: { version } })
      })

      admin.get('/stats/player-career', async (request, reply) => {
        const { clubId, competitionId } = request.query as {
          clubId?: string
          competitionId?: string
        }

        let resolvedClubId: number | undefined
        if (clubId) {
          const numeric = Number(clubId)
          if (!Number.isFinite(numeric) || numeric <= 0) {
            return reply.status(400).send({ ok: false, error: 'club_invalid' })
          }
          resolvedClubId = numeric
        }

        let resolvedCompetitionId: number | undefined
        if (competitionId) {
          const numeric = Number(competitionId)
          if (!Number.isFinite(numeric) || numeric <= 0) {
            return reply.status(400).send({ ok: false, error: 'competition_invalid' })
          }
          resolvedCompetitionId = numeric
        }

        const { value, version } = await getPlayerCareerStats({
          competitionId: resolvedCompetitionId,
          clubId: resolvedClubId,
        })
        reply.header('X-Resource-Version', String(version))
        return reply.send({ ok: true, data: value, meta: { version } })
      })

      // Users & predictions
      admin.get('/users', async (_request, reply) => {
        const users = await prisma.appUser.findMany({
          orderBy: { createdAt: 'desc' },
        })
        return sendSerialized(reply, users)
      })

      admin.put('/users/:userId', async (request, reply) => {
        const userId = parseNumericId((request.params as any).userId, 'userId')
        const body = request.body as {
          firstName?: string
          currentStreak?: number
          totalPredictions?: number
        }
        const user = await prisma.appUser.update({
          where: { id: userId },
          data: {
            firstName: body.firstName ?? undefined,
            currentStreak: body.currentStreak ?? undefined,
            totalPredictions: body.totalPredictions ?? undefined,
          },
        })
        return sendSerialized(reply, user)
      })

      admin.get('/predictions', async (request, reply) => {
        const { matchId, userId } = request.query as { matchId?: string; userId?: string }
        const predictions = await prisma.prediction.findMany({
          where: {
            matchId: matchId ? BigInt(matchId) : undefined,
            userId: userId ? Number(userId) : undefined,
          },
          include: { user: true },
        })
        return sendSerialized(reply, predictions)
      })

      admin.put('/predictions/:predictionId', async (request, reply) => {
        const predictionId = parseBigIntId((request.params as any).predictionId, 'predictionId')
        const body = request.body as { isCorrect?: boolean; pointsAwarded?: number }
        const prediction = await prisma.prediction.update({
          where: { id: predictionId },
          data: {
            isCorrect: body.isCorrect ?? undefined,
            pointsAwarded: body.pointsAwarded ?? undefined,
          },
        })
        return sendSerialized(reply, prediction)
      })

      // Achievements
      admin.get('/achievements/types', async (_request, reply) => {
        const types = await prisma.achievementType.findMany({ orderBy: { name: 'asc' } })
        return reply.send({ ok: true, data: types })
      })

      admin.post('/achievements/types', async (request, reply) => {
        const body = request.body as {
          name?: string
          description?: string
          requiredValue?: number
          metric?: AchievementMetric
        }
        if (!body?.name || !body?.requiredValue || !body?.metric) {
          return reply.status(400).send({ ok: false, error: 'achievement_fields_required' })
        }
        const type = await prisma.achievementType.create({
          data: {
            name: body.name.trim(),
            description: body.description?.trim() ?? null,
            requiredValue: body.requiredValue,
            metric: body.metric,
          },
        })
        return reply.send({ ok: true, data: type })
      })

      admin.put('/achievements/types/:achievementTypeId', async (request, reply) => {
        const achievementTypeId = parseNumericId(
          (request.params as any).achievementTypeId,
          'achievementTypeId'
        )
        const body = request.body as {
          name?: string
          description?: string
          requiredValue?: number
          metric?: AchievementMetric
        }
        const type = await prisma.achievementType.update({
          where: { id: achievementTypeId },
          data: {
            name: body.name?.trim(),
            description: body.description?.trim(),
            requiredValue: body.requiredValue ?? undefined,
            metric: body.metric ?? undefined,
          },
        })
        await recomputeAchievementsForType(achievementTypeId)
        return reply.send({ ok: true, data: type })
      })

      admin.delete('/achievements/types/:achievementTypeId', async (request, reply) => {
        const achievementTypeId = parseNumericId(
          (request.params as any).achievementTypeId,
          'achievementTypeId'
        )
        await prisma.userAchievement.deleteMany({ where: { achievementTypeId } })
        await prisma.achievementType.delete({ where: { id: achievementTypeId } })
        return reply.send({ ok: true })
      })

      admin.get('/achievements/users', async (_request, reply) => {
        const achievements = await prisma.userAchievement.findMany({
          include: {
            user: true,
            achievementType: true,
          },
          orderBy: { achievedDate: 'desc' },
        })
        return reply.send({ ok: true, data: achievements })
      })

      admin.delete('/achievements/users/:userId/:achievementTypeId', async (request, reply) => {
        const { userId: userParam, achievementTypeId: typeParam } = request.params as any
        const userId = parseNumericId(userParam, 'userId')
        const achievementTypeId = parseNumericId(typeParam, 'achievementTypeId')
        await prisma.userAchievement.delete({
          where: { userId_achievementTypeId: { userId, achievementTypeId } },
        })
        return reply.send({ ok: true })
      })

      // Disqualifications
      admin.get('/disqualifications', async (_request, reply) => {
        const disqualifications = await prisma.disqualification.findMany({
          include: { person: true, club: true },
          orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
        })

        const enriched = disqualifications.map(entry => ({
          ...entry,
          matchesRemaining: Math.max(0, entry.banDurationMatches - entry.matchesMissed),
        }))

        return sendSerialized(reply, enriched)
      })

      admin.post('/disqualifications', async (request, reply) => {
        const body = request.body as {
          personId?: number
          clubId?: number | null
          reason?: DisqualificationReason
          sanctionDate?: string
          banDurationMatches?: number
        }
        if (!body?.personId || !body?.reason || !body?.banDurationMatches) {
          return reply.status(400).send({ ok: false, error: 'disqualification_fields_required' })
        }
        const disqualification = await prisma.disqualification.create({
          data: {
            personId: body.personId,
            clubId: body.clubId ?? null,
            reason: body.reason,
            sanctionDate: body.sanctionDate ? new Date(body.sanctionDate) : new Date(),
            banDurationMatches: body.banDurationMatches,
            matchesMissed: 0,
            isActive: true,
          },
        })
        return reply.send({ ok: true, data: disqualification })
      })

      admin.put('/disqualifications/:disqualificationId', async (request, reply) => {
        const disqualificationId = parseBigIntId(
          (request.params as any).disqualificationId,
          'disqualificationId'
        )
        const body = request.body as Partial<{
          matchesMissed: number
          isActive: boolean
          banDurationMatches: number
        }>
        const disqualification = await prisma.disqualification.update({
          where: { id: disqualificationId },
          data: {
            matchesMissed: body.matchesMissed ?? undefined,
            isActive: body.isActive ?? undefined,
            banDurationMatches: body.banDurationMatches ?? undefined,
          },
        })
        return reply.send({ ok: true, data: disqualification })
      })

      admin.delete('/disqualifications/:disqualificationId', async (request, reply) => {
        const disqualificationId = parseBigIntId(
          (request.params as any).disqualificationId,
          'disqualificationId'
        )
        await prisma.disqualification.delete({ where: { id: disqualificationId } })
        return reply.send({ ok: true })
      })
    },
    { prefix: '/api/admin' }
  )
}

async function recomputeAchievementsForType(achievementTypeId: number) {
  const type = await prisma.achievementType.findUnique({ where: { id: achievementTypeId } })
  if (!type) return
  const users = await prisma.appUser.findMany({
    include: { predictions: true, achievements: true },
  })
  for (const user of users) {
    let achieved = false
    if (type.metric === AchievementMetric.TOTAL_PREDICTIONS) {
      achieved = user.predictions.length >= type.requiredValue
    } else if (type.metric === AchievementMetric.CORRECT_PREDICTIONS) {
      const correct = user.predictions.filter(p => p.isCorrect).length
      achieved = correct >= type.requiredValue
    }
    if (achieved) {
      const existing = user.achievements.find(ua => ua.achievementTypeId === type.id)
      if (!existing) {
        await prisma.userAchievement.create({
          data: {
            userId: user.id,
            achievementTypeId: type.id,
            achievedDate: new Date(),
          },
        })
      }
    }
  }
}
