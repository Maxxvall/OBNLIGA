import React from 'react'
import type { LeagueMatchView, LeagueRoundCollection } from '@shared/types'
import { useAppStore } from '../../store/appStore'
import { MatchCard } from './MatchCard'
import '../../styles/leagueRounds.css'

type LeagueRoundsViewProps = {
  mode: 'schedule' | 'results'
  data?: LeagueRoundCollection
  loading: boolean
  error?: string
  onRetry: () => void
  onLazyLoadRound?: (roundKey: string, force?: boolean) => void
  roundLoading?: Record<string, boolean>
  roundErrors?: Record<string, string | undefined>
}

type PlayoffPodiumSummary = {
  champion: { club: LeagueMatchView['homeClub'] }
  runnerUp: { club: LeagueMatchView['homeClub'] }
  thirdPlace?: { club: LeagueMatchView['homeClub'] }
}

const getEmptyMessage = (mode: 'schedule' | 'results'): string => {
  if (mode === 'schedule') {
    return 'Подходящих матчей пока нет — следите за обновлениями.'
  }
  return 'Результаты матчей появятся сразу после завершения игр.'
}

const ROUND_DATE_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

const LIVE_HIGHLIGHT_DURATION = 2200
const SCORE_HIGHLIGHT_DURATION = 1400

type MatchSnapshot = {
  status: LeagueMatchView['status']
  homeScore: number | null
  awayScore: number | null
}

const matchSnapshotCache = new Map<string, Map<string, MatchSnapshot>>()

const buildSnapshotCacheKey = (
  mode: 'schedule' | 'results',
  collection?: LeagueRoundCollection
): string | null => {
  if (!collection || !collection.season?.id) {
    return null
  }
  return `${mode}:${collection.season.id}`
}

