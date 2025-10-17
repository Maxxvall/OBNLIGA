import React, { useEffect } from 'react'
import { useAppStore } from '../store/appStore'
import type { MatchDetailsLineups, MatchDetailsStats, MatchDetailsEvents } from '@shared/types'
import '../styles/matchDetails.css'

const TIME_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export const MatchDetailsPage: React.FC = () => {
  const matchDetails = useAppStore(state => state.matchDetails)
  const closeMatchDetails = useAppStore(state => state.closeMatchDetails)
  const setMatchDetailsTab = useAppStore(state => state.setMatchDetailsTab)

  const { header, lineups, stats, events, activeTab } = matchDetails

  // No cleanup useEffect needed - closeMatchDetails is called from back button onClick

  if (!matchDetails.open || !matchDetails.matchId) {
    return null
  }

  // Show loading if header is not yet loaded
  if (!header) {
    return (
      <div className="match-details-page">
        <div className="match-details-container">
          <div className="match-details-loading">
            <p>Загрузка...</p>
          </div>
        </div>
      </div>
    )
  }

  const matchDate = new Date(header.dt)
  const dateStr = TIME_FORMATTER.format(matchDate)

  const shouldShowStats = () => {
    if (header.st === 'LIVE') return true
    if (header.st !== 'FINISHED') return false
    const now = Date.now()
    const matchEnd = new Date(header.dt)
    matchEnd.setHours(matchEnd.getHours() + 3) // 2h match + 1h grace
    return now <= matchEnd.getTime()
  }

  const showStatsTab = shouldShowStats()

  return (
    <div className="match-details-page">
      {/* Header */}
      <div className="match-details-header">
        <button className="back-btn" onClick={closeMatchDetails} aria-label="Назад">
          ←
        </button>
        <div className="match-header-content">
          <div className="match-teams">
            <div className="team home">
              {header.ht.lg && <img src={header.ht.lg} alt={header.ht.n} className="team-logo" />}
              <span className="team-name">{header.ht.n}</span>
            </div>
            <div className="match-score">
              <span className="score">{header.ht.sc}</span>
              <span className="separator">:</span>
              <span className="score">{header.at.sc}</span>
            </div>
            <div className="team away">
              <span className="team-name">{header.at.n}</span>
              {header.at.lg && <img src={header.at.lg} alt={header.at.n} className="team-logo" />}
            </div>
          </div>
          <div className="match-meta">
            <span className="match-date">{dateStr}</span>
            {header.st === 'LIVE' && header.min !== undefined && (
              <span className="match-minute">{header.min}'</span>
            )}
            {header.st === 'LIVE' && <span className="badge badge-live">Матч идёт</span>}
            {header.st === 'FINISHED' && <span className="badge badge-finished">Завершён</span>}
            {header.st === 'SCHEDULED' && <span className="badge badge-scheduled">Запланирован</span>}
            {header.st === 'POSTPONED' && <span className="badge badge-postponed">Перенесён</span>}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="match-details-tabs">
        <button
          className={`tab ${activeTab === 'lineups' ? 'active' : ''}`}
          onClick={() => setMatchDetailsTab('lineups')}
        >
          Составы
        </button>
        <button
          className={`tab ${activeTab === 'events' ? 'active' : ''}`}
          onClick={() => setMatchDetailsTab('events')}
        >
          События
        </button>
        {showStatsTab && (
          <button
            className={`tab ${activeTab === 'stats' ? 'active' : ''}`}
            onClick={() => setMatchDetailsTab('stats')}
          >
            Статистика
          </button>
        )}
        <button
          className={`tab ${activeTab === 'broadcast' ? 'active' : ''}`}
          onClick={() => setMatchDetailsTab('broadcast')}
          disabled
        >
          Трансляция
        </button>
      </div>

      {/* Content */}
      <div className="match-details-content">
        {activeTab === 'lineups' && (
          <LineupsView lineups={lineups} loading={matchDetails.loadingLineups} />
        )}
        {activeTab === 'events' && (
          <EventsView events={events} loading={matchDetails.loadingEvents} />
        )}
        {activeTab === 'stats' && <StatsView stats={stats} loading={matchDetails.loadingStats} />}
        {activeTab === 'broadcast' && (
          <div className="placeholder-tab">
            <p>Трансляция пока недоступна</p>
          </div>
        )}
      </div>
    </div>
  )
}

const LineupsView: React.FC<{
  lineups?: MatchDetailsLineups
  loading: boolean
}> = ({ lineups, loading }) => {
  if (loading) {
    return <div className="loading">Загрузка составов...</div>
  }

  if (!lineups) {
    return <div className="error">Нет данных о составах</div>
  }

  return (
    <div className="lineups-view">
      <div className="team-lineup">
        <h3>Хозяева</h3>
        <ul className="player-list">
          {lineups.ht.pl.map((p, idx) => (
            <li key={idx}>
              <span className="player-number">{p.sn || '—'}</span>
              <span className="player-name">
                {p.fn} {p.ln}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="team-lineup">
        <h3>Гости</h3>
        <ul className="player-list">
          {lineups.at.pl.map((p, idx) => (
            <li key={idx}>
              <span className="player-number">{p.sn || '—'}</span>
              <span className="player-name">
                {p.fn} {p.ln}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

const EventsView: React.FC<{
  events?: MatchDetailsEvents
  loading: boolean
}> = ({ events, loading }) => {
  if (loading) {
    return <div className="loading">Загрузка событий...</div>
  }

  if (!events || events.ev.length === 0) {
    return <div className="error">Нет событий в матче</div>
  }

  const eventTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      GOAL: '⚽ Гол',
      PENALTY_GOAL: '⚽ Пенальти',
      OWN_GOAL: '⚽ Автогол',
      YELLOW_CARD: '🟨 ЖК',
      RED_CARD: '🟥 КК',
      SUB_IN: '↑',
      SUB_OUT: '↓',
    }
    return labels[type] || type
  }

  return (
    <div className="events-view">
      <ul className="event-list">
        {events.ev.map(ev => (
          <li key={ev.id} className={`event ${ev.tm}`}>
            <span className="event-minute">{ev.min}'</span>
            <span className="event-type">{eventTypeLabel(ev.tp)}</span>
            <span className="event-player">{ev.pl || '—'}</span>
            {ev.pl2 && <span className="event-player2">→ {ev.pl2}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

const StatsView: React.FC<{
  stats?: MatchDetailsStats
  loading: boolean
}> = ({ stats, loading }) => {
  if (loading) {
    return <div className="loading">Загрузка статистики...</div>
  }

  if (!stats) {
    return <div className="error">Нет статистики матча</div>
  }

  const statRows = [
    { label: 'Удары', key: 'sh' as const },
    { label: 'Удары в створ', key: 'sot' as const },
    { label: 'Угловые', key: 'cor' as const },
    { label: 'Жёлтые карточки', key: 'yc' as const },
    { label: 'Красные карточки', key: 'rc' as const },
  ]

  return (
    <div className="stats-view">
      <table className="stats-table">
        <thead>
          <tr>
            <th>Хозяева</th>
            <th>Показатель</th>
            <th>Гости</th>
          </tr>
        </thead>
        <tbody>
          {statRows.map(row => (
            <tr key={row.key}>
              <td className="stat-value">{stats.ht.st[row.key] ?? 0}</td>
              <td className="stat-label">{row.label}</td>
              <td className="stat-value">{stats.at.st[row.key] ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
