import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import jwt from 'jsonwebtoken'
import { MatchStatus, LineupRole, Prisma } from '@prisma/client'
import prisma from '../db'
import { serializePrisma } from '../utils/serialization'
import { defaultCache } from '../cache'

interface LineupJwtPayload {
  sub: string
  role: 'lineup'
}

interface LineupLoginBody {
  login?: string
  password?: string
}

interface LineupMatchesQuery {
  clubId?: string
}

interface LineupRosterQuery {
  clubId?: string
}

interface LineupRosterBody {
  clubId?: number
  personIds?: number[]
  numbers?: Array<{ personId?: number; shirtNumber?: number }>
}

type CredentialsGetter = () => { login?: string; password?: string }

const getLineupSecret = () => process.env.LINEUP_JWT_SECRET || process.env.JWT_SECRET || process.env.TELEGRAM_BOT_TOKEN

const getLineupCredentials = () => ({
  login: process.env.LINEUP_LOGIN,
  password: process.env.LINEUP_PASSWORD,
})

const getLineupPortalCredentials = () => ({
  login: process.env.LINEUP_PORTAL_LOGIN || process.env.LINEUP_LOGIN,
  password: process.env.LINEUP_PORTAL_PASSWORD || process.env.LINEUP_PASSWORD,
})

const verifyLineupToken = async (request: FastifyRequest, reply: FastifyReply) => {
  const authHeader = request.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ ok: false, error: 'unauthorized' })
  }
  const token = authHeader.slice('Bearer '.length)
  try {
    const decoded = jwt.verify(token, getLineupSecret()) as LineupJwtPayload
    if (decoded.role !== 'lineup') {
      return reply.status(401).send({ ok: false, error: 'unauthorized' })
    }
    const extendedRequest = request as FastifyRequest & { lineupUser?: LineupJwtPayload }
    extendedRequest.lineupUser = decoded
  } catch (error) {
    request.log.warn({ err: error }, 'lineup token verification failed')
    return reply.status(401).send({ ok: false, error: 'unauthorized' })
  }
}

const parseBigIntId = (value: string | number | bigint | undefined, field: string): bigint => {
  try {
    if (typeof value === 'bigint') return value
    if (typeof value === 'number') return BigInt(value)
    return BigInt(value ?? '')
  } catch (err) {
    throw new Error(`${field}_invalid`)
  }
}

const parseNumericId = (value: string | number | undefined, field: string): number => {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`${field}_invalid`)
  }
  return numeric
}

const publicMatchLineupsCacheKey = (matchId: bigint | number | string) => `pub:md:${String(matchId)}:lineups`

const adjustMatchesCounters = async (
  tx: Prisma.TransactionClient,
  seasonId: number,
  clubId: number,
  personId: number,
  delta: number
) => {
  if (!delta) return
  const seasonStats = await tx.playerSeasonStats.findUnique({
    where: { seasonId_personId: { seasonId, personId } },
  })

  const nextSeasonMatches = Math.max(0, (seasonStats?.matchesPlayed ?? 0) + delta)

  if (!seasonStats) {
    if (delta > 0) {
      await tx.playerSeasonStats.create({
        data: {
          seasonId,
          personId,
          clubId,
          goals: 0,
          assists: 0,
          yellowCards: 0,
          redCards: 0,
          matchesPlayed: delta,
        },
      })
    }
  } else {
    await tx.playerSeasonStats.update({
      where: { seasonId_personId: { seasonId, personId } },
      data: {
        clubId,
        matchesPlayed: nextSeasonMatches,
      },
    })
  }

  const careerStats = await tx.playerClubCareerStats.findUnique({
    where: { personId_clubId: { personId, clubId } },
  })

  const nextCareerMatches = Math.max(0, (careerStats?.totalMatches ?? 0) + delta)

  if (!careerStats) {
    if (delta > 0) {
      await tx.playerClubCareerStats.create({
        data: {
          personId,
          clubId,
          totalGoals: 0,
          totalAssists: 0,
          yellowCards: 0,
          redCards: 0,
          totalMatches: delta,
        },
      })
    }
  } else {
    await tx.playerClubCareerStats.update({
      where: { personId_clubId: { personId, clubId } },
      data: {
        totalMatches: nextCareerMatches,
      },
    })
  }
}

const sendSerialized = <T>(reply: FastifyReply, data: T) =>
  reply.send({ ok: true, data: serializePrisma(data) })

