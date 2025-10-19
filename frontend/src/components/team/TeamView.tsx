import React, { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ClubSummaryResponse, LeagueRoundCollection } from '@shared/types'
import { useAppStore, TeamSubTab, TeamMatchesMode } from '../../store/appStore'
import { LeagueRoundsView } from '../league/LeagueRoundsView'
import '../../styles/teamView.css'

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

const GAUGE_START_ANGLE = -90
const GAUGE_SWEEP = 180
const SEGMENT_GAP_DEGREES = 4

type GaugeSegment = {
  key: 'wins' | 'draws' | 'losses'
  start: number
  end: number
}

const polarToCartesian = (centerX: number, centerY: number, radius: number, angleInDegrees: number) => {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180
  const x = centerX + radius * Math.cos(angleInRadians)
  const y = centerY + radius * Math.sin(angleInRadians)
  return { x, y }
}

const describeArc = (centerX: number, centerY: number, radius: number, startAngle: number, endAngle: number) => {
  const start = polarToCartesian(centerX, centerY, radius, endAngle)
  const end = polarToCartesian(centerX, centerY, radius, startAngle)
  const sweep = endAngle - startAngle
  const largeArcFlag = sweep > 180 ? '1' : '0'
  const sweepFlag = sweep >= 0 ? '1' : '0'
  const precision = (value: number) => Number(value.toFixed(3))
  return [
    'M',
    precision(start.x),
    precision(start.y),
    'A',
    radius,
    radius,
    0,
    largeArcFlag,
    sweepFlag,
    precision(end.x),
    precision(end.y),
  ].join(' ')
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

  const gap = activeSources.length > 1 ? SEGMENT_GAP_DEGREES : 0
  let cursor = GAUGE_START_ANGLE
  const segments: GaugeSegment[] = []

  activeSources.forEach((source, index) => {
    const sweep = (source.value / total) * GAUGE_SWEEP
    const rawStart = cursor
    const rawEnd = cursor + sweep
    const hasNext = index < activeSources.length - 1
    const start = index > 0 ? rawStart + gap : rawStart
    const end = hasNext ? rawEnd - gap : rawEnd
    cursor = rawEnd
    if (end - start <= 0) {
      return
    }
    segments.push({ key: source.key, start, end })
  })

  return segments
}

const filterCollectionByClub = (
  collection: LeagueRoundCollection | undefined,
  clubId?: number
): LeagueRoundCollection | undefined => {
  if (!collection || !clubId) {
    return undefined
  }

  const filteredRounds = collection.rounds
    .map(round => {
      const matches = round.matches.filter(
        match => match.homeClub.id === clubId || match.awayClub.id === clubId
      )
      if (!matches.length) {
        return null
      }
      return {
        ...round,
        matches,
      }
    })
    .filter((round): round is NonNullable<typeof round> => Boolean(round))

  return {
    ...collection,
    rounds: filteredRounds,
  }
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
                <path
                  className="team-stats-gauge-track"
                  d={describeArc(60, 60, 52, GAUGE_START_ANGLE, GAUGE_START_ANGLE + GAUGE_SWEEP)}
                />
                {gaugeSegments.map(segment => (
                  <path
                    key={segment.key}
                    className={`team-stats-gauge-segment tone-${segment.key}`}
                    d={describeArc(60, 60, 52, segment.start, segment.end)}
                  />
                ))}
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
  const fetchSchedule = useAppStore(state => state.fetchLeagueSchedule)
  const fetchResults = useAppStore(state => state.fetchLeagueResults)
  const schedules = useAppStore(state => state.schedules)
  const resultsMap = useAppStore(state => state.results)
  const loadingState = useAppStore(state => state.loading)
  const errorsState = useAppStore(state => state.errors)
  const resolvedSeasonId = useAppStore(
    state => state.selectedSeasonId ?? state.activeSeasonId
  )

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
    if (!open || !clubId || activeTab !== 'matches' || !resolvedSeasonId) {
      return
    }
    void fetchSchedule({ seasonId: resolvedSeasonId })
    void fetchResults({ seasonId: resolvedSeasonId })
  }, [open, clubId, activeTab, resolvedSeasonId, fetchSchedule, fetchResults])

  const host = useMemo(getRoot, [])

  const seasonSchedule = useMemo(
    () => (resolvedSeasonId ? schedules[resolvedSeasonId] : undefined),
    [resolvedSeasonId, schedules]
  )
  const seasonResults = useMemo(
    () => (resolvedSeasonId ? resultsMap[resolvedSeasonId] : undefined),
    [resolvedSeasonId, resultsMap]
  )

  const scheduleForClub = useMemo(
    () => filterCollectionByClub(seasonSchedule, clubId),
    [seasonSchedule, clubId]
  )
  const resultsForClub = useMemo(
    () => filterCollectionByClub(seasonResults, clubId),
    [seasonResults, clubId]
  )

  const matchesData = matchesMode === 'schedule' ? scheduleForClub : resultsForClub
  const matchesLoading = matchesMode === 'schedule' ? loadingState.schedule : loadingState.results
  const matchesError = matchesMode === 'schedule' ? errorsState.schedule : errorsState.results

  const handleRetryMatches = () => {
    if (!resolvedSeasonId) {
      return
    }
    if (matchesMode === 'schedule') {
      void fetchSchedule({ seasonId: resolvedSeasonId, force: true })
    } else {
      void fetchResults({ seasonId: resolvedSeasonId, force: true })
    }
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
      if (!resolvedSeasonId) {
        return (
          <div className="team-view-feedback" role="status">
            Активный сезон не выбран. Откройте вкладку «Лига», чтобы выбрать сезон.
          </div>
        )
      }

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
          <LeagueRoundsView
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
