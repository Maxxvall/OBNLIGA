import React, { useCallback, useState, useEffect } from 'react'
import type { UserAchievementSummaryItem, UserAchievementsResponse } from '@shared/types'
import type { AchievementsResult } from '../api/achievementsApi'
import { fetchMyAchievementsPaginated, markRewardNotified, invalidateAchievementsCache } from '../api/achievementsApi'
import AchievementCelebration from './AchievementCelebration'
import './AchievementsGrid.css'

interface AchievementsGridProps {
  className?: string
}

// Конфигурация названий уровней для достижений
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
}

// Группа для отображения
const ACHIEVEMENT_GROUP_LABELS: Record<string, string> = {
  streak: 'Серия',
  predictions: 'Прогнозы',
  credits: 'Очки сезона',
}

const DEFAULT_ACHIEVEMENTS: UserAchievementSummaryItem[] = [
  {
    achievementId: -1,
    group: 'streak',
    currentLevel: 0,
    currentProgress: 0,
    nextThreshold: 7,
    iconSrc: '/achievements/streak-locked.png',
    shortTitle: 'Скамейка',
    shouldPlayAnimation: false,
    animationRewardId: null,
    animationPoints: null,
  },
  {
    achievementId: -2,
    group: 'predictions',
    currentLevel: 0,
    currentProgress: 0,
    nextThreshold: 20,
    iconSrc: '/achievements/betcount-locked.png',
    shortTitle: 'Новичок',
    shouldPlayAnimation: false,
    animationRewardId: null,
    animationPoints: null,
  },
  {
    achievementId: -3,
    group: 'credits',
    currentLevel: 0,
    currentProgress: 0,
    nextThreshold: 200,
    iconSrc: '/achievements/credits-locked.png',
    shortTitle: 'Дебютант',
    shouldPlayAnimation: false,
    animationRewardId: null,
    animationPoints: null,
  },
]

function createDefaultAchievementsResponse(timestamp?: string): UserAchievementsResponse {
  return {
    achievements: DEFAULT_ACHIEVEMENTS,
    total: DEFAULT_ACHIEVEMENTS.length,
    hasMore: false,
    totalUnlocked: 0,
    generatedAt: timestamp ?? new Date().toISOString(),
  }
}

function normalizeAchievementsResult(result?: AchievementsResult) {
  const responseData = result?.data
  const hasRealData = Boolean(responseData?.achievements.length)

  return {
    response:
      hasRealData && responseData
        ? responseData
        : createDefaultAchievementsResponse(responseData?.generatedAt),
    hasRealData,
  }
}

function getAchievementLevelName(group: string, level: number): string {
  return ACHIEVEMENT_LEVEL_NAMES[group]?.[level] ?? `Уровень ${level}`
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
          const { response, hasRealData } = normalizeAchievementsResult(result)

          setAchievements(response)
          setOffset(response.achievements.length)

          if (hasRealData && result?.data) {
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
        }
      } catch (err) {
        console.error('Failed to load achievements:', err)
        if (!cancelled) {
          const { response } = normalizeAchievementsResult()
          setAchievements(response)
          setOffset(response.achievements.length)
        }
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

      if (!result?.data) {
        return
      }

      setAchievements(prev => {
        if (!prev) return result.data
        return {
          ...result.data,
          achievements: [...prev.achievements, ...result.data.achievements],
        }
      })
      setOffset(o => o + result.data.achievements.length)
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
          const levelName = getAchievementLevelName(achievement.group, achievement.currentLevel)
          const groupLabel = ACHIEVEMENT_GROUP_LABELS[achievement.group] ?? achievement.group
          const progressText = `${achievement.currentProgress} / ${achievement.nextThreshold}`

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
              aria-label={`${groupLabel} — ${levelName}`}
            >
              <div className="achievement-icon-wrapper">
                <img
                  src={achievement.iconSrc ?? '/achievements/streak-locked.png'}
                  alt={`${groupLabel} — ${levelName}`}
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
                <div className="achievement-progress-text">{progressText}</div>
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
