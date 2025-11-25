import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  UserRatingSummary,
  UserAchievementsSummary,
  DailyRewardSummary,
  DailyRewardClaimResponse,
} from '@shared/types'
import { fetchMyRating } from './api/ratingsApi'
import { fetchMyAchievements } from './api/achievementsApi'
import { fetchDailyRewardSummary, claimDailyReward } from './api/dailyRewardApi'
import DailyRewardCard from './components/DailyRewardCard'
import AchievementsGrid from './components/AchievementsGrid'
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

interface LeaguePlayerCareerEntry {
  clubId: number
  clubName: string
  clubShortName: string
  clubLogoUrl: string | null
  fromYear: number | null
  toYear: number | null
  matches: number
  assists: number
  goals: number
  penaltyGoals: number
  yellowCards: number
  redCards: number
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
  leaguePlayerCareer?: LeaguePlayerCareerEntry[] | null
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

interface TelegramShareMediaAttachment {
  type: 'photo'
  media: File | string
  caption?: string
}

type TelegramShareContent =
  | string
  | {
      text?: string
      message?: string
      url?: string
      media?: TelegramShareMediaAttachment[]
    }

interface TelegramWebApp {
  initData?: string
  initDataUnsafe?: {
    user?: TelegramUserPayload
  }
  shareToTelegram?: (content: TelegramShareContent) => Promise<void>
  showAlert?: (message: string) => void
}

interface TelegramWindow extends Window {
  Telegram?: {
    WebApp?: TelegramWebApp
  }
}

type DevTelegramUserConfig = {
  id: number
  firstName?: string
  lastName?: string
  username?: string
  photoUrl?: string
}

const LONG_PRESS_DELAY_MS = 650
const MOVE_CANCEL_THRESHOLD_PX = 18
const SHARE_PIXEL_RATIO_LIMIT = 2.5
const MIN_SHARE_PIXEL_RATIO = 1.6

function isAscii(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7f) {
      return false
    }
  }
  return true
}

const CACHE_TTL = 5 * 60 * 1000 // 5 минут
const CACHE_KEY = 'obnliga_profile_cache'
const PROFILE_REFRESH_INTERVAL_MS = 90_000
const VERIFY_PROMPT_STORAGE_KEY = 'profile_verify_prompt_hidden'

type ProfileSection = 'overview' | 'stats' | 'achievements'

