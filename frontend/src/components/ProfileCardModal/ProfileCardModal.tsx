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
            <span className="player-stat-icon">⚽</span>
            <span className="player-stat-value">{formatNumber(leaguePlayer.stats.totalGoals)}</span>
            <span className="player-stat-label">голов</span>
          </div>
          <div className="player-stat-item">
            <span className="player-stat-icon">👟</span>
            <span className="player-stat-value">{formatNumber(leaguePlayer.stats.totalAssists)}</span>
            <span className="player-stat-label">передач</span>
          </div>
          <div className="player-stat-item">
            <span className="player-stat-icon">🏟️</span>
            <span className="player-stat-value">{formatNumber(leaguePlayer.stats.totalMatches)}</span>
            <span className="player-stat-label">матчей</span>
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
          ) : extra ? (
            <div className="profile-card-achievement-count">
              <span className="achievement-icon">🏆</span>
              <span className="achievement-value">{formatNumber(extra.achievementCount)}</span>
              <span className="achievement-label">достижений</span>
            </div>
          ) : (
            <div className="profile-card-placeholder">Нет данных</div>
          )}
        </section>

        {renderLeagueBlock()}
      </div>
    </div>
  )
}

export default ProfileCardModal
