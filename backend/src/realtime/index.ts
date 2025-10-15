import { FastifyInstance, FastifyRequest } from 'fastify'
import type { SocketStream } from '@fastify/websocket'
import WebSocket, { RawData } from 'ws'
import Redis from 'ioredis'
import jwt from 'jsonwebtoken'

declare module 'fastify' {
  interface FastifyInstance {
    publishTopic(topic: string, payload: unknown): Promise<number>
  }
}

type RealtimeCommandAction = 'subscribe' | 'unsubscribe'

type RealtimeCommand = {
  action?: RealtimeCommandAction
  topic?: string
}

const HANDSHAKE_TIMEOUT_MS = 5_000
const SERVER_PING_INTERVAL_MS = 30_000
const REDIS_READY_TIMEOUT_MS = 10_000

type TrackedWebSocket = WebSocket & {
  topics: Set<string>
  isAlive?: boolean
}

const isPublicTopic = (topic: string): boolean => topic.startsWith('public:')

const isRealtimeCommand = (value: unknown): value is RealtimeCommand => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<Record<keyof RealtimeCommand, unknown>>
  const { action, topic } = candidate
  const actionValid =
    action === undefined || action === 'subscribe' || action === 'unsubscribe'
  return actionValid && (topic === undefined || typeof topic === 'string')
}

const getAuthToken = (request: FastifyRequest): string | undefined => {
  try {
    const rawUrl = (request.raw && (request.raw.url as string)) || request.url || '/'
    const host = request.headers.host || 'localhost'
    const fullUrl = new URL(rawUrl, `http://${host}`)
    const queryToken = fullUrl.searchParams.get('token')
    if (queryToken && queryToken.trim()) {
      return queryToken.trim()
    }
  } catch (err) {
    request.log.warn({ err }, 'realtime: failed to parse url for token')
  }

  const authCookie = (request as { cookies?: Record<string, string> }).cookies?.auth_token
  if (authCookie && authCookie.trim()) {
    return authCookie.trim()
  }

  const authHeader = request.headers.authorization
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice('Bearer '.length).trim()
    if (bearer) {
      return bearer
    }
  }

  const protocolHeader = request.headers['sec-websocket-protocol']
  if (typeof protocolHeader === 'string' && protocolHeader.trim()) {
    return protocolHeader.trim()
  }

  return undefined
}

const createRealtimePayload = (topic: string, payload: unknown) =>
  JSON.stringify({ type: 'patch', topic, payload })

