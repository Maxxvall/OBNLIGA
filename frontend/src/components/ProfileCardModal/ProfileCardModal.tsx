import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { RatingLeaderboardEntryView, UserCardExtraView } from '@shared/types'
import { fetchUserCardExtra } from '../../api/userCardApi'
import ProfileCardSkeleton from './ProfileCardSkeleton'
import './ProfileCardModal.css'

export type ProfileCardModalProps = {
  isOpen: boolean
  onClose: () => void
  initialData: RatingLeaderboardEntryView | null
  position?: { x: number; y: number } | null
}

const formatPercent = (value: number) => {
  const safe = Math.min(1, Math.max(0, value))
  return `${Math.round(safe * 100)}%`
}

const formatNumber = (value: number) => new Intl.NumberFormat('ru-RU').format(value)

type AchievementBadge = UserCardExtraView['achievementBadges'][number]

// Локальные подписи уровней для групп достижений (кириллица без mojibake)
const ACHIEVEMENT_LEVEL_NAMES: Record<string, Record<number, string>> = {
  streak: {
    0: 'Скамейка',
    1: 'Запасной',
    2: 'Основной',
    3: 'Капитан',
  },
  predictions: {
    0: 'Новичок',
    1: 'Любитель',
    2: 'Знаток',
    3: 'Эксперт',
  },
  credits: {
    0: 'Дебютант',
    1: 'Форвард',
    2: 'Голеадор',
    3: 'Легенда',
  },
  bet_wins: {
    0: 'Новичок',
    1: 'Счастливчик',
    2: 'Снайпер',
    3: 'Чемпион',
  },
  prediction_streak: {
    0: 'Новичок',
    1: 'Искра точности',
    2: 'Пламя прогноза',
    3: 'Вспышка чемпиона',
  },
  express_wins: {
    0: 'Новичок',
    1: 'Экспресс-профи',
    2: 'Экспресс-мастер',
    3: 'Экспресс-легенда',
  },
  broadcast_watch: {
    0: 'Новичок',
    1: 'Зритель',
    2: 'Фанат трансляций',
    3: 'Постоянный зритель',
  },
  broadcast_comments: {
    0: 'Тихий зритель',
    1: 'Голос эфира',
    2: 'Драйвер чата',
    3: 'Комментатор',
  },
  express_created: {
    0: 'Новичок комбинирования',
    1: 'Сборщик купонов',
    2: 'Комбо-инженер',
    3: 'Маэстро экспрессов',
  },
  total_goals: {
    0: 'Новичок тоталов',
    1: 'Ловец тоталов',
    2: 'Стратег тоталов',
    3: 'Оракул тоталов',
  },
  shop_orders: {
    0: 'Посетитель витрины',
    1: 'Коллекционер мерча',
    2: 'Хранитель коллекции',
    3: 'Повелитель мерча',
  },
}

const BADGE_ICON_FALLBACKS: Record<string, Record<number, string>> = {
  streak: {
    0: '/achievements/streak-locked.webp',
    1: '/achievements/streak-bronze.webp',
    2: '/achievements/streak-silver.webp',
    3: '/achievements/streak-gold.webp',
  },
  predictions: {
    0: '/achievements/betcount-locked.webp',
    1: '/achievements/betcount-bronze.webp',
    2: '/achievements/betcount-silver.webp',
    3: '/achievements/betcount-gold.webp',
  },
  credits: {
    0: '/achievements/credits-locked.webp',
    1: '/achievements/credits-bronze.webp',
    2: '/achievements/credits-silver.webp',
    3: '/achievements/credits-gold.webp',
  },
  bet_wins: {
    0: '/achievements/betwins-locked.webp',
    1: '/achievements/betwins-bronze.webp',
    2: '/achievements/betwins-silver.webp',
    3: '/achievements/betwins-gold.webp',
  },
  prediction_streak: {
    0: '/achievements/prediction-streak-locked.webp',
    1: '/achievements/prediction-streak-bronze.webp',
    2: '/achievements/prediction-streak-silver.webp',
    3: '/achievements/prediction-streak-gold.webp',
  },
  express_wins: {
    0: '/achievements/express-locked.webp',
    1: '/achievements/express-bronze.webp',
    2: '/achievements/express-silver.webp',
    3: '/achievements/express-gold.webp',
  },
  broadcast_watch: {
    0: '/achievements/broadcast-locked.webp',
    1: '/achievements/broadcast-bronze.webp',
    2: '/achievements/broadcast-silver.webp',
    3: '/achievements/broadcast-gold.webp',
  },
}

