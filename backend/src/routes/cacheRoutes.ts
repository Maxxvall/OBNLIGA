import { FastifyInstance } from 'fastify'
import { defaultCache as cache } from '../cache'
import { maybePrewarmPublicLeagueCaches } from '../services/cachePrewarm'

const PREWARM_TOKEN = process.env.CACHE_PREWARM_TOKEN ?? process.env.PREWARM_TOKEN ?? null

export default async function (server: FastifyInstance) {
  server.get<{ Params: { key: string } }>('/api/cache/:key', async (request, reply) => {
    const { key } = request.params
    const value = await cache.get(
      key,
      async () => {
        // demo loader — in real app replace with DB fetch
        return { at: new Date().toISOString(), key }
      },
      30
    )
    return reply.send(value)
  })

  server.post<{ Params: { key: string } }>(
    '/api/cache/invalidate/:key',
    async (request, reply) => {
      const { key } = request.params
    await cache.invalidate(key)
    return reply.send({ ok: true })
    }
  )

  server.post('/api/cache/prewarm', async (request, reply) => {
    if (PREWARM_TOKEN) {
      const headerTokenRaw = request.headers['x-prewarm-token']
      const headerToken = Array.isArray(headerTokenRaw) ? headerTokenRaw[0] : headerTokenRaw
      if (!headerToken || headerToken !== PREWARM_TOKEN) {
        return reply.status(401).send({ ok: false, error: 'unauthorized' })
      }
    }

    const result = await maybePrewarmPublicLeagueCaches()
    return reply.send({ ok: true, ...result })
  })
}
