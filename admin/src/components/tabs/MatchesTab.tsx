import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  adjustMatchStatistic,
  adminDelete,
  adminGet,
  adminPost,
  adminPut,
  createSeasonAutomation,
  createSeasonPlayoffs,
  fetchMatchStatistics,
} from '../../api/adminClient'
import type { SeasonGroupStagePayload } from '../../api/adminClient'
import { useAdminStore } from '../../store/adminStore'
import {
  Club,
  FriendlyMatch,
  MatchEventEntry,
  MatchLineupEntry,
  MatchSeries,
  MatchSummary,
  Person,
  Season,
  SeasonAutomationResult,
  MatchStatisticEntry,
  MatchStatisticMetric,
  PlayoffCreationResult,
  SeasonParticipant,
  SeriesFormat,
} from '../../types'
import { PlayoffBracket } from '../PlayoffBracket'

type FeedbackLevel = 'info' | 'success' | 'error'

type SeriesFormState = {
  stageName: string
  homeClubId: number | ''
  awayClubId: number | ''
}

type MatchFormState = {
  matchDateTime: string
  homeTeamName: string
  awayTeamName: string
  stadiumId: number | ''
  refereeId: number | ''
  eventName: string
}

type EventFormState = {
  teamId: number | ''
  playerId: number | ''
  minute: number | ''
  eventType: MatchEventEntry['eventType']
  relatedPlayerId: number | ''
}

type SeasonAutomationFormState = {
  competitionId: number | ''
  seasonName: string
  startDate: string
  matchDayOfWeek: string
  matchTime: string
  clubIds: number[]
  seriesFormat: SeriesFormat
}

type GroupStageSlotState = {
  position: number
  clubId: number | ''
}

type GroupStageGroupState = {
  groupIndex: number
  label: string
  slots: GroupStageSlotState[]
}

type GroupStageState = {
  groupCount: number
  groupSize: number
  qualifyCount: number
  groups: GroupStageGroupState[]
}

type MatchUpdateFormState = {
  homeScore: number | ''
  awayScore: number | ''
  status: MatchSummary['status']
  stadiumId: number | ''
  refereeId: number | ''
  matchDateTime: string
  hasPenaltyShootout: boolean
  penaltyHomeScore: number
  penaltyAwayScore: number
}

const playoffBestOfOptions = [3, 5, 7]

const defaultSeriesForm: SeriesFormState = {
  stageName: '',
  homeClubId: '',
  awayClubId: '',
}

const defaultMatchForm: MatchFormState = {
  matchDateTime: '',
  homeTeamName: '',
  awayTeamName: '',
  stadiumId: '',
  refereeId: '',
  eventName: '',
}

const defaultEventForm: EventFormState = {
  teamId: '',
  playerId: '',
  minute: '',
  eventType: 'GOAL',
  relatedPlayerId: '',
}

type EventPlayerOption = {
  personId: number
  clubId: number
  person: Person
  club: Club
  source: 'lineup' | 'roster'
  shirtNumber?: number | null
}

const defaultAutomationForm: SeasonAutomationFormState = {
  competitionId: '',
  seasonName: '',
  startDate: new Date().toISOString().slice(0, 10),
  matchDayOfWeek: '0',
  matchTime: '12:00',
  clubIds: [],
  seriesFormat: 'SINGLE_MATCH',
}

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

const groupLabelForIndex = (index: number): string => {
  if (index < alphabet.length) {
    return `Группа ${alphabet[index]}`
  }
  const first = Math.floor(index / alphabet.length) - 1
  const second = index % alphabet.length
  return `Группа ${alphabet[first] ?? 'X'}${alphabet[second]}`
}

const createEmptyGroup = (groupIndex: number, groupSize: number): GroupStageGroupState => ({
  groupIndex,
  label: groupLabelForIndex(groupIndex - 1),
  slots: Array.from({ length: groupSize }, (_, position) => ({
    position: position + 1,
    clubId: '' as number | '',
  })),
})

const buildDefaultGroupStage = (
  groupCount = 2,
  groupSize = 3,
  qualifyCount = 2
): GroupStageState => ({
  groupCount,
  groupSize,
  qualifyCount: Math.min(qualifyCount, groupSize),
  groups: Array.from({ length: groupCount }, (_, index) => createEmptyGroup(index + 1, groupSize)),
})

const resizeGroupSlots = (
  slots: GroupStageSlotState[],
  groupSize: number
): GroupStageSlotState[] => {
  const next = slots.slice(0, groupSize)
  if (next.length < groupSize) {
    for (let position = next.length + 1; position <= groupSize; position += 1) {
      next.push({ position, clubId: '' })
    }
  } else {
    next.forEach((slot, index) => {
      next[index] = { ...slot, position: index + 1 }
    })
  }
  return next
}

const buildMatchUpdateForm = (match: MatchSummary): MatchUpdateFormState => ({
  homeScore: typeof match.homeScore === 'number' ? match.homeScore : '',
  awayScore: typeof match.awayScore === 'number' ? match.awayScore : '',
  status: match.status,
  stadiumId: match.stadiumId ?? '',
  refereeId: match.refereeId ?? '',
  matchDateTime: match.matchDateTime.slice(0, 16),
  hasPenaltyShootout: match.hasPenaltyShootout ?? false,
  penaltyHomeScore: match.penaltyHomeScore ?? 0,
  penaltyAwayScore: match.penaltyAwayScore ?? 0,
})

const seriesFormatNames: Record<SeriesFormat, string> = {
  SINGLE_MATCH: 'Лига: один круг',
  TWO_LEGGED: 'Лига: два круга (дом и гости)',
  BEST_OF_N: '1 круг+плей-офф',
  DOUBLE_ROUND_PLAYOFF: '2 круга+плей-офф',
  PLAYOFF_BRACKET: 'Плей-офф: случайная сетка',
  GROUP_SINGLE_ROUND_PLAYOFF: 'Кубок: группы (1 круг) + плей-офф',
}

const automationSeriesLabels: Record<SeriesFormat, string> = {
  SINGLE_MATCH: `${seriesFormatNames.SINGLE_MATCH} (каждый с каждым)`,
  TWO_LEGGED: `${seriesFormatNames.TWO_LEGGED}`,
  BEST_OF_N: `${seriesFormatNames.BEST_OF_N}`,
  DOUBLE_ROUND_PLAYOFF: `${seriesFormatNames.DOUBLE_ROUND_PLAYOFF}`,
  PLAYOFF_BRACKET: 'Плей-офф: случайная сетка (без регулярного этапа)',
  GROUP_SINGLE_ROUND_PLAYOFF: 'Кубок: групповой этап в один круг + плей-офф',
}

const competitionTypeLabels: Record<'LEAGUE' | 'CUP', string> = {
  LEAGUE: 'Лига',
  CUP: 'Кубок',
}

const weekdayOptions = [
  { value: '0', label: 'Воскресенье' },
  { value: '1', label: 'Понедельник' },
  { value: '2', label: 'Вторник' },
  { value: '3', label: 'Среда' },
  { value: '4', label: 'Четверг' },
  { value: '5', label: 'Пятница' },
  { value: '6', label: 'Суббота' },
]

const seriesStatuses: MatchSeries['seriesStatus'][] = ['IN_PROGRESS', 'FINISHED']

const seriesStatusLabels: Record<MatchSeries['seriesStatus'], string> = {
  IN_PROGRESS: 'В процессе',
  FINISHED: 'Завершена',
}

const matchStatuses: MatchSummary['status'][] = ['SCHEDULED', 'LIVE', 'FINISHED', 'POSTPONED']

const matchStatusLabels: Record<MatchSummary['status'], string> = {
  SCHEDULED: 'Запланирован',
  LIVE: 'Идёт',
  FINISHED: 'Завершён',
  POSTPONED: 'Перенесён',
}

const eventTypes: MatchEventEntry['eventType'][] = [
  'GOAL',
  'PENALTY_GOAL',
  'OWN_GOAL',
  'PENALTY_MISSED',
  'YELLOW_CARD',
  'SECOND_YELLOW_CARD',
  'RED_CARD',
  'SUB_IN',
  'SUB_OUT',
]

const eventTypeLabels: Record<MatchEventEntry['eventType'], string> = {
  GOAL: 'Гол',
  PENALTY_GOAL: 'Гол с пенальти',
  OWN_GOAL: 'Автогол',
  PENALTY_MISSED: 'Незабитый пенальти',
  YELLOW_CARD: 'Жёлтая карточка',
  SECOND_YELLOW_CARD: 'Вторая жёлтая (удаление)',
  RED_CARD: 'Красная карточка',
  SUB_IN: 'Замена (вышел)',
  SUB_OUT: 'Замена (ушёл)',
}

const matchStatisticRows: Array<{ metric: MatchStatisticMetric; label: string }> = [
  { metric: 'totalShots', label: 'Всего ударов' },
  { metric: 'shotsOnTarget', label: 'Удары в створ' },
  { metric: 'corners', label: 'Угловые' },
  { metric: 'yellowCards', label: 'Жёлтые карточки' },
  { metric: 'redCards', label: 'Удаления' },
]

