import React from 'react'
import { useAppStore } from '../store/appStore'
import type {
  MatchDetailsLineups,
  MatchDetailsStats,
  MatchDetailsEvents,
  MatchDetailsBroadcast,
  MatchComment,
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

const COMMENT_MAX_LENGTH = 100
const COMMENT_MIN_LENGTH = 2
const PROFILE_CACHE_KEY = 'obnliga_profile_cache'
const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000

type CommentSubmitPayload = {
  userId: string
  text: string
}

type CommentAuthorInfo = {
  userId: string
  name: string
  photoUrl?: string
}

type FullscreenCapableElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
}

type FullscreenCapableDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void
  webkitFullscreenElement?: Element | null
  webkitFullscreenEnabled?: boolean
}

type TelegramWindow = Window & {
  Telegram?: {
    WebApp?: {
      initDataUnsafe?: {
        user?: {
          id?: number | string
          first_name?: string
          photo_url?: string
        }
      }
    }
  }
}

const resolveCommentAuthorFromCache = (): CommentAuthorInfo | null => {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    const stored = window.localStorage.getItem(PROFILE_CACHE_KEY)
    if (!stored) {
      return null
    }
    const parsed = JSON.parse(stored) as {
      data?: {
        telegramId?: unknown
        firstName?: unknown
        photoUrl?: unknown
      }
      timestamp?: unknown
    }
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    const timestamp = typeof parsed.timestamp === 'number' ? parsed.timestamp : null
    if (!timestamp || Date.now() - timestamp > PROFILE_CACHE_TTL_MS) {
      window.localStorage.removeItem(PROFILE_CACHE_KEY)
      return null
    }
    const data = parsed.data
    if (!data || typeof data !== 'object') {
      return null
    }
    const telegramIdRaw = (data as { telegramId?: unknown }).telegramId
    let userId: string | null = null
    if (typeof telegramIdRaw === 'string' && telegramIdRaw.trim().length > 0) {
      userId = telegramIdRaw.trim()
    } else if (typeof telegramIdRaw === 'number' && Number.isFinite(telegramIdRaw)) {
      userId = String(Math.trunc(telegramIdRaw))
    }
    if (!userId) {
      return null
    }
    const firstNameRaw = (data as { firstName?: unknown }).firstName
    const name =
      typeof firstNameRaw === 'string' && firstNameRaw.trim().length > 0
        ? firstNameRaw.trim()
        : 'Болельщик'
    const photoRaw = (data as { photoUrl?: unknown }).photoUrl
    const photoUrl =
      typeof photoRaw === 'string' && photoRaw.trim().length > 0 ? photoRaw.trim() : undefined
    return { userId, name, photoUrl }
  } catch (_err) {
    return null
  }
}

const resolveCommentAuthorFromTelegram = (): CommentAuthorInfo | null => {
  if (typeof window === 'undefined') {
    return null
  }
  const telegramWindow = window as TelegramWindow
  const tgUser = telegramWindow.Telegram?.WebApp?.initDataUnsafe?.user
  if (!tgUser) {
    return null
  }
  const rawId = tgUser.id
  let userId: string | null = null
  if (typeof rawId === 'number' && Number.isFinite(rawId)) {
    userId = String(Math.trunc(rawId))
  } else if (typeof rawId === 'string' && rawId.trim().length > 0) {
    userId = rawId.trim()
  }
  if (!userId) {
    return null
  }
  const firstName = typeof tgUser.first_name === 'string' ? tgUser.first_name.trim() : ''
  const name = firstName.length > 0 ? firstName : 'Болельщик'
  const photo =
    typeof tgUser.photo_url === 'string' && tgUser.photo_url.trim().length > 0
      ? tgUser.photo_url.trim()
      : undefined
  return { userId, name, photoUrl: photo }
}

