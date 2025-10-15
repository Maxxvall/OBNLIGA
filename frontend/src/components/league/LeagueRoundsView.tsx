import React from 'react'
import type { LeagueMatchView, LeagueRoundCollection } from '@shared/types'
import { useAppStore } from '../../store/appStore'
import '../../styles/leagueRounds.css'

type LeagueRoundsViewProps = {
  mode: 'schedule' | 'results'
  data?: LeagueRoundCollection
  loading: boolean
  error?: string
  onRetry: () => void
  lastUpdated?: number
}

type PlayoffPodiumSummary = {
  champion: { club: LeagueMatchView['homeClub'] }
  runnerUp: { club: LeagueMatchView['homeClub'] }
  thirdPlace?: { club: LeagueMatchView['homeClub'] }
}

const TIME_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
})

const parseMatchDateTime = (value: string): {
  isValid: boolean
  fullLabel: string
} => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return {
      isValid: false,
      fullLabel: 'Дата уточняется',
    }
  }
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = String(date.getFullYear()).slice(-2)
  return {
    isValid: true,
    fullLabel: `${day}.${month}.${year} ${TIME_FORMATTER.format(date)}`,
  }
}

const buildLocationLabel = (match: LeagueMatchView): string => {
  const { location } = match
  if (!location) {
    return 'Локация уточняется'
  }
  const parts = [location.city, location.stadiumName].filter(Boolean)
  if (parts.length === 0) {
    return 'Локация уточняется'
  }
  return parts.join(' · ')
}

const buildSeriesDescriptor = (match: LeagueMatchView, mode: 'schedule' | 'results') => {
  const { series } = match
  if (!series) {
    return null
  }

  const useAfter = mode === 'results' || match.status === 'FINISHED'
  const leftIsSeriesHome = match.homeClub.id === series.homeClubId

  const leftWinsBefore = leftIsSeriesHome ? series.homeWinsBefore : series.awayWinsBefore
  const leftWinsAfter = leftIsSeriesHome ? series.homeWinsAfter : series.awayWinsAfter
  const rightWinsBefore = leftIsSeriesHome ? series.awayWinsBefore : series.homeWinsBefore
  const rightWinsAfter = leftIsSeriesHome ? series.awayWinsAfter : series.homeWinsAfter

  const leftWins = useAfter ? leftWinsAfter : leftWinsBefore
  const rightWins = useAfter ? rightWinsAfter : rightWinsBefore

  return {
    stageName: series.stageName,
    seriesScore: `${leftWins}-${rightWins}`,
  }
}

const buildMatchDescriptor = (match: LeagueMatchView, mode: 'schedule' | 'results') => {
  const { fullLabel } = parseMatchDateTime(match.matchDateTime)
  const isLive = match.status === 'LIVE'
  const isFinished = match.status === 'FINISHED'
  const isPostponed = match.status === 'POSTPONED'

  const badge = isPostponed
    ? { label: 'Перенесён', tone: 'postponed' as const }
    : isLive
      ? { label: 'Матч идёт', tone: 'live' as const }
      : null

  if (isPostponed) {
    return {
      dateTime: fullLabel,
      score: '—',
      detail: null,
      badge,
      modifier: 'postponed' as const,
    }
  }

  if (mode === 'results' || isFinished || isLive) {
    const score = `${match.homeScore} : ${match.awayScore}`
    const penalty =
      match.hasPenaltyShootout &&
      match.penaltyHomeScore !== null &&
      match.penaltyAwayScore !== null
        ? `Пенальти ${match.penaltyHomeScore}:${match.penaltyAwayScore}`
        : null
    return {
      dateTime: fullLabel,
      score,
      detail: penalty,
      badge,
      modifier: isLive ? 'live' : undefined,
      series: buildSeriesDescriptor(match, mode),
    }
  }

  return {
    dateTime: fullLabel,
    score: '—',
    detail: null,
    badge: null,
    modifier: undefined,
    series: buildSeriesDescriptor(match, mode),
  }
}

const formatUpdatedLabel = (timestamp?: number): string => {
  if (!timestamp) {
    return 'Актуальные данные'
  }
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    return 'Актуальные данные'
  }
  return `Обновлено в ${TIME_FORMATTER.format(date)}`
}

const getEmptyMessage = (mode: 'schedule' | 'results'): string => {
  if (mode === 'schedule') {
    return 'Подходящих матчей пока нет — следите за обновлениями.'
  }
  return 'Результаты матчей появятся сразу после завершения игр.'
}

