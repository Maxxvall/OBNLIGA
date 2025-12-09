import { AchievementMetric } from '@prisma/client'
import { FastifyInstance } from 'fastify'
import type {
  LeaguePlayerCardInfo,
  LeaguePlayerClubInfo,
  UserAchievementBadge,
  UserCardExtraView,
} from '@shared/types'
import prisma from '../db'
import { defaultCache, type CacheFetchOptions } from '../cache'
import { userCardExtraCacheKey } from '../cache'

const USER_CARD_EXTRA_CACHE_OPTIONS: CacheFetchOptions = {
  ttlSeconds: 120,
  staleWhileRevalidateSeconds: 300,
  lockTimeoutSeconds: 5,
}

const ACHIEVEMENT_GROUP_BY_METRIC: Record<AchievementMetric, string> = {
  [AchievementMetric.DAILY_LOGIN]: 'streak',
  [AchievementMetric.TOTAL_PREDICTIONS]: 'predictions',
  [AchievementMetric.CORRECT_PREDICTIONS]: 'bet_wins',
  [AchievementMetric.SEASON_POINTS]: 'credits',
  [AchievementMetric.PREDICTION_STREAK]: 'prediction_streak',
  [AchievementMetric.EXPRESS_WINS]: 'express_wins',
  [AchievementMetric.BROADCAST_WATCH_TIME]: 'broadcast_watch',
  [AchievementMetric.EXPRESS_BETS_CREATED]: 'express_created',
  [AchievementMetric.TOTAL_GOALS_PREDICTIONS_WON]: 'total_goals',
  [AchievementMetric.SHOP_ORDERS_COMPLETED]: 'shop_orders',
  [AchievementMetric.BROADCAST_COMMENTS]: 'broadcast_comments',
}

const mapAchievementStats = (aggregate: {
  _count?: { _all?: number | null }
  _max?: { currentLevel?: number | null }
} | null) => {
  const achievementCount = aggregate?._count?._all ?? 0
  const achievementMaxLevel = aggregate?._max?.currentLevel ?? 0
  return { achievementCount, achievementMaxLevel }
}

const mapAchievementBadges = (
  progressEntries: Array<{
    achievementId: number
    currentLevel: number
    achievementType: { name: string; metric: AchievementMetric }
  }>,
  levelEntries: Array<{ achievementId: number; level: number; iconUrl: string | null; title: string | null }>
): UserAchievementBadge[] => {
  if (!progressEntries.length) {
    return []
  }

  const levelMap = new Map<string, { iconUrl: string | null; title: string | null }>()

  for (const level of levelEntries) {
    levelMap.set(`${level.achievementId}:${level.level}`, {
      iconUrl: level.iconUrl ?? null,
      title: level.title ?? null,
    })
  }

  return progressEntries.map(entry => {
    const group = ACHIEVEMENT_GROUP_BY_METRIC[entry.achievementType.metric] ?? entry.achievementType.name
    const levelKey = `${entry.achievementId}:${entry.currentLevel}`
    const levelData = levelMap.get(levelKey)

    return {
      achievementId: entry.achievementId,
      group,
      level: entry.currentLevel,
      iconUrl: levelData?.iconUrl ?? null,
      title: levelData?.title ?? entry.achievementType.name,
    }
  })
}

const loadAchievementBadges = async (userId: number, limit = 8): Promise<UserAchievementBadge[]> => {
  const progressEntries = await prisma.achievementProgress.findMany({
    where: { userId, currentLevel: { gt: 0 } },
    orderBy: [
      { currentLevel: 'desc' },
      { lastUnlockedAt: 'desc' },
      { updatedAt: 'desc' },
    ],
    take: limit,
    select: {
      achievementId: true,
      currentLevel: true,
      achievementType: {
        select: {
          name: true,
          metric: true,
        },
      },
    },
  })

  if (!progressEntries.length) {
    return []
  }

  const levelFilters = progressEntries.map(entry => ({
    achievementId: entry.achievementId,
    level: entry.currentLevel,
  }))

  const levelEntries = await prisma.achievementLevel.findMany({
    where: { OR: levelFilters },
    select: {
      achievementId: true,
      level: true,
      iconUrl: true,
      title: true,
    },
  })

  return mapAchievementBadges(progressEntries, levelEntries)
}

