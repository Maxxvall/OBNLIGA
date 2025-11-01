import React, { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ClubMatchesResponse, ClubSummaryResponse, MatchStatus } from '@shared/types'
import { useAppStore, TeamSubTab, TeamMatchesMode } from '../../store/appStore'
import '../../styles/teamView.css'
import '../../styles/leagueRounds.css'

const TAB_CONFIG: Array<{ key: TeamSubTab; label: string }> = [
  { key: 'overview', label: 'Обзор' },
  { key: 'matches', label: 'Матчи' },
  { key: 'squad', label: 'Состав' },
]

const MATCH_TAB_CONFIG: Array<{ key: TeamMatchesMode; label: string }> = [
  { key: 'schedule', label: 'Расписание' },
  { key: 'results', label: 'Результаты' },
]

const formatFormDate = (value?: string) => {
  if (!value) {
    return '—'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '—'
  }
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${day}.${month}`
}

const FORM_LABEL: Record<ClubSummaryResponse['form'][number]['result'], string> = {
  WIN: 'В',
  DRAW: 'Н',
  LOSS: 'П',
}

const FORM_TONE: Record<ClubSummaryResponse['form'][number]['result'], string> = {
  WIN: 'wins',
  DRAW: 'draws',
  LOSS: 'losses',
}

const GAUGE_SWEEP = 180
const GAUGE_START_ANGLE = 180
const SEGMENT_GAP_DEGREES = 4
const GAUGE_RADIUS = 52
const GAUGE_CENTER = 60

type GaugeSegment = {
  key: 'wins' | 'draws' | 'losses'
  start: number
  end: number
}

const buildGaugeSegments = (stats: ClubSummaryResponse['statistics']): GaugeSegment[] => {
  const total = stats.wins + stats.draws + stats.losses
  if (total <= 0) {
    return []
  }
  type SegmentSource = { key: GaugeSegment['key']; value: number }
  const sources: SegmentSource[] = [
    { key: 'wins', value: stats.wins },
    { key: 'draws', value: stats.draws },
    { key: 'losses', value: stats.losses },
  ]

  const activeSources = sources.filter(source => source.value > 0)
  if (!activeSources.length) {
    return []
  }

  const interiorGap = activeSources.length > 1 ? SEGMENT_GAP_DEGREES : 0
  const edgeGap = activeSources.length > 1 ? SEGMENT_GAP_DEGREES / 2 : 0
  let cursor = edgeGap
  const segments: GaugeSegment[] = []

  activeSources.forEach((source, index) => {
    const sweep = (source.value / total) * GAUGE_SWEEP
    const reduction = index < activeSources.length - 1 ? interiorGap : edgeGap
    const start = cursor
    const end = Math.max(cursor + sweep - reduction, cursor)
    if (end - start <= 0) {
      return
    }
    cursor = end + (index < activeSources.length - 1 ? interiorGap : 0)
    segments.push({ key: source.key, start, end })
  })

  return segments
}

const polarToCartesian = (centerX: number, centerY: number, radius: number, angleInDegrees: number) => {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  }
}

const describeArc = (centerX: number, centerY: number, radius: number, startAngle: number, endAngle: number) => {
  const start = polarToCartesian(centerX, centerY, radius, endAngle)
  const end = polarToCartesian(centerX, centerY, radius, startAngle)
  const sweep = Math.abs(endAngle - startAngle)
  const largeArcFlag = sweep > 180 ? '1' : '0'
  const sweepFlag = endAngle >= startAngle ? '1' : '0'

  return [
    'M',
    start.x.toFixed(3),
    start.y.toFixed(3),
    'A',
    radius,
    radius,
    0,
    largeArcFlag,
    sweepFlag,
    end.x.toFixed(3),
    end.y.toFixed(3),
  ].join(' ')
}

const toAbsoluteAngle = (value: number) => GAUGE_START_ANGLE - value

type CompactMatch = ClubMatchesResponse['s'][number]['m'][number]

type TeamMatchItem = {
  seasonName: string
  match: CompactMatch
}

type TeamMatchGroup = {
  id: string
  seasonName: string
  matches: TeamMatchItem[]
}

const collectTeamMatches = (snapshot?: ClubMatchesResponse): TeamMatchItem[] => {
  if (!snapshot) {
    return []
  }
  const items: TeamMatchItem[] = []
  snapshot.s.forEach(seasonEntry => {
    seasonEntry.m.forEach(match => {
      items.push({
        seasonName: seasonEntry.n,
        match,
      })
    })
  })
  return items
}

const selectMatchesForMode = (
  matches: TeamMatchItem[],
  mode: TeamMatchesMode,
  limit = 5
): TeamMatchItem[] => {
  if (!matches.length) {
    return []
  }

  const allowedStatuses: Record<TeamMatchesMode, Set<MatchStatus>> = {
    schedule: new Set<MatchStatus>(['SCHEDULED', 'LIVE', 'POSTPONED']),
    results: new Set<MatchStatus>(['FINISHED']),
  }

  const filterSet = allowedStatuses[mode]
  const filtered = matches.filter(item => filterSet.has(item.match.st))
  const pickSource = filtered.length ? filtered : matches

  const sorted = pickSource
    .slice()
    .sort((left, right) => {
      const leftTime = Date.parse(left.match.d)
      const rightTime = Date.parse(right.match.d)
      const safeLeft = Number.isNaN(leftTime)
        ? mode === 'schedule'
          ? Number.POSITIVE_INFINITY
          : Number.NEGATIVE_INFINITY
        : leftTime
      const safeRight = Number.isNaN(rightTime)
        ? mode === 'schedule'
          ? Number.POSITIVE_INFINITY
          : Number.NEGATIVE_INFINITY
        : rightTime
      return mode === 'schedule' ? safeLeft - safeRight : safeRight - safeLeft
    })

  return sorted.slice(0, limit)
}

const groupMatchesBySeason = (matches: TeamMatchItem[]): TeamMatchGroup[] => {
  if (!matches.length) {
    return []
  }

  const groups: TeamMatchGroup[] = []
  const map = new Map<string, TeamMatchGroup>()

  matches.forEach(item => {
    const key = item.seasonName
    let group = map.get(key)
    if (!group) {
      group = {
        id: key,
        seasonName: item.seasonName,
        matches: [],
      }
      map.set(key, group)
      groups.push(group)
    }
    group.matches.push(item)
  })

  return groups
}

const getMatchesEmptyMessage = (mode: TeamMatchesMode) =>
  mode === 'schedule'
    ? 'Ближайшие матчи появятся позже — следите за обновлениями.'
    : 'Недавние результаты появятся сразу после завершения игр.'

const MATCH_DATE_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const MATCH_STATUS_LABEL: Record<MatchStatus, string> = {
  SCHEDULED: 'Запланирован',
  LIVE: 'Матч идёт',
  POSTPONED: 'Перенесён',
  FINISHED: 'Завершён',
}

const formatMatchDate = (value: string): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'Дата уточняется'
  }
  return MATCH_DATE_FORMATTER.format(date)
}

const formatScore = (score: CompactMatch['sc']): string => {
  if (score.h === null || score.a === null) {
    return '—'
  }
  return `${score.h}:${score.a}`
}

const getRoot = () => {
  if (typeof document === 'undefined') {
    return null
  }
  let host = document.getElementById('team-view-root')
  if (!host) {
    host = document.createElement('div')
    host.id = 'team-view-root'
    document.body.appendChild(host)
  }
  return host
}

const useBodyScrollLock = (active: boolean) => {
  useEffect(() => {
    if (!active || typeof document === 'undefined') {
      return
    }
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = original
    }
  }, [active])
}

const useEscClose = (enabled: boolean, close: () => void) => {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return
    }
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [enabled, close])
}

const renderAchievements = (summary: ClubSummaryResponse) => {
  if (summary.achievements.length === 0) {
    return (
      <div className="team-achievements-empty" role="status">
        Достижения клуба появятся после публикации администратором.
      </div>
    )
  }
  return (
    <ul className="team-achievements-list">
      {summary.achievements.map(item => (
        <li key={item.id} className="team-achievement">
          <span className="team-achievement-title">{item.title}</span>
          {item.subtitle && <span className="team-achievement-subtitle">{item.subtitle}</span>}
        </li>
      ))}
    </ul>
  )
}

const renderForm = (summary: ClubSummaryResponse) => {
  if (summary.form.length === 0) {
    return (
      <div className="team-form-empty" role="status">
        У клуба пока нет сыгранных матчей.
      </div>
    )
  }
  return (
    <div className="team-form-compact">
      {summary.form.map(entry => {
        const tone = FORM_TONE[entry.result]
        const resultLabel = FORM_LABEL[entry.result]
        const formattedDate = formatFormDate(entry.matchDateTime)
        return (
          <div key={entry.matchId} className="team-form-item">
            <span className="team-form-date-compact">{formattedDate}</span>
            <div className="team-form-match">
              {entry.opponent.logoUrl ? (
                <img
                  src={entry.opponent.logoUrl}
                  alt=""
                  aria-hidden="true"
                  className="team-form-logo"
                />
              ) : (
                <span className="team-form-logo fallback" aria-hidden="true">
                  {entry.opponent.shortName.slice(0, 2).toUpperCase()}
                </span>
              )}
              <span className={`team-form-result-badge tone-${tone}`}>{resultLabel}</span>
            </div>
            <span className="team-form-score-compact">
              {entry.score.home}-{entry.score.away}
            </span>
          </div>
        )
      })}
    </div>
  )
}

const renderSquad = (summary: ClubSummaryResponse) => {
  if (!summary.squad || summary.squad.length === 0) {
    return (
      <div className="team-view-feedback" role="status">
        Информация о составе команды пока недоступна.
      </div>
    )
  }

  return (
    <div className="team-squad-table-wrapper">
      <div role="table" className="team-squad-table">
        <div role="row" className="team-squad-row head">
          <span role="columnheader" className="col-num">#</span>
          <span role="columnheader" className="col-player">Игрок</span>
          <span role="columnheader" className="col-stat">И</span>
          <span role="columnheader" className="col-stat">ЖК</span>
          <span role="columnheader" className="col-stat">КК</span>
          <span role="columnheader" className="col-stat">П</span>
          <span role="columnheader" className="col-stat">Г</span>
        </div>
        {summary.squad.map((player, index) => (
          <div role="row" className="team-squad-row" key={player.playerId}>
            <span role="cell" className="col-num">{index + 1}</span>
            <span role="cell" className="col-player">{player.playerName}</span>
            <span role="cell" className="col-stat">{player.matches}</span>
            <span role="cell" className="col-stat">{player.yellowCards}</span>
            <span role="cell" className="col-stat">{player.redCards}</span>
            <span role="cell" className="col-stat">{player.assists}</span>
            <span role="cell" className="col-stat">{player.goals}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const renderOverview = (summary: ClubSummaryResponse) => {
  const stats = summary.statistics
  const gaugeSegments = buildGaugeSegments(stats)
  const trackPath = describeArc(GAUGE_CENTER, GAUGE_CENTER, GAUGE_RADIUS, GAUGE_START_ANGLE, 0)

  return (
    <>
      <section className="team-section">
        <h3 className="team-section-title">Форма</h3>
        {renderForm(summary)}
      </section>

      <div className="team-divider" />

      <section className="team-section">
        <h3 className="team-section-title">Статистика</h3>

        <div className="team-stats-wide-block">
          <div className="team-stats-matches">
            <div className="team-stats-gauge" aria-hidden="true">
              <svg viewBox="0 0 120 70" focusable="false">
                <path className="team-stats-gauge-track" d={trackPath} />
                {gaugeSegments.map(segment => {
                  const start = toAbsoluteAngle(segment.start)
                  const end = toAbsoluteAngle(segment.end)
                  if (Number.isNaN(start) || Number.isNaN(end) || start === end) {
                    return null
                  }
                  return (
                    <path
                      key={`${segment.key}-${segment.start.toFixed(3)}-${segment.end.toFixed(3)}`}
                      className={`team-stats-gauge-segment tone-${segment.key}`}
                      d={describeArc(GAUGE_CENTER, GAUGE_CENTER, GAUGE_RADIUS, start, end)}
                    />
                  )
                })}
              </svg>
              <div className="team-stats-gauge-value">
                <span className="team-stats-matches-value">{stats.matchesPlayed}</span>
                <span className="team-stats-matches-label">матча</span>
              </div>
            </div>
          </div>
          <div className="team-stats-wdl">
            <div className="team-stats-wdl-item">
              <span className="team-stats-wdl-bullet tone-wins" aria-hidden="true" />
              <span className="team-stats-wdl-label">Победы</span>
              <span className="team-stats-wdl-value">{stats.wins}</span>
            </div>
            <div className="team-stats-wdl-item">
              <span className="team-stats-wdl-bullet tone-draws" aria-hidden="true" />
              <span className="team-stats-wdl-label">Ничьи</span>
              <span className="team-stats-wdl-value">{stats.draws}</span>
            </div>
            <div className="team-stats-wdl-item">
              <span className="team-stats-wdl-bullet tone-losses" aria-hidden="true" />
              <span className="team-stats-wdl-label">Поражения</span>
              <span className="team-stats-wdl-value">{stats.losses}</span>
            </div>
          </div>
        </div>

        <div className="team-stats-grid">
          <div className="team-stats-card">
            <span className="team-stats-card-icon">🏆</span>
            <span className="team-stats-card-value">{stats.tournaments}</span>
            <span className="team-stats-card-label">Турниры</span>
          </div>
          <div className="team-stats-card">
            <span className="team-stats-card-icon">⚽</span>
            <span className="team-stats-card-value">{stats.goalsFor}</span>
            <span className="team-stats-card-label">Забито</span>
          </div>
          <div className="team-stats-card">
            <span className="team-stats-card-icon">⚽</span>
            <span className="team-stats-card-value">{stats.goalsAgainst}</span>
            <span className="team-stats-card-label">Пропущено</span>
          </div>
          <div className="team-stats-card">
            <span className="team-stats-card-icon">🟨</span>
            <span className="team-stats-card-value">{stats.yellowCards}</span>
            <span className="team-stats-card-label">Жёлтых</span>
          </div>
          <div className="team-stats-card">
            <span className="team-stats-card-icon">🟥</span>
            <span className="team-stats-card-value">{stats.redCards}</span>
            <span className="team-stats-card-label">Красных</span>
          </div>
          <div className="team-stats-card">
            <span className="team-stats-card-icon">🛡️</span>
            <span className="team-stats-card-value">{stats.cleanSheets}</span>
            <span className="team-stats-card-label">На «0»</span>
          </div>
        </div>
      </section>

      <div className="team-divider" />

      <section className="team-section">
        <h3 className="team-section-title">Достижения</h3>
        {renderAchievements(summary)}
      </section>
    </>
  )
}

type TeamMatchesListProps = {
  mode: TeamMatchesMode
  data?: ClubMatchesResponse
  loading: boolean
  error?: string
  onRetry: () => void
}

const MATCH_STATUS_BADGE: Record<MatchStatus, string> = {
  SCHEDULED: 'scheduled',
  LIVE: 'live',
  POSTPONED: 'postponed',
  FINISHED: 'finished',
}

const TeamMatchesList: React.FC<TeamMatchesListProps> = ({ mode, data, loading, error, onRetry }) => {
  const matches = useMemo(() => collectTeamMatches(data), [data])
  const selectedMatches = useMemo(() => selectMatchesForMode(matches, mode, 5), [matches, mode])
  const groups = useMemo(() => groupMatchesBySeason(selectedMatches), [selectedMatches])

  const isInitialLoading = loading && (!data || data.s.length === 0)
  const emptyMessage = getMatchesEmptyMessage(mode)
  const isRefreshing = loading && groups.length > 0

  if (isInitialLoading) {
    return (
      <div className="league-rounds-placeholder" aria-live="polite" aria-busy="true">
        <div className="skeleton skeleton-heading" />
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
      </div>
    )
  }

  if (error && groups.length === 0) {
    return (
      <div className="inline-feedback error" role="alert">
        <div>Не удалось загрузить данные. Код: {error}</div>
        <button type="button" className="button-secondary" onClick={onRetry}>
          Повторить
        </button>
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div className="inline-feedback info" role="status">
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className="team-matches-groups" data-refreshing={isRefreshing || undefined}>
      {error && (
        <div className="team-view-feedback warning" role="status">
          Показаны сохранённые данные. Последняя попытка загрузки завершилась с ошибкой: {error}
        </div>
      )}

      {groups.map(group => (
        <article className="league-round-card team-matches-group" key={group.id}>
          <header className="league-round-card-header">
            <h3>{group.seasonName}</h3>
            <span className="league-round-chip">
              {mode === 'schedule' ? 'Ближайшие матчи' : 'Недавние матчи'}
            </span>
          </header>
          <div className="league-round-card-body">
            {group.matches.map(item => {
              const match = item.match
              const badgeTone = MATCH_STATUS_BADGE[match.st]
              const cardModifier = match.st === 'LIVE' ? 'live' : match.st === 'POSTPONED' ? 'postponed' : undefined
              const cardClasses = ['league-match-card', 'team-match-card']
              if (cardModifier) {
                cardClasses.push(cardModifier)
              }
              return (
                <div className={cardClasses.join(' ')} key={`${match.d}-${match.h.n}-${match.a.n}`}>
                  <div className="league-match-top">
                    <span className="match-datetime">{formatMatchDate(match.d)}</span>
                    <span className={`match-badge${badgeTone ? ` ${badgeTone}` : ''}`}>
                      {MATCH_STATUS_LABEL[match.st]}
                    </span>
                  </div>
                  <div className="league-match-main compact">
                    <div className="league-match-team compact-team">
                      <span className="team-name">{match.h.n}</span>
                    </div>
                    <div className="league-match-score">
                      <span className="score-main">{formatScore(match.sc)}</span>
                    </div>
                    <div className="league-match-team compact-team">
                      <span className="team-name">{match.a.n}</span>
                    </div>
                  </div>
                  {match.r ? (
                    <div className="team-match-meta">
                      <span className="team-match-round">{match.r}</span>
                      <span className="team-match-season">{item.seasonName}</span>
                    </div>
                  ) : (
                    <div className="team-match-meta">
                      <span className="team-match-season">{item.seasonName}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </article>
      ))}
    </div>
  )
}

export const TeamView: React.FC = () => {
  const open = useAppStore(state => state.teamView.open)
  const clubId = useAppStore(state => state.teamView.clubId)
  const activeTab = useAppStore(state => state.teamView.activeTab)
  const matchesMode = useAppStore(state => state.teamView.matchesMode)
  const close = useAppStore(state => state.closeTeamView)
  const setTab = useAppStore(state => state.setTeamSubTab)
  const setMatchesMode = useAppStore(state => state.setTeamMatchesMode)
  const summaries = useAppStore(state => state.teamSummaries)
  const loadingId = useAppStore(state => state.teamSummaryLoadingId)
  const errors = useAppStore(state => state.teamSummaryErrors)
  const fetchSummary = useAppStore(state => state.fetchClubSummary)
  const fetchMatches = useAppStore(state => state.fetchClubMatches)
  const matchesMap = useAppStore(state => state.teamMatches)
  const matchesLoadingId = useAppStore(state => state.teamMatchesLoadingId)
  const matchesErrorsMap = useAppStore(state => state.teamMatchesErrors)

  const matchesData = clubId !== undefined ? matchesMap[clubId] : undefined
  const matchesLoading = clubId !== undefined && matchesLoadingId === clubId
  const matchesError = clubId !== undefined ? matchesErrorsMap[clubId] : undefined

  const summary = clubId !== undefined ? summaries[clubId] : undefined
  const isLoading = clubId !== undefined && loadingId === clubId
  const error = clubId !== undefined ? errors[clubId] : undefined

  useBodyScrollLock(open)
  useEscClose(open, close)

  const closeButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (open && closeButtonRef.current) {
      closeButtonRef.current.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open || !clubId) {
      return
    }
    if (!summary && !isLoading && !error) {
      void fetchSummary(clubId)
    }
  }, [open, clubId, summary, isLoading, error, fetchSummary])

  useEffect(() => {
    if (!open || !clubId) {
      return
    }
    if (!matchesData && !matchesLoading && !matchesError) {
      void fetchMatches(clubId)
    }
  }, [open, clubId, matchesData, matchesLoading, matchesError, fetchMatches])

  const host = useMemo(getRoot, [])
  const handleRetryMatches = () => {
    if (!clubId) {
      return
    }
    void fetchMatches(clubId, { force: true })
  }

  if (!open || !clubId || !host) {
    return null
  }

  const handleRetry = () => {
    if (clubId) {
      void fetchSummary(clubId, { force: true })
    }
  }

  const renderContent = () => {
    if (isLoading && !summary) {
      return (
        <div className="team-view-feedback" aria-busy="true">
          Загружаем данные клуба…
        </div>
      )
    }

    if (error && !summary) {
      return (
        <div className="team-view-feedback error" role="alert">
          <p>Не удалось получить данные клуба. Код: {error}</p>
          <button type="button" className="button-secondary" onClick={handleRetry}>
            Повторить
          </button>
        </div>
      )
    }

    if (!summary) {
      return null
    }

    const clubSummary = summary as ClubSummaryResponse

    if (activeTab === 'overview') {
      return (
        <>
          {error && (
            <div className="team-view-feedback warning" role="status">
              Показаны сохранённые данные. Последний запрос завершился с ошибкой: {error}
            </div>
          )}
          {renderOverview(clubSummary)}
        </>
      )
    }

    if (activeTab === 'squad') {
      return renderSquad(clubSummary)
    }

    if (activeTab === 'matches') {
      return (
        <section className="team-matches-section">
          <div className="team-matches-tabs" role="tablist" aria-label="Режим просмотра матчей">
            {MATCH_TAB_CONFIG.map(tab => (
              <button
                key={tab.key}
                type="button"
                className={`team-matches-tab${matchesMode === tab.key ? ' active' : ''}`}
                onClick={() => setMatchesMode(tab.key)}
                aria-pressed={matchesMode === tab.key}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <TeamMatchesList
            mode={matchesMode}
            data={matchesData}
            loading={matchesLoading}
            error={matchesError}
            onRetry={handleRetryMatches}
          />
        </section>
      )
    }

    return null
  }

  const header = summary ?? null
  return createPortal(
    <div className="team-view-backdrop" role="presentation" onClick={close}>
      <section
        className="team-view-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-view-title"
        onClick={event => event.stopPropagation()}
      >
        <header className="team-view-header">
          {header?.club.logoUrl ? (
            <img
              src={header.club.logoUrl}
              alt={`Логотип клуба ${header.club.name}`}
              className="team-view-logo"
            />
          ) : (
            <span className="team-view-logo fallback" aria-hidden>
              {header?.club.shortName.slice(0, 2).toUpperCase() ?? '??'}
            </span>
          )}
          <h2 id="team-view-title" className="sr-only">{header?.club.name ?? 'Клуб'}</h2>
          <button
            type="button"
            className="team-view-close"
            onClick={close}
            ref={closeButtonRef}
            aria-label="Закрыть"
          >
            ✕
          </button>
        </header>

        <nav className="team-view-tabs" aria-label="Разделы клуба">
          {TAB_CONFIG.map(tab => (
            <button
              key={tab.key}
              type="button"
              className={`team-view-tab${tab.key === activeTab ? ' active' : ''}`}
              onClick={() => setTab(tab.key)}
              aria-pressed={tab.key === activeTab}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="team-view-body">{renderContent()}</div>
      </section>
    </div>,
    host
  )
}
