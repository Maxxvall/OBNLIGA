import { FastifyInstance } from 'fastify'
import prisma from '../db'
import { defaultCache } from '../cache'
import { serializePrisma } from '../utils/serialization'

const NEWS_CACHE_KEY = 'news:all'
const NEWS_CACHE_TTL_SECONDS = 30 // seconds
const RESPONSE_MAX_AGE_SECONDS = 15 // seconds
const RESPONSE_STALE_WHILE_REVALIDATE_SECONDS = 45 // seconds

type NewsView = {
  id: string
  title: string
  content: string
  coverUrl?: string | null
  sendToTelegram: boolean
  createdAt: string
}

const loadNews = async (): Promise<NewsView[]> => {
  const rows = await prisma.news.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      content: true,
      coverUrl: true,
      sendToTelegram: true,
      createdAt: true,
    },
  })
  return serializePrisma(rows) as NewsView[]
}

const buildEtag = (version: number) => `W/"news-${version}"`

export default async function newsRoutes(server: FastifyInstance) {
  server.get('/api/news', async (request, reply) => {
    const { value, version } = await defaultCache.getWithMeta(
      NEWS_CACHE_KEY,
      loadNews,
      NEWS_CACHE_TTL_SECONDS
    )
    const etag = buildEtag(version)
    const ifNoneMatch = request.headers['if-none-match']

    if (ifNoneMatch && ifNoneMatch === etag) {
      return reply.status(304).send()
    }

    reply.header(
      'Cache-Control',
      `public, max-age=${RESPONSE_MAX_AGE_SECONDS}, stale-while-revalidate=${RESPONSE_STALE_WHILE_REVALIDATE_SECONDS}, must-revalidate`
    )
    reply.header('ETag', etag)
    reply.header('X-Resource-Version', String(version))

    return reply.send({ ok: true, data: value, meta: { version } })
  })
}
