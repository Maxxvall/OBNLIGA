import React from 'react'
import type {
  MatchDetailsEvents,
  MatchDetailsHeader,
  MatchDetailsLineups,
  MatchDetailsStats,
} from '@shared/types'
import '../styles/matchDetails.css'
import { useMatchDetailsStore } from '../store/matchDetailsStore'

type MatchDetailsTab = 'lineups' | 'events' | 'stats' | 'broadcast'

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const STATUS_LABELS: Record<MatchDetailsHeader['status'], string> = {
  SCHEDULED: 'Запланирован',
  LIVE: 'Матч идёт',
  POSTPONED: 'Перенесён',
  FINISHED: 'Завершён',
}

const STATUS_TONES: Record<MatchDetailsHeader['status'], string> = {
  SCHEDULED: 'planned',
  LIVE: 'live',
  POSTPONED: 'postponed',
  FINISHED: 'finished',
}

const formatDateTimeLabel = (value: string): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return DATE_TIME_FORMAT.format(date)
}

const computeStatsHidden = (header?: MatchDetailsHeader | null): boolean => {
  if (!header) {
    return true
  }
  if (header.status !== 'FINISHED') {
    return false
  }
  const start = Date.parse(header.matchDateTime)
  if (Number.isNaN(start)) {
    return true
  }
  const cutoff = start + 3 * 60 * 60 * 1000
  return Date.now() > cutoff
}

const MatchScore: React.FC<{ header: MatchDetailsHeader }> = ({ header }) => {
  const penaltyVisible = header.homeTeam.penaltyScore !== null && header.awayTeam.penaltyScore !== null
  return (
    <div className="match-details-score">
      <span className="score-number">{header.homeTeam.score}</span>
      <span className="score-separator">:</span>
      <span className="score-number">{header.awayTeam.score}</span>
      {penaltyVisible ? (
        <span className="score-penalty">(п. {header.homeTeam.penaltyScore}:{header.awayTeam.penaltyScore})</span>
      ) : null}
    </div>
  )
}

type SectionProps<T> = {
  data?: T
  loading: boolean
  error?: string
  emptyLabel: string
  children?: (data: T) => React.ReactNode
}

const DataSection = <T,>({ data, loading, error, emptyLabel, children }: SectionProps<T>) => {
  if (loading && !data) {
    return <div className="match-section-feedback" role="status">Загрузка...</div>
  }
  if (error) {
    return <div className="match-section-feedback error">Ошибка: {error}</div>
  }
  if (!data) {
    return <div className="match-section-feedback muted">{emptyLabel}</div>
  }
  return <>{children ? children(data) : null}</>
}

