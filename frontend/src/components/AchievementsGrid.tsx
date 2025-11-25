import React, { useCallback, useState, useEffect } from 'react'
import type { UserAchievementSummaryItem, UserAchievementsResponse } from '@shared/types'
import { fetchMyAchievementsPaginated, markRewardNotified, invalidateAchievementsCache } from '../api/achievementsApi'
import AchievementCelebration from './AchievementCelebration'
import './AchievementsGrid.css'

interface AchievementsGridProps {
  className?: string
}

// Конфигурация названий уровней для streak
const STREAK_LEVEL_NAMES: Record<number, string> = {
  0: 'Скамейка',
  1: 'Запасной',
  2: 'Основной',
  3: 'Капитан',
}

export default function AchievementsGrid({ className }: AchievementsGridProps) {
  const [achievements, setAchievements] = useState<UserAchievementsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [offset, setOffset] = useState(0)
  const [celebration, setCelebration] = useState<{
    iconSrc: string
    levelName: string
    points: number
    rewardId: string
  } | null>(null)

  const BATCH_SIZE = 4

  // Загрузка первоначального батча
  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const result = await fetchMyAchievementsPaginated({
          limit: BATCH_SIZE,
          offset: 0,
          summary: true,
        })

        if (!cancelled) {
          setAchievements(result.data)
          setOffset(BATCH_SIZE)

          // Проверяем, есть ли награды для анимации
          const rewardToAnimate = result.data.achievements.find(
            a => a.shouldPlayAnimation && a.animationRewardId
          )
          if (rewardToAnimate) {
            setCelebration({
              iconSrc: rewardToAnimate.iconSrc ?? '/achievements/streak-locked.png',
              levelName: rewardToAnimate.shortTitle,
              points: rewardToAnimate.animationPoints ?? 0,
              rewardId: rewardToAnimate.animationRewardId ?? '',
            })
          }
        }
      } catch (err) {
        console.error('Failed to load achievements:', err)
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [])

  // Загрузка следующего батча
  const loadMore = useCallback(async () => {
    if (!achievements?.hasMore || loadingMore) return

    setLoadingMore(true)
    try {
      const result = await fetchMyAchievementsPaginated({
        limit: BATCH_SIZE,
        offset,
        summary: true,
      })

      setAchievements(prev => {
        if (!prev) return result.data
        return {
          ...result.data,
          achievements: [...prev.achievements, ...result.data.achievements],
        }
      })
      setOffset(o => o + BATCH_SIZE)
    } catch (err) {
      console.error('Failed to load more achievements:', err)
    } finally {
      setLoadingMore(false)
    }
  }, [achievements?.hasMore, loadingMore, offset])

  // Обработка закрытия анимации
  const handleCelebrationClose = useCallback(async () => {
    if (celebration?.rewardId) {
      await markRewardNotified(celebration.rewardId)
      invalidateAchievementsCache()
    }
    setCelebration(null)
  }, [celebration])

  // Клик по карточке достижения (будущий modal)
  const handleCardClick = useCallback((achievement: UserAchievementSummaryItem) => {
    // TODO: Открыть модальное окно с деталями достижения
    console.log('Achievement clicked:', achievement.achievementId)
  }, [])

  if (loading) {
    return (
      <div className={`achievements-grid-container ${className ?? ''}`}>
        <div className="achievements-skeleton">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="achievement-skeleton-card" />
          ))}
        </div>
      </div>
    )
  }

  if (!achievements || achievements.achievements.length === 0) {
    return (
      <div className={`achievements-grid-container ${className ?? ''}`}>
        <div className="achievements-empty">
          <p>Достижения появятся по мере участия в прогнозах и активности.</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`achievements-grid-container ${className ?? ''}`}>
      {celebration && (
        <AchievementCelebration
          iconSrc={celebration.iconSrc}
          levelName={celebration.levelName}
          points={celebration.points}
          onClose={handleCelebrationClose}
        />
      )}

      <div className="achievements-grid">
        {achievements.achievements.map(achievement => {
          const progress = achievement.nextThreshold > 0
            ? Math.min(100, Math.round((achievement.currentProgress / achievement.nextThreshold) * 100))
            : 100
          const levelName = STREAK_LEVEL_NAMES[achievement.currentLevel] ?? achievement.shortTitle

          return (
            <div
              key={achievement.achievementId}
              className="achievement-card-compact"
              role="button"
              tabIndex={0}
              onClick={() => handleCardClick(achievement)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleCardClick(achievement)
                }
              }}
              aria-label={`Игровая серия — ${levelName}`}
            >
              <div className="achievement-icon-wrapper">
                <img
                  src={achievement.iconSrc ?? '/achievements/streak-locked.png'}
                  alt={`Игровая серия — ${levelName}`}
                  width={40}
                  height={40}
                  className="achievement-icon"
                  loading="lazy"
                />
              </div>

              <div className="achievement-progress-wrapper">
                <div className="achievement-progress-bar">
                  <div
                    className="achievement-progress-fill"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              <div className="achievement-level-label">{levelName}</div>
            </div>
          )
        })}
      </div>

      {achievements.hasMore && (
        <button
          type="button"
          className="achievements-load-more"
          onClick={loadMore}
          disabled={loadingMore}
        >
          {loadingMore ? 'Загрузка...' : 'Ещё'}
        </button>
      )}

      <div className="achievements-summary">
        <span>{achievements.totalUnlocked} разблокировано</span>
      </div>
    </div>
  )
}
