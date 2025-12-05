/**
 * Routes для отслеживания времени просмотра трансляций
 *
 * Архитектура оптимизирована для минимальной нагрузки:
 * - Клиент накапливает время в localStorage
 * - Синхронизация происходит периодически или при выходе
 * - Защита от накрутки через лимит времени за сессию
 */

import { FastifyInstance } from 'fastify'
import prisma from '../db'
import { extractSessionToken, resolveSessionSubject } from '../utils/session'
import { syncBroadcastWatchProgress } from '../services/achievementProgress'
import { defaultCache } from '../cache'

// Максимум 1 час за одну сессию (защита от накрутки, матч ~50 мин)
const MAX_SESSION_SECONDS = 1 * 60 * 60
// Минимальное время для синхронизации (1 минута)
const MIN_SYNC_SECONDS = 60

type SyncWatchTimeBody = {
  matchId: string
  watchedSeconds: number
}

export default async function (server: FastifyInstance) {
  /**
   * POST /api/broadcast/sync-watch-time
   *
   * Синхронизирует накопленное время просмотра трансляции.
   * Вызывается клиентом при выходе из вкладки "Эфир" или периодически.
   *
   * Защита от накрутки:
   * - Лимит MAX_SESSION_SECONDS за одну сессию
   * - Проверка что матч существует и имеет broadcastUrl
   * - Игнорирование слишком малых значений
   */
  server.post<{ Body: SyncWatchTimeBody }>(
    '/api/broadcast/sync-watch-time',
    async (request, reply) => {
      const token = extractSessionToken(request)
      if (!token) {
        return reply.status(401).send({ error: 'unauthorized' })
      }
      const telegramId = await resolveSessionSubject(token)
      if (!telegramId) {
        return reply.status(401).send({ error: 'unauthorized' })
      }

      const { matchId, watchedSeconds } = request.body || {}

      // Валидация входных данных
      if (!matchId || typeof watchedSeconds !== 'number') {
        return reply.status(400).send({ error: 'matchId and watchedSeconds required' })
      }

      // Игнорируем слишком малые значения
      if (watchedSeconds < MIN_SYNC_SECONDS) {
        return reply.send({ success: true, synced: 0 })
      }

      // Ограничиваем время за сессию
      const cappedSeconds = Math.min(watchedSeconds, MAX_SESSION_SECONDS)

      try {
        // Проверяем что матч существует и имеет трансляцию
        const match = await prisma.match.findUnique({
          where: { id: BigInt(matchId) },
          select: { id: true, broadcastUrl: true },
        })

        if (!match || !match.broadcastUrl) {
          return reply.status(400).send({ error: 'match_not_found_or_no_broadcast' })
        }

        // Находим пользователя
        const user = await prisma.appUser.findUnique({
          where: { telegramId: BigInt(telegramId) },
          select: { id: true },
        })

        if (!user) {
          return reply.status(401).send({ error: 'user_not_found' })
        }

        // Upsert времени просмотра (идемпотентная операция с инкрементом)
        const watchTime = await prisma.userBroadcastWatchTime.upsert({
          where: { userId: user.id },
          create: {
            userId: user.id,
            totalSeconds: cappedSeconds,
          },
          update: {
            totalSeconds: { increment: cappedSeconds },
          },
        })

        // Синхронизируем прогресс достижения (конвертируем секунды в минуты)
        const totalMinutes = watchTime.totalSeconds / 60
        await syncBroadcastWatchProgress(user.id, totalMinutes)

        // Инвалидируем кэш достижений чтобы пользователь увидел обновленный прогресс
        await defaultCache.invalidatePrefix(`user:achievements:${telegramId}`).catch(() => undefined)

        server.log.info(
          {
            userId: user.id,
            matchId,
            syncedSeconds: cappedSeconds,
            totalSeconds: watchTime.totalSeconds,
            totalMinutes: Math.floor(totalMinutes),
          },
          'broadcast watch time synced'
        )

        return reply.send({
          success: true,
          synced: cappedSeconds,
          totalSeconds: watchTime.totalSeconds,
          totalMinutes: Math.floor(totalMinutes),
        })
      } catch (err) {
        server.log.error({ err, matchId, watchedSeconds }, 'failed to sync broadcast watch time')
        return reply.status(500).send({ error: 'internal' })
      }
    }
  )

  /**
   * GET /api/broadcast/watch-time
   *
   * Возвращает текущее суммарное время просмотра трансляций.
   */
  server.get('/api/broadcast/watch-time', async (request, reply) => {
    const token = extractSessionToken(request)
    if (!token) {
      return reply.status(401).send({ error: 'unauthorized' })
    }
    const telegramId = await resolveSessionSubject(token)
    if (!telegramId) {
      return reply.status(401).send({ error: 'unauthorized' })
    }

    try {
      const user = await prisma.appUser.findUnique({
        where: { telegramId: BigInt(telegramId) },
        select: { id: true },
      })

      if (!user) {
        return reply.status(401).send({ error: 'user_not_found' })
      }

      const watchTime = await prisma.userBroadcastWatchTime.findUnique({
        where: { userId: user.id },
      })

      const totalSeconds = watchTime?.totalSeconds ?? 0
      const totalMinutes = totalSeconds / 60

      return reply.send({
        totalSeconds,
        totalMinutes: Math.floor(totalMinutes),
      })
    } catch (err) {
      server.log.error({ err }, 'failed to get broadcast watch time')
      return reply.status(500).send({ error: 'internal' })
    }
  })
}
