import { FastifyPluginAsync } from 'fastify'
import crypto from 'crypto'

const etagPlugin: FastifyPluginAsync = async fastify => {
  // Compute ETag for successful GET responses and honor If-None-Match
  fastify.addHook('onSend', async (request, reply, payload) => {
    try {
      if (request.method !== 'GET' || reply.statusCode !== 200) return payload

      // payload can be string or Buffer or object; normalize to string
      const bodyStr =
        typeof payload === 'string'
          ? payload
          : Buffer.isBuffer(payload)
            ? payload.toString('utf8')
            : JSON.stringify(payload)

      const etag = crypto.createHash('sha1').update(bodyStr).digest('hex')
      const ifNoneMatch = request.headers['if-none-match']

      // If matches, return 304 with ETag header and empty body
      if (ifNoneMatch && ifNoneMatch === etag) {
        reply.code(304)
        reply.header('ETag', etag)
        return ''
      }

      // Otherwise set ETag and continue
      reply.header('ETag', etag)
      return payload
    } catch (e) {
      // On any error, don't break response flow
      return payload
    }
  })
}

export default etagPlugin
