import React, { useMemo } from 'react'
import type { Club, MatchSeries, MatchSummary } from '../types'
import { formatDateTime } from '../utils/date'

type PlayoffBracketProps = {
  series: MatchSeries[]
  matches: MatchSummary[]
  clubs: Club[]
}

type StageSeries = {
  id: string
  stageName: string
  seriesStatus: MatchSeries['seriesStatus']
  isBye: boolean
  winnerClubId?: number | null
  homeClub?: Club
  awayClub?: Club
  homeClubId: number
  awayClubId: number
  summary: {
    homeLabel: string
    awayLabel: string
    mode: 'wins' | 'score'
  }
  matches: Array<{
    id: string
    label: string
    kickoff: string
    status: MatchSummary['status']
    scoreLabel: string
  }>
  order: number
}

type StageBucket = {
  stageName: string
  rank: number
  series: StageSeries[]
}

const stageSortValue = (stageName: string): number => {
  const normalized = stageName.toLowerCase()
  const fraction = stageName.match(/1\/(\d+)/i)
  if (fraction) {
    const denom = Number(fraction[1])
    if (Number.isFinite(denom)) {
      return denom * 2
    }
  }
  const teamsMatch = stageName.match(/(\d+)\s*(команд|участ|teams?)/iu)
  if (teamsMatch) {
    const teams = Number(teamsMatch[1])
    if (Number.isFinite(teams) && teams > 0) {
      return teams
    }
  }
  if (normalized.includes('четверть')) return 8
  if (normalized.includes('quarter')) return 8
  if (normalized.includes('полуфин')) return 4
  if (normalized.includes('semi')) return 4
  if (normalized.includes('финал')) return 2
  if (normalized.includes('final')) return 2
  return 1000
}

const formatScoreLabel = (match: MatchSummary): string => {
  if (match.status === 'SCHEDULED' || match.status === 'POSTPONED') {
    return '—'
  }
  return `${match.homeScore}:${match.awayScore}`
}

