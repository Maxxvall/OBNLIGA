import React, { useEffect, useState } from 'react'
import type { DailyRewardClaimResponse, DailyRewardDayView, DailyRewardSummary } from '@shared/types'

interface DailyRewardCardProps {
  summary: DailyRewardSummary | null
  loading: boolean
  error?: string | null
  onClaim: () => void
  claimLoading: boolean
  lastAward?: DailyRewardClaimResponse['awarded'] | null
}

const dayStatusClass = (status: DailyRewardDayView['status']) => {
  switch (status) {
  case 'claimed':
    return 'claimed'
  case 'claimable':
    return 'claimable'
  case 'cooldown':
    return 'cooldown'
  default:
    return 'locked'
  }
}

export const DailyRewardCard: React.FC<DailyRewardCardProps> = ({
  summary,
  loading,
  error,
  onClaim,
  claimLoading,
  lastAward,
}) => {
  const [animatingDay, setAnimatingDay] = useState<number | null>(null)

  useEffect(() => {
    if (!lastAward) {
      return undefined
    }
    setAnimatingDay(lastAward.day)
    const timer = window.setTimeout(() => setAnimatingDay(null), 1400)
    return () => window.clearTimeout(timer)
  }, [lastAward])

  const handleClaim = () => {
    if (claimLoading || loading || !summary?.claimAvailable) {
      return
    }
    onClaim()
  }

  const renderTrack = () => {
    if (loading) {
      return <div className="daily-reward-track skeleton" />
    }
    if (!summary) {
      return <div className="daily-reward-empty">Авторизуйтесь, чтобы получать ежедневные награды.</div>
    }
    return (
      <div className="daily-reward-track">
        {summary.days.map(day => {
          const className = [
            'daily-reward-day',
            dayStatusClass(day.status),
            animatingDay === day.day ? 'animate' : '',
          ]
            .filter(Boolean)
            .join(' ')
          const gradientStyle =
            day.gradient &&
            (day.status === 'claimable' || day.status === 'claimed' || day.status === 'cooldown')
              ? {
                backgroundImage: `linear-gradient(135deg, ${day.gradient[0]}, ${day.gradient[1]})`,
              }
              : undefined
          return (
            <div
              key={day.day}
              className={className}
              style={gradientStyle}
              data-day={day.day}
              aria-label={`День ${day.day}: +${day.points} очков`}
            >
              <span className="day-index">{day.day}</span>
              <span className="day-points">+{day.points}</span>
            </div>
          )
        })}
      </div>
    )
  }

  const metaMessage = summary
    ? summary.message ?? 'Награда доступна каждый день'
    : error ?? 'Ежедневные награды недоступны'

  return (
    <section className="daily-reward-card" aria-busy={loading}>
      <header className="daily-reward-header">
        <div>
          <p className="daily-reward-title">Ежедневные награды</p>
        </div>
        <div className="daily-reward-message" role="status">
          {metaMessage}
        </div>
      </header>

      {renderTrack()}

      <footer className="daily-reward-footer">
        <button
          type="button"
          className="daily-reward-button"
          disabled={!summary?.claimAvailable || claimLoading || loading}
          onClick={handleClaim}
        >
          {claimLoading ? 'Начисляем…' : summary ? `Получить награду +${summary.pendingPoints}` : 'Недоступно'}
        </button>
        <div className="daily-reward-meta">
          {!summary ? <span>Войдите, чтобы накапливать очки и держать стрик.</span> : null}
        </div>
        {lastAward ? (
          <div className="daily-reward-award">+{lastAward.points} очков начислено за день {lastAward.day}</div>
        ) : null}
      </footer>
    </section>
  )
}

export default DailyRewardCard
