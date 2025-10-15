import React, { useCallback, useEffect, useRef, useState } from 'react'
import './profile.css'

interface ProfileUser {
  telegramId?: string
  username?: string | null
  firstName?: string | null
  photoUrl?: string | null
  createdAt?: string
  updatedAt?: string
}

interface CacheEntry {
  data: ProfileUser
  timestamp: number
  etag?: string
}

type Nullable<T> = T | null

interface TelegramUserPayload {
  id: number
  first_name?: string
  last_name?: string
  username?: string
  photo_url?: string
  language_code?: string
}

interface TelegramWebApp {
  initData?: string
  initDataUnsafe?: {
    user?: TelegramUserPayload
  }
}

interface TelegramWindow extends Window {
  Telegram?: {
    WebApp?: TelegramWebApp
  }
}

const CACHE_TTL = 5 * 60 * 1000 // 5 минут
const CACHE_KEY = 'obnliga_profile_cache'
const PROFILE_REFRESH_INTERVAL_MS = 90_000

export default function Profile() {
  const [user, setUser] = useState<Nullable<ProfileUser>>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const isFetchingRef = useRef(false)
  const userRef = useRef<Nullable<ProfileUser>>(null)

  useEffect(() => {
    userRef.current = user
  }, [user])

  function getCachedProfile(): CacheEntry | null {
    try {
      const stored = localStorage.getItem(CACHE_KEY)
      if (!stored) return null

      const parsed = JSON.parse(stored) as Partial<CacheEntry> & { data?: unknown }
      if (!parsed || typeof parsed !== 'object') return null
      if (typeof parsed.timestamp !== 'number') return null
      const dataCandidate = parsed.data
      if (!isProfileUser(dataCandidate)) return null

      const entry: CacheEntry = {
        data: dataCandidate,
        timestamp: parsed.timestamp,
        etag: typeof parsed.etag === 'string' ? parsed.etag : undefined,
      }

      const now = Date.now()
      if (now - entry.timestamp > CACHE_TTL) {
        localStorage.removeItem(CACHE_KEY)
        return null
      }
      return entry
    } catch {
      return null
    }
  }

  function setCachedProfile(data: ProfileUser, etag?: string) {
    try {
      const entry: CacheEntry = {
        data,
        timestamp: Date.now(),
        etag,
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify(entry))
    } catch {
      // ignore
    }
  }

  const loadProfile = useCallback(async (opts?: { background?: boolean }) => {
    if (isFetchingRef.current) {
      return
    }

    const isBackground = Boolean(opts?.background)
    const cached = getCachedProfile()
    if (!isBackground && cached?.data) {
      setUser(cached.data)
      console.log('Loaded profile from cache')
    }

    isFetchingRef.current = true
    if (!isBackground) {
      setLoading(true)
    }

    try {
      const backendRaw = import.meta.env.VITE_BACKEND_URL ?? ''
      const backend = backendRaw || ''
      const meUrl = backend ? `${backend.replace(/\/$/, '')}/api/auth/me` : '/api/auth/me'

      // 1) Check if we're inside Telegram WebApp first and try to authenticate
      try {
        const telegramWindow = window as TelegramWindow
        const tg = telegramWindow.Telegram?.WebApp
        const unsafe = tg?.initDataUnsafe?.user
        if (tg && unsafe) {
          console.log('Telegram user data:', unsafe)
          if (!userRef.current) {
            setUser(prev =>
              prev ?? {
                telegramId: String(unsafe.id),
                username: unsafe.username ?? null,
                firstName: unsafe.first_name ?? null,
                photoUrl: unsafe.photo_url ?? null,
                createdAt: new Date().toISOString(),
              }
            )
          }

          const initUrl = backend
            ? `${backend.replace(/\/$/, '')}/api/auth/telegram-init`
            : '/api/auth/telegram-init'

          let initDataValue = tg.initData
          if (!initDataValue) {
            initDataValue = JSON.stringify({
              user: {
                id: unsafe.id,
                first_name: unsafe.first_name,
                last_name: unsafe.last_name,
                username: unsafe.username,
                photo_url: unsafe.photo_url,
                language_code: unsafe.language_code,
              },
            })
          }

          console.log('Sending initData to backend')
          const headers: Record<string, string> = { 'Content-Type': 'application/json' }
          if (typeof initDataValue === 'string' && initDataValue.length > 0) {
            headers['X-Telegram-Init-Data'] = initDataValue
          }
          if (cached?.etag) {
            headers['If-None-Match'] = cached.etag
          }

          const r = await fetch(initUrl, {
            method: 'POST',
            headers,
            credentials: 'include',
            body: JSON.stringify({ initData: initDataValue }),
          })

          if (r.status === 304) {
            if (cached?.data) {
              setUser(cached.data)
              console.log('Using cached profile (304 Not Modified)')
              return
            }
          } else if (r.ok) {
            const responseBody = (await r.json()) as unknown
            console.log('Backend response:', responseBody)
            const sessionToken = readTokenFromResponse(responseBody)
            if (sessionToken) {
              localStorage.setItem('session', sessionToken)
            }

            const profileUser = readProfileUser(responseBody)
            if (profileUser) {
              const etag = r.headers.get('ETag') ?? undefined
              setCachedProfile(profileUser, etag)
              setUser(profileUser)
              return
            }
          } else {
            console.error('Backend auth failed:', await r.text())
            setUser(null)
          }
        }
      } catch (e) {
        console.error('Telegram WebApp auth error:', e)
        setUser(null)
      }

      // 2) Try token-based load as fallback
      try {
        const token = localStorage.getItem('session')
        if (token) {
          const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
          if (cached?.etag) {
            headers['If-None-Match'] = cached.etag
          }

          const resp = await fetch(meUrl, { headers, credentials: 'include' })

          if (resp.status === 304) {
            if (cached?.data) {
              setUser(cached.data)
              console.log('Using cached profile (304 Not Modified)')
              return
            }
          } else if (resp.ok) {
            const payload = (await resp.json()) as unknown
            console.log('Token-based profile load:', payload)
            const profileUser = readProfileUser(payload)
            if (profileUser) {
              const etag = resp.headers.get('ETag') ?? undefined
              setCachedProfile(profileUser, etag)
              setUser(profileUser)
              return
            }
          }
        }
      } catch (e) {
        console.error('Token-based load error:', e)
      }
    } finally {
      if (!isBackground) {
        setLoading(false)
      }
      isFetchingRef.current = false
    }
  }, [])

  useEffect(() => {
    void loadProfile()
  }, [loadProfile])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        return
      }
      void loadProfile({ background: true })
    }

    const timer = window.setInterval(tick, PROFILE_REFRESH_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [loadProfile])

  return (
    <div className="profile-container">
      <div className="profile-header">
        <div className="avatar-section">
          {user && user.photoUrl ? (
            <img
              src={user.photoUrl}
              alt={user.username || user.firstName || 'avatar'}
              className="profile-avatar"
            />
          ) : (
            <div className="profile-avatar placeholder">{loading ? '⏳' : '👤'}</div>
          )}
          <div className="status-indicator online"></div>
        </div>

        <div className="profile-info">
          <h1 className="profile-name">
            {loading ? 'Загрузка...' : user?.username || user?.firstName || 'Гость'}
          </h1>
          {user?.telegramId && <div className="profile-id">ID: {user.telegramId}</div>}
          {user?.createdAt && (
            <div className="profile-joined">Участник с {formatDate(user.createdAt)}</div>
          )}
        </div>
      </div>

      <div className="profile-stats">
        <div className="stat-item">
          <div className="stat-value">0</div>
          <div className="stat-label">Матчи</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">0</div>
          <div className="stat-label">Голы</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">0</div>
          <div className="stat-label">Рейтинг</div>
        </div>
      </div>
    </div>
  )
}

function isNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string'
}

function isProfileUser(value: unknown): value is ProfileUser {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (!isNullableString(record.telegramId)) return false
  if (!isNullableString(record.username)) return false
  if (!isNullableString(record.firstName)) return false
  if (!isNullableString(record.photoUrl)) return false
  if (!isNullableString(record.createdAt)) return false
  if (!isNullableString(record.updatedAt)) return false
  return true
}

function readProfileUser(payload: unknown): ProfileUser | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  if ('user' in record && isProfileUser(record.user)) {
    return record.user
  }
  if (isProfileUser(payload)) {
    return payload
  }
  return null
}

function readTokenFromResponse(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const token = (payload as Record<string, unknown>).token
  return typeof token === 'string' ? token : null
}

function formatDate(dt?: string) {
  if (!dt) return ''
  try {
    const d = new Date(dt)
    // Convert to Moscow time (UTC+3) and format dd.mm.yyyy
    const ms = d.getTime() + 3 * 60 * 60 * 1000
    const md = new Date(ms)
    const day = String(md.getUTCDate()).padStart(2, '0')
    const month = String(md.getUTCMonth() + 1).padStart(2, '0')
    const year = md.getUTCFullYear()
    return `${day}.${month}.${year}`
  } catch (e) {
    return dt
  }
}