export const MatchesTab = () => {
  const {
    token,
    data,
    selectedSeasonId,
    setSelectedSeason,
    fetchSeasons,
    fetchSeries,
    fetchMatches,
    fetchFriendlyMatches,
    fetchDictionaries,
    activateSeason,
    loading,
    error,
  } = useAdminStore(state => ({
    token: state.token,
    data: state.data,
    selectedSeasonId: state.selectedSeasonId,
    setSelectedSeason: state.setSelectedSeason,
    fetchSeasons: state.fetchSeasons,
    fetchSeries: state.fetchSeries,
    fetchMatches: state.fetchMatches,
    fetchFriendlyMatches: state.fetchFriendlyMatches,
    fetchDictionaries: state.fetchDictionaries,
    activateSeason: state.activateSeason,
    loading: state.loading,
    error: state.error,
  }))

  const friendlyMatchesSorted = useMemo<FriendlyMatch[]>(() => {
    if (!data.friendlyMatches?.length) return []
    return [...data.friendlyMatches].sort((left, right) =>
      left.matchDateTime < right.matchDateTime ? 1 : -1
    )
  }, [data.friendlyMatches])
  const [feedback, setFeedback] = useState<string | null>(null)
  const [feedbackLevel, setFeedbackLevel] = useState<FeedbackLevel>('info')

  const [seriesForm, setSeriesForm] = useState<SeriesFormState>(defaultSeriesForm)
  const [editingSeriesId, setEditingSeriesId] = useState<string | null>(null)
  const [seriesStatusUpdate, setSeriesStatusUpdate] =
    useState<MatchSeries['seriesStatus']>('IN_PROGRESS')
  const [seriesWinnerId, setSeriesWinnerId] = useState<number | ''>('')
  const [matchForm, setMatchForm] = useState<MatchFormState>(defaultMatchForm)
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null)
  const [isMatchModalOpen, setMatchModalOpen] = useState(false)
  const [matchUpdateForms, setMatchUpdateForms] = useState<Record<string, MatchUpdateFormState>>({})
  const matchModalRef = useRef<HTMLDivElement | null>(null)

  const [eventForm, setEventForm] = useState<EventFormState>(defaultEventForm)

  const [matchLineup, setMatchLineup] = useState<MatchLineupEntry[]>([])
  const [matchEvents, setMatchEvents] = useState<MatchEventEntry[]>([])
  const [matchStats, setMatchStats] = useState<Record<number, MatchStatisticEntry>>({})
  const [matchStatsVersion, setMatchStatsVersion] = useState<number | undefined>(undefined)
  const [matchStatsLoading, setMatchStatsLoading] = useState(false)
  const [matchStatsUpdating, setMatchStatsUpdating] = useState(false)

  const mapStatisticEntries = (entries: MatchStatisticEntry[]) => {
    const next: Record<number, MatchStatisticEntry> = {}
    for (const entry of entries) {
      next[entry.clubId] = entry
    }
    return next
  }

  const ensureClubForStats = (clubId: number): Club => {
    const existing = data.clubs.find(club => club.id === clubId)
    if (existing) {
      return existing
    }
    const label = `Клуб ${clubId}`
    return {
      id: clubId,
      name: label,
      shortName: label,
    }
  }

  const [automationForm, setAutomationForm] =
    useState<SeasonAutomationFormState>(defaultAutomationForm)
  const [groupStageState, setGroupStageState] = useState<GroupStageState>(buildDefaultGroupStage())
  const [automationResult, setAutomationResult] = useState<SeasonAutomationResult | null>(null)
  const [automationLoading, setAutomationLoading] = useState(false)
  const automationSeedingEnabled =
    automationForm.seriesFormat === 'BEST_OF_N' ||
    automationForm.seriesFormat === 'DOUBLE_ROUND_PLAYOFF'
  const automationRandomBracket = automationForm.seriesFormat === 'PLAYOFF_BRACKET'
  const automationGroupStage = automationForm.seriesFormat === 'GROUP_SINGLE_ROUND_PLAYOFF'
  const [lastGroupStagePreview, setLastGroupStagePreview] =
    useState<SeasonGroupStagePayload | null>(null)
  const [playoffBestOf, setPlayoffBestOf] = useState<number>(playoffBestOfOptions[0])
  const [playoffLoading, setPlayoffLoading] = useState(false)
  const [playoffResult, setPlayoffResult] = useState<PlayoffCreationResult | null>(null)

  const isLoading = Boolean(loading.matches || loading.seasons)
  const activatingSeason = Boolean(loading.activateSeason)

  const selectedSeason = useMemo<Season | undefined>(() => {
    return data.seasons.find(season => season.id === selectedSeasonId)
  }, [data.seasons, selectedSeasonId])

  const activeSeason = useMemo<Season | undefined>(() => {
    return data.seasons.find(season => season.isActive)
  }, [data.seasons])

  const seasonParticipants = useMemo<SeasonParticipant[]>(() => {
    return selectedSeason?.participants ?? []
  }, [selectedSeason])

  const clubsById = useMemo(() => {
    const map = new Map<number, Club>()
    for (const club of data.clubs) {
      map.set(club.id, club)
    }
    return map
  }, [data.clubs])

  const competitionFormat: SeriesFormat | undefined =
    selectedSeason?.seriesFormat ?? selectedSeason?.competition.seriesFormat
  const isBestOfFormat =
    competitionFormat === 'BEST_OF_N' || competitionFormat === 'DOUBLE_ROUND_PLAYOFF'
  const isPlayoffBracketFormat = competitionFormat === 'PLAYOFF_BRACKET'
  const isGroupPlayoffFormat = competitionFormat === 'GROUP_SINGLE_ROUND_PLAYOFF'
  const supportsPlayoffSeries = isBestOfFormat || isPlayoffBracketFormat || isGroupPlayoffFormat

  // Одноразовая инициализация словарей и сезонов
  const bootRef = useRef(false)
  useEffect(() => {
    if (!token || bootRef.current) return
    bootRef.current = true
    void fetchDictionaries().catch(() => undefined)
    void fetchSeasons().catch(() => undefined)
    void fetchFriendlyMatches().catch(() => undefined)
  }, [token, fetchDictionaries, fetchSeasons, fetchFriendlyMatches])

  useEffect(() => {
    if (!selectedSeasonId || !token) return
    void fetchSeries(selectedSeasonId).catch(() => undefined)
    void fetchMatches(selectedSeasonId).catch(() => undefined)
  }, [selectedSeasonId, token, fetchSeries, fetchMatches])

  useEffect(() => {
    setPlayoffResult(null)
  }, [selectedSeasonId])

  const playoffSuccessBanner = useMemo(() => {
    if (!playoffResult) return null
    const byeDescriptions = (playoffResult.byeSeries ?? []).map(entry => {
      const clubName =
        data.clubs.find(club => club.id === entry.clubId)?.name ?? `клуб #${entry.clubId}`
      return `Посев #${entry.seed} — ${clubName}`
    })
    const byeText = byeDescriptions.length ? `, автопроход: ${byeDescriptions.join('; ')}` : ''
    return (
      <div className="inline-feedback success">
        Серий: {playoffResult.seriesCreated}, матчей: {playoffResult.matchesCreated}
        {byeText}
      </div>
    )
  }, [data.clubs, playoffResult])

  const handleFeedback = (message: string, level: FeedbackLevel) => {
    setFeedback(message)
    setFeedbackLevel(level)
  }

  const ensureSeasonSelected = (): number | null => {
    if (!selectedSeasonId) {
      handleFeedback('Сначала выберите сезон', 'error')
      return null
    }
    return selectedSeasonId
  }

  const runWithMessages = async (fn: () => Promise<unknown>, successMessage: string) => {
    if (!token) {
      handleFeedback('Нет токена авторизации', 'error')
      return
    }
    try {
      await fn()
      handleFeedback(successMessage, 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось выполнить операцию'
      handleFeedback(message, 'error')
    }
  }

  const refreshMatchStats = async (matchId: string, options?: { silent?: boolean }) => {
    if (!token) return
    setMatchStatsLoading(true)
    try {
      const { entries, version } = await fetchMatchStatistics(token, matchId)
      setMatchStats(mapStatisticEntries(entries))
      setMatchStatsVersion(version)
    } catch (err) {
      setMatchStats({})
      setMatchStatsVersion(undefined)
      if (!options?.silent) {
        const message = err instanceof Error ? err.message : 'Не удалось загрузить статистику матча'
        handleFeedback(message, 'error')
      }
    } finally {
      setMatchStatsLoading(false)
    }
  }

  const loadMatchDetails = async (matchId: string) => {
    if (!token) return
    let lineupErrored = false
    try {
      const [lineup, events] = await Promise.all([
        adminGet<MatchLineupEntry[]>(token, `/api/admin/matches/${matchId}/lineup`),
        adminGet<MatchEventEntry[]>(token, `/api/admin/matches/${matchId}/events`),
      ])
      setMatchLineup(lineup)
      setMatchEvents(events)
    } catch (err) {
      lineupErrored = true
      const message = err instanceof Error ? err.message : 'Не удалось загрузить детали матча'
      handleFeedback(message, 'error')
    }

    await refreshMatchStats(matchId, { silent: lineupErrored })
  }

  const adjustStatistic = async (
    clubId: number | undefined,
    metric: MatchStatisticMetric,
    delta: -1 | 1
  ) => {
    if (!selectedMatchId || !selectedMatch || !clubId) return
    if (!token) {
      handleFeedback('Нет токена авторизации', 'error')
      return
    }
    if (matchStatsUpdating) return

    const previous = matchStats
    const baseEntry = previous[clubId] ?? {
      matchId: selectedMatchId,
      clubId,
      totalShots: 0,
      shotsOnTarget: 0,
      corners: 0,
      yellowCards: 0,
      redCards: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      club: ensureClubForStats(clubId),
    }

    const timestamp = new Date().toISOString()
    let requestDelta: number = delta
    let optimisticEntry: MatchStatisticEntry = {
      ...baseEntry,
      updatedAt: timestamp,
    }

    if (metric === 'shotsOnTarget') {
      const nextShotsOnTarget = Math.max(0, baseEntry.shotsOnTarget + delta)
      const appliedDelta = nextShotsOnTarget - baseEntry.shotsOnTarget
      if (appliedDelta === 0) return
      const nextTotalShots = Math.max(nextShotsOnTarget, baseEntry.totalShots + appliedDelta)
      optimisticEntry = {
        ...optimisticEntry,
        shotsOnTarget: nextShotsOnTarget,
        totalShots: nextTotalShots,
      }
      requestDelta = appliedDelta
    } else if (metric === 'totalShots') {
      const nextTotalShots = Math.max(baseEntry.shotsOnTarget, baseEntry.totalShots + delta)
      const appliedDelta = nextTotalShots - baseEntry.totalShots
      if (appliedDelta === 0) return
      optimisticEntry = {
        ...optimisticEntry,
        totalShots: nextTotalShots,
      }
      requestDelta = appliedDelta
    } else {
      const nextValue = Math.max(0, baseEntry[metric] + delta)
      if (nextValue === baseEntry[metric]) return
      optimisticEntry = {
        ...optimisticEntry,
        [metric]: nextValue,
      }
      requestDelta = nextValue - baseEntry[metric]
    }

    if (optimisticEntry.totalShots < optimisticEntry.shotsOnTarget) {
      optimisticEntry = {
        ...optimisticEntry,
        totalShots: optimisticEntry.shotsOnTarget,
      }
    }

    setMatchStats({ ...previous, [clubId]: optimisticEntry })
    setMatchStatsUpdating(true)

    try {
      const { entries, version } = await adjustMatchStatistic(token, selectedMatchId, {
        clubId,
        metric,
        delta: requestDelta,
      })
      setMatchStats(mapStatisticEntries(entries))
      setMatchStatsVersion(version)
    } catch (err) {
      setMatchStats(previous)
      const message = err instanceof Error ? err.message : 'Не удалось обновить статистику матча'
      handleFeedback(message, 'error')
      await refreshMatchStats(selectedMatchId, { silent: true })
    } finally {
      setMatchStatsUpdating(false)
    }
  }

  const toggleAutomationClub = (clubId: number) => {
    setAutomationForm(form => {
      if (form.clubIds.includes(clubId)) {
        return { ...form, clubIds: form.clubIds.filter(id => id !== clubId) }
      }
      return { ...form, clubIds: [...form.clubIds, clubId] }
    })
  }

  const updateGroupCount = (nextCount: number) => {
    setGroupStageState(prev => {
      const groupCount = Math.max(1, Math.min(nextCount, 12))
      if (groupCount === prev.groupCount) return prev

      const groups: GroupStageGroupState[] = []
      for (let index = 0; index < groupCount; index += 1) {
        const existing = prev.groups[index]
        if (existing) {
          groups.push({
            ...existing,
            groupIndex: index + 1,
            label: existing.label.trim() || groupLabelForIndex(index),
            slots: resizeGroupSlots(existing.slots, prev.groupSize),
          })
        } else {
          groups.push(createEmptyGroup(index + 1, prev.groupSize))
        }
      }

      return {
        groupCount,
        groupSize: prev.groupSize,
        qualifyCount: Math.min(prev.qualifyCount, prev.groupSize),
        groups,
      }
    })
  }

  const updateGroupSize = (nextSize: number) => {
    setGroupStageState(prev => {
      const groupSize = Math.max(2, Math.min(nextSize, 8))
      if (groupSize === prev.groupSize) return prev

      return {
        groupCount: prev.groupCount,
        groupSize,
        qualifyCount: Math.min(prev.qualifyCount, groupSize),
        groups: prev.groups.map(group => ({
          ...group,
          slots: resizeGroupSlots(group.slots, groupSize),
        })),
      }
    })
  }

  const updateQualifyCount = (nextQualify: number) => {
    setGroupStageState(prev => {
      const qualifyCount = Math.max(1, Math.min(nextQualify, prev.groupSize))
      if (qualifyCount === prev.qualifyCount) return prev
      return {
        ...prev,
        qualifyCount,
      }
    })
  }

  const updateGroupLabel = (groupIndex: number, label: string) => {
    setGroupStageState(prev => ({
      ...prev,
      groups: prev.groups.map(group =>
        group.groupIndex === groupIndex ? { ...group, label } : group
      ),
    }))
  }

  const updateGroupSlotClub = (groupIndex: number, position: number, clubId: number | '') => {
    setGroupStageState(prev => ({
      ...prev,
      groups: prev.groups.map(group => {
        if (group.groupIndex !== groupIndex) return group
        return {
          ...group,
          slots: group.slots.map(slot => (slot.position === position ? { ...slot, clubId } : slot)),
        }
      }),
    }))
  }

  const moveAutomationClub = (clubId: number, direction: -1 | 1) => {
    setAutomationForm(form => {
      const index = form.clubIds.findIndex(id => id === clubId)
      if (index === -1) return form
      const nextIndex = index + direction
      if (nextIndex < 0 || nextIndex >= form.clubIds.length) return form
      const next = [...form.clubIds]
      const [removed] = next.splice(index, 1)
      next.splice(nextIndex, 0, removed)
      return { ...form, clubIds: next }
    })
  }

  const handleAutomationSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (
      !automationForm.competitionId ||
      !automationForm.seasonName.trim() ||
      !automationForm.startDate
    ) {
      handleFeedback('Заполните данные соревнования, даты и названия', 'error')
      return
    }
    if (!automationGroupStage && automationForm.clubIds.length < 2) {
      handleFeedback('Выберите минимум две команды для участия', 'error')
      return
    }
    if (!token) {
      handleFeedback('Нет токена авторизации', 'error')
      return
    }

    const competitionId = Number(automationForm.competitionId)
    const matchDay = Number(automationForm.matchDayOfWeek)
    let groupStagePayload: SeasonGroupStagePayload | undefined
    let payloadClubIds: number[] = automationForm.clubIds

    if (automationGroupStage) {
      const qualifyCount = Math.min(groupStageState.qualifyCount, groupStageState.groupSize)
      const expectedSlots = groupStageState.groupCount * groupStageState.groupSize
      const usedSet = new Set<number>()
      const usedClubIds: number[] = []

      try {
        const groups = groupStageState.groups
          .slice(0, groupStageState.groupCount)
          .map((group, groupIndex) => {
            const normalizedLabel = group.label.trim() || groupLabelForIndex(groupIndex)
            if (!normalizedLabel.trim()) {
              throw new Error('group_stage_label_required')
            }

            const slots = resizeGroupSlots(group.slots, groupStageState.groupSize).map(
              (slot, slotIndex) => {
                const rawValue = slot.clubId
                const numericClubId = rawValue === '' ? NaN : Number(rawValue)
                if (!Number.isFinite(numericClubId)) {
                  throw new Error('group_stage_slot_club_required')
                }
                if (usedSet.has(numericClubId)) {
                  throw new Error('group_stage_duplicate_club')
                }
                usedSet.add(numericClubId)
                usedClubIds.push(numericClubId)
                return {
                  position: slotIndex + 1,
                  clubId: numericClubId,
                }
              }
            )

            return {
              groupIndex: groupIndex + 1,
              label: normalizedLabel,
              qualifyCount,
              slots,
            }
          })

        if (usedClubIds.length !== expectedSlots) {
          throw new Error('group_stage_slot_count')
        }

        groupStagePayload = {
          groupCount: groupStageState.groupCount,
          groupSize: groupStageState.groupSize,
          qualifyCount,
          groups,
        }
        payloadClubIds = usedClubIds
      } catch (validationError) {
        const error =
          validationError instanceof Error ? validationError.message : 'group_stage_incomplete'
        switch (error) {
          case 'group_stage_label_required':
            handleFeedback('Укажите название для каждой группы', 'error')
            break
          case 'group_stage_duplicate_club':
            handleFeedback('Каждый клуб может быть только в одной группе', 'error')
            break
          case 'group_stage_slot_club_required':
          case 'group_stage_slot_count':
          default:
            handleFeedback('Заполните все слоты групп участниками', 'error')
            break
        }
        return
      }
    }

    const payload = {
      competitionId,
      seasonName: automationForm.seasonName.trim(),
      startDate: automationForm.startDate,
      matchDayOfWeek: Number.isFinite(matchDay) ? matchDay : 0,
      matchTime: automationForm.matchTime || undefined,
      clubIds: payloadClubIds,
      seriesFormat: automationForm.seriesFormat,
      groupStage: groupStagePayload,
    }

    try {
      setAutomationLoading(true)
      const result = await createSeasonAutomation(token, payload)
      setAutomationResult(result)
      handleFeedback(
        `Сезон создан автоматически: ${result.participantsCreated} команд, ${result.matchesCreated} матчей, ${result.rosterEntriesCreated} заявок, ${result.seriesCreated} серий плей-офф, ${result.groupsCreated} групп (слотов: ${result.groupSlotsCreated})`,
        'success'
      )
      await fetchSeasons()
      setSelectedSeason(result.seasonId)
      setAutomationForm({
        ...defaultAutomationForm,
        startDate: new Date().toISOString().slice(0, 10),
      })
      setGroupStageState(buildDefaultGroupStage())
      setLastGroupStagePreview(
        groupStagePayload
          ? {
              groupCount: groupStagePayload.groupCount,
              groupSize: groupStagePayload.groupSize,
              qualifyCount: groupStagePayload.qualifyCount,
              groups: groupStagePayload.groups.map(group => ({
                ...group,
                slots: group.slots.map(slot => ({ ...slot })),
              })),
            }
          : null
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось запустить автоматизацию'
      handleFeedback(message, 'error')
    } finally {
      setAutomationLoading(false)
    }
  }

  const handleRefreshPlayoffData = () => {
    const seasonId = ensureSeasonSelected()
    if (!seasonId) return
    void Promise.all([
      fetchSeries(seasonId, { force: true }),
      fetchMatches(seasonId, { force: true }),
    ]).catch(() => undefined)
  }

  const handleCreatePlayoffs = async () => {
    const seasonId = ensureSeasonSelected()
    if (!seasonId) return
    if (!token) {
      handleFeedback('Нет токена авторизации', 'error')
      return
    }
    if (playoffsDisabledReason) {
      handleFeedback(playoffsDisabledReason, 'error')
      return
    }
    const bestOfPayload = isBestOfFormat ? playoffBestOf : undefined

    try {
      setPlayoffLoading(true)
      const result = await createSeasonPlayoffs(
        token,
        seasonId,
        typeof bestOfPayload === 'number' ? { bestOfLength: bestOfPayload } : {}
      )
      setPlayoffResult(result)
      const byeDescriptions = (result.byeSeries ?? []).map(entry => {
        const clubName =
          data.clubs.find(club => club.id === entry.clubId)?.name ?? `клуб #${entry.clubId}`
        return `Посев #${entry.seed} — ${clubName}`
      })
      const successMessage = [`Серий: ${result.seriesCreated}`, `Матчей: ${result.matchesCreated}`]
      if (byeDescriptions.length) {
        successMessage.push(`Автопроход: ${byeDescriptions.join('; ')}`)
      }
      handleFeedback(`Плей-офф создан (${successMessage.join(', ')})`, 'success')
      await Promise.all([
        fetchSeries(seasonId, { force: true }),
        fetchMatches(seasonId, { force: true }),
        fetchSeasons(),
      ])
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось создать плей-офф'
      handleFeedback(message, 'error')
    } finally {
      setPlayoffLoading(false)
    }
  }

  const handleSeriesSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const seasonId = ensureSeasonSelected()
    if (!seasonId || !seriesForm.stageName || !seriesForm.homeClubId || !seriesForm.awayClubId) {
      handleFeedback('Укажите стадии и клубы для серии', 'error')
      return
    }
    await runWithMessages(async () => {
      const payload = {
        seasonId,
        stageName: seriesForm.stageName.trim(),
        homeClubId: seriesForm.homeClubId,
        awayClubId: seriesForm.awayClubId,
      }
      if (editingSeriesId) {
        await adminPut(token, `/api/admin/series/${editingSeriesId}`, {
          seriesStatus: seriesStatusUpdate,
          winnerClubId: seriesWinnerId || undefined,
        })
      } else {
        await adminPost(token, '/api/admin/series', payload)
      }
      await fetchSeries(seasonId, { force: true })
    }, 'Серия сохранена')
    setSeriesForm(defaultSeriesForm)
    setEditingSeriesId(null)
    setSeriesWinnerId('')
    setSeriesStatusUpdate('IN_PROGRESS')
  }

  const handleSeriesEdit = (series: MatchSeries) => {
    setEditingSeriesId(series.id)
    setSeriesForm({
      stageName: series.stageName,
      homeClubId: series.homeClubId,
      awayClubId: series.awayClubId,
    })
    setSeriesStatusUpdate(series.seriesStatus)
    setSeriesWinnerId(series.winnerClubId ?? '')
  }

  const handleSeriesDelete = async (series: MatchSeries) => {
    const seasonId = ensureSeasonSelected()
    if (!seasonId) return
    await runWithMessages(async () => {
      await adminDelete(token, `/api/admin/series/${series.id}`)
      await fetchSeries(seasonId, { force: true })
    }, `Серия «${series.stageName}» удалена`)
  }

  const handleMatchSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const matchDate = matchForm.matchDateTime
    const homeName = matchForm.homeTeamName.trim()
    const awayName = matchForm.awayTeamName.trim()

    if (!matchDate || !homeName || !awayName) {
      handleFeedback('Укажите дату и названия команд', 'error')
      return
    }
    if (homeName.toLowerCase() === awayName.toLowerCase()) {
      handleFeedback('Названия команд должны отличаться', 'error')
      return
    }
    await runWithMessages(async () => {
      await adminPost(token, '/api/admin/friendly-matches', {
        matchDateTime: new Date(matchDate).toISOString(),
        homeTeamName: homeName,
        awayTeamName: awayName,
        stadiumId: matchForm.stadiumId || undefined,
        refereeId: matchForm.refereeId || undefined,
        eventName: matchForm.eventName.trim() || undefined,
      })
      await fetchFriendlyMatches()
    }, 'Товарищеский матч создан')
    setMatchForm(defaultMatchForm)
  }

  const handleFriendlyMatchDelete = async (matchId: string) => {
    await runWithMessages(async () => {
      await adminDelete(token, `/api/admin/friendly-matches/${matchId}`)
      await fetchFriendlyMatches()
    }, 'Товарищеский матч удалён')
  }

  const handleMatchSelect = (match: MatchSummary) => {
    setSelectedMatchId(match.id)
    setMatchModalOpen(true)
    setMatchStats({})
    setMatchStatsVersion(undefined)
    setMatchUpdateForms(forms => ({
      ...forms,
      [match.id]: buildMatchUpdateForm(match),
    }))
    void loadMatchDetails(match.id)
  }

  const closeMatchModal = () => {
    setMatchModalOpen(false)
    setSelectedMatchId(null)
    setMatchLineup([])
    setMatchEvents([])
    setMatchStats({})
    setMatchStatsVersion(undefined)
  }

  const handleMatchUpdate = async (match: MatchSummary, form: MatchUpdateFormState) => {
    const seasonId = ensureSeasonSelected()
    if (!seasonId) return
    const allowScoreUpdate = form.status === 'LIVE' || form.status === 'FINISHED'
    const homeScorePayload =
      allowScoreUpdate && form.homeScore !== '' ? Math.max(0, Number(form.homeScore)) : undefined
    const awayScorePayload =
      allowScoreUpdate && form.awayScore !== '' ? Math.max(0, Number(form.awayScore)) : undefined
    await runWithMessages(async () => {
      await adminPut(token, `/api/admin/matches/${match.id}`, {
        matchDateTime: form.matchDateTime ? new Date(form.matchDateTime).toISOString() : undefined,
        homeScore: homeScorePayload,
        awayScore: awayScorePayload,
        status: form.status,
        stadiumId: form.stadiumId === '' ? undefined : Number(form.stadiumId),
        refereeId: form.refereeId === '' ? undefined : Number(form.refereeId),
        hasPenaltyShootout: form.hasPenaltyShootout,
        penaltyHomeScore: Math.max(0, Math.trunc(form.penaltyHomeScore)),
        penaltyAwayScore: Math.max(0, Math.trunc(form.penaltyAwayScore)),
      })
      await fetchSeries(seasonId, { force: true })
      await fetchMatches(seasonId, { force: true })
      await loadMatchDetails(match.id)
    }, 'Матч обновлён')
  }

  const adjustMatchScore = (match: MatchSummary, key: 'homeScore' | 'awayScore', delta: -1 | 1) => {
    setMatchUpdateForms(forms => {
      const current = forms[match.id] ?? buildMatchUpdateForm(match)
      const fallback = key === 'homeScore' ? match.homeScore : match.awayScore
      const currentValue = typeof current[key] === 'number' ? current[key] : fallback
      const nextValue = Math.max(0, (currentValue ?? 0) + delta)
      const nextForm: MatchUpdateFormState = {
        ...current,
        [key]: nextValue,
      }

      if (nextForm.hasPenaltyShootout) {
        const normalizedHome =
          typeof nextForm.homeScore === 'number' ? nextForm.homeScore : match.homeScore
        const normalizedAway =
          typeof nextForm.awayScore === 'number' ? nextForm.awayScore : match.awayScore
        if (normalizedHome !== normalizedAway) {
          nextForm.hasPenaltyShootout = false
          nextForm.penaltyHomeScore = 0
          nextForm.penaltyAwayScore = 0
          setFeedbackLevel('info')
          setFeedback('Серия пенальти отключена: счёт перестал быть ничейным.')
        }
      }
      return {
        ...forms,
        [match.id]: nextForm,
      }
    })
  }

  const setMatchScore = (
    match: MatchSummary,
    key: 'homeScore' | 'awayScore',
    value: number | ''
  ) => {
    setMatchUpdateForms(forms => {
      const current = forms[match.id] ?? buildMatchUpdateForm(match)
      const nextForm: MatchUpdateFormState = {
        ...current,
        [key]: value === '' ? '' : Math.max(0, value),
      }

      if (nextForm.hasPenaltyShootout) {
        const normalizedHome =
          typeof nextForm.homeScore === 'number' ? nextForm.homeScore : match.homeScore
        const normalizedAway =
          typeof nextForm.awayScore === 'number' ? nextForm.awayScore : match.awayScore
        if (normalizedHome !== normalizedAway) {
          nextForm.hasPenaltyShootout = false
          nextForm.penaltyHomeScore = 0
          nextForm.penaltyAwayScore = 0
          setFeedbackLevel('info')
          setFeedback('Серия пенальти отключена: счёт перестал быть ничейным.')
        }
      }

      return {
        ...forms,
        [match.id]: nextForm,
      }
    })
  }

  const adjustPenaltyScore = (
    match: MatchSummary,
    key: 'penaltyHomeScore' | 'penaltyAwayScore',
    delta: -1 | 1
  ) => {
    setMatchUpdateForms(forms => {
      const current = forms[match.id] ?? buildMatchUpdateForm(match)
      const currentValue = current[key] ?? 0
      const nextValue = Math.max(0, currentValue + delta)
      const nextForm: MatchUpdateFormState = {
        ...current,
        [key]: nextValue,
      }
      return {
        ...forms,
        [match.id]: nextForm,
      }
    })
  }

  const togglePenaltyShootout = (match: MatchSummary, enabled: boolean) => {
    setMatchUpdateForms(forms => {
      const current = forms[match.id] ?? buildMatchUpdateForm(match)
      const normalizedHome =
        typeof current.homeScore === 'number' ? current.homeScore : match.homeScore
      const normalizedAway =
        typeof current.awayScore === 'number' ? current.awayScore : match.awayScore

      if (enabled && normalizedHome !== normalizedAway) {
        setFeedbackLevel('error')
        setFeedback('Серия пенальти доступна только при ничейном счёте.')
        return forms
      }

      const nextForm: MatchUpdateFormState = {
        ...current,
        hasPenaltyShootout: enabled,
        penaltyHomeScore: enabled ? (current.penaltyHomeScore ?? 0) : 0,
        penaltyAwayScore: enabled ? (current.penaltyAwayScore ?? 0) : 0,
      }

      if (!enabled) {
        nextForm.penaltyHomeScore = 0
        nextForm.penaltyAwayScore = 0
      }

      return {
        ...forms,
        [match.id]: nextForm,
      }
    })
  }

  const setMatchStatus = (match: MatchSummary, status: MatchSummary['status']) => {
    setMatchUpdateForms(forms => {
      const current = forms[match.id] ?? buildMatchUpdateForm(match)
      const nextForm: MatchUpdateFormState = { ...current, status }
      if (status === 'LIVE') {
        nextForm.homeScore = typeof nextForm.homeScore === 'number' ? nextForm.homeScore : 0
        nextForm.awayScore = typeof nextForm.awayScore === 'number' ? nextForm.awayScore : 0
      }
      return {
        ...forms,
        [match.id]: nextForm,
      }
    })
  }

  const setMatchDateTime = (match: MatchSummary, value: string) => {
    setMatchUpdateForms(forms => {
      const current = forms[match.id] ?? buildMatchUpdateForm(match)
      return {
        ...forms,
        [match.id]: {
          ...current,
          matchDateTime: value,
        },
      }
    })
  }

  useEffect(() => {
    setEventForm(defaultEventForm)
  }, [selectedMatchId])

  useEffect(() => {
    if (!selectedMatchId) {
      setMatchModalOpen(false)
    }
  }, [selectedMatchId])

  useEffect(() => {
    if (!isMatchModalOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const timer = window.setTimeout(() => {
      matchModalRef.current?.focus()
    }, 0)
    return () => {
      document.body.style.overflow = previousOverflow
      window.clearTimeout(timer)
    }
  }, [isMatchModalOpen])

  const handleMatchDelete = async (match: MatchSummary) => {
    const seasonId = ensureSeasonSelected()
    if (!seasonId) return
    await runWithMessages(async () => {
      await adminDelete(token, `/api/admin/matches/${match.id}`)
      await fetchMatches(seasonId, { force: true })
    }, 'Матч удалён')
    if (selectedMatchId === match.id) {
      setMatchModalOpen(false)
      setSelectedMatchId(null)
      setMatchLineup([])
      setMatchEvents([])
    }
  }

  const handleEventSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedMatchId || !eventForm.teamId || !eventForm.playerId || !eventForm.minute) {
      handleFeedback('Команда, игрок и минута обязательны для события', 'error')
      return
    }
    const playerEntry = matchPlayersById.get(eventForm.playerId)
    if (!playerEntry || playerEntry.clubId !== eventForm.teamId) {
      handleFeedback('Игрок должен быть из выбранной команды', 'error')
      return
    }
    const assistEnabled = eventForm.eventType === 'GOAL'
    if (assistEnabled && eventForm.relatedPlayerId) {
      const relatedEntry = matchPlayersById.get(eventForm.relatedPlayerId)
      if (!relatedEntry || relatedEntry.clubId !== playerEntry.clubId) {
        handleFeedback('Второй игрок должен быть из той же команды, что и автор события', 'error')
        return
      }
    }
    await runWithMessages(async () => {
      await adminPost(token, `/api/admin/matches/${selectedMatchId}/events`, {
        teamId: eventForm.teamId,
        playerId: eventForm.playerId,
        minute: eventForm.minute,
        eventType: eventForm.eventType,
        relatedPlayerId:
          assistEnabled && eventForm.relatedPlayerId ? eventForm.relatedPlayerId : undefined,
      })
      await loadMatchDetails(selectedMatchId)
    }, 'Событие добавлено')
    setEventForm(defaultEventForm)
  }

  const handleEventDelete = async (entry: MatchEventEntry) => {
    if (!selectedMatchId) return
    await runWithMessages(async () => {
      await adminDelete(token, `/api/admin/matches/${selectedMatchId}/events/${entry.id}`)
      await loadMatchDetails(selectedMatchId)
    }, 'Событие удалено')
  }

  const availableClubs = data.clubs
  const seasonSeries = data.series.filter(series => series.seasonId === selectedSeasonId)
  const seasonMatches = data.matches.filter(match => match.seasonId === selectedSeasonId)

  const matchesSorted = useMemo(() => {
    if (!seasonMatches.length) return []
    return [...seasonMatches].sort(
      (a, b) => new Date(a.matchDateTime).getTime() - new Date(b.matchDateTime).getTime()
    )
  }, [seasonMatches])

  const matchesGrouped = useMemo(() => {
    if (!matchesSorted.length) return []
    const map = new Map<string, { label: string; matches: MatchSummary[] }>()
    for (const match of matchesSorted) {
      const roundId = match.round?.id ?? 'no-round'
      const key = typeof roundId === 'number' ? `round-${roundId}` : 'round-none'
      const label = match.round?.label?.trim() || 'Регулярный сезон'
      if (!map.has(key)) {
        map.set(key, { label, matches: [] })
      }
      map.get(key)!.matches.push(match)
    }
    return Array.from(map.entries()).map(([key, value]) => ({ key, ...value }))
  }, [matchesSorted])
  const selectedMatch = useMemo(() => {
    if (!selectedMatchId) return null
    return seasonMatches.find(match => match.id === selectedMatchId) ?? null
  }, [selectedMatchId, seasonMatches])

  const selectedMatchTeams = useMemo(() => {
    if (!selectedMatch) return []
    const home = availableClubs.find(club => club.id === selectedMatch.homeTeamId)
    const away = availableClubs.find(club => club.id === selectedMatch.awayTeamId)
    return [home, away].filter(Boolean) as Club[]
  }, [availableClubs, selectedMatch])

  const homeClub = selectedMatch
    ? availableClubs.find(club => club.id === selectedMatch.homeTeamId)
    : undefined
  const awayClub = selectedMatch
    ? availableClubs.find(club => club.id === selectedMatch.awayTeamId)
    : undefined

  const getStatisticValue = (clubId: number | undefined, metric: MatchStatisticMetric) => {
    if (!clubId) return 0
    const entry = matchStats[clubId]
    return entry ? entry[metric] : 0
  }

  const getClubDisplayName = (club: Club | undefined, fallback: string) => {
    if (!club) return fallback
    const label = club.name?.trim()
    return label && label.length > 0 ? label : fallback
  }

  const canDecreaseStatistic = (clubId: number | undefined, metric: MatchStatisticMetric) => {
    if (!clubId) return false
    const currentValue = getStatisticValue(clubId, metric)
    if (metric === 'totalShots') {
      const shotsOnTarget = getStatisticValue(clubId, 'shotsOnTarget')
      return currentValue > shotsOnTarget
    }
    return currentValue > 0
  }

  const homeDisplayName = selectedMatch ? getClubDisplayName(homeClub, 'Хозяева') : '—'
  const awayDisplayName = selectedMatch ? getClubDisplayName(awayClub, 'Гости') : '—'

  const matchLineupByClub = useMemo(() => {
    const map = new Map<number, MatchLineupEntry[]>()
    for (const entry of matchLineup) {
      if (!map.has(entry.clubId)) {
        map.set(entry.clubId, [])
      }
      map.get(entry.clubId)!.push(entry)
    }
    map.forEach(list => {
      list.sort((a, b) => {
        if (a.role !== b.role) {
          return a.role === 'STARTER' ? -1 : 1
        }
        const last = a.person.lastName.localeCompare(b.person.lastName, 'ru')
        if (last !== 0) return last
        return a.person.firstName.localeCompare(b.person.firstName, 'ru')
      })
    })
    return map
  }, [matchLineup])

  const matchPlayersPool = useMemo<EventPlayerOption[]>(() => {
    const options: EventPlayerOption[] = []
    matchLineupByClub.forEach(entries => {
      entries.forEach(entry => {
        options.push({
          personId: entry.personId,
          clubId: entry.clubId,
          person: entry.person,
          club: entry.club,
          source: 'lineup',
          shirtNumber: entry.shirtNumber,
        })
      })
    })
    return options.sort((a, b) => {
      const last = a.person.lastName.localeCompare(b.person.lastName, 'ru')
      if (last !== 0) return last
      return a.person.firstName.localeCompare(b.person.firstName, 'ru')
    })
  }, [matchLineupByClub])

  const matchPlayersById = useMemo(() => {
    const map = new Map<number, EventPlayerOption>()
    for (const option of matchPlayersPool) {
      map.set(option.personId, option)
    }
    return map
  }, [matchPlayersPool])

  const eventPlayerOptions = useMemo(() => {
    if (!eventForm.teamId) return []
    return matchPlayersPool.filter(entry => entry.clubId === eventForm.teamId)
  }, [eventForm.teamId, matchPlayersPool])

  const eventAllowsAssist = eventForm.eventType === 'GOAL'

  const relatedEventPlayerOptions = useMemo(() => {
    if (!eventAllowsAssist || !eventForm.playerId) return []
    const primary = matchPlayersById.get(eventForm.playerId)
    if (!primary) return []
    return matchPlayersPool.filter(
      entry => entry.clubId === primary.clubId && entry.personId !== primary.personId
    )
  }, [eventAllowsAssist, eventForm.playerId, matchPlayersById, matchPlayersPool])

  useEffect(() => {
    setMatchUpdateForms(forms => {
      let changed = false
      const next = { ...forms }
      for (const match of seasonMatches) {
        if (!next[match.id]) {
          next[match.id] = buildMatchUpdateForm(match)
          changed = true
        }
      }
      return changed ? next : forms
    })
  }, [seasonMatches])
  useEffect(() => {
    setEventForm(form => {
      const available = new Set(matchPlayersPool.map(entry => entry.personId))
      const updates: Partial<EventFormState> = {}
      if (form.playerId && !available.has(form.playerId)) {
        updates.playerId = ''
      }
      if (form.relatedPlayerId && !available.has(form.relatedPlayerId)) {
        updates.relatedPlayerId = ''
      }
      if (!Object.keys(updates).length) return form
      return { ...form, ...updates }
    })
  }, [matchPlayersPool])

  const hasUnfinishedMatches = seasonMatches.some(match => match.status !== 'FINISHED')
  const playoffsDisabledReason = useMemo(() => {
    if (!isBestOfFormat && !isGroupPlayoffFormat) return null
    if (!selectedSeasonId) return 'Выберите сезон, чтобы запускать плей-офф'
    if (!selectedSeason) return 'Сезон не найден'
    if (seasonSeries.length > 0) return 'Серии уже созданы для этого сезона'
    if (seasonParticipants.length < 2) return 'Недостаточно участников для плей-офф'
    if (seasonMatches.length === 0) return 'Нет матчей для расчёта посева'
    if (hasUnfinishedMatches) return 'Сначала завершите все матчи регулярного этапа'

    if (isGroupPlayoffFormat) {
      const groups = selectedSeason.groups ?? []
      if (!groups.length) {
        return 'Сезон не содержит настроенных группового этапа'
      }

      for (const group of groups) {
        if (group.qualifyCount <= 0) {
          return `Укажите количество команд, проходящих из группы «${group.label}»`
        }
        const filledSlots = group.slots.filter(
          slot => typeof slot.clubId === 'number' && slot.clubId
        ).length
        if (filledSlots < group.qualifyCount) {
          return `Заполните участников в группе «${group.label}»`
        }
      }
    }

    return null
  }, [
    hasUnfinishedMatches,
    isBestOfFormat,
    isGroupPlayoffFormat,
    seasonMatches.length,
    seasonParticipants.length,
    seasonSeries.length,
    selectedSeason,
    selectedSeasonId,
  ])

  const formattedMatchDate = selectedMatch
    ? new Date(selectedMatch.matchDateTime).toLocaleString('ru-RU', {
        day: '2-digit',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      })
    : ''
  const matchTeamsLabel = selectedMatchTeams.length
    ? selectedMatchTeams.map(team => team.name).join(' vs ')
    : ''
  const selectedMatchForm = selectedMatch
    ? (matchUpdateForms[selectedMatch.id] ?? buildMatchUpdateForm(selectedMatch))
    : null
  const selectedMatchStatus: MatchSummary['status'] =
    selectedMatchForm?.status ?? selectedMatch?.status ?? 'SCHEDULED'
  const isSelectedMatchLive = selectedMatchStatus === 'LIVE'
  const homeScoreForControls =
    typeof selectedMatchForm?.homeScore === 'number'
      ? selectedMatchForm.homeScore
      : typeof selectedMatch?.homeScore === 'number'
        ? selectedMatch.homeScore
        : 0
  const awayScoreForControls =
    typeof selectedMatchForm?.awayScore === 'number'
      ? selectedMatchForm.awayScore
      : typeof selectedMatch?.awayScore === 'number'
        ? selectedMatch.awayScore
        : 0
  const homeScoreInputValue: number | '' = selectedMatchForm
    ? selectedMatchForm.homeScore === ''
      ? ''
      : selectedMatchForm.homeScore
    : typeof selectedMatch?.homeScore === 'number'
      ? selectedMatch.homeScore
      : ''
  const awayScoreInputValue: number | '' = selectedMatchForm
    ? selectedMatchForm.awayScore === ''
      ? ''
      : selectedMatchForm.awayScore
    : typeof selectedMatch?.awayScore === 'number'
      ? selectedMatch.awayScore
      : ''
  const scoreInputsDisabled = !isSelectedMatchLive
  const penaltyEnabled =
    selectedMatchForm?.hasPenaltyShootout ?? selectedMatch?.hasPenaltyShootout ?? false
  const penaltyHomeScore =
    selectedMatchForm?.penaltyHomeScore ?? selectedMatch?.penaltyHomeScore ?? 0
  const penaltyAwayScore =
    selectedMatchForm?.penaltyAwayScore ?? selectedMatch?.penaltyAwayScore ?? 0
  const competitionType = selectedSeason?.competition?.type
  const competitionSeriesFormat = selectedSeason?.competition?.seriesFormat
  const isPenaltyEligible =
    Boolean(selectedMatch?.seriesId) &&
    competitionType === 'LEAGUE' &&
    (competitionSeriesFormat === 'BEST_OF_N' || competitionSeriesFormat === 'DOUBLE_ROUND_PLAYOFF')
  const isRegulationDraw = homeScoreForControls === awayScoreForControls

  return (
    <>
      <div className="tab-sections">
        <header className="tab-header">
          <div>
            <h3>Сезоны и расписание</h3>
            <p>Формируйте календарь, управляйте участниками и контролируйте ход матчей.</p>
          </div>
          <button
            className="button-ghost"
            type="button"
            onClick={() => fetchSeasons()}
            disabled={isLoading}
          >
            {isLoading ? 'Обновляем…' : 'Обновить сезоны'}
          </button>
        </header>
        {feedback ? <div className={`inline-feedback ${feedbackLevel}`}>{feedback}</div> : null}
        {error ? <div className="inline-feedback error">{error}</div> : null}

        <section className="card-grid">
          <article className="card automation-card">
            <header>
              <h4>Автоматизация сезона</h4>
              <p>
                Подготовьте сезон одним действием: выберите команды, дату старта и день недели —
                расписание и заявки сформируются автоматически.
              </p>
            </header>
            <form className="stacked" onSubmit={handleAutomationSubmit}>
              <label>
                Соревнование
                <select
                  value={automationForm.competitionId || ''}
                  onChange={event => {
                    const nextId = event.target.value ? Number(event.target.value) : ''
                    const nextFormat = nextId
                      ? (data.competitions.find(competition => competition.id === Number(nextId))
                          ?.seriesFormat ?? 'SINGLE_MATCH')
                      : 'SINGLE_MATCH'
                    setAutomationForm(form => ({
                      ...form,
                      competitionId: nextId,
                      seriesFormat: nextFormat,
                    }))
                  }}
                  required
                >
                  <option value="">—</option>
                  {data.competitions.map(competition => (
                    <option key={competition.id} value={competition.id}>
                      {competition.name} ({seriesFormatNames[competition.seriesFormat]})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Название сезона
                <input
                  value={automationForm.seasonName}
                  onChange={event =>
                    setAutomationForm(form => ({ ...form, seasonName: event.target.value }))
                  }
                  placeholder="Например: Осень 2025"
                  required
                />
              </label>
              <div className="automation-grid">
                <label>
                  Дата старта
                  <input
                    type="date"
                    value={automationForm.startDate}
                    onChange={event =>
                      setAutomationForm(form => ({ ...form, startDate: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  День недели
                  <select
                    value={automationForm.matchDayOfWeek}
                    onChange={event =>
                      setAutomationForm(form => ({ ...form, matchDayOfWeek: event.target.value }))
                    }
                    required
                  >
                    {weekdayOptions.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Время начала
                  <input
                    type="time"
                    value={automationForm.matchTime}
                    onChange={event =>
                      setAutomationForm(form => ({ ...form, matchTime: event.target.value }))
                    }
                  />
                </label>
              </div>
              <div className="automation-format">
                <span className="automation-format-label">Формат серий</span>
                <span className="automation-format-value">
                  {automationForm.competitionId
                    ? automationSeriesLabels[automationForm.seriesFormat]
                    : 'Выберите соревнование'}
                </span>
              </div>
              {automationGroupStage ? (
                <p className="muted">
                  Распределите клубы по группам и задайте параметры этапа. Все ячейки должны быть
                  заполнены, а клуб может участвовать только в одной группе.
                </p>
              ) : automationSeedingEnabled ? (
                <p className="muted">
                  Групповой этап проходит в один круг. Порядок списка справа задаёт посев плей-офф:
                  первая команда играет с последней, вторая — с предпоследней и т.д. Если участников
                  нечётное число, верхняя по посеву команда автоматически проходит в следующий
                  раунд.
                </p>
              ) : automationRandomBracket ? (
                <p className="muted">
                  Регулярный этап пропускается. Сезон стартует сразу с плей-офф, а пары формируются
                  случайным образом при запуске автоматизации. Если участников нечётное число, одна
                  команда получает автоматический проход далее.
                </p>
              ) : null}
              <p className="muted">
                Шаблонные составы клубов автоматически переносятся в сезон и синхронизируются при
                изменениях состава клуба.
              </p>
              {automationGroupStage ? (
                <div className="group-stage-editor">
                  <div className="group-stage-controls">
                    <label>
                      Количество групп
                      <input
                        type="number"
                        min={1}
                        max={12}
                        value={groupStageState.groupCount}
                        onChange={event => updateGroupCount(Number(event.target.value) || 1)}
                      />
                    </label>
                    <label>
                      Команд в группе
                      <input
                        type="number"
                        min={2}
                        max={8}
                        value={groupStageState.groupSize}
                        onChange={event => updateGroupSize(Number(event.target.value) || 2)}
                      />
                    </label>
                    <label>
                      Проходят дальше
                      <input
                        type="number"
                        min={1}
                        max={groupStageState.groupSize}
                        value={groupStageState.qualifyCount}
                        onChange={event => updateQualifyCount(Number(event.target.value) || 1)}
                      />
                    </label>
                    <div className="group-stage-summary">
                      Слотов заполнено{' '}
                      {groupStageState.groups
                        .slice(0, groupStageState.groupCount)
                        .reduce((acc, group) => {
                          const filled = resizeGroupSlots(
                            group.slots,
                            groupStageState.groupSize
                          ).filter(slot => typeof slot.clubId === 'number').length
                          return acc + filled
                        }, 0)}{' '}
                      из {groupStageState.groupCount * groupStageState.groupSize}
                    </div>
                  </div>
                  <div className="group-stage-grid">
                    {groupStageState.groups
                      .slice(0, groupStageState.groupCount)
                      .map((group, groupIndex) => (
                        <div key={group.groupIndex} className="group-card">
                          <div className="group-card-header">
                            <span className="group-card-index">Группа {groupIndex + 1}</span>
                            <input
                              value={group.label}
                              onChange={event =>
                                updateGroupLabel(group.groupIndex, event.target.value)
                              }
                              placeholder={groupLabelForIndex(groupIndex)}
                            />
                          </div>
                          <ol>
                            {resizeGroupSlots(group.slots, groupStageState.groupSize).map(slot => {
                              const currentValue =
                                typeof slot.clubId === 'number' ? slot.clubId : ''
                              const usedInOtherSlots = new Set<number>()
                              groupStageState.groups
                                .slice(0, groupStageState.groupCount)
                                .forEach(otherGroup => {
                                  resizeGroupSlots(
                                    otherGroup.slots,
                                    groupStageState.groupSize
                                  ).forEach(otherSlot => {
                                    const raw =
                                      typeof otherSlot.clubId === 'number' ? otherSlot.clubId : NaN
                                    if (!Number.isFinite(raw)) return
                                    if (
                                      otherGroup.groupIndex === group.groupIndex &&
                                      otherSlot.position === slot.position
                                    ) {
                                      return
                                    }
                                    usedInOtherSlots.add(Number(raw))
                                  })
                                })
                              const availableClubs = data.clubs.filter(club => {
                                if (currentValue !== '' && club.id === currentValue) return true
                                return !usedInOtherSlots.has(club.id)
                              })
                              return (
                                <li key={`${group.groupIndex}-${slot.position}`}>
                                  <span className="slot-index">№{slot.position}</span>
                                  <select
                                    value={currentValue === '' ? '' : String(currentValue)}
                                    onChange={event => {
                                      const value = event.target.value
                                      updateGroupSlotClub(
                                        group.groupIndex,
                                        slot.position,
                                        value === '' ? '' : Number(value)
                                      )
                                    }}
                                  >
                                    <option value="">—</option>
                                    {availableClubs.map(club => (
                                      <option key={club.id} value={club.id}>
                                        {club.name}
                                      </option>
                                    ))}
                                  </select>
                                </li>
                              )
                            })}
                          </ol>
                        </div>
                      ))}
                  </div>
                </div>
              ) : (
                <div className="club-selection">
                  <div>
                    <h5>Команды</h5>
                    <p className="muted">Выберите участников (минимум 2).</p>
                    <div className="club-selection-list">
                      {data.clubs.map(club => (
                        <label key={club.id} className="checkbox club-checkbox">
                          <span>{club.name}</span>
                          <input
                            type="checkbox"
                            checked={automationForm.clubIds.includes(club.id)}
                            onChange={() => toggleAutomationClub(club.id)}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="selected-clubs">
                    <h5>
                      {automationSeedingEnabled ? 'Посев и порядок матчей' : 'Список участников'}
                    </h5>
                    {automationForm.clubIds.length === 0 ? (
                      <p className="muted">Список пуст — отметьте команды слева.</p>
                    ) : (
                      <ol>
                        {automationForm.clubIds.map((clubId, index) => {
                          const club = data.clubs.find(item => item.id === clubId)
                          if (!club) return null
                          return (
                            <li key={clubId}>
                              <span>
                                №{index + 1}. {club.name}
                              </span>
                              <span className="reorder-buttons">
                                <button
                                  type="button"
                                  onClick={() => moveAutomationClub(clubId, -1)}
                                  disabled={!automationSeedingEnabled || index === 0}
                                >
                                  ▲
                                </button>
                                <button
                                  type="button"
                                  onClick={() => moveAutomationClub(clubId, 1)}
                                  disabled={
                                    !automationSeedingEnabled ||
                                    index === automationForm.clubIds.length - 1
                                  }
                                >
                                  ▼
                                </button>
                              </span>
                            </li>
                          )
                        })}
                      </ol>
                    )}
                    {automationRandomBracket ? (
                      <p className="muted" style={{ marginTop: '8px' }}>
                        Очерёдность в списке не влияет на сетку — она будет перемешана
                        автоматически.
                      </p>
                    ) : null}
                  </div>
                </div>
              )}
              <div className="form-actions">
                <button className="button-primary" type="submit" disabled={automationLoading}>
                  {automationLoading ? 'Формируем…' : 'Создать сезон автоматически'}
                </button>
                <button
                  className="button-secondary"
                  type="button"
                  onClick={() => {
                    setAutomationForm({
                      ...defaultAutomationForm,
                      startDate: new Date().toISOString().slice(0, 10),
                    })
                    setGroupStageState(buildDefaultGroupStage())
                  }}
                  disabled={automationLoading}
                >
                  Очистить форму
                </button>
              </div>
            </form>
            {automationResult ? (
              <div className="automation-summary">
                <p>
                  Сезон #{automationResult.seasonId}: команд —{' '}
                  {automationResult.participantsCreated}, матчей — {automationResult.matchesCreated}
                  , заявок — {automationResult.rosterEntriesCreated}, серий —{' '}
                  {automationResult.seriesCreated}, групп — {automationResult.groupsCreated}, слотов
                  групп — {automationResult.groupSlotsCreated}.
                </p>
                {lastGroupStagePreview ? (
                  <div className="group-preview">
                    {lastGroupStagePreview.groups.map((group, index) => {
                      const label =
                        group.label.trim() || groupLabelForIndex(group.groupIndex - 1 || index)
                      return (
                        <div
                          className="group-preview-card"
                          key={`group-preview-${group.groupIndex}`}
                        >
                          <h5>{label}</h5>
                          <ol>
                            {group.slots.map(slot => {
                              const club = slot.clubId ? clubsById.get(slot.clubId) : undefined
                              return (
                                <li key={`${group.groupIndex}-${slot.position}`}>
                                  {slot.position}. {club ? club.name : '—'}
                                </li>
                              )
                            })}
                          </ol>
                        </div>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
          </article>

          <article className="card">
            <header>
              <h4>Выбор сезона</h4>
              <p>Используйте селектор, чтобы работать с конкретным сезоном.</p>
            </header>
            <label className="stacked">
              Активный сезон
              <select
                value={selectedSeasonId ?? ''}
                onChange={event =>
                  setSelectedSeason(event.target.value ? Number(event.target.value) : undefined)
                }
              >
                <option value="">—</option>
                {data.seasons.map(season => (
                  <option key={season.id} value={season.id}>
                    {season.name} — {season.competition.name} (
                    {competitionTypeLabels[season.competition.type]})
                  </option>
                ))}
              </select>
            </label>
            <div className="season-active-row" role="status" aria-live="polite">
              <span className="muted">
                Текущий активный сезон:{' '}
                <strong>
                  {activeSeason
                    ? `${activeSeason.name} — ${activeSeason.competition.name}`
                    : 'не выбран'}
                </strong>
              </span>
              <button
                className="button-primary"
                type="button"
                onClick={() => selectedSeason && activateSeason(selectedSeason.id)}
                disabled={
                  !selectedSeason || activatingSeason || selectedSeason.isActive || !token
                }
              >
                {activatingSeason ? 'Сохраняем…' : 'Сделать активным'}
              </button>
            </div>
            {selectedSeason ? (
              <div className="season-details">
                <p>
                  Соревнование: <strong>{selectedSeason.competition.name}</strong>
                </p>
                <p>
                  Период: {selectedSeason.startDate.slice(0, 10)} —{' '}
                  {selectedSeason.endDate.slice(0, 10)}
                </p>
              </div>
            ) : null}
          </article>
        </section>

        <section className="card-grid">
          <article className="card playoff-card">
            <header>
              <h4>Плей-офф после регулярки</h4>
              <p>
                Когда все матчи сыграны, управляйте сеткой плей-офф и следите за прогрессом стадий.
              </p>
            </header>
            {!selectedSeason ? (
              <p className="muted">Выберите сезон, чтобы управлять плей-офф.</p>
            ) : !supportsPlayoffSeries ? (
              <p className="muted">
                Соревнование «{selectedSeason.competition.name}» не предполагает серию до побед.
              </p>
            ) : isBestOfFormat ? (
              <div className="stacked">
                <label>
                  Формат серий
                  <select
                    value={playoffBestOf}
                    onChange={event => setPlayoffBestOf(Number(event.target.value))}
                    disabled={playoffLoading}
                  >
                    {playoffBestOfOptions.map(option => (
                      <option key={option} value={option}>
                        До {option === 3 ? 'двух' : option === 5 ? 'трёх' : 'четырёх'} побед
                        (best-of-{option})
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button-primary"
                  type="button"
                  onClick={handleCreatePlayoffs}
                  disabled={playoffLoading || Boolean(playoffsDisabledReason)}
                  title={playoffsDisabledReason ?? undefined}
                >
                  {playoffLoading ? 'Создаём…' : 'Сгенерировать плей-офф'}
                </button>
                {playoffsDisabledReason ? (
                  <p className="muted">{playoffsDisabledReason}</p>
                ) : (
                  <p className="muted">
                    Серии создаются по посеву из списка участников сезонов. Каждая вторая игра
                    проводится на площадке соперника.
                  </p>
                )}
                {playoffSuccessBanner}
              </div>
            ) : isGroupPlayoffFormat ? (
              <div className="stacked">
                <button
                  className="button-primary"
                  type="button"
                  onClick={handleCreatePlayoffs}
                  disabled={playoffLoading || Boolean(playoffsDisabledReason)}
                  title={playoffsDisabledReason ?? undefined}
                >
                  {playoffLoading ? 'Создаём…' : 'Сформировать плей-офф'}
                </button>
                {playoffsDisabledReason ? (
                  <p className="muted">{playoffsDisabledReason}</p>
                ) : (
                  <p className="muted">
                    После завершения матчей группового этапа нажмите кнопку, чтобы квалифицированные
                    клубы автоматически попали в сетку.
                  </p>
                )}
                <button
                  className="button-ghost"
                  type="button"
                  onClick={handleRefreshPlayoffData}
                  disabled={Boolean(loading.series) || Boolean(loading.matches)}
                >
                  {loading.series || loading.matches ? 'Обновляем…' : 'Обновить сетку'}
                </button>
                <p className="muted">Обновление подтянет актуальные стадии и расписание матчей.</p>
                {playoffSuccessBanner}
              </div>
            ) : (
              <div className="stacked">
                <p className="muted">
                  Сетка плей-офф создаётся автоматически при запуске сезона. После завершения серий
                  следующие стадии формируются без ручного вмешательства.
                </p>
                <button
                  className="button-ghost"
                  type="button"
                  onClick={handleRefreshPlayoffData}
                  disabled={Boolean(loading.series) || Boolean(loading.matches)}
                >
                  {loading.series || loading.matches ? 'Обновляем…' : 'Обновить сетку'}
                </button>
                <p className="muted">Обновление подтянет актуальные стадии и расписание матчей.</p>
              </div>
            )}
          </article>
          {supportsPlayoffSeries ? (
            <article className="card">
              <header>
                <h4>{editingSeriesId ? 'Редактирование серии' : 'Управление сериями'}</h4>
                <p>
                  {isPlayoffBracketFormat
                    ? 'Следите за автоматическими сериями и при необходимости корректируйте вручную.'
                    : 'Контролируйте стадии плей-офф и финальные серии.'}
                </p>
              </header>
              <form className="stacked" onSubmit={handleSeriesSubmit}>
                <label>
                  Стадия
                  <input
                    value={seriesForm.stageName}
                    onChange={event =>
                      setSeriesForm(form => ({ ...form, stageName: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  Хозяева серии
                  <select
                    value={seriesForm.homeClubId}
                    onChange={event =>
                      setSeriesForm(form => ({
                        ...form,
                        homeClubId: event.target.value ? Number(event.target.value) : '',
                      }))
                    }
                    required
                  >
                    <option value="">—</option>
                    {seasonParticipants.map(participant => (
                      <option key={participant.clubId} value={participant.clubId}>
                        {participant.club.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Гости серии
                  <select
                    value={seriesForm.awayClubId}
                    onChange={event =>
                      setSeriesForm(form => ({
                        ...form,
                        awayClubId: event.target.value ? Number(event.target.value) : '',
                      }))
                    }
                    required
                  >
                    <option value="">—</option>
                    {seasonParticipants.map(participant => (
                      <option key={participant.clubId} value={participant.clubId}>
                        {participant.club.name}
                      </option>
                    ))}
                  </select>
                </label>
                {editingSeriesId ? (
                  <>
                    <label>
                      Статус
                      <select
                        value={seriesStatusUpdate}
                        onChange={event =>
                          setSeriesStatusUpdate(event.target.value as MatchSeries['seriesStatus'])
                        }
                      >
                        {seriesStatuses.map(status => (
                          <option key={status} value={status}>
                            {seriesStatusLabels[status]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Победитель
                      <select
                        value={seriesWinnerId}
                        onChange={event =>
                          setSeriesWinnerId(event.target.value ? Number(event.target.value) : '')
                        }
                      >
                        <option value="">—</option>
                        {seasonParticipants.map(participant => (
                          <option key={participant.clubId} value={participant.clubId}>
                            {participant.club.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : null}
                <div className="form-actions">
                  <button className="button-primary" type="submit" disabled={!selectedSeasonId}>
                    {editingSeriesId ? 'Сохранить серию' : 'Создать серию'}
                  </button>
                  {editingSeriesId ? (
                    <button
                      className="button-secondary"
                      type="button"
                      onClick={() => {
                        setEditingSeriesId(null)
                        setSeriesForm(defaultSeriesForm)
                        setSeriesWinnerId('')
                        setSeriesStatusUpdate('IN_PROGRESS')
                      }}
                    >
                      Отмена
                    </button>
                  ) : null}
                </div>
              </form>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Стадия</th>
                      <th>Хозяева</th>
                      <th>Гости</th>
                      <th>Статус</th>
                      <th aria-label="Действия" />
                    </tr>
                  </thead>
                  <tbody>
                    {seasonSeries.map(series => (
                      <tr key={series.id}>
                        <td>{series.stageName}</td>
                        <td>
                          {availableClubs.find(club => club.id === series.homeClubId)?.name ??
                            series.homeClubId}
                        </td>
                        <td>
                          {availableClubs.find(club => club.id === series.awayClubId)?.name ??
                            series.awayClubId}
                        </td>
                        <td>
                          {seriesStatusLabels[series.seriesStatus]}
                          {series.winnerClubId
                            ? ` → ${availableClubs.find(club => club.id === series.winnerClubId)?.name}`
                            : ''}
                        </td>
                        <td className="table-actions">
                          <button type="button" onClick={() => handleSeriesEdit(series)}>
                            Изм.
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => handleSeriesDelete(series)}
                          >
                            Удал.
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          ) : null}
          {supportsPlayoffSeries ? (
            <article className="card bracket-card">
              <header>
                <h4>Сетка плей-офф</h4>
                <p>
                  Визуализация серий и матчей. Победители подсвечиваются автоматически, статусы
                  обновляются по мере завершения игр.
                </p>
              </header>
              {selectedSeason ? (
                <PlayoffBracket
                  series={seasonSeries}
                  matches={seasonMatches}
                  clubs={availableClubs}
                />
              ) : (
                <p className="muted">Выберите сезон, чтобы отобразить сетку.</p>
              )}
            </article>
          ) : null}

          <article className="card">
            <header>
              <h4>Создать матч</h4>
              <p>Добавьте товарищескую игру — она не попадёт в статистику сезона и карьеры.</p>
            </header>
            <form className="stacked" onSubmit={handleMatchSubmit}>
              <label>
                Дата и время
                <input
                  type="datetime-local"
                  value={matchForm.matchDateTime}
                  onChange={event =>
                    setMatchForm(form => ({ ...form, matchDateTime: event.target.value }))
                  }
                  required
                />
              </label>
              <label>
                Хозяева
                <input
                  type="text"
                  value={matchForm.homeTeamName}
                  onChange={event =>
                    setMatchForm(form => ({ ...form, homeTeamName: event.target.value }))
                  }
                  placeholder="Например: ФК Обнинск"
                  required
                />
              </label>
              <label>
                Гости
                <input
                  type="text"
                  value={matchForm.awayTeamName}
                  onChange={event =>
                    setMatchForm(form => ({ ...form, awayTeamName: event.target.value }))
                  }
                  placeholder="Например: ФК Звезда"
                  required
                />
              </label>
              <label>
                Стадион
                <select
                  value={matchForm.stadiumId}
                  onChange={event =>
                    setMatchForm(form => ({
                      ...form,
                      stadiumId: event.target.value ? Number(event.target.value) : '',
                    }))
                  }
                >
                  <option value="">—</option>
                  {data.stadiums.map(stadium => (
                    <option key={stadium.id} value={stadium.id}>
                      {stadium.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Судья
                <select
                  value={matchForm.refereeId}
                  onChange={event =>
                    setMatchForm(form => ({
                      ...form,
                      refereeId: event.target.value ? Number(event.target.value) : '',
                    }))
                  }
                >
                  <option value="">—</option>
                  {data.persons
                    .filter(person => !person.isPlayer)
                    .map(person => (
                      <option key={person.id} value={person.id}>
                        {person.lastName} {person.firstName}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Наименование события
                <input
                  type="text"
                  value={matchForm.eventName}
                  onChange={event =>
                    setMatchForm(form => ({ ...form, eventName: event.target.value }))
                  }
                  placeholder="Например: Кубок открытия сезона"
                />
              </label>
              <button className="button-primary" type="submit">
                Создать матч
              </button>
            </form>
          </article>

          <article className="card" style={{ gridColumn: '1 / -1' }}>
            <header>
              <h4>Матчи сезона</h4>
              <p>Выберите матч для редактирования счёта, статуса и составов.</p>
            </header>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Матч</th>
                    <th>Счёт</th>
                    <th aria-label="Действия" />
                  </tr>
                </thead>
                <tbody>
                  {matchesGrouped.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="empty-row">
                        Матчи не найдены. Создайте игру или обновите фильтр сезона.
                      </td>
                    </tr>
                  ) : (
                    matchesGrouped.map(group => (
                      <React.Fragment key={group.key}>
                        <tr className="round-row">
                          <td colSpan={4}>{group.label}</td>
                        </tr>
                        {group.matches.map(match => {
                          const home = availableClubs.find(club => club.id === match.homeTeamId)
                          const away = availableClubs.find(club => club.id === match.awayTeamId)
                          const form = matchUpdateForms[match.id] ?? buildMatchUpdateForm(match)
                          const resolvedHomeScore =
                            form.homeScore === '' || typeof form.homeScore !== 'number'
                              ? match.homeScore
                              : form.homeScore
                          const resolvedAwayScore =
                            form.awayScore === '' || typeof form.awayScore !== 'number'
                              ? match.awayScore
                              : form.awayScore
                          const homeScoreDisplay =
                            typeof resolvedHomeScore === 'number' ? resolvedHomeScore : '—'
                          const awayScoreDisplay =
                            typeof resolvedAwayScore === 'number' ? resolvedAwayScore : '—'
                          return (
                            <tr
                              key={match.id}
                              className={selectedMatchId === match.id ? 'active-row' : undefined}
                            >
                              <td>{new Date(match.matchDateTime).toLocaleString('ru-RU')}</td>
                              <td>
                                <div className="match-cell">
                                  <span>
                                    {home?.name ?? match.homeTeamId} vs{' '}
                                    {away?.name ?? match.awayTeamId}
                                  </span>
                                  <span
                                    className={`status-badge status-${form.status.toLowerCase()}`}
                                  >
                                    {matchStatusLabels[form.status]}
                                  </span>
                                </div>
                              </td>
                              <td>
                                <div className="score-display">
                                  <span>{homeScoreDisplay}</span>
                                  <span className="score-separator">:</span>
                                  <span>{awayScoreDisplay}</span>
                                </div>
                              </td>
                              <td className="table-actions">
                                <button type="button" onClick={() => handleMatchSelect(match)}>
                                  Детали
                                </button>
                                <button
                                  type="button"
                                  className="danger"
                                  onClick={() => handleMatchDelete(match)}
                                >
                                  Удал.
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </React.Fragment>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </article>
          <article className="card" style={{ gridColumn: '1 / -1' }}>
            <header
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '16px',
                flexWrap: 'wrap',
              }}
            >
              <div>
                <h4>Товарищеские матчи</h4>
                <p>Игры вне сезона для гибких экспериментов и подготовки.</p>
              </div>
              <button
                type="button"
                className="button-ghost"
                onClick={() => void fetchFriendlyMatches()}
                disabled={Boolean(loading.friendlyMatches)}
              >
                {loading.friendlyMatches ? 'Обновляем…' : 'Обновить'}
              </button>
            </header>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Матч</th>
                    <th>Детали</th>
                    <th aria-label="Действия" />
                  </tr>
                </thead>
                <tbody>
                  {friendlyMatchesSorted.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="empty-row">
                        Пока нет товарищеских встреч. Создайте первую игру выше.
                      </td>
                    </tr>
                  ) : (
                    friendlyMatchesSorted.map(match => {
                      const matchDate = new Date(match.matchDateTime).toLocaleString('ru-RU', {
                        day: '2-digit',
                        month: 'long',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                      const stadiumName =
                        match.stadium?.name ??
                        (match.stadiumId
                          ? data.stadiums.find(stadium => stadium.id === match.stadiumId)?.name
                          : undefined)
                      const refereePerson =
                        match.referee ??
                        (match.refereeId
                          ? data.persons.find(person => person.id === match.refereeId)
                          : undefined)
                      const refereeName = refereePerson
                        ? `${refereePerson.lastName} ${refereePerson.firstName}`.trim()
                        : undefined
                      return (
                        <tr key={match.id}>
                          <td>{matchDate}</td>
                          <td>
                            <div className="match-cell">
                              <span>
                                {match.homeTeamName} vs {match.awayTeamName}
                              </span>
                              {match.eventName ? (
                                <span className="muted">{match.eventName}</span>
                              ) : null}
                            </div>
                          </td>
                          <td>
                            {stadiumName || refereeName ? (
                              <div className="muted">
                                {stadiumName ? <div>Стадион: {stadiumName}</div> : null}
                                {refereeName ? <div>Судья: {refereeName}</div> : null}
                              </div>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td className="table-actions">
                            <button
                              type="button"
                              className="danger"
                              onClick={() => handleFriendlyMatchDelete(match.id)}
                            >
                              Удал.
                            </button>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      </div>
      {isMatchModalOpen && selectedMatchId && selectedMatch ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div
            className="modal-card match-modal"
            tabIndex={-1}
            ref={matchModalRef}
            aria-label={`Подтверждение состава: ${matchTeamsLabel}`}
          >
            <header className="modal-header">
              <div>
                <h5>Детали матча</h5>
                <p>
                  {formattedMatchDate}
                  {matchTeamsLabel ? ` · ${matchTeamsLabel}` : ''}
                </p>
              </div>
              <button type="button" className="button-ghost" onClick={closeMatchModal}>
                Закрыть
              </button>
            </header>
            <div className="modal-body">
              <form
                className="stacked"
                onSubmit={event => {
                  event.preventDefault()
                  if (selectedMatch && selectedMatchForm) {
                    void handleMatchUpdate(selectedMatch, selectedMatchForm)
                  }
                }}
              >
                <h6>Параметры матча</h6>
                <label>
                  Статус
                  <select
                    value={selectedMatchStatus}
                    onChange={event => {
                      if (selectedMatch) {
                        setMatchStatus(selectedMatch, event.target.value as MatchSummary['status'])
                      }
                    }}
                  >
                    {matchStatuses.map(status => (
                      <option key={status} value={status}>
                        {matchStatusLabels[status]}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Дата и время
                  <input
                    type="datetime-local"
                    value={selectedMatchForm?.matchDateTime ?? ''}
                    onChange={event => {
                      if (!selectedMatch) return
                      setMatchDateTime(selectedMatch, event.target.value)
                    }}
                  />
                </label>

                <label className="stacked">
                  Счёт
                  {!isSelectedMatchLive ? (
                    <p className="muted">Изменение счёта доступно только в статусе «Идёт».</p>
                  ) : null}
                  {isPenaltyEligible && selectedMatch ? (
                    <div className="penalty-toggle" role="group" aria-label="Серия пенальти">
                      <label className="penalty-checkbox">
                        <input
                          type="checkbox"
                          checked={penaltyEnabled}
                          onChange={event =>
                            togglePenaltyShootout(selectedMatch, event.target.checked)
                          }
                        />
                        <span>Серия пенальти</span>
                      </label>
                      {penaltyEnabled ? (
                        <span className="penalty-hint">
                          Победитель определяется по серии пенальти.
                        </span>
                      ) : !isRegulationDraw ? (
                        <span className="penalty-hint muted">Включится при ничейном счёте.</span>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="score-editor">
                    <div className="score-block">
                      <div className={`score-control${isSelectedMatchLive ? ' live' : ''}`}>
                        {isSelectedMatchLive && selectedMatch ? (
                          <button
                            type="button"
                            className="score-button"
                            onClick={() => adjustMatchScore(selectedMatch, 'homeScore', -1)}
                            disabled={homeScoreForControls <= 0}
                            aria-label="Уменьшить счёт хозяев"
                          >
                            −
                          </button>
                        ) : null}
                        <input
                          type="number"
                          value={homeScoreInputValue}
                          onChange={event => {
                            if (!selectedMatch) return
                            const raw = event.target.value
                            if (raw === '') {
                              setMatchScore(selectedMatch, 'homeScore', '')
                            } else {
                              const numeric = Number(raw)
                              if (!Number.isNaN(numeric)) {
                                setMatchScore(selectedMatch, 'homeScore', numeric)
                              }
                            }
                          }}
                          className="score-input"
                          min={0}
                          disabled={scoreInputsDisabled}
                          aria-label="Счёт хозяев"
                        />
                        {isSelectedMatchLive && selectedMatch ? (
                          <button
                            type="button"
                            className="score-button"
                            onClick={() => adjustMatchScore(selectedMatch, 'homeScore', 1)}
                            aria-label="Увеличить счёт хозяев"
                          >
                            +
                          </button>
                        ) : null}
                      </div>
                      <span className="score-team-label">{homeDisplayName}</span>
                    </div>
                    <span className="score-separator">-</span>
                    <div className="score-block">
                      <div className={`score-control${isSelectedMatchLive ? ' live' : ''}`}>
                        {isSelectedMatchLive && selectedMatch ? (
                          <button
                            type="button"
                            className="score-button"
                            onClick={() => adjustMatchScore(selectedMatch, 'awayScore', -1)}
                            disabled={awayScoreForControls <= 0}
                            aria-label="Уменьшить счёт гостей"
                          >
                            −
                          </button>
                        ) : null}
                        <input
                          type="number"
                          value={awayScoreInputValue}
                          onChange={event => {
                            if (!selectedMatch) return
                            const raw = event.target.value
                            if (raw === '') {
                              setMatchScore(selectedMatch, 'awayScore', '')
                            } else {
                              const numeric = Number(raw)
                              if (!Number.isNaN(numeric)) {
                                setMatchScore(selectedMatch, 'awayScore', numeric)
                              }
                            }
                          }}
                          className="score-input"
                          min={0}
                          disabled={scoreInputsDisabled}
                          aria-label="Счёт гостей"
                        />
                        {isSelectedMatchLive && selectedMatch ? (
                          <button
                            type="button"
                            className="score-button"
                            onClick={() => adjustMatchScore(selectedMatch, 'awayScore', 1)}
                            aria-label="Увеличить счёт гостей"
                          >
                            +
                          </button>
                        ) : null}
                      </div>
                      <span className="score-team-label">{awayDisplayName}</span>
                    </div>
                  </div>
                  {penaltyEnabled && selectedMatch ? (
                    <div
                      className="penalty-score-editor"
                      role="group"
                      aria-label="Серия пенальти: счёт"
                    >
                      <div className="penalty-score-block">
                        <div className="penalty-score-control">
                          <button
                            type="button"
                            className="score-button penalty"
                            onClick={() =>
                              adjustPenaltyScore(selectedMatch, 'penaltyHomeScore', -1)
                            }
                            disabled={penaltyHomeScore <= 0}
                            aria-label="Уменьшить пенальти хозяев"
                          >
                            −
                          </button>
                          <span className="penalty-score-value">{penaltyHomeScore}</span>
                          <button
                            type="button"
                            className="score-button penalty"
                            onClick={() => adjustPenaltyScore(selectedMatch, 'penaltyHomeScore', 1)}
                            aria-label="Увеличить пенальти хозяев"
                          >
                            +
                          </button>
                        </div>
                        <span className="score-team-label">{homeDisplayName}</span>
                      </div>
                      <span className="score-separator">-</span>
                      <div className="penalty-score-block">
                        <div className="penalty-score-control">
                          <button
                            type="button"
                            className="score-button penalty"
                            onClick={() =>
                              adjustPenaltyScore(selectedMatch, 'penaltyAwayScore', -1)
                            }
                            disabled={penaltyAwayScore <= 0}
                            aria-label="Уменьшить пенальти гостей"
                          >
                            −
                          </button>
                          <span className="penalty-score-value">{penaltyAwayScore}</span>
                          <button
                            type="button"
                            className="score-button penalty"
                            onClick={() => adjustPenaltyScore(selectedMatch, 'penaltyAwayScore', 1)}
                            aria-label="Увеличить пенальти гостей"
                          >
                            +
                          </button>
                        </div>
                        <span className="score-team-label">{awayDisplayName}</span>
                      </div>
                    </div>
                  ) : null}
                </label>

                <button className="button-secondary" type="submit">
                  Сохранить изменения
                </button>
              </form>

              <div className="split-columns">
                <div className="match-stats-card" data-busy={matchStatsUpdating || undefined}>
                  <div className="match-stats-header">
                    <div className="match-stats-title">
                      <h6>Статистика матча</h6>
                      {matchStatsVersion !== undefined ? (
                        <span className="match-stats-chip">v{matchStatsVersion}</span>
                      ) : null}
                    </div>
                    <div className="match-stats-teams">
                      <div className="match-stats-team match-stats-team-home">
                        <span className="match-stats-team-role">Дом</span>
                        <span className="match-stats-team-name">{homeDisplayName}</span>
                      </div>
                      <div className="match-stats-team match-stats-team-away">
                        <span className="match-stats-team-role">Гости</span>
                        <span className="match-stats-team-name">{awayDisplayName}</span>
                      </div>
                    </div>
                  </div>
                  {matchStatsLoading ? (
                    <p className="muted">Загружаем статистику…</p>
                  ) : !selectedMatch ? (
                    <p className="muted">Выберите матч, чтобы редактировать показатели.</p>
                  ) : (
                    <div className="match-stats-grid" role="group" aria-label="Статистика матча">
                      {matchStatisticRows.map(({ metric, label }) => (
                        <React.Fragment key={metric}>
                          <div
                            className="match-stat-side match-stat-side-home"
                            aria-label={`${label} — хозяева`}
                          >
                            <button
                              type="button"
                              className="stat-adjust-button"
                              onClick={() => adjustStatistic(homeClub?.id, metric, -1)}
                              disabled={
                                matchStatsUpdating ||
                                !homeClub ||
                                !canDecreaseStatistic(homeClub?.id, metric)
                              }
                              aria-label={`Уменьшить показатель «${label}» для хозяев`}
                            >
                              −
                            </button>
                            <span className="match-stat-value">
                              {getStatisticValue(homeClub?.id, metric)}
                            </span>
                            <button
                              type="button"
                              className="stat-adjust-button"
                              onClick={() => adjustStatistic(homeClub?.id, metric, 1)}
                              disabled={matchStatsUpdating || !homeClub}
                              aria-label={`Увеличить показатель «${label}» для хозяев`}
                            >
                              +
                            </button>
                          </div>
                          <div className="match-stat-label">{label}</div>
                          <div
                            className="match-stat-side match-stat-side-away"
                            aria-label={`${label} — гости`}
                          >
                            <button
                              type="button"
                              className="stat-adjust-button"
                              onClick={() => adjustStatistic(awayClub?.id, metric, -1)}
                              disabled={
                                matchStatsUpdating ||
                                !awayClub ||
                                !canDecreaseStatistic(awayClub?.id, metric)
                              }
                              aria-label={`Уменьшить показатель «${label}» для гостей`}
                            >
                              −
                            </button>
                            <span className="match-stat-value">
                              {getStatisticValue(awayClub?.id, metric)}
                            </span>
                            <button
                              type="button"
                              className="stat-adjust-button"
                              onClick={() => adjustStatistic(awayClub?.id, metric, 1)}
                              disabled={matchStatsUpdating || !awayClub}
                              aria-label={`Увеличить показатель «${label}» для гостей`}
                            >
                              +
                            </button>
                          </div>
                        </React.Fragment>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <h6>События</h6>
                  <form className="stacked" onSubmit={handleEventSubmit}>
                    <label>
                      Команда
                      <select
                        value={eventForm.teamId}
                        onChange={event =>
                          setEventForm(form => ({
                            ...form,
                            teamId: event.target.value ? Number(event.target.value) : '',
                            playerId: '',
                            relatedPlayerId: '',
                          }))
                        }
                        required
                        disabled={!selectedMatch}
                      >
                        <option value="">
                          {selectedMatch ? 'Выберите команду' : 'Выберите матч'}
                        </option>
                        {selectedMatchTeams.map(team => (
                          <option key={team.id} value={team.id}>
                            {team.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Игрок
                      <select
                        value={eventForm.playerId}
                        onChange={event =>
                          setEventForm(form => ({
                            ...form,
                            playerId: event.target.value ? Number(event.target.value) : '',
                            relatedPlayerId: '',
                          }))
                        }
                        required
                        disabled={
                          !selectedMatch || !eventForm.teamId || eventPlayerOptions.length === 0
                        }
                      >
                        <option value="">
                          {selectedMatch
                            ? eventForm.teamId
                              ? eventPlayerOptions.length === 0
                                ? 'Нет игроков в заявке'
                                : 'Выберите игрока'
                              : 'Сначала выберите команду'
                            : 'Выберите матч'}
                        </option>
                        {eventPlayerOptions.map(entry => (
                          <option key={entry.personId} value={entry.personId}>
                            №{entry.shirtNumber || '?'} {entry.person.lastName}{' '}
                            {entry.person.firstName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="grid-two">
                      <label>
                        Минута
                        <input
                          type="number"
                          value={eventForm.minute}
                          onChange={event =>
                            setEventForm(form => ({
                              ...form,
                              minute: event.target.value ? Number(event.target.value) : '',
                            }))
                          }
                          min={0}
                          required
                        />
                      </label>
                      <label>
                        Тип события
                        <select
                          value={eventForm.eventType}
                          onChange={event =>
                            setEventForm(form => {
                              const nextType = event.target.value as EventFormState['eventType']
                              return {
                                ...form,
                                eventType: nextType,
                                relatedPlayerId: nextType === 'GOAL' ? form.relatedPlayerId : '',
                              }
                            })
                          }
                        >
                          {eventTypes.map(type => (
                            <option key={type} value={type}>
                              {eventTypeLabels[type]}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label>
                      Второй игрок (опционально)
                      <select
                        value={eventForm.relatedPlayerId}
                        onChange={event =>
                          setEventForm(form => ({
                            ...form,
                            relatedPlayerId: event.target.value ? Number(event.target.value) : '',
                          }))
                        }
                        disabled={
                          !selectedMatch ||
                          !eventAllowsAssist ||
                          !eventForm.playerId ||
                          relatedEventPlayerOptions.length === 0
                        }
                      >
                        <option value="">
                          {selectedMatch
                            ? eventAllowsAssist
                              ? eventForm.playerId
                                ? relatedEventPlayerOptions.length === 0
                                  ? 'Нет второго игрока'
                                  : 'Выберите игрока'
                                : 'Сначала выберите основного игрока'
                              : 'Ассист доступен только для гола'
                            : 'Выберите матч'}
                        </option>
                        {relatedEventPlayerOptions.map(entry => (
                          <option key={entry.personId} value={entry.personId}>
                            №{entry.shirtNumber || '?'} {entry.person.lastName}{' '}
                            {entry.person.firstName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button className="button-secondary" type="submit">
                      Добавить событие
                    </button>
                  </form>
                  <ul className="list">
                    {matchEvents.map(entry => (
                      <li key={entry.id}>
                        <span>
                          {entry.minute}&apos; {eventTypeLabels[entry.eventType]} — №
                          {entry.player.shirtNumber || '?'} {entry.player.lastName}{' '}
                          {entry.player.firstName}
                          {entry.relatedPerson
                            ? ` · ассист: №${entry.relatedPerson.shirtNumber || '?'} ${entry.relatedPerson.lastName} ${entry.relatedPerson.firstName}`
                            : ''}
                        </span>
                        <span className="list-actions">
                          <button
                            type="button"
                            className="danger"
                            onClick={() => handleEventDelete(entry)}
                          >
                            Удал.
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
