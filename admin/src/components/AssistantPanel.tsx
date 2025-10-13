import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useAdminStore } from '../store/adminStore'
import { useAssistantStore } from '../store/assistantStore'
import type {
  AssistantMatchSummary,
  MatchEventEntry,
  MatchLineupEntry,
  MatchStatisticEntry,
  MatchStatisticMetric,
} from '../types'
import './assistant.css'

const EVENT_OPTIONS: Array<{ value: MatchEventEntry['eventType']; label: string }> = [
  { value: 'GOAL', label: 'Гол' },
  { value: 'PENALTY_GOAL', label: 'Гол с пенальти' },
  { value: 'OWN_GOAL', label: 'Автогол' },
  { value: 'PENALTY_MISSED', label: 'Нереализованный пенальти' },
  { value: 'YELLOW_CARD', label: 'Жёлтая карточка' },
  { value: 'SECOND_YELLOW_CARD', label: 'Вторая жёлтая' },
  { value: 'RED_CARD', label: 'Красная карточка' },
  { value: 'SUB_IN', label: 'Замена (вышел)' },
  { value: 'SUB_OUT', label: 'Замена (ушёл)' },
]

const STATISTIC_ORDER: MatchStatisticMetric[] = [
  'totalShots',
  'shotsOnTarget',
  'corners',
  'yellowCards',
  'redCards',
]

const STATISTIC_LABELS: Record<MatchStatisticMetric, string> = {
  totalShots: 'Удары',
  shotsOnTarget: 'Удары в створ',
  corners: 'Угловые',
  yellowCards: 'Жёлтые карточки',
  redCards: 'Красные карточки',
}

type ScoreFormState = {
  homeScore: string
  awayScore: string
  hasPenaltyShootout: boolean
  penaltyHomeScore: string
  penaltyAwayScore: string
  status: 'LIVE' | 'FINISHED'
}

type EventDraft = {
  minute: string
  eventType: MatchEventEntry['eventType']
  teamId: string
  playerId: string
  relatedPlayerId: string
}

const createScoreForm = (match: AssistantMatchSummary | undefined): ScoreFormState => {
  const baseStatus = match?.status === 'FINISHED' ? 'FINISHED' : 'LIVE'
  return {
    homeScore: match ? String(match.homeScore ?? 0) : '0',
    awayScore: match ? String(match.awayScore ?? 0) : '0',
    hasPenaltyShootout: Boolean(match?.hasPenaltyShootout),
    penaltyHomeScore: match ? String(match.penaltyHomeScore ?? 0) : '0',
    penaltyAwayScore: match ? String(match.penaltyAwayScore ?? 0) : '0',
    status: baseStatus,
  }
}

const createEventDraft = (match: AssistantMatchSummary | undefined): EventDraft => ({
  minute: '1',
  eventType: 'GOAL',
  teamId: match ? String(match.homeClub.id) : '',
  playerId: '',
  relatedPlayerId: '',
})

const parseNumber = (value: string): number => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

type StatisticSnapshot = {
  home: MatchStatisticEntry | undefined
  away: MatchStatisticEntry | undefined
}

const createStatisticSnapshot = (
  stats: MatchStatisticEntry[],
  homeClubId?: number,
  awayClubId?: number
): StatisticSnapshot => {
  if (!homeClubId || !awayClubId) {
    return { home: undefined, away: undefined }
  }
  const map = new Map<number, MatchStatisticEntry>()
  for (const entry of stats) {
    map.set(entry.clubId, entry)
  }
  return {
    home: map.get(homeClubId),
    away: map.get(awayClubId),
  }
}

