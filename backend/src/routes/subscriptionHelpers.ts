/**
 * Вспомогательные функции для работы с подписками и планированием уведомлений.
 */

import prisma from '../db'
import { NotificationMessageType, NotificationStatus } from '@prisma/client'

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
  return scheduleMatchNotifications(matchId, 'matchStartEnabled', NotificationMessageType.MATCH_STARTED)
}

/**
 * Планирует уведомления о завершении матча для всех подписчиков.
 * Вызывается при изменении статуса матча на FINISHED.
 */
export async function scheduleMatchEndNotifications(matchId: bigint): Promise<number> {
  return scheduleMatchNotifications(matchId, 'matchEndEnabled', NotificationMessageType.MATCH_FINISHED)
}

type NotificationFlag = 'matchStartEnabled' | 'matchEndEnabled'

const scheduleMatchNotifications = async (
  matchId: bigint,
  flag: NotificationFlag,
  messageType: NotificationMessageType
): Promise<number> => {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      homeTeamId: true,
      awayTeamId: true,
    },
  })

  if (!match) return 0

  const [clubSubscribers, matchSubscribers] = await Promise.all([
    prisma.clubSubscription.findMany({
      where: { clubId: { in: [match.homeTeamId, match.awayTeamId] } },
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

  const uniqueUsers = collectNotificationTargets(clubSubscribers, flag)
  collectNotificationTargets(matchSubscribers, flag, uniqueUsers)

  return scheduleNotificationBatch(matchId, messageType, uniqueUsers)
}

const collectNotificationTargets = (
  subscribers: Array<{
    userId: number
    user: {
      telegramId: bigint | null
      notificationSettings?: {
        enabled: boolean
        matchStartEnabled: boolean
        matchEndEnabled: boolean
      } | null
    }
  }>,
  flag: NotificationFlag,
  targets: Map<number, bigint> = new Map()
): Map<number, bigint> => {
  for (const sub of subscribers) {
    const settings = sub.user.notificationSettings
    if (
      settings?.enabled &&
      (settings as Record<string, boolean>)[flag] &&
      sub.user.telegramId !== null
    ) {
      targets.set(sub.userId, sub.user.telegramId)
    }
  }

  return targets
}

const scheduleNotificationBatch = async (
  matchId: bigint,
  messageType: NotificationMessageType,
  targets: Map<number, bigint>
): Promise<number> => {
  if (!targets.size) {
    return 0
  }

  const now = new Date()
  const userIds = Array.from(targets.keys())

  const [updateResult, createResult] = await Promise.all([
    prisma.notificationQueue.updateMany({
      where: {
        matchId,
        messageType,
        userId: { in: userIds },
      },
      data: {
        scheduledAt: now,
        status: NotificationStatus.PENDING,
      },
    }),
    prisma.notificationQueue.createMany({
      data: Array.from(targets, ([userId, telegramId]) => ({
        userId,
        telegramId,
        matchId,
        scheduledAt: now,
        messageType,
        status: NotificationStatus.PENDING,
      })),
      skipDuplicates: true,
    }),
  ])

  return updateResult.count + createResult.count
}
