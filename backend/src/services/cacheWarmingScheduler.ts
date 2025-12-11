import { FastifyBaseLogger } from 'fastify'
import { getMatchWindow, type MatchWindowPhase } from '../cache'
import { maybePrewarmPublicLeagueCaches } from './cachePrewarm'

const BASE_INTERVAL_MS = 4 * 60 * 1000 // 4 minutes
const AGGRESSIVE_INTERVAL_MS = 45 * 1000 // 45 seconds
const INITIAL_DELAY_MS = 30 * 1000 // 30 seconds
const RETRY_DELAY_MS = 90 * 1000 // retry after 90 seconds on failure

let timer: NodeJS.Timeout | null = null
let running = false
let started = false

const isActivePhase = (phase: MatchWindowPhase): boolean =>
  phase === 'prewarm' || phase === 'live' || phase === 'post'

const scheduleNext = (logger: FastifyBaseLogger, delay: number) => {
  if (timer) {
    clearTimeout(timer)
  }

  timer = setTimeout(() => void tick(logger), Math.max(0, delay))
}

const tick = async (logger: FastifyBaseLogger) => {
  if (running) {
    logger.warn('cache warming scheduler: previous tick still running, skip overlap')
    return
  }

  running = true
  try {
    const window = await getMatchWindow()
    const aggressive = isActivePhase(window.phase) && window.seasonIds.length > 0

    const result = await maybePrewarmPublicLeagueCaches()

    logger.info(
      {
        phase: window.phase,
        aggressive,
        seasons: window.seasonIds,
        warmedSeasons: result.seasons,
      },
      'cache warming scheduler: tick complete'
    )

    scheduleNext(logger, aggressive ? AGGRESSIVE_INTERVAL_MS : BASE_INTERVAL_MS)
  } catch (err) {
    logger.error({ err }, 'cache warming scheduler: tick failed, scheduling retry')
    scheduleNext(logger, RETRY_DELAY_MS)
  } finally {
    running = false
  }
}

export const startCacheWarmingScheduler = async (logger: FastifyBaseLogger) => {
  if (started) {
    logger.warn('cache warming scheduler: start requested but already running')
    return
  }

  started = true
  logger.info(
    {
      baseIntervalMs: BASE_INTERVAL_MS,
      aggressiveIntervalMs: AGGRESSIVE_INTERVAL_MS,
      initialDelayMs: INITIAL_DELAY_MS,
    },
    'cache warming scheduler: starting'
  )

  scheduleNext(logger, INITIAL_DELAY_MS)
}

export const stopCacheWarmingScheduler = async (logger: FastifyBaseLogger) => {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  running = false
  if (started) {
    logger.info('cache warming scheduler: stopped')
  }
  started = false
}
