import { FastifyInstance } from 'fastify'
import prisma from '../db'
import { defaultCache } from '../cache'
import { buildWeakEtag, matchesIfNoneMatch } from '../utils/httpCaching'

const ADS_CACHE_KEY = 'ads:all'
const ADS_CACHE_TTL_SECONDS = 600
const RESPONSE_MAX_AGE_SECONDS = 60
const RESPONSE_STALE_WHILE_REVALIDATE_SECONDS = 600

interface AdBannerRow {
  id: bigint
  title: string
  subtitle: string | null
  targetUrl: string | null
  imageData: Buffer
  imageMime: string
  imageWidth: number
  imageHeight: number
  imageSize: number
  displayOrder: number
}

const normalizeAd = (row: AdBannerRow) => {
  const base64 = Buffer.isBuffer(row.imageData) ? row.imageData.toString('base64') : ''
  const trimmedUrl = row.targetUrl ? row.targetUrl.trim() : null
  return {
    id: row.id.toString(),
    title: row.title,
    subtitle: row.subtitle,
    targetUrl: trimmedUrl && trimmedUrl.length > 0 ? trimmedUrl : null,
    image: {
      mimeType: row.imageMime,
      base64,
      width: row.imageWidth,
      height: row.imageHeight,
      size: row.imageSize,
    },
    displayOrder: row.displayOrder,
  }
}

const loadAds = async () => {
  const now = new Date()
  const rows = await prisma.$queryRaw<AdBannerRow[]>`
    SELECT
      ad_banner_id          AS id,
      title,
      subtitle,
      target_url            AS "targetUrl",
      image_data            AS "imageData",
      image_mime            AS "imageMime",
      image_width           AS "imageWidth",
      image_height          AS "imageHeight",
      image_size            AS "imageSize",
      display_order         AS "displayOrder"
    FROM ad_banner
    WHERE is_active = TRUE
      AND (starts_at IS NULL OR starts_at <= ${now})
      AND (ends_at IS NULL OR ends_at >= ${now})
    ORDER BY display_order ASC, updated_at DESC, ad_banner_id DESC
  `
  return rows.map(normalizeAd)
}

export default async function adsRoutes(server: FastifyInstance) {
  server.get('/api/ads', async (request, reply) => {
    const { value, version } = await defaultCache.getWithMeta(
      ADS_CACHE_KEY,
      loadAds,
      ADS_CACHE_TTL_SECONDS
    )

    const etag = buildWeakEtag(ADS_CACHE_KEY, version)

    if (matchesIfNoneMatch(request.headers, etag)) {
      return reply
        .status(304)
        .header('ETag', etag)
        .header('X-Resource-Version', String(version))
        .send()
    }

    reply.header(
      'Cache-Control',
      `public, max-age=${RESPONSE_MAX_AGE_SECONDS}, stale-while-revalidate=${RESPONSE_STALE_WHILE_REVALIDATE_SECONDS}`
    )
    reply.header('ETag', etag)
    reply.header('X-Resource-Version', String(version))

    return reply.send({ ok: true, data: value, meta: { version } })
  })
}
