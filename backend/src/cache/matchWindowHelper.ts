import { MatchStatus } from '@prisma/client'
import prisma from '../db'
import { defaultCache, CacheFetchOptions } from './multilevelCache'

const MATCH_WINDOW_CACHE_KEY = 'cache:match-window:v1'
const MATCH_WINDOW_CACHE_SECONDS = 30

const DEFAULT_LOOKAHEAD_DAYS = Number(process.env.MATCH_WINDOW_LOOKAHEAD_DAYS ?? '7')
const DEFAULT_PREWARM_MINUTES = Number(process.env.MATCH_WINDOW_PREWARM_MINUTES ?? '45')
const DEFAULT_POST_GRACE_MINUTES = Number(process.env.MATCH_WINDOW_POST_GRACE_MINUTES ?? '30')

const LOOKAHEAD_DAYS = Number.isFinite(DEFAULT_LOOKAHEAD_DAYS) && DEFAULT_LOOKAHEAD_DAYS > 0
  ? DEFAULT_LOOKAHEAD_DAYS
  : 7
const PREWARM_MINUTES = Number.isFinite(DEFAULT_PREWARM_MINUTES) && DEFAULT_PREWARM_MINUTES >= 0
  ? DEFAULT_PREWARM_MINUTES
  : 45
const POST_GRACE_MINUTES = Number.isFinite(DEFAULT_POST_GRACE_MINUTES) && DEFAULT_POST_GRACE_MINUTES >= 0
  ? DEFAULT_POST_GRACE_MINUTES
  : 30

export type MatchWindowPhase = 'idle' | 'prewarm' | 'live' | 'post'

export interface MatchWindowState {
  phase: MatchWindowPhase
  computedAt: string
  windowStart: string | null
  windowEnd: string | null
  nextMatchAt: string | null
  lastMatchAt: string | null
  matchesTotal: number
  seasonIds: number[]
}

const cacheOptions: CacheFetchOptions = {
  ttlSeconds: MATCH_WINDOW_CACHE_SECONDS,
  staleWhileRevalidateSeconds: MATCH_WINDOW_CACHE_SECONDS * 2,
  lockTimeoutSeconds: 5,
}

const prewarmMs = PREWARM_MINUTES * 60 * 1000
const postGraceMs = POST_GRACE_MINUTES * 60 * 1000
const lookaheadMs = LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000

const computeMatchWindow = async (): Promise<MatchWindowState> => {
  const now = new Date()
  const nowTs = now.getTime()
  const from = new Date(nowTs - postGraceMs)
  const to = new Date(nowTs + lookaheadMs)

  const matches = await prisma.match.findMany({
    where: {
      matchDateTime: { gte: from, lte: to },
      status: { in: [MatchStatus.SCHEDULED, MatchStatus.LIVE, MatchStatus.FINISHED] },
      isArchived: false,
      isFriendly: false,
    },
    select: {
      id: true,
      seasonId: true,
      matchDateTime: true,
      status: true,
    },
    orderBy: { matchDateTime: 'asc' },
  })

  if (!matches.length) {
    return {
      phase: 'idle',
      computedAt: now.toISOString(),
      windowStart: null,
      windowEnd: null,
      nextMatchAt: null,
      lastMatchAt: null,
      matchesTotal: 0,
      seasonIds: [],
    }
  }

  const firstMatch = matches[0]
  const lastMatch = matches[matches.length - 1]
  const firstStartTs = firstMatch.matchDateTime.getTime()
  const lastStartTs = lastMatch.matchDateTime.getTime()

  const windowStartTs = Math.min(firstStartTs - prewarmMs, firstStartTs)
  const windowEndTs = lastStartTs + postGraceMs

  let phase: MatchWindowPhase
  if (nowTs < windowStartTs) {
    phase = 'idle'
  } else if (nowTs < firstStartTs) {
    phase = 'prewarm'
  } else if (nowTs <= windowEndTs) {
    if (matches.some(match => match.status === MatchStatus.LIVE)) {
      phase = 'live'
    } else if (nowTs <= lastStartTs) {
      phase = 'live'
    } else {
      phase = 'post'
    }
  } else {
    phase = 'idle'
  }

  const nextMatch = matches.find(match => match.matchDateTime.getTime() >= nowTs)

  const seasonIds = Array.from(
    new Set(matches.map(match => match.seasonId).filter((value): value is number => value != null))
  )

  return {
    phase,
    computedAt: now.toISOString(),
    windowStart: new Date(windowStartTs).toISOString(),
    windowEnd: new Date(windowEndTs).toISOString(),
    nextMatchAt: nextMatch ? nextMatch.matchDateTime.toISOString() : null,
    lastMatchAt: lastMatch.matchDateTime.toISOString(),
    matchesTotal: matches.length,
    seasonIds,
  }
}

