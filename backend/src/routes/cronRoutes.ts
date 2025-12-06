/**
 * Cron-роуты для обработки очереди уведомлений.
 * Защищены секретным токеном (X-Cron-Secret).
 */

import { FastifyPluginAsync } from 'fastify'
import prisma from '../db'
import {
  sendMatchReminder,
  sendMatchStartedNotification,
  sendMatchFinishedNotification,
  isNotificationBotConfigured,
  type MatchNotificationDetails,
} from '../services/notificationService'

// Размер пакета для обработки
const BATCH_SIZE = 50
// Максимальное количество повторных попыток
const MAX_RETRIES = 3

const cronRoutes: FastifyPluginAsync = async fastify => {
  /**
   * Endpoint для обработки очереди уведомлений.
   * Вызывается внешним cron-сервисом (cron-job.org).
   *
   * GET /api/cron/notifications
   * Header: X-Cron-Secret: <secret>
   */
  fastify.get('/api/cron/notifications', async (request, reply) => {
    // Проверяем секретный токен
    const cronSecret = request.headers['x-cron-secret']
    const expectedSecret = process.env.CRON_SECRET

    if (!expectedSecret) {
      fastify.log.warn('CRON_SECRET not configured')
      return reply.status(500).send({ ok: false, error: 'cron_not_configured' })
    }

    if (cronSecret !== expectedSecret) {
      return reply.status(401).send({ ok: false, error: 'unauthorized' })
    }

    // Проверяем, настроен ли бот
    if (!isNotificationBotConfigured()) {
      return reply.send({
        ok: true,
        data: {
          processed: 0,
          sent: 0,
          failed: 0,
          message: 'Bot not configured',
        },
      })
    }

    const now = new Date()
    let sent = 0
    let failed = 0

    try {
      // Получаем уведомления, которые пора отправить
      const pendingNotifications = await prisma.notificationQueue.findMany({
        where: {
          status: 'PENDING',
          scheduledAt: { lte: now },
          retryCount: { lt: MAX_RETRIES },
        },
        take: BATCH_SIZE,
        orderBy: { scheduledAt: 'asc' },
        include: {
          match: {
            include: {
              homeClub: { select: { id: true, name: true, shortName: true } },
              awayClub: { select: { id: true, name: true, shortName: true } },
              stadium: { select: { name: true } },
              season: {
                select: {
                  name: true,
                  competition: { select: { name: true } },
                },
              },
            },
          },
          user: {
            select: {
              notificationSettings: true,
            },
          },
        },
      })

      fastify.log.info({ count: pendingNotifications.length }, 'Processing notification batch')

      for (const notification of pendingNotifications) {
        // Проверяем, что пользователь не отключил уведомления
        const settings = notification.user.notificationSettings
        if (!settings?.enabled) {
          await prisma.notificationQueue.update({
            where: { id: notification.id },
            data: { status: 'CANCELLED' },
          })
          continue
        }

        // Формируем данные матча
        const matchDetails: MatchNotificationDetails = {
          id: notification.matchId.toString(),
          homeClubName: notification.match.homeClub.name,
          homeClubShortName: notification.match.homeClub.shortName,
          awayClubName: notification.match.awayClub.name,
          awayClubShortName: notification.match.awayClub.shortName,
          homeScore: notification.match.homeScore,
          awayScore: notification.match.awayScore,
          matchDateTime: notification.match.matchDateTime,
          broadcastUrl: notification.match.broadcastUrl,
          stadiumName: notification.match.stadium?.name,
          competitionName: notification.match.season?.competition?.name,
          seasonName: notification.match.season?.name,
        }

        // Если матч перенесли, перепланируем напоминание и не отправляем сейчас
        if (
          notification.messageType === 'MATCH_REMINDER' &&
          notification.match.status === 'SCHEDULED'
        ) {
          const expected = new Date(notification.match.matchDateTime)
          expected.setMinutes(expected.getMinutes() - settings.remindBefore)

          if (expected.getTime() !== notification.scheduledAt.getTime()) {
            // Если новое время уже в будущем — перенесём задачу
            if (expected.getTime() > now.getTime()) {
              await prisma.notificationQueue.update({
                where: { id: notification.id },
                data: { scheduledAt: expected, status: 'PENDING', retryCount: 0 },
              })
              continue
            }
          }
        }

        let result: Awaited<ReturnType<typeof sendMatchReminder>>

        // Отправляем в зависимости от типа
        switch (notification.messageType) {
          case 'MATCH_REMINDER':
            result = await sendMatchReminder(
              notification.telegramId,
              matchDetails,
              settings.remindBefore
            )
            break

          case 'MATCH_STARTED':
            result = await sendMatchStartedNotification(notification.telegramId, matchDetails)
            break

          case 'MATCH_FINISHED':
            result = await sendMatchFinishedNotification(notification.telegramId, matchDetails)
            break

          default:
            // GOAL_SCORED обрабатывается отдельно
            result = { success: false, errorMessage: 'Unsupported message type' }
        }

        // Обновляем статус в БД
        if (result.success) {
          await prisma.notificationQueue.update({
            where: { id: notification.id },
            data: {
              status: 'SENT',
              sentAt: now,
            },
          })
          sent++
        } else {
          // При ошибке 403 (бот заблокирован) — помечаем как FAILED без ретрая
          const isFatalError = result.errorCode === 403 || result.errorCode === 400

          await prisma.notificationQueue.update({
            where: { id: notification.id },
            data: {
              status: isFatalError ? 'FAILED' : 'PENDING',
              errorMessage: result.errorMessage,
              retryCount: { increment: 1 },
            },
          })
          failed++

          fastify.log.warn(
            {
              notificationId: notification.id,
              telegramId: notification.telegramId.toString(),
              errorMessage: result.errorMessage,
              errorCode: result.errorCode,
            },
            'Notification send failed'
          )
        }

        // Небольшая задержка между отправками (rate limiting)
        await new Promise(resolve => setTimeout(resolve, 50))
      }

      return reply.send({
        ok: true,
        data: {
          processed: pendingNotifications.length,
          sent,
          failed,
          timestamp: now.toISOString(),
        },
      })
    } catch (err) {
      fastify.log.error({ err }, 'Cron notification processing failed')
      return reply.status(500).send({
        ok: false,
        error: 'processing_failed',
        data: { sent, failed },
      })
    }
  })

  // Очистка старых уведомлений (SENT/CANCELLED) старше 1 дня
  fastify.get('/api/cron/notifications/cleanup', async (request, reply) => {
    const cronSecret = request.headers['x-cron-secret']
    const expectedSecret = process.env.CRON_SECRET

    if (!expectedSecret) {
      fastify.log.warn('CRON_SECRET not configured')
      return reply.status(500).send({ ok: false, error: 'cron_not_configured' })
    }

    if (cronSecret !== expectedSecret) {
      return reply.status(401).send({ ok: false, error: 'unauthorized' })
    }

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const { count } = await prisma.notificationQueue.deleteMany({
      where: {
        status: { in: ['SENT', 'CANCELLED'] },
        scheduledAt: { lt: cutoff },
      },
    })

    return reply.send({ ok: true, data: { deleted: count } })
  })

  /**
   * Получить статистику очереди уведомлений.
   * Только для админов (через X-Cron-Secret).
   */
  fastify.get('/api/cron/notifications/stats', async (request, reply) => {
    const cronSecret = request.headers['x-cron-secret']
    const expectedSecret = process.env.CRON_SECRET

    if (!expectedSecret || cronSecret !== expectedSecret) {
      return reply.status(401).send({ ok: false, error: 'unauthorized' })
    }

    try {
      const [pending, sent, failed, cancelled] = await Promise.all([
        prisma.notificationQueue.count({ where: { status: 'PENDING' } }),
        prisma.notificationQueue.count({ where: { status: 'SENT' } }),
        prisma.notificationQueue.count({ where: { status: 'FAILED' } }),
        prisma.notificationQueue.count({ where: { status: 'CANCELLED' } }),
      ])

      // Ближайшие уведомления
      const upcoming = await prisma.notificationQueue.findMany({
        where: { status: 'PENDING' },
        take: 10,
        orderBy: { scheduledAt: 'asc' },
        select: {
          id: true,
          scheduledAt: true,
          messageType: true,
          match: {
            select: {
              homeClub: { select: { shortName: true } },
              awayClub: { select: { shortName: true } },
            },
          },
        },
      })

      return reply.send({
        ok: true,
        data: {
          counts: { pending, sent, failed, cancelled },
          upcoming: upcoming.map(n => ({
            id: n.id,
            scheduledAt: n.scheduledAt.toISOString(),
            messageType: n.messageType,
            match: `${n.match.homeClub.shortName} vs ${n.match.awayClub.shortName}`,
          })),
        },
      })
    } catch (err) {
      fastify.log.error({ err }, 'Failed to get notification stats')
      return reply.status(500).send({ ok: false, error: 'internal_error' })
    }
  })

  /**
   * Очистка старых записей из очереди.
   * Удаляет отправленные и отменённые уведомления старше 7 дней.
   */
  fastify.delete('/api/cron/notifications/cleanup', async (request, reply) => {
    const cronSecret = request.headers['x-cron-secret']
    const expectedSecret = process.env.CRON_SECRET

    if (!expectedSecret || cronSecret !== expectedSecret) {
      return reply.status(401).send({ ok: false, error: 'unauthorized' })
    }

    try {
      const sevenDaysAgo = new Date()
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

      const deleted = await prisma.notificationQueue.deleteMany({
        where: {
          status: { in: ['SENT', 'CANCELLED', 'FAILED'] },
          createdAt: { lt: sevenDaysAgo },
        },
      })

      return reply.send({
        ok: true,
        data: { deleted: deleted.count },
      })
    } catch (err) {
      fastify.log.error({ err }, 'Failed to cleanup notifications')
      return reply.status(500).send({ ok: false, error: 'internal_error' })
    }
  })
}

export default cronRoutes
