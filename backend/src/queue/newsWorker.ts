import { FastifyBaseLogger } from 'fastify'
import { Job, QueueEvents, Worker } from 'bullmq'
import { Bot, GrammyError } from 'grammy'
import prisma from '../db'
import {
  NEWS_QUEUE_NAME,
  ensureNewsQueue,
  enqueueTelegramNewsJob,
  getNewsQueueConnection,
  shutdownNewsQueue,
  TelegramNewsJobPayload,
} from './newsQueue'

const POLL_INTERVAL_MS = 60_000
const FLOOD_RETRY_FALLBACK_MS = 5_000
const PER_RECIPIENT_DELAY_MS = Number(process.env.TELEGRAM_BROADCAST_DELAY_MS ?? '60')
const MAX_FLOOD_RETRIES = 3

let bot: Bot | null = null
let worker: Worker<TelegramNewsJobPayload> | null = null
let pollTimer: NodeJS.Timeout | null = null
let workerRunning = false
let baseLogger: FastifyBaseLogger | null = null
let queueEvents: QueueEvents | null = null

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const ensureBot = (logger: FastifyBaseLogger): Bot | null => {
  if (bot) return bot
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    logger.warn('news worker: telegram token missing — notifications disabled')
    return null
  }
  bot = new Bot(token)
  return bot
}

const isFloodError = (err: unknown): err is GrammyError => {
  return err instanceof GrammyError && err.error_code === 429
}

const resolveFloodRetryDelay = (err: unknown): number => {
  if (!isFloodError(err)) return FLOOD_RETRY_FALLBACK_MS
  const retry = Number(err.parameters?.retry_after ?? 0)
  if (Number.isFinite(retry) && retry > 0) {
    return retry * 1000
  }
  return FLOOD_RETRY_FALLBACK_MS
}

type DeliveryContext = {
  jobId?: string
  source: 'queue' | 'direct'
}

export type DeliveryOutcome = {
  delivered: boolean
  sentCount: number
  failedCount: number
  reason?: 'missing_chat' | 'client_unavailable' | 'rate_limited' | 'send_failed' | 'no_recipients'
  error?: unknown
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const fetchRecipientChatIds = async (logger: FastifyBaseLogger): Promise<string[]> => {
  try {
    const users = await prisma.appUser.findMany({
      select: { telegramId: true },
    })
    return users
      .map(user => (user.telegramId ? user.telegramId.toString() : ''))
      .filter((value): value is string => Boolean(value && value.length))
  } catch (err) {
    logger.error({ err }, 'news worker: failed to load telegram recipients')
    return []
  }
}

const performTelegramSend = async (
  payload: TelegramNewsJobPayload,
  logger: FastifyBaseLogger,
  context: DeliveryContext
): Promise<DeliveryOutcome> => {
  const client = ensureBot(logger)
  if (!client) {
    logger.warn({ ...context }, 'news worker: telegram client unavailable')
    return { delivered: false, sentCount: 0, failedCount: 0, reason: 'client_unavailable' }
  }

  const recipients = await fetchRecipientChatIds(logger)
  if (!recipients.length) {
    logger.warn({ ...context }, 'news worker: no telegram recipients found')
    return { delivered: false, sentCount: 0, failedCount: 0, reason: 'no_recipients' }
  }

  const { title, content, coverUrl } = payload
  const intro = `<b>${escapeHtml(title)}</b>`
  const body = escapeHtml(content).replace(/\n{2,}/g, '\n\n')
  const message = `${intro}\n\n${body}`

  let sentCount = 0
  let failedCount = 0
  const errors: unknown[] = []

  for (const chatId of recipients) {
    let attempt = 0
    let delivered = false
    while (attempt < MAX_FLOOD_RETRIES && !delivered) {
      try {
        if (coverUrl) {
          await client.api.sendPhoto(chatId, coverUrl, {
            caption: message,
            parse_mode: 'HTML',
          })
        } else {
          await client.api.sendMessage(chatId, message, {
            parse_mode: 'HTML',
          })
        }
        sentCount += 1
        delivered = true
      } catch (err) {
        if (isFloodError(err)) {
          attempt += 1
          const delay = resolveFloodRetryDelay(err)
          logger.warn(
            { chatId, delay, attempt },
            'news worker: flood limit reached, retrying telegram send'
          )
          await sleep(delay)
          continue
        }
        failedCount += 1
        errors.push({ chatId, err })
        logger.error({ chatId, err }, 'news worker: failed to deliver telegram message')
        break
      }
    }

    if (!delivered) {
      // exceeded flood retries
      if (attempt >= MAX_FLOOD_RETRIES) {
        failedCount += 1
        errors.push({ chatId, error: 'max_retries_exceeded' })
      }
    }

    await sleep(PER_RECIPIENT_DELAY_MS)
  }

  if (context.source === 'direct') {
    logger.info(
      {
        newsId: payload.newsId,
        sentCount,
        failedCount,
      },
      'news worker: telegram direct delivery completed'
    )
  }

  return {
    delivered: sentCount > 0,
    sentCount,
    failedCount,
    reason: sentCount > 0 ? undefined : 'send_failed',
    error: errors.length ? errors : undefined,
  }
}

const sendTelegramPayload = async (job: Job<TelegramNewsJobPayload>, logger: FastifyBaseLogger) => {
  const outcome = await performTelegramSend(job.data, logger, { jobId: job.id, source: 'queue' })
  if (!outcome.delivered) {
    if (outcome.reason === 'no_recipients') {
      logger.info({ jobId: job.id }, 'news worker: no telegram recipients to notify')
      return
    }
    if (outcome.reason === 'rate_limited' && worker) {
      const delay = resolveFloodRetryDelay(outcome.error)
      logger.warn({ jobId: job.id, delay }, 'news worker: flood control, requeue job')
      await worker.rateLimit(delay)
      throw Worker.RateLimitError()
    }
    if (outcome.error) {
      throw outcome.error
    }
    throw new Error(`telegram_delivery_skipped:${outcome.reason ?? 'unknown'}`)
  }

  logger.info(
    {
      jobId: job.id,
      sentCount: outcome.sentCount,
      failedCount: outcome.failedCount,
    },
    'news worker: telegram broadcast completed'
  )
}

const processJob = async (job: Job<TelegramNewsJobPayload>) => {
  const logger = baseLogger ?? (console as unknown as FastifyBaseLogger)
  await sendTelegramPayload(job, logger)
}

const createWorker = (logger: FastifyBaseLogger): Worker<TelegramNewsJobPayload> | null => {
  if (worker) return worker
  const connection = getNewsQueueConnection()
  if (!connection) {
    logger.warn('news worker: redis connection unavailable')
    return null
  }

  worker = new Worker<TelegramNewsJobPayload>(NEWS_QUEUE_NAME, processJob, {
    autorun: false,
    concurrency: 1,
    limiter: {
      max: 1,
      duration: 1000,
    },
    connection,
  })

  worker.on('completed', job => {
    logger.info({ jobId: job.id }, 'news worker: telegram broadcast completed')
  })

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'news worker: job failed')
  })

  worker.on('drained', async () => {
    logger.info('news worker: queue drained, stopping worker')
    await stopWorker(logger)
  })

  worker.on('error', err => {
    logger.error({ err }, 'news worker: runtime error')
  })

  return worker
}

