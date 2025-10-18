import React, { useCallback, useEffect, useRef, useState } from 'react'
import './profile.css'

type LeaguePlayerStatus = 'NONE' | 'PENDING' | 'VERIFIED'

interface LeaguePlayerProfile {
  id: number
  firstName: string
  lastName: string
}

interface LeaguePlayerStats {
  matches: number
  goals: number
  assists: number
  penaltyGoals: number
  yellowCards: number
  redCards: number
}

interface StatItem {
  key: string
  label: string
  value: number
}

interface ProfileUser {
  telegramId?: string
  username?: string | null
  firstName?: string | null
  photoUrl?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  leaguePlayerStatus?: LeaguePlayerStatus
  leaguePlayerRequestedAt?: string | null
  leaguePlayerVerifiedAt?: string | null
  leaguePlayerId?: number | null
  leaguePlayer?: LeaguePlayerProfile | null
  leaguePlayerStats?: LeaguePlayerStats | null
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
  const [showVerifyModal, setShowVerifyModal] = useState(false)
  const [verifyLoading, setVerifyLoading] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)
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

  const status: LeaguePlayerStatus =
    user && isLeagueStatus(user.leaguePlayerStatus) ? user.leaguePlayerStatus : 'NONE'
  const isVerified = status === 'VERIFIED'
  const playerName = user?.leaguePlayer ? formatLeaguePlayerName(user.leaguePlayer) : null

  const statsList: StatItem[] =
    isVerified && user?.leaguePlayerStats
      ? [
          { key: 'matches', label: 'МАТЧИ', value: user.leaguePlayerStats.matches },
          { key: 'goals', label: 'ГОЛЫ', value: user.leaguePlayerStats.goals },
          { key: 'assists', label: 'ПАСЫ', value: user.leaguePlayerStats.assists },
          { key: 'penaltyGoals', label: 'ПЕНАЛЬТИ', value: user.leaguePlayerStats.penaltyGoals },
          { key: 'yellowCards', label: 'ЖЁЛТЫЕ', value: user.leaguePlayerStats.yellowCards },
          { key: 'redCards', label: 'КРАСНЫЕ', value: user.leaguePlayerStats.redCards },
        ]
      : []

  const statusMessage = (() => {
    if (status === 'VERIFIED') {
      return playerName ? `Подтверждён игрок лиги: ${playerName}` : 'Подтверждён игрок лиги.'
    }
    if (status === 'PENDING') {
      return 'Заявка на подтверждение отправлена. Ожидайте решения администратора.'
    }
    return 'Подтвердите статус игрока лиги, чтобы открыть персональную статистику.'
  })()

  useEffect(() => {
    if (status !== 'NONE') {
      setShowVerifyModal(false)
      setVerifyLoading(false)
      setVerifyError(null)
    }
  }, [status])

  const submitVerificationRequest = useCallback(async () => {
    if (verifyLoading) return

    const token = localStorage.getItem('session')
    if (!token) {
      setVerifyError('Сессия не найдена. Авторизуйтесь и попробуйте снова.')
      return
    }

    setVerifyLoading(true)
    setVerifyError(null)

    try {
      const backendRaw = import.meta.env.VITE_BACKEND_URL ?? ''
      const backend = backendRaw || ''
      const verifyUrl = backend
        ? `${backend.replace(/\/$/, '')}/api/users/league-player/request`
        : '/api/users/league-player/request'

      const response = await fetch(verifyUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      })

      const text = await response.text()
      let parsed: unknown = null
      if (text) {
        try {
          parsed = JSON.parse(text) as unknown
        } catch {
          parsed = null
        }
      }

      if (!response.ok) {
        const errorCode =
          parsed && typeof parsed === 'object' && 'error' in (parsed as Record<string, unknown>)
            ? (parsed as Record<string, unknown>).error
            : response.statusText
        setVerifyError(translateVerificationError(typeof errorCode === 'string' ? errorCode : ''))
        return
      }

      const profile = readProfileUser(parsed)
      if (profile) {
        setCachedProfile(profile)
        setUser(profile)
      }
      setShowVerifyModal(false)
    } catch (err) {
      setVerifyError('Не удалось отправить запрос. Попробуйте позже.')
    } finally {
      setVerifyLoading(false)
    }
  }, [verifyLoading])

  return (
    <div className="profile-container">
      <div className="profile-wrapper">
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
            {isVerified ? (
              <div className="verified-indicator" title="Подтверждён игрок лиги">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9.5 16.2 5.3 12l1.4-1.4 2.8 2.79 7.2-7.19 1.4 1.41-8.6 8.59z" fill="currentColor" />
                </svg>
              </div>
            ) : null}
          </div>

          <div className="profile-info">
            <h1 className="profile-name">
              {loading ? 'Загрузка...' : user?.username || user?.firstName || 'Гость'}
            </h1>
            <div className={`profile-status-message status-${status.toLowerCase()}`}>
              {statusMessage}
            </div>
            {playerName ? <div className="league-player-name">{playerName}</div> : null}
            {status === 'NONE' ? (
              <div className="verification-actions">
                <button
                  type="button"
                  className="verify-button"
                  onClick={() => {
                    setVerifyError(null)
                    setShowVerifyModal(true)
                  }}
                  disabled={verifyLoading}
                >
                  {verifyLoading ? 'Отправляем…' : 'Подтвердить статус игрока'}
                </button>
              </div>
            ) : null}
            {status === 'PENDING' ? (
              <div className="verification-note">
                Запрос отправлен. Мы сообщим, когда администратор подтвердит статус.
              </div>
            ) : null}
          </div>
        </div>

        <div className={`profile-stats ${isVerified ? 'with-data' : 'empty'}`}>
          {isVerified && statsList.length ? (
            statsList.map(item => (
              <div className="stat-item" key={item.key}>
                <div className="stat-value">{item.value}</div>
                <div className="stat-label">{item.label}</div>
              </div>
            ))
          ) : (
            <div className="stats-placeholder">
              <p>Статистика появится после подтверждения администратора.</p>
            </div>
          )}
        </div>

        {showVerifyModal ? (
          <div className="verify-modal-backdrop" role="dialog" aria-modal="true">
            <div className="verify-modal">
              <h2>Подтвердить статус игрока</h2>
              <p>
                Подтвердить участие можно один раз. Запрос поступит в админ-панель, где выберут
                вашу карточку игрока.
              </p>
              {verifyError ? <div className="verify-modal-error">{verifyError}</div> : null}
              <div className="verify-modal-actions">
                <button
                  type="button"
                  className="verify-cancel"
                  onClick={() => {
                    if (!verifyLoading) {
                      setShowVerifyModal(false)
                      setVerifyError(null)
                    }
                  }}
                  disabled={verifyLoading}
                >
                  Отменить
                </button>
                <button
                  type="button"
                  className="verify-submit"
                  onClick={() => submitVerificationRequest()}
                  disabled={verifyLoading}
                >
                  {verifyLoading ? 'Отправляем…' : 'Отправить запрос'}
                </button>
              </div>
              <p className="verify-note">После подтверждения станет доступна полная статистика.</p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function isNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string'
}

function getNullableString(value: unknown): string | null | undefined {
  if (value === undefined || value === null) {
    return value as undefined | null
  }
  return typeof value === 'string' ? value : undefined
}

function isLeagueStatus(value: unknown): value is LeaguePlayerStatus {
  return value === 'NONE' || value === 'PENDING' || value === 'VERIFIED'
}

function isLeaguePlayerProfile(value: unknown): value is LeaguePlayerProfile {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'number' &&
    typeof record.firstName === 'string' &&
    typeof record.lastName === 'string'
  )
}

function isLeaguePlayerStats(value: unknown): value is LeaguePlayerStats {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  const keys: Array<keyof LeaguePlayerStats> = [
    'matches',
    'goals',
    'assists',
    'penaltyGoals',
    'yellowCards',
    'redCards',
  ]
  return keys.every(key => typeof record[key] === 'number')
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

function normalizeProfilePayload(value: unknown): ProfileUser | null {
  if (!isProfileUser(value)) return null
  const record = value as ProfileUser & Record<string, unknown>
  const normalized: ProfileUser = {
    telegramId: record.telegramId,
    username: record.username ?? null,
    firstName: record.firstName ?? null,
    photoUrl: record.photoUrl ?? null,
    createdAt: record.createdAt ?? null,
    updatedAt: record.updatedAt ?? null,
  }

  if (isLeagueStatus(record.leaguePlayerStatus)) {
    normalized.leaguePlayerStatus = record.leaguePlayerStatus
  }

  if (typeof record.leaguePlayerId === 'number') {
    normalized.leaguePlayerId = record.leaguePlayerId
  }

  const requestedAt = getNullableString((record as Record<string, unknown>).leaguePlayerRequestedAt)
  if (requestedAt !== undefined) {
    normalized.leaguePlayerRequestedAt = requestedAt ?? null
  }

  const verifiedAt = getNullableString((record as Record<string, unknown>).leaguePlayerVerifiedAt)
  if (verifiedAt !== undefined) {
    normalized.leaguePlayerVerifiedAt = verifiedAt ?? null
  }

  const leaguePlayerRaw = (record as Record<string, unknown>).leaguePlayer
  normalized.leaguePlayer = isLeaguePlayerProfile(leaguePlayerRaw) ? leaguePlayerRaw : null

  const statsRaw = (record as Record<string, unknown>).leaguePlayerStats
  normalized.leaguePlayerStats = isLeaguePlayerStats(statsRaw) ? statsRaw : null

  return normalized
}

function readProfileUser(payload: unknown): ProfileUser | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  if ('user' in record) {
    const candidate = (record as { user?: unknown }).user
    const normalized = normalizeProfilePayload(candidate)
    if (normalized) {
      return normalized
    }
  }
  return normalizeProfilePayload(payload)
}

function readTokenFromResponse(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const token = (payload as Record<string, unknown>).token
  return typeof token === 'string' ? token : null
}

function formatLeaguePlayerName(player: LeaguePlayerProfile): string {
  return `${player.firstName} ${player.lastName}`.trim()
}

function translateVerificationError(code: string): string {
  const normalized = code.trim().toLowerCase()
  if (!normalized) {
    return 'Не удалось отправить запрос. Попробуйте позже.'
  }
  if (normalized.includes('already_verified')) {
    return 'Профиль уже подтверждён как игрок лиги.'
  }
  if (normalized.includes('verification_pending')) {
    return 'Заявка уже отправлена. Ожидайте решения администратора.'
  }
  if (normalized.includes('user_not_found')) {
    return 'Пользователь не найден. Авторизуйтесь заново.'
  }
  if (normalized.includes('invalid_token') || normalized.includes('no_token')) {
    return 'Сессия истекла. Авторизуйтесь и попробуйте снова.'
  }
  return 'Не удалось отправить запрос. Попробуйте позже.'
}
