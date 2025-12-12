import QuickLRU from 'quick-lru'
import Redis from 'ioredis'
import dotenv from 'dotenv'
import { createHash, randomBytes } from 'crypto'
import { gzipSync, gunzipSync } from 'zlib'

dotenv.config({ path: `${__dirname}/../../.env` })

type Loader<T> = () => Promise<T>

export type CacheFetchOptions = {
  ttlSeconds?: number
  staleWhileRevalidateSeconds?: number
  lockTimeoutSeconds?: number
}

type CacheFetchOptionsResolver<T> = (value: T) => number | CacheFetchOptions
type CacheFetchOptionsInput<T> = number | CacheFetchOptions | CacheFetchOptionsResolver<T>
type NormalizedOptionsResolver<T> = (value: T) => NormalizedOptions

type NormalizedOptions = {
  ttlMs: number | null
  staleMs: number | null
  lockMs: number
}

type CacheEnvelope<T> = {
  value: T
  fingerprint: string
  expiresAt: number
  staleUntil: number
  version: number
}

const DEFAULT_LOCK_SECONDS = 12
const DEFAULT_STALE_MULTIPLIER = 2
const LOCK_POLL_INTERVAL_MS = 75
const LOCK_KEY_PREFIX = '__lock:'
const VERSION_KEY_PREFIX = '__v:'
const REDIS_RELEASE_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end'

const versionTtlCandidate = Number(process.env.CACHE_VERSION_TTL_SECONDS ?? 24 * 60 * 60)
const VERSION_TTL_SECONDS = Number.isFinite(versionTtlCandidate) ? versionTtlCandidate : 24 * 60 * 60
const REDIS_GZIP_ENABLED = process.env.CACHE_REDIS_GZIP === '1' || process.env.CACHE_REDIS_GZIP === 'true'
const REDIS_GZIP_MIN_BYTES = Number(process.env.CACHE_REDIS_GZIP_MIN_BYTES ?? 2048)
const REDIS_GZIP_PREFIX = 'gz:'

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const nowMs = () => Date.now()

export class MultiLevelCache {
  private lru: QuickLRU<string, CacheEnvelope<unknown>>
  private redis: Redis | null
  private versions: Map<string, number>
  private localLocks: Map<string, number>

  private metrics = {
    lruHits: 0,
    lruMisses: 0,
    redisHits: 0,
    redisMisses: 0,
    loaderCalls: 0,
    versionPeekHits: 0,
    versionPeekMisses: 0,
    etag304Early: 0,
  }

  constructor(redisUrl?: string, lruOptions = { maxSize: 1000 }) {
    this.lru = new QuickLRU<string, CacheEnvelope<unknown>>(lruOptions)
    this.versions = new Map<string, number>()
    this.localLocks = new Map<string, number>()
    this.redis = redisUrl ? new Redis(redisUrl) : null
  }

  async get<T>(
    key: string,
    loader: Loader<T>,
    options?: CacheFetchOptionsInput<T>
  ): Promise<T> {
    const { base, resolver } = this.normalizeOptionsInput<T>(options)
    const reference = nowMs()

    const memoryEnvelope = this.getEnvelopeFromMemory<T>(key)
    if (memoryEnvelope) {
      this.metrics.lruHits += 1
      const remoteVersion = await this.ensureVersion(key)
      if (this.redis && remoteVersion > memoryEnvelope.version) {
        const refreshed = await this.readEnvelopeFromRedis<T>(key)
        if (refreshed) {
          this.saveEnvelopeToMemory(key, refreshed)
          if (!this.isExpired(refreshed, reference)) {
            return refreshed.value
          }
          return this.handleExpiredEnvelope(key, loader, refreshed, base, reference, resolver)
        }
        return this.buildFresh(key, loader, base, memoryEnvelope, resolver)
      }

      if (!this.isExpired(memoryEnvelope, reference)) {
        return memoryEnvelope.value as T
      }

      return this.handleExpiredEnvelope(key, loader, memoryEnvelope, base, reference, resolver)
    }

    this.metrics.lruMisses += 1

    const redisEnvelope = await this.readEnvelopeFromRedis<T>(key)
    if (redisEnvelope) {
      this.metrics.redisHits += 1
      this.saveEnvelopeToMemory(key, redisEnvelope)
      if (!this.isExpired(redisEnvelope, reference)) {
        return redisEnvelope.value
      }
      return this.handleExpiredEnvelope(key, loader, redisEnvelope, base, reference, resolver)
    }

    this.metrics.redisMisses += 1

    return this.buildFresh(key, loader, base, undefined, resolver)
  }