const getLevelLabel = (group: string, level: number): string | null => {
  const groupLabels = ACHIEVEMENT_LEVEL_NAMES[group]
  if (!groupLabels) return null
  return groupLabels[level] ?? null
}

const resolveBadgeIcon = (badge: AchievementBadge): string => {
  const groupIcons = BADGE_ICON_FALLBACKS[badge.group]
  if (badge.iconUrl && badge.iconUrl.length > 0) {
    // Если в БД лежат старые пути (.png или .svg), попробуем подставить .webp
    const lower = badge.iconUrl.toLowerCase()
    if (lower.endsWith('.png') || lower.endsWith('.svg')) {
      return badge.iconUrl.replace(/\.(png|svg)$/i, '.webp')
    }
    return badge.iconUrl
  }
  if (groupIcons) {
    return groupIcons[badge.level] ?? groupIcons[0] ?? '/achievements/streak-locked.webp'
  }
  return '/achievements/streak-locked.webp'
}

export function ProfileCardModal({ isOpen, onClose, initialData, position }: ProfileCardModalProps) {
  const [extra, setExtra] = useState<UserCardExtraView | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  const userId = initialData?.userId

  useEffect(() => {
    if (!isOpen || !userId) {
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchUserCardExtra(userId)
      .then((result) => {
        if (cancelled) return
        if (result.ok) {
          setExtra(result.data)
        } else {
          setError(result.error)
          setExtra(null)
        }
      })
      .catch(() => {
        if (cancelled) return
        setError('load_failed')
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [isOpen, userId])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (evt: KeyboardEvent) => {
      if (evt.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  const levelClass = useMemo(() => {
    if (!initialData) return 'level-bronze'
    return `level-${initialData.currentLevel.toLowerCase()}`
  }, [initialData])

  if (!isOpen || !initialData) {
    return null
  }

  const accuracyLabel = formatPercent(initialData.predictionAccuracy)
  const streakLabel = `${initialData.currentStreak} / макс: ${initialData.maxStreak}`
  const achievementBadges = extra?.achievementBadges ?? []
  const positionStyle = position
    ? ({
      '--card-x': `${position.x}px`,
      '--card-y': `${position.y}px`,
    } as React.CSSProperties)
    : undefined

  const renderLeagueBlock = () => {
    if (loading) return <ProfileCardSkeleton />
    if (error) return <div className="profile-card-error">Не удалось загрузить данные профиля</div>
    if (!extra?.leaguePlayer) return null

    const { leaguePlayer } = extra
    const clubs = leaguePlayer.clubs || []

    return (
      <section className="profile-card-player">
        <div className="profile-card-section-title">Карьера игрока</div>
        <div className="profile-card-player-stats">
          <div className="player-stat-item">
            <span className="player-stat-icon">🏟️</span>
            <span className="player-stat-value">{formatNumber(leaguePlayer.stats.totalMatches)}</span>
          </div>
          <div className="player-stat-item">
            <span className="player-stat-icon">⚽</span>
            <span className="player-stat-value">{formatNumber(leaguePlayer.stats.totalGoals)}</span>
          </div>
          <div className="player-stat-item">
            <span className="player-stat-icon">👟</span>
            <span className="player-stat-value">{formatNumber(leaguePlayer.stats.totalAssists)}</span>
          </div>
          <div className="player-stat-item">
            <span className="player-stat-icon yellow">▬</span>
            <span className="player-stat-value">{formatNumber(leaguePlayer.stats.yellowCards)}</span>
          </div>
          <div className="player-stat-item">
            <span className="player-stat-icon red">▬</span>
            <span className="player-stat-value">{formatNumber(leaguePlayer.stats.redCards)}</span>
          </div>
        </div>
        {clubs.length > 0 && (
          <div className="profile-card-clubs">
            {clubs.map((club) => (
              <div key={club.id} className="profile-card-club-item">
                {club.logoUrl ? (
                  <img src={club.logoUrl} alt="" className="club-logo" loading="lazy" />
                ) : (
                  <div className="club-logo-placeholder" aria-hidden="true" />
                )}
                <span className="club-name">{club.name}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    )
  }

  // Попытка исправить Mojibake (неправильную декодировку кириллицы)
  const fixMojibake = (s: string | undefined | null): string | undefined => {
    if (!s) return s
    try {
      // старый кросс-браузерный трюк: treat string as Latin1 bytes and decode as UTF-8
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore - escape/decodeURIComponent доступны в среде браузера
      return decodeURIComponent(escape(s))
    } catch (e) {
      return s
    }
  }

  return (
    <div className="profile-card-overlay" onClick={onClose}>
      <div
        className={`profile-card-wrapper ${levelClass}`}
        style={positionStyle}
        ref={wrapperRef}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="profile-card-header">
          <div className="profile-card-avatar-wrapper">
            {initialData.photoUrl ? (
              <img src={initialData.photoUrl} alt="" className="profile-card-avatar" loading="lazy" />
            ) : (
              <div className="profile-card-avatar placeholder" aria-hidden="true">
                {initialData.displayName.slice(0, 2).toUpperCase()}
              </div>
            )}
            {extra?.leaguePlayer ? <span className="profile-card-verified">✔</span> : null}
          </div>
          <div className="profile-card-identity">
            <div className="profile-card-name-row">
              <span className="profile-card-name">{initialData.displayName}</span>
            </div>
            <div className="profile-card-level">
              <span className="level-badge">{initialData.currentLevel}</span>
              {initialData.mythicRank ? <span className="level-rank">#{initialData.mythicRank}</span> : null}
            </div>
            <div className="profile-card-joined">
              {extra?.registrationDate
                ? new Date(extra.registrationDate).toLocaleDateString('ru-RU')
                : 'Регистрация неизвестна'}
            </div>
          </div>
          <button type="button" className="profile-card-close" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </header>

        <section className="profile-card-stats">
          <div className="stat-item">
            <span className="stat-label">Прогнозов</span>
            <span className="stat-value">{formatNumber(initialData.predictionCount)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Побед</span>
            <span className="stat-value">{formatNumber(initialData.predictionWins)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Точность</span>
            <span className="stat-value">{accuracyLabel}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Серии</span>
            <span className="stat-value">{streakLabel}</span>
          </div>
        </section>

        <section className="profile-card-achievements">
          <div className="profile-card-section-title">Достижения</div>
          {loading ? (
            <ProfileCardSkeleton />
          ) : error ? (
            <div className="profile-card-error">Не удалось загрузить данные профиля</div>
          ) : achievementBadges.length ? (
            <div
              className="profile-card-achievement-badges"
              aria-label={`Открытые достижения: ${formatNumber(achievementBadges.length)}`}
              role="list"
            >
              {achievementBadges.slice(0, 10).map(badge => {
                const rawTitle = badge.title ?? 'Достижение'
                const decodedTitle = fixMojibake(rawTitle) ?? rawTitle
                const levelLabel = getLevelLabel(badge.group, badge.level)
                const title = decodedTitle || levelLabel || 'Достижение'
                const initialSrc = resolveBadgeIcon(badge)
                const tooltip = levelLabel ? `${title} · ${levelLabel}` : `${title} · уровень ${badge.level}`
                return (
                  <div
                    key={`${badge.achievementId}-${badge.level}`}
                    className="profile-card-badge"
                    role="listitem"
                    title={tooltip}
                  >
                    <img
                      src={initialSrc}
                      alt={`${title}, уровень ${badge.level}`}
                      loading="lazy"
                      draggable={false}
                      onContextMenu={event => event.preventDefault()}
                      onError={(e) => {
                        const img = e.currentTarget as HTMLImageElement
                        // Попытаться подменить на известный фолбэк только один раз
                        if (img.dataset.tried !== '1') {
                          img.dataset.tried = '1'
                          const groupIcons = BADGE_ICON_FALLBACKS[badge.group]
                          if (groupIcons) {
                            img.src = groupIcons[badge.level] ?? groupIcons[0]
                          } else {
                            img.src = '/achievements/streak-locked.webp'
                          }
                        } else {
                          img.src = '/achievements/streak-locked.webp'
                        }
                      }}
                    />
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="profile-card-placeholder">Достижения пока не открыты</div>
          )}
        </section>

        {renderLeagueBlock()}
      </div>
    </div>
  )
}

export default ProfileCardModal
