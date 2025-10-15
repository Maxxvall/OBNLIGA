import type { IncomingHttpHeaders } from 'http'

const WEAK_PREFIX = 'W/'

/**
 * Создаёт weak ETag на основании уникального ключа ресурса и версии.
 * Weak-формат позволяет безопасно сравнивать payload без строгой byte-by-byte идентичности,
 * что подходит для JSON-ответов, собираемых из сериализованных объектов.
 */
export const buildWeakEtag = (resourceKey: string, version: number): string => {
  const normalizedKey = resourceKey.trim().replace(/"/g, '')
  return `${WEAK_PREFIX}"${normalizedKey}:${version}"`
}

const splitHeaderValues = (value: string | string[]): string[] => {
  if (Array.isArray(value)) {
    return value
  }
  return value.split(',')
}

const normalizeToken = (token: string): string => token.trim()

const stripWeakValidator = (value: string): string =>
  value.startsWith(WEAK_PREFIX) ? value.slice(WEAK_PREFIX.length) : value

const stripQuotes = (value: string): string => value.replace(/^"+|"+$/g, '')

/**
 * Проверяет, соответствует ли один из значений заголовка If-None-Match указанному ETag.
 * Поддерживаются как weak, так и strong варианты, а также wildcard `*`.
 */
export const matchesIfNoneMatch = (
  headers: IncomingHttpHeaders,
  etag: string
): boolean => {
  const raw = headers['if-none-match']
  if (!raw) {
    return false
  }

  const candidates = splitHeaderValues(raw)
  const etagNormalized = normalizeToken(etag)
  const etagWithoutWeak = stripWeakValidator(etagNormalized)
  const etagCanonical = stripQuotes(etagWithoutWeak)

  for (const candidateRaw of candidates) {
    const candidate = normalizeToken(candidateRaw)
    if (!candidate) {
      continue
    }
    if (candidate === '*') {
      return true
    }

    const candidateWithoutWeak = stripWeakValidator(candidate)
    const candidateCanonical = stripQuotes(candidateWithoutWeak)

    if (
      candidate === etagNormalized ||
      candidate === etagWithoutWeak ||
      candidate === etagCanonical ||
      candidateWithoutWeak === etagNormalized ||
      candidateWithoutWeak === etagWithoutWeak ||
      candidateWithoutWeak === etagCanonical ||
      candidateCanonical === etagCanonical
    ) {
      return true
    }
  }
  return false
}