const resolveCommentAuthorFromDevConfig = (): CommentAuthorInfo | null => {
  if (!import.meta.env.DEV) {
    return null
  }
  const rawId = import.meta.env.VITE_DEV_TELEGRAM_ID
  if (!rawId) {
    return null
  }
  const numericId = Number(rawId)
  if (!Number.isFinite(numericId) || numericId <= 0) {
    return null
  }
  const firstNameEnv = import.meta.env.VITE_DEV_TELEGRAM_FIRST_NAME
  const photoEnv = import.meta.env.VITE_DEV_TELEGRAM_PHOTO_URL
  const name =
    typeof firstNameEnv === 'string' && firstNameEnv.trim().length > 0
      ? firstNameEnv.trim()
      : 'Болельщик'
  const photo =
    typeof photoEnv === 'string' && photoEnv.trim().length > 0 ? photoEnv.trim() : undefined
  return {
    userId: String(Math.trunc(numericId)),
    name,
    photoUrl: photo,
  }
}

const resolveCommentAuthor = (): CommentAuthorInfo | null => {
  const fromCache = resolveCommentAuthorFromCache()
  if (fromCache) {
    return fromCache
  }
  const fromTelegram = resolveCommentAuthorFromTelegram()
  if (fromTelegram) {
    return fromTelegram
  }
  return resolveCommentAuthorFromDevConfig()
}

const getAuthorInitial = (name: string): string => {
  const trimmed = name.trim()
  if (!trimmed) {
    return '•'
  }
  return trimmed.charAt(0).toUpperCase()
}

const formatCommentTime = (iso: string): string => {
  try {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) {
      return ''
    }

    const now = new Date()
    const sameDay = date.toDateString() === now.toDateString()

    const timeFormatter = new Intl.DateTimeFormat('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    })

    if (sameDay) {
      return timeFormatter.format(date)
    }

    const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
    })

    return `${dateFormatter.format(date)} ${timeFormatter.format(date)}`
  } catch (_err) {
    return ''
  }
}

const resolveCommentError = (code?: string): string | null => {
  if (!code) {
    return null
  }

  const lookup: Record<string, string> = {
    text_required: 'Введите сообщение (минимум 2 символа).',
    user_required: 'Не удалось определить профиль Telegram. Авторизуйтесь и попробуйте снова.',
    user_not_found: 'Пользователь не найден. Авторизуйтесь заново через Telegram.',
    invalid_user: 'Некорректный идентификатор пользователя. Обновите страницу.',
    user_too_long: 'Слишком длинный идентификатор пользователя.',
    match_not_found: 'Матч не найден. Обновите список матчей.',
    invalid_match: 'Некорректный идентификатор матча.',
    rate_limited: 'Слишком часто. Отправлять сообщения можно раз в 3 минуты.',
    network_error: 'Проблемы с сетью. Проверьте соединение и повторите попытку.',
    empty_response: 'Сервер вернул пустой ответ. Попробуйте позже.',
    response_error: 'Сервер вернул ошибку. Попробуйте позже.',
    invalid_json: 'Не удалось обработать ответ сервера.',
    internal_error: 'Сервер временно недоступен. Попробуйте ещё раз.',
  }

  return lookup[code] ?? 'Не удалось отправить комментарий. Попробуйте ещё раз.'
}