const formatKickoff = (iso: string): string =>
  formatDateTime(iso, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

const summarizeSeries = (
  seriesMatches: MatchSummary[]
): {
  homeLabel: string
  awayLabel: string
  mode: 'wins' | 'score'
} => {
  if (seriesMatches.length === 0) {
    return { homeLabel: '—', awayLabel: '—', mode: 'score' }
  }
  if (seriesMatches.length === 1) {
    const [single] = seriesMatches
    if (!single) {
      return { homeLabel: '—', awayLabel: '—', mode: 'score' }
    }
    const showScore = single.status !== 'SCHEDULED' && single.status !== 'POSTPONED'
    return {
      homeLabel: showScore ? String(single.homeScore) : '—',
      awayLabel: showScore ? String(single.awayScore) : '—',
      mode: 'score',
    }
  }
  const finished = seriesMatches.filter(
    match => match.status === 'FINISHED' || match.status === 'LIVE'
  )
  const homeWins = finished.filter(match => match.homeScore > match.awayScore).length
  const awayWins = finished.filter(match => match.awayScore > match.homeScore).length
  return {
    homeLabel: homeWins.toString(),
    awayLabel: awayWins.toString(),
    mode: 'wins',
  }
}

export const PlayoffBracket: React.FC<PlayoffBracketProps> = ({ series, matches, clubs }) => {
  const clubMap = useMemo(() => {
    const map = new Map<number, Club>()
    for (const club of clubs) {
      map.set(club.id, club)
    }
    return map
  }, [clubs])

  const matchesBySeriesId = useMemo(() => {
    const map = new Map<string, MatchSummary[]>()
    for (const match of matches) {
      const seriesId = match.seriesId ?? match.series?.id ?? null
      if (!seriesId) continue
      const key = String(seriesId)
      if (!map.has(key)) {
        map.set(key, [])
      }
      map.get(key)!.push(match)
    }
    map.forEach((list, key) => {
      const sorted = [...list].sort((a, b) => {
        const leftNumber = a.seriesMatchNumber ?? 0
        const rightNumber = b.seriesMatchNumber ?? 0
        if (leftNumber !== rightNumber) {
          return leftNumber - rightNumber
        }
        return new Date(a.matchDateTime).getTime() - new Date(b.matchDateTime).getTime()
      })
      map.set(key, sorted)
    })
    return map
  }, [matches])

  const stages = useMemo(() => {
    if (!series.length) return []
    const buckets = new Map<string, StageBucket>()

    for (const item of series) {
      const stageMatches = matchesBySeriesId.get(item.id) ?? []
      const summary = summarizeSeries(stageMatches)
      const homeClub = clubMap.get(item.homeClubId)
      const awayClub = clubMap.get(item.awayClubId)
      const isBye = item.homeClubId === item.awayClubId
      const stageRank = stageSortValue(item.stageName)
      const stageEntry = buckets.get(item.stageName) ?? {
        stageName: item.stageName,
        rank: stageRank,
        series: [] as StageSeries[],
      }
      stageEntry.series.push({
        id: item.id,
        stageName: item.stageName,
        seriesStatus: item.seriesStatus,
        isBye,
        winnerClubId: item.winnerClubId,
        homeClub,
        awayClub,
        homeClubId: item.homeClubId,
        awayClubId: item.awayClubId,
        summary,
        matches: stageMatches.map((match, index) => ({
          id: match.id,
          label:
            match.round?.label?.trim() ||
            (match.seriesMatchNumber ? `Игра ${match.seriesMatchNumber}` : `Матч ${index + 1}`),
          kickoff: formatKickoff(match.matchDateTime),
          status: match.status,
          scoreLabel: formatScoreLabel(match),
        })),
        order: stageMatches[0]
          ? new Date(stageMatches[0].matchDateTime).getTime()
          : Number.MAX_SAFE_INTEGER,
      })
      buckets.set(item.stageName, stageEntry)
    }

    return Array.from(buckets.values())
      .sort((left, right) => {
        if (left.rank !== right.rank) {
          return right.rank - left.rank
        }
        return left.stageName.localeCompare(right.stageName, 'ru')
      })
      .map(stage => ({
        ...stage,
        series: stage.series.sort((left, right) => left.order - right.order),
      }))
  }, [clubMap, matchesBySeriesId, series])

  if (!series.length) {
    return <p className="muted">Серии плей-офф ещё не созданы.</p>
  }

  if (!stages.length) {
    return <p className="muted">Данных по матчам плей-офф пока нет.</p>
  }

  return (
    <div className="bracket-grid">
      {stages.map(stage => (
        <div className="bracket-stage" key={stage.stageName}>
          <h5>{stage.stageName}</h5>
          <ul>
            {stage.series.map(item => {
              const homeName = item.homeClub?.name ?? `Клуб #${item.homeClubId}`
              const awayName = item.awayClub?.name ?? `Клуб #${item.awayClubId}`
              const winnerId = item.winnerClubId ?? (item.isBye ? item.homeClubId : undefined)
              return (
                <li
                  key={item.id}
                  className={`bracket-series status-${item.seriesStatus.toLowerCase()}${item.isBye ? ' bye' : ''}`}
                >
                  <div className="series-team">
                    <span
                      className={`team-name${winnerId && winnerId === item.homeClubId ? ' winner' : ''}`}
                    >
                      {homeName}
                    </span>
                    <span className="team-score">{item.summary.homeLabel}</span>
                  </div>
                  <div className="series-team">
                    <span
                      className={`team-name${winnerId && winnerId === item.awayClubId ? ' winner' : ''}`}
                    >
                      {awayName}
                    </span>
                    <span className="team-score">{item.summary.awayLabel}</span>
                  </div>
                  {item.isBye ? (
                    <p className="series-note">Автоматом проходит дальше.</p>
                  ) : (
                    <ol className="series-matches">
                      {item.matches.map(match => (
                        <li key={match.id}>
                          <span className="match-label">{match.label}</span>
                          <span className="match-meta">{match.kickoff}</span>
                          <span className={`match-score status-${match.status.toLowerCase()}`}>
                            {match.scoreLabel}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}