  async set<T>(key: string, value: T, options?: number | CacheFetchOptions) {
    const normalized = this.normalizeOptions(options)
    const previousFingerprint = this.getEnvelopeFromMemory<T>(key)?.fingerprint
    await this.storeEnvelope(key, value, normalized, previousFingerprint)
  }

  async invalidate(key: string) {
    this.lru.delete(key)
    this.localLocks.delete(this.lockKey(key))
    let nextVersion = (this.versions.get(key) ?? 0) + 1
    if (this.redis) {
      try {
        const versionKey = this.versionKey(key)
        const pipeline = this.redis.multi().del(key).incr(versionKey)
        if (VERSION_TTL_SECONDS > 0) {
          pipeline.expire(versionKey, VERSION_TTL_SECONDS)
        }

        const results = await pipeline.exec()
        const incrResult = results?.[1]?.[1]
        if (typeof incrResult === 'number') {
          nextVersion = incrResult
        } else if (typeof incrResult === 'string') {
          const parsed = Number(incrResult)
          if (!Number.isNaN(parsed)) {
            nextVersion = parsed
          }
        }
      } catch (err) {
        // ignore redis errors on invalidate
      }
    }
    this.versions.set(key, nextVersion)
  }

  /**
   * Инвалидация всех ключей с заданным префиксом.
   * Удаляет из LRU-кэша и Redis все ключи, начинающиеся с prefix.
   */
  async invalidatePrefix(prefix: string) {
    // Удаляем из LRU-кэша
    for (const key of this.lru.keys()) {
      if (key.startsWith(prefix)) {
        this.lru.delete(key)
        this.localLocks.delete(this.lockKey(key))
        const nextVersion = (this.versions.get(key) ?? 0) + 1
        this.versions.set(key, nextVersion)
      }
    }

    // Удаляем из Redis (если доступен)
    if (this.redis) {
      try {
        let cursor = '0'
        const keys: string[] = []
        do {
          const [nextCursor, batch] = await this.redis.scan(
            cursor,
            'MATCH',
            `${prefix}*`,
            'COUNT',
            100
          )
          cursor = nextCursor
          if (Array.isArray(batch) && batch.length > 0) {
            keys.push(...batch)
          }
        } while (cursor !== '0')

        if (keys.length > 0) {
          await this.redis.del(...keys)
          // Инкрементируем версии для всех найденных ключей
          const pipeline = this.redis.pipeline()
          for (const key of keys) {
            const versionKey = this.versionKey(key)
            pipeline.incr(versionKey)
            if (VERSION_TTL_SECONDS > 0) {
              pipeline.expire(versionKey, VERSION_TTL_SECONDS)
            }
          }
          await pipeline.exec()
        }
      } catch (err) {
        // ignore redis errors on invalidate
      }
    }
  }

