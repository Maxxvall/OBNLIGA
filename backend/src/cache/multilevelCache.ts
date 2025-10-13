import QuickLRU from 'quick-lru'
import Redis from 'ioredis'
import dotenv from 'dotenv'
import { createHash } from 'crypto'

dotenv.config({ path: `${__dirname}/../../.env` })

type Loader<T> = () => Promise<T>

type CacheEnvelope<T> = {
  value: T
  fingerprint: string
}

const INVALIDATION_CHANNEL = 'multilevel-cache:invalidate'

export class MultiLevelCache {
  private lru: QuickLRU<string, CacheEnvelope<unknown>>
  private redis: Redis | null
  private versions: Map<string, number>

  constructor(redisUrl?: string, lruOptions = { maxSize: 1000 }) {
    this.lru = new QuickLRU<string, CacheEnvelope<unknown>>(lruOptions)
    this.versions = new Map<string, number>()
    if (redisUrl) {
      this.redis = new Redis(redisUrl)
      // subscribe to invalidation messages
      const sub = new Redis(redisUrl)
      sub.subscribe(INVALIDATION_CHANNEL, err => {
        if (err) console.warn('Failed to subscribe cache invalidation channel', err)
      })
      sub.on('message', (_channel, message) => {
        try {
          const parsed = JSON.parse(message)
          if (parsed && parsed.key) {
            this.lru.delete(parsed.key)
            this.versions.delete(parsed.key)
          }
        } catch (e) {
          // ignore
        }
      })
    } else {
      this.redis = null
    }
  }

  async get<T>(key: string, loader: Loader<T>, ttlSeconds?: number): Promise<T> {
    // try in-memory
    if (this.lru.has(key)) {
      const entry = this.lru.get(key)
      if (entry) {
        await this.ensureVersion(key)
        return entry.value as T
      }
    }

    // try redis
    if (this.redis) {
      const val = await this.redis.get(key)
      if (val != null) {
        try {
          const parsed = JSON.parse(val) as CacheEnvelope<T> | T
          if (
            typeof parsed === 'object' &&
            parsed &&
            'value' in parsed &&
            'fingerprint' in parsed
          ) {
            this.lru.set(key, parsed as CacheEnvelope<T>)
            await this.ensureVersion(key)
            return parsed.value
          }
          const envelope: CacheEnvelope<T> = {
            value: parsed as T,
            fingerprint: this.computeFingerprint(parsed),
          }
          // warm in-memory
          this.lru.set(key, envelope)
          await this.ensureVersion(key)
          return envelope.value
        } catch (e) {
          // fallthrough
        }
      }
    }

    // load fresh
    const fresh = await loader()
    const envelope: CacheEnvelope<T> = { value: fresh, fingerprint: this.computeFingerprint(fresh) }
    const previousFingerprint = this.lru.get(key)?.fingerprint
    // set in both layers
    this.lru.set(key, envelope)
    if (this.redis) {
      try {
        const payload = JSON.stringify(envelope)
        if (ttlSeconds && ttlSeconds > 0) {
          await this.redis.setex(key, ttlSeconds, payload)
        } else {
          await this.redis.set(key, payload)
        }
      } catch (e) {
        // ignore
      }
    }
    await this.bumpVersion(key, envelope.fingerprint, previousFingerprint)
    return fresh
  }

  async set<T>(key: string, value: T, ttlSeconds?: number) {
    const envelope: CacheEnvelope<T> = { value, fingerprint: this.computeFingerprint(value) }
    const previousFingerprint = this.lru.get(key)?.fingerprint
    this.lru.set(key, envelope)
    if (this.redis) {
      try {
        const payload = JSON.stringify(envelope)
        if (ttlSeconds && ttlSeconds > 0) {
          await this.redis.setex(key, ttlSeconds, payload)
        } else {
          await this.redis.set(key, payload)
        }
      } catch (e) {
        // ignore
      }
    }
    await this.bumpVersion(key, envelope.fingerprint, previousFingerprint)
    // publish invalidation so other instances can invalidate local caches (they'll re-read if requested)
    if (this.redis) {
      try {
        await this.redis.publish(INVALIDATION_CHANNEL, JSON.stringify({ key }))
      } catch (e) {
        // ignore
      }
    }
  }

  async invalidate(key: string) {
    this.lru.delete(key)
    this.versions.delete(key)
    if (this.redis) {
      try {
        await this.redis.del(key)
        await this.redis.publish(INVALIDATION_CHANNEL, JSON.stringify({ key }))
      } catch (e) {
        // ignore
      }
    }
  }

  async getWithMeta<T>(
    key: string,
    loader: Loader<T>,
    ttlSeconds?: number
  ): Promise<{ value: T; version: number }> {
    const value = await this.get(key, loader, ttlSeconds)
    const version = await this.ensureVersion(key)
    return { value, version }
  }

  private computeFingerprint<T>(value: T): string {
    const json = JSON.stringify(value)
    return createHash('sha1').update(json).digest('hex')
  }

  private versionKey(key: string) {
    return `__v:${key}`
  }

  private async ensureVersion(key: string): Promise<number> {
    if (this.versions.has(key)) {
      return this.versions.get(key) as number
    }

    if (this.redis) {
      const versionKey = this.versionKey(key)
      const raw = await this.redis.get(versionKey)
      if (raw != null) {
        const parsed = Number(raw) || 0
        this.versions.set(key, parsed)
        return parsed
      }
      await this.redis.setnx(versionKey, '0')
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
      const versionKey = this.versionKey(key)
      nextVersion = await this.redis.incr(versionKey)
    } else {
      const current = this.versions.get(key) ?? 0
      nextVersion = current + 1
    }
    this.versions.set(key, nextVersion)
    return nextVersion
  }
}

// create a default cache instance using REDIS_URL from env if present
const redisUrl = process.env.REDIS_URL || process.env.REDIS || undefined
export const defaultCache = new MultiLevelCache(redisUrl, { maxSize: 500 })

export default defaultCache
