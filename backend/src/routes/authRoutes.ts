import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import prisma from '../db'
import jwt from 'jsonwebtoken'
import {
  parse as parseInitData,
  validate as validateInitData,
  validate3rd as validateInitDataSignature,
} from '@tma.js/init-data-node'
import type { Prisma } from '@prisma/client'
import { createHash } from 'crypto'
import { serializePrisma, isSerializedAppUserPayload } from '../utils/serialization'
import { defaultCache, type CacheFetchOptions } from '../cache'

const INIT_DATA_MAX_AGE_SEC = 24 * 60 * 60
const PROFILE_CACHE_TTL_SECONDS = 5 * 60
const PROFILE_CACHE_OPTIONS: CacheFetchOptions = {
  ttlSeconds: PROFILE_CACHE_TTL_SECONDS,
  staleWhileRevalidateSeconds: PROFILE_CACHE_TTL_SECONDS * 2,
  lockTimeoutSeconds: 10,
}

function buildProfileEtag(userId: string, version: number, payload: unknown): string {
  const hash = createHash('sha1').update(JSON.stringify(payload ?? null)).digest('hex')
  return `W/"user:${userId}:v${version}:${hash}"`
}

function normalizeWeakEtag(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed[1] === '/' && (trimmed[0] === 'W' || trimmed[0] === 'w')) {
    return trimmed.slice(2)
  }
  return trimmed
}

function stripEtagQuotes(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function etagMatches(etag: string, header: string | undefined): boolean {
  if (!header) {
    return false
  }

  const normalizedEtag = stripEtagQuotes(normalizeWeakEtag(etag))
  const candidates = header
    .split(',')
    .map(candidate => candidate.trim())
    .filter(candidate => candidate.length > 0)

  if (candidates.includes('*')) {
    return true
  }

  return candidates.some(candidate => {
    const normalizedCandidate = stripEtagQuotes(normalizeWeakEtag(candidate))
    return normalizedCandidate === normalizedEtag
  })
}

function applyProfileCacheHeaders(reply: FastifyReply, origin: string, etag: string) {
  reply.header('Access-Control-Allow-Origin', origin)
  reply.header('Access-Control-Allow-Credentials', 'true')
  reply.header('Cache-Control', 'private, max-age=0, must-revalidate')
  reply.header('Access-Control-Expose-Headers', 'ETag, Cache-Control')
  reply.header('ETag', etag)
  reply.header('Vary', 'Authorization, Cookie, X-Telegram-Init-Data')
}

type TelegramInitBody =
  | string
  | {
      initData?: unknown
      init_data?: unknown
      [key: string]: unknown
    }
  | null
  | undefined

type TelegramInitQuery = {
  initData?: unknown
  init_data?: unknown
  token?: unknown
  [key: string]: unknown
}

type ReplyWithOptionalSetCookie = FastifyReply & {
  setCookie?: (
    name: string,
    value: string,
    options: {
      httpOnly?: boolean
      path?: string
      sameSite?: 'lax' | 'strict' | 'none'
    }
  ) => unknown
}

type RequestWithSessionCookie = FastifyRequest & {
  cookies?: {
    session?: string
  }
}

type LeaguePlayerStatsPayload = {
  matches: number
  goals: number
  assists: number
  penaltyGoals: number
  yellowCards: number
  redCards: number
}
type LeaguePlayerCareerEntryPayload = {
  clubId: number
  clubName: string
  clubShortName: string
  clubLogoUrl: string | null
  fromYear: number | null
  toYear: number | null
  matches: number
  goals: number
  assists: number
  penaltyGoals: number
  yellowCards: number
  redCards: number
}
type SerializedProfilePayload = Record<string, unknown> & {
  leaguePlayerStats?: LeaguePlayerStatsPayload | null
  leaguePlayerCareer?: LeaguePlayerCareerEntryPayload[] | null
}

type NormalizedField = {
  defined: boolean
  value: string | null
}

type LoggerLike = {
  error?: (obj: unknown, msg?: string) => void
}

function normalizeIncomingField(value: unknown): NormalizedField {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed.length) {
      return { defined: true, value: null }
    }
    return { defined: true, value: trimmed }
  }

  if (value === null) {
    return { defined: true, value: null }
  }

  return { defined: false, value: null }
}