const mapLeaguePlayerCardInfo = (input: {
  person: { id: number; firstName: string; lastName: string }
  totalStats?: {
    totalMatches?: number | null
    totalGoals?: number | null
    totalAssists?: number | null
    yellowCards?: number | null
    redCards?: number | null
  } | null
  currentClub?: {
    id: number
    name: string
    shortName: string
    logoUrl: string | null
  } | null
  clubs: LeaguePlayerClubInfo[]
}): LeaguePlayerCardInfo => {
  const { person, totalStats, currentClub, clubs } = input
  return {
    id: person.id,
    firstName: person.firstName,
    lastName: person.lastName,
    stats: {
      totalMatches: totalStats?.totalMatches ?? 0,
      totalGoals: totalStats?.totalGoals ?? 0,
      totalAssists: totalStats?.totalAssists ?? 0,
      yellowCards: totalStats?.yellowCards ?? 0,
      redCards: totalStats?.redCards ?? 0,
    },
    currentClub: currentClub ? { ...currentClub } : null,
    clubs,
  }
}

const loadLeaguePlayerCardInfo = async (
  leaguePlayerId: number | null,
  isVerified: boolean
): Promise<LeaguePlayerCardInfo | null> => {
  if (!isVerified || !leaguePlayerId) {
    return null
  }

  const [person, statsAggregate, currentClub, clubCareerStats] = await Promise.all([
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
    // Загружаем статистику по всем клубам игрока
    prisma.playerClubCareerStats.findMany({
      where: { personId: leaguePlayerId },
      include: {
        club: {
          select: {
            id: true,
            name: true,
            logoUrl: true,
          },
        },
      },
      orderBy: { totalMatches: 'desc' },
    }),
  ])

  if (!person) {
    return null
  }

  const totalStats = statsAggregate?._sum ?? {}
  const club = currentClub?.club

  // Формируем массив всех клубов с их статистикой
  const clubs: LeaguePlayerClubInfo[] = clubCareerStats.map(careerStats => ({
    id: careerStats.club.id,
    name: careerStats.club.name,
    logoUrl: careerStats.club.logoUrl,
    stats: {
      totalMatches: careerStats.totalMatches,
      totalGoals: careerStats.totalGoals,
      totalAssists: careerStats.totalAssists,
      yellowCards: careerStats.yellowCards,
      redCards: careerStats.redCards,
    },
  }))

  return mapLeaguePlayerCardInfo({
    person,
    totalStats,
    currentClub: club
      ? {
          id: club.id,
          name: club.name,
          shortName: club.shortName,
          logoUrl: club.logoUrl,
        }
      : null,
    clubs,
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

          const [achievementAggregate, leaguePlayer, achievementBadges] = await Promise.all([
            prisma.achievementProgress.aggregate({
              where: { userId: user.id, currentLevel: { gt: 0 } },
              _count: { _all: true },
              _max: { currentLevel: true },
            }),
            loadLeaguePlayerCardInfo(user.leaguePlayerId, user.leaguePlayerStatus === 'VERIFIED'),
            loadAchievementBadges(user.id),
          ])

          const { achievementCount, achievementMaxLevel } = mapAchievementStats(achievementAggregate)

          return {
            registrationDate: user.registrationDate.toISOString(),
            achievementCount,
            achievementMaxLevel,
            achievementBadges,
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

export {
  USER_CARD_EXTRA_CACHE_OPTIONS,
  mapAchievementStats,
  mapLeaguePlayerCardInfo,
  loadLeaguePlayerCardInfo,
  mapAchievementBadges,
  loadAchievementBadges,
}