export const getMatchWindow = async (): Promise<MatchWindowState> => {
  const { value } = await defaultCache.getWithMeta(MATCH_WINDOW_CACHE_KEY, computeMatchWindow, cacheOptions)
  return value
}

export const isMatchWindowActive = async (): Promise<boolean> => {
  const window = await getMatchWindow()
  return window.phase === 'prewarm' || window.phase === 'live' || window.phase === 'post'
}

export type AdaptiveCacheResource =
  | 'leagueTable'
  | 'leagueSchedule'
  | 'leagueResults'
  | 'leagueStats'
  | 'friendliesSchedule'
  | 'friendliesResults'

const adaptivePolicies: Record<AdaptiveCacheResource, { outside: CacheFetchOptions; matchWindow: CacheFetchOptions }> = {
  leagueTable: {
    outside: { ttlSeconds: 3_600, staleWhileRevalidateSeconds: 900, lockTimeoutSeconds: 12 },
    matchWindow: { ttlSeconds: 30, staleWhileRevalidateSeconds: 120, lockTimeoutSeconds: 6 },
  },
  leagueSchedule: {
    outside: { ttlSeconds: 3_600, staleWhileRevalidateSeconds: 900, lockTimeoutSeconds: 10 },
    matchWindow: { ttlSeconds: 20, staleWhileRevalidateSeconds: 90, lockTimeoutSeconds: 6 },
  },
  leagueResults: {
    outside: { ttlSeconds: 900, staleWhileRevalidateSeconds: 300, lockTimeoutSeconds: 8 },
    matchWindow: { ttlSeconds: 15, staleWhileRevalidateSeconds: 75, lockTimeoutSeconds: 6 },
  },
  leagueStats: {
    outside: { ttlSeconds: 3_600, staleWhileRevalidateSeconds: 900, lockTimeoutSeconds: 10 },
    matchWindow: { ttlSeconds: 45, staleWhileRevalidateSeconds: 150, lockTimeoutSeconds: 8 },
  },
  friendliesSchedule: {
    outside: { ttlSeconds: 3_600, staleWhileRevalidateSeconds: 900, lockTimeoutSeconds: 10 },
    matchWindow: { ttlSeconds: 20, staleWhileRevalidateSeconds: 90, lockTimeoutSeconds: 6 },
  },
  friendliesResults: {
    outside: { ttlSeconds: 900, staleWhileRevalidateSeconds: 300, lockTimeoutSeconds: 8 },
    matchWindow: { ttlSeconds: 15, staleWhileRevalidateSeconds: 75, lockTimeoutSeconds: 6 },
  },
}

export const resolveCacheOptions = async (resource: AdaptiveCacheResource): Promise<CacheFetchOptions> => {
  const window = await getMatchWindow()
  const policy = adaptivePolicies[resource]
  const inWindow = window.phase === 'prewarm' || window.phase === 'live' || window.phase === 'post'
  const selected = inWindow ? policy.matchWindow : policy.outside
  return { ...selected }
}