async function loadLeaguePlayerStats(personId: number): Promise<LeaguePlayerStatsPayload | null> {
  const aggregated = await prisma.playerClubCareerStats.aggregate({
    where: { personId },
    _sum: {
      totalMatches: true,
      totalGoals: true,
      totalAssists: true,
      penaltyGoals: true,
      yellowCards: true,
      redCards: true,
    },
  })

  const sums = aggregated._sum
  if (!sums) {
    return null
  }

  const matches = sums.totalMatches ?? 0
  const goals = sums.totalGoals ?? 0
  const assists = sums.totalAssists ?? 0
  const penaltyGoals = sums.penaltyGoals ?? 0
  const yellowCards = sums.yellowCards ?? 0
  const redCards = sums.redCards ?? 0

  const hasStats =
    matches > 0 || goals > 0 || assists > 0 || penaltyGoals > 0 || yellowCards > 0 || redCards > 0

  if (!hasStats) {
    return null
  }

  return {
    matches,
    goals,
    assists,
    penaltyGoals,
    yellowCards,
    redCards,
  }
}

type RosterSeasonSnapshot = {
  startDate: Date
  endDate: Date
  isActive: boolean
}

type MatchBounds = {
  firstDate: Date | null
  lastDate: Date | null
}

function pickMinDate(values: Date[]): Date | null {
  let candidate: Date | null = null
  values.forEach(value => {
    if (!(value instanceof Date)) {
      return
    }
    const time = value.getTime()
    if (Number.isNaN(time)) {
      return
    }
    if (!candidate || time < candidate.getTime()) {
      candidate = value
    }
  })
  return candidate
}

function pickMaxDate(values: Date[]): Date | null {
  let candidate: Date | null = null
  values.forEach(value => {
    if (!(value instanceof Date)) {
      return
    }
    const time = value.getTime()
    if (Number.isNaN(time)) {
      return
    }
    if (!candidate || time > candidate.getTime()) {
      candidate = value
    }
  })
  return candidate
}

function yearFromDate(value: Date | null): number | null {
  if (!value) {
    return null
  }
  return value.getUTCFullYear()
}