export const AssistantPanel = () => {
  const { logout, assistantToken } = useAdminStore(state => ({
    logout: state.logout,
    assistantToken: state.assistantToken,
  }))

  const {
    status,
    matches,
    selectedMatchId,
    events,
    lineup,
    statistics,
    statisticsVersion,
    error,
    loading,
    fetchMatches,
    selectMatch,
    refreshSelected,
    createEvent,
    updateEvent,
    deleteEvent,
    updateScore,
    adjustStatistic,
    reset,
    clearError,
  } = useAssistantStore(state => ({
    status: state.status,
    matches: state.matches,
    selectedMatchId: state.selectedMatchId,
    events: state.events,
    lineup: state.lineup,
    statistics: state.statistics,
    statisticsVersion: state.statisticsVersion,
    error: state.error,
    loading: state.loading,
    fetchMatches: state.fetchMatches,
    selectMatch: state.selectMatch,
    refreshSelected: state.refreshSelected,
    createEvent: state.createEvent,
    updateEvent: state.updateEvent,
    deleteEvent: state.deleteEvent,
    updateScore: state.updateScore,
    adjustStatistic: state.adjustStatistic,
    reset: state.reset,
    clearError: state.clearError,
  }))

  const selectedMatch = useMemo(
    () => matches.find(match => match.id === selectedMatchId),
    [matches, selectedMatchId]
  )

  const [scoreForm, setScoreForm] = useState<ScoreFormState>(() => createScoreForm(selectedMatch))
  const [pendingFinishConfirmation, setPendingFinishConfirmation] = useState(false)
  const [newEventForm, setNewEventForm] = useState<EventDraft>(() =>
    createEventDraft(selectedMatch)
  )
  const [editingEventId, setEditingEventId] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState<EventDraft | null>(null)

  const homeScoreValue = parseNumber(scoreForm.homeScore)
  const awayScoreValue = parseNumber(scoreForm.awayScore)
  const penaltyEligible = selectedMatch?.status === 'LIVE' && homeScoreValue === awayScoreValue
  const penaltyToggleDisabled = !penaltyEligible
  const penaltyInputsDisabled = !scoreForm.hasPenaltyShootout
  const penaltyHintVisible = Boolean(selectedMatch) && penaltyToggleDisabled

  useEffect(() => {
    if (!assistantToken) {
      reset()
      return
    }
    if (status === 'idle') {
      void fetchMatches(assistantToken)
    }
  }, [assistantToken, status, fetchMatches, reset])

  useEffect(() => {
    setScoreForm(createScoreForm(selectedMatch))
    setPendingFinishConfirmation(false)
    setNewEventForm(createEventDraft(selectedMatch))
    setEditingEventId(null)
    setEditingDraft(null)
  }, [selectedMatch])

  useEffect(() => {
    if (!penaltyEligible && scoreForm.hasPenaltyShootout) {
      setScoreForm(prev => ({
        ...prev,
        hasPenaltyShootout: false,
        penaltyHomeScore: '0',
        penaltyAwayScore: '0',
      }))
    }
  }, [penaltyEligible, scoreForm.hasPenaltyShootout])

  const lineupByClub = useMemo(() => {
    const map = new Map<number, MatchLineupEntry[]>()
    for (const entry of lineup) {
      const bucket = map.get(entry.clubId) || []
      bucket.push(entry)
      map.set(entry.clubId, bucket)
    }
    for (const [, bucket] of map) {
      bucket.sort((left, right) => {
        if (left.role !== right.role) {
          return left.role === 'STARTER' ? -1 : 1
        }
        const leftShirt = left.shirtNumber ?? 9999
        const rightShirt = right.shirtNumber ?? 9999
        if (leftShirt !== rightShirt) {
          return leftShirt - rightShirt
        }
        return left.personId - right.personId
      })
    }
    return map
  }, [lineup])

  const statisticSnapshot = useMemo(
    () =>
      createStatisticSnapshot(statistics, selectedMatch?.homeClub.id, selectedMatch?.awayClub.id),
    [statistics, selectedMatch]
  )

  const formatPlayerLabel = (entry: MatchLineupEntry): string => {
    const parts: string[] = []
    if (entry.shirtNumber) {
      parts.push(`#${entry.shirtNumber}`)
    }
    const firstName = entry.person.firstName || ''
    const lastName = entry.person.lastName || ''
    const name = `${lastName} ${firstName}`.trim()
    parts.push(name || `ID ${entry.personId}`)
    if (entry.role === 'SUBSTITUTE') {
      parts.push('(зап)')
    }
    return parts.join(' ')
  }

  const homePlayers = useMemo(() => {
    if (!selectedMatch) return []
    return lineupByClub.get(selectedMatch.homeClub.id) || []
  }, [lineupByClub, selectedMatch])

  const awayPlayers = useMemo(() => {
    if (!selectedMatch) return []
    return lineupByClub.get(selectedMatch.awayClub.id) || []
  }, [lineupByClub, selectedMatch])

  const allPlayers = useMemo(() => [...homePlayers, ...awayPlayers], [homePlayers, awayPlayers])

  useEffect(() => {
    if (!selectedMatch) return
    const teamId = Number(newEventForm.teamId)
    if (!teamId) {
      if (newEventForm.playerId) {
        setNewEventForm(prev => ({ ...prev, playerId: '' }))
      }
      return
    }
    const options = lineupByClub.get(teamId) || []
    if (!options.length) return
    if (newEventForm.playerId) return
    setNewEventForm(prev => {
      if (!prev.teamId || Number(prev.teamId) !== teamId || prev.playerId) {
        return prev
      }
      return { ...prev, playerId: String(options[0].personId) }
    })
  }, [selectedMatch, newEventForm.teamId, newEventForm.playerId, lineupByClub])

  useEffect(() => {
    if (!editingDraft || !selectedMatch) return
    const teamId = Number(editingDraft.teamId)
    if (!teamId) return
    const options = lineupByClub.get(teamId) || []
    if (!options.length) return
    if (editingDraft.playerId) return
    setEditingDraft(prev => {
      if (!prev) return prev
      if (!prev.teamId || Number(prev.teamId) !== teamId || prev.playerId) {
        return prev
      }
      return { ...prev, playerId: String(options[0].personId) }
    })
  }, [editingDraft, selectedMatch, lineupByClub])

  const handleSelectMatch = async (matchId: string) => {
    if (!assistantToken) return
    await selectMatch(assistantToken, matchId)
  }

  const handleRefresh = async () => {
    if (!assistantToken) return
    await fetchMatches(assistantToken)
    if (selectedMatchId) {
      await refreshSelected(assistantToken)
    }
  }

  const handleScoreChange = (field: keyof ScoreFormState, value: string | boolean) => {
    setScoreForm(prev => {
      if (field === 'status') {
        const nextStatus = value as ScoreFormState['status']
        if (nextStatus !== 'FINISHED') {
          setPendingFinishConfirmation(false)
        }
        return { ...prev, status: nextStatus }
      }
      if (field === 'hasPenaltyShootout') {
        const enabled = Boolean(value)
        return {
          ...prev,
          hasPenaltyShootout: enabled,
          penaltyHomeScore: enabled ? prev.penaltyHomeScore : '0',
          penaltyAwayScore: enabled ? prev.penaltyAwayScore : '0',
        }
      }
      return {
        ...prev,
        [field]: String(value),
      }
    })
  }

  const handleScoreSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!assistantToken || !selectedMatch) return

    if (scoreForm.status === 'FINISHED' && !pendingFinishConfirmation) {
      setPendingFinishConfirmation(true)
      return
    }

    await updateScore(assistantToken, selectedMatch.id, {
      homeScore: parseNumber(scoreForm.homeScore),
      awayScore: parseNumber(scoreForm.awayScore),
      hasPenaltyShootout: scoreForm.hasPenaltyShootout,
      penaltyHomeScore: parseNumber(scoreForm.penaltyHomeScore),
      penaltyAwayScore: parseNumber(scoreForm.penaltyAwayScore),
      status: scoreForm.status,
    })
    setPendingFinishConfirmation(false)
  }

  const handleCreateEvent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!assistantToken || !selectedMatch) return
    if (!newEventForm.minute || !newEventForm.teamId || !newEventForm.playerId) return
    await createEvent(assistantToken, selectedMatch.id, {
      minute: parseNumber(newEventForm.minute),
      teamId: parseNumber(newEventForm.teamId),
      playerId: parseNumber(newEventForm.playerId),
      eventType: newEventForm.eventType,
      relatedPlayerId: newEventForm.relatedPlayerId
        ? parseNumber(newEventForm.relatedPlayerId)
        : undefined,
    })
    setNewEventForm(createEventDraft(selectedMatch))
  }

  const beginEditEvent = (entry: MatchEventEntry) => {
    setEditingEventId(entry.id)
    setEditingDraft({
      minute: String(entry.minute),
      eventType: entry.eventType,
      teamId: String(entry.teamId),
      playerId: String(entry.playerId),
      relatedPlayerId: entry.relatedPlayerId ? String(entry.relatedPlayerId) : '',
    })
  }

  const cancelEdit = () => {
    setEditingEventId(null)
    setEditingDraft(null)
  }

  const handleUpdateEvent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!assistantToken || !selectedMatch || !editingEventId || !editingDraft) return
    if (!editingDraft.minute || !editingDraft.teamId || !editingDraft.playerId) return
    await updateEvent(assistantToken, selectedMatch.id, editingEventId, {
      minute: parseNumber(editingDraft.minute),
      teamId: parseNumber(editingDraft.teamId),
      playerId: parseNumber(editingDraft.playerId),
      eventType: editingDraft.eventType,
      relatedPlayerId: editingDraft.relatedPlayerId
        ? parseNumber(editingDraft.relatedPlayerId)
        : undefined,
    })
    cancelEdit()
  }

  const handleDeleteEvent = async (eventId: string) => {
    if (!assistantToken || !selectedMatch) return
    await deleteEvent(assistantToken, selectedMatch.id, eventId)
  }

  const handleAdjustStatistic = async (
    clubId: number,
    metric: MatchStatisticMetric,
    delta: number
  ) => {
    if (!assistantToken || !selectedMatch) return
    await adjustStatistic(assistantToken, selectedMatch.id, { clubId, metric, delta })
  }

  const isLoadingMatches = Boolean(loading.matches) || status === 'loading'
  const isEventsLoading = Boolean(loading.events)
  const isLineupLoading = Boolean(loading.lineup)
  const isStatisticsLoading = Boolean(loading.statistics)
  const isScoreBusy = Boolean(loading.score)
  const isAdjustBusy = Boolean(loading.adjust)

  const matchStatusLabel = (match: AssistantMatchSummary): string => {
    switch (match.status) {
      case 'SCHEDULED':
        return 'Не начат'
      case 'LIVE':
        return 'Идёт'
      case 'FINISHED':
        return 'Завершён'
      default:
        return match.status
    }
  }

  return (
    <div className="assistant-panel" onFocus={() => clearError()}>
      <header className="assistant-header">
        <div>
          <h1>Панель Помощника</h1>
          <p className="assistant-meta">
            Управление ходом матча, статистикой и событиями в режиме реального времени.
          </p>
        </div>
        <div className="assistant-actions">
          <button
            className="button-secondary"
            type="button"
            onClick={handleRefresh}
            disabled={isLoadingMatches}
          >
            Обновить
          </button>
          <button className="button-ghost" type="button" onClick={logout}>
            Выйти
          </button>
        </div>
      </header>

      {error ? <div className="error-banner">Ошибка: {error}</div> : null}

      <div className="assistant-body">
        <aside className="assistant-matches">
          <h2>Матчи</h2>
          {isLoadingMatches ? <p className="assistant-placeholder">Загружаем матчи…</p> : null}
          {!isLoadingMatches && matches.length === 0 ? (
            <p className="assistant-placeholder">
              Нет доступных матчей. Проверьте расписание или статус матча.
            </p>
          ) : null}
          <ul>
            {matches.map(match => {
              const isSelected = match.id === selectedMatchId
              const scoreLabel = `${match.homeScore}:${match.awayScore}`
              return (
                <li key={match.id}>
                  <button
                    type="button"
                    className={isSelected ? 'assistant-match active' : 'assistant-match'}
                    onClick={() => handleSelectMatch(match.id)}
                    disabled={isLoadingMatches}
                  >
                    <div className="match-row">
                      <span className="club-name club-home">{match.homeClub.name}</span>
                      <span className="score">{scoreLabel}</span>
                      <span className="club-name club-away">{match.awayClub.name}</span>
                    </div>
                    <div className="match-meta">
                      <span className={`status status-${match.status.toLowerCase()}`}>
                        {matchStatusLabel(match)}
                      </span>
                      <span className="match-date">
                        {new Date(match.matchDateTime).toLocaleString('ru-RU')}
                      </span>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </aside>

        <section className="assistant-details">
          {selectedMatch ? (
            <div className="assistant-content">
              <article className="assistant-card">
                <h2>Статус и счёт</h2>
                <form className="score-form" onSubmit={handleScoreSubmit}>
                  <div className="score-grid">
                    <div>
                      <label>Хозяева</label>
                      <div className="score-input">
                        <span className="club-caption">{selectedMatch.homeClub.name}</span>
                        <input
                          type="number"
                          min={0}
                          value={scoreForm.homeScore}
                          onChange={event => handleScoreChange('homeScore', event.target.value)}
                        />
                      </div>
                    </div>
                    <div>
                      <label>Гости</label>
                      <div className="score-input">
                        <span className="club-caption">{selectedMatch.awayClub.name}</span>
                        <input
                          type="number"
                          min={0}
                          value={scoreForm.awayScore}
                          onChange={event => handleScoreChange('awayScore', event.target.value)}
                        />
                      </div>
                    </div>
                  </div>

                  <label
                    className={penaltyToggleDisabled ? 'penalty-toggle disabled' : 'penalty-toggle'}
                  >
                    <input
                      type="checkbox"
                      checked={scoreForm.hasPenaltyShootout}
                      disabled={penaltyToggleDisabled}
                      onChange={event =>
                        handleScoreChange('hasPenaltyShootout', event.target.checked)
                      }
                    />
                    Пенальти
                  </label>

                  {penaltyHintVisible ? (
                    <p className="penalty-hint">
                      Пенальти доступны только при ничейном счёте в режиме «Идёт».
                    </p>
                  ) : null}

                  {scoreForm.hasPenaltyShootout ? (
                    <div className="score-grid">
                      <div>
                        <label>Пенальти хозяев</label>
                        <input
                          type="number"
                          min={0}
                          value={scoreForm.penaltyHomeScore}
                          disabled={penaltyInputsDisabled}
                          onChange={event =>
                            handleScoreChange('penaltyHomeScore', event.target.value)
                          }
                        />
                      </div>
                      <div>
                        <label>Пенальти гостей</label>
                        <input
                          type="number"
                          min={0}
                          value={scoreForm.penaltyAwayScore}
                          disabled={penaltyInputsDisabled}
                          onChange={event =>
                            handleScoreChange('penaltyAwayScore', event.target.value)
                          }
                        />
                      </div>
                    </div>
                  ) : null}

                  <div className="score-grid">
                    <div>
                      <label>Статус матча</label>
                      <select
                        value={scoreForm.status}
                        onChange={event => handleScoreChange('status', event.target.value)}
                      >
                        <option value="LIVE">Идёт</option>
                        <option value="FINISHED">Завершён</option>
                      </select>
                    </div>
                    <div className="status-hint">
                      <span>Текущий статус: {matchStatusLabel(selectedMatch)}</span>
                      {pendingFinishConfirmation ? (
                        <span className="confirm-hint">
                          Нажмите отправить ещё раз для подтверждения завершения.
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <button className="button-primary" type="submit" disabled={isScoreBusy}>
                    Сохранить
                  </button>
                </form>
              </article>

              <article className="assistant-card">
                <h2>События</h2>
                <form className="event-form" onSubmit={handleCreateEvent}>
                  <div className="event-grid">
                    <div>
                      <label>Минута</label>
                      <input
                        type="number"
                        min={1}
                        max={150}
                        value={newEventForm.minute}
                        onChange={event =>
                          setNewEventForm(prev => ({ ...prev, minute: event.target.value }))
                        }
                      />
                    </div>
                    <div>
                      <label>Тип</label>
                      <select
                        value={newEventForm.eventType}
                        onChange={event =>
                          setNewEventForm(prev => ({
                            ...prev,
                            eventType: event.target.value as MatchEventEntry['eventType'],
                          }))
                        }
                      >
                        {EVENT_OPTIONS.map(option => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label>Команда</label>
                      <select
                        value={newEventForm.teamId}
                        onChange={event =>
                          setNewEventForm(prev => ({ ...prev, teamId: event.target.value }))
                        }
                      >
                        <option value="">—</option>
                        <option value={String(selectedMatch.homeClub.id)}>
                          {selectedMatch.homeClub.name}
                        </option>
                        <option value={String(selectedMatch.awayClub.id)}>
                          {selectedMatch.awayClub.name}
                        </option>
                      </select>
                    </div>
                    <div>
                      <label>Игрок</label>
                      <select
                        value={newEventForm.playerId}
                        onChange={event =>
                          setNewEventForm(prev => ({ ...prev, playerId: event.target.value }))
                        }
                      >
                        <option value="">—</option>
                        {allPlayers.map(player => (
                          <option key={player.personId} value={String(player.personId)}>
                            {formatPlayerLabel(player)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label>Второй игрок (опционально)</label>
                      <select
                        value={newEventForm.relatedPlayerId}
                        onChange={event =>
                          setNewEventForm(prev => ({
                            ...prev,
                            relatedPlayerId: event.target.value,
                          }))
                        }
                      >
                        <option value="">—</option>
                        {allPlayers.map(player => (
                          <option key={player.personId} value={String(player.personId)}>
                            {formatPlayerLabel(player)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <button className="button-primary" type="submit" disabled={isEventsLoading}>
                    Добавить событие
                  </button>
                </form>

                <ul className="event-list">
                  {isEventsLoading ? (
                    <li className="assistant-placeholder">Обновляем события…</li>
                  ) : null}
                  {!isEventsLoading && events.length === 0 ? (
                    <li className="assistant-placeholder">События не найдены.</li>
                  ) : null}
                  {events.map(entry => {
                    const isEditing = editingEventId === entry.id
                    if (isEditing && editingDraft) {
                      return (
                        <li key={entry.id} className="event-item">
                          <form className="event-inline" onSubmit={handleUpdateEvent}>
                            <input
                              type="number"
                              min={1}
                              max={150}
                              value={editingDraft.minute}
                              onChange={event =>
                                setEditingDraft(prev =>
                                  prev ? { ...prev, minute: event.target.value } : prev
                                )
                              }
                            />
                            <select
                              value={editingDraft.eventType}
                              onChange={event =>
                                setEditingDraft(prev =>
                                  prev
                                    ? {
                                        ...prev,
                                        eventType: event.target
                                          .value as MatchEventEntry['eventType'],
                                      }
                                    : prev
                                )
                              }
                            >
                              {EVENT_OPTIONS.map(option => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <select
                              value={editingDraft.teamId}
                              onChange={event =>
                                setEditingDraft(prev =>
                                  prev ? { ...prev, teamId: event.target.value } : prev
                                )
                              }
                            >
                              <option value={String(selectedMatch.homeClub.id)}>
                                {selectedMatch.homeClub.name}
                              </option>
                              <option value={String(selectedMatch.awayClub.id)}>
                                {selectedMatch.awayClub.name}
                              </option>
                            </select>
                            <select
                              value={editingDraft.playerId}
                              onChange={event =>
                                setEditingDraft(prev =>
                                  prev ? { ...prev, playerId: event.target.value } : prev
                                )
                              }
                            >
                              {allPlayers.map(player => (
                                <option key={player.personId} value={String(player.personId)}>
                                  {formatPlayerLabel(player)}
                                </option>
                              ))}
                            </select>
                            <select
                              value={editingDraft.relatedPlayerId}
                              onChange={event =>
                                setEditingDraft(prev =>
                                  prev ? { ...prev, relatedPlayerId: event.target.value } : prev
                                )
                              }
                            >
                              <option value="">—</option>
                              {allPlayers.map(player => (
                                <option key={player.personId} value={String(player.personId)}>
                                  {formatPlayerLabel(player)}
                                </option>
                              ))}
                            </select>
                            <div className="event-buttons">
                              <button className="button-primary" type="submit">
                                Сохранить
                              </button>
                              <button className="button-ghost" type="button" onClick={cancelEdit}>
                                Отмена
                              </button>
                            </div>
                          </form>
                        </li>
                      )
                    }

                    return (
                      <li key={entry.id} className="event-item">
                        <div className="event-row">
                          <span className="event-minute">{entry.minute}&apos;</span>
                          <span className="event-type">
                            {EVENT_OPTIONS.find(option => option.value === entry.eventType)
                              ?.label || entry.eventType}
                          </span>
                          <span className="event-team">{entry.team.name}</span>
                          <span className="event-player">
                            {`${entry.player.lastName} ${entry.player.firstName}`.trim()}
                          </span>
                          <div className="event-controls">
                            <button
                              className="button-secondary"
                              type="button"
                              onClick={() => beginEditEvent(entry)}
                            >
                              Править
                            </button>
                            <button
                              className="button-danger"
                              type="button"
                              onClick={() => handleDeleteEvent(entry.id)}
                            >
                              Удалить
                            </button>
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </article>

              <article className="assistant-card">
                <h2>Статистика матча</h2>
                <div className="statistics-header">
                  <span>Версия: {statisticsVersion ?? '—'}</span>
                  <button
                    className="button-secondary"
                    type="button"
                    onClick={() => refreshSelected(assistantToken)}
                    disabled={isStatisticsLoading || !assistantToken || !selectedMatchId}
                  >
                    Синхронизировать
                  </button>
                </div>
                <div className="assistant-statistics">
                  <section>
                    <h3>{selectedMatch.homeClub.name}</h3>
                    <ul>
                      {STATISTIC_ORDER.map(metric => {
                        const value = statisticSnapshot.home ? statisticSnapshot.home[metric] : 0
                        return (
                          <li key={metric}>
                            <span>{STATISTIC_LABELS[metric]}</span>
                            <div>
                              <button
                                type="button"
                                onClick={() =>
                                  handleAdjustStatistic(selectedMatch.homeClub.id, metric, -1)
                                }
                                disabled={isAdjustBusy}
                              >
                                −
                              </button>
                              <span className="stat-value">{value}</span>
                              <button
                                type="button"
                                onClick={() =>
                                  handleAdjustStatistic(selectedMatch.homeClub.id, metric, 1)
                                }
                                disabled={isAdjustBusy}
                              >
                                +
                              </button>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                  <section>
                    <h3>{selectedMatch.awayClub.name}</h3>
                    <ul>
                      {STATISTIC_ORDER.map(metric => {
                        const value = statisticSnapshot.away ? statisticSnapshot.away[metric] : 0
                        return (
                          <li key={metric}>
                            <span>{STATISTIC_LABELS[metric]}</span>
                            <div>
                              <button
                                type="button"
                                onClick={() =>
                                  handleAdjustStatistic(selectedMatch.awayClub.id, metric, -1)
                                }
                                disabled={isAdjustBusy}
                              >
                                −
                              </button>
                              <span className="stat-value">{value}</span>
                              <button
                                type="button"
                                onClick={() =>
                                  handleAdjustStatistic(selectedMatch.awayClub.id, metric, 1)
                                }
                                disabled={isAdjustBusy}
                              >
                                +
                              </button>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                </div>
              </article>

              <article className="assistant-card">
                <h2>Составы</h2>
                {isLineupLoading ? (
                  <p className="assistant-placeholder">Загружаем составы…</p>
                ) : null}
                {!isLineupLoading ? (
                  <div className="assistant-lineup-columns">
                    <section>
                      <h3>{selectedMatch.homeClub.name}</h3>
                      <ul>
                        {homePlayers.map(entry => (
                          <li key={`${entry.clubId}-${entry.personId}`}>
                            <span className="lineup-number">
                              {entry.shirtNumber ? `#${entry.shirtNumber}` : '—'}
                            </span>
                            <span className="lineup-name">{formatPlayerLabel(entry)}</span>
                            <span className="lineup-role">
                              {entry.role === 'STARTER' ? 'Старт' : 'Запас'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </section>
                    <section>
                      <h3>{selectedMatch.awayClub.name}</h3>
                      <ul>
                        {awayPlayers.map(entry => (
                          <li key={`${entry.clubId}-${entry.personId}`}>
                            <span className="lineup-number">
                              {entry.shirtNumber ? `#${entry.shirtNumber}` : '—'}
                            </span>
                            <span className="lineup-name">{formatPlayerLabel(entry)}</span>
                            <span className="lineup-role">
                              {entry.role === 'STARTER' ? 'Старт' : 'Запас'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  </div>
                ) : null}
              </article>
            </div>
          ) : (
            <div className="assistant-placeholder">Выберите матч, чтобы продолжить работу.</div>
          )}
        </section>
      </div>
    </div>
  )
}
