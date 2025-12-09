import React, { useCallback, useState, useEffect, useRef } from 'react'
import type { UserAchievementSummaryItem, UserAchievementsResponse } from '@shared/types'
import type { AchievementsResult } from '../api/achievementsApi'
import { fetchMyAchievementsPaginated, markRewardNotified, invalidateAchievementsCache } from '../api/achievementsApi'
import AchievementCelebration from './AchievementCelebration'
import './AchievementsGrid.css'

const LOCAL_NOTIFIED_STORAGE_KEY = 'achievements:notifiedRewards'

function getLocallyNotifiedRewards(): Set<string> {
  try {
    if (typeof window === 'undefined') return new Set()
    const raw = window.localStorage.getItem(LOCAL_NOTIFIED_STORAGE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.map(String))
  } catch {
    return new Set()
  }
}

function saveLocallyNotifiedRewards(ids: Set<string>): void {
  try {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(LOCAL_NOTIFIED_STORAGE_KEY, JSON.stringify([...ids]))
  } catch {
    // ignore localStorage errors
  }
}

function markRewardLocallyNotified(rewardId: string): void {
  const ids = getLocallyNotifiedRewards()
  if (!ids.has(rewardId)) {
    ids.add(rewardId)
    saveLocallyNotifiedRewards(ids)
  }
}

function wasRewardLocallyNotified(rewardId: string): boolean {
  return getLocallyNotifiedRewards().has(rewardId)
}

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
  prediction_streak: {
    0: 'Новичок',
    1: 'Искра Точности',
    2: 'Пламя Прогноза',
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
}

// Группа для отображения
const ACHIEVEMENT_GROUP_LABELS: Record<string, string> = {
  streak: 'Игровая серия',
  predictions: 'Прогнозы',
  credits: 'Очки сезона',
  bet_wins: 'Угаданные прогнозы',
  prediction_streak: 'Серия побед',
  express_wins: 'Мастер экспрессов',
  broadcast_watch: 'Просмотр трансляций',
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
    { level: 1, threshold: 200, points: 50 },
    { level: 2, threshold: 1000, points: 250 },
    { level: 3, threshold: 5000, points: 1000 },
  ],
  bet_wins: [
    { level: 1, threshold: 10, points: 20 },
    { level: 2, threshold: 50, points: 200 },
    { level: 3, threshold: 200, points: 1000 },
  ],
  prediction_streak: [
    { level: 1, threshold: 3, points: 50 },
    { level: 2, threshold: 7, points: 250 },
    { level: 3, threshold: 15, points: 1000 },
  ],
  express_wins: [
    { level: 1, threshold: 5, points: 50 },
    { level: 2, threshold: 10, points: 250 },
    { level: 3, threshold: 50, points: 1000 },
  ],
  broadcast_watch: [
    { level: 1, threshold: 300, points: 50 },
    { level: 2, threshold: 1500, points: 200 },
    { level: 3, threshold: 6000, points: 1500 },
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
    // Отображать для очков более привычное окончание в интерфейсе:
    // для 1 — "очко", для всех остальных — "очков" (дизайн-решение)
    return pluralize(count, 'очко', 'очков', 'очков')
  case 'bet_wins':
    return pluralize(count, 'угаданный прогноз', 'угаданных прогноза', 'угаданных прогнозов')
  case 'prediction_streak':
    return pluralize(count, 'победа подряд', 'победы подряд', 'побед подряд')
  case 'express_wins':
    return pluralize(count, 'угаданный экспресс', 'угаданных экспресса', 'угаданных экспрессов')
  case 'broadcast_watch':
    return pluralize(count, 'минута просмотра', 'минуты просмотра', 'минут просмотра')
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
    iconSrc: '/achievements/streak-locked.webp',
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
    iconSrc: '/achievements/betcount-locked.webp',
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
    iconSrc: '/achievements/credits-locked.webp',
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
    iconSrc: '/achievements/betwins-locked.webp',
    shortTitle: 'Новичок',
    shouldPlayAnimation: false,
    animationRewardId: null,
    animationPoints: null,
  },
  {
    achievementId: -5,
    group: 'prediction_streak',
    currentLevel: 0,
    currentProgress: 0,
    nextThreshold: 3,
    iconSrc: '/achievements/prediction-streak-locked.webp',
    shortTitle: 'Новичок',
    shouldPlayAnimation: false,
    animationRewardId: null,
    animationPoints: null,
  },
  {
    achievementId: -6,
    group: 'express_wins',
    currentLevel: 0,
    currentProgress: 0,
    nextThreshold: 5,
    iconSrc: '/achievements/express-locked.webp',
    shortTitle: 'Новичок',
    shouldPlayAnimation: false,
    animationRewardId: null,
    animationPoints: null,
  },
  {
    achievementId: -7,
    group: 'broadcast_watch',
    currentLevel: 0,
    currentProgress: 0,
    nextThreshold: 300,
    iconSrc: '/achievements/broadcast-locked.webp',
    shortTitle: 'Новичок',
    shouldPlayAnimation: false,
    animationRewardId: null,
    animationPoints: null,
  },
]