  /**
   * Быстрая версия ключа без побочных эффектов.
   * Не вызывает loader/БД и не создаёт версию в Redis, если её нет.
   * Возвращает null, если версия неизвестна.
   */
  async peekVersion(key: string): Promise<number | null> {
    if (this.versions.has(key)) {
      this.metrics.versionPeekHits += 1
      return this.versions.get(key) as number
    }

    if (!this.redis) {
      this.metrics.versionPeekMisses += 1
      return null
    }

    try {
      const versionKey = this.versionKey(key)
      const raw = await this.redis.get(versionKey)
      if (raw == null) {
        this.metrics.versionPeekMisses += 1
        return null
      }
      const parsed = Number(raw)
      const version = Number.isFinite(parsed) ? parsed : 0
      this.versions.set(key, version)
      this.metrics.versionPeekHits += 1
      return version
    } catch {
      this.metrics.versionPeekMisses += 1
      return null
    }
  }

  /**
   * Увеличивает метрику ранних 304 ответов (ETag совпал по версии).
   * Вызывается из роутов, чтобы не смешивать HTTP-логику с кэшем.
   */
  markEarlyEtag304() {
    this.metrics.etag304Early += 1
  }

  getMetrics() {
    return { ...this.metrics }
  }

  async getWithMeta<T>(
    key: string,
    loader: Loader<T>,
    options?: CacheFetchOptionsInput<T>
  ): Promise<{ value: T; version: number }> {
    const value = await this.get(key, loader, options)
    const version = await this.ensureVersion(key)
    return { value, version }
  }

  private normalizeOptions(options?: number | CacheFetchOptions): NormalizedOptions {
    if (typeof options === 'number') {
      const ttlMs = options > 0 ? options * 1000 : null
      const staleMs = ttlMs !== null ? ttlMs * DEFAULT_STALE_MULTIPLIER : null
      return {
        ttlMs,
        staleMs,
        lockMs: DEFAULT_LOCK_SECONDS * 1000,
      }
    }

    const ttlSeconds = options?.ttlSeconds ?? 0
    const ttlMs = ttlSeconds > 0 ? ttlSeconds * 1000 : null
    const staleSeconds = options?.staleWhileRevalidateSeconds
      ?? (ttlSeconds > 0 ? Math.max(ttlSeconds, ttlSeconds * DEFAULT_STALE_MULTIPLIER) : 0)
    let staleMs = staleSeconds > 0 ? staleSeconds * 1000 : null

    if (ttlMs !== null && staleMs !== null && staleMs < ttlMs) {
      staleMs = ttlMs
    }
    if (ttlMs !== null && staleMs === null) {
      staleMs = ttlMs
    }

    const lockSeconds = options?.lockTimeoutSeconds ?? DEFAULT_LOCK_SECONDS
    const lockMs = Math.max(1000, lockSeconds * 1000)

    return {
      ttlMs,
      staleMs,
      lockMs,
    }
  }

  private normalizeOptionsInput<T>(
    options?: CacheFetchOptionsInput<T>
  ): { base: NormalizedOptions; resolver?: NormalizedOptionsResolver<T> } {
    if (typeof options === 'function') {
      return {
        base: this.normalizeOptions(),
        resolver: value => this.normalizeOptions(options(value)),
      }
    }

    return {
      base: this.normalizeOptions(options),
      resolver: undefined,
    }
  }

  private getEnvelopeFromMemory<T>(key: string): CacheEnvelope<T> | undefined {
    const entry = this.lru.get(key)
    if (!entry) {
      return undefined
    }
    return entry as CacheEnvelope<T>
  }

  private saveEnvelopeToMemory<T>(key: string, envelope: CacheEnvelope<T>) {
    this.lru.set(key, envelope as CacheEnvelope<unknown>)
  }

  getRedisClient(): Redis | null {
    return this.redis
  }

  private isExpired(envelope: CacheEnvelope<unknown>, reference: number): boolean {
    return Number.isFinite(envelope.expiresAt) && envelope.expiresAt <= reference
  }

  private isWithinStale(envelope: CacheEnvelope<unknown>, reference: number): boolean {
    return !Number.isFinite(envelope.staleUntil) || envelope.staleUntil > reference
  }

