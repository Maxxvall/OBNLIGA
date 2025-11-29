import React, { useCallback, useState, useEffect, useRef } from 'react'
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
  bet_wins: {
    0: 'Новичок',
    1: 'Счастливчик',
    2: 'Снайпер',
    3: 'Чемпион',
  },
}

// Группа для отображения
const ACHIEVEMENT_GROUP_LABELS: Record<string, string> = {
  streak: 'Игровая серия',
  predictions: 'Прогнозы',
  credits: 'Очки сезона',
  bet_wins: 'Угаданные прогнозы',
}

// Конфигурация порогов и очков для каждой группы
const ACHIEVEMENT_THRESHOLDS: Record<string, { level: number; threshold: number; points: number }[]> = {
  streak: [
    { level: 1, threshold: 7, points: 20 },
    { level: 2, threshold: 60, points: 200 },
    { level: 3, threshold: 180, points: 1000 },
  ],
  predictions: [
    { level: 1, threshold: 20, points: 20 },
    { level: 2, threshold: 100, points: 200 },
    { level: 3, threshold: 500, points: 1000 },
  ],
  credits: [
    { level: 1, threshold: 200, points: 0 },
    { level: 2, threshold: 1000, points: 0 },
    { level: 3, threshold: 5000, points: 0 },
  ],
  bet_wins: [
    { level: 1, threshold: 10, points: 20 },
    { level: 2, threshold: 50, points: 200 },
    { level: 3, threshold: 200, points: 1000 },
  ],
}

// Функции склонения единиц измерения прогресса
// Правило: 1 день, 2-4 дня, 5-20 дней, 21 день, 22-24 дня и т.д.
function pluralize(n: number, one: string, few: string, many: string): string {
  const absN = Math.abs(n)
  const mod10 = absN % 10
  const mod100 = absN % 100

  if (mod100 >= 11 && mod100 <= 19) {
    return many
  }
  if (mod10 === 1) {
    return one
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return few
  }
  return many
}

function getProgressUnit(group: string, count: number): string {
  switch (group) {
  case 'streak':
    return pluralize(count, 'день подряд', 'дня подряд', 'дней подряд')
  case 'predictions':
    return pluralize(count, 'прогноз', 'прогноза', 'прогнозов')
  case 'credits':
    return pluralize(count, 'очко', 'очка', 'очков')
  case 'bet_wins':
    return pluralize(count, 'угаданный прогноз', 'угаданных прогноза', 'угаданных прогнозов')
  default:
    return ''
  }
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
  {
    achievementId: -4,
    group: 'bet_wins',
    currentLevel: 0,
    currentProgress: 0,
    nextThreshold: 10,
    iconSrc: '/achievements/betwins-locked.png',
    shortTitle: 'Новичок',
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

  console.log('[AchievementsGrid] normalizeAchievementsResult', {
    hasRealData,
    achievementsCount: responseData?.achievements.length ?? 0,
    achievements: responseData?.achievements?.map(a => ({
      group: a.group,
      currentProgress: a.currentProgress,
      nextThreshold: a.nextThreshold,
      currentLevel: a.currentLevel,
    })),
  })

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

// Модальное окно деталей достижения
interface AchievementModalProps {
  achievement: UserAchievementSummaryItem
  onClose: () => void
}

function AchievementModal({ achievement, onClose }: AchievementModalProps) {
  const groupLabel = ACHIEVEMENT_GROUP_LABELS[achievement.group] ?? achievement.group
  const levelName = getAchievementLevelName(achievement.group, achievement.currentLevel)
  const thresholds = ACHIEVEMENT_THRESHOLDS[achievement.group] ?? []
  const maxLevel = thresholds.length

  const isMaxLevel = achievement.currentLevel >= maxLevel
  const nextThreshold = thresholds.find(t => t.level === achievement.currentLevel + 1)
  const remaining = nextThreshold ? nextThreshold.threshold - achievement.currentProgress : 0

  // Единицы измерения с правильным склонением
  const progressUnit = getProgressUnit(achievement.group, achievement.currentProgress)
  const remainingUnit = getProgressUnit(achievement.group, remaining)

  // Закрытие по Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Закрытие по клику на overlay
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  return (
    <div
      className="achievement-modal-overlay"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="achievement-modal-title"
    >
      <div className="achievement-modal">
        <div className="achievement-modal-header">
          <img
            src={achievement.iconSrc ?? '/achievements/streak-locked.png'}
            alt={`${groupLabel} — ${levelName}`}
            className="achievement-modal-icon"
          />
          <h2 id="achievement-modal-title" className="achievement-modal-title">
            {levelName}
          </h2>
          <span className="achievement-modal-group">{groupLabel}</span>
        </div>

        <div className="achievement-modal-status">
          <div className="achievement-modal-status-label">Текущий прогресс</div>
          <div className="achievement-modal-status-value">
            {achievement.currentProgress} {progressUnit}
          </div>
        </div>

        <div className="achievement-modal-next">
          {isMaxLevel
            ? 'Вы достигли максимального уровня!'
            : `До следующего уровня: ${remaining} ${remainingUnit}`}
        </div>

        <div className="achievement-modal-levels">
          <div className="achievement-modal-levels-title">Уровни и награды</div>
          {thresholds.map(t => {
            const tLevelName = getAchievementLevelName(achievement.group, t.level)
            const isCurrent = t.level === achievement.currentLevel
            const isUnlocked = t.level <= achievement.currentLevel
            const thresholdUnit = getProgressUnit(achievement.group, t.threshold)

            return (
              <div key={t.level} className="achievement-modal-level-row">
                <span className={`achievement-modal-level-name ${isCurrent ? 'current' : ''}`}>
                  {isUnlocked ? '✓ ' : ''}{tLevelName}
                </span>
                <span className="achievement-modal-level-threshold">{t.threshold} {thresholdUnit}</span>
                {t.points > 0 && (
                  <span className="achievement-modal-level-points">+{t.points} очков</span>
                )}
              </div>
            )
          })}
        </div>

        <button type="button" className="achievement-modal-close" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>
  )
}

export default function AchievementsGrid({ className }: AchievementsGridProps) {
  const [achievements, setAchievements] = useState<UserAchievementsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [offset, setOffset] = useState(0)
  const [selectedAchievement, setSelectedAchievement] = useState<UserAchievementSummaryItem | null>(null)
  const [celebration, setCelebration] = useState<{
    iconSrc: string
    levelName: string
    points: number
    rewardId: string
  } | null>(null)

  const loadedRef = useRef(false)
  const BATCH_SIZE = 4

  // Загрузка первоначального батча
  useEffect(() => {
    // Предотвращаем двойную загрузку в StrictMode
    if (loadedRef.current) return
    loadedRef.current = true

    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        // force: true — всегда делаем запрос к серверу (но с ETag для 304)
        const result = await fetchMyAchievementsPaginated({
          limit: BATCH_SIZE,
          offset: 0,
          summary: true,
          force: true,
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
      // Сбрасываем ref при размонтировании, чтобы при следующем монтировании загрузка произошла
      loadedRef.current = false
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

  // Клик по карточке достижения — открываем модальное окно
  const handleCardClick = useCallback((achievement: UserAchievementSummaryItem) => {
    setSelectedAchievement(achievement)
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

      {selectedAchievement && (
        <AchievementModal
          achievement={selectedAchievement}
          onClose={() => setSelectedAchievement(null)}
        />
      )}
    </div>
  )
}
