import { FastifyRequest } from 'fastify'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || process.env.TELEGRAM_BOT_TOKEN || 'dev-secret'

type RequestWithSessionCookie = FastifyRequest & {
  cookies?: Record<string, string>
}

export const extractSessionToken = (request: FastifyRequest): string | null => {
  const authHeader = request.headers.authorization
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const tokenCandidate = authHeader.slice(7).trim()
    if (tokenCandidate) {
      return tokenCandidate
    }
  }

  const cookieToken = (request as RequestWithSessionCookie).cookies?.session
  if (typeof cookieToken === 'string' && cookieToken.trim()) {
    return cookieToken.trim()
  }

  return null
}

export const resolveSessionSubject = (token: string): string | null => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    if (typeof decoded === 'string' && decoded.trim()) {
      return decoded.trim()
    }
    if (typeof decoded === 'object' && decoded && typeof decoded.sub === 'string' && decoded.sub.trim()) {
      return decoded.sub.trim()
    }
    return null
  } catch (err) {
    return null
  }
}