  private async handleExpiredEnvelope<T>(
    key: string,
    loader: Loader<T>,
    envelope: CacheEnvelope<T>,
    options: NormalizedOptions,
    reference: number,
    optionsResolver?: NormalizedOptionsResolver<T>
  ): Promise<T> {
    if (!this.isWithinStale(envelope, reference)) {
      return this.buildFresh(key, loader, options, envelope, optionsResolver)
    }

    const refreshed = await this.revalidateIfPossible(key, loader, envelope, options, optionsResolver)
    if (refreshed !== null) {
      return refreshed
    }

    return envelope.value
  }

  private async buildFresh<T>(
    key: string,
    loader: Loader<T>,
    options: NormalizedOptions,
    previousEnvelope?: CacheEnvelope<T>,
    optionsResolver?: NormalizedOptionsResolver<T>
  ): Promise<T> {
    const lockToken = await this.acquireLock(key, options.lockMs)
    const previousFingerprint = previousEnvelope?.fingerprint
    if (!lockToken) {
      const recovered = await this.waitForFreshEnvelope<T>(key, previousEnvelope, options)
      if (recovered) {
        return recovered.value
      }

      const retryToken = await this.acquireLock(key, options.lockMs)
      if (!retryToken) {
        if (previousEnvelope) {
          return previousEnvelope.value
        }
        const fallback = await loader()
        const resolvedOptions = optionsResolver ? optionsResolver(fallback) : options
        await this.storeEnvelope(key, fallback, resolvedOptions, previousFingerprint)
        return fallback
      }

      try {
        const fresh = await loader()
        const resolvedOptions = optionsResolver ? optionsResolver(fresh) : options
        await this.storeEnvelope(key, fresh, resolvedOptions, previousFingerprint)
        return fresh
      } finally {
        await this.releaseLock(key, retryToken)
      }
    }

    try {
      this.metrics.loaderCalls += 1
      const fresh = await loader()
      const resolvedOptions = optionsResolver ? optionsResolver(fresh) : options
      await this.storeEnvelope(key, fresh, resolvedOptions, previousFingerprint)
      return fresh
    } finally {
      await this.releaseLock(key, lockToken)
    }
  }

  private async revalidateIfPossible<T>(
    key: string,
    loader: Loader<T>,
    envelope: CacheEnvelope<T>,
    options: NormalizedOptions,
    optionsResolver?: NormalizedOptionsResolver<T>
  ): Promise<T | null> {
    const lockToken = await this.acquireLock(key, options.lockMs)
    if (lockToken) {
      try {
        this.metrics.loaderCalls += 1
        const fresh = await loader()
        const resolvedOptions = optionsResolver ? optionsResolver(fresh) : options
        await this.storeEnvelope(key, fresh, resolvedOptions, envelope.fingerprint)
        return fresh
      } finally {
        await this.releaseLock(key, lockToken)
      }
    }

    const recovered = await this.waitForFreshEnvelope<T>(key, envelope, options)
    if (recovered) {
      return recovered.value
    }

    return null
  }

  private async waitForFreshEnvelope<T>(
    key: string,
    previousEnvelope: CacheEnvelope<T> | undefined,
    options: NormalizedOptions
  ): Promise<CacheEnvelope<T> | null> {
    const attempts = Math.max(1, Math.floor(options.lockMs / LOCK_POLL_INTERVAL_MS))

    for (let i = 0; i < attempts; i += 1) {
      await delay(LOCK_POLL_INTERVAL_MS)
      const fromMemory = this.getEnvelopeFromMemory<T>(key)
      if (
        fromMemory &&
        (!previousEnvelope || fromMemory.fingerprint !== previousEnvelope.fingerprint) &&
        !this.isExpired(fromMemory, nowMs())
      ) {
        return fromMemory
      }

      const fromRedis = await this.readEnvelopeFromRedis<T>(key)
      if (
        fromRedis &&
        (!previousEnvelope || fromRedis.fingerprint !== previousEnvelope.fingerprint)
      ) {
        this.saveEnvelopeToMemory(key, fromRedis)
        if (!this.isExpired(fromRedis, nowMs())) {
          return fromRedis
        }
      }
    }

    return null
  }

