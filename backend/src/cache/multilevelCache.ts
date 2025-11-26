import QuickLRU from 'quick-lru'
import Redis from 'ioredis'
import dotenv from 'dotenv'
import { createHash, randomBytes } from 'crypto'

dotenv.config({ path: `${__dirname}/../../.env` })

type Loader<T> = () => Promise<T>

export type CacheFetchOptions = {
  ttlSeconds?: number
  staleWhileRevalidateSeconds?: number
  lockTimeoutSeconds?: number
}

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

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const nowMs = () => Date.now()

export class MultiLevelCache {
  private lru: QuickLRU<string, CacheEnvelope<unknown>>
  private redis: Redis | null
  private versions: Map<string, number>
  private localLocks: Map<string, number>

  constructor(redisUrl?: string, lruOptions = { maxSize: 1000 }) {
    this.lru = new QuickLRU<string, CacheEnvelope<unknown>>(lruOptions)
    this.versions = new Map<string, number>()
    this.localLocks = new Map<string, number>()
    this.redis = redisUrl ? new Redis(redisUrl) : null
  }

  async get<T>(
    key: string,
    loader: Loader<T>,
    options?: number | CacheFetchOptions
  ): Promise<T> {
    const normalized = this.normalizeOptions(options)
    const reference = nowMs()

    const memoryEnvelope = this.getEnvelopeFromMemory<T>(key)
    if (memoryEnvelope) {
      const remoteVersion = await this.ensureVersion(key)
      if (this.redis && remoteVersion > memoryEnvelope.version) {
        const refreshed = await this.readEnvelopeFromRedis<T>(key)
        if (refreshed) {
          this.saveEnvelopeToMemory(key, refreshed)
          if (!this.isExpired(refreshed, reference)) {
            return refreshed.value
          }
          return this.handleExpiredEnvelope(key, loader, refreshed, normalized, reference)
        }
        return this.buildFresh(key, loader, normalized, memoryEnvelope)
      }

      if (!this.isExpired(memoryEnvelope, reference)) {
        return memoryEnvelope.value as T
      }

      return this.handleExpiredEnvelope(key, loader, memoryEnvelope, normalized, reference)
    }

    const redisEnvelope = await this.readEnvelopeFromRedis<T>(key)
    if (redisEnvelope) {
      this.saveEnvelopeToMemory(key, redisEnvelope)
      if (!this.isExpired(redisEnvelope, reference)) {
        return redisEnvelope.value
      }
      return this.handleExpiredEnvelope(key, loader, redisEnvelope, normalized, reference)
    }

    return this.buildFresh(key, loader, normalized)
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
        const results = await this.redis
          .multi()
          .del(key)
          .incr(versionKey)
          .exec()
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
        const keys = await this.redis.keys(`${prefix}*`)
        if (keys.length > 0) {
          await this.redis.del(...keys)
          // Инкрементируем версии для всех найденных ключей
          const pipeline = this.redis.pipeline()
          for (const key of keys) {
            pipeline.incr(this.versionKey(key))
          }
          await pipeline.exec()
        }
      } catch (err) {
        // ignore redis errors on invalidate
      }
    }
  }

  async getWithMeta<T>(
    key: string,
    loader: Loader<T>,
    options?: number | CacheFetchOptions
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
    reference: number
  ): Promise<T> {
    if (!this.isWithinStale(envelope, reference)) {
      return this.buildFresh(key, loader, options, envelope)
    }

    const refreshed = await this.revalidateIfPossible(key, loader, envelope, options)
    if (refreshed !== null) {
      return refreshed
    }

    return envelope.value
  }

  private async buildFresh<T>(
    key: string,
    loader: Loader<T>,
    options: NormalizedOptions,
    previousEnvelope?: CacheEnvelope<T>
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
        await this.storeEnvelope(key, fallback, options, previousFingerprint)
        return fallback
      }

      try {
        const fresh = await loader()
        await this.storeEnvelope(key, fresh, options, previousFingerprint)
        return fresh
      } finally {
        await this.releaseLock(key, retryToken)
      }
    }

    try {
      const fresh = await loader()
      await this.storeEnvelope(key, fresh, options, previousFingerprint)
      return fresh
    } finally {
      await this.releaseLock(key, lockToken)
    }
  }

  private async revalidateIfPossible<T>(
    key: string,
    loader: Loader<T>,
    envelope: CacheEnvelope<T>,
    options: NormalizedOptions
  ): Promise<T | null> {
    const lockToken = await this.acquireLock(key, options.lockMs)
    if (lockToken) {
      try {
        const fresh = await loader()
        await this.storeEnvelope(key, fresh, options, envelope.fingerprint)
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
      const parsed = JSON.parse(payload)
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
        const payload = JSON.stringify(envelope)
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
    if (this.redis) {
      try {
        const versionKey = this.versionKey(key)
        const raw = await this.redis.get(versionKey)
        if (raw != null) {
          const parsed = Number(raw) || 0
          this.versions.set(key, parsed)
          return parsed
        }
        await this.redis.setnx(versionKey, '0')
      } catch (err) {
        // fall back to local version cache
      }
    }

    if (this.versions.has(key)) {
      return this.versions.get(key) as number
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
        nextVersion = await this.redis.incr(versionKey)
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
}

const redisUrl = process.env.REDIS_URL || process.env.REDIS || undefined
export const defaultCache = new MultiLevelCache(redisUrl, { maxSize: 500 })

export default defaultCache