const useMatchAnimations = (mode: 'schedule' | 'results', collection?: LeagueRoundCollection) => {
  const snapshotsRef = React.useRef<Map<string, MatchSnapshot>>(new Map())
  const liveTimersRef = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const scoreTimersRef = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const [liveHighlightIds, setLiveHighlightIds] = React.useState<Set<string>>(new Set())
  const [scoreHighlightIds, setScoreHighlightIds] = React.useState<Set<string>>(new Set())

  React.useEffect(() => {
    if (!collection) {
      snapshotsRef.current.clear()
      liveTimersRef.current.forEach(clearTimeout)
      liveTimersRef.current.clear()
      scoreTimersRef.current.forEach(clearTimeout)
      scoreTimersRef.current.clear()
      setLiveHighlightIds(prev => (prev.size ? new Set<string>() : prev))
      setScoreHighlightIds(prev => (prev.size ? new Set<string>() : prev))
      return
    }

    const cacheKey = buildSnapshotCacheKey(mode, collection)

    if (cacheKey && snapshotsRef.current.size === 0) {
      const cached = matchSnapshotCache.get(cacheKey)
      if (cached) {
        snapshotsRef.current = new Map(cached)
      }
    }

    const previous = snapshotsRef.current
    const next = new Map<string, MatchSnapshot>()
    const seenIds = new Set<string>()
    const liveActivated: Set<string> = new Set()
    const scoreChanged: Set<string> = new Set()

    const roundsList = collection.rounds ?? []
    for (const round of roundsList) {
      for (const match of round.matches) {
        seenIds.add(match.id)
        const prevSnapshot = previous.get(match.id)
        const current: MatchSnapshot = {
          status: match.status,
          homeScore: match.homeScore ?? null,
          awayScore: match.awayScore ?? null,
        }

        if (prevSnapshot) {
          if (current.status === 'LIVE' && prevSnapshot.status !== 'LIVE') {
            liveActivated.add(match.id)
          }
          if (
            prevSnapshot.homeScore !== current.homeScore ||
            prevSnapshot.awayScore !== current.awayScore
          ) {
            scoreChanged.add(match.id)
          }
        }

        next.set(match.id, current)
      }
    }

    const removedIds: string[] = []
    previous.forEach((_, id) => {
      if (!seenIds.has(id)) {
        removedIds.push(id)
      }
    })

    snapshotsRef.current = next
    if (cacheKey) {
      matchSnapshotCache.set(cacheKey, new Map(next))
    }

    if (removedIds.length) {
      setLiveHighlightIds(prev => {
        if (!removedIds.some(id => prev.has(id))) {
          return prev
        }
        const updated = new Set(prev)
        removedIds.forEach(id => updated.delete(id))
        return updated
      })
      setScoreHighlightIds(prev => {
        if (!removedIds.some(id => prev.has(id))) {
          return prev
        }
        const updated = new Set(prev)
        removedIds.forEach(id => updated.delete(id))
        return updated
      })
      removedIds.forEach(id => {
        const liveTimer = liveTimersRef.current.get(id)
        if (liveTimer) {
          clearTimeout(liveTimer)
          liveTimersRef.current.delete(id)
        }
        const scoreTimer = scoreTimersRef.current.get(id)
        if (scoreTimer) {
          clearTimeout(scoreTimer)
          scoreTimersRef.current.delete(id)
        }
      })
    }

    if (liveActivated.size) {
      const ids = Array.from(liveActivated)
      setLiveHighlightIds(prev => {
        let changed = false
        const updated = new Set(prev)
        ids.forEach(id => {
          if (!updated.has(id)) {
            updated.add(id)
            changed = true
          }
        })
        return changed ? updated : prev
      })
      ids.forEach(id => {
        const existing = liveTimersRef.current.get(id)
        if (existing) {
          clearTimeout(existing)
        }
        const timeout = setTimeout(() => {
          setLiveHighlightIds(prev => {
            if (!prev.has(id)) {
              return prev
            }
            const trimmed = new Set(prev)
            trimmed.delete(id)
            return trimmed
          })
          liveTimersRef.current.delete(id)
        }, LIVE_HIGHLIGHT_DURATION)
        liveTimersRef.current.set(id, timeout)
      })
    }

    if (scoreChanged.size) {
      const ids = Array.from(scoreChanged)
      setScoreHighlightIds(prev => {
        let changed = false
        const updated = new Set(prev)
        ids.forEach(id => {
          if (!updated.has(id)) {
            updated.add(id)
            changed = true
          }
        })
        return changed ? updated : prev
      })
      ids.forEach(id => {
        const existing = scoreTimersRef.current.get(id)
        if (existing) {
          clearTimeout(existing)
        }
        const timeout = setTimeout(() => {
          setScoreHighlightIds(prev => {
            if (!prev.has(id)) {
              return prev
            }
            const trimmed = new Set(prev)
            trimmed.delete(id)
            return trimmed
          })
          scoreTimersRef.current.delete(id)
        }, SCORE_HIGHLIGHT_DURATION)
        scoreTimersRef.current.set(id, timeout)
      })
    }
  }, [collection, mode])

  React.useEffect(
    () => () => {
      liveTimersRef.current.forEach(clearTimeout)
      scoreTimersRef.current.forEach(clearTimeout)
    },
    []
  )

  return { liveHighlightIds, scoreHighlightIds }
}

