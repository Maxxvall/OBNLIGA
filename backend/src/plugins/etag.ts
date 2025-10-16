import { FastifyPluginAsync } from 'fastify'
import crypto from 'crypto'
import { matchesIfNoneMatch } from '../utils/httpCaching'

const etagPlugin: FastifyPluginAsync = async fastify => {
  // Compute ETag for successful GET responses and honor If-None-Match
  fastify.addHook('onSend', async (request, reply, payload) => {
    try {
      if (request.method !== 'GET') {
        return payload
      }

      if (reply.statusCode === 304) {
        return payload
      }

      const existingEtagHeader = reply.getHeader('etag')
      if (existingEtagHeader) {
        if (reply.statusCode === 200) {
          const etagValue = Array.isArray(existingEtagHeader)
            ? String(existingEtagHeader[0])
            : String(existingEtagHeader)

          if (matchesIfNoneMatch(request.headers, etagValue)) {
            reply.code(304)
            return ''
          }
        }
        return payload
      }

      if (reply.statusCode !== 200) {
        return payload
      }

      // payload can be string or Buffer or object; normalize to string
      const bodyStr =
        typeof payload === 'string'
          ? payload
          : Buffer.isBuffer(payload)
            ? payload.toString('utf8')
            : typeof payload === 'object' && payload !== null
              ? JSON.stringify(payload)
              : String(payload)

      const hash = crypto.createHash('sha1').update(bodyStr).digest('hex')
      const etag = `W/"${hash}"`

      if (matchesIfNoneMatch(request.headers, etag)) {
        reply.code(304)
        reply.header('ETag', etag)
        return ''
      }

      reply.header('ETag', etag)
      return payload
    } catch (e) {
      // On any error, don't break response flow
      return payload
    }
  })
}

export default etagPlugin