export const LeagueRoundsView: React.FC<LeagueRoundsViewProps> = ({
  mode,
  data,
  loading,
  error,
  onRetry,
  lastUpdated,
}) => {
  const openTeamView = useAppStore(state => state.openTeamView)
  const tablesBySeason = useAppStore(state => state.tables)
  const resultsBySeason = useAppStore(state => state.results)
  const seasonId = data?.season.id ?? null
  const seasonTable = seasonId ? tablesBySeason[seasonId] : undefined
  const seasonResults = seasonId ? resultsBySeason[seasonId] : undefined
  const rounds = data?.rounds ?? []
  const hasFinishedMatches = seasonResults
    ? seasonResults.rounds.some(round => round.matches.length > 0)
    : false
  const podium = seasonTable ? seasonTable.standings.slice(0, 3) : []

  const playoffState = React.useMemo<{
    hasSeries: boolean
    allSeriesFinished: boolean
    summary: PlayoffPodiumSummary | null
  }>(() => {
    if (!seasonResults) {
      return {
        hasSeries: false,
        allSeriesFinished: false,
        summary: null,
      }
    }

    const seriesById = new Map<string, NonNullable<LeagueMatchView['series']>>()
    let hasSeries = false
    let allSeriesFinished = true

    for (const round of seasonResults.rounds) {
      for (const match of round.matches) {
        if (!match.series) {
          continue
        }

        hasSeries = true
        if (match.series.status !== 'FINISHED') {
          allSeriesFinished = false
        }

        const existing = seriesById.get(match.series.id)
        if (!existing || existing.status !== 'FINISHED') {
          seriesById.set(match.series.id, match.series)
        }
        if (match.series.status === 'FINISHED') {
          seriesById.set(match.series.id, match.series)
        }
      }
    }

    if (!hasSeries || !seriesById.size) {
      return { hasSeries: false, allSeriesFinished: false, summary: null }
    }

    const detectFinal = (series: NonNullable<LeagueMatchView['series']>) => {
      const normalized = series.stageName.toLowerCase()
      const isSemi = normalized.includes('1/2') || normalized.includes('semi') || normalized.includes('полу')
      return !isSemi && normalized.includes('финал')
    }

    const detectThird = (series: NonNullable<LeagueMatchView['series']>) => {
      const normalized = series.stageName.toLowerCase()
      return normalized.includes('3') && normalized.includes('мест')
    }

    let finalSeries: NonNullable<LeagueMatchView['series']> | undefined
    let thirdSeries: NonNullable<LeagueMatchView['series']> | undefined

    for (const item of seriesById.values()) {
      if (!finalSeries && detectFinal(item)) {
        finalSeries = item
      }
      if (!thirdSeries && detectThird(item)) {
        thirdSeries = item
      }
    }

    if (!finalSeries || finalSeries.status !== 'FINISHED' || finalSeries.winnerClubId == null) {
      return { hasSeries: true, allSeriesFinished, summary: null }
    }

    const championIsHome = finalSeries.winnerClubId === finalSeries.homeClubId
    const championClub = championIsHome ? finalSeries.homeClub : finalSeries.awayClub
    const runnerClub = championIsHome ? finalSeries.awayClub : finalSeries.homeClub

    let thirdPlace: { club: LeagueMatchView['homeClub'] } | undefined
    if (thirdSeries && thirdSeries.status === 'FINISHED' && thirdSeries.winnerClubId != null) {
      const thirdIsHome = thirdSeries.winnerClubId === thirdSeries.homeClubId
      const thirdClub = thirdIsHome ? thirdSeries.homeClub : thirdSeries.awayClub
      thirdPlace = {
        club: thirdClub,
      }
    }

    return {
      hasSeries: true,
      allSeriesFinished,
      summary: {
        champion: {
          club: championClub,
        },
        runnerUp: {
          club: runnerClub,
        },
        thirdPlace,
      },
    }
  }, [seasonResults])

  if (loading) {
    return (
      <div className="league-rounds-placeholder" aria-live="polite" aria-busy="true">
        <div className="skeleton skeleton-heading" />
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="inline-feedback error" role="alert">
        <div>Не удалось загрузить данные. Код: {error}</div>
        <button type="button" className="button-secondary" onClick={onRetry}>
          Повторить
        </button>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="inline-feedback info" role="status">
        {getEmptyMessage(mode)}
      </div>
    )
  }

  const { season } = data
  const seasonEndTime = Number.isNaN(Date.parse(season.endDate)) ? null : Date.parse(season.endDate)
  const allowTableFallback = !playoffState.hasSeries && (!season.isActive || (seasonEndTime !== null && Date.now() > seasonEndTime))

  const showCompletedState =
    mode === 'schedule' &&
    rounds.length === 0 &&
    hasFinishedMatches &&
    ((playoffState.hasSeries && playoffState.allSeriesFinished && playoffState.summary) ||
      (allowTableFallback && podium.length >= 3))
  const headerTitle = mode === 'schedule' ? 'Календарь матчей' : 'Результаты'
  const updatedLabel = formatUpdatedLabel(lastUpdated)

  return (
    <section className="league-rounds" aria-label={headerTitle}>
      <header className="league-rounds-header">
        <div className="league-rounds-header-primary">
          <h2>{headerTitle}</h2>
          <p>{season.name}</p>
        </div>
        <span className="muted">{updatedLabel}</span>
      </header>

      {rounds.length === 0 ? (
        showCompletedState ? (
          <div className="league-rounds-grid">
            <div className="tournament-finished" role="status">
              <h3>ТУРНИР ЗАВЕРШЕН</h3>
              <div className="podium-grid">
                {(playoffState.summary
                  ? [
                      {
                        key: `runner-${playoffState.summary.runnerUp.club.id}`,
                        tone: 'second' as const,
                        icon: '🥈',
                        club: playoffState.summary.runnerUp.club,
                      },
                      {
                        key: `champion-${playoffState.summary.champion.club.id}`,
                        tone: 'first' as const,
                        icon: '🥇',
                        club: playoffState.summary.champion.club,
                      },
                      ...(playoffState.summary.thirdPlace
                        ? [
                            {
                              key: `third-${playoffState.summary.thirdPlace.club.id}`,
                              tone: 'third' as const,
                              icon: '🥉',
                              club: playoffState.summary.thirdPlace.club,
                            },
                          ]
                        : []),
                    ]
                  : podium.slice(0, 3).map((entry, index) => ({
                      key: `table-${entry.clubId}`,
                      tone: index === 0 ? ('first' as const) : index === 1 ? ('second' as const) : ('third' as const),
                      icon: index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉',
                      club: {
                        id: entry.clubId,
                        name: entry.clubName,
                        shortName: entry.clubShortName,
                        logoUrl: entry.clubLogoUrl,
                      },
                    })))
                  .map(slot => (
                    <div key={slot.key} className={`podium-slot ${slot.tone}`}>
                      <span className="podium-icon" aria-hidden="true">{slot.icon}</span>
                      <div className="podium-logo" aria-hidden="true">
                        {slot.club.logoUrl ? (
                          <img src={slot.club.logoUrl} alt="" />
                        ) : (
                          <span className="podium-logo-fallback">{slot.club.name.slice(0, 2).toUpperCase()}</span>
                        )}
                      </div>
                      <span className="podium-team">{slot.club.name}</span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="inline-feedback info" role="status">
            {getEmptyMessage(mode)}
          </div>
        )
      ) : (
        <div className="league-rounds-grid">
          {rounds.map(round => {
            const roundKey = round.roundId ?? round.roundLabel
            const roundTypeLabel = round.roundType === 'PLAYOFF' ? 'Плей-офф' : null
            return (
              <article className="league-round-card" key={roundKey}>
                <header className="league-round-card-header">
                  <h3>{round.roundLabel}</h3>
                  {roundTypeLabel && <span className="league-round-chip">{roundTypeLabel}</span>}
                </header>
                <div className="league-round-card-body">
                  {round.matches.map(match => {
                    const descriptor = buildMatchDescriptor(match, mode)
                    const homeName = match.homeClub.name
                    const awayName = match.awayClub.name
                    const location = buildLocationLabel(match)
                    return (
                      <div
                        className={`league-match-card${descriptor.modifier ? ` ${descriptor.modifier}` : ''}`}
                        key={match.id}
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
                              onClick={() => openTeamView(match.homeClub.id)}
                              aria-label={`Открыть страницу клуба ${match.homeClub.name}`}
                            >
                              {match.homeClub.logoUrl ? (
                                <img
                                  src={match.homeClub.logoUrl}
                                  alt=""
                                  aria-hidden="true"
                                  className="club-logo"
                                />
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
                            {descriptor.detail && (
                              <span className="score-detail">{descriptor.detail}</span>
                            )}
                          </div>
                          <div className="league-match-team">
                            <button
                              type="button"
                              className="club-logo-button"
                              onClick={() => openTeamView(match.awayClub.id)}
                              aria-label={`Открыть страницу клуба ${match.awayClub.name}`}
                            >
                              {match.awayClub.logoUrl ? (
                                <img
                                  src={match.awayClub.logoUrl}
                                  alt=""
                                  aria-hidden="true"
                                  className="club-logo"
                                />
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
                        <div className="league-match-location">
                          <span>{location}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
