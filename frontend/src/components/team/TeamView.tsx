import React, { CSSProperties, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ClubMatchesResponse, ClubSummaryResponse, LeagueMatchView } from '@shared/types'
import { useAppStore, TeamSubTab, TeamMatchesMode } from '../../store/appStore'
import { buildMatchDescriptor } from '../../utils/matchPresentation'
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
    return ''
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
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
  WIN: 'win',
  DRAW: 'draw',
  LOSS: 'loss',
}

const GAUGE_SWEEP = 180
const SEGMENT_GAP_DEGREES = 4
const GAUGE_TRACK_COLOR = 'var(--team-gauge-track)'
const GAUGE_SEGMENT_COLORS: Record<GaugeSegment['key'], string> = {
  wins: 'var(--team-gauge-win)',
  draws: 'var(--team-gauge-draw)',
  losses: 'var(--team-gauge-loss)',
}

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

const buildGaugeGradient = (segments: GaugeSegment[]): string => {
  if (!segments.length) {
    return `conic-gradient(from 180deg, ${GAUGE_TRACK_COLOR} 0deg ${GAUGE_SWEEP}deg, transparent ${GAUGE_SWEEP}deg 360deg)`
  }

  const stops: string[] = []
  let cursor = 0

  segments.forEach(segment => {
    if (segment.start > cursor) {
      stops.push(
        `${GAUGE_TRACK_COLOR} ${cursor.toFixed(3)}deg ${segment.start.toFixed(3)}deg`
      )
    }
    const color = GAUGE_SEGMENT_COLORS[segment.key]
    stops.push(
      `${color} ${segment.start.toFixed(3)}deg ${segment.end.toFixed(3)}deg`
    )
    cursor = segment.end
  })

  if (cursor < GAUGE_SWEEP) {
    stops.push(
      `${GAUGE_TRACK_COLOR} ${cursor.toFixed(3)}deg ${GAUGE_SWEEP.toFixed(3)}deg`
    )
  }

  stops.push(`transparent ${GAUGE_SWEEP}deg 360deg`)
  return `conic-gradient(from 180deg, ${stops.join(', ')})`
}

type TeamMatchItem = {
  match: LeagueMatchView
  roundLabel: string
  roundType: 'REGULAR' | 'PLAYOFF' | null
  competitionName: string
  seasonName: string
  seasonId: number
}

type TeamMatchGroup = {
  id: string
  competitionName: string
  seasonName: string
  matches: TeamMatchItem[]
}