async function loadLeaguePlayerCareer(personId: number): Promise<LeaguePlayerCareerEntryPayload[]> {
  const [careerRows, rosterRows] = await Promise.all([
    prisma.playerClubCareerStats.findMany({
      where: { personId },
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
    }),
    prisma.seasonRoster.findMany({
      where: { personId },
      select: {
        clubId: true,
        registrationDate: true,
        club: {
          select: {
            id: true,
            name: true,
            shortName: true,
            logoUrl: true,
          },
        },
        season: {
          select: {
            startDate: true,
            endDate: true,
            isActive: true,
          },
        },
      },
    }),
  ])

  const careerByClub = new Map<number, typeof careerRows[number]>
  careerRows.forEach(row => {
    careerByClub.set(row.clubId, row)
  })

  const rosterByClub = new Map<
    number,
    {
      club:
        | {
            id: number
            name: string
            shortName: string
            logoUrl: string | null
          }
        | null
      seasons: RosterSeasonSnapshot[]
      registrations: Date[]
    }
  >()

  rosterRows.forEach(row => {
    const existing = rosterByClub.get(row.clubId)
    const seasonSnapshot: RosterSeasonSnapshot = {
      startDate: row.season.startDate,
      endDate: row.season.endDate,
      isActive: row.season.isActive,
    }
    if (existing) {
      existing.seasons.push(seasonSnapshot)
      existing.registrations.push(row.registrationDate)
    } else {
      rosterByClub.set(row.clubId, {
        club: row.club,
        seasons: [seasonSnapshot],
        registrations: [row.registrationDate],
      })
    }
  })

  const clubIds = new Set<number>()
  careerRows.forEach(row => clubIds.add(row.clubId))
  rosterRows.forEach(row => clubIds.add(row.clubId))

  const clubIdsWithMatches = Array.from(clubIds).filter(clubId => {
    const careerRow = careerByClub.get(clubId)
    const matches = careerRow?.totalMatches ?? 0
    return matches > 0
  })

  const matchBoundEntries = await Promise.all(
    clubIdsWithMatches.map(async clubId => {
      const [firstMatch, lastMatch] = await Promise.all([
        prisma.match.findFirst({
          where: {
            lineups: {
              some: {
                personId,
                clubId,
              },
            },
          },
          orderBy: {
            matchDateTime: 'asc',
          },
          select: {
            matchDateTime: true,
          },
        }),
        prisma.match.findFirst({
          where: {
            lineups: {
              some: {
                personId,
                clubId,
              },
            },
          },
          orderBy: {
            matchDateTime: 'desc',
          },
          select: {
            matchDateTime: true,
          },
        }),
      ])

      const bounds: MatchBounds = {
        firstDate: firstMatch?.matchDateTime ?? null,
        lastDate: lastMatch?.matchDateTime ?? null,
      }

      return { clubId, bounds }
    })
  )

  const matchBoundsByClub = new Map<number, MatchBounds>()
  matchBoundEntries.forEach(entry => {
    matchBoundsByClub.set(entry.clubId, entry.bounds)
  })

  const entries: LeaguePlayerCareerEntryPayload[] = []
  const sortedClubIds = Array.from(clubIds)

  sortedClubIds.forEach(clubId => {
    const career = careerByClub.get(clubId)
    const roster = rosterByClub.get(clubId)
    const clubMeta = career?.club ?? roster?.club

    if (!clubMeta) {
      return
    }

    const matches = career?.totalMatches ?? 0
    const goals = career?.totalGoals ?? 0
    const assists = career?.totalAssists ?? 0
    const penaltyGoals = career?.penaltyGoals ?? 0
    const yellowCards = career?.yellowCards ?? 0
    const redCards = career?.redCards ?? 0

    const seasons = roster?.seasons ?? []
    const registrations = roster?.registrations ?? []
    const bounds = matchBoundsByClub.get(clubId)

    const firstDateCandidates: Date[] = []
    if (bounds?.firstDate) {
      firstDateCandidates.push(bounds.firstDate)
    }
    seasons.forEach(season => {
      firstDateCandidates.push(season.startDate)
    })
    registrations.forEach(date => {
      firstDateCandidates.push(date)
    })
    const firstDate = pickMinDate(firstDateCandidates)

    const lastDateCandidates: Date[] = []
    if (bounds?.lastDate) {
      lastDateCandidates.push(bounds.lastDate)
    }
    seasons.forEach(season => {
      lastDateCandidates.push(season.endDate)
    })
    registrations.forEach(date => {
      lastDateCandidates.push(date)
    })
    const lastDate = pickMaxDate(lastDateCandidates)

    const isActive = seasons.some(season => season.isActive)

    const fromYear = yearFromDate(firstDate)
    let toYear = isActive ? null : yearFromDate(lastDate)

    if (!isActive && toYear === null && fromYear !== null) {
      toYear = fromYear
    }

    if (matches === 0 && !isActive) {
      return
    }

    entries.push({
      clubId: clubMeta.id,
      clubName: clubMeta.name,
      clubShortName: clubMeta.shortName,
      clubLogoUrl: clubMeta.logoUrl ?? null,
      fromYear,
      toYear,
      matches,
      goals,
      assists,
      penaltyGoals,
      yellowCards,
      redCards,
    })
  })

  const collator = new Intl.Collator('ru', { sensitivity: 'base' })
  entries.sort((left, right) => {
    const leftYear = left.fromYear ?? 9999
    const rightYear = right.fromYear ?? 9999
    if (leftYear !== rightYear) {
      return leftYear - rightYear
    }
    return collator.compare(left.clubName, right.clubName)
  })

  return entries
}

