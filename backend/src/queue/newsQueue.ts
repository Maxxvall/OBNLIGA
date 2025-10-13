import { Queue, JobsOptions } from 'bullmq'
import Redis, { Redis as RedisClient } from 'ioredis'

export type TelegramNewsJobPayload = {
  newsId: string
  title: string
  content: string
  coverUrl?: string | null
}

export const NEWS_QUEUE_NAME = 'telegram-news'

let connection: RedisClient | null = null
let queue: Queue<TelegramNewsJobPayload> | null = null
let initPromise: Promise<Queue<TelegramNewsJobPayload> | null> | null = null

const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000,
  },
  removeOnComplete: {
    age: 3600,
    count: 200,
  },
  removeOnFail: false,
}

const getRedisUrl = () => process.env.REDIS_URL || process.env.REDIS

async function initQueue(): Promise<Queue<TelegramNewsJobPayload> | null> {
  if (queue) {
    return queue
  }

  const redisUrl = getRedisUrl()
  if (!redisUrl) {
    return null
  }

  connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
  })

  queue = new Queue<TelegramNewsJobPayload>(NEWS_QUEUE_NAME, {
    connection,
    defaultJobOptions,
  })

  return queue
}

export async function ensureNewsQueue(): Promise<Queue<TelegramNewsJobPayload> | null> {
  if (!initPromise) {
    initPromise = initQueue().catch(err => {
      console.error('newsQueue:init failed', err)
      initPromise = null
      return null
    })
  }
  return initPromise
}

export async function enqueueTelegramNewsJob(payload: TelegramNewsJobPayload) {
  const q = await ensureNewsQueue()
  if (!q) {
    return { queued: false }
  }
  await q.add('broadcast', payload)
  return { queued: true }
}

export function getNewsQueueConnection(): RedisClient | null {
  return connection
}

export async function shutdownNewsQueue() {
  if (queue) {
    try {
      await queue.close()
    } catch (err) {
      console.warn('newsQueue:queue close failed', err)
    }
    queue = null
  }
  if (connection) {
    try {
      await connection.quit()
    } catch (err) {
      console.warn('newsQueue:connection quit failed', err)
      connection.disconnect()
    }
    connection = null
  }
  initPromise = null
}
