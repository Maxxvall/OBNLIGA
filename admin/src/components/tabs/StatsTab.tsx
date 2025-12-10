import { useEffect, useMemo, useRef, useState } from 'react'
import { useAdminStore } from '../../store/adminStore'
import {
  ClubCareerTotals,
  ClubSeasonStats,
  MatchSummary,
  PlayerCareerStats,
  PlayerSeasonStats,
} from '../../types'
import { buildStatsExportHtml, type StatsExportSection } from '../../utils/statsExport'

type StatView =
  | 'standings'
  | 'teams'
  | 'scorers'
  | 'assists'
  | 'goalContribution'
  | 'discipline'
  | 'career'

type FeedbackLevel = 'success' | 'error' | 'info'

const dataSliceTabs: Array<{ key: StatView; label: string }> = [
  { key: 'standings', label: 'Таблица' },
  { key: 'scorers', label: 'Бомбардиры' },
  { key: 'assists', label: 'Передачи' },
  { key: 'goalContribution', label: 'Гол+Пасс' },
  { key: 'discipline', label: 'Дисциплина' },
]

const exportableViews = new Set<StatView>(dataSliceTabs.map(tab => tab.key))

const sortStandings = (rows: ClubSeasonStats[], matches: MatchSummary[]) => {
  const dataset = [...rows]
  if (!dataset.length) return dataset

  const seasonIds = new Set(dataset.map(row => row.seasonId))
  type HeadToHeadEntry = { points: number; goalsFor: number; goalsAgainst: number }
  const headToHead = new Map<number, Map<number, HeadToHeadEntry>>()

  const ensureHeadToHead = (clubId: number, opponentId: number): HeadToHeadEntry => {
    let opponents = headToHead.get(clubId)
    if (!opponents) {
      opponents = new Map<number, HeadToHeadEntry>()
      headToHead.set(clubId, opponents)
    }
    let record = opponents.get(opponentId)
    if (!record) {
      record = { points: 0, goalsFor: 0, goalsAgainst: 0 }
      opponents.set(opponentId, record)
    }
    return record
  }

  for (const match of matches) {
    if (match.status !== 'FINISHED') continue
    if (!seasonIds.has(match.seasonId)) continue
    if (match.round?.roundType === 'PLAYOFF') continue
    const home = ensureHeadToHead(match.homeTeamId, match.awayTeamId)
    const away = ensureHeadToHead(match.awayTeamId, match.homeTeamId)

    home.goalsFor += match.homeScore
    home.goalsAgainst += match.awayScore
    away.goalsFor += match.awayScore
    away.goalsAgainst += match.homeScore

    if (match.homeScore > match.awayScore) {
      home.points += 3
    } else if (match.homeScore < match.awayScore) {
      away.points += 3
    } else {
      home.points += 1
      away.points += 1
    }
  }

  const getHeadToHead = (clubId: number, opponentId: number): HeadToHeadEntry => {
    return headToHead.get(clubId)?.get(opponentId) ?? { points: 0, goalsFor: 0, goalsAgainst: 0 }
  }

  return dataset.sort((left, right) => {
    if (right.points !== left.points) return right.points - left.points

    const leftVsRight = getHeadToHead(left.clubId, right.clubId)
    const rightVsLeft = getHeadToHead(right.clubId, left.clubId)

    if (rightVsLeft.points !== leftVsRight.points) return rightVsLeft.points - leftVsRight.points

    const leftHeadDiff = leftVsRight.goalsFor - leftVsRight.goalsAgainst
    const rightHeadDiff = rightVsLeft.goalsFor - rightVsLeft.goalsAgainst
    if (rightHeadDiff !== leftHeadDiff) return rightHeadDiff - leftHeadDiff

    if (rightVsLeft.goalsFor !== leftVsRight.goalsFor)
      return rightVsLeft.goalsFor - leftVsRight.goalsFor

    const leftDiff = left.goalsFor - left.goalsAgainst
    const rightDiff = right.goalsFor - right.goalsAgainst
    if (rightDiff !== leftDiff) return rightDiff - leftDiff

    return right.goalsFor - left.goalsFor
  })
}

const sortScorers = (rows: PlayerSeasonStats[]) => {
  return [...rows].sort((left, right) => {
    if (right.goals !== left.goals) return right.goals - left.goals
    if (left.matchesPlayed !== right.matchesPlayed) return left.matchesPlayed - right.matchesPlayed
    const leftName = `${left.person.lastName} ${left.person.firstName}`
    const rightName = `${right.person.lastName} ${right.person.firstName}`
    return leftName.localeCompare(rightName, 'ru')
  })
}

const sortAssists = (rows: PlayerSeasonStats[]) => {
  return [...rows]
    .filter(row => row.assists > 0)
    .sort((left, right) => {
      if (right.assists !== left.assists) return right.assists - left.assists
      if (left.matchesPlayed !== right.matchesPlayed)
        return left.matchesPlayed - right.matchesPlayed
      const leftName = `${left.person.lastName} ${left.person.firstName}`
      const rightName = `${right.person.lastName} ${right.person.firstName}`
      return leftName.localeCompare(rightName, 'ru')
    })
}

