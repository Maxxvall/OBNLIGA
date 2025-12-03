import React, { useMemo, useState } from 'react'
import type {
  LeaguePlayerLeaderboardEntry,
  LeagueStatsCategory,
  LeagueStatsResponse,
} from '@shared/types'
import './league-stats.css'
import { useAppStore } from '../../store/appStore'

type LeagueStatsViewProps = {
  stats?: LeagueStatsResponse
  loading: boolean
  error?: string
  onRetry: () => void
}

type ColumnConfig = {
  key: string
  label: string
  highlight?: boolean
  align?: 'left' | 'center' | 'right'
  render: (entry: LeaguePlayerLeaderboardEntry) => React.ReactNode
}

type CategoryConfig = {
  title: string
  columns: ColumnConfig[]
}

const CATEGORY_ORDER: LeagueStatsCategory[] = ['goalContribution', 'scorers', 'assists']

const formatGoals = (goals: number, penaltyGoals?: number) => {
  if (penaltyGoals && penaltyGoals > 0) {
    return `${goals}(${penaltyGoals})`
  }
  return goals
}

const formatEfficiency = (goals: number, matches: number) => {
  if (!matches) {
    return '0.00'
  }
  return (goals / matches).toFixed(2)
}

const CATEGORY_CONFIG: Record<LeagueStatsCategory, CategoryConfig> = {
  goalContribution: {
    title: 'Голы + Пасы',
    columns: [
      {
        key: 'matches',
        label: 'И',
        align: 'center',
        render: entry => entry.matchesPlayed,
      },
      {
        key: 'assists',
        label: 'П',
        highlight: true,
        align: 'center',
        render: entry => entry.assists,
      },
      {
        key: 'goals',
        label: 'Г',
        highlight: true,
        align: 'center',
        render: entry => formatGoals(entry.goals, entry.penaltyGoals),
      },
      {
        key: 'total',
        label: 'Г+П',
        highlight: true,
        align: 'center',
        render: entry => entry.goals + entry.assists,
      },
    ],
  },
  scorers: {
    title: 'Бомбардиры',
    columns: [
      {
        key: 'matches',
        label: 'И',
        align: 'center',
        render: entry => entry.matchesPlayed,
      },
      {
        key: 'efficiency',
        label: 'Эфф',
        align: 'center',
        render: entry => formatEfficiency(entry.goals, entry.matchesPlayed),
      },
      {
        key: 'goals',
        label: 'Г',
        highlight: true,
        align: 'center',
        render: entry => formatGoals(entry.goals, entry.penaltyGoals),
      },
    ],
  },
  assists: {
    title: 'Ассистенты',
    columns: [
      {
        key: 'matches',
        label: 'И',
        align: 'center',
        render: entry => entry.matchesPlayed,
      },
      {
        key: 'assists',
        label: 'П',
        highlight: true,
        align: 'center',
        render: entry => entry.assists,
      },
    ],
  },
}

const formatPlayerName = (entry: LeaguePlayerLeaderboardEntry): string => {
  const last = entry.lastName?.trim() ?? ''
  const first = entry.firstName?.trim() ?? ''
  const initial = first ? `${first[0]?.toUpperCase()}.` : ''
  if (last && initial) {
    return `${last} ${initial}`
  }
  if (last) {
    return last
  }
  if (first) {
    return first
  }
  return `ID ${entry.personId}`
}

export const LeagueStatsView: React.FC<LeagueStatsViewProps> = ({
  stats,
  loading,
  error,
  onRetry,
}) => {
  const [activeIndex, setActiveIndex] = useState(0)
  const openTeamView = useAppStore(state => state.openTeamView)

  const categories = CATEGORY_ORDER
  const activeCategory = categories[activeIndex]
  const config = CATEGORY_CONFIG[activeCategory]
  const metricsClass = `metrics-${config.columns.length}`

  const rows = useMemo(() => {
    if (!stats) {
      return []
    }
    return stats.leaderboards[activeCategory] ?? []
  }, [stats, activeCategory])

  const isInitialLoading = loading && !stats
  const isRefreshing = loading && Boolean(stats)

  const handlePrev = () => {
    setActiveIndex(prev => (prev - 1 + categories.length) % categories.length)
  }

  const handleNext = () => {
    setActiveIndex(prev => (prev + 1) % categories.length)
  }

  if (isInitialLoading) {
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
    <section
      className="league-stats"
      aria-label="Лидерборды сезона"
      data-refreshing={isRefreshing || undefined}
    >
      <header className="stats-header">
        <div className="stats-meta">
          <h2>
            {stats.season.isArchived ? '📦 ' : ''}{stats.season.name}
          </h2>
          <p>{stats.season.competition.name}</p>
          {stats.season.isArchived && (
            <span className="archived-badge">Архивный сезон</span>
          )}
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
      </header>

      <div className={`stats-table ${metricsClass}`} role="table">
        <div className={`stats-row head ${metricsClass}`} role="row">
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
              className={`col-metric${column.highlight ? ' highlight' : ''} align-${column.align ?? 'center'}`}
              role="columnheader"
            >
              {column.label}
            </span>
          ))}
        </div>
        {rows.length === 0 ? (
          <div className={`stats-row empty ${metricsClass}`} role="row">
            <span role="cell" className="col-empty">
              Нет сыгранных матчей.
            </span>
          </div>
        ) : (
          rows.map((entry, index) => (
            <div
              className={`stats-row ${metricsClass}`}
              role="row"
              key={`${activeCategory}-${entry.personId}`}
            >
              <span className="col-rank" role="cell">
                {index + 1}
              </span>
              <span className="col-player" role="cell">
                <span className="player-name">{formatPlayerName(entry)}</span>
              </span>
              <span className="col-club" role="cell">
                <button
                  type="button"
                  className="club-logo-button club-logo-button--compact"
                  onClick={() => openTeamView(entry.clubId)}
                  aria-label={`Открыть страницу клуба ${entry.clubName}`}
                >
                  {entry.clubLogoUrl ? (
                    <img
                      src={entry.clubLogoUrl}
                      alt=""
                      aria-hidden="true"
                      className="club-logo"
                    />
                  ) : (
                    <span className="club-logo fallback" aria-hidden="true">
                      {entry.clubShortName.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                </button>
              </span>
              {config.columns.map(column => (
                <span
                  key={column.key}
                  className={`col-metric${column.highlight ? ' highlight' : ''} align-${column.align ?? 'center'}`}
                  role="cell"
                >
                  {column.render(entry)}
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
