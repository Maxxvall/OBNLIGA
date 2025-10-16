import React, { useEffect, useMemo, useRef, useState } from 'react'
import { LeagueTableView } from '../components/league/LeagueTableView'
import { LeagueRoundsView } from '../components/league/LeagueRoundsView'
import { LeagueStatsView } from '../components/league/LeagueStatsView'
import { LeagueSubTab, useAppStore } from '../store/appStore'
import type { LeagueSeasonSummary } from '@shared/types'

const subTabLabels: Record<LeagueSubTab, string> = {
  table: 'Таблица',
  stats: 'Статистика',
  schedule: 'Календарь',
  results: 'Результаты',
}

const SUBTAB_ORDER: LeagueSubTab[] = ['table', 'stats', 'schedule', 'results']

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
  year: 'numeric',
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
  const ensureLeaguePolling = useAppStore(state => state.ensureLeaguePolling)
  const stopLeaguePolling = useAppStore(state => state.stopLeaguePolling)
  const setSelectedSeason = useAppStore(state => state.setSelectedSeason)
  const selectedSeasonId = useAppStore(state => state.selectedSeasonId)
  const activeSeasonId = useAppStore(state => state.activeSeasonId)
  const leagueSubTab = useAppStore(state => state.leagueSubTab)
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
  const leagueMenuOpen = useAppStore(state => state.leagueMenuOpen)
  const closeLeagueMenu = useAppStore(state => state.closeLeagueMenu)
  const tableFetchedAt = useAppStore(state => state.tableFetchedAt)
  const scheduleFetchedAt = useAppStore(state => state.scheduleFetchedAt)
  const resultsFetchedAt = useAppStore(state => state.resultsFetchedAt)
  const statsFetchedAt = useAppStore(state => state.statsFetchedAt)
  const tables = useAppStore(state => state.tables)
  const schedules = useAppStore(state => state.schedules)
  const results = useAppStore(state => state.results)
  const stats = useAppStore(state => state.stats)
  const [expandedCities, setExpandedCities] = useState<Set<string>>(() => new Set())
  const [expandedCompetitions, setExpandedCompetitions] = useState<Set<string>>(
    () => new Set()
  )
  const lastAutoExpandedSeasonId = useRef<number | undefined>(undefined)

  const selectedSeason = useMemo(
    () => seasons.find(season => season.id === selectedSeasonId),
    [seasons, selectedSeasonId]
  )

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
  const lastUpdated = selectedSeasonId ? tableFetchedAt[selectedSeasonId] : undefined
  const scheduleData = selectedSeasonId ? schedules[selectedSeasonId] : undefined
  const scheduleUpdatedAt = selectedSeasonId ? scheduleFetchedAt[selectedSeasonId] : undefined
  const resultsData = selectedSeasonId ? results[selectedSeasonId] : undefined
  const resultsUpdatedAt = selectedSeasonId ? resultsFetchedAt[selectedSeasonId] : undefined
  const statsData = selectedSeasonId ? stats[selectedSeasonId] : undefined
  const statsUpdatedAt = selectedSeasonId ? statsFetchedAt[selectedSeasonId] : undefined

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
    ensureLeaguePolling()
    void fetchSeasons()

    return () => {
      stopLeaguePolling()
    }
  }, [ensureLeaguePolling, stopLeaguePolling, fetchSeasons])

  useEffect(() => {
    if (selectedSeasonId) {
      void fetchTable({ seasonId: selectedSeasonId })
    }
  }, [selectedSeasonId, fetchTable])

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
      void fetchStats({ seasonId: selectedSeasonId })
    }
  }, [leagueSubTab, selectedSeasonId, fetchSchedule, fetchResults, fetchStats])

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
    if (selectedSeasonId) {
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

  const handleStatsReload = () => {
    if (selectedSeasonId) {
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
                            return (
                              <button
                                key={season.id}
                                type="button"
                                role="listitem"
                                className={`season-item${isSelected ? ' selected' : ''}${isActive ? ' active' : ''}`}
                                onClick={() => handleSeasonClick(season.id)}
                              >
                                <span className="season-name">{season.name}</span>
                                <span className="season-range muted">{formatSeasonRange(season)}</span>
                                {isActive && <span className="season-chip">Текущий</span>}
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
            {SUBTAB_ORDER.map(key => (
              <button
                key={key}
                type="button"
                className={`subtab-button${leagueSubTab === key ? ' active' : ''}`}
                onClick={() => handleSubTabClick(key)}
              >
                {subTabLabels[key]}
              </button>
            ))}
          </nav>
        </div>
        {!selectedSeason && (
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
            lastUpdated={lastUpdated}
          />
        ) : leagueSubTab === 'schedule' ? (
          <LeagueRoundsView
            mode="schedule"
            data={scheduleData}
            loading={loadingSchedule}
            error={scheduleErrors}
            onRetry={handleScheduleReload}
            lastUpdated={scheduleUpdatedAt}
          />
        ) : leagueSubTab === 'results' ? (
          <LeagueRoundsView
            mode="results"
            data={resultsData}
            loading={loadingResults}
            error={resultsErrors}
            onRetry={handleResultsReload}
            lastUpdated={resultsUpdatedAt}
          />
        ) : leagueSubTab === 'stats' ? (
          <LeagueStatsView
            stats={statsData}
            loading={loadingStats}
            error={statsErrors}
            onRetry={handleStatsReload}
            lastUpdated={statsUpdatedAt}
          />
        ) : (
          <Placeholder message="Раздел скоро появится." />
        )}
      </div>
    </div>
  )
}

export default LeaguePage