const sortGoalContributions = (rows: PlayerSeasonStats[]) => {
  return [...rows]
    .filter(row => row.goals + row.assists > 0)
    .sort((left, right) => {
      const leftTotal = left.goals + left.assists
      const rightTotal = right.goals + right.assists
      if (rightTotal !== leftTotal) return rightTotal - leftTotal
      if (right.goals !== left.goals) return right.goals - left.goals
      const leftCleanGoals = left.goals - (left.penaltyGoals ?? 0)
      const rightCleanGoals = right.goals - (right.penaltyGoals ?? 0)
      if (rightCleanGoals !== leftCleanGoals) return rightCleanGoals - leftCleanGoals
      if (right.assists !== left.assists) return right.assists - left.assists
      if (left.matchesPlayed !== right.matchesPlayed)
        return left.matchesPlayed - right.matchesPlayed
      const leftName = `${left.person.lastName} ${left.person.firstName}`
      const rightName = `${right.person.lastName} ${right.person.firstName}`
      return leftName.localeCompare(rightName, 'ru')
    })
}

const sortDiscipline = (rows: PlayerSeasonStats[]) => {
  return rows
    .filter(row => row.yellowCards > 0 || row.redCards > 0)
    .sort((left, right) => {
      if (right.yellowCards !== left.yellowCards) return right.yellowCards - left.yellowCards
      if (right.redCards !== left.redCards) return right.redCards - left.redCards
      return right.matchesPlayed - left.matchesPlayed
    })
}

const sortCareer = (rows: PlayerCareerStats[]) => {
  return [...rows].sort((left, right) => {
    if (right.totalGoals !== left.totalGoals) return right.totalGoals - left.totalGoals
    if (right.totalAssists !== left.totalAssists) return right.totalAssists - left.totalAssists
    return right.totalMatches - left.totalMatches
  })
}

const sortTeams = (rows: ClubCareerTotals[]) => {
  return [...rows].sort((left, right) => {
    if (right.tournaments !== left.tournaments) return right.tournaments - left.tournaments
    if (right.matchesPlayed !== left.matchesPlayed) return right.matchesPlayed - left.matchesPlayed
    const leftDiff = left.goalsFor - left.goalsAgainst
    const rightDiff = right.goalsFor - right.goalsAgainst
    if (rightDiff !== leftDiff) return rightDiff - leftDiff
    if (right.goalsFor !== left.goalsFor) return right.goalsFor - left.goalsFor
    return left.club.name.localeCompare(right.club.name, 'ru')
  })
}

const formatGoals = (goals: number, penaltyGoals?: number) => {
  if (penaltyGoals && penaltyGoals > 0) {
    return `${goals}(${penaltyGoals})`
  }
  return String(goals)
}

const formatEfficiency = (goals: number, matches: number) => {
  if (!matches) return '0.00'
  return (goals / matches).toFixed(2)
}

