import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import compress from '@fastify/compress'

const server = Fastify({ logger: true })

// validate required env in production: fail fast if critical secrets are missing
const validateRequiredEnv = (required: string[]) => {
  const missing = required.filter(k => !process.env[k])
  if (missing.length) {
    server.log.error({ missing }, 'Missing required environment variables')
    // In production we should fail fast. In development just warn.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
    }
  }
}

// Register CORS to allow frontend requests from different origin
server.register(cors, {
  origin: true, // Allow all origins in development, configure specifically for production
  credentials: true,
  exposedHeaders: ['ETag', 'X-Resource-Version', 'Cache-Control'],
})

server.register(compress, {
  global: true,
  encodings: ['gzip', 'br'],
})

server.get('/health', async () => {
  // TODO: extend health checks (DB, Redis, queues) in Phase 9
  return { status: 'ok' }
})

// Root route: redirect to WEBAPP_URL when available, otherwise return a small JSON.
server.get('/', async (request, reply) => {
  const webapp = process.env.WEBAPP_URL
  if (webapp) {
    return reply.redirect(webapp)
  }
  return reply.send({ message: 'Obnliga backend', health: '/health', api: ['/api/cache/:key'] })
})

// start Telegram bot if available
import { startBot } from './bot'
startBot().catch(e => {
  server.log.warn({ err: e }, 'bot start failed')
})

// register cache routes (demo)
import cacheRoutes from './routes/cacheRoutes'
server.register(cacheRoutes)

// register user routes
import userRoutes from './routes/userRoutes'
server.register(userRoutes)

// register user card extra routes
import userCardRoutes from './routes/userCardRoutes'
server.register(userCardRoutes)

// register auth routes (telegram initData verifier)
import authRoutes from './routes/authRoutes'
server.register(authRoutes)

// register admin routes (RBAC / dashboard)
import adminRoutes from './routes/adminRoutes'
import adminShopRoutes from './routes/adminShopRoutes'
server.register(adminRoutes)
server.register(adminShopRoutes)

// register lineup portal routes (captain portal)
import lineupRoutes from './routes/lineupRoutes'
server.register(lineupRoutes)

// register judge portal routes
import judgeRoutes from './routes/judgeRoutes'
server.register(judgeRoutes)

// register assistant match control routes
import assistantRoutes from './routes/assistantRoutes'
server.register(assistantRoutes)

// register public bracket routes
import bracketRoutes from './routes/bracketRoutes'
server.register(bracketRoutes)

// register public news routes
import newsRoutes from './routes/newsRoutes'
import adsRoutes from './routes/adsRoutes'
import leagueRoutes from './routes/leagueRoutes'
import clubRoutes from './routes/clubRoutes'
import matchPublicRoutes from './routes/matchPublicRoutes'
import predictionRoutes from './routes/predictionRoutes'
import expressRoutes from './routes/expressRoutes'
import ratingsRoutes from './routes/ratingsRoutes'
import shopRoutes from './routes/shopRoutes'
import subscriptionRoutes from './routes/subscriptionRoutes'
import cronRoutes from './routes/cronRoutes'
import broadcastRoutes from './routes/broadcastRoutes'
server.register(newsRoutes)
server.register(adsRoutes)
server.register(leagueRoutes)
server.register(clubRoutes)
server.register(matchPublicRoutes)
server.register(predictionRoutes)
server.register(expressRoutes)
server.register(ratingsRoutes)
server.register(shopRoutes)
server.register(subscriptionRoutes)
server.register(cronRoutes)
server.register(broadcastRoutes)
// Duplicate registrations removed: `ratingsRoutes` and `shopRoutes`
// were registered above already. Keeping single registration to avoid
// Fastify "Method 'GET' already declared" errors.

// register fastify websocket & cookie plugins and realtime
// websocket & cookie plugins and realtime will be registered in start() to avoid top-level await
import websocketPlugin from '@fastify/websocket'
import cookiePlugin from '@fastify/cookie'
import registerRealtime from './realtime'

// register ETag plugin (Phase 2 requirement)
import etagPlugin from './plugins/etag'
server.register(etagPlugin)

// news worker supervisor (BullMQ)
import { startNewsWorkerSupervisor, shutdownNewsWorker } from './queue/newsWorker'
import { startRatingScheduler, stopRatingScheduler } from './services/ratingScheduler'
import { startCacheWarmingScheduler, stopCacheWarmingScheduler } from './services/cacheWarmingScheduler'

server.addHook('onClose', async () => {
  await Promise.all([
    shutdownNewsWorker(server.log),
    stopRatingScheduler(server.log),
    stopCacheWarmingScheduler(server.log),
  ])
})

const start = async () => {
  try {
    // Required in most deployments: set ADMIN creds and JWT secret explicitly
    validateRequiredEnv(['JWT_SECRET', 'LOGIN_ADMIN', 'PASSWORD_ADMIN'])
    // register cookie & websocket plugins and realtime module
    await server.register(cookiePlugin)
    await server.register(websocketPlugin)
    await registerRealtime(server)
    await startNewsWorkerSupervisor(server.log)
    await startRatingScheduler(server.log)
    await startCacheWarmingScheduler(server.log)
    await server.listen({ port: 3000, host: '0.0.0.0' })
    server.log.info('Server listening on 0.0.0.0:3000')
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

start()
