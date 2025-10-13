import React, { useMemo, useState } from 'react'
import type {
  LeaguePlayerLeaderboardEntry,
  LeagueStatsCategory,
  LeagueStatsResponse,
} from '@shared/types'
import './league-stats.css'

type LeagueStatsViewProps = {
  stats?: LeagueStatsResponse
  loading: boolean
  error?: string
  onRetry: () => void
  lastUpdated?: number
}

type ColumnKey = 'total' | 'goals' | 'assists' | 'matches' | 'penalties'

type ColumnConfig = {
  key: ColumnKey
  label: string
  highlight?: boolean
}

type CategoryConfig = {
  title: string
  description: string
  columns: ColumnConfig[]
}

const CATEGORY_ORDER: LeagueStatsCategory[] = ['goalContribution', 'scorers', 'assists']

const CATEGORY_CONFIG: Record<LeagueStatsCategory, CategoryConfig> = {
  goalContribution: {
    title: 'Голы + Пасы',
    description: 'Суммарный вклад игроков в результативные действия.',
    columns: [
      { key: 'total', label: 'Г + П', highlight: true },
      { key: 'goals', label: 'Голы', highlight: true },
      { key: 'assists', label: 'Пасы', highlight: true },
      { key: 'matches', label: 'Матчи' },
    ],
  },
  scorers: {
    title: 'Бомбардиры',
    description: 'Игроки с наибольшим количеством забитых мячей.',
    columns: [
      { key: 'goals', label: 'Голы', highlight: true },
      { key: 'penalties', label: 'Пенальти' },
      { key: 'assists', label: 'Пасы' },
      { key: 'matches', label: 'Матчи' },
    ],
  },
  assists: {
    title: 'Ассистенты',
    description: 'Лучшие по голевым передачам.',
    columns: [
      { key: 'assists', label: 'Пасы', highlight: true },
      { key: 'goals', label: 'Голы' },
      { key: 'matches', label: 'Матчи' },
    ],
  },
}

const formatUpdatedAt = (generatedAt?: string, fallback?: number): string => {
  if (generatedAt) {
    const stamp = new Date(generatedAt)
    if (!Number.isNaN(stamp.getTime())) {
      return stamp.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    }
  }
  if (fallback) {
    const stamp = new Date(fallback)
    if (!Number.isNaN(stamp.getTime())) {
      return stamp.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    }
  }
  return ''
}

const getColumnValue = (entry: LeaguePlayerLeaderboardEntry, key: ColumnKey): number => {
  switch (key) {
  case 'total':
    return entry.goals + entry.assists
  case 'goals':
    return entry.goals
  case 'assists':
    return entry.assists
  case 'matches':
    return entry.matchesPlayed
  case 'penalties':
    return entry.penaltyGoals
  default:
    return 0
  }
}

const formatPlayerName = (entry: LeaguePlayerLeaderboardEntry): string => {
  const prime = `${entry.lastName} ${entry.firstName}`.trim()
  return prime || entry.firstName || entry.lastName
}

