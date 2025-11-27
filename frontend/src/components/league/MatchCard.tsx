import React from 'react'
import type { LeagueMatchView } from '@shared/types'
import { buildLocationLabel, buildMatchDescriptor } from '../../utils/matchPresentation'

type MatchCardProps = {
  match: LeagueMatchView
  mode: 'schedule' | 'results'
  isLiveActivated: boolean
  isScoreUpdated: boolean
  onMatchClick: (matchId: string, match: LeagueMatchView, seasonId?: number) => void
  onTeamClick: (clubId: number) => void
  seasonId?: number
}

const MatchCardInner: React.FC<MatchCardProps> = ({
  match,
  mode,
  isLiveActivated,
  isScoreUpdated,
  onMatchClick,
  onTeamClick,
  seasonId,
}) => {
  const descriptor = buildMatchDescriptor(match, mode)
  const homeName = match.homeClub.name
  const awayName = match.awayClub.name
  const location = buildLocationLabel(match)
  
  const cardClasses = ['league-match-card']
  if (descriptor.modifier) {
    cardClasses.push(descriptor.modifier)
  }
  if (isLiveActivated) {
    cardClasses.push('live-activated')
  }
  const scoreClassName = `league-match-score${isScoreUpdated ? ' score-updated' : ''}`

  const handleCardClick = () => {
    onMatchClick(match.id, match, seasonId)
  }

  const handleHomeTeamClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onTeamClick(match.homeClub.id)
  }

  const handleAwayTeamClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onTeamClick(match.awayClub.id)
  }

  return (
    <div
      className={cardClasses.join(' ')}
      onClick={handleCardClick}
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
            onClick={handleHomeTeamClick}
            aria-label={`Открыть страницу клуба ${homeName}`}
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
        <div className={scoreClassName}>
          <span className="score-main">{descriptor.score}</span>
          {descriptor.detail && (
            <span className="score-detail">{descriptor.detail}</span>
          )}
        </div>
        <div className="league-match-team">
          <button
            type="button"
            className="club-logo-button"
            onClick={handleAwayTeamClick}
            aria-label={`Открыть страницу клуба ${awayName}`}
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
}

// Мемоизация компонента для предотвращения лишних перерендеров
// Перерендер происходит только при изменении данных матча или состояния анимаций
export const MatchCard = React.memo(MatchCardInner, (prevProps, nextProps) => {
  // Проверяем изменения ключевых пропсов
  if (prevProps.isLiveActivated !== nextProps.isLiveActivated) return false
  if (prevProps.isScoreUpdated !== nextProps.isScoreUpdated) return false
  if (prevProps.mode !== nextProps.mode) return false
  if (prevProps.seasonId !== nextProps.seasonId) return false
  
  // Проверяем изменения данных матча
  const prevMatch = prevProps.match
  const nextMatch = nextProps.match
  if (prevMatch.id !== nextMatch.id) return false
  if (prevMatch.status !== nextMatch.status) return false
  if (prevMatch.homeScore !== nextMatch.homeScore) return false
  if (prevMatch.awayScore !== nextMatch.awayScore) return false
  if (prevMatch.homeClub.id !== nextMatch.homeClub.id) return false
  if (prevMatch.awayClub.id !== nextMatch.awayClub.id) return false
  if (prevMatch.homeClub.logoUrl !== nextMatch.homeClub.logoUrl) return false
  if (prevMatch.awayClub.logoUrl !== nextMatch.awayClub.logoUrl) return false
  
  // Если ничего не изменилось — не перерендерить
  return true
})

MatchCard.displayName = 'MatchCard'
