import { FastifyReply, FastifyRequest } from 'fastify'
import jwt from 'jsonwebtoken'

export const getJwtSecret = () =>
  process.env.JWT_SECRET || process.env.TELEGRAM_BOT_TOKEN || 'admin-dev-secret'

export const adminAuthHook = async (request: FastifyRequest, reply: FastifyReply) => {
  const authHeader = request.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ ok: false, error: 'unauthorized' })
  }

  const token = authHeader.slice('Bearer '.length)
  try {
    const payload = jwt.verify(token, getJwtSecret()) as { sub: string; role?: string }
    if (!payload.role || payload.role !== 'admin') {
      return reply.status(403).send({ ok: false, error: 'forbidden' })
    }
    request.admin = { sub: payload.sub, role: payload.role }
  } catch (err) {
    return reply.status(401).send({ ok: false, error: 'invalid_token' })
  }
}
