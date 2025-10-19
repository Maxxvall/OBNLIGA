import type { LeagueMatchView } from '@shared/types'

export type MatchMode = 'schedule' | 'results'

const TIME_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
})

export const parseMatchDateTime = (
  value: string
): {
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

export const buildLocationLabel = (match: LeagueMatchView): string => {
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

export type MatchSeriesDescriptor = {
  stageName: string
  seriesScore: string
}

const buildSeriesDescriptor = (
  match: LeagueMatchView,
  mode: MatchMode
): MatchSeriesDescriptor | null => {
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

export type MatchDescriptor = {
  dateTime: string
  score: string
  detail: string | null
  badge: { label: string; tone: 'postponed' | 'live' } | null
  modifier?: 'postponed' | 'live'
  series?: MatchSeriesDescriptor | null
}

export const buildMatchDescriptor = (match: LeagueMatchView, mode: MatchMode): MatchDescriptor => {
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
      modifier: 'postponed',
      series: buildSeriesDescriptor(match, mode),
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
