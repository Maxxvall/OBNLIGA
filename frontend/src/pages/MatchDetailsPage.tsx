import React from 'react'
import { useAppStore } from '../store/appStore'
import type {
  MatchDetailsLineups,
  MatchDetailsStats,
  MatchDetailsEvents,
  MatchDetailsBroadcast,
  MatchStatus,
  LeagueMatchLocation,
} from '@shared/types'
import '../styles/matchDetails.css'

const formatMatchDateLabel = (iso?: string | null): string => {
  if (!iso) {
    return 'Дата уточняется'
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return 'Дата уточняется'
  }
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = String(date.getFullYear()).slice(-2)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${day}.${month}.${year} ${hours}:${minutes}`
}

const buildLocationLabel = (
  loc?: { city?: string; stadium?: string },
  fallback?: LeagueMatchLocation | null
): string => {
  const parts: string[] = []
  if (loc) {
    if (loc.city) parts.push(loc.city)
    if (loc.stadium) parts.push(loc.stadium)
  }
  if (!parts.length && fallback) {
    if (fallback.city) parts.push(fallback.city)
    if (fallback.stadiumName) parts.push(fallback.stadiumName)
  }
  const normalized = parts
    .map(part => (part ? part.trim() : ''))
    .filter((part): part is string => Boolean(part && part.length))
  if (!normalized.length) {
    return 'Локация уточняется'
  }
  return normalized.join(' · ')
}

type StatusBadge = { label: string; tone: 'live' | 'scheduled' | 'finished' | 'postponed' }

const getStatusBadge = (status?: MatchStatus): StatusBadge | null => {
  switch (status) {
  case 'LIVE':
    return { label: 'Матч идёт', tone: 'live' }
  case 'FINISHED':
    return { label: 'Завершён', tone: 'finished' }
  case 'POSTPONED':
    return { label: 'Перенесён', tone: 'postponed' }
  case 'SCHEDULED':
    return { label: 'Запланирован', tone: 'scheduled' }
  default:
    return null
  }
}

const shouldShowStatsTab = (status?: MatchStatus, matchDateIso?: string | null): boolean => {
  if (!status) {
    return false
  }
  if (status === 'LIVE') {
    return true
  }
  if (status !== 'FINISHED') {
    return false
  }
  if (!matchDateIso) {
    return false
  }
  const matchStart = new Date(matchDateIso)
  if (Number.isNaN(matchStart.getTime())) {
    return false
  }
  matchStart.setHours(matchStart.getHours() + 3)
  return Date.now() <= matchStart.getTime()
}

export const MatchDetailsPage: React.FC = () => {
  const matchDetails = useAppStore(state => state.matchDetails)
  const closeMatchDetails = useAppStore(state => state.closeMatchDetails)
  const setMatchDetailsTab = useAppStore(state => state.setMatchDetailsTab)

  const { header, lineups, stats, events, broadcast, activeTab, snapshot, loadingBroadcast, errorBroadcast } = matchDetails

  const [homeScoreAnimated, setHomeScoreAnimated] = React.useState(false)
  const [awayScoreAnimated, setAwayScoreAnimated] = React.useState(false)
  const previousScoresRef = React.useRef<{ home: number | null; away: number | null }>({
    home: null,
    away: null,
  })
  const scoreTimersRef = React.useRef<{ home?: number; away?: number }>({})

  React.useEffect(() => {
    const cleanupTimers = scoreTimersRef.current

    return () => {
      if (typeof cleanupTimers.home === 'number') {
        window.clearTimeout(cleanupTimers.home)
        cleanupTimers.home = undefined
      }
      if (typeof cleanupTimers.away === 'number') {
        window.clearTimeout(cleanupTimers.away)
        cleanupTimers.away = undefined
      }
    }
  }, [])

  const status: MatchStatus | undefined = header?.st ?? snapshot?.status
  const matchDateIso = header?.dt ?? snapshot?.matchDateTime
  const dateLabel = formatMatchDateLabel(matchDateIso)
  const broadcastAvailable = Boolean(
    broadcast?.st === 'available' && broadcast.url && broadcast.url.trim().length > 0
  )

  const showNumericScore = status === 'LIVE' || status === 'FINISHED'
  const homeScoreValue = showNumericScore
    ? header?.ht.sc ?? snapshot?.homeScore ?? 0
    : null
  const awayScoreValue = showNumericScore
    ? header?.at.sc ?? snapshot?.awayScore ?? 0
    : null
  const homeScoreDisplay = homeScoreValue !== null ? String(homeScoreValue) : '—'
  const awayScoreDisplay = awayScoreValue !== null ? String(awayScoreValue) : '—'

  React.useEffect(() => {
    const timers = scoreTimersRef.current
    const previous = previousScoresRef.current

    if (!matchDetails.open) {
      if (typeof timers.home === 'number') {
        window.clearTimeout(timers.home)
        timers.home = undefined
      }
      if (typeof timers.away === 'number') {
        window.clearTimeout(timers.away)
        timers.away = undefined
      }
      previousScoresRef.current = { home: null, away: null }
      setHomeScoreAnimated(false)
      setAwayScoreAnimated(false)
      return
    }

    if (homeScoreValue === null) {
      if (previous.home !== null && typeof timers.home === 'number') {
        window.clearTimeout(timers.home)
        timers.home = undefined
      }
      if (previous.home !== null) {
        setHomeScoreAnimated(false)
      }
    } else if (previous.home !== null && homeScoreValue !== previous.home) {
      setHomeScoreAnimated(true)
      if (typeof timers.home === 'number') {
        window.clearTimeout(timers.home)
      }
      timers.home = window.setTimeout(() => {
        setHomeScoreAnimated(false)
        timers.home = undefined
      }, 700)
    }

    if (awayScoreValue === null) {
      if (previous.away !== null && typeof timers.away === 'number') {
        window.clearTimeout(timers.away)
        timers.away = undefined
      }
      if (previous.away !== null) {
        setAwayScoreAnimated(false)
      }
    } else if (previous.away !== null && awayScoreValue !== previous.away) {
      setAwayScoreAnimated(true)
      if (typeof timers.away === 'number') {
        window.clearTimeout(timers.away)
      }
      timers.away = window.setTimeout(() => {
        setAwayScoreAnimated(false)
        timers.away = undefined
      }, 700)
    }

    previousScoresRef.current = { home: homeScoreValue, away: awayScoreValue }
  }, [matchDetails.open, homeScoreValue, awayScoreValue])

  if (!matchDetails.open || !matchDetails.matchId) {
    return null
  }

  if (!header && !snapshot) {
    return (
      <div className="match-details-page">
        <div className="match-details-shell">
          <div className="match-details-loading">
            <p>Загрузка...</p>
          </div>
        </div>
      </div>
    )
  }

  const homeName = header?.ht.n ?? snapshot?.homeClub.name ?? '—'
  const homeLogo = header?.ht.lg ?? snapshot?.homeClub.logoUrl ?? undefined

  const awayName = header?.at.n ?? snapshot?.awayClub.name ?? '—'
  const awayLogo = header?.at.lg ?? snapshot?.awayClub.logoUrl ?? undefined

  const penaltyHome = header?.ph ?? snapshot?.penaltyHomeScore ?? null
  const penaltyAway = header?.pa ?? snapshot?.penaltyAwayScore ?? null
  const hasPenalty =
    (header?.ps ?? snapshot?.hasPenaltyShootout ?? false) &&
    penaltyHome !== null &&
    penaltyAway !== null
  const penaltyLabel = hasPenalty ? `Пенальти ${penaltyHome}:${penaltyAway}` : null

  const minuteLabel = status === 'LIVE' && typeof header?.min === 'number' ? `${header.min}'` : null

  const locationLabel = buildLocationLabel(header?.loc, snapshot?.location ?? null)
  const roundLabel = header?.rd?.label ?? snapshot?.series?.stageName ?? null
  const badge = getStatusBadge(status)
  const showStatsTab = shouldShowStatsTab(status, matchDateIso)

  return (
    <div className="match-details-page">
      <div className="match-details-shell">
        <div className="match-details-header">
          <button className="back-btn" onClick={closeMatchDetails} aria-label="Назад">
            ←
          </button>
          <div className="match-header-content">
            <div className="match-header-top">
              <div className="match-meta">
                {roundLabel && <span className="match-round">{roundLabel}</span>}
                <span className="match-date">{dateLabel}</span>
                <span className="match-location">{locationLabel}</span>
              </div>
              {badge && <span className={`badge badge-${badge.tone}`}>{badge.label}</span>}
            </div>
            <div className="match-teams">
              <div className="team home">
                <span className="team-name">{homeName}</span>
                {homeLogo && <img src={homeLogo} alt={homeName} className="team-logo" />}
              </div>
              <div className="match-score">
                <div className="score-main">
                  <span className={`score${homeScoreAnimated ? ' score-animate' : ''}`}>
                    {homeScoreDisplay}
                  </span>
                  <span className="separator">:</span>
                  <span className={`score${awayScoreAnimated ? ' score-animate' : ''}`}>
                    {awayScoreDisplay}
                  </span>
                </div>
                {(penaltyLabel || minuteLabel) && (
                  <div className="score-meta">
                    {penaltyLabel && <span className="score-detail">{penaltyLabel}</span>}
                    {minuteLabel && <span className="match-minute">{minuteLabel}</span>}
                  </div>
                )}
              </div>
              <div className="team away">
                <span className="team-name">{awayName}</span>
                {awayLogo && <img src={awayLogo} alt={awayName} className="team-logo" />}
              </div>
            </div>
          </div>
        </div>
        <div className="match-details-separator" aria-hidden="true" />

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
            disabled={!broadcastAvailable}
            aria-disabled={!broadcastAvailable}
          >
            Трансляция
          </button>
        </div>

        <div className="match-details-content">
          {activeTab === 'lineups' && (
            <LineupsView lineups={lineups} loading={matchDetails.loadingLineups} />
          )}
          {activeTab === 'events' && (
            <EventsView events={events} loading={matchDetails.loadingEvents} />
          )}
          {activeTab === 'stats' && <StatsView stats={stats} loading={matchDetails.loadingStats} />}
          {activeTab === 'broadcast' && (
            <BroadcastView
              broadcast={broadcast}
              loading={loadingBroadcast}
              error={errorBroadcast}
            />
          )}
        </div>
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
            <span className="event-minute">{ev.min}&apos;</span>
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

const BroadcastView: React.FC<{
  broadcast?: MatchDetailsBroadcast
  loading: boolean
  error?: string
}> = ({ broadcast, loading, error }) => {
  if (loading) {
    return <div className="loading">Загрузка трансляции...</div>
  }

  if (error) {
    return (
      <div className="error">
        <div>
          <p>Не удалось загрузить трансляцию.</p>
          <p className="broadcast-hint">{error}</p>
        </div>
      </div>
    )
  }

  if (!broadcast || broadcast.st !== 'available' || !broadcast.url) {
    return (
      <div className="placeholder-tab">
        <p>Трансляция появится здесь, как только администраторы добавят ссылку.</p>
      </div>
    )
  }

  const embedUrl = buildVkEmbedUrl(broadcast.url)

  return (
    <div className="broadcast-view">
      {embedUrl ? (
        <div className="broadcast-video">
          <iframe
            src={embedUrl}
            title="VK Видео"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            frameBorder={0}
          />
        </div>
      ) : (
        <div className="broadcast-fallback">
          <p>Не удалось подготовить плеер для указанной ссылки.</p>
        </div>
      )}
      <div className="broadcast-link">
        <a href={broadcast.url} target="_blank" rel="noreferrer">
          Смотреть трансляцию во VK
        </a>
        <p className="broadcast-hint">Если плеер не загрузился, откройте трансляцию по ссылке.</p>
      </div>
    </div>
  )
}

const buildVkEmbedUrl = (value: string): string | null => {
  try {
    const parsed = new URL(value)
    const hostname = parsed.hostname.replace(/^www\./, '')
    if (hostname !== 'vk.com' && hostname !== 'm.vk.com') {
      return null
    }

    if (parsed.pathname === '/video_ext.php') {
      const oid = parsed.searchParams.get('oid')
      const id = parsed.searchParams.get('id')
      if (!oid || !id) {
        return null
      }
      const params = new URLSearchParams()
      params.set('oid', oid)
      params.set('id', id)
      params.set('autoplay', '0')
      params.set('hd', parsed.searchParams.get('hd') ?? '2')
      return `https://vk.com/video_ext.php?${params.toString()}`
    }

    const match = parsed.pathname.match(/\/video(-?\d+)_(\d+)/)
    if (!match) {
      return null
    }

    const [, ownerId, videoId] = match
    const params = new URLSearchParams()
    params.set('oid', ownerId)
    params.set('id', videoId)
    params.set('autoplay', '0')
    params.set('hd', '2')
    return `https://vk.com/video_ext.php?${params.toString()}`
  } catch {
    return null
  }
}