const registerLineupRouteGroup = (
  server: FastifyInstance,
  basePath: string,
  credentialsGetter: CredentialsGetter
) => {
  const sendDiscovery = async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      ok: true,
      service: 'lineup-portal',
      endpoints: {
        login: `${basePath}/login`,
        matches: `${basePath}/matches`,
        roster: `${basePath}/matches/:matchId/roster`,
      },
    })
  }

  server.get(basePath, sendDiscovery)
  server.get(`${basePath}/`, sendDiscovery)

  server.post(`${basePath}/login`, async (request, reply) => {
    const body = request.body as LineupLoginBody | undefined
    const { login, password } = credentialsGetter()

    if (!body?.login || !body?.password) {
      return reply.status(400).send({ ok: false, error: 'login_required' })
    }

    if (!login || !password) {
      request.log.error('LINEUP_LOGIN/PASSWORD or LINEUP_PORTAL_LOGIN/PASSWORD environment variables are not configured')
      return reply.status(503).send({ ok: false, error: 'lineup_auth_unavailable' })
    }

    if (body.login !== login || body.password !== password) {
      return reply.status(401).send({ ok: false, error: 'invalid_credentials' })
    }

    const token = jwt.sign(
      { sub: body.login, role: 'lineup' } satisfies LineupJwtPayload,
      getLineupSecret(),
      {
        expiresIn: '24h',
      }
    )

    return reply.send({ ok: true, token })
  })

  server.get<{ Querystring: LineupMatchesQuery }>(
    `${basePath}/matches`,
    { preHandler: verifyLineupToken },
    async (request, reply) => {
      const query = request.query
      const now = new Date()
      const nextDay = new Date(now.getTime() + 24 * 60 * 60 * 1000)

      const where: Prisma.MatchWhereInput = {
        matchDateTime: {
          gte: now,
          lte: nextDay,
        },
        status: { in: [MatchStatus.SCHEDULED, MatchStatus.LIVE] },
      }

      if (query?.clubId) {
        const clubId = parseNumericId(query.clubId, 'clubId')
        where.OR = [{ homeTeamId: clubId }, { awayTeamId: clubId }]
      }

      const matches = await prisma.match.findMany({
        where,
        orderBy: { matchDateTime: 'asc' },
        include: {
          season: { select: { id: true, name: true } },
          homeClub: true,
          awayClub: true,
          round: true,
        },
      })

      const response = matches.map(match => ({
        id: match.id.toString(),
        matchDateTime: match.matchDateTime.toISOString(),
        status: match.status,
        season: match.season,
        round: match.round,
        homeClub: {
          id: match.homeClub.id,
          name: match.homeClub.name,
          shortName: match.homeClub.shortName,
          logoUrl: match.homeClub.logoUrl,
        },
        awayClub: {
          id: match.awayClub.id,
          name: match.awayClub.name,
          shortName: match.awayClub.shortName,
          logoUrl: match.awayClub.logoUrl,
        },
      }))

      return sendSerialized(reply, response)
    }
  )

  server.get(
    `${basePath}/matches/:matchId/roster`,
    { preHandler: verifyLineupToken },
    async (request, reply) => {
      const params = request.params as { matchId?: string }
      const query = request.query as LineupRosterQuery | undefined

      let matchId: bigint
      try {
        matchId = parseBigIntId(params.matchId, 'matchId')
      } catch (error) {
        return reply.status(400).send({ ok: false, error: 'match_invalid' })
      }

      const match = await prisma.match.findUnique({
        where: { id: matchId },
        select: {
          id: true,
          seasonId: true,
          homeTeamId: true,
          awayTeamId: true,
        },
      })

      if (!match) {
        return reply.status(404).send({ ok: false, error: 'match_not_found' })
      }

      if (!query?.clubId) {
        return reply.status(400).send({ ok: false, error: 'club_required' })
      }

      const clubId = parseNumericId(query.clubId, 'clubId')
      if (clubId !== match.homeTeamId && clubId !== match.awayTeamId) {
        return reply.status(400).send({ ok: false, error: 'club_not_in_match' })
      }

      const roster = await prisma.seasonRoster.findMany({
        where: { seasonId: match.seasonId, clubId },
        include: {
          person: true,
        },
        orderBy: [{ shirtNumber: 'asc' }, { person: { lastName: 'asc' } }],
      })

      const lineup = await prisma.matchLineup.findMany({
        where: { matchId, clubId },
        select: { personId: true },
      })

      const selectedIds = new Set(lineup.map(entry => entry.personId))

      const rosterPersonIds = roster.map(entry => entry.personId)
      const activeDisqualifications = rosterPersonIds.length
        ? await prisma.disqualification.findMany({
            where: {
              isActive: true,
              personId: { in: rosterPersonIds },
              OR: [{ clubId }, { clubId: null }],
            },
            select: {
              personId: true,
              clubId: true,
              reason: true,
              sanctionDate: true,
              banDurationMatches: true,
              matchesMissed: true,
            },
          })
        : []

      const disqualificationMap = new Map<
        number,
        {
          reason: string
          sanctionDate: Date
          banDurationMatches: number
          matchesMissed: number
          matchesRemaining: number
        }
      >()

      for (const dq of activeDisqualifications) {
        const matchesRemaining = Math.max(0, dq.banDurationMatches - dq.matchesMissed)
        const payload = {
          reason: dq.reason,
          sanctionDate: dq.sanctionDate,
          banDurationMatches: dq.banDurationMatches,
          matchesMissed: dq.matchesMissed,
          matchesRemaining,
        }

        const existing = disqualificationMap.get(dq.personId)
        if (!existing || matchesRemaining > existing.matchesRemaining) {
          disqualificationMap.set(dq.personId, payload)
        }
      }

      const response = roster.map(entry => ({
        personId: entry.personId,
        person: {
          id: entry.person.id,
          firstName: entry.person.firstName,
          lastName: entry.person.lastName,
        },
        shirtNumber: entry.shirtNumber,
        selected: disqualificationMap.has(entry.personId) ? false : selectedIds.has(entry.personId),
        disqualification: disqualificationMap.has(entry.personId)
          ? {
              reason: disqualificationMap.get(entry.personId)!.reason,
              sanctionDate: disqualificationMap.get(entry.personId)!.sanctionDate.toISOString(),
              banDurationMatches: disqualificationMap.get(entry.personId)!.banDurationMatches,
              matchesMissed: disqualificationMap.get(entry.personId)!.matchesMissed,
              matchesRemaining: disqualificationMap.get(entry.personId)!.matchesRemaining,
            }
          : null,
      }))

      return sendSerialized(reply, response)
    }
  )

  server.put(
    `${basePath}/matches/:matchId/roster`,
    { preHandler: verifyLineupToken },
    async (request, reply) => {
      const params = request.params as { matchId?: string }
      const body = request.body as LineupRosterBody | undefined

      let matchId: bigint
      try {
        matchId = parseBigIntId(params.matchId, 'matchId')
      } catch (error) {
        return reply.status(400).send({ ok: false, error: 'match_invalid' })
      }

      if (!body?.clubId || !Array.isArray(body.personIds)) {
        return reply.status(400).send({ ok: false, error: 'payload_invalid' })
      }

      const clubId = parseNumericId(body.clubId, 'clubId')
      const personIds = Array.from(
        new Set(body.personIds.map(id => parseNumericId(id, 'personId')))
      )

      const match = await prisma.match.findUnique({
        where: { id: matchId },
        select: {
          seasonId: true,
          homeTeamId: true,
          awayTeamId: true,
        },
      })

      if (!match) {
        return reply.status(404).send({ ok: false, error: 'match_not_found' })
      }

      if (clubId !== match.homeTeamId && clubId !== match.awayTeamId) {
        return reply.status(400).send({ ok: false, error: 'club_not_in_match' })
      }

      const clubRoster = await prisma.seasonRoster.findMany({
        where: {
          seasonId: match.seasonId,
          clubId,
        },
        select: {
          personId: true,
          shirtNumber: true,
        },
      })

      const rosterNumbers = new Map<number, number>()
      for (const entry of clubRoster) {
        rosterNumbers.set(entry.personId, entry.shirtNumber)
      }

      if (!personIds.every(id => rosterNumbers.has(id))) {
        return reply.status(400).send({ ok: false, error: 'persons_not_in_roster' })
      }

      const numberPayload = Array.isArray(body.numbers) ? body.numbers : []
      const numberMap = new Map<number, number>()
      for (const item of numberPayload) {
        if (!item || typeof item !== 'object') continue
        const rawPersonId = 'personId' in item ? item.personId : undefined
        const rawShirtNumber = 'shirtNumber' in item ? item.shirtNumber : undefined
        if (rawPersonId === undefined || rawShirtNumber === undefined) continue
        const parsedPersonId = parseNumericId(rawPersonId, 'personId')
        const parsedShirtNumber = Number(rawShirtNumber)
        if (
          !Number.isFinite(parsedShirtNumber) ||
          !Number.isInteger(parsedShirtNumber) ||
          parsedShirtNumber <= 0
        ) {
          return reply.status(400).send({ ok: false, error: 'shirt_invalid' })
        }
        numberMap.set(parsedPersonId, parsedShirtNumber)
      }

      const parsedNumbers = Array.from(numberMap.entries()).map(([personId, shirtNumber]) => ({
        personId,
        shirtNumber,
      }))

      for (const { personId } of parsedNumbers) {
        if (!rosterNumbers.has(personId)) {
          return reply.status(400).send({ ok: false, error: 'persons_not_in_roster' })
        }
      }

      const updatedNumbers = new Map<number, number>()
      rosterNumbers.forEach((value, key) => updatedNumbers.set(key, value))
      for (const { personId, shirtNumber } of parsedNumbers) {
        updatedNumbers.set(personId, shirtNumber)
      }

      const uniqueNumbers = new Set(updatedNumbers.values())
      if (uniqueNumbers.size !== updatedNumbers.size) {
        return reply.status(400).send({ ok: false, error: 'duplicate_shirt_numbers' })
      }

      const numbersToUpdate = parsedNumbers.filter(
        ({ personId, shirtNumber }) => rosterNumbers.get(personId) !== shirtNumber
      )

      const existingLineup = await prisma.matchLineup.findMany({
        where: { matchId, clubId },
        select: { personId: true },
      })

      const existingIds = new Set(existingLineup.map(entry => entry.personId))

      const toAdd = personIds.filter(id => !existingIds.has(id))
      const toRemove = Array.from(existingIds).filter(id => !personIds.includes(id))

      if (personIds.length) {
        const conflictingDisqualifications = await prisma.disqualification.findMany({
          where: {
            isActive: true,
            personId: { in: personIds },
            OR: [{ clubId }, { clubId: null }],
          },
          select: {
            personId: true,
            reason: true,
            banDurationMatches: true,
            matchesMissed: true,
          },
        })

        if (conflictingDisqualifications.length) {
          return reply.status(409).send({
            ok: false,
            error: 'player_disqualified',
            data: conflictingDisqualifications.map(dq => ({
              personId: dq.personId,
              reason: dq.reason,
              matchesRemaining: Math.max(0, dq.banDurationMatches - dq.matchesMissed),
            })),
          })
        }
      }

      const hasRosterChanges =
        numbersToUpdate.length > 0 || toAdd.length > 0 || toRemove.length > 0

      if (!hasRosterChanges) {
        return reply.send({ ok: true })
      }

      await prisma.$transaction(async tx => {
        if (numbersToUpdate.length) {
          let tempIndex = 0
          for (const { personId } of numbersToUpdate) {
            const tempNumber = -1000 - ++tempIndex
            await tx.seasonRoster.update({
              where: {
                seasonId_clubId_personId: {
                  seasonId: match.seasonId,
                  clubId,
                  personId,
                },
              },
              data: { shirtNumber: tempNumber },
            })
          }

          for (const { personId, shirtNumber } of numbersToUpdate) {
            await tx.seasonRoster.update({
              where: {
                seasonId_clubId_personId: {
                  seasonId: match.seasonId,
                  clubId,
                  personId,
                },
              },
              data: { shirtNumber },
            })
          }
        }

        if (toRemove.length) {
          await tx.matchLineup.deleteMany({
            where: {
              matchId,
              clubId,
              personId: { in: toRemove },
            },
          })
        }

        if (toAdd.length) {
          for (const personId of toAdd) {
            await tx.matchLineup.upsert({
              where: { matchId_personId: { matchId, personId } },
              create: {
                matchId,
                personId,
                clubId,
                role: LineupRole.STARTER,
                position: null,
              },
              update: {
                clubId,
                role: LineupRole.STARTER,
                position: null,
              },
            })
          }
        }

        for (const personId of toAdd) {
          await adjustMatchesCounters(tx, match.seasonId, clubId, personId, 1)
        }
        for (const personId of toRemove) {
          await adjustMatchesCounters(tx, match.seasonId, clubId, personId, -1)
        }

        if (hasRosterChanges) {
          await tx.match.update({
            where: { id: matchId },
            data: { updatedAt: new Date() },
          })
        }
      })

      if (hasRosterChanges) {
        await defaultCache.invalidate(publicMatchLineupsCacheKey(matchId)).catch(() => undefined)
      }

      return reply.send({ ok: true })
    }
  )
}

export default async function lineupRoutes(server: FastifyInstance) {
  registerLineupRouteGroup(server, '/api/lineup', getLineupCredentials)
  registerLineupRouteGroup(server, '/api/lineup-portal', getLineupPortalCredentials)
}