const runWorker = async (logger: FastifyBaseLogger) => {
  if (workerRunning) return
  const instance = createWorker(logger)
  if (!instance) return
  workerRunning = true
  try {
    await instance.run()
  } catch (err) {
    logger.error({ err }, 'news worker: run terminated with error')
  } finally {
    workerRunning = false
  }
}

async function stopWorker(logger: FastifyBaseLogger) {
  if (!worker) return
  try {
    await worker.close()
  } catch (err) {
    logger.error({ err }, 'news worker: failed to close worker')
  }
  worker = null
  workerRunning = false
}

const evaluateQueue = async (logger: FastifyBaseLogger) => {
  const queue = await ensureNewsQueue()
  if (!queue) return
  const [waiting, delayed, active] = await Promise.all([
    queue.getWaitingCount(),
    queue.getDelayedCount(),
    queue.getActiveCount(),
  ])
  const pending = waiting + delayed + active
  if (pending > 0) {
    await runWorker(logger)
  }
}

export async function startNewsWorkerSupervisor(logger: FastifyBaseLogger) {
  baseLogger = logger
  const queue = await ensureNewsQueue()
  if (!queue) {
    logger.warn('news worker: queue not initialised (no redis url)')
    return
  }

  if (!queueEvents) {
    const connection = getNewsQueueConnection()
    if (connection) {
      queueEvents = new QueueEvents(NEWS_QUEUE_NAME, { connection })
      await queueEvents.waitUntilReady()
      queueEvents.on('waiting', () => {
        evaluateQueue(logger).catch(err => logger.error({ err }, 'news worker: evaluate failed'))
      })
    } else {
      logger.warn('news worker: queue events connection unavailable')
    }
  }

  await evaluateQueue(logger)

  if (pollTimer) {
    clearInterval(pollTimer)
  }
  pollTimer = setInterval(() => {
    evaluateQueue(logger).catch(err => logger.error({ err }, 'news worker: evaluate failed'))
  }, POLL_INTERVAL_MS)
}

export async function shutdownNewsWorker(logger: FastifyBaseLogger) {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  await stopWorker(logger)
  if (queueEvents) {
    try {
      await queueEvents.close()
    } catch (err) {
      logger.error({ err }, 'news worker: failed to close queue events')
    }
    queueEvents = null
  }
  await shutdownNewsQueue()
}

export async function deliverTelegramNewsNow(
  payload: TelegramNewsJobPayload,
  logger: FastifyBaseLogger
): Promise<DeliveryOutcome> {
  return performTelegramSend(payload, logger, { source: 'direct' })
}

export { enqueueTelegramNewsJob }