async function loadSerializedUserPayload(
  telegramId: string,
  logger?: LoggerLike
): Promise<SerializedProfilePayload | null> {
  let numericTelegramId: bigint
  try {
    numericTelegramId = BigInt(telegramId)
  } catch {
    return null
  }

  const user = await prisma.appUser.findUnique({
    where: { telegramId: numericTelegramId },
    include: {
      leaguePlayer: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  })

  if (!user) {
    return null
  }

  const serializedUser = serializePrisma(user) as SerializedProfilePayload

  if (typeof user.leaguePlayerId === 'number') {
    try {
      const [stats, career] = await Promise.all([
        loadLeaguePlayerStats(user.leaguePlayerId),
        loadLeaguePlayerCareer(user.leaguePlayerId),
      ])
      serializedUser.leaguePlayerStats = stats
      serializedUser.leaguePlayerCareer = career
    } catch (err) {
      logger?.error?.(
        { err, leaguePlayerId: user.leaguePlayerId },
        'profile stats or career aggregation failed'
      )
      serializedUser.leaguePlayerStats = null
      serializedUser.leaguePlayerCareer = []
    }
  } else {
    serializedUser.leaguePlayerStats = null
    serializedUser.leaguePlayerCareer = []
  }

  return serializedUser
}

export default async function (server: FastifyInstance) {
  // Simple CORS preflight handlers for auth endpoints (used when frontend is served from a different origin)
  server.options('/api/auth/telegram-init', async (request, reply) => {
    const origin = (request.headers.origin as string) || '*'
    reply.header('Access-Control-Allow-Origin', origin)
    reply.header('Access-Control-Allow-Credentials', 'true')
    reply.header('Access-Control-Allow-Methods', 'POST, OPTIONS')
    reply.header(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Telegram-Init-Data, If-None-Match'
    )
    reply.header('Access-Control-Max-Age', '600')
    return reply.status(204).send()
  })
  server.options('/api/auth/me', async (request, reply) => {
    const origin = (request.headers.origin as string) || '*'
    reply.header('Access-Control-Allow-Origin', origin)
    reply.header('Access-Control-Allow-Credentials', 'true')
    reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS')
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, If-None-Match')
    reply.header('Access-Control-Max-Age', '600')
    return reply.status(204).send()
  })
  server.post('/api/auth/telegram-init', async (request, reply) => {
    const rawBody = request.body as TelegramInitBody
    const bodyObject =
      rawBody && typeof rawBody === 'object' ? (rawBody as Record<string, unknown>) : undefined
    // Accept initData from multiple possible places (body, query, header)
    const q = ((request.query as TelegramInitQuery | undefined) ?? {}) as TelegramInitQuery
    const headerInit = (request.headers['x-telegram-init-data'] ||
      request.headers['x-telegram-initdata']) as string | undefined
    const rawCandidate =
      bodyObject?.initData ||
      bodyObject?.init_data ||
      q.initData ||
      q.init_data ||
      headerInit ||
      (typeof rawBody === 'string' ? rawBody : undefined)
    if (!rawCandidate) return reply.status(400).send({ error: 'initData required' })

    const botToken = process.env.TELEGRAM_BOT_TOKEN
    if (!botToken) {
      server.log.warn('TELEGRAM_BOT_TOKEN not set; cannot verify initData')
      return reply.status(500).send({ error: 'server misconfigured' })
    }

    const rawInitData = String(rawCandidate || '')
    const trimmedInitData = rawInitData.trim()

    let userId: string | undefined
    let username: string | undefined
    let firstName: string | undefined
    let photoUrl: string | undefined
    let authDateSec: number | undefined
    let verificationMethod: 'hash' | 'signature' | 'json' | undefined

    try {
      if (!trimmedInitData) {
        throw new Error('empty_init_data')
      }

      if (trimmedInitData.startsWith('{')) {
        // JSON payload — fallback for dev environments when initData string is unavailable.
        verificationMethod = 'json'
        const parsed = JSON.parse(trimmedInitData)
        const u = parsed?.user
        if (!u?.id) {
          throw new Error('json_payload_missing_user')
        }
        userId = String(u.id)
        username = u.username
        firstName = u.first_name
        photoUrl = u.photo_url || u.photoUrl
        if (u.auth_date) authDateSec = Number(u.auth_date)
        server.log.warn(
          { userId },
          'telegram-init: accepted JSON user payload without signature (dev fallback)'
        )
        server.log.info(
          { userId, username, firstName, photoUrl, verificationMethod },
          'telegram-init: initData processed via JSON payload'
        )
      } else {
        // Signed initData — verify using hash and fall back to Telegram signature.
        const maxAge = INIT_DATA_MAX_AGE_SEC
        try {
          validateInitData(trimmedInitData, botToken, { expiresIn: maxAge })
          verificationMethod = 'hash'
        } catch (hashErr) {
          const botId = Number.parseInt(botToken.split(':')[0] ?? '', 10)
          server.log.warn(
            { err: hashErr },
            'telegram-init: hash verification failed, attempting signature fallback'
          )
          if (!Number.isFinite(botId)) {
            throw hashErr
          }
          await validateInitDataSignature(trimmedInitData, botId, { expiresIn: maxAge })
          verificationMethod = 'signature'
        }

        const parsed = parseInitData(trimmedInitData)
        const parsedUser = parsed?.user
        if (parsedUser?.id != null) {
          userId = String(parsedUser.id)
        }
        if (parsedUser) {
          username = typeof parsedUser.username === 'string' ? parsedUser.username : undefined
          firstName = typeof parsedUser.first_name === 'string' ? parsedUser.first_name : undefined
          const parsedPhoto = parsedUser.photo_url
          if (typeof parsedPhoto === 'string' && parsedPhoto.length) {
            photoUrl = parsedPhoto
          }
        }
        const parsedAuth = parsed?.auth_date
        if (parsedAuth instanceof Date) {
          authDateSec = Math.floor(parsedAuth.getTime() / 1000)
        }

        server.log.info(
          { userId, username, firstName, photoUrl, verificationMethod },
          'telegram-init: initData verified'
        )
      }
    } catch (err) {
      server.log.warn({ err, rawCandidate }, 'initData verification failed')
      return reply.status(403).send({ error: 'invalid_init_data' })
    }

    if (authDateSec) {
      const nowSec = Math.floor(Date.now() / 1000)
      if (nowSec - authDateSec > INIT_DATA_MAX_AGE_SEC) {
        server.log.info({ auth_date: authDateSec }, 'telegram-init: auth_date expired')
        return reply.status(403).send({ error: 'init_data_expired' })
      }
    }

    if (!userId) return reply.status(400).send({ error: 'user id missing' })

    try {
      const usernameField = normalizeIncomingField(username)
      const firstNameField = normalizeIncomingField(firstName)
      const photoUrlField = normalizeIncomingField(photoUrl)

      const numericTelegramId = BigInt(userId)
      const existingUser = await prisma.appUser.findUnique({
        where: { telegramId: numericTelegramId },
      })

      let userRecord = existingUser
      let cacheNeedsRefresh = false

      if (!existingUser) {
        userRecord = await prisma.appUser.create({
          data: {
            telegramId: numericTelegramId,
            username: usernameField.value,
            firstName: firstNameField.value,
            photoUrl: photoUrlField.value,
          },
        })
        cacheNeedsRefresh = true
      } else {
        const updateData: Prisma.AppUserUpdateInput = {}

        if (usernameField.defined && existingUser.username !== usernameField.value) {
          updateData.username = usernameField.value
        }
        if (firstNameField.defined && existingUser.firstName !== firstNameField.value) {
          updateData.firstName = firstNameField.value
        }
        if (photoUrlField.defined && existingUser.photoUrl !== photoUrlField.value) {
          updateData.photoUrl = photoUrlField.value
        }

        if (Object.keys(updateData).length > 0) {
          userRecord = await prisma.appUser.update({
            where: { telegramId: numericTelegramId },
            data: updateData,
          })
          cacheNeedsRefresh = true
        }
      }

      if (!userRecord) {
        server.log.error({ userId }, 'telegram-init: failed to resolve user record after upsert')
        return reply.status(500).send({ error: 'user_resolution_failed' })
      }

      const userCacheKey = `user:${userId}`

      if (cacheNeedsRefresh) {
        await defaultCache.invalidate(userCacheKey)
      }

      const { value: serializedUser, version: profileVersion } =
        await defaultCache.getWithMeta<SerializedProfilePayload>(
          userCacheKey,
          async () => {
            const payload = await loadSerializedUserPayload(userId, server.log)
            if (payload) {
              return payload
            }
            return serializePrisma(userRecord) as SerializedProfilePayload
          },
          PROFILE_CACHE_OPTIONS
        )

      const origin = (request.headers.origin as string) || '*'
      const etag = buildProfileEtag(userId, profileVersion, serializedUser)
      const ifNoneMatchHeader = request.headers['if-none-match'] as string | undefined

      applyProfileCacheHeaders(reply, origin, etag)

      const isNotModified = etagMatches(etag, ifNoneMatchHeader)

      if (!isNotModified) {
        // Publish real-time updates для WebSocket subscribers
        try {
          if (!isSerializedAppUserPayload(serializedUser)) {
            server.log.warn(
              { userPayload: serializedUser },
              'Unexpected user payload shape after serialization'
            )
          } else {
            const realtimePayload = {
              type: 'profile_updated' as const,
              telegramId: serializedUser.telegramId,
              username: serializedUser.username,
              firstName: serializedUser.firstName,
              photoUrl: serializedUser.photoUrl,
              updatedAt: serializedUser.updatedAt,
            }

            // Персональный топик пользователя
            await server.publishTopic(`user:${userId}`, realtimePayload)

            // Глобальный топик профилей (для админки, статистики и т.д.)
            await server.publishTopic('profile', realtimePayload)

            server.log.info({ userId }, 'Published profile updates to WebSocket topics')
          }
        } catch (wsError) {
          server.log.warn({ err: wsError }, 'Failed to publish WebSocket updates')
          // Не прерываем выполнение, WebSocket не критичен для auth flow
        }
      }

      if (isNotModified) {
        return reply.status(304).send()
      }

      // Create a JWT session token (short lived) and set as httpOnly cookie
      const jwtSecret = process.env.JWT_SECRET || process.env.TELEGRAM_BOT_TOKEN || 'dev-secret'
      const tokenPayloadUsername =
        typeof userRecord.username === 'string' ? userRecord.username : undefined
      const token = jwt.sign({ sub: String(userRecord.telegramId), username: tokenPayloadUsername }, jwtSecret, {
        expiresIn: '7d',
      })

      // set cookie (httpOnly). Fastify reply.setCookie requires fastify-cookie plugin; we fallback to header if not present.
      try {
        // try set cookie if plugin available
        const replyWithCookie = reply as ReplyWithOptionalSetCookie
        replyWithCookie.setCookie?.('session', token, {
          httpOnly: true,
          path: '/',
          sameSite: 'lax',
        })
      } catch (e) {
        // fallback: send token in body only
      }

      return reply.send({ ok: true, user: serializedUser, token })
    } catch (err) {
      server.log.error({ err }, 'telegram-init upsert failed')
      return reply.status(500).send({ error: 'internal' })
    }
  })

  // Get current user by JWT (cookie, Authorization header, or ?token=)
  server.get('/api/auth/me', async (request, reply) => {
    const authHeader = (request.headers && (request.headers.authorization as string)) || ''
    const queryParams = ((request.query as TelegramInitQuery | undefined) ?? {}) as TelegramInitQuery
    const qToken = typeof queryParams.token === 'string' ? queryParams.token : undefined
    const cookieToken = (request as RequestWithSessionCookie).cookies?.session
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : qToken || cookieToken
    if (!token) return reply.status(401).send({ error: 'no_token' })
    const jwtSecret = process.env.JWT_SECRET || process.env.TELEGRAM_BOT_TOKEN || 'dev-secret'
    try {
      const jwtPayload = jwt.verify(token, jwtSecret)
      const sub =
        typeof jwtPayload === 'string'
          ? jwtPayload
          : typeof jwtPayload?.sub === 'string'
          ? jwtPayload.sub
          : undefined
      if (!sub) return reply.status(401).send({ error: 'bad_token' })

      // Use cache for user data (5 min TTL + SWR)
      const cacheKey = `user:${sub}`

      let serializedUser: SerializedProfilePayload
      let profileVersion: number
      try {
        const result = await defaultCache.getWithMeta<SerializedProfilePayload>(
          cacheKey,
          async () => {
            const payload = await loadSerializedUserPayload(sub, request.log)
            if (!payload) {
              throw new Error('profile_not_found')
            }
            return payload
          },
          PROFILE_CACHE_OPTIONS
        )
        serializedUser = result.value
        profileVersion = result.version
      } catch (loadErr) {
        if (loadErr instanceof Error && loadErr.message === 'profile_not_found') {
          await defaultCache.invalidate(cacheKey)
          return reply.status(404).send({ error: 'not_found' })
        }
        request.log.error({ err: loadErr, userId: sub }, 'failed to load cached profile payload')
        return reply.status(500).send({ error: 'internal' })
      }

      const origin = (request.headers.origin as string) || '*'
      const etag = buildProfileEtag(sub, profileVersion, serializedUser)
      const ifNoneMatchHeader = request.headers['if-none-match'] as string | undefined

      applyProfileCacheHeaders(reply, origin, etag)

      if (etagMatches(etag, ifNoneMatchHeader)) {
        return reply.status(304).send()
      }

      return reply.send({ ok: true, user: serializedUser })
    } catch (e) {
      const msg = e instanceof Error ? e.message : undefined
      return reply.status(401).send({ error: 'invalid_token', detail: msg })
    }
  })
}
