import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  UserRatingSummary,
  UserAchievementsSummary,
  DailyRewardSummary,
  DailyRewardClaimResponse,
} from '@shared/types'
import { fetchMyRating } from './api/ratingsApi'
import { fetchMyAchievements, invalidateAchievementsCache } from './api/achievementsApi'
import { fetchDailyRewardSummary, claimDailyReward } from './api/dailyRewardApi'
import DailyRewardCard from './components/DailyRewardCard'
import AchievementsGrid from './components/AchievementsGrid'
import NotificationSettings from './components/NotificationSettings'
import { useAppStore } from './store/appStore'
import { buildApiUrl } from './api/httpClient'
import './profile.css'
import {
  type LeaguePlayerCareerEntry,
  type LeaguePlayerStatus,
} from './types/profileUser'

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
  shareToTelegram?: (content: TelegramShareContent) => Promise<void>
  showAlert?: (message: string) => void
}

interface TelegramWindow extends Window {
  Telegram?: {
    WebApp?: TelegramWebApp
  }
}

const LONG_PRESS_DELAY_MS = 650
const MOVE_CANCEL_THRESHOLD_PX = 18
const SHARE_PIXEL_RATIO_LIMIT = 2.5
const MIN_SHARE_PIXEL_RATIO = 1.6

const PROFILE_REFRESH_INTERVAL_MS = 90_000
const VERIFY_PROMPT_STORAGE_KEY = 'profile_verify_prompt_hidden'
const isLeagueStatus = (value: unknown): value is LeaguePlayerStatus =>
  value === 'NONE' || value === 'PENDING' || value === 'VERIFIED'

type ProfileSection = 'overview' | 'stats' | 'achievements' | 'settings'

