/**
 * Вспомогательные функции для работы с подписками и планированием уведомлений.
 */

import prisma from '../db'

/**
 * Получает или создаёт настройки уведомлений пользователя.
 */
export async function getOrCreateNotificationSettings(userId: number) {
  let settings = await prisma.notificationSettings.findUnique({
    where: { userId },
  })

  if (!settings) {
    settings = await prisma.notificationSettings.create({
      data: {
        userId,
        enabled: true,
        matchStartEnabled: true,
        matchEndEnabled: false,
        goalEnabled: false,
      },
    })
  }

  return settings
}

/**
 * Планирует уведомления о начале матча для всех подписчиков.
 * Вызывается при изменении статуса матча на LIVE.
 */
export async function scheduleMatchStartNotifications(matchId: bigint): Promise<number> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      homeTeamId: true,
      awayTeamId: true,
    },
  })

  if (!match) return 0

  // Находим подписчиков на команды + подписчиков на конкретный матч
  const [clubSubscribers, matchSubscribers] = await Promise.all([
    prisma.clubSubscription.findMany({
      where: {
        clubId: { in: [match.homeTeamId, match.awayTeamId] },
      },
      include: {
        user: {
          select: {
            id: true,
            telegramId: true,
            notificationSettings: true,
          },
        },
      },
    }),
    prisma.matchSubscription.findMany({
      where: { matchId },
      include: {
        user: {
          select: {
            id: true,
            telegramId: true,
            notificationSettings: true,
          },
        },
      },
    }),
  ])

  const uniqueUsers = new Map<number, bigint>()

  for (const sub of clubSubscribers) {
    const settings = sub.user.notificationSettings
    if (settings?.enabled && settings.matchStartEnabled) {
      uniqueUsers.set(sub.userId, sub.user.telegramId)
    }
  }

  for (const sub of matchSubscribers) {
    const settings = sub.user.notificationSettings
    if (settings?.enabled && settings.matchStartEnabled) {
      uniqueUsers.set(sub.userId, sub.user.telegramId)
    }
  }

  const now = new Date()
  let scheduledCount = 0

  for (const [userId, telegramId] of uniqueUsers) {
    try {
      await prisma.notificationQueue.upsert({
        where: {
          userId_matchId_messageType: {
            userId,
            matchId,
            messageType: 'MATCH_STARTED',
          },
        },
        create: {
          userId,
          telegramId,
          matchId,
          scheduledAt: now,
          messageType: 'MATCH_STARTED',
        },
        update: {
          scheduledAt: now,
          status: 'PENDING',
        },
      })
      scheduledCount++
    } catch (err) {
      console.error('Failed to schedule match start notification:', { userId, matchId: matchId.toString(), err })
    }
  }

  return scheduledCount
}

/**
 * Планирует уведомления о завершении матча для всех подписчиков.
 * Вызывается при изменении статуса матча на FINISHED.
 */
export async function scheduleMatchEndNotifications(matchId: bigint): Promise<number> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      homeTeamId: true,
      awayTeamId: true,
    },
  })

  if (!match) return 0

  const [clubSubscribers, matchSubscribers] = await Promise.all([
    prisma.clubSubscription.findMany({
      where: {
        clubId: { in: [match.homeTeamId, match.awayTeamId] },
      },
      include: {
        user: {
          select: {
            id: true,
            telegramId: true,
            notificationSettings: true,
          },
        },
      },
    }),
    prisma.matchSubscription.findMany({
      where: { matchId },
      include: {
        user: {
          select: {
            id: true,
            telegramId: true,
            notificationSettings: true,
          },
        },
      },
    }),
  ])

  const uniqueUsers = new Map<number, bigint>()

  for (const sub of clubSubscribers) {
    const settings = sub.user.notificationSettings
    if (settings?.enabled && settings.matchEndEnabled) {
      uniqueUsers.set(sub.userId, sub.user.telegramId)
    }
  }

  for (const sub of matchSubscribers) {
    const settings = sub.user.notificationSettings
    if (settings?.enabled && settings.matchEndEnabled) {
      uniqueUsers.set(sub.userId, sub.user.telegramId)
    }
  }

  const now = new Date()
  let scheduledCount = 0

  for (const [userId, telegramId] of uniqueUsers) {
    try {
      await prisma.notificationQueue.upsert({
        where: {
          userId_matchId_messageType: {
            userId,
            matchId,
            messageType: 'MATCH_FINISHED',
          },
        },
        create: {
          userId,
          telegramId,
          matchId,
          scheduledAt: now,
          messageType: 'MATCH_FINISHED',
        },
        update: {
          scheduledAt: now,
          status: 'PENDING',
        },
      })
      scheduledCount++
    } catch (err) {
      console.error('Failed to schedule match end notification:', { userId, matchId: matchId.toString(), err })
    }
  }

  return scheduledCount
}
