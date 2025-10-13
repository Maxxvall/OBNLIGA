import React from 'react'
import type { LeagueMatchView, LeagueRoundCollection } from '@shared/types'
import '../../styles/leagueRounds.css'

type LeagueRoundsViewProps = {
  mode: 'schedule' | 'results'
  data?: LeagueRoundCollection
  loading: boolean
  error?: string
  onRetry: () => void
  lastUpdated?: number
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
    }
  }

  return {
    dateTime: fullLabel,
    score: '—',
    detail: null,
    badge: null,
    modifier: undefined,
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

  const { season, rounds } = data
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
        <div className="inline-feedback info" role="status">
          {getEmptyMessage(mode)}
        </div>
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
                            {match.homeClub.logoUrl ? (
                              <img
                                src={match.homeClub.logoUrl}
                                alt={`Логотип клуба ${match.homeClub.name}`}
                                className="club-logo"
                              />
                            ) : (
                              <span className="club-logo fallback" aria-hidden>
                                {homeName.slice(0, 2).toUpperCase()}
                              </span>
                            )}
                            <span className="team-name">{homeName}</span>
                          </div>
                          <div className="league-match-score">
                            <span className="score-main">{descriptor.score}</span>
                            {descriptor.detail && (
                              <span className="score-detail">{descriptor.detail}</span>
                            )}
                          </div>
                          <div className="league-match-team">
                            {match.awayClub.logoUrl ? (
                              <img
                                src={match.awayClub.logoUrl}
                                alt={`Логотип клуба ${match.awayClub.name}`}
                                className="club-logo"
                              />
                            ) : (
                              <span className="club-logo fallback" aria-hidden>
                                {awayName.slice(0, 2).toUpperCase()}
                              </span>
                            )}
                            <span className="team-name">{awayName}</span>
                          </div>
                        </div>
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
