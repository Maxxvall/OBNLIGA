import { FastifyInstance } from 'fastify'
import type { LeaguePlayerCardInfo, UserCardExtraView } from '@shared/types'
import prisma from '../db'
import { defaultCache, type CacheFetchOptions } from '../cache'
import { userCardExtraCacheKey } from '../cache'

const USER_CARD_EXTRA_CACHE_OPTIONS: CacheFetchOptions = {
  ttlSeconds: 120,
  staleWhileRevalidateSeconds: 300,
  lockTimeoutSeconds: 5,
}

const mapAchievementStats = (aggregate: {
  _count?: { _all?: number | null }
  _max?: { currentLevel?: number | null }
} | null) => {
  const achievementCount = aggregate?._count?._all ?? 0
  const achievementMaxLevel = aggregate?._max?.currentLevel ?? 0
  return { achievementCount, achievementMaxLevel }
}

const mapLeaguePlayerCardInfo = (input: {
  person: { id: number; firstName: string; lastName: string }
  stats?: {
    totalMatches?: number | null
    totalGoals?: number | null
    totalAssists?: number | null
    yellowCards?: number | null
    redCards?: number | null
  } | null
  club?: {
    id: number
    name: string
    shortName: string
    logoUrl: string | null
  } | null
}): LeaguePlayerCardInfo => {
  const { person, stats, club } = input
  return {
    id: person.id,
    firstName: person.firstName,
    lastName: person.lastName,
    stats: {
      totalMatches: stats?.totalMatches ?? 0,
      totalGoals: stats?.totalGoals ?? 0,
      totalAssists: stats?.totalAssists ?? 0,
      yellowCards: stats?.yellowCards ?? 0,
      redCards: stats?.redCards ?? 0,
    },
    currentClub: club ? { ...club } : null,
  }
}

const loadLeaguePlayerCardInfo = async (
  leaguePlayerId: number | null,
  isVerified: boolean
): Promise<LeaguePlayerCardInfo | null> => {
  if (!isVerified || !leaguePlayerId) {
    return null
  }

  const [person, statsAggregate, currentClub] = await Promise.all([
    prisma.person.findUnique({
      where: { id: leaguePlayerId },
      select: { id: true, firstName: true, lastName: true },
    }),
    prisma.playerClubCareerStats.aggregate({
      where: { personId: leaguePlayerId },
      _sum: {
        totalMatches: true,
        totalGoals: true,
        totalAssists: true,
        yellowCards: true,
        redCards: true,
      },
    }),
    prisma.clubPlayer.findFirst({
      where: { personId: leaguePlayerId },
      orderBy: { updatedAt: 'desc' },
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
  ])

  if (!person) {
    return null
  }

  const stats = statsAggregate?._sum ?? {}
  const club = currentClub?.club

  return mapLeaguePlayerCardInfo({
    person,
    stats,
    club: club
      ? {
          id: club.id,
          name: club.name,
          shortName: club.shortName,
          logoUrl: club.logoUrl,
        }
      : null,
  })
}

export default async function userCardRoutes(server: FastifyInstance) {
  server.get<{ Params: { userId: string } }>('/api/users/:userId/card-extra', async (request, reply) => {
    const rawId = request.params.userId
    const userId = Number(rawId)

    if (!Number.isFinite(userId) || userId <= 0) {
      return reply.status(400).send({ ok: false, error: 'invalid_user_id' })
    }

    const cacheKey = userCardExtraCacheKey(userId)

    try {
      const payload = await defaultCache.get<UserCardExtraView | null>(
        cacheKey,
        async () => {
          const user = await prisma.appUser.findUnique({
            where: { id: userId },
            select: {
              id: true,
              registrationDate: true,
              leaguePlayerId: true,
              leaguePlayerStatus: true,
            },
          })

          if (!user) {
            return null
          }

          const [achievementAggregate, leaguePlayer] = await Promise.all([
            prisma.achievementProgress.aggregate({
              where: { userId: user.id, currentLevel: { gt: 0 } },
              _count: { _all: true },
              _max: { currentLevel: true },
            }),
            loadLeaguePlayerCardInfo(user.leaguePlayerId, user.leaguePlayerStatus === 'VERIFIED'),
          ])

          const { achievementCount, achievementMaxLevel } = mapAchievementStats(achievementAggregate)

          return {
            registrationDate: user.registrationDate.toISOString(),
            achievementCount,
            achievementMaxLevel,
            leaguePlayer,
          }
        },
        USER_CARD_EXTRA_CACHE_OPTIONS
      )

      if (!payload) {
        return reply.status(404).send({ ok: false, error: 'user_not_found' })
      }

      reply.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
      return reply.send({ ok: true, data: payload })
    } catch (err) {
      request.log.error({ err }, 'user card extra fetch failed')
      return reply.status(500).send({ ok: false, error: 'internal' })
    }
  })
}

export { USER_CARD_EXTRA_CACHE_OPTIONS, mapAchievementStats, mapLeaguePlayerCardInfo, loadLeaguePlayerCardInfo }