export const StatsTab = () => {
  const {
    token,
    data,
    selectedCompetitionId,
    selectedSeasonId,
    setSelectedSeason,
    setSelectedCompetition,
    fetchSeasons,
    fetchStats,
    loading,
    error,
  } = useAdminStore(state => ({
    token: state.token,
    data: state.data,
    selectedCompetitionId: state.selectedCompetitionId,
    selectedSeasonId: state.selectedSeasonId,
    setSelectedSeason: state.setSelectedSeason,
    setSelectedCompetition: state.setSelectedCompetition,
    fetchSeasons: state.fetchSeasons,
    fetchStats: state.fetchStats,
    loading: state.loading,
    error: state.error,
  }))

  const [activeView, setActiveView] = useState<StatView>('standings')
  const [careerClubId, setCareerClubId] = useState<number | undefined>(undefined)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [feedbackLevel, setFeedbackLevel] = useState<FeedbackLevel>('info')

  const handleFeedback = (message: string, level: FeedbackLevel) => {
    setFeedback(message)
    setFeedbackLevel(level)
  }

  const resolveViewLabel = (view: StatView): string => {
    const tab = dataSliceTabs.find(entry => entry.key === view)
    return tab ? tab.label : 'Статистика'
  }

  // Одноразовая загрузка сезонов
  const bootRef = useRef(false)
  useEffect(() => {
    if (!token || bootRef.current) return
    bootRef.current = true
    void fetchSeasons().catch(() => undefined)
  }, [token, fetchSeasons])

  // Явная загрузка статистики только по выбору сезона
  useEffect(() => {
    if (!token || !selectedSeasonId) return
    void fetchStats(selectedSeasonId).catch(() => undefined)
  }, [token, selectedSeasonId, fetchStats])

  const selectedSeason = useMemo(
    () => data.seasons.find(season => season.id === selectedSeasonId),
    [data.seasons, selectedSeasonId]
  )

  const competitionOptions = useMemo(() => {
    const map = new Map<number, { id: number; name: string }>()
    for (const season of data.seasons) {
      if (!map.has(season.competition.id)) {
        map.set(season.competition.id, {
          id: season.competition.id,
          name: season.competition.name,
        })
      }
    }
    return Array.from(map.values()).sort((left, right) => left.name.localeCompare(right.name, 'ru'))
  }, [data.seasons])

  useEffect(() => {
    if (!competitionOptions.length || !token) return
    if (!selectedCompetitionId) {
      setSelectedCompetition(competitionOptions[0]?.id)
    }
  }, [competitionOptions, selectedCompetitionId, setSelectedCompetition, token])

  const seasonsForCompetition = useMemo(() => {
    if (!selectedCompetitionId) return data.seasons
    return data.seasons.filter(season => season.competitionId === selectedCompetitionId)
  }, [data.seasons, selectedCompetitionId])

  const standings = useMemo(
    () => sortStandings(data.clubStats, data.matches),
    [data.clubStats, data.matches]
  )
  const teams = useMemo(() => {
    const totalsByClub = new Map<number, ClubCareerTotals>()
    for (const entry of data.clubCareerTotals) {
      totalsByClub.set(entry.clubId, entry)
    }

    const fullList: ClubCareerTotals[] = data.clubs.map(club => {
      const totals = totalsByClub.get(club.id)
      if (totals) {
        return totals
      }
      return {
        clubId: club.id,
        club,
        tournaments: 0,
        matchesPlayed: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        yellowCards: 0,
        redCards: 0,
        cleanSheets: 0,
      }
    })

    return sortTeams(fullList)
  }, [data.clubs, data.clubCareerTotals])
  const scorers = useMemo(() => sortScorers(data.playerStats), [data.playerStats])
  const assistsTop = useMemo(() => sortAssists(data.playerStats).slice(0, 10), [data.playerStats])
  const goalContributions = useMemo(
    () => sortGoalContributions(data.playerStats),
    [data.playerStats]
  )
  const discipline = useMemo(() => sortDiscipline(data.playerStats), [data.playerStats])
  const careerSorted = useMemo(() => sortCareer(data.careerStats), [data.careerStats])
  const career = useMemo(
    () => (careerClubId ? careerSorted.filter(row => row.clubId === careerClubId) : []),
    [careerSorted, careerClubId]
  )

  const careerClubOptions = useMemo(() => {
    const options = data.clubs.map(club => [club.id, club.name] as const)
    if (options.length) {
      return options.sort((left, right) => left[1].localeCompare(right[1], 'ru'))
    }
    const fallback = new Map<number, string>()
    for (const row of data.careerStats) {
      fallback.set(row.clubId, row.club.name)
    }
    return Array.from(fallback.entries()).sort((left, right) =>
      left[1].localeCompare(right[1], 'ru')
    )
  }, [data.clubs, data.careerStats])

  const finishedMatchesByClub = useMemo(() => {
    const map = new Map<string, number>()
    const makeKey = (seasonId: number, clubId: number) => `${seasonId}:${clubId}`
    for (const match of data.matches) {
      if (selectedSeasonId && match.seasonId !== selectedSeasonId) continue
      if (match.status !== 'FINISHED') continue
      if (match.round?.roundType === 'PLAYOFF') continue
      const homeKey = makeKey(match.seasonId, match.homeTeamId)
      const awayKey = makeKey(match.seasonId, match.awayTeamId)
      map.set(homeKey, (map.get(homeKey) ?? 0) + 1)
      map.set(awayKey, (map.get(awayKey) ?? 0) + 1)
    }
    return map
  }, [data.matches, selectedSeasonId])

  const groupStandings = useMemo(() => {
    if (!selectedSeason) return null
  const seasonFormat = selectedSeason.seriesFormat ?? selectedSeason.competition.seriesFormat
  if (seasonFormat !== 'GROUP_SINGLE_ROUND_PLAYOFF') return null
    const groups = selectedSeason.groups ?? []
    if (!groups.length) return []

    const seasonMatches = data.matches.filter(
      match => match.seasonId === selectedSeason.id && match.round?.roundType !== 'PLAYOFF'
    )

    return groups
      .map(group => {
        const clubIds = new Set(
          group.slots
            .filter(slot => typeof slot.clubId === 'number')
            .map(slot => slot.clubId as number)
        )
        if (!clubIds.size) {
          return {
            groupIndex: group.groupIndex,
            label: group.label,
            qualifyCount: group.qualifyCount,
            rows: [] as typeof standings,
          }
        }
        const groupRows = standings.filter(row => clubIds.has(row.clubId))
        const groupMatches = seasonMatches.filter(
          match => clubIds.has(match.homeTeamId) && clubIds.has(match.awayTeamId)
        )
        return {
          groupIndex: group.groupIndex,
          label: group.label,
          qualifyCount: group.qualifyCount,
          rows: sortStandings(groupRows, groupMatches),
        }
      })
      .filter(entry => entry !== null)
      .sort((left, right) => left.groupIndex - right.groupIndex)
  }, [data.matches, selectedSeason, standings])

  const groupSeedPreview = useMemo(() => {
    if (!groupStandings || !selectedSeason) return null
  const seasonFormat = selectedSeason.seriesFormat ?? selectedSeason.competition.seriesFormat
  if (seasonFormat !== 'GROUP_SINGLE_ROUND_PLAYOFF') return null

    const seeds: Array<{
      clubId: number
      points: number
      goalDiff: number
      goalsFor: number
      wins: number
      preRank: number
    }> = []

    const groupByIndex = new Map<number, (typeof groupStandings)[number]>()
    for (const entry of groupStandings) {
      groupByIndex.set(entry.groupIndex, entry)
    }

    for (const group of selectedSeason.groups ?? []) {
      const standingsEntry = groupByIndex.get(group.groupIndex)
      if (!standingsEntry) continue

      const slotRank = new Map<number, number>()
      for (const slot of group.slots) {
        if (typeof slot.clubId === 'number' && slot.clubId > 0) {
          slotRank.set(slot.clubId, slot.position)
        }
      }

      for (let index = 0; index < group.qualifyCount; index += 1) {
        const row = standingsEntry.rows[index]
        if (!row) continue
        const goalDiff = row.goalsFor - row.goalsAgainst
        const slot = slotRank.get(row.clubId) ?? index + 1
        const preRank = group.groupIndex * 100 + slot
        seeds.push({
          clubId: row.clubId,
          points: row.points,
          goalDiff,
          goalsFor: row.goalsFor,
          wins: row.wins,
          preRank,
        })
      }
    }

    if (!seeds.length) return null

    seeds.sort((left, right) => {
      if (right.points !== left.points) return right.points - left.points
      if (right.goalDiff !== left.goalDiff) return right.goalDiff - left.goalDiff
      if (right.goalsFor !== left.goalsFor) return right.goalsFor - left.goalsFor
      if (left.preRank !== right.preRank) return left.preRank - right.preRank
      if (right.wins !== left.wins) return right.wins - left.wins
      return left.clubId - right.clubId
    })

    const map = new Map<number, number>()
    seeds.forEach((entry, index) => {
      map.set(entry.clubId, index + 1)
    })
    return map
  }, [groupStandings, selectedSeason])

  useEffect(() => {
    if (!careerClubId) return
    if (!careerClubOptions.some(([id]) => id === careerClubId)) {
      setCareerClubId(undefined)
    }
  }, [careerClubId, careerClubOptions])

  const exportSections = useMemo<StatsExportSection[]>(() => {
    if (!selectedSeason || !exportableViews.has(activeView)) return []

    const buildStandingsRows = (
      rows: ClubSeasonStats[],
      qualifyCount?: number
    ): StatsExportSection['rows'] => {
      return rows.map((row, index) => {
        const matchesKey = `${row.seasonId}:${row.clubId}`
        const matches = finishedMatchesByClub.get(matchesKey)
        const inferredDraws = Math.max(0, row.points - row.wins * 3)
        const matchesPlayed = matches ?? row.wins + row.losses + inferredDraws
        const draws = Math.max(0, matchesPlayed - row.wins - row.losses)
        const goalDiff = row.goalsFor - row.goalsAgainst

        return {
          cells: {
            rank: index + 1,
            seed: groupSeedPreview?.get(row.clubId) ?? '—',
            club: row.club.name,
            matches: matchesPlayed,
            wins: row.wins,
            draws,
            losses: row.losses,
            goals: `${row.goalsFor}:${row.goalsAgainst} (${goalDiff})`,
            points: row.points,
          },
          highlight: typeof qualifyCount === 'number' ? index < qualifyCount : false,
        }
      })
    }

    if (activeView === 'standings') {
      if (groupStandings && groupStandings.length) {
        const columns: StatsExportSection['columns'] = [
          { key: 'rank', title: '#', align: 'center', width: '36px' },
          { key: 'seed', title: 'Р', align: 'center', width: '42px' },
          { key: 'club', title: 'Клуб', align: 'left' },
          { key: 'matches', title: 'И', align: 'center', width: '48px' },
          { key: 'wins', title: 'В', align: 'center', width: '42px' },
          { key: 'draws', title: 'Н', align: 'center', width: '42px' },
          { key: 'losses', title: 'П', align: 'center', width: '42px' },
          { key: 'goals', title: 'Голы', align: 'center', width: '110px' },
          { key: 'points', title: 'Очки', align: 'center', width: '56px' },
        ]

        return groupStandings.map(group => ({
          title: group.label,
          subtitle: `Проходят: ${group.qualifyCount}`,
          columns,
          rows: buildStandingsRows(group.rows, group.qualifyCount),
        }))
      }

      if (!standings.length) return []

      const columns: StatsExportSection['columns'] = [
        { key: 'rank', title: '#', align: 'center', width: '36px' },
        { key: 'club', title: 'Клуб', align: 'left' },
        { key: 'matches', title: 'И', align: 'center', width: '48px' },
        { key: 'wins', title: 'В', align: 'center', width: '42px' },
        { key: 'draws', title: 'Н', align: 'center', width: '42px' },
        { key: 'losses', title: 'П', align: 'center', width: '42px' },
        { key: 'goals', title: 'Голы', align: 'center', width: '110px' },
        { key: 'points', title: 'Очки', align: 'center', width: '56px' },
      ]

      return [
        {
          title: 'Турнирная таблица',
          columns,
          rows: buildStandingsRows(standings),
        },
      ]
    }

    if (activeView === 'scorers') {
      if (!scorers.length) return []
      const columns: StatsExportSection['columns'] = [
        { key: 'rank', title: '#', align: 'center', width: '36px' },
        { key: 'player', title: 'Игрок', align: 'left' },
        { key: 'club', title: 'Клуб', align: 'left' },
        { key: 'matches', title: 'Матчи', align: 'center', width: '70px' },
        { key: 'efficiency', title: 'Кф.эфф', align: 'center', width: '72px' },
        { key: 'goals', title: 'Голы', align: 'center', width: '64px' },
      ]

      const rows: StatsExportSection['rows'] = scorers.map((row, index) => ({
        cells: {
          rank: index + 1,
          player: `${row.person.lastName} ${row.person.firstName}`,
          club: row.club.name,
          matches: row.matchesPlayed,
          efficiency: formatEfficiency(row.goals, row.matchesPlayed),
          goals: formatGoals(row.goals, row.penaltyGoals),
        },
      }))

      return [
        {
          title: 'Бомбардиры',
          columns,
          rows,
        },
      ]
    }

    if (activeView === 'assists') {
      if (!assistsTop.length) return []
      const columns: StatsExportSection['columns'] = [
        { key: 'rank', title: '#', align: 'center', width: '36px' },
        { key: 'player', title: 'Игрок', align: 'left' },
        { key: 'club', title: 'Клуб', align: 'left' },
        { key: 'matches', title: 'Матчи', align: 'center', width: '70px' },
        { key: 'assists', title: 'Передачи', align: 'center', width: '90px' },
      ]

      const rows: StatsExportSection['rows'] = assistsTop.map((row, index) => ({
        cells: {
          rank: index + 1,
          player: `${row.person.lastName} ${row.person.firstName}`,
          club: row.club.name,
          matches: row.matchesPlayed,
          assists: row.assists,
        },
      }))

      return [
        {
          title: 'Таблица ассистентов',
          columns,
          rows,
        },
      ]
    }

    if (activeView === 'goalContribution') {
      if (!goalContributions.length) return []
      const columns: StatsExportSection['columns'] = [
        { key: 'rank', title: '#', align: 'center', width: '36px' },
        { key: 'player', title: 'Игрок', align: 'left' },
        { key: 'club', title: 'Клуб', align: 'left' },
        { key: 'matches', title: 'Матчи', align: 'center', width: '70px' },
        { key: 'goals', title: 'Голы', align: 'center', width: '64px' },
        { key: 'assists', title: 'Передачи', align: 'center', width: '90px' },
        { key: 'total', title: 'Гол+Пасс', align: 'center', width: '96px' },
      ]

      const rows: StatsExportSection['rows'] = goalContributions.map((row, index) => ({
        cells: {
          rank: index + 1,
          player: `${row.person.lastName} ${row.person.firstName}`,
          club: row.club.name,
          matches: row.matchesPlayed,
          goals: formatGoals(row.goals, row.penaltyGoals),
          assists: row.assists,
          total: row.goals + row.assists,
        },
      }))

      return [
        {
          title: 'Гол + Пасс',
          columns,
          rows,
        },
      ]
    }

    if (activeView === 'discipline') {
      if (!discipline.length) return []
      const columns: StatsExportSection['columns'] = [
        { key: 'rank', title: '#', align: 'center', width: '36px' },
        { key: 'player', title: 'Игрок', align: 'left' },
        { key: 'club', title: 'Клуб', align: 'left' },
        { key: 'yellowCards', title: 'ЖК', align: 'center', width: '64px' },
        { key: 'redCards', title: 'КК', align: 'center', width: '64px' },
      ]

      const rows: StatsExportSection['rows'] = discipline.map((row, index) => ({
        cells: {
          rank: index + 1,
          player: `${row.person.lastName} ${row.person.firstName}`,
          club: row.club.name,
          yellowCards: row.yellowCards,
          redCards: row.redCards,
        },
      }))

      return [
        {
          title: 'Дисциплина',
          columns,
          rows,
        },
      ]
    }

    return []
  }, [
    activeView,
    assistsTop,
    discipline,
    finishedMatchesByClub,
    goalContributions,
    groupSeedPreview,
    groupStandings,
    scorers,
    selectedSeason,
    standings,
  ])

  const isLoading = Boolean(loading.stats || loading.seasons)

  const canExportCurrentView = Boolean(
    selectedSeason && exportableViews.has(activeView) && exportSections.length && !isLoading
  )

  const handleStatsExport = () => {
    if (!selectedSeason) {
      handleFeedback('Выберите сезон для экспорта статистики', 'error')
      return
    }
    if (!exportableViews.has(activeView)) {
      handleFeedback('Экспорт доступен только для вкладок «Срез данных»', 'error')
      return
    }
    if (!exportSections.length) {
      handleFeedback('Нет данных для экспорта выбранной вкладки', 'error')
      return
    }

    const chips = dataSliceTabs.map(tab => ({
      label: tab.label.toUpperCase(),
      active: tab.key === activeView,
    }))
    const dateRangeLabel =
      selectedSeason.startDate && selectedSeason.endDate
        ? `${selectedSeason.startDate.slice(0, 10)} — ${selectedSeason.endDate.slice(0, 10)}`
        : ''
    const viewLabel = resolveViewLabel(activeView)

    let markup: string
    try {
      markup = buildStatsExportHtml({
        season: selectedSeason,
        competitionName: selectedSeason.competition.name,
        viewKey: activeView,
        viewLabel,
        chips,
        sections: exportSections,
        dateRange: dateRangeLabel,
        footerNote: 'Все данные обновляются автоматически после завершения матчей.',
      })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Не удалось подготовить файл с экспортом статистики'
      handleFeedback(message, 'error')
      return
    }

    const exportWindow = window.open('', '_blank')
    if (!exportWindow) {
      handleFeedback('Разрешите всплывающие окна, чтобы открыть экспорт', 'error')
      return
    }
    exportWindow.document.open()
    exportWindow.document.write(markup)
    exportWindow.document.close()
    exportWindow.focus()
    handleFeedback(
      'Экспорт открыт в новом окне. Используйте кнопки, чтобы сохранить изображение или отправить на печать.',
      'success'
    )
  }

  return (
    <div className="tab-sections">
      <header className="tab-header">
        <div>
          <h3>Статистика сезона</h3>
          <p>Рейтинги команд и игроков, рассчитанные по данным лиги.</p>
        </div>
        <button
          className="button-ghost"
          type="button"
          disabled={!selectedSeasonId || isLoading}
          onClick={() => selectedSeasonId && fetchStats(selectedSeasonId)}
        >
          {isLoading ? 'Обновляем…' : 'Пересчитать'}
        </button>
      </header>
      {error ? <div className="inline-feedback error">{error}</div> : null}
          {feedback ? <div className={`inline-feedback ${feedbackLevel}`}>{feedback}</div> : null}
      <section className="card-grid">
        <article className="card">
          <header>
            <h4>Выбор сезона</h4>
            <p>Показываются только доступные статистические показатели.</p>
          </header>
          <label className="stacked">
            Турнир
            <div className="chip-row">
              {competitionOptions.map(competition => (
                <button
                  key={competition.id}
                  type="button"
                  className={selectedCompetitionId === competition.id ? 'chip active' : 'chip'}
                  onClick={() => setSelectedCompetition(competition.id)}
                >
                  {competition.name}
                </button>
              ))}
            </div>
          </label>
          <label className="stacked">
            Сезон
            <select
              value={selectedSeasonId ?? ''}
              onChange={event =>
                setSelectedSeason(event.target.value ? Number(event.target.value) : undefined)
              }
            >
              <option value="">—</option>
              {seasonsForCompetition.map(season => (
                <option key={season.id} value={season.id}>
                  {season.name} ({season.competition.name})
                </option>
              ))}
            </select>
          </label>
          {selectedSeason ? (
            <p className="muted">
              Период: {selectedSeason.startDate.slice(0, 10)} —{' '}
              {selectedSeason.endDate.slice(0, 10)}
            </p>
          ) : (
            <p className="muted">Выберите сезон, чтобы увидеть таблицы.</p>
          )}
        </article>
        <article className="card">
          <header
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <h4>Срез данных</h4>
              <p>Переключайтесь между показателями клубов и игроков.</p>
            </div>
            <div className="tab-header-actions">
              <button
                type="button"
                className="button-ghost"
                disabled={!canExportCurrentView}
                onClick={handleStatsExport}
              >
                Экспорт
              </button>
            </div>
          </header>
          <nav className="chip-row">
            <button
              type="button"
              className={activeView === 'standings' ? 'chip active' : 'chip'}
              onClick={() => setActiveView('standings')}
            >
              Таблица
            </button>
            <button
              type="button"
              className={activeView === 'scorers' ? 'chip active' : 'chip'}
              onClick={() => setActiveView('scorers')}
            >
              Бомбардиры
            </button>
            <button
              type="button"
              className={activeView === 'assists' ? 'chip active' : 'chip'}
              onClick={() => setActiveView('assists')}
            >
              Передачи
            </button>
            <button
              type="button"
              className={activeView === 'goalContribution' ? 'chip active' : 'chip'}
              onClick={() => setActiveView('goalContribution')}
            >
              Гол+Пасс
            </button>
            <button
              type="button"
              className={activeView === 'discipline' ? 'chip active' : 'chip'}
              onClick={() => setActiveView('discipline')}
            >
              Дисциплина
            </button>
          </nav>
          <p className="muted">Все данные обновляются автоматически по завершении матчей.</p>
        </article>
        <article className="card">
          <header>
            <h4>Данные за всё время</h4>
            <p>Сводные показатели по клубам и игрокам без привязки к сезону.</p>
          </header>
          <nav className="chip-row">
            <button
              type="button"
              className={activeView === 'teams' ? 'chip active' : 'chip'}
              onClick={() => setActiveView('teams')}
            >
              Команды
            </button>
            <button
              type="button"
              className={activeView === 'career' ? 'chip active' : 'chip'}
              onClick={() => setActiveView('career')}
            >
              Карьера игроков
            </button>
          </nav>
          <p className="muted">Данные суммируются по всем сыгранным турнирам лиги.</p>
        </article>
      </section>

      {activeView === 'standings' ? (
        <section className="card">
          <header>
            <h4>Турнирная таблица</h4>
            <p>Сортировка: очки, личные встречи, разница голов.</p>
          </header>
          {groupStandings && groupStandings.length ? (
            <div className="group-standings-grid">
              {groupStandings.map(group => {
                const hasRows = group.rows.length > 0
                return (
                  <div className="group-standings-card" key={`group-${group.groupIndex}`}>
                    <div className="group-standings-header">
                      <h5>{group.label}</h5>
                      <span className="muted">Проходят: {group.qualifyCount}</span>
                    </div>
                    {hasRows ? (
                      <table className="data-table compact">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Р</th>
                            <th>Клуб</th>
                            <th>И</th>
                            <th title="Победы">В</th>
                            <th title="Ничьи">Н</th>
                            <th title="Поражения">П</th>
                            <th>Голы</th>
                            <th>Очки</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.rows.map((row, index) => {
                            const matchesKey = `${row.seasonId}:${row.clubId}`
                            const matches = finishedMatchesByClub.get(matchesKey)
                            const inferredDraws = Math.max(0, row.points - row.wins * 3)
                            const matchesPlayed = matches ?? row.wins + row.losses + inferredDraws
                            const draws = Math.max(0, matchesPlayed - row.wins - row.losses)
                            const highlight = index < group.qualifyCount

                            return (
                              <tr
                                key={`${row.seasonId}-${row.clubId}`}
                                className={highlight ? 'qualify-row' : undefined}
                              >
                                <td>{index + 1}</td>
                                <td>{groupSeedPreview?.get(row.clubId) ?? '—'}</td>
                                <td>{row.club.name}</td>
                                <td>{matchesPlayed}</td>
                                <td>{row.wins}</td>
                                <td>{draws}</td>
                                <td>{row.losses}</td>
                                <td>
                                  {row.goalsFor}:{row.goalsAgainst} (
                                  {row.goalsFor - row.goalsAgainst})
                                </td>
                                <td>{row.points}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    ) : (
                      <p className="muted">Группа ещё не заполнена участниками.</p>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Клуб</th>
                    <th>И</th>
                    <th title="Победы">В</th>
                    <th title="Ничьи">Н</th>
                    <th title="Поражения">П</th>
                    <th>Голы</th>
                    <th>Очки</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((row, index) => {
                    const matchesKey = `${row.seasonId}:${row.clubId}`
                    const matches = finishedMatchesByClub.get(matchesKey)
                    const inferredDraws = Math.max(0, row.points - row.wins * 3)
                    const matchesPlayed = matches ?? row.wins + row.losses + inferredDraws
                    const draws = Math.max(0, matchesPlayed - row.wins - row.losses)

                    return (
                      <tr key={`${row.seasonId}-${row.clubId}`}>
                        <td>{index + 1}</td>
                        <td>{row.club.name}</td>
                        <td>{matchesPlayed}</td>
                        <td>{row.wins}</td>
                        <td>{draws}</td>
                        <td>{row.losses}</td>
                        <td>
                          {row.goalsFor}:{row.goalsAgainst} ({row.goalsFor - row.goalsAgainst})
                        </td>
                        <td>{row.points}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {!standings.length ? (
                <p className="muted">Нет данных для выбранного сезона.</p>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {activeView === 'teams' ? (
        <section className="card">
          <header>
            <h4>Команды — сводная статистика</h4>
            <p>Данные накапливаются за все сыгранные турниры лиги.</p>
          </header>
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Клуб</th>
                <th>Турниров</th>
                <th>Игры</th>
                <th>ЖК</th>
                <th>КК</th>
                <th>Забито</th>
                <th>Пропущено</th>
                <th>На «0»</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((row, index) => (
                <tr key={row.clubId}>
                  <td>{index + 1}</td>
                  <td>{row.club.name}</td>
                  <td>{row.tournaments}</td>
                  <td>{row.matchesPlayed}</td>
                  <td>{row.yellowCards}</td>
                  <td>{row.redCards}</td>
                  <td>{row.goalsFor}</td>
                  <td>{row.goalsAgainst}</td>
                  <td>{row.cleanSheets}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!teams.length ? (
            <p className="muted">Нет данных: сыгранные турниры не найдены.</p>
          ) : null}
        </section>
      ) : null}

      {activeView === 'scorers' ? (
        <section className="card">
          <header>
            <h4>Список бомбардиров</h4>
            <p>При равенстве голов выше игрок с меньшим количеством матчей.</p>
          </header>
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Игрок</th>
                <th>Клуб</th>
                <th>Матчи</th>
                <th>Кф.эфф</th>
                <th>Голы</th>
              </tr>
            </thead>
            <tbody>
              {scorers.map((row, index) => (
                <tr key={`${row.seasonId}-${row.personId}`}>
                  <td>{index + 1}</td>
                  <td>
                    {row.person.lastName} {row.person.firstName}
                  </td>
                  <td>{row.club.name}</td>
                  <td>{row.matchesPlayed}</td>
                  <td>{formatEfficiency(row.goals, row.matchesPlayed)}</td>
                  <td>{formatGoals(row.goals, row.penaltyGoals)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!scorers.length ? <p className="muted">Нет статистики по голам.</p> : null}
        </section>
      ) : null}

      {activeView === 'assists' ? (
        <section className="card">
          <header>
            <h4>Таблица ассистентов</h4>
            <p>Топ-10 игроков по голевым передачам в выбранном сезоне.</p>
          </header>
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Игрок</th>
                <th>Клуб</th>
                <th>Матчи</th>
                <th>Передачи</th>
              </tr>
            </thead>
            <tbody>
              {assistsTop.map((row, index) => (
                <tr key={`${row.seasonId}-${row.personId}`}>
                  <td>{index + 1}</td>
                  <td>
                    {row.person.lastName} {row.person.firstName}
                  </td>
                  <td>{row.club.name}</td>
                  <td>{row.matchesPlayed}</td>
                  <td>{row.assists}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!assistsTop.length ? <p className="muted">Передачи пока не зафиксированы.</p> : null}
        </section>
      ) : null}

      {activeView === 'goalContribution' ? (
        <section className="card">
          <header>
            <h4>Комбинированный рейтинг Гол+Пасс</h4>
            <p>Сортировка: Гол+Пасс, голы, чистые голы, передачи, количество матчей.</p>
          </header>
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Игрок</th>
                <th>Клуб</th>
                <th>Матчи</th>
                <th>Голы</th>
                <th>Передачи</th>
                <th>Гол+Пасс</th>
              </tr>
            </thead>
            <tbody>
              {goalContributions.map((row, index) => {
                const total = row.goals + row.assists
                return (
                  <tr key={`${row.seasonId}-${row.personId}`}>
                    <td>{index + 1}</td>
                    <td>
                      {row.person.lastName} {row.person.firstName}
                    </td>
                    <td>{row.club.name}</td>
                    <td>{row.matchesPlayed}</td>
                    <td>{formatGoals(row.goals, row.penaltyGoals)}</td>
                    <td>{row.assists}</td>
                    <td>{total}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!goalContributions.length ? (
            <p className="muted">Нет результативных действий в выбранном сезоне.</p>
          ) : null}
        </section>
      ) : null}

      {activeView === 'discipline' ? (
        <section className="card">
          <header>
            <h4>Дисциплинарные показатели</h4>
            <p>Список игроков с наибольшим количеством жёлтых карточек.</p>
          </header>
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Игрок</th>
                <th>Клуб</th>
                <th>Жёлтые карточки</th>
                <th>Красные карточки</th>
              </tr>
            </thead>
            <tbody>
              {discipline.map((row, index) => (
                <tr key={`${row.seasonId}-${row.personId}`}>
                  <td>{index + 1}</td>
                  <td>
                    {row.person.lastName} {row.person.firstName}
                  </td>
                  <td>{row.club.name}</td>
                  <td>{row.yellowCards}</td>
                  <td>{row.redCards}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!discipline.length ? <p className="muted">Дисциплинарных записей пока нет.</p> : null}
        </section>
      ) : null}

      {activeView === 'career' ? (
        <section className="card">
          <header>
            <h4>Карьера игроков</h4>
            <p>Показатель учитывает суммарные голы и количество матчей.</p>
          </header>
          <label className="stacked" style={{ maxWidth: 260 }}>
            Клуб
            <select
              value={careerClubId ?? ''}
              onChange={event =>
                setCareerClubId(event.target.value ? Number(event.target.value) : undefined)
              }
            >
              <option value="">Выберите клуб</option>
              {careerClubOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {careerClubId ? (
            <>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Игрок</th>
                    <th>Клуб</th>
                    <th>Матчи</th>
                    <th>ЖК</th>
                    <th>КК</th>
                    <th>Пасы</th>
                    <th>Голы</th>
                  </tr>
                </thead>
                <tbody>
                  {career.map((row, index) => (
                    <tr key={`${row.personId}-${row.clubId}`}>
                      <td>{index + 1}</td>
                      <td>
                        {row.person.lastName} {row.person.firstName}
                      </td>
                      <td>{row.club.name}</td>
                      <td>{row.totalMatches}</td>
                      <td>{row.yellowCards}</td>
                      <td>{row.redCards}</td>
                      <td>{row.totalAssists}</td>
                      <td>{formatGoals(row.totalGoals, row.penaltyGoals)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!career.length ? (
                <p className="muted">Для выбранного клуба нет карьерной статистики.</p>
              ) : null}
            </>
          ) : (
            <p className="muted">Выберите клуб, чтобы увидеть карьерную статистику игроков.</p>
          )}
        </section>
      ) : null}
    </div>
  )
}