  private async readEnvelopeFromRedis<T>(key: string): Promise<CacheEnvelope<T> | null> {
    if (!this.redis) {
      return null
    }

    try {
      const payload = await this.redis.get(key)
      if (!payload) {
        return null
      }
      const envelope = this.parseEnvelope<T>(key, payload)
      if (!envelope) {
        return null
      }
      this.versions.set(key, envelope.version)
      return envelope
    } catch (err) {
      return null
    }
  }

  private parseEnvelope<T>(key: string, payload: string): CacheEnvelope<T> | null {
    try {
      const decoded = this.decodeRedisPayload(payload)
      const parsed = JSON.parse(decoded)
      if (!parsed || typeof parsed !== 'object') {
        return null
      }

      const candidate = parsed as Partial<CacheEnvelope<T>> & { value?: T; fingerprint?: string }
      if (candidate.value === undefined || typeof candidate.fingerprint !== 'string') {
        return null
      }

      const expiresAt = typeof candidate.expiresAt === 'number' ? candidate.expiresAt : Number.NEGATIVE_INFINITY
      const staleUntil = typeof candidate.staleUntil === 'number' ? candidate.staleUntil : expiresAt
      const version = typeof candidate.version === 'number'
        ? candidate.version
        : this.versions.get(key) ?? 0

      return {
        value: candidate.value,
        fingerprint: candidate.fingerprint,
        expiresAt,
        staleUntil,
        version,
      }
    } catch (err) {
      return null
    }
  }

  private async storeEnvelope<T>(
    key: string,
    value: T,
    options: NormalizedOptions,
    previousFingerprint?: string
  ): Promise<CacheEnvelope<T>> {
    const timestamp = nowMs()
    const ttlMs = options.ttlMs
    const staleMs = options.staleMs

    const expiresAt = ttlMs !== null ? timestamp + ttlMs : Number.POSITIVE_INFINITY
    const staleUntil = staleMs !== null ? timestamp + staleMs : expiresAt

    const fingerprint = this.computeFingerprint(value)
    const version = await this.bumpVersion(key, fingerprint, previousFingerprint)

    const envelope: CacheEnvelope<T> = {
      value,
      fingerprint,
      expiresAt,
      staleUntil,
      version,
    }

    this.saveEnvelopeToMemory(key, envelope)

    if (this.redis) {
      try {
        const rawPayload = JSON.stringify(envelope)
        const payload = this.encodeRedisPayload(rawPayload)
        const ttlSeconds = this.computeRedisTtlSeconds(options)
        if (ttlSeconds > 0) {
          await this.redis.set(key, payload, 'EX', ttlSeconds)
        } else {
          await this.redis.set(key, payload)
        }
      } catch (err) {
        // ignore redis write errors
      }
    }

    return envelope
  }

  private computeRedisTtlSeconds(options: NormalizedOptions): number {
    const ttlMs = options.ttlMs ?? 0
    const staleMs = options.staleMs ?? ttlMs
    const maxMs = Math.max(ttlMs, staleMs)
    if (maxMs <= 0) {
      return 0
    }
    return Math.ceil(maxMs / 1000)
  }

  private lockKey(key: string): string {
    return `${LOCK_KEY_PREFIX}${key}`
  }

  private versionKey(key: string): string {
    return `${VERSION_KEY_PREFIX}${key}`
  }

  private async acquireLock(key: string, ttlMs: number): Promise<string | null> {
    const lockKey = this.lockKey(key)
    if (this.redis) {
      const token = randomBytes(16).toString('hex')
      try {
        const result = await this.redis.set(lockKey, token, 'PX', ttlMs, 'NX')
        return result === 'OK' ? token : null
      } catch (err) {
        return null
      }
    }

    const current = nowMs()
    const expiry = current + ttlMs
    const existing = this.localLocks.get(lockKey)
    if (existing && existing > current) {
      return null
    }
    this.localLocks.set(lockKey, expiry)
    return `local:${lockKey}`
  }