// Специальные иконки для группы "bet_wins" (угаданные прогнозы)
const BET_WINS_ICONS: Record<number, string> = {
  0: '/achievements/betwins-locked.webp',
  1: '/achievements/betwins-bronze.webp',
  2: '/achievements/betwins-silver.webp',
  3: '/achievements/betwins-gold.webp',
}

// Иконки для express_wins (угаданные экспрессы)
const EXPRESS_WINS_ICONS: Record<number, string> = {
  0: '/achievements/express-locked.webp',
  1: '/achievements/express-bronze.webp',
  2: '/achievements/express-silver.webp',
  3: '/achievements/express-gold.webp',
}

// Иконки для broadcast_watch (просмотр трансляций)
const BROADCAST_WATCH_ICONS: Record<number, string> = {
  0: '/achievements/broadcast-locked.webp',
  1: '/achievements/broadcast-bronze.webp',
  2: '/achievements/broadcast-silver.webp',
  3: '/achievements/broadcast-gold.webp',
}

// Иконки для prediction_streak (серия побед в прогнозах)
const PREDICTION_STREAK_ICONS: Record<number, string> = {
  0: '/achievements/prediction-streak-locked.webp',
  1: '/achievements/prediction-streak-bronze.webp',
  2: '/achievements/prediction-streak-silver.webp',
  3: '/achievements/prediction-streak-gold.webp',
}