export default function Profile() {
  const [user, setUser] = useState<Nullable<ProfileUser>>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [showVerifyModal, setShowVerifyModal] = useState(false)
  const [verifyLoading, setVerifyLoading] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<ProfileSection>('overview')
  const [rating, setRating] = useState<UserRatingSummary | null>(null)
  const [, setAchievements] = useState<UserAchievementsSummary | null>(null)
  const [dailyReward, setDailyReward] = useState<DailyRewardSummary | null>(null)
  const [dailyRewardLoading, setDailyRewardLoading] = useState(false)
  const [dailyRewardError, setDailyRewardError] = useState<string | null>(null)
  const [claimRewardLoading, setClaimRewardLoading] = useState(false)
  const [lastReward, setLastReward] = useState<DailyRewardClaimResponse['awarded'] | null>(null)
  const [verifyPromptHidden, setVerifyPromptHidden] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false
    }
    return window.localStorage.getItem(VERIFY_PROMPT_STORAGE_KEY) === '1'
  })
  const [isCompactLayout, setIsCompactLayout] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false
    }
    return window.matchMedia('(max-width: 425px)').matches
  })
  const isFetchingRef = useRef(false)
  const userRef = useRef<Nullable<ProfileUser>>(null)
  const careerCardRef = useRef<HTMLDivElement | null>(null)
  const [activeShareRowKey, setActiveShareRowKey] = useState<string | null>(null)
  const [isShareBusy, setIsShareBusy] = useState(false)
  const longPressTimeoutRef = useRef<number | null>(null)
  const pointerStartRef = useRef<{ x: number; y: number; pointerId: number } | null>(null)
  const pressEntryRef = useRef<LeaguePlayerCareerEntry | null>(null)
  const shareInProgressRef = useRef(false)

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

  const updateVerifyPromptHidden = useCallback((next: boolean) => {
    setVerifyPromptHidden(next)
    if (typeof window === 'undefined') {
      return
    }
    if (next) {
      window.localStorage.setItem(VERIFY_PROMPT_STORAGE_KEY, '1')
    } else {
      window.localStorage.removeItem(VERIFY_PROMPT_STORAGE_KEY)
    }
  }, [])

  const handleHideVerifyPrompt = useCallback(() => {
    updateVerifyPromptHidden(true)
  }, [updateVerifyPromptHidden])

  const handleShowVerifyPrompt = useCallback(() => {
    updateVerifyPromptHidden(false)
  }, [updateVerifyPromptHidden])

  const loadProfile = useCallback(async (opts?: { background?: boolean; skipCache?: boolean }) => {
    if (isFetchingRef.current) {
      return
    }

    const isBackground = Boolean(opts?.background)
    const skipCache = Boolean(opts?.skipCache)
    const cached = skipCache ? null : getCachedProfile()
    if (!isBackground && cached?.data) {
      setUser(cached.data)
    }

    isFetchingRef.current = true
    if (!isBackground) {
      setLoading(true)
    }

    try {
      const backendRaw = import.meta.env.VITE_BACKEND_URL ?? ''
      const backend = backendRaw || ''
      const meUrl = backend ? `${backend.replace(/\/$/, '')}/api/auth/me` : '/api/auth/me'
      const initUrl = backend
        ? `${backend.replace(/\/$/, '')}/api/auth/telegram-init`
        : '/api/auth/telegram-init'

      const authenticateUsingPayload = async (
        userPayload: TelegramUserPayload,
        initDataOverride: string | undefined,
        source: 'telegram' | 'dev'
      ) => {
        // debug: authenticateUsingPayload called
        if (!userRef.current) {
          setUser(prev =>
            prev ?? {
              telegramId: String(userPayload.id),
              username: userPayload.username ?? null,
              firstName: userPayload.first_name ?? null,
              photoUrl: userPayload.photo_url ?? null,
              createdAt: new Date().toISOString(),
            }
          )
        }

        const initDataValue =
          typeof initDataOverride === 'string' && initDataOverride.length > 0
            ? initDataOverride
            : JSON.stringify({
              user: {
                id: userPayload.id,
                first_name: userPayload.first_name,
                last_name: userPayload.last_name,
                username: userPayload.username,
                photo_url: userPayload.photo_url,
                language_code: userPayload.language_code,
              },
            })

        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (initDataValue.length > 0 && isAscii(initDataValue)) {
          headers['X-Telegram-Init-Data'] = initDataValue
        }
        if (!skipCache && cached?.etag) {
          headers['If-None-Match'] = cached.etag
        }

        const response = await fetch(initUrl, {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({ initData: initDataValue }),
        })

        if (response.status === 304) {
          if (cached?.data) {
            setCachedProfile(cached.data, response.headers.get('ETag') ?? cached.etag)
            setUser(cached.data)
          }
          return true
        }

        if (response.ok) {
          const responseBody = (await response.json()) as unknown
          const sessionToken = readTokenFromResponse(responseBody)
          if (sessionToken) {
            localStorage.setItem('session', sessionToken)
          }

          const profileUser = readProfileUser(responseBody)
          if (profileUser) {
            const etag = response.headers.get('ETag') ?? undefined
            setCachedProfile(profileUser, etag)
            setUser(profileUser)
            return true
          }
          console.warn('[Profile] auth response received, но данные профиля отсутствуют')
          setUser(null)
        } else {
          console.error(
            `[Profile] ${source} auth failed:`,
            response.status,
            await response.text()
          )
          setUser(null)
        }

        return false
      }

      // 1) Check if we're inside Telegram WebApp first and try to authenticate
      try {
        const telegramWindow = window as TelegramWindow
        const tg = telegramWindow.Telegram?.WebApp
        const unsafe = tg?.initDataUnsafe?.user
        const devConfig = resolveDevTelegramUser()

        if (tg && unsafe) {
          const success = await authenticateUsingPayload(unsafe, tg.initData, 'telegram')
          if (success) {
            return
          }
        }

        if (devConfig) {
          const devPayload: TelegramUserPayload = {
            id: devConfig.id,
            first_name: devConfig.firstName,
            last_name: devConfig.lastName,
            username: devConfig.username,
            photo_url: devConfig.photoUrl,
          }
          const success = await authenticateUsingPayload(devPayload, undefined, 'dev')
          if (success) {
            return
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
          if (!skipCache && cached?.etag) {
            headers['If-None-Match'] = cached.etag
          }

          const resp = await fetch(meUrl, { headers, credentials: 'include' })

          if (resp.status === 304) {
            if (cached?.data) {
              setCachedProfile(cached.data, resp.headers.get('ETag') ?? cached.etag)
              setUser(cached.data)
            }
            return
          } else if (resp.ok) {
            const payload = (await resp.json()) as unknown
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

    const media = window.matchMedia('(max-width: 425px)')
    const handleMediaChange = (event: MediaQueryListEvent) => {
      setIsCompactLayout(event.matches)
    }
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handleMediaChange)
    } else {
      media.addListener(handleMediaChange)
    }
    setIsCompactLayout(media.matches)

    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        return
      }
      void loadProfile({ background: true })
    }

    const timer = window.setInterval(tick, PROFILE_REFRESH_INTERVAL_MS)
    return () => {
      window.clearInterval(timer)
      if (typeof media.removeEventListener === 'function') {
        media.removeEventListener('change', handleMediaChange)
      } else {
        media.removeListener(handleMediaChange)
      }
    }
  }, [loadProfile])

  useEffect(() => {
    if (!isCompactLayout && activeSection !== 'overview') {
      setActiveSection('overview')
    }
  }, [isCompactLayout, activeSection])

  // Загрузка рейтинга пользователя
  useEffect(() => {
    if (!user) return
    
    void (async () => {
      const result = await fetchMyRating()
      if (result.ok) {
        setRating(result.data)
      }
    })()
  }, [user])

  // Загрузка достижений пользователя
  useEffect(() => {
    if (!user) return
    
    void (async () => {
      const result = await fetchMyAchievements()
      if (result.data) {
        setAchievements(result.data)
      }
    })()
  }, [user])

  useEffect(() => {
    if (!user) {
      setDailyReward(null)
      setDailyRewardError(null)
      setLastReward(null)
      return
    }

    let cancelled = false

    const load = async (options?: { background?: boolean }) => {
      if (options?.background) {
        try {
          const result = await fetchDailyRewardSummary({ force: true })
          if (!cancelled && result.data) {
            setDailyReward(result.data)
            setDailyRewardError(null)
          }
        } catch (err) {
          if (!cancelled) {
            setDailyRewardError('Не удалось обновить ежедневные награды')
          }
        }
        return
      }

      setDailyRewardLoading(true)
      setDailyRewardError(null)
      try {
        const result = await fetchDailyRewardSummary()
        if (!cancelled && result.data) {
          setDailyReward(result.data)
        }
      } catch (err) {
        if (!cancelled) {
          setDailyRewardError('Не удалось загрузить ежедневные награды')
        }
      } finally {
        if (!cancelled) {
          setDailyRewardLoading(false)
        }
      }
    }

    void load()
    if (typeof window === 'undefined') {
      return () => {
        cancelled = true
      }
    }

    const intervalId = window.setInterval(() => {
      void load({ background: true })
    }, 120000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [user])

  const status: LeaguePlayerStatus =
    user && isLeagueStatus(user.leaguePlayerStatus) ? user.leaguePlayerStatus : 'NONE'
  const isVerified = status === 'VERIFIED'
  const displayName = user?.firstName?.trim()?.length
    ? String(user.firstName)
    : user?.username?.trim()?.length
      ? String(user.username)
      : 'Гость'

  const careerRows = useMemo(() => {
    if (!isVerified) {
      return []
    }
    if (Array.isArray(user?.leaguePlayerCareer)) {
      return user.leaguePlayerCareer
    }
    return []
  }, [isVerified, user?.leaguePlayerCareer])

  const renderCareerRange = useCallback((entry: LeaguePlayerCareerEntry): string => {
    const hasStart = typeof entry.fromYear === 'number'
    const hasEnd = typeof entry.toYear === 'number'

    if (!hasStart && !hasEnd) {
      return '—'
    }
    if (hasStart && !hasEnd) {
      return `${entry.fromYear ?? ''}-н.в`
    }
    if (!hasStart && hasEnd) {
      return `${entry.toYear}`
    }
    if (entry.fromYear === entry.toYear) {
      return `${entry.fromYear}`
    }
    return `${entry.fromYear}-${entry.toYear}`
  }, [])

  const getCareerRowKey = useCallback((entry: LeaguePlayerCareerEntry) => {
    const start = entry.fromYear ?? 'start'
    const end = entry.toYear ?? 'current'
    return `${entry.clubId}-${start}-${end}-${entry.matches}-${entry.assists}-${entry.goals}-${entry.yellowCards}-${entry.redCards}`
  }, [])

  const showShareAlert = useCallback((message: string) => {
    if (typeof window === 'undefined') {
      return
    }
    const telegram = (window as TelegramWindow).Telegram?.WebApp
    if (telegram?.showAlert) {
      telegram.showAlert(message)
    } else {
      window.alert(message)
    }
  }, [])

  const clearLongPress = useCallback(
    (options?: { preserveActive?: boolean }) => {
      if (longPressTimeoutRef.current !== null) {
        window.clearTimeout(longPressTimeoutRef.current)
        longPressTimeoutRef.current = null
      }
      pointerStartRef.current = null
      pressEntryRef.current = null
      if (!options?.preserveActive) {
        setActiveShareRowKey(null)
      }
    },
    []
  )

  const handleClaimReward = useCallback(async () => {
    if (!dailyReward || claimRewardLoading || !dailyReward.claimAvailable) {
      return
    }

    setClaimRewardLoading(true)
    setDailyRewardError(null)
    try {
      const result = await claimDailyReward()
      setDailyReward(result.summary)
      setLastReward(result.awarded)

      const [ratingResult, achievementsResult] = await Promise.all([
        fetchMyRating(),
        fetchMyAchievements({ force: true }),
      ])

      if (ratingResult.ok) {
        setRating(ratingResult.data)
      }
      if (achievementsResult.data) {
        setAchievements(achievementsResult.data)
      }
    } catch (err) {
      setDailyRewardError('Не удалось получить награду. Попробуйте ещё раз.')
    } finally {
      setClaimRewardLoading(false)
    }
  }, [dailyReward, claimRewardLoading])

  const shareCareerSnapshot = useCallback(
    async (entry: LeaguePlayerCareerEntry, rowKey: string) => {
      if (!careerCardRef.current || shareInProgressRef.current) {
        return
      }

      shareInProgressRef.current = true
      setIsShareBusy(true)
      setActiveShareRowKey(rowKey)

      try {
        const { toBlob } = await import('html-to-image')
        const container = careerCardRef.current
        if (!container) {
          throw new Error('capture-container-missing')
        }

        const deviceRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
        const pixelRatio = Math.min(
          SHARE_PIXEL_RATIO_LIMIT,
          Math.max(MIN_SHARE_PIXEL_RATIO, deviceRatio)
        )
        const backgroundColor =
          typeof window !== 'undefined'
            ? getComputedStyle(document.body).backgroundColor || '#040914'
            : '#040914'

        const blob = await toBlob(container, {
          cacheBust: true,
          pixelRatio,
          backgroundColor,
          filter: node =>
            !(node instanceof HTMLElement && node.classList.contains('profile-share-overlay')),
        })

        if (!blob) {
          throw new Error('capture-blob-empty')
        }

        const fileName = `obnliga-career-${Date.now()}.png`
        const shareText = `${displayName} — ${renderCareerRange(entry)} ${entry.clubShortName}. Матчи: ${entry.matches}, Голы: ${entry.goals}, Передачи: ${entry.assists}.`
        const shareFile = new File([blob], fileName, { type: 'image/png' })

        let delivered = false
        const telegram = (window as TelegramWindow).Telegram?.WebApp

        if (telegram && typeof telegram.shareToTelegram === 'function') {
          try {
            await telegram.shareToTelegram({
              text: shareText,
              media: [{ type: 'photo', media: shareFile }],
            })
            delivered = true
          } catch (error) {
            console.error('[Profile] shareToTelegram failed:', error)
          }
        }

        if (!delivered && typeof navigator !== 'undefined' && 'share' in navigator) {
          const navigatorShare = navigator as Navigator & {
            share?: (data: ShareData) => Promise<void>
            canShare?: (data?: ShareData) => boolean
          }
          if (typeof navigatorShare.share === 'function') {
            const canShareFiles =
              typeof navigatorShare.canShare === 'function'
                ? navigatorShare.canShare({ files: [shareFile] })
                : false
            if (canShareFiles) {
              try {
                await navigatorShare.share({
                  files: [shareFile],
                  text: shareText,
                  title: 'OBNLIGA',
                })
                delivered = true
              } catch (error) {
                console.error('[Profile] navigator.share failed:', error)
              }
            }
          }
        }

        if (!delivered) {
          const blobUrl = URL.createObjectURL(blob)
          try {
            const link = document.createElement('a')
            link.href = blobUrl
            link.download = fileName
            link.style.display = 'none'
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
            showShareAlert('Снимок сохранён. Отправьте его в Telegram вручную.')
          } finally {
            window.setTimeout(() => URL.revokeObjectURL(blobUrl), 5000)
          }
        }
      } catch (error) {
        console.error('[Profile] shareCareerSnapshot error:', error)
        showShareAlert('Не удалось подготовить снимок. Попробуйте ещё раз.')
      } finally {
        shareInProgressRef.current = false
        setIsShareBusy(false)
        setActiveShareRowKey(current => (current === rowKey ? null : current))
      }
    },
    [displayName, renderCareerRange, showShareAlert]
  )

  const handleCareerRowPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, entry: LeaguePlayerCareerEntry) => {
      if (!isVerified || isShareBusy || shareInProgressRef.current) {
        return
      }
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return
      }

      const rowKey = getCareerRowKey(entry)
      pressEntryRef.current = entry
      pointerStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        pointerId: event.pointerId,
      }
      setActiveShareRowKey(rowKey)

      if (longPressTimeoutRef.current !== null) {
        window.clearTimeout(longPressTimeoutRef.current)
      }

      longPressTimeoutRef.current = window.setTimeout(() => {
        if (!pressEntryRef.current) {
          return
        }
        clearLongPress({ preserveActive: true })
        void shareCareerSnapshot(entry, rowKey)
      }, LONG_PRESS_DELAY_MS)
    },
    [clearLongPress, getCareerRowKey, isShareBusy, isVerified, shareCareerSnapshot]
  )

  const handleCareerRowPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const start = pointerStartRef.current
      if (!start || start.pointerId !== event.pointerId) {
        return
      }

      const deltaX = event.clientX - start.x
      const deltaY = event.clientY - start.y
      if (Math.hypot(deltaX, deltaY) >= MOVE_CANCEL_THRESHOLD_PX) {
        clearLongPress()
      }
    },
    [clearLongPress]
  )

  const handleCareerRowPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const start = pointerStartRef.current
      if (!start || start.pointerId !== event.pointerId) {
        return
      }
      clearLongPress()
    },
    [clearLongPress]
  )

  const handleCareerRowPointerLeave = useCallback(() => {
    clearLongPress()
  }, [clearLongPress])

  const handleCareerRowPointerCancel = useCallback(() => {
    clearLongPress()
  }, [clearLongPress])

  const handleCareerRowKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, entry: LeaguePlayerCareerEntry) => {
      if (!isVerified || isShareBusy || shareInProgressRef.current) {
        return
      }
      if (event.key !== 'Enter' && event.key !== ' ') {
        return
      }

      event.preventDefault()
      const rowKey = getCareerRowKey(entry)
      setActiveShareRowKey(rowKey)
      void shareCareerSnapshot(entry, rowKey)
    },
    [getCareerRowKey, isShareBusy, isVerified, shareCareerSnapshot]
  )

  useEffect(() => {
    return () => {
      clearLongPress()
    }
  }, [clearLongPress])

  // Новый компактный блок достижений с поддержкой анимации
  const achievementsBlock = useMemo(() => {
    return (
      <section className="profile-section">
        <div className="profile-card">
          <AchievementsGrid />
        </div>
      </section>
    )
  }, [])

  const shouldShowCareerSection = isVerified && (!isCompactLayout || activeSection === 'stats')
  const shouldShowAchievements = !isCompactLayout || activeSection === 'achievements'
  const shouldShowDailyReward = !isCompactLayout || activeSection === 'overview'

  const statusMessage = (() => {
    if (status === 'PENDING') {
      return 'Заявка на подтверждение отправлена. Ожидайте решения администратора.'
    }
    if (status === 'NONE') {
      return 'Подтвердите статус игрока лиги, чтобы открыть персональную статистику.'
    }
    return null
  })()
  const canHideVerifyPrompt = status === 'NONE' && Boolean(statusMessage) && !verifyPromptHidden

  useEffect(() => {
    if (status !== 'NONE') {
      setShowVerifyModal(false)
      setVerifyLoading(false)
      setVerifyError(null)
      updateVerifyPromptHidden(false)
    }
  }, [status, updateVerifyPromptHidden])

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
        body: JSON.stringify({}),
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
        setUser(profile)
      }
      localStorage.removeItem(CACHE_KEY)
      void loadProfile({ skipCache: true })
      setShowVerifyModal(false)
    } catch (err) {
      setVerifyError('Не удалось отправить запрос. Попробуйте позже.')
    } finally {
      setVerifyLoading(false)
    }
  }, [verifyLoading, loadProfile])

  return (
    <div className="profile-container">
      <div className="profile-wrapper">
        <div className="profile-header">
          <div className="profile-hero-card">
            {status === 'NONE' && verifyPromptHidden ? (
              <button
                type="button"
                className="verify-info-toggle"
                onClick={handleShowVerifyPrompt}
                aria-label="Показать подсказку о подтверждении статуса игрока"
              >
                i
              </button>
            ) : null}
            <div className="avatar-section">
              <div className={`profile-avatar-wrapper${rating ? ` rating-border-${rating.currentLevel.toLowerCase()}` : ''}`}>
                {user && user.photoUrl ? (
                  <img
                    src={user.photoUrl}
                    alt={displayName}
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
              <div className="profile-display-name">
                {loading ? 'Загрузка...' : displayName}
              </div>
            </div>

            <div
              className={`profile-info${
                isCompactLayout && activeSection !== 'overview' ? ' hidden-on-compact' : ''
              }`}
            >
              {statusMessage && !(status === 'NONE' && verifyPromptHidden) ? (
                <div className={`profile-status-message status-${status.toLowerCase()}`}>
                  <span>{statusMessage}</span>
                  {canHideVerifyPrompt ? (
                    <button
                      type="button"
                      className="verify-info-hide-btn"
                      onClick={handleHideVerifyPrompt}
                    >
                      Скрыть
                    </button>
                  ) : null}
                </div>
              ) : null}
              {status === 'NONE' && !verifyPromptHidden ? (
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
        </div>

        {isCompactLayout ? (
          <div className="profile-mobile-tabs" role="tablist" aria-label="Разделы профиля">
            <button
              type="button"
              className={activeSection === 'overview' ? 'active' : ''}
              onClick={() => setActiveSection('overview')}
              role="tab"
              aria-selected={activeSection === 'overview'}
            >
              Профиль
            </button>
            {isVerified ? (
              <button
                type="button"
                className={activeSection === 'stats' ? 'active' : ''}
                onClick={() => setActiveSection('stats')}
                role="tab"
                aria-selected={activeSection === 'stats'}
              >
                Карьера
              </button>
            ) : null}
            <button
              type="button"
              className={activeSection === 'achievements' ? 'active' : ''}
              onClick={() => setActiveSection('achievements')}
              role="tab"
              aria-selected={activeSection === 'achievements'}
            >
              Достижения
            </button>
          </div>
        ) : null}

        {shouldShowCareerSection ? (
          <section className="profile-section">
            <div className="profile-card" ref={careerCardRef} aria-busy={isShareBusy}>
              {isShareBusy ? (
                <div className="profile-share-overlay" role="status" aria-live="polite">
                  Готовим изображение…
                </div>
              ) : null}
              <header className="profile-card-header">
                <h2>Карьера игрока</h2>
              </header>
              <div className="profile-table-wrapper">
                {careerRows.length ? (
                  <>
                    <div className="profile-career-scroll">
                      <div className="profile-career-grid" role="table" aria-label="Карьера игрока">
                        <div className="profile-career-row head" role="row">
                          <div className="col-year" role="columnheader">Год</div>
                          <div className="col-club" role="columnheader">Лого</div>
                          <div className="col-stat" role="columnheader">М</div>
                          <div className="col-stat" role="columnheader">ЖК</div>
                          <div className="col-stat" role="columnheader">КК</div>
                          <div className="col-stat" role="columnheader">П</div>
                          <div className="col-stat" role="columnheader">Г</div>
                        </div>
                        {careerRows.map(entry => {
                          const rowKey = getCareerRowKey(entry)
                          const rowClassName = `profile-career-row${activeShareRowKey === rowKey ? ' share-hold' : ''}`
                          return (
                            <div
                              key={rowKey}
                              className={rowClassName}
                              role="row"
                              tabIndex={0}
                              aria-label={`Строка ${renderCareerRange(entry)} ${entry.clubShortName}. Удерживайте, чтобы поделиться.`}
                              onPointerDown={event => handleCareerRowPointerDown(event, entry)}
                              onPointerUp={handleCareerRowPointerUp}
                              onPointerLeave={handleCareerRowPointerLeave}
                              onPointerCancel={handleCareerRowPointerCancel}
                              onPointerMove={handleCareerRowPointerMove}
                              onKeyDown={event => handleCareerRowKeyDown(event, entry)}
                              onContextMenu={event => event.preventDefault()}
                            >
                              <div className="col-year" role="cell">{renderCareerRange(entry)}</div>
                              <div className="col-club" role="cell">
                                {entry.clubLogoUrl ? (
                                  <span
                                    className="career-club-logo"
                                    style={{ backgroundImage: `url(${entry.clubLogoUrl})` }}
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <span className="career-club-logo placeholder" aria-hidden="true">⚽</span>
                                )}
                              </div>
                              <div className="col-stat" role="cell">{entry.matches}</div>
                              <div className="col-stat" role="cell">{entry.yellowCards}</div>
                              <div className="col-stat" role="cell">{entry.redCards}</div>
                              <div className="col-stat" role="cell">{entry.assists}</div>
                              <div className="col-stat" role="cell">{entry.goals}</div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                    <div className="profile-share-hint">
                      Нажмите и удерживайте строку, чтобы поделиться блоком в Telegram.
                    </div>
                  </>
                ) : (
                  <div className="profile-table-placeholder">
                    <p>Записи карьеры появятся после первых сыгранных матчей в подтверждённом статусе игрока.</p>
                  </div>
                )}
              </div>
            </div>
          </section>
        ) : null}

        {shouldShowDailyReward && (
          <DailyRewardCard
            summary={dailyReward}
            loading={dailyRewardLoading}
            error={dailyRewardError}
            onClaim={handleClaimReward}
            claimLoading={claimRewardLoading}
            lastAward={lastReward}
          />
        )}

        {shouldShowAchievements && achievementsBlock}

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

function isLeaguePlayerCareerEntry(value: unknown): value is LeaguePlayerCareerEntry {
  if (!value || typeof value !== 'object') {
    return false
  }
  const record = value as Record<string, unknown>
  const numberOrNull = (candidate: unknown) => candidate === null || typeof candidate === 'number'
  return (
    typeof record.clubId === 'number' &&
    typeof record.clubName === 'string' &&
    typeof record.clubShortName === 'string' &&
    (record.clubLogoUrl === null || typeof record.clubLogoUrl === 'string') &&
    numberOrNull(record.fromYear) &&
    numberOrNull(record.toYear) &&
    typeof record.matches === 'number' &&
    typeof record.assists === 'number' &&
    typeof record.goals === 'number' &&
    typeof record.penaltyGoals === 'number' &&
    typeof record.yellowCards === 'number' &&
    typeof record.redCards === 'number'
  )
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

  const careerRaw = (record as Record<string, unknown>).leaguePlayerCareer
  if (Array.isArray(careerRaw)) {
    const parsed = careerRaw.filter(isLeaguePlayerCareerEntry)
    normalized.leaguePlayerCareer = parsed
  } else if (careerRaw === null) {
    normalized.leaguePlayerCareer = null
  } else {
    normalized.leaguePlayerCareer = []
  }

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

function resolveDevTelegramUser(): DevTelegramUserConfig | null {
  if (!import.meta.env.DEV) {
    return null
  }

  const rawId = import.meta.env.VITE_DEV_TELEGRAM_ID
  if (!rawId) {
    return null
  }

  const numericId = Number(rawId)
  if (!Number.isFinite(numericId) || numericId <= 0) {
    console.warn('[Profile] VITE_DEV_TELEGRAM_ID задан, но имеет недопустимое значение')
    return null
  }

  return {
    id: Math.trunc(numericId),
    firstName: import.meta.env.VITE_DEV_TELEGRAM_FIRST_NAME,
    lastName: import.meta.env.VITE_DEV_TELEGRAM_LAST_NAME,
    username: import.meta.env.VITE_DEV_TELEGRAM_USERNAME,
    photoUrl: import.meta.env.VITE_DEV_TELEGRAM_PHOTO_URL,
  }
}