  private async releaseLock(key: string, token: string) {
    const lockKey = this.lockKey(key)
    if (this.redis) {
      try {
        await this.redis.eval(REDIS_RELEASE_SCRIPT, 1, lockKey, token)
      } catch (err) {
        // ignore redis release errors
      }
      return
    }
    this.localLocks.delete(lockKey)
  }

  private computeFingerprint<T>(value: T): string {
    const json = JSON.stringify(value)
    return createHash('sha1').update(json).digest('hex')
  }

  private async ensureVersion(key: string): Promise<number> {
    if (this.versions.has(key)) {
      return this.versions.get(key) as number
    }

    if (this.redis) {
      try {
        const versionKey = this.versionKey(key)
        const raw = await this.redis.get(versionKey)
        if (raw != null) {
          const parsed = Number(raw) || 0
          this.versions.set(key, parsed)
          return parsed
        }
        if (VERSION_TTL_SECONDS > 0) {
          await this.redis.set(versionKey, '0', 'EX', VERSION_TTL_SECONDS, 'NX')
        } else {
          await this.redis.setnx(versionKey, '0')
        }
      } catch (err) {
        // fall back to local version cache
      }
    }

    this.versions.set(key, 0)
    return 0
  }

  private async bumpVersion(
    key: string,
    fingerprint: string,
    previousFingerprint?: string
  ): Promise<number> {
    if (previousFingerprint === fingerprint && this.versions.has(key)) {
      return this.versions.get(key) as number
    }

    let nextVersion: number
    if (this.redis) {
      try {
        const versionKey = this.versionKey(key)
        const pipeline = this.redis.multi().incr(versionKey)
        if (VERSION_TTL_SECONDS > 0) {
          pipeline.expire(versionKey, VERSION_TTL_SECONDS)
        }
        const results = await pipeline.exec()
        const incrResult = results?.[0]?.[1]
        if (typeof incrResult === 'number') {
          nextVersion = incrResult
        } else if (typeof incrResult === 'string') {
          const parsed = Number(incrResult)
          nextVersion = Number.isNaN(parsed) ? 0 : parsed
        } else {
          nextVersion = 0
        }
      } catch (err) {
        const current = this.versions.get(key) ?? 0
        nextVersion = current + 1
      }
    } else {
      const current = this.versions.get(key) ?? 0
      nextVersion = current + 1
    }

    this.versions.set(key, nextVersion)
    return nextVersion
  }

  private encodeRedisPayload(rawJson: string): string {
    if (!REDIS_GZIP_ENABLED) {
      return rawJson
    }

    if (rawJson.length < REDIS_GZIP_MIN_BYTES) {
      return rawJson
    }

    try {
      const compressed = gzipSync(Buffer.from(rawJson, 'utf8'))
      // Сжимаем только если реально выгодно
      if (compressed.length >= rawJson.length * 0.9) {
        return rawJson
      }
      return `${REDIS_GZIP_PREFIX}${compressed.toString('base64')}`
    } catch {
      return rawJson
    }
  }

  private decodeRedisPayload(payload: string): string {
    if (!payload.startsWith(REDIS_GZIP_PREFIX)) {
      return payload
    }

    try {
      const b64 = payload.slice(REDIS_GZIP_PREFIX.length)
      const decompressed = gunzipSync(Buffer.from(b64, 'base64'))
      return decompressed.toString('utf8')
    } catch {
      // Если формат битый/неожиданный — пробуем как обычный JSON
      return payload
    }
  }
}

const redisUrl = process.env.REDIS_URL || process.env.REDIS || undefined
export const defaultCache = new MultiLevelCache(redisUrl, { maxSize: 2500 })

export default defaultCache