const collectTeamMatches = (snapshot?: ClubMatchesResponse): TeamMatchItem[] => {
  if (!snapshot) {
    return []
  }

  const items: TeamMatchItem[] = []
  snapshot.seasons.forEach(seasonEntry => {
    const competitionName = seasonEntry.season.competition.name
    const seasonName = seasonEntry.season.name
    const seasonId = seasonEntry.season.id

    seasonEntry.rounds.forEach(round => {
      round.matches.forEach(match => {
        items.push({
          match,
          roundLabel: round.roundLabel,
          roundType: round.roundType,
          competitionName,
          seasonName,
          seasonId,
        })
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

  const allowedStatuses: Record<TeamMatchesMode, Set<LeagueMatchView['status']>> = {
    schedule: new Set(['SCHEDULED', 'LIVE', 'POSTPONED']),
    results: new Set(['FINISHED']),
  }

  const filterSet = allowedStatuses[mode]
  const filtered = matches.filter(item => filterSet.has(item.match.status))

  const pickSource = filtered.length ? filtered : matches

  const sorted = pickSource
    .slice()
    .sort((a, b) => {
      const aTime = Date.parse(a.match.matchDateTime)
      const bTime = Date.parse(b.match.matchDateTime)
      const safeA = Number.isNaN(aTime)
        ? mode === 'schedule'
          ? Number.POSITIVE_INFINITY
          : Number.NEGATIVE_INFINITY
        : aTime
      const safeB = Number.isNaN(bTime)
        ? mode === 'schedule'
          ? Number.POSITIVE_INFINITY
          : Number.NEGATIVE_INFINITY
        : bTime
      return mode === 'schedule' ? safeA - safeB : safeB - safeA
    })

  return sorted.slice(0, limit)
}

const groupMatchesByCompetition = (matches: TeamMatchItem[]): TeamMatchGroup[] => {
  if (!matches.length) {
    return []
  }

  const groups: TeamMatchGroup[] = []
  const map = new Map<string, TeamMatchGroup>()

  matches.forEach(item => {
    const key = `${item.seasonId}:${item.competitionName}`
    let group = map.get(key)
    if (!group) {
      group = {
        id: key,
        competitionName: item.competitionName,
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

const getMatchesEmptyMessage = (mode: TeamMatchesMode) => {
  return mode === 'schedule'
    ? 'Ближайшие матчи появятся позже — следите за обновлениями.'
    : 'Недавние результаты появятся сразу после завершения игр.'
}

const buildLocationLabelCompact = (match: LeagueMatchView): string | null => {
  const city = match.location?.city?.trim()
  const stadium = match.location?.stadiumName?.trim()
  const parts = [city, stadium].filter(Boolean)
  if (!parts.length) {
    return null
  }
  return parts.join(' · ')
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
  const gaugeGradient = buildGaugeGradient(gaugeSegments)
  const gaugeStyle: CSSProperties & Record<'--team-gauge-fill', string> = {
    '--team-gauge-fill': gaugeGradient,
  }

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
              <div className="team-stats-gauge-arc" style={gaugeStyle}>
                <div className="team-stats-gauge-layer team-stats-gauge-track" />
                <div className="team-stats-gauge-layer team-stats-gauge-fill" />
              </div>
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

const TeamMatchesList: React.FC<TeamMatchesListProps> = ({ mode, data, loading, error, onRetry }) => {
  const openTeamView = useAppStore(state => state.openTeamView)
  const openMatchDetails = useAppStore(state => state.openMatchDetails)

  const matches = useMemo(() => collectTeamMatches(data), [data])
  const selectedMatches = useMemo(() => selectMatchesForMode(matches, mode, 5), [matches, mode])
  const groups = useMemo(() => groupMatchesByCompetition(selectedMatches), [selectedMatches])

  const isInitialLoading = loading && (!data || data.seasons.length === 0)
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
            <h3>{group.competitionName}</h3>
            <span className="team-match-season-label">{group.seasonName}</span>
            <span className="league-round-chip">{mode === 'schedule' ? 'Расписание' : 'Результаты'}</span>
          </header>
          <div className="league-round-card-body">
            {group.matches.map(item => {
              const descriptor = buildMatchDescriptor(item.match, mode)
              const cardClasses = ['league-match-card', 'team-match-card']
              if (descriptor.modifier) {
                cardClasses.push(descriptor.modifier)
              }
              const homeName = item.match.homeClub.name
              const awayName = item.match.awayClub.name
              const locationLabel = buildLocationLabelCompact(item.match)
              return (
                <div
                  className={cardClasses.join(' ')}
                  key={item.match.id}
                  onClick={() => openMatchDetails(item.match.id, item.match, item.seasonId)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="league-match-top">
                    <span className="match-datetime">{descriptor.dateTime}</span>
                    {descriptor.badge && (
                      <span className={`match-badge ${descriptor.badge.tone}`}>{descriptor.badge.label}</span>
                    )}
                  </div>
                  <div className="league-match-main">
                    <div className="league-match-team">
                      <button
                        type="button"
                        className="club-logo-button"
                        onClick={event => {
                          event.stopPropagation()
                          openTeamView(item.match.homeClub.id)
                        }}
                        aria-label={`Открыть страницу клуба ${item.match.homeClub.name}`}
                      >
                        {item.match.homeClub.logoUrl ? (
                          <img src={item.match.homeClub.logoUrl} alt="" aria-hidden="true" className="club-logo" />
                        ) : (
                          <span className="club-logo fallback" aria-hidden="true">
                            {homeName.slice(0, 2).toUpperCase()}
                          </span>
                        )}
                      </button>
                      <span className="team-name">{homeName}</span>
                    </div>
                    <div className="league-match-score">
                      <span className="score-main">{descriptor.score}</span>
                      {descriptor.detail && <span className="score-detail">{descriptor.detail}</span>}
                    </div>
                    <div className="league-match-team">
                      <button
                        type="button"
                        className="club-logo-button"
                        onClick={event => {
                          event.stopPropagation()
                          openTeamView(item.match.awayClub.id)
                        }}
                        aria-label={`Открыть страницу клуба ${item.match.awayClub.name}`}
                      >
                        {item.match.awayClub.logoUrl ? (
                          <img src={item.match.awayClub.logoUrl} alt="" aria-hidden="true" className="club-logo" />
                        ) : (
                          <span className="club-logo fallback" aria-hidden="true">
                            {awayName.slice(0, 2).toUpperCase()}
                          </span>
                        )}
                      </button>
                      <span className="team-name">{awayName}</span>
                    </div>
                  </div>
                  {descriptor.series ? (
                    <div className="series-info">
                      <span className="series-label">Счёт в серии</span>
                      <span className="series-score">{descriptor.series.seriesScore}</span>
                    </div>
                  ) : null}
                  {locationLabel ? (
                    <div className="league-match-location">
                      <span>{locationLabel}</span>
                    </div>
                  ) : null}
                  <div className="team-match-meta">
                    <span className="team-match-round">{item.roundLabel}</span>
                    <span className="team-match-season">{item.seasonName}</span>
                  </div>
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
