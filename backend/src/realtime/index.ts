import { FastifyInstance, FastifyRequest } from 'fastify'
import type { SocketStream } from '@fastify/websocket'
import type { RawData, WebSocket } from 'ws'
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

type TrackedWebSocket = WebSocket & { topics: Set<string>; isPublicOnly?: boolean }

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
  const queryToken =
    typeof request.query === 'object' && request.query !== null
      ? (request.query as Record<string, unknown>).token
      : undefined
  if (typeof queryToken === 'string' && queryToken.trim()) {
    return queryToken
  }
  const headerToken = request.headers['sec-websocket-protocol']
  if (typeof headerToken === 'string' && headerToken.trim()) {
    return headerToken
  }
  return undefined
}

const createRealtimePayload = (topic: string, payload: unknown) =>
  JSON.stringify({ type: 'patch', topic, payload })

export default async function registerRealtime(server: FastifyInstance) {
  const redisUrl = process.env.REDIS_URL
  const pub = redisUrl ? new Redis(redisUrl) : new Redis()
  const sub = redisUrl ? new Redis(redisUrl) : new Redis()

  // topic -> Set of sockets
  const topicMap = new Map<string, Set<TrackedWebSocket>>()

  // when redis message arrives, forward to sockets
  sub.on('message', (channel: string, message: string) => {
    const set = topicMap.get(channel)
    if (!set) return
    for (const ws of set) {
      try {
        const payload = JSON.parse(message) as unknown
        ws.send(createRealtimePayload(channel, payload))
      } catch (error) {
        console.warn('realtime: failed to deliver message to client', error)
      }
    }
  })

  // register websocket route
  // NOTE: plugin @fastify/websocket must be registered in server
  server.get('/realtime', { websocket: true }, (connection: SocketStream, req) => {
    // fastify-websocket will set connection.socket
    const socket = connection.socket as TrackedWebSocket
    // verify token against known secrets (admin, assistant, judge, public)
    const token = getAuthToken(req)
    const secretCandidates = [
      process.env.JWT_SECRET,
      process.env.ASSISTANT_JWT_SECRET,
      process.env.ADMIN_JWT_SECRET,
      process.env.JUDGE_JWT_SECRET,
      process.env.TELEGRAM_BOT_TOKEN,
      'dev-secret',
    ].filter(Boolean) as string[]

    let verified = false
    let publicOnly = false

    if (token) {
      const tokenStr = String(token)
      for (const secret of secretCandidates) {
        try {
          jwt.verify(tokenStr, secret)
          verified = true
          break
        } catch (err) {
          // try next secret
        }
      }
    } else {
      // отсутствует токен — разрешаем подключение только к публичным топикам
      verified = true
      publicOnly = true
    }

    if (!verified) {
      socket.close(4001, 'unauthorized')
      return
    }

    socket.topics = new Set<string>()
    socket.isPublicOnly = publicOnly

    socket.on('message', async (raw: RawData) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw.toString())
      } catch (error) {
        return
      }
      if (!isRealtimeCommand(parsed)) {
        return
      }
      const { action, topic } = parsed
      if (typeof topic !== 'string' || topic.length === 0) {
        return
      }
      const topicName = topic
      if (socket.isPublicOnly && !isPublicTopic(topicName)) {
        socket.send(JSON.stringify({ type: 'error', topic: topicName, error: 'forbidden' }))
        return
      }
      if (action === 'subscribe') {
        let set = topicMap.get(topicName)
        if (!set) {
          set = new Set()
          topicMap.set(topicName, set)
          await sub.subscribe(topicName)
        }
        set.add(socket)
        socket.topics.add(topicName)
        socket.send(JSON.stringify({ type: 'subscribed', topic: topicName }))
      } else if (action === 'unsubscribe') {
        const set = topicMap.get(topicName)
        if (set) {
          set.delete(socket)
          socket.topics.delete(topicName)
          if (set.size === 0) {
            topicMap.delete(topicName)
            await sub.unsubscribe(topicName)
          }
        }
        socket.send(JSON.stringify({ type: 'unsubscribed', topic: topicName }))
      }
    })

    socket.on('close', async () => {
      for (const topicName of socket.topics) {
        const set = topicMap.get(topicName)
        if (!set) continue
        set.delete(socket)
        if (set.size === 0) {
          topicMap.delete(topicName)
          await sub.unsubscribe(topicName)
        }
      }
    })
  })

  // helper to publish patches from server-side code
  server.decorate('publishTopic', async (topic: string, payload: unknown) =>
    pub.publish(topic, JSON.stringify(payload))
  )
}