export const LeagueRoundsView: React.FC<LeagueRoundsViewProps> = ({
  mode,
  data,
  loading,
  error,
  onRetry,
  onLazyLoadRound,
  roundLoading,
  roundErrors,
}) => {
  const openTeamView = useAppStore(state => state.openTeamView)
  const openMatchDetails = useAppStore(state => state.openMatchDetails)
  const tablesBySeason = useAppStore(state => state.tables)
  const resultsBySeason = useAppStore(state => state.results)
  const { liveHighlightIds, scoreHighlightIds } = useMatchAnimations(mode, data)
  const seasonId = data?.season.id ?? null
  const seasonTable = seasonId ? tablesBySeason[seasonId] : undefined
  const seasonResults = seasonId ? resultsBySeason[seasonId] : undefined
  const rounds = data?.rounds ?? []
  const hasFinishedMatches = seasonResults
    ? seasonResults.rounds.some(round => round.matches.length > 0)
    : false
  const podium = seasonTable ? seasonTable.standings.slice(0, 3) : []
  const [expandedRounds, setExpandedRounds] = React.useState<Set<string>>(() => new Set())
  const roundLoadingMap = roundLoading ?? {}
  const roundErrorMap = roundErrors ?? {}

  const requestRoundData = React.useCallback(
    (roundKey: string, force?: boolean) => {
      if (onLazyLoadRound) {
        onLazyLoadRound(roundKey, force)
      }
    },
    [onLazyLoadRound]
  )

  React.useEffect(() => {
    setExpandedRounds(new Set())
  }, [mode, data?.season.id])

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

    // Проверяем, есть ли кубковый формат с Gold/Silver
    const hasCupFormat = Array.from(seriesById.values()).some(
      (s) => s.stageName.toLowerCase().includes('золот') || s.stageName.toLowerCase().includes('серебр')
    )

    const detectFinal = (series: NonNullable<LeagueMatchView['series']>) => {
      const normalized = series.stageName.toLowerCase()
      const isSemi = normalized.includes('1/2') || normalized.includes('semi') || normalized.includes('полу')
      // Для кубков с Gold/Silver - ищем "Финал Золотого кубка"
      if (hasCupFormat) {
        return normalized.includes('финал') && normalized.includes('золот')
      }
      return !isSemi && normalized.includes('финал')
    }

    const detectThird = (series: NonNullable<LeagueMatchView['series']>) => {
      const normalized = series.stageName.toLowerCase()
      // Для кубков с Gold/Silver - ищем "3 место Золотого кубка"
      if (hasCupFormat) {
        return normalized.includes('3') && normalized.includes('мест') && normalized.includes('золот')
      }
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

  const isInitialLoading = loading && !data
  if (isInitialLoading) {
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
  // Для кубков не показываем чемпиона по таблице — только по плей-офф серии
  const isCup = season.competition?.type === 'CUP'
  const allowTableFallback = !isCup && !playoffState.hasSeries && (!season.isActive || (seasonEndTime !== null && Date.now() > seasonEndTime))

  const showCompletedState =
    mode === 'schedule' &&
    rounds.length === 0 &&
    hasFinishedMatches &&
    ((playoffState.hasSeries && playoffState.allSeriesFinished && playoffState.summary) ||
      (allowTableFallback && podium.length >= 3))
  const headerTitle = mode === 'schedule' ? 'Календарь матчей' : 'Результаты'
  const isRefreshing = loading && Boolean(data)

  return (
    <section
      className="league-rounds"
      aria-label={headerTitle}
      data-refreshing={isRefreshing || undefined}
    >
      <header className="league-rounds-header">
        <div className="league-rounds-header-primary">
          <h2>{headerTitle}</h2>
          <p>{season.name}</p>
        </div>
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
          {rounds.map((round, index) => {
            const computedKey = round.roundKey ?? (round.roundId !== null ? `id-${round.roundId}` : `${round.roundLabel}-${index}`)
            const roundKey = computedKey || `${round.roundLabel}-${index}`
            const roundTypeLabel = round.roundType === 'PLAYOFF' ? 'Плей-офф' : null
            const isResultsMode = mode === 'results'
            const isExpanded = !isResultsMode || expandedRounds.has(roundKey)
            const matchesCount = round.matchesCount ?? round.matches.length
            const isRoundLoading = Boolean(roundLoadingMap[roundKey])
            const roundError = roundErrorMap[roundKey]
            const hasStoredMatches = round.matches.length > 0
            const shouldRequestData = matchesCount > 0 && !hasStoredMatches
            const bodyId = `round-${encodeURIComponent(roundKey)}-body`

            const firstDate = round.firstMatchAt ? new Date(round.firstMatchAt) : null
            const lastDate = round.lastMatchAt ? new Date(round.lastMatchAt) : null
            let summaryText: string | null = null
            if (firstDate && !Number.isNaN(firstDate.valueOf())) {
              if (lastDate && !Number.isNaN(lastDate.valueOf())) {
                const sameDay = firstDate.toDateString() === lastDate.toDateString()
                summaryText = sameDay
                  ? ROUND_DATE_FORMAT.format(firstDate)
                  : `${ROUND_DATE_FORMAT.format(firstDate)} - ${ROUND_DATE_FORMAT.format(lastDate)}`
              } else {
                summaryText = ROUND_DATE_FORMAT.format(firstDate)
              }
            } else if (lastDate && !Number.isNaN(lastDate.valueOf())) {
              summaryText = ROUND_DATE_FORMAT.format(lastDate)
            }

            const toggleRound = () => {
              if (!isResultsMode) {
                return
              }
              setExpandedRounds(prev => {
                const next = new Set(prev)
                if (next.has(roundKey)) {
                  next.delete(roundKey)
                } else {
                  next.add(roundKey)
                  if (shouldRequestData && !isRoundLoading) {
                    requestRoundData(roundKey)
                  }
                }
                return next
              })
            }

            const handleRetry = () => {
              requestRoundData(roundKey, true)
            }

            const shouldShowBody = !isResultsMode || isExpanded

            let bodyContent: React.ReactNode = null
            if (shouldShowBody) {
              if (isRoundLoading) {
                bodyContent = (
                  <div className="round-loading muted" role="status">
                    Загружаем тур…
                  </div>
                )
              } else if (roundError) {
                bodyContent = (
                  <div className="inline-feedback error" role="alert">
                    <div>Не удалось загрузить данные тура. Код: {roundError}</div>
                    <button type="button" className="button-secondary" onClick={handleRetry}>
                      Повторить
                    </button>
                  </div>
                )
              } else if (!hasStoredMatches && matchesCount > 0) {
                bodyContent = (
                  <div className="inline-feedback info" role="status">
                    Раскройте тур, чтобы загрузить список матчей.
                  </div>
                )
              } else if (round.matches.length === 0) {
                bodyContent = (
                  <div className="inline-feedback info" role="status">
                    {getEmptyMessage(mode)}
                  </div>
                )
              } else {
                bodyContent = (
                  <div className="league-round-card-body" id={isResultsMode ? bodyId : undefined}>
                    {round.matches.map(match => (
                      <MatchCard
                        key={match.id}
                        match={match}
                        mode={mode}
                        isLiveActivated={liveHighlightIds.has(match.id)}
                        isScoreUpdated={scoreHighlightIds.has(match.id)}
                        onMatchClick={openMatchDetails}
                        onTeamClick={openTeamView}
                        seasonId={data?.season.id}
                      />
                    ))}
                  </div>
                )
              }
            }

            return (
              <article
                className={`league-round-card${isResultsMode ? ' collapsible' : ''}${isExpanded ? ' expanded' : ''}`}
                key={roundKey}
              >
                <header className="league-round-card-header">
                  {isResultsMode ? (
                    <button
                      type="button"
                      className="round-toggle"
                      onClick={toggleRound}
                      aria-expanded={isExpanded}
                      aria-controls={bodyId}
                    >
                      <span className="round-toggle-icon" aria-hidden>
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          {isExpanded ? (
                            <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                          ) : (
                            <>
                              <line x1="5" y1="0" x2="5" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                              <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            </>
                          )}
                        </svg>
                      </span>
                      <span className="round-header-main">
                        <span className="round-title">{round.roundLabel}</span>
                        <span className="round-meta">
                          <span>{`Матчей: ${matchesCount}`}</span>
                          {summaryText && <span className="round-summary">{summaryText}</span>}
                        </span>
                      </span>
                    </button>
                  ) : (
                    <>
                      <h3>{round.roundLabel}</h3>
                      {summaryText && <span className="round-summary">{summaryText}</span>}
                    </>
                  )}
                  {roundTypeLabel && <span className="league-round-chip">{roundTypeLabel}</span>}
                </header>
                {bodyContent}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