const LineupsView: React.FC<{ lineups?: MatchDetailsLineups; loading: boolean; error?: string }> = ({
  lineups,
  loading,
  error,
}) => (
  <DataSection
    data={lineups}
    loading={loading}
    error={error}
    emptyLabel="Составы пока не опубликованы."
  >
    {data => (
      <div className="lineups-columns">
        <div className="lineup-column">
          <h3>Домашняя команда</h3>
          <ul>
            {data.homeTeam.players.map(player => {
              const label = `${player.lastName} ${player.firstName}`.trim()
              return (
                <li key={`${player.lastName}-${player.firstName}-${player.shirtNumber ?? 'x'}`}>
                  <span className="player-number">{player.shirtNumber ?? '—'}</span>
                  <span className="player-name">{label}</span>
                </li>
              )
            })}
          </ul>
        </div>
        <div className="lineup-column">
          <h3>Гостевая команда</h3>
          <ul>
            {data.awayTeam.players.map(player => {
              const label = `${player.lastName} ${player.firstName}`.trim()
              return (
                <li key={`${player.lastName}-${player.firstName}-${player.shirtNumber ?? 'x'}`}>
                  <span className="player-number">{player.shirtNumber ?? '—'}</span>
                  <span className="player-name">{label}</span>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    )}
  </DataSection>
)

const EventsView: React.FC<{ events?: MatchDetailsEvents; loading: boolean; error?: string }> = ({
  events,
  loading,
  error,
}) => (
  <DataSection
    data={events}
    loading={loading}
    error={error}
    emptyLabel="Событий пока нет."
  >
    {data => (
      <ul className="events-list">
        {data.events.map(item => {
          const secondary = item.secondary
          return (
            <li key={item.id} className={`event-item side-${item.team.toLowerCase()}`}>
              <span className="event-minute">{item.minute}&prime;</span>
              <div className="event-details">
                <span className={`event-type type-${item.eventType.toLowerCase()}`}>{item.eventType}</span>
                <span className="event-player">
                  {item.primary.lastName} {item.primary.firstName}
                  {item.primary.shirtNumber ? ` (#${item.primary.shirtNumber})` : ''}
                </span>
                {secondary ? (
                  <span className="event-secondary">
                    ассист: {secondary.lastName} {secondary.firstName}
                    {secondary.shirtNumber ? ` (#${secondary.shirtNumber})` : ''}
                  </span>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    )}
  </DataSection>
)

const StatsView: React.FC<{ stats?: MatchDetailsStats; loading: boolean; error?: string }> = ({
  stats,
  loading,
  error,
}) => (
  <DataSection
    data={stats}
    loading={loading}
    error={error}
    emptyLabel="Статистика недоступна."
  >
    {data => (
      <table className="stats-table">
        <caption>Ключевые показатели</caption>
        <thead>
          <tr>
            <th>Метрика</th>
            <th>Дома</th>
            <th>В гостях</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Удары</td>
            <td>{data.homeTeam.stats.shots}</td>
            <td>{data.awayTeam.stats.shots}</td>
          </tr>
          <tr>
            <td>Удары в створ</td>
            <td>{data.homeTeam.stats.shotsOnTarget}</td>
            <td>{data.awayTeam.stats.shotsOnTarget}</td>
          </tr>
          <tr>
            <td>Угловые</td>
            <td>{data.homeTeam.stats.corners}</td>
            <td>{data.awayTeam.stats.corners}</td>
          </tr>
          <tr>
            <td>Жёлтые карточки</td>
            <td>{data.homeTeam.stats.yellowCards}</td>
            <td>{data.awayTeam.stats.yellowCards}</td>
          </tr>
        </tbody>
      </table>
    )}
  </DataSection>
)

const BroadcastView: React.FC<{ loading: boolean; error?: string }> = ({ loading, error }) => {
  if (loading) {
    return <div className="match-section-feedback" role="status">Загрузка...</div>
  }
  if (error) {
    return <div className="match-section-feedback error">Ошибка: {error}</div>
  }
  return <div className="match-section-feedback muted">Трансляция пока недоступна.</div>
}

const MatchDetailsPage: React.FC<{ matchId: string }> = ({ matchId }) => {
  const initialize = useMatchDetailsStore(state => state.initialize)
  const reset = useMatchDetailsStore(state => state.reset)
  const fetchHeader = useMatchDetailsStore(state => state.fetchHeader)
  const fetchLineups = useMatchDetailsStore(state => state.fetchLineups)
  const fetchEvents = useMatchDetailsStore(state => state.fetchEvents)
  const fetchStats = useMatchDetailsStore(state => state.fetchStats)
  const fetchBroadcast = useMatchDetailsStore(state => state.fetchBroadcast)

  const headerData = useMatchDetailsStore(state => state.header.data)
  const headerLoading = useMatchDetailsStore(state => state.header.loading)
  const headerError = useMatchDetailsStore(state => state.header.error)

  const lineupsState = useMatchDetailsStore(state => state.lineups)
  const eventsState = useMatchDetailsStore(state => state.events)
  const statsState = useMatchDetailsStore(state => state.stats)
  const broadcastState = useMatchDetailsStore(state => state.broadcast)

  const [activeTab, setActiveTab] = React.useState<MatchDetailsTab>('lineups')

  React.useEffect(() => {
    void initialize(matchId)
    return () => {
      reset()
    }
  }, [initialize, reset, matchId])

  const headerStatus = headerData?.status ?? null
  const statsHidden = computeStatsHidden(headerData)

  React.useEffect(() => {
    if (statsHidden && activeTab === 'stats') {
      setActiveTab('lineups')
    }
  }, [statsHidden, activeTab])

  React.useEffect(() => {
    if (headerStatus !== 'LIVE') {
      return
    }
    const intervalId = window.setInterval(() => {
      if (document.hidden) {
        return
      }
      void fetchHeader({ background: true })
    }, 10_000)
    return () => window.clearInterval(intervalId)
  }, [headerStatus, fetchHeader])

  React.useEffect(() => {
    if (headerStatus === 'SCHEDULED' || headerStatus === 'POSTPONED') {
      const intervalId = window.setInterval(() => {
        if (document.hidden) {
          return
        }
        void fetchLineups({ background: true })
      }, 600_000)
      return () => window.clearInterval(intervalId)
    }
    return undefined
  }, [headerStatus, fetchLineups])

  React.useEffect(() => {
    if (activeTab !== 'events' || headerStatus !== 'LIVE') {
      return
    }
    const intervalId = window.setInterval(() => {
      if (document.hidden) {
        return
      }
      void fetchEvents({ background: true })
    }, 10_000)
    return () => window.clearInterval(intervalId)
  }, [activeTab, headerStatus, fetchEvents])

  React.useEffect(() => {
    if (activeTab !== 'stats' || statsHidden || headerStatus !== 'LIVE') {
      return
    }
    const intervalId = window.setInterval(() => {
      if (document.hidden) {
        return
      }
      void fetchStats({ background: true })
    }, 10_000)
    return () => window.clearInterval(intervalId)
  }, [activeTab, headerStatus, statsHidden, fetchStats])

  const tabs = React.useMemo(() => {
    const entries: Array<{ key: MatchDetailsTab; label: string }> = [
      { key: 'lineups', label: 'Составы' },
      { key: 'events', label: 'События' },
    ]
    if (!statsHidden) {
      entries.push({ key: 'stats', label: 'Статистика' })
    }
    entries.push({ key: 'broadcast', label: 'Трансляция' })
    return entries
  }, [statsHidden])

  const handleTabSelect = (tab: MatchDetailsTab) => {
    setActiveTab(tab)
    if (tab === 'events') {
      void fetchEvents()
    }
    if (tab === 'stats' && !statsHidden) {
      void fetchStats()
    }
    if (tab === 'broadcast') {
      void fetchBroadcast()
    }
  }

  const handleBackClick = () => {
    if (window.history.length > 1) {
      window.history.back()
      return
    }
    window.location.assign('/')
  }

  return (
    <div className="match-details-page">
      <header className="match-details-header">
        <button type="button" className="back-button" onClick={handleBackClick}>
          ← Назад
        </button>
        {headerLoading && !headerData ? (
          <div className="header-placeholder" role="status">Загружаем детали матча...</div>
        ) : headerError ? (
          <div className="header-placeholder error">Ошибка: {headerError}</div>
        ) : headerData ? (
          <div className="header-content">
            <div className="team-block">
              {headerData.homeTeam.logo ? (
                <img src={headerData.homeTeam.logo} alt="" aria-hidden="true" className="team-logo" />
              ) : (
                <span className="team-logo fallback" aria-hidden="true">
                  {headerData.homeTeam.shortName.slice(0, 2).toUpperCase()}
                </span>
              )}
              <span className="team-name">{headerData.homeTeam.name}</span>
            </div>
            <MatchScore header={headerData} />
            <div className="team-block">
              {headerData.awayTeam.logo ? (
                <img src={headerData.awayTeam.logo} alt="" aria-hidden="true" className="team-logo" />
              ) : (
                <span className="team-logo fallback" aria-hidden="true">
                  {headerData.awayTeam.shortName.slice(0, 2).toUpperCase()}
                </span>
              )}
              <span className="team-name">{headerData.awayTeam.name}</span>
            </div>
          </div>
        ) : null}
        {headerData ? (
          <div className="header-meta">
            <span className={`status-badge tone-${STATUS_TONES[headerData.status]}`}>
              {STATUS_LABELS[headerData.status]}
            </span>
            {headerData.currentMinute !== null ? (
              <span className="status-minute">{headerData.currentMinute}&prime;</span>
            ) : null}
            <span className="status-datetime">{formatDateTimeLabel(headerData.matchDateTime)}</span>
            {headerData.venue ? (
              <span className="status-venue">
                {headerData.venue.city ?? ''}{headerData.venue.city && headerData.venue.stadium ? ' · ' : ''}
                {headerData.venue.stadium ?? ''}
              </span>
            ) : null}
          </div>
        ) : null}
      </header>

      <nav className="match-details-tabs" role="tablist" aria-label="Информация о матче">
        {tabs.map(tab => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`match-tab${activeTab === tab.key ? ' active' : ''}`}
            onClick={() => handleTabSelect(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <section className="match-details-content" role="tabpanel">
        {activeTab === 'lineups' ? (
          <LineupsView
            lineups={lineupsState.data}
            loading={lineupsState.loading}
            error={lineupsState.error}
          />
        ) : null}
        {activeTab === 'events' ? (
          <EventsView
            events={eventsState.data}
            loading={eventsState.loading}
            error={eventsState.error}
          />
        ) : null}
        {activeTab === 'stats' && !statsHidden ? (
          <StatsView
            stats={statsState.data}
            loading={statsState.loading}
            error={statsState.error}
          />
        ) : null}
        {activeTab === 'broadcast' ? (
          <BroadcastView loading={broadcastState.loading} error={broadcastState.error} />
        ) : null}
      </section>
    </div>
  )
}

export default MatchDetailsPage
