import React, { useEffect, useMemo, useState } from 'react'
import { LeagueTableView } from '../components/league/LeagueTableView'
import { LeagueRoundsView } from '../components/league/LeagueRoundsView'
import { LeagueSubTab, useAppStore } from '../store/appStore'
import type { LeagueSeasonSummary } from '@shared/types'

const subTabLabels: Record<LeagueSubTab, string> = {
  table: 'Таблица',
  schedule: 'Календарь',
  results: 'Результаты',
  stats: 'Статистика',
}

const SUBTAB_ORDER: LeagueSubTab[] = ['table', 'schedule', 'results', 'stats']

type CompetitionGroup = {
  competitionId: number
  competitionName: string
  seasons: LeagueSeasonSummary[]
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

const EMPTY_PLACEHOLDER: Pick<Record<LeagueSubTab, string>, 'stats'> = {
  stats: 'Мы собираем расширенную аналитику по сезонам и клубам — следите за обновлением.',
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
  const ensureRealtime = useAppStore(state => state.ensureRealtime)
  const setSelectedSeason = useAppStore(state => state.setSelectedSeason)
  const selectedSeasonId = useAppStore(state => state.selectedSeasonId)
  const activeSeasonId = useAppStore(state => state.activeSeasonId)
  const leagueSubTab = useAppStore(state => state.leagueSubTab)
  const setLeagueSubTab = useAppStore(state => state.setLeagueSubTab)
  const loadingSeasons = useAppStore(state => state.loading.seasons)
  const loadingTable = useAppStore(state => state.loading.table)
  const loadingSchedule = useAppStore(state => state.loading.schedule)
  const loadingResults = useAppStore(state => state.loading.results)
  const tableErrors = useAppStore(state => state.errors.table)
  const scheduleErrors = useAppStore(state => state.errors.schedule)
  const resultsErrors = useAppStore(state => state.errors.results)
  const leagueMenuOpen = useAppStore(state => state.leagueMenuOpen)
  const closeLeagueMenu = useAppStore(state => state.closeLeagueMenu)
  const tableFetchedAt = useAppStore(state => state.tableFetchedAt)
  const scheduleFetchedAt = useAppStore(state => state.scheduleFetchedAt)
  const resultsFetchedAt = useAppStore(state => state.resultsFetchedAt)
  const tables = useAppStore(state => state.tables)
  const schedules = useAppStore(state => state.schedules)
  const results = useAppStore(state => state.results)
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(() => new Set())

  const selectedSeason = useMemo(
    () => seasons.find(season => season.id === selectedSeasonId),
    [seasons, selectedSeasonId]
  )

  const competitionGroups = useMemo<CompetitionGroup[]>(() => {
    if (seasons.length === 0) {
      return []
    }
    const groups = new Map<number, CompetitionGroup>()
    seasons.forEach(season => {
      const current = groups.get(season.competition.id)
      if (current) {
        current.seasons.push(season)
        return
      }
      groups.set(season.competition.id, {
        competitionId: season.competition.id,
        competitionName: season.competition.name,
        seasons: [season],
      })
    })
    const collator = new Intl.Collator('ru', { sensitivity: 'base' })
    return Array.from(groups.values())
      .map(group => ({
        ...group,
        seasons: [...group.seasons].sort((left, right) => right.startDate.localeCompare(left.startDate)),
      }))
      .sort((left, right) => collator.compare(left.competitionName, right.competitionName))
  }, [seasons])

  const table = selectedSeasonId ? tables[selectedSeasonId] : undefined
  const lastUpdated = selectedSeasonId ? tableFetchedAt[selectedSeasonId] : undefined
  const scheduleData = selectedSeasonId ? schedules[selectedSeasonId] : undefined
  const scheduleUpdatedAt = selectedSeasonId ? scheduleFetchedAt[selectedSeasonId] : undefined
  const resultsData = selectedSeasonId ? results[selectedSeasonId] : undefined
  const resultsUpdatedAt = selectedSeasonId ? resultsFetchedAt[selectedSeasonId] : undefined

  useEffect(() => {
    setExpandedGroups(prev => {
      const validIds = new Set(competitionGroups.map(group => group.competitionId))
      let mutated = false
      const next = new Set<number>()

      prev.forEach(id => {
        if (validIds.has(id)) {
          next.add(id)
        } else {
          mutated = true
        }
      })

      const preferredId = selectedSeason
        ? selectedSeason.competition.id
        : competitionGroups[0]?.competitionId

      if (preferredId !== undefined && !next.has(preferredId)) {
        next.add(preferredId)
        mutated = true
      }

      if (!mutated && next.size === prev.size) {
        return prev
      }

      if (!mutated) {
        const prevArr = Array.from(prev).sort()
        const nextArr = Array.from(next).sort()
        if (prevArr.length === nextArr.length && prevArr.every((id, index) => id === nextArr[index])) {
          return prev
        }
      }

      return next
    })
  }, [competitionGroups, selectedSeason])

  useEffect(() => {
    ensureRealtime()
    void fetchSeasons()
  }, [ensureRealtime, fetchSeasons])

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
  }, [leagueSubTab, selectedSeasonId, fetchSchedule, fetchResults])

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

  const toggleCompetition = (competitionId: number) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(competitionId)) {
        next.delete(competitionId)
      } else {
        next.add(competitionId)
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
          {competitionGroups.map(group => {
            const expanded = expandedGroups.has(group.competitionId)
            return (
              <div
                key={group.competitionId}
                className={`competition-group${expanded ? ' expanded' : ''}`}
              >
                <button
                  type="button"
                  className="competition-toggle"
                  onClick={() => toggleCompetition(group.competitionId)}
                  aria-expanded={expanded}
                  aria-controls={`competition-${group.competitionId}`}
                >
                  <span className="competition-name">{group.competitionName}</span>
                  <span className="competition-meta">
                    <span className="competition-count">{group.seasons.length}</span>
                    <span className="competition-caret" aria-hidden>
                      {expanded ? '-' : '+'}
                    </span>
                  </span>
                </button>
                <div
                  id={`competition-${group.competitionId}`}
                  className="group-season-list"
                  role="list"
                  hidden={!expanded}
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
        ) : (
          <Placeholder message={EMPTY_PLACEHOLDER.stats} />
        )}
      </div>
    </div>
  )
}

export default LeaguePage