function resolveAchievementIcon(achievement: UserAchievementSummaryItem): string {
  if (!achievement) return '/achievements/streak-locked.webp'

  // Для угаданных прогнозов используем локальные webp-файлы по уровню
  if (achievement.group === 'bet_wins') {
    return BET_WINS_ICONS[achievement.currentLevel] ?? achievement.iconSrc ?? '/achievements/betwins-locked.webp'
  }

  if (achievement.group === 'express_wins') {
    return EXPRESS_WINS_ICONS[achievement.currentLevel] ?? achievement.iconSrc ?? '/achievements/express-locked.webp'
  }

  if (achievement.group === 'broadcast_watch') {
    return BROADCAST_WATCH_ICONS[achievement.currentLevel] ?? achievement.iconSrc ?? '/achievements/broadcast-locked.webp'
  }

  if (achievement.group === 'prediction_streak') {
    return PREDICTION_STREAK_ICONS[achievement.currentLevel] ?? achievement.iconSrc ?? '/achievements/prediction-streak-locked.webp'
  }

  // По умолчанию используем иконку из данных или общий fallback
  return achievement.iconSrc ?? '/achievements/streak-locked.webp'
}

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

  // Короткое описание для некоторых достижений (под заголовком вместо группы)
  // Сейчас — специальное поведение для "Новичок" в группе predictions
  const specialDescription: string | null = (() => {
    if (achievement.group === 'predictions') {
      // Обобщённое, дружелюбное описание — куда и какие прогнозы считаются
      if (achievement.currentLevel >= thresholds.length) {
        return 'Достигнуто максимальное звание за активность в прогнозах.'
      }
      return 'Делайте прогнозы на матчи любимых команд — в статистику идут только одиночные прогнозы.'
    }

    if (achievement.group === 'credits') {
      // Описание для очков сезона — кратко и ясно
      if (achievement.currentLevel >= thresholds.length) {
        return 'Достигнуто максимальное звание по очкам сезона.'
      }
      return 'Зарабатывайте сезонные очки в рейтинге — учитываются только очки сезона.'
    }

    if (achievement.group === 'streak') {
      // Коротко: что нужно для игрового ряда (стрик)
      if (achievement.currentLevel >= thresholds.length) {
        return 'Достигнута максимальная игровая серия.'
      }
      return 'Поддерживайте серию дней с активностью — считаются подряд идущие дни.'
    }

    if (achievement.group === 'bet_wins') {
      // Короткое описание для угаданных прогнозов
      if (achievement.currentLevel >= thresholds.length) {
        return 'Достигнуто максимальное звание по угаданным прогнозам.'
      }
      return 'Угадывайте исходы матчей — в зачёт идут только верные одиночные прогнозы.'
    }

    if (achievement.group === 'prediction_streak') {
      // Серия побед в прогнозах
      if (achievement.currentLevel >= thresholds.length) {
        return 'Достигнута максимальная серия побед.'
      }
      return 'Выигрывайте прогнозы подряд — считается длина серии верных прогнозов.'
    }

    if (achievement.group === 'express_wins') {
      // Угаданные экспрессы
      if (achievement.currentLevel >= thresholds.length) {
        return 'Достигнуто максимальное звание по экспрессам.'
      }
      return 'Угадывайте экспресс-прогнозы — в зачёт идут полностью угаданные экспрессы.'
    }

    if (achievement.group === 'broadcast_watch') {
      // Просмотр трансляций
      if (achievement.currentLevel >= thresholds.length) {
        return 'Достигнуто максимальное звание за просмотр трансляций.'
      }
      return 'Смотрите трансляции — в зачёт идут минуты просмотра.'
    }
    return null
  })()

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
            src={resolveAchievementIcon(achievement)}
            alt={`${groupLabel} — ${levelName}`}
            className="achievement-modal-icon"
          />
          <h2 id="achievement-modal-title" className="achievement-modal-title">
            {levelName}
          </h2>
          {specialDescription ? (
            <div className="achievement-modal-description">{specialDescription}</div>
          ) : (
            <span className="achievement-modal-group">{groupLabel}</span>
          )}
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
            // Для групп predictions, credits, streak и bet_wins показываем только число порога (20, 200, 1000...),
            // для остальных — число + единица (например, "3 дня подряд").
            const numericOnlyGroups = new Set([
              'predictions',
              'credits',
              'streak',
              'bet_wins',
              'prediction_streak',
              'express_wins',
              'broadcast_watch',
            ])
            const thresholdText = numericOnlyGroups.has(achievement.group)
              ? String(t.threshold)
              : `${t.threshold} ${thresholdUnit}`

            return (
              <div key={t.level} className="achievement-modal-level-row">
                <span className={`achievement-modal-level-name ${isCurrent ? 'current' : ''}`}>
                  {isUnlocked ? '✓ ' : ''}{tLevelName}
                </span>
                <span className="achievement-modal-level-threshold">{thresholdText}</span>
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
              const rewardId = rewardToAnimate.animationRewardId ?? ''

              if (rewardId && !wasRewardLocallyNotified(rewardId)) {
                markRewardLocallyNotified(rewardId)

                setCelebration({
                  iconSrc: rewardToAnimate.iconSrc ?? '/achievements/streak-locked.webp',
                  levelName: rewardToAnimate.shortTitle,
                  points: rewardToAnimate.animationPoints ?? 0,
                  rewardId,
                })
              }
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
      markRewardLocallyNotified(celebration.rewardId)

      const ok = await markRewardNotified(celebration.rewardId)
      if (ok) {
        invalidateAchievementsCache()
      }
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
                  src={resolveAchievementIcon(achievement)}
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