export default function Profile() {
  const authUser = useAppStore(state => state.authUser)
  const authLoading = useAppStore(state => state.authLoading)
  const refreshAuthProfile = useAppStore(state => state.refreshAuthProfile)

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
  const careerCardRef = useRef<HTMLDivElement | null>(null)
  const [activeShareRowKey, setActiveShareRowKey] = useState<string | null>(null)
  const [isShareBusy, setIsShareBusy] = useState(false)
  const longPressTimeoutRef = useRef<number | null>(null)
  const pointerStartRef = useRef<{ x: number; y: number; pointerId: number } | null>(null)
  const pressEntryRef = useRef<LeaguePlayerCareerEntry | null>(null)
  const shareInProgressRef = useRef(false)

  const isProfileLoading = authLoading && !authUser

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

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
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
      void refreshAuthProfile()
    }

    const timer = window.setInterval(tick, PROFILE_REFRESH_INTERVAL_MS)
    tick()
    return () => {
      window.clearInterval(timer)
      if (typeof media.removeEventListener === 'function') {
        media.removeEventListener('change', handleMediaChange)
      } else {
        media.removeListener(handleMediaChange)
      }
    }
  }, [refreshAuthProfile])

  useEffect(() => {
    if (!isCompactLayout && activeSection !== 'overview') {
      setActiveSection('overview')
    }
  }, [isCompactLayout, activeSection])

  // Загрузка рейтинга пользователя
  useEffect(() => {
    if (!authUser) {
      setRating(null)
      return
    }

    void (async () => {
      const result = await fetchMyRating()
      if (result.ok) {
        setRating(result.data)
      }
    })()
  }, [authUser])

  // Загрузка достижений пользователя
  useEffect(() => {
    if (!authUser) {
      setAchievements(null)
      return
    }

    void (async () => {
      const result = await fetchMyAchievements({ force: true })
      if (result.data) {
        setAchievements(result.data)
      }
    })()
  }, [authUser])

  useEffect(() => {
    if (!authUser) {
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
  }, [authUser])

  const status: LeaguePlayerStatus = (() => {
    const candidate = authUser?.leaguePlayerStatus
    if (isLeagueStatus(candidate)) {
      return candidate
    }
    return 'NONE'
  })()
  const isVerified = status === 'VERIFIED'
  const displayName = authUser?.firstName?.trim()?.length
    ? String(authUser.firstName)
    : authUser?.username?.trim()?.length
      ? String(authUser.username)
      : 'Гость'

  const careerRows = useMemo(() => {
    if (!isVerified) {
      return []
    }
    if (Array.isArray(authUser?.leaguePlayerCareer)) {
      return authUser.leaguePlayerCareer
    }
    return []
  }, [isVerified, authUser?.leaguePlayerCareer])

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

      // Инвалидируем кэш достижений, чтобы AchievementsGrid получил актуальные данные
      invalidateAchievementsCache()

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

        // Даём UI время обновиться перед захватом
        await new Promise(resolve => setTimeout(resolve, 150))

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

        let delivered = false
        const telegram = (window as TelegramWindow).Telegram?.WebApp

        if (telegram && typeof telegram.shareToTelegram === 'function') {
          try {
            // Конвертируем blob в base64 для Telegram Web App API
            const base64Data = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onloadend = () => resolve(reader.result as string)
              reader.onerror = reject
              reader.readAsDataURL(blob)
            })

            await telegram.shareToTelegram({
              text: shareText,
              media: [{ type: 'photo', media: base64Data, caption: shareText }],
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
            const shareFile = new File([blob], fileName, { type: 'image/png' })
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

        // Попытка сохранения в буфер обмена (важный fallback для мобильных)
        if (!delivered && typeof navigator !== 'undefined' && 'clipboard' in navigator) {
          try {
            const clipboardItem = new ClipboardItem({ 'image/png': blob })
            await navigator.clipboard.write([clipboardItem])
            showShareAlert('Изображение скопировано в буфер обмена. Вставьте его в чат Telegram.')
            delivered = true
          } catch (error) {
            console.error('[Profile] clipboard.write failed:', error)
          }
        }

        // Последний fallback — скачивание файла
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
            showShareAlert('Снимок сохранён. Найдите его в папке загрузок и отправьте в Telegram.')
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
  const shouldShowSettings = !isCompactLayout || activeSection === 'settings'

  const statusMessage = (() => {
    if (status === 'NONE') {
      return 'Подтвердите статус игрока лиги, чтобы открыть персональную статистику.'
    }
    return null
  })()

  useEffect(() => {
    // Сбрасываем состояние модалки при изменении статуса
    if (status !== 'NONE') {
      setShowVerifyModal(false)
      setVerifyLoading(false)
      setVerifyError(null)
    }
    // Сбрасываем скрытие подсказки только при подтверждении
    if (status === 'VERIFIED') {
      updateVerifyPromptHidden(false)
    }
  }, [status, updateVerifyPromptHidden])

  const submitVerificationRequest = useCallback(async () => {
    if (verifyLoading) return

    setVerifyLoading(true)
    setVerifyError(null)

    try {
      const response = await fetch(buildApiUrl('/api/users/league-player/request'), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
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

      await refreshAuthProfile({ force: true })
      setShowVerifyModal(false)
    } catch (err) {
      setVerifyError('Не удалось отправить запрос. Попробуйте позже.')
    } finally {
      setVerifyLoading(false)
    }
  }, [verifyLoading, refreshAuthProfile])

  return (
    <div className="profile-container">
      <div className="profile-wrapper">
        <div className="profile-header">
          <div className="profile-hero-card">
            {(status === 'NONE' || status === 'PENDING') && verifyPromptHidden ? (
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
                {authUser && authUser.photoUrl ? (
                  <img
                    src={authUser.photoUrl}
                    alt={displayName}
                    className="profile-avatar"
                  />
                ) : (
                  <div className="profile-avatar placeholder">{isProfileLoading ? '⏳' : '👤'}</div>
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
                {isProfileLoading ? 'Загрузка...' : displayName}
              </div>
            </div>

            {/* Блок profile-info показывается только если есть что отображать */}
            {((status === 'NONE' && !verifyPromptHidden) || (status === 'PENDING' && !verifyPromptHidden)) ? (
              <div
                className={`profile-info${
                  isCompactLayout && activeSection !== 'overview' ? ' hidden-on-compact' : ''
                }`}
              >
                {status === 'NONE' ? (
                  <>
                    <div className="profile-status-message status-none">
                      <span>{statusMessage}</span>
                      <button
                        type="button"
                        className="verify-info-hide-btn"
                        onClick={handleHideVerifyPrompt}
                      >
                        Скрыть
                      </button>
                    </div>
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
                  </>
                ) : null}
                {status === 'PENDING' ? (
                  <div className="verification-note">
                    <span>Запрос отправлен. Мы сообщим, когда администратор подтвердит статус.</span>
                    <button
                      type="button"
                      className="verify-info-hide-btn"
                      onClick={handleHideVerifyPrompt}
                    >
                      Скрыть
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
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
            <button
              type="button"
              className={activeSection === 'settings' ? 'active' : ''}
              onClick={() => setActiveSection('settings')}
              role="tab"
              aria-selected={activeSection === 'settings'}
            >
              ⚙️
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

        {shouldShowSettings && (
          <section className="profile-section">
            <div className="profile-card">
              <NotificationSettings />
            </div>
          </section>
        )}

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
