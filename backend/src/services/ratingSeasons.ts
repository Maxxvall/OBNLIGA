import { AchievementMetric, Prisma, PrismaClient, RatingScope } from '@prisma/client'
import prisma from '../db'

const DAY_MS = 24 * 60 * 60 * 1000

export type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient

export type SeasonWinnerInput = {
  userId: number
  rank: number
  scopePoints: number
  totalPoints: number
  predictionCount: number
  predictionWins: number
  displayName: string
  username: string | null
  photoUrl: string | null
}

const seasonDelegate = (client: PrismaClientOrTx) => client.ratingSeason
const winnerDelegate = (client: PrismaClientOrTx) => client.ratingSeasonWinner

export const getActiveSeasonsMap = async (client: PrismaClientOrTx = prisma) => {
  const seasons = await seasonDelegate(client).findMany({
    where: { closedAt: null },
    orderBy: { startsAt: 'desc' },
  })
  const map = new Map<RatingScope, typeof seasons[number]>()
  for (const season of seasons) {
    if (!map.has(season.scope)) {
      map.set(season.scope, season)
    }
  }
  return map
}

export const getActiveSeason = async (
  scope: RatingScope,
  client: PrismaClientOrTx = prisma
) => {
  const map = await getActiveSeasonsMap(client)
  return map.get(scope) ?? null
}

export const startSeason = async (
  scope: RatingScope,
  durationDays: number,
  startsAt: Date,
  client: PrismaClientOrTx = prisma
) => {
  const normalizedDuration = Math.max(1, Math.trunc(durationDays))
  const seasonStarts = new Date(startsAt)
  const seasonEnds = new Date(seasonStarts.getTime() + normalizedDuration * DAY_MS)
  return seasonDelegate(client).create({
    data: {
      scope,
      startsAt: seasonStarts,
      endsAt: seasonEnds,
      durationDays: normalizedDuration,
    },
  })
}

export const closeActiveSeason = async (
  scope: RatingScope,
  endedAt: Date,
  winners: SeasonWinnerInput[],
  client: PrismaClientOrTx = prisma
) => {
  const current = await seasonDelegate(client).findFirst({
    where: { scope, closedAt: null },
    orderBy: { startsAt: 'desc' },
  })

  if (!current) {
    return null
  }

  const updated = await seasonDelegate(client).update({
    where: { id: current.id },
    data: {
      closedAt: endedAt,
      endsAt: endedAt,
    },
  })

  if (winners.length) {
    await winnerDelegate(client).createMany({
      data: winners.map(winner => ({
        seasonId: updated.id,
        userId: winner.userId,
        rank: winner.rank,
        scopePoints: winner.scopePoints,
        totalPoints: winner.totalPoints,
        predictionCount: winner.predictionCount,
        predictionWins: winner.predictionWins,
        displayName: winner.displayName,
        username: winner.username,
        photoUrl: winner.photoUrl,
      })),
      skipDuplicates: true,
    })
  }

  const withWinners = await seasonDelegate(client).findUnique({
    where: { id: updated.id },
    include: { winners: { orderBy: { rank: 'asc' } } },
  })

  return withWinners ?? updated
}

export const fetchSeasonSummaries = async (
  client: PrismaClientOrTx = prisma,
  options: { limit?: number } = {}
) => {
  const limit = options.limit && options.limit > 0 ? Math.trunc(options.limit) : 12
  const seasons = await seasonDelegate(client).findMany({
    orderBy: { startsAt: 'desc' },
    take: limit,
    include: {
      winners: {
        orderBy: { rank: 'asc' },
      },
    },
  })
  return seasons
}

/**
 * Сбрасывает прогресс достижения SEASON_POINTS для всех пользователей.
 * Вызывается при закрытии сезонного рейтинга.
 * Это позволяет пользователям начинать новый сезон с нуля.
 */
export const resetSeasonPointsAchievements = async (
  client: PrismaClientOrTx = prisma
): Promise<number> => {
  // Находим тип достижения SEASON_POINTS
  const achievementType = await client.achievementType.findFirst({
    where: { metric: AchievementMetric.SEASON_POINTS },
  })

  if (!achievementType) {
    return 0
  }

  // Сбрасываем прогресс всех пользователей по этому достижению
  const result = await client.userAchievementProgress.updateMany({
    where: { achievementId: achievementType.id },
    data: {
      currentLevel: 0,
      progressCount: 0,
      lastUnlockedAt: null,
    },
  })

  // Удаляем записи из userAchievement для этого типа
  await client.userAchievement.deleteMany({
    where: { achievementTypeId: achievementType.id },
  })

  return result.count
}