export default async function registerRealtime(server: FastifyInstance) {
  const redisUrl = process.env.REDIS_URL
  const pub = redisUrl ? new Redis(redisUrl) : new Redis()
  const sub = redisUrl ? new Redis(redisUrl) : new Redis()

  const ensureRedisReady = (client: Redis, name: string): Promise<void> => {
    if (client.status === 'ready') {
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
      const onReady = () => {
        clearTimeout(timeout)
        client.off('error', onError)
        resolve()
      }

      const onError = (err: Error) => {
        clearTimeout(timeout)
        client.off('ready', onReady)
        reject(err)
      }

      const timeout = setTimeout(() => {
        client.off('ready', onReady)
        client.off('error', onError)
        reject(new Error(`${name} redis ready timeout`))
      }, REDIS_READY_TIMEOUT_MS)

      client.once('ready', onReady)
      client.once('error', onError)
    })
  }

  try {
    await Promise.all([
      ensureRedisReady(pub, 'pub'),
      ensureRedisReady(sub, 'sub'),
    ])
  } catch (err) {
    server.log.error({ err }, 'realtime: redis ready failed, continuing in degraded mode')
  }

  // topic -> Set of sockets
  const topicMap = new Map<string, Set<TrackedWebSocket>>()

  pub.on('error', (err: Error) => {
    server.log.error({ err }, 'realtime: redis pub error')
  })

  sub.on('error', (err: Error) => {
    server.log.error({ err }, 'realtime: redis sub error')
  })

  // when redis message arrives, forward to sockets
  sub.on('message', (channel: string, message: string) => {
    const set = topicMap.get(channel)
    if (!set) return
    for (const ws of [...set]) {
      if (ws.readyState !== WebSocket.OPEN) {
        set.delete(ws)
        continue
      }
      try {
        const payload = JSON.parse(message) as unknown
        ws.send(createRealtimePayload(channel, payload))
      } catch (error) {
        server.log.warn({ error, channel }, 'realtime: failed to deliver message to client')
        set.delete(ws)
        try {
          ws.terminate()
        } catch (terminateError) {
          server.log.warn({ terminateError }, 'realtime: failed to terminate dead socket')
        }
      }
    }
    if (set.size === 0) {
      topicMap.delete(channel)
      void sub.unsubscribe(channel).catch((err) => {
        server.log.warn({ err, channel }, 'realtime: failed to cleanup redis subscription')
      })
    }
  })

  // register websocket route
  // NOTE: plugin @fastify/websocket must be registered in server
  server.get('/realtime', { websocket: true }, (connection: SocketStream, req) => {
    const socket = connection.socket as TrackedWebSocket
    req.log.info('realtime: connection attempt')

    const token = getAuthToken(req)
    req.log.info({ tokenPresent: Boolean(token) }, 'realtime: token parsed')
    const secretCandidates = [
      process.env.JWT_SECRET,
      process.env.ASSISTANT_JWT_SECRET,
      process.env.ADMIN_JWT_SECRET,
      process.env.JUDGE_JWT_SECRET,
      process.env.TELEGRAM_BOT_TOKEN,
      'dev-secret',
    ].filter(Boolean) as string[]

    let verified = false

    if (token) {
      const tokenStr = String(token)
      secretCandidates.some((secret, index) => {
        try {
          jwt.verify(tokenStr, secret)
          verified = true
          req.log.info({ candidateIndex: index }, 'realtime: token verified')
          return true
        } catch (err) {
          return false
        }
      })
    }

    if (!verified) {
      req.log.warn('realtime: unauthorized connection rejected')
      socket.close(4001, 'unauthorized')
      return
    }

    socket.topics = new Set<string>()
    socket.isAlive = true

    const heartbeat = () => {
      socket.isAlive = true
    }
    socket.on('pong', heartbeat)

    const pingInterval = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) {
        clearInterval(pingInterval)
        return
      }
      if (!socket.isAlive) {
        req.log.warn('realtime: heartbeat missed, terminating socket')
        clearInterval(pingInterval)
        socket.terminate()
        return
      }
      socket.isAlive = false
      try {
        socket.ping()
      } catch (err) {
        req.log.warn({ err }, 'realtime: ping failed, terminating socket')
        clearInterval(pingInterval)
        socket.terminate()
      }
    }, SERVER_PING_INTERVAL_MS)

    let handshakeSettled = false
    const handshakeTimer = setTimeout(() => {
      req.log.warn('realtime: handshake timeout, closing socket')
      socket.close(4000, 'handshake timeout')
    }, HANDSHAKE_TIMEOUT_MS)

    const completeHandshake = () => {
      if (handshakeSettled) {
        return
      }
      handshakeSettled = true
      clearTimeout(handshakeTimer)
      try {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ready' }))
        }
        req.log.info('realtime: handshake completed')
      } catch (err) {
        req.log.warn({ err }, 'realtime: failed to send handshake ack, terminating socket')
        socket.terminate()
      }
    }

    socket.on('message', (raw: RawData) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw.toString())
      } catch (error) {
        req.log.warn({ error }, 'realtime: failed to parse client message')
        return
      }
      if (!isRealtimeCommand(parsed)) {
        req.log.warn({ parsed }, 'realtime: unsupported command')
        return
      }
      const { action, topic } = parsed
      if (typeof topic !== 'string' || topic.length === 0) {
        req.log.warn('realtime: missing topic in command')
        return
      }
      const topicName = topic
      if (isPublicTopic(topicName)) {
        req.log.warn({ topic: topicName }, 'realtime: public topics are disabled')
        socket.send(JSON.stringify({ type: 'error', topic: topicName, error: 'forbidden' }))
        return
      }
      if (action === 'subscribe') {
        req.log.info({ topic: topicName }, 'realtime: subscribe request')
        let set = topicMap.get(topicName)
        if (!set) {
          set = new Set()
          topicMap.set(topicName, set)
          req.log.info({ topic: topicName }, 'realtime: subscribe start')
          void sub.subscribe(topicName).catch((err) => {
            server.log.error({ err, topic: topicName }, 'realtime: redis subscribe failed')
          })
        }
        set.add(socket)
        socket.topics.add(topicName)
        socket.send(JSON.stringify({ type: 'subscribed', topic: topicName }))
        req.log.info({ topic: topicName, subscribers: set.size }, 'realtime: subscribe success')
      } else if (action === 'unsubscribe') {
        req.log.info({ topic: topicName }, 'realtime: unsubscribe request')
        const set = topicMap.get(topicName)
        if (set) {
          set.delete(socket)
          socket.topics.delete(topicName)
          if (set.size === 0) {
            topicMap.delete(topicName)
            req.log.info({ topic: topicName }, 'realtime: unsubscribe start')
            void sub.unsubscribe(topicName).catch((err) => {
              server.log.error({ err, topic: topicName }, 'realtime: redis unsubscribe failed')
            })
          }
        }
        socket.send(JSON.stringify({ type: 'unsubscribed', topic: topicName }))
      }
    })

    setTimeout(completeHandshake, 100)

    socket.on('error', (err: Error) => {
      req.log.error({ err }, 'realtime: socket error')
    })

    socket.on('close', (code: number, reasonRaw?: Buffer | string) => {
      clearInterval(pingInterval)
      clearTimeout(handshakeTimer)
      socket.isAlive = false
      const reason =
        reasonRaw === undefined
          ? 'no-reason'
          : Buffer.isBuffer(reasonRaw)
          ? reasonRaw.toString()
          : String(reasonRaw)
      req.log.info({ code, reason }, 'realtime: socket closed')
      for (const topicName of socket.topics) {
        const set = topicMap.get(topicName)
        if (!set) continue
        set.delete(socket)
        if (set.size === 0) {
          topicMap.delete(topicName)
          void sub.unsubscribe(topicName).catch((err) => {
            server.log.error({ err, topic: topicName }, 'realtime: redis unsubscribe failed during close')
          })
        }
      }
    })
  })

  server.addHook('onClose', async (instance) => {
    try {
      pub.disconnect()
    } catch (err) {
      instance.log.error({ err }, 'realtime: failed to disconnect redis pub')
    }
    try {
      sub.disconnect()
    } catch (err) {
      instance.log.error({ err }, 'realtime: failed to disconnect redis sub')
    }
  })

  // helper to publish patches from server-side code
  server.decorate('publishTopic', async (topic: string, payload: unknown) =>
    pub.publish(topic, JSON.stringify(payload))
  )
}