export const MatchDetailsPage: React.FC = () => {
  const matchDetails = useAppStore(state => state.matchDetails)
  const closeMatchDetails = useAppStore(state => state.closeMatchDetails)
  const setMatchDetailsTab = useAppStore(state => state.setMatchDetailsTab)
  const setTab = useAppStore(state => state.setTab)
  const fetchMatchComments = useAppStore(state => state.fetchMatchComments)
  const submitMatchCommentAction = useAppStore(state => state.submitMatchComment)

  const {
    header,
    lineups,
    stats,
    events,
    broadcast,
    comments,
    activeTab,
    snapshot,
    loadingBroadcast,
    loadingComments,
    errorBroadcast,
    errorComments,
    submittingComment,
  } = matchDetails
  const matchId = matchDetails.matchId

  const handleRetryComments = React.useCallback(() => {
    if (!matchId) {
      return
    }
    void fetchMatchComments(matchId, { force: true })
  }, [fetchMatchComments, matchId])

  const handleSubmitComment = React.useCallback(
    async (payload: CommentSubmitPayload) => {
      if (!matchId) {
        return false
      }
      const result = await submitMatchCommentAction(matchId, payload)
      return result.ok
    },
    [matchId, submitMatchCommentAction]
  )

  const [homeScoreAnimated, setHomeScoreAnimated] = React.useState(false)
  const [awayScoreAnimated, setAwayScoreAnimated] = React.useState(false)
  const previousScoresRef = React.useRef<{ home: number | null; away: number | null }>({
    home: null,
    away: null,
  })
  const scoreTimersRef = React.useRef<{ home?: number; away?: number }>({})
  const [landscapeBroadcastMode, setLandscapeBroadcastMode] = React.useState(false)

  const handleLandscapeModeChange = React.useCallback((value: boolean) => {
    setLandscapeBroadcastMode(prev => (prev === value ? prev : value))
  }, [])

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

  React.useEffect(() => {
    if (activeTab !== 'broadcast') {
      setLandscapeBroadcastMode(false)
    }
  }, [activeTab])

  React.useEffect(() => {
    if (!matchDetails.open) {
      setLandscapeBroadcastMode(false)
    }
  }, [matchDetails.open])

  const pageClassName = `match-details-page${landscapeBroadcastMode ? ' landscape-video-active' : ''}`

  if (!matchDetails.open || !matchId) {
    return null
  }

  if (!header && !snapshot) {
    return (
      <div className={pageClassName}>
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
    <div className={pageClassName}>
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
              comments={comments}
              loadingComments={loadingComments}
              commentsError={errorComments}
              submittingComment={submittingComment}
              onRetry={handleRetryComments}
              onSubmit={handleSubmitComment}
              onOpenProfile={() => setTab('profile')}
              onLandscapeModeChange={handleLandscapeModeChange}
              landscapeMode={landscapeBroadcastMode}
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

type BroadcastViewProps = {
  broadcast?: MatchDetailsBroadcast
  loading: boolean
  error?: string
  comments?: MatchComment[]
  loadingComments: boolean
  commentsError?: string
  submittingComment: boolean
  onRetry: () => void
  onSubmit: (payload: CommentSubmitPayload) => Promise<boolean>
  onOpenProfile?: () => void
  onLandscapeModeChange?: (value: boolean) => void
  landscapeMode?: boolean
}

const BroadcastView: React.FC<BroadcastViewProps> = ({
  broadcast,
  loading,
  error,
  comments,
  loadingComments,
  commentsError,
  submittingComment,
  onRetry,
  onSubmit,
  onOpenProfile,
  onLandscapeModeChange,
  landscapeMode = false,
}) => {
  const [commentText, setCommentText] = React.useState('')
  const [authError, setAuthError] = React.useState<string | null>(null)
  const [author, setAuthor] = React.useState<CommentAuthorInfo | null>(() => resolveCommentAuthor())
  const [isExpanded, setIsExpanded] = React.useState(false)
  const commentsBodyId = React.useId()
  const videoContainerRef = React.useRef<HTMLDivElement | null>(null)
  const [fullscreenSupported, setFullscreenSupported] = React.useState(false)
  const [isFullscreen, setIsFullscreen] = React.useState(false)
  const [isTelegramMobile, setIsTelegramMobile] = React.useState(false)
  const broadcastAvailable = React.useMemo(
    () =>
      Boolean(broadcast?.st === 'available' && broadcast.url && broadcast.url.trim().length > 0),
    [broadcast]
  )
  const landscapeActive = Boolean(landscapeMode)
  const pseudoFullscreenActive = landscapeActive && isTelegramMobile
  const rawBroadcastUrl = broadcast?.url ?? null

  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const updateAuthor = () => setAuthor(resolveCommentAuthor())
    updateAuthor()
    window.addEventListener('focus', updateAuthor)
    return () => {
      window.removeEventListener('focus', updateAuthor)
    }
  }, [])

  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const telegramWindow = window as TelegramWindow
    const hasTelegram = Boolean(telegramWindow.Telegram?.WebApp)
    const userAgent = navigator.userAgent
    const mobileRegex = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i
    const isMobileUA = mobileRegex.test(userAgent)
    const touchPoints = navigator.maxTouchPoints ?? 0
    const isTouchDevice = 'ontouchstart' in window || touchPoints > 0
    setIsTelegramMobile(hasTelegram && (isMobileUA || isTouchDevice))
  }, [])

  React.useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return
    }

    const body = document.body
    const orientation = window.screen?.orientation
    const orientationControl = orientation as unknown as {
      lock?: (type: string) => Promise<void>
      unlock?: () => void
    }

    if (pseudoFullscreenActive) {
      body.classList.add('allow-landscape')
      if (orientationControl.lock) {
        orientationControl.lock('landscape').catch(() => {
          /* ignore */
        })
      }
    } else {
      body.classList.remove('allow-landscape')
      if (orientationControl.unlock) {
        try {
          orientationControl.unlock()
        } catch (_err) {
          /* ignore */
        }
      }
    }

    return () => {
      body.classList.remove('allow-landscape')
      if (orientationControl.unlock) {
        try {
          orientationControl.unlock()
        } catch (_err) {
          /* ignore */
        }
      }
    }
  }, [pseudoFullscreenActive])

  React.useEffect(() => {
    if (!onLandscapeModeChange) {
      return
    }
    if (typeof window === 'undefined') {
      return
    }

    const orientationMedia = window.matchMedia('(orientation: landscape)')
    const coarsePointerMedia = window.matchMedia('(pointer: coarse)')

    const evaluateLandscape = () => {
      const isLandscape = orientationMedia.matches || window.innerWidth > window.innerHeight
      const isTouchDevice =
        coarsePointerMedia.matches ||
        (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0)
      onLandscapeModeChange(isLandscape && isTouchDevice && broadcastAvailable)
    }

    evaluateLandscape()

    const handleChange = () => {
      evaluateLandscape()
    }

    if (typeof orientationMedia.addEventListener === 'function') {
      orientationMedia.addEventListener('change', handleChange)
    } else if (typeof orientationMedia.addListener === 'function') {
      orientationMedia.addListener(handleChange)
    }

    if (typeof coarsePointerMedia.addEventListener === 'function') {
      coarsePointerMedia.addEventListener('change', handleChange)
    } else if (typeof coarsePointerMedia.addListener === 'function') {
      coarsePointerMedia.addListener(handleChange)
    }

    window.addEventListener('resize', handleChange)
    window.addEventListener('orientationchange', handleChange)

    return () => {
      onLandscapeModeChange(false)
      if (typeof orientationMedia.removeEventListener === 'function') {
        orientationMedia.removeEventListener('change', handleChange)
      } else if (typeof orientationMedia.removeListener === 'function') {
        orientationMedia.removeListener(handleChange)
      }

      if (typeof coarsePointerMedia.removeEventListener === 'function') {
        coarsePointerMedia.removeEventListener('change', handleChange)
      } else if (typeof coarsePointerMedia.removeListener === 'function') {
        coarsePointerMedia.removeListener(handleChange)
      }

      window.removeEventListener('resize', handleChange)
      window.removeEventListener('orientationchange', handleChange)
    }
  }, [broadcastAvailable, onLandscapeModeChange])

  React.useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    const doc = document as FullscreenCapableDocument
    const supportAvailable = Boolean(
      doc.fullscreenEnabled ||
        doc.webkitFullscreenEnabled ||
        document.body?.requestFullscreen
    )
    setFullscreenSupported(supportAvailable)

    const handleFullscreenChange = () => {
      const current = doc.fullscreenElement ?? doc.webkitFullscreenElement
      setIsFullscreen(Boolean(current))
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener(
      'webkitfullscreenchange' as unknown as keyof DocumentEventMap,
      handleFullscreenChange
    )

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener(
        'webkitfullscreenchange' as unknown as keyof DocumentEventMap,
        handleFullscreenChange
      )
    }
  }, [])

  const handleToggleFullscreen = React.useCallback(() => {
    if (typeof document === 'undefined') {
      return
    }

    const doc = document as FullscreenCapableDocument
    const target = videoContainerRef.current as FullscreenCapableElement | null
    if (!target) {
      return
    }

    const exitFullscreen = doc.exitFullscreen?.bind(doc) ?? doc.webkitExitFullscreen?.bind(doc)
    const requestFullscreen =
      target.requestFullscreen?.bind(target) ?? target.webkitRequestFullscreen?.bind(target)

    if (!requestFullscreen) {
      return
    }

    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      exitFullscreen?.()
      return
    }

    requestFullscreen()
  }, [videoContainerRef])

  const handleToggle = React.useCallback(() => {
    setIsExpanded(prev => {
      const next = !prev
      if (!prev && next) {
        setAuthor(resolveCommentAuthor())
      }
      return next
    })
  }, [])

  React.useEffect(() => {
    if (landscapeActive) {
      setIsExpanded(false)
    }
  }, [landscapeActive])

  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const container = videoContainerRef.current
    if (!container) {
      return
    }
    const iframe = container.querySelector('iframe')
    if (!iframe) {
      return
    }

    let lastTap = 0
    const handleTouchEnd = (event: TouchEvent) => {
      const now = Date.now()
      if (now - lastTap < 300) {
        event.preventDefault()
        if (!isFullscreen) {
          handleToggleFullscreen()
        }
      }
      lastTap = now
    }

    const options: AddEventListenerOptions = { passive: false }
    iframe.addEventListener('touchend', handleTouchEnd, options)

    return () => {
      iframe.removeEventListener('touchend', handleTouchEnd, options)
    }
  }, [rawBroadcastUrl, handleToggleFullscreen, isFullscreen])

  const handleTextChange = React.useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value
    setCommentText(value.length > COMMENT_MAX_LENGTH ? value.slice(0, COMMENT_MAX_LENGTH) : value)
  }, [])

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (submittingComment) {
        return
      }
      const preparedText = commentText.trim()
      if (preparedText.length < COMMENT_MIN_LENGTH) {
        return
      }
      const resolvedAuthor = resolveCommentAuthor()
      if (!resolvedAuthor) {
        setAuthor(null)
        setAuthError('Чтобы отправлять сообщения, авторизуйтесь через Telegram.')
        return
      }
      setAuthor(resolvedAuthor)
      setAuthError(null)
      const ok = await onSubmit({ userId: resolvedAuthor.userId, text: preparedText })
      if (ok) {
        setCommentText('')
      }
    },
    [commentText, onSubmit, submittingComment]
  )

  const submitDisabled =
    submittingComment || commentText.trim().length < COMMENT_MIN_LENGTH || !author
  const remaining = Math.max(0, COMMENT_MAX_LENGTH - commentText.length)
  const errorMessage = resolveCommentError(commentsError)

  const commentsContent = React.useMemo(() => {
    if (loadingComments && (!comments || comments.length === 0)) {
      return <div className="comment-placeholder">Загружаем комментарии…</div>
    }

    if (!comments || comments.length === 0) {
      return <div className="comment-empty">Будьте первым, кто оставит комментарий.</div>
    }

    return (
      <ul className="comments-list">
        {comments.map(comment => {
          const trimmedName = comment.authorName.trim()
          const authorName = trimmedName.length > 0 ? trimmedName : 'Болельщик'
          const photoUrl =
            typeof comment.authorPhotoUrl === 'string' && comment.authorPhotoUrl.trim().length > 0
              ? comment.authorPhotoUrl.trim()
              : null
          const initial = getAuthorInitial(authorName)
          return (
            <li key={comment.id} className="comment-item">
              <div className="comment-avatar" aria-hidden={photoUrl ? undefined : 'true'}>
                {photoUrl ? <img src={photoUrl} alt={authorName} /> : <span>{initial}</span>}
              </div>
              <div className="comment-body">
                <div className="comment-meta">
                  <span className="comment-author">{authorName}</span>
                  <span className="comment-time">{formatCommentTime(comment.createdAt)}</span>
                </div>
                <p className="comment-text">{comment.text}</p>
              </div>
            </li>
          )
        })}
      </ul>
    )
  }, [comments, loadingComments])

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

  if (!broadcastAvailable || !broadcast) {
    return (
      <div className="placeholder-tab">
        <p>Трансляция появится здесь, как только администраторы добавят ссылку.</p>
      </div>
    )
  }

  const broadcastUrl = rawBroadcastUrl?.trim() ?? ''
  const embedUrl = broadcastUrl ? buildVkEmbedUrl(broadcastUrl) : null
  const fullscreenControl = fullscreenSupported && !pseudoFullscreenActive ? (
    <div className="broadcast-controls">
      <button
        type="button"
        className="broadcast-fullscreen-button"
        onClick={handleToggleFullscreen}
        aria-pressed={isFullscreen}
      >
        {isFullscreen ? 'Свернуть' : 'На весь экран'}
      </button>
    </div>
  ) : null

  const broadcastViewClassName = `broadcast-view${landscapeActive ? ' landscape-active' : ''}`
  const showComments = !landscapeActive
  const commentsExpanded = isExpanded
  const commentsSectionClassName = `comments-section ${commentsExpanded ? 'expanded' : 'collapsed'}`

  const commentsBody = (
    <div className="comments-body" id={commentsBodyId}>
      {errorMessage ? (
        <div className="comment-error-row">
          <span className="comment-error">{errorMessage}</span>
          <button
            type="button"
            className="comment-retry"
            onClick={onRetry}
            disabled={loadingComments}
          >
            Повторить
          </button>
        </div>
      ) : (
        commentsContent
      )}

      <form className="comment-form" onSubmit={handleSubmit}>
        {author ? null : (
          <div className="comment-auth-hint">
            <p>Чтобы писать в чат, авторизуйтесь через Telegram.</p>
            {onOpenProfile && (
              <button type="button" className="comment-auth-button" onClick={onOpenProfile}>
                Открыть профиль
              </button>
            )}
          </div>
        )}

        <label className="comment-field">
          <span className="comment-label">Сообщение</span>
          <textarea
            value={commentText}
            onChange={handleTextChange}
            maxLength={COMMENT_MAX_LENGTH}
            placeholder="Поддержите команду (до 100 символов)."
            className="comment-textarea"
            rows={3}
            disabled={!author}
          />
        </label>

        <p className="comment-hint">Сообщения до 100 символов, отправлять можно раз в 3 минуты.</p>

        <div className="comment-controls">
          <span className="comment-counter">{remaining}</span>
          <button type="submit" className="comment-submit" disabled={submitDisabled}>
            {submittingComment ? 'Отправляем…' : 'Отправить'}
          </button>
        </div>

        {authError && <div className="comment-auth-error">{authError}</div>}
      </form>
    </div>
  )

  const commentsSection = showComments ? (
    <section className={commentsSectionClassName}>
      <button
        type="button"
        className="comments-toggle"
        onClick={handleToggle}
        aria-expanded={commentsExpanded}
        aria-controls={commentsBodyId}
      >
        <div className="comments-toggle-text">
          <span className="comments-title">Комментарии</span>
          {loadingComments && <span className="comments-status">Обновляем…</span>}
        </div>
        <div className="comments-toggle-meta">
          {!loadingComments && comments && comments.length > 0 && (
            <span className="comments-count">{comments.length}</span>
          )}
          <span className="comments-toggle-icon" aria-hidden="true" />
        </div>
      </button>

      {commentsExpanded && commentsBody}
    </section>
  ) : null

  const videoClassName = `broadcast-video${pseudoFullscreenActive ? ' pseudo-fullscreen' : ''}`

  const videoElement = embedUrl ? (
    <div className={videoClassName} ref={videoContainerRef}>
      <iframe
        src={embedUrl}
        title="VK Видео"
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media; screen-wake-lock"
        allowFullScreen
        frameBorder={0}
      />
      {fullscreenControl}
    </div>
  ) : (
    <div className="broadcast-fallback">
      <p>Не удалось подготовить плеер для указанной ссылки.</p>
    </div>
  )

  if (landscapeActive) {
    return <div className={broadcastViewClassName}>{videoElement}</div>
  }

  return (
    <div className={broadcastViewClassName}>
      {videoElement}
      {commentsSection}
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