export const LeagueStatsView: React.FC<LeagueStatsViewProps> = ({
  stats,
  loading,
  error,
  onRetry,
  lastUpdated,
}) => {
  const [activeIndex, setActiveIndex] = useState(0)

  const categories = CATEGORY_ORDER
  const activeCategory = categories[activeIndex]
  const config = CATEGORY_CONFIG[activeCategory]

  const rows = useMemo(() => {
    if (!stats) {
      return []
    }
    return stats.leaderboards[activeCategory] ?? []
  }, [stats, activeCategory])

  const updatedLabel = useMemo(() => {
    const timeLabel = formatUpdatedAt(stats?.generatedAt, lastUpdated)
    if (!timeLabel) {
      return 'Актуальные данные'
    }
    return `Обновлено в ${timeLabel}`
  }, [stats?.generatedAt, lastUpdated])

  const handlePrev = () => {
    setActiveIndex(prev => (prev - 1 + categories.length) % categories.length)
  }

  const handleNext = () => {
    setActiveIndex(prev => (prev + 1) % categories.length)
  }

  if (loading) {
    return (
      <div className="league-stats-skeleton" aria-live="polite" aria-busy="true">
        <div className="skeleton skeleton-heading" />
        <div className="skeleton skeleton-row" />
        <div className="skeleton skeleton-row" />
        <div className="skeleton skeleton-row" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="inline-feedback error" role="alert">
        <div>Не удалось загрузить статистику. Код: {error}</div>
        <button type="button" className="button-secondary" onClick={onRetry}>
          Повторить
        </button>
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="inline-feedback info" role="status">
        Нет данных по статистике для выбранного сезона.
      </div>
    )
  }

  return (
    <section className="league-stats" aria-label="Лидерборды сезона">
      <header className="stats-header">
        <div className="stats-meta">
          <h2>{stats.season.name}</h2>
          <p>{stats.season.competition.name}</p>
        </div>
        <div className="stats-controls">
          <button
            type="button"
            className="stats-nav"
            onClick={handlePrev}
            aria-label="Предыдущая таблица"
          >
            &lt;
          </button>
          <div className="stats-context">
            <span className="stats-title">{config.title}</span>
            <span className="stats-description">{config.description}</span>
          </div>
          <button
            type="button"
            className="stats-nav"
            onClick={handleNext}
            aria-label="Следующая таблица"
          >
            &gt;
          </button>
        </div>
        <span className="muted stats-updated">{updatedLabel}</span>
      </header>

      <div className="stats-table" role="table">
        <div className="stats-row head" role="row">
          <span className="col-rank" role="columnheader">
            №
          </span>
          <span className="col-player" role="columnheader">
            Игрок
          </span>
          <span className="col-club" role="columnheader">
            Клуб
          </span>
          {config.columns.map(column => (
            <span
              key={column.key}
              className={`col-metric${column.highlight ? ' highlight' : ''}`}
              role="columnheader"
            >
              {column.label}
            </span>
          ))}
        </div>
        {rows.length === 0 ? (
          <div className="stats-row empty" role="row">
            <span role="cell" className="col-empty">
              Нет сыгранных матчей.
            </span>
          </div>
        ) : (
          rows.map((entry, index) => (
            <div className="stats-row" role="row" key={`${activeCategory}-${entry.personId}`}>
              <span className="col-rank" role="cell">
                {index + 1}
              </span>
              <span className="col-player" role="cell">
                <span className="player-name">{formatPlayerName(entry)}</span>
                <span className="player-meta">#{entry.personId}</span>
              </span>
              <span className="col-club" role="cell">
                {entry.clubLogoUrl ? (
                  <img
                    src={entry.clubLogoUrl}
                    alt={`Логотип клуба ${entry.clubName}`}
                    className="club-logo"
                  />
                ) : (
                  <span className="club-logo fallback" aria-hidden>
                    {entry.clubShortName.slice(0, 2).toUpperCase()}
                  </span>
                )}
                <span className="club-name">{entry.clubName}</span>
              </span>
              {config.columns.map(column => (
                <span
                  key={column.key}
                  className={`col-metric${column.highlight ? ' highlight' : ''}`}
                  role="cell"
                >
                  {getColumnValue(entry, column.key)}
                </span>
              ))}
            </div>
          ))
        )}
      </div>

      <div className="stats-pagination" role="group" aria-label="Выбор таблицы лидеров">
        {categories.map((category, idx) => (
          <button
            type="button"
            key={category}
            className={`stats-dot${idx === activeIndex ? ' active' : ''}`}
            onClick={() => setActiveIndex(idx)}
            aria-pressed={idx === activeIndex}
            aria-label={CATEGORY_CONFIG[category].title}
          />
        ))}
      </div>
    </section>
  )
}
