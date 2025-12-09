import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FRIENDLY_SEASON_ID, FRIENDLY_SEASON_NAME } from '@shared/types'
import { LeagueTableView } from '../components/league/LeagueTableView'
import { LeagueRoundsView } from '../components/league/LeagueRoundsView'
import { LeagueStatsView } from '../components/league/LeagueStatsView'
import { LeagueSubTab, useAppStore } from '../store/appStore'
import type { LeagueSeasonSummary } from '@shared/types'
import { useAdaptivePolling } from '../utils/useAdaptivePolling'

const subTabLabels: Record<LeagueSubTab, string> = {
  table: 'Таблица',
  stats: 'Статистика',
  schedule: 'Календарь',
  results: 'Результаты',
}

const SUBTAB_ORDER: LeagueSubTab[] = ['table', 'stats', 'schedule', 'results']

const FRIENDLY_SCHEDULE_REFRESH_INTERVAL_MS = 60_000

type CompetitionGroup = {
  competitionId: number
  competitionName: string
  seasons: LeagueSeasonSummary[]
}

type CityGroup = {
  cityKey: string
  cityLabel: string
  seasonCount: number
  competitions: CompetitionGroup[]
}

const SEASON_RANGE_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
})

const formatSeasonRange = (season: LeagueSeasonSummary): string => {
  const start = new Date(season.startDate)
  const end = new Date(season.endDate)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${season.startDate} — ${season.endDate}`
  }
  return `${SEASON_RANGE_FORMATTER.format(start)} — ${SEASON_RANGE_FORMATTER.format(end)}`
}

const UNKNOWN_CITY_KEY = '__unknown_city__'

const normalizeCityKey = (city?: string | null): string => {
  const value = city?.trim() ?? ''
  if (!value) {
    return UNKNOWN_CITY_KEY
  }
  return value.toLowerCase()
}

const labelForCity = (city?: string | null): string => {
  const value = city?.trim()
  return value && value.length ? value : 'Без города'
}

const competitionKeyFor = (cityKey: string, competitionId: number): string => {
  return `${cityKey}::${competitionId}`
}

const domIdFor = (prefix: string, value: string): string => {
  return `${prefix}-${encodeURIComponent(value)}`
}

const Placeholder: React.FC<{ message: string }> = ({ message }) => (
  <div className="placeholder">
    <div className="placeholder-card">
      <h2>Раздел в разработке</h2>
      <p>{message}</p>
    </div>
  </div>
)

const LeaguePage: React.FC = () => {
  const seasons = useAppStore(state => state.seasons)
  const fetchSeasons = useAppStore(state => state.fetchLeagueSeasons)
  const fetchTable = useAppStore(state => state.fetchLeagueTable)
  const fetchSchedule = useAppStore(state => state.fetchLeagueSchedule)
  const fetchResults = useAppStore(state => state.fetchLeagueResults)
  const fetchStats = useAppStore(state => state.fetchLeagueStats)
  const setSelectedSeason = useAppStore(state => state.setSelectedSeason)
  const selectedSeasonId = useAppStore(state => state.selectedSeasonId)
  const activeSeasonId = useAppStore(state => state.activeSeasonId)
  const leagueSubTab = useAppStore(state => state.leagueSubTab)
  const currentTab = useAppStore(state => state.currentTab)
  const setLeagueSubTab = useAppStore(state => state.setLeagueSubTab)
  const loadingSeasons = useAppStore(state => state.loading.seasons)
  const loadingTable = useAppStore(state => state.loading.table)
  const loadingSchedule = useAppStore(state => state.loading.schedule)
  const loadingResults = useAppStore(state => state.loading.results)
  const loadingStats = useAppStore(state => state.loading.stats)
  const tableErrors = useAppStore(state => state.errors.table)
  const scheduleErrors = useAppStore(state => state.errors.schedule)
  const resultsErrors = useAppStore(state => state.errors.results)
  const statsErrors = useAppStore(state => state.errors.stats)
  const resultsRoundLoading = useAppStore(state => state.resultsRoundLoading)
  const resultsRoundErrors = useAppStore(state => state.resultsRoundErrors)
  const leagueMenuOpen = useAppStore(state => state.leagueMenuOpen)
  const closeLeagueMenu = useAppStore(state => state.closeLeagueMenu)
  const tables = useAppStore(state => state.tables)
  const schedules = useAppStore(state => state.schedules)
  const results = useAppStore(state => state.results)
  const stats = useAppStore(state => state.stats)
  const friendlyScheduleFetchedAt = useAppStore(
    state => state.scheduleFetchedAt[FRIENDLY_SEASON_ID] ?? 0
  )
  const [expandedCities, setExpandedCities] = useState<Set<string>>(() => new Set())
  const [expandedCompetitions, setExpandedCompetitions] = useState<Set<string>>(
    () => new Set()
  )
  const lastAutoExpandedSeasonId = useRef<number | undefined>(undefined)
  const friendlySchedule = schedules[FRIENDLY_SEASON_ID]
  const friendlyResults = results[FRIENDLY_SEASON_ID]
  const hasFriendliesSchedule = Boolean(
    friendlySchedule?.rounds?.some(round => round.matches.length > 0)
  )
  const friendliesSeasonSummary = hasFriendliesSchedule
    ? friendlySchedule?.season ?? friendlyResults?.season ?? null
    : null
  const shouldShowFriendliesEntry = Boolean(friendliesSeasonSummary)
  const friendliesRangeText = friendliesSeasonSummary
    ? formatSeasonRange(friendliesSeasonSummary)
    : '—'
  const friendliesSubtitle = friendliesSeasonSummary
    ? friendliesSeasonSummary.isActive
      ? 'Матчи идут'
      : 'Последние результаты'
    : loadingSchedule
      ? 'Загружаем…'
      : 'Нет запланированных матчей'
  const isFriendlySelected = selectedSeasonId === FRIENDLY_SEASON_ID

  const selectedSeason = useMemo(() => {
    if (isFriendlySelected) {
      return shouldShowFriendliesEntry ? friendliesSeasonSummary : null
    }
    return seasons.find(season => season.id === selectedSeasonId) ?? null
  }, [friendliesSeasonSummary, isFriendlySelected, seasons, selectedSeasonId, shouldShowFriendliesEntry])

  const cityGroups = useMemo<CityGroup[]>(() => {
    if (seasons.length === 0) {
      return []
    }

    const collator = new Intl.Collator('ru', { sensitivity: 'base' })

    const cityMap = new Map<
      string,
      {
        label: string
        competitions: Map<number, CompetitionGroup>
      }
    >()

    seasons.forEach(season => {
      const cityKey = normalizeCityKey(season.city)
      const cityEntry = cityMap.get(cityKey)
      if (!cityEntry) {
        const competitions = new Map<number, CompetitionGroup>()
        competitions.set(season.competition.id, {
          competitionId: season.competition.id,
          competitionName: season.competition.name,
          seasons: [season],
        })
        cityMap.set(cityKey, {
          label: labelForCity(season.city),
          competitions,
        })
        return
      }

      const competitions = cityEntry.competitions
      const competitionEntry = competitions.get(season.competition.id)
      if (competitionEntry) {
        competitionEntry.seasons.push(season)
        return
      }

      competitions.set(season.competition.id, {
        competitionId: season.competition.id,
        competitionName: season.competition.name,
        seasons: [season],
      })
    })

    const sortedCities = Array.from(cityMap.entries())
      .map(([cityKey, entry]) => {
        const competitions = Array.from(entry.competitions.values())
          .map(group => ({
            ...group,
            seasons: [...group.seasons].sort((left, right) =>
              right.startDate.localeCompare(left.startDate)
            ),
          }))
          .sort((left, right) => collator.compare(left.competitionName, right.competitionName))

        const seasonCount = competitions.reduce(
          (acc, group) => acc + group.seasons.length,
          0
        )

        return {
          cityKey,
          cityLabel: entry.label,
          seasonCount,
          competitions,
        }
      })
      .sort((left, right) => {
        if (left.cityKey === UNKNOWN_CITY_KEY) {
          return 1
        }
        if (right.cityKey === UNKNOWN_CITY_KEY) {
          return -1
        }
        return collator.compare(left.cityLabel, right.cityLabel)
      })

    return sortedCities
  }, [seasons])

  const table = selectedSeasonId ? tables[selectedSeasonId] : undefined
  const scheduleData = selectedSeasonId ? schedules[selectedSeasonId] : undefined
  const resultsData = selectedSeasonId ? results[selectedSeasonId] : undefined
  const statsData = selectedSeasonId ? stats[selectedSeasonId] : undefined

  const { roundLoadingForSeason, roundErrorsForSeason } = useMemo<{
    roundLoadingForSeason: Record<string, boolean>
    roundErrorsForSeason: Record<string, string | undefined>
  }>(() => {
    if (!selectedSeasonId) {
      return { roundLoadingForSeason: {}, roundErrorsForSeason: {} }
    }
    const prefix = `${selectedSeasonId}:`
    const loading: Record<string, boolean> = {}
    Object.entries(resultsRoundLoading).forEach(([key, value]) => {
      if (key.startsWith(prefix)) {
        loading[key.slice(prefix.length)] = value
      }
    })
    const errors: Record<string, string | undefined> = {}
    Object.entries(resultsRoundErrors).forEach(([key, value]) => {
      if (key.startsWith(prefix)) {
        errors[key.slice(prefix.length)] = value
      }
    })
    return { roundLoadingForSeason: loading, roundErrorsForSeason: errors }
  }, [resultsRoundErrors, resultsRoundLoading, selectedSeasonId])

  useEffect(() => {
    setExpandedCities(prev => {
      const validCityKeys = new Set(cityGroups.map(group => group.cityKey))
      const next = new Set<string>()
      let mutated = false

      prev.forEach(key => {
        if (validCityKeys.has(key)) {
          next.add(key)
        } else {
          mutated = true
        }
      })

      if (!mutated && next.size === prev.size) {
        return prev
      }

      const prevArr = Array.from(prev).sort()
      const nextArr = Array.from(next).sort()
      if (!mutated && prevArr.length === nextArr.length && prevArr.every((key, index) => key === nextArr[index])) {
        return prev
      }

      return next
    })

    setExpandedCompetitions(prev => {
      const validCompetitionKeys = new Set<string>()
      cityGroups.forEach(cityGroup => {
        cityGroup.competitions.forEach(group => {
          validCompetitionKeys.add(competitionKeyFor(cityGroup.cityKey, group.competitionId))
        })
      })

      const next = new Set<string>()
      let mutated = false

      prev.forEach(key => {
        if (validCompetitionKeys.has(key)) {
          next.add(key)
        } else {
          mutated = true
        }
      })

      if (!mutated && next.size === prev.size) {
        return prev
      }

      const prevArr = Array.from(prev).sort()
      const nextArr = Array.from(next).sort()
      if (!mutated && prevArr.length === nextArr.length && prevArr.every((key, index) => key === nextArr[index])) {
        return prev
      }

      return next
    })
  }, [cityGroups])

  useEffect(() => {
    if (cityGroups.length === 0) {
      return
    }

    const fallbackSeason = cityGroups[0]?.competitions[0]?.seasons[0]
    const targetSeason = selectedSeason ?? fallbackSeason
    if (!targetSeason) {
      return
    }

    const cityKey = normalizeCityKey(targetSeason.city)
    const groupKey = competitionKeyFor(cityKey, targetSeason.competition.id)

    setExpandedCities(prev => {
      if (selectedSeason) {
        if (prev.has(cityKey)) {
          return prev
        }
        const next = new Set(prev)
        next.add(cityKey)
        return next
      }

      if (prev.size > 0) {
        return prev
      }

      const next = new Set(prev)
      next.add(cityKey)
      return next
    })

    setExpandedCompetitions(prev => {
      if (!selectedSeason && prev.size > 0) {
        return prev
      }

      let next = prev
      if (!prev.has(groupKey)) {
        next = new Set(prev)

        if (selectedSeason && lastAutoExpandedSeasonId.current !== selectedSeason.id) {
          const cityGroup = cityGroups.find(group => group.cityKey === cityKey)
          if (cityGroup) {
            cityGroup.competitions.forEach(group => {
              const key = competitionKeyFor(cityKey, group.competitionId)
              if (key !== groupKey) {
                next.delete(key)
              }
            })
          }
        }

        next.add(groupKey)
      }

      if (selectedSeason) {
        lastAutoExpandedSeasonId.current = selectedSeason.id
      } else {
        lastAutoExpandedSeasonId.current = undefined
      }

      return next
    })
  }, [cityGroups, selectedSeason])

  useEffect(() => {
    if (isFriendlySelected && (leagueSubTab === 'table' || leagueSubTab === 'stats')) {
      setLeagueSubTab('schedule')
    }
  }, [isFriendlySelected, leagueSubTab, setLeagueSubTab])

  useEffect(() => {
    if (!isFriendlySelected || shouldShowFriendliesEntry) {
      return
    }
    const fallbackSeason =
      (activeSeasonId && seasons.find(season => season.id === activeSeasonId))
        ?? seasons.find(season => season.id !== FRIENDLY_SEASON_ID)
        ?? null
    if (fallbackSeason) {
      setSelectedSeason(fallbackSeason.id)
    }
  }, [
    activeSeasonId,
    isFriendlySelected,
    seasons,
    setSelectedSeason,
    shouldShowFriendliesEntry,
  ])

  useEffect(() => {
    void fetchSeasons()
  }, [fetchSeasons])

  const leaguePollingCallback = useCallback(() => {
    if (typeof document !== 'undefined' && document.hidden) {
      return
    }

    if (currentTab !== 'league') {
      return
    }

    const now = Date.now()
    if (now - friendlyScheduleFetchedAt > FRIENDLY_SCHEDULE_REFRESH_INTERVAL_MS) {
      void fetchSchedule({ seasonId: FRIENDLY_SEASON_ID })
    }

    const seasonId = selectedSeasonId ?? activeSeasonId
    if (!seasonId) {
      return
    }

    if (leagueSubTab === 'table') {
      void fetchTable({ seasonId })
      return
    }

    if (leagueSubTab === 'schedule') {
      void fetchSchedule({ seasonId })
      return
    }

    if (leagueSubTab === 'results') {
      void fetchResults({ seasonId })
      return
    }

    if (leagueSubTab === 'stats') {
      if (isFriendlySelected) {
        return
      }
      void fetchStats({ seasonId })
    }
  }, [
    activeSeasonId,
    currentTab,
    fetchResults,
    fetchSchedule,
    fetchStats,
    fetchTable,
    friendlyScheduleFetchedAt,
    isFriendlySelected,
    leagueSubTab,
    selectedSeasonId,
  ])

  useAdaptivePolling(leaguePollingCallback, {
    activeInterval: 30_000,
    inactiveInterval: 120_000,
    backgroundInterval: 300_000,
  })

  useEffect(() => {
    if (selectedSeasonId && !isFriendlySelected) {
      void fetchTable({ seasonId: selectedSeasonId })
    }
  }, [selectedSeasonId, isFriendlySelected, fetchTable])

  useEffect(() => {
    if (!selectedSeasonId) {
      return
    }
    if (leagueSubTab === 'schedule') {
      void fetchSchedule({ seasonId: selectedSeasonId })
    }
    if (leagueSubTab === 'results') {
      void fetchResults({ seasonId: selectedSeasonId })
    }
    if (leagueSubTab === 'stats') {
      if (isFriendlySelected) {
        return
      }
      void fetchStats({ seasonId: selectedSeasonId })
    }
  }, [leagueSubTab, selectedSeasonId, fetchSchedule, fetchResults, fetchStats, isFriendlySelected])

  useEffect(() => {
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeLeagueMenu()
      }
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [closeLeagueMenu])

  const handleSeasonClick = (seasonId: number) => {
    setSelectedSeason(seasonId)
    closeLeagueMenu()
  }

  const handleFriendliesClick = () => {
    setSelectedSeason(FRIENDLY_SEASON_ID)
    setLeagueSubTab('schedule')
    closeLeagueMenu()
  }

  const toggleCity = (cityKey: string) => {
    setExpandedCities(prev => {
      const next = new Set(prev)
      if (next.has(cityKey)) {
        next.delete(cityKey)
      } else {
        next.add(cityKey)
      }
      return next
    })
  }

  const toggleCompetition = (cityKey: string, competitionId: number) => {
    const key = competitionKeyFor(cityKey, competitionId)
    setExpandedCompetitions(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const handleSubTabClick = (tab: LeagueSubTab) => {
    setLeagueSubTab(tab)
  }

  const handleForceReload = () => {
    if (selectedSeasonId && !isFriendlySelected) {
      void fetchTable({ seasonId: selectedSeasonId, force: true })
    }
  }

  const handleScheduleReload = () => {
    if (selectedSeasonId) {
      void fetchSchedule({ seasonId: selectedSeasonId, force: true })
    }
  }

  const handleResultsReload = () => {
    if (selectedSeasonId) {
      void fetchResults({ seasonId: selectedSeasonId, force: true })
    }
  }

  const handleRoundResultsLoad = (roundKey: string, force?: boolean) => {
    if (!selectedSeasonId) {
      return
    }
    void fetchResults({ seasonId: selectedSeasonId, roundKey, force })
  }

  const handleStatsReload = () => {
    if (selectedSeasonId && !isFriendlySelected) {
      void fetchStats({ seasonId: selectedSeasonId, force: true })
    }
  }

  const handleContentClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (leagueMenuOpen && event.target === event.currentTarget) {
      closeLeagueMenu()
    }
  }

  return (
    <div className="league-page">
      <aside className={`league-sidebar${leagueMenuOpen ? ' open' : ''}`} aria-hidden={!leagueMenuOpen}>
        <header className="league-sidebar-header">
          <h3>Сезоны</h3>
          {loadingSeasons && <span className="muted">Загружаем…</span>}
        </header>
        <div className="league-season-groups">
          {shouldShowFriendliesEntry && (
            <div className="friendlies-entry">
              <button
                type="button"
                className={`season-item friendlies${isFriendlySelected ? ' selected' : ''}${friendliesSeasonSummary?.isActive ? ' active' : ''}`}
                onClick={handleFriendliesClick}
                aria-current={isFriendlySelected}
              >
                <div className="friendlies-label">
                  <span className="season-name">{FRIENDLY_SEASON_NAME}</span>
                  {friendliesSeasonSummary?.isActive && (
                    <span className="season-chip friendlies-chip">Активно</span>
                  )}
                </div>
                <span className="season-range muted">{friendliesRangeText}</span>
                <span className="season-range muted">{friendliesSubtitle}</span>
              </button>
            </div>
          )}
          {cityGroups.map(cityGroup => {
            const cityExpanded = expandedCities.has(cityGroup.cityKey)
            const cityDomId = domIdFor('city', cityGroup.cityKey)
            return (
              <div
                key={cityGroup.cityKey}
                className={`city-group${cityExpanded ? ' expanded' : ''}`}
              >
                <button
                  type="button"
                  className="competition-toggle city-toggle"
                  onClick={() => toggleCity(cityGroup.cityKey)}
                  aria-expanded={cityExpanded}
                  aria-controls={cityDomId}
                >
                  <span className="city-name">{cityGroup.cityLabel}</span>
                  <span className="competition-meta">
                    <span className="competition-count">{cityGroup.seasonCount}</span>
                    <span className="competition-caret" aria-hidden>
                      {cityExpanded ? '-' : '+'}
                    </span>
                  </span>
                </button>
                <div
                  id={cityDomId}
                  className="group-season-list city-competition-list"
                  role="list"
                  hidden={!cityExpanded}
                >
                  {cityGroup.competitions.map(group => {
                    const key = competitionKeyFor(cityGroup.cityKey, group.competitionId)
                    const competitionExpanded = expandedCompetitions.has(key)
                    const compDomId = domIdFor('competition', key)
                    return (
                      <div
                        key={key}
                        className={`competition-group${competitionExpanded ? ' expanded' : ''}`}
                      >
                        <button
                          type="button"
                          className="competition-toggle"
                          onClick={() => toggleCompetition(cityGroup.cityKey, group.competitionId)}
                          aria-expanded={competitionExpanded}
                          aria-controls={compDomId}
                        >
                          <span className="competition-name">{group.competitionName}</span>
                          <span className="competition-meta">
                            <span className="competition-count">{group.seasons.length}</span>
                            <span className="competition-caret" aria-hidden>
                              {competitionExpanded ? '-' : '+'}
                            </span>
                          </span>
                        </button>
                        <div
                          id={compDomId}
                          className="group-season-list"
                          role="list"
                          hidden={!competitionExpanded}
                        >
                          {group.seasons.map(season => {
                            const isActive = season.id === activeSeasonId
                            const isSelected = season.id === selectedSeasonId
                            const isArchived = season.isArchived === true
                            return (
                              <button
                                key={season.id}
                                type="button"
                                role="listitem"
                                className={`season-item${isSelected ? ' selected' : ''}${isActive ? ' active' : ''}${isArchived ? ' archived' : ''}`}
                                onClick={() => handleSeasonClick(season.id)}
                              >
                                <span className="season-name">
                                  {isArchived ? '📦 ' : ''}{season.name}
                                </span>
                                <span className="season-range muted">{formatSeasonRange(season)}</span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
          {seasons.length === 0 && !loadingSeasons && (
            <div className="empty-state muted">Сезоны пока не добавлены.</div>
          )}
        </div>
      </aside>
      {leagueMenuOpen && <div className="league-backdrop" role="button" tabIndex={-1} onClick={closeLeagueMenu} />}

      <div
        className={`league-content${leagueMenuOpen ? ' shifted' : ''}`}
        onClickCapture={handleContentClick}
      >
        <div className="league-toolbar">
          <nav className="league-subtabs" aria-label="Подвкладки лиги">
            {SUBTAB_ORDER.map(key => {
              const disabled = isFriendlySelected && (key === 'table' || key === 'stats')
              return (
                <button
                  key={key}
                  type="button"
                  className={`subtab-button${leagueSubTab === key ? ' active' : ''}`}
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) {
                      return
                    }
                    handleSubTabClick(key)
                  }}
                >
                  {subTabLabels[key]}
                </button>
              )
            })}
          </nav>
        </div>
        {!selectedSeason && !isFriendlySelected && (
          <div className="inline-feedback info" role="status">
            Выберите сезон, чтобы посмотреть таблицу.
          </div>
        )}

        {leagueSubTab === 'table' ? (
          <LeagueTableView
            table={table}
            loading={loadingTable}
            error={tableErrors}
            onRetry={handleForceReload}
          />
        ) : leagueSubTab === 'schedule' ? (
          <LeagueRoundsView
            mode="schedule"
            data={scheduleData}
            loading={loadingSchedule}
            error={scheduleErrors}
            onRetry={handleScheduleReload}
          />
        ) : leagueSubTab === 'results' ? (
          <LeagueRoundsView
            mode="results"
            data={resultsData}
            loading={loadingResults}
            error={resultsErrors}
            onRetry={handleResultsReload}
            onLazyLoadRound={handleRoundResultsLoad}
            roundLoading={roundLoadingForSeason}
            roundErrors={roundErrorsForSeason}
          />
        ) : leagueSubTab === 'stats' ? (
          <LeagueStatsView
            stats={statsData}
            loading={loadingStats}
            error={statsErrors}
            onRetry={handleStatsReload}
          />
        ) : (
          <Placeholder message="Раздел скоро появится." />
        )}
      </div>
    </div>
  )
}

export default LeaguePage
