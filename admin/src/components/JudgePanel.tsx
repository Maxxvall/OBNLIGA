import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useAdminStore } from '../store/adminStore'
import { useJudgeStore } from '../store/judgeStore'
import type { JudgeMatchSummary, MatchEventEntry, MatchLineupEntry } from '../types'
import { formatDateTime } from '../utils/date'
import './judge.css'

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

type ScoreFormState = {
  homeScore: string
  awayScore: string
  hasPenaltyShootout: boolean
  penaltyHomeScore: string
  penaltyAwayScore: string
}

type EventDraft = {
  minute: string
  eventType: MatchEventEntry['eventType']
  teamId: string
  playerId: string
  relatedPlayerId: string
}

const createScoreForm = (match: JudgeMatchSummary | undefined): ScoreFormState => ({
  homeScore: match ? String(match.homeScore ?? 0) : '0',
  awayScore: match ? String(match.awayScore ?? 0) : '0',
  hasPenaltyShootout: Boolean(match?.hasPenaltyShootout),
  penaltyHomeScore: match ? String(match.penaltyHomeScore ?? 0) : '0',
  penaltyAwayScore: match ? String(match.penaltyAwayScore ?? 0) : '0',
})

const createEventDraft = (match: JudgeMatchSummary | undefined): EventDraft => ({
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

export const JudgePanel = () => {
  const { logout, judgeToken } = useAdminStore(state => ({
    logout: state.logout,
    judgeToken: state.judgeToken,
  }))

  const {
    status,
    matches,
    selectedMatchId,
    events,
    lineup,
    loading,
    error,
    loadMatches,
    refreshMatches,
    selectMatch,
    updateScore,
    createEvent,
    updateEvent,
    deleteEvent,
    reset,
    clearError,
  } = useJudgeStore(state => ({
    status: state.status,
    matches: state.matches,
    selectedMatchId: state.selectedMatchId,
    events: state.events,
    lineup: state.lineup,
    loading: state.loading,
    error: state.error,
    loadMatches: state.loadMatches,
    refreshMatches: state.refreshMatches,
    selectMatch: state.selectMatch,
    updateScore: state.updateScore,
    createEvent: state.createEvent,
    updateEvent: state.updateEvent,
    deleteEvent: state.deleteEvent,
    reset: state.reset,
    clearError: state.clearError,
  }))

  const selectedMatch = useMemo(
    () => matches.find(match => match.id === selectedMatchId),
    [matches, selectedMatchId]
  )

  const [scoreForm, setScoreForm] = useState<ScoreFormState>(() => createScoreForm(selectedMatch))
  const [newEventForm, setNewEventForm] = useState<EventDraft>(() =>
    createEventDraft(selectedMatch)
  )
  const [editingEventId, setEditingEventId] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState<EventDraft | null>(null)

  const homeScoreValue = parseNumber(scoreForm.homeScore)
  const awayScoreValue = parseNumber(scoreForm.awayScore)
  const penaltyEligible = homeScoreValue === awayScoreValue
  const penaltyToggleDisabled = !penaltyEligible

  const lineupByClub = useMemo(() => {
    const map = new Map<number, MatchLineupEntry[]>()
    for (const entry of lineup) {
      const existing = map.get(entry.clubId) || []
      existing.push(entry)
      map.set(entry.clubId, existing)
    }
    for (const [, entries] of map) {
      entries.sort((left, right) => {
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

  const buildPlayerOptions = useCallback(
    (teamId: string, currentPlayerId?: string): MatchLineupEntry[] => {
      const numeric = Number(teamId)
      const base = numeric ? lineupByClub.get(numeric) || [] : []
      const options = base.length ? [...base] : []
      if (currentPlayerId) {
        const exists = options.some(player => String(player.personId) === currentPlayerId)
        if (!exists) {
          const fallback = allPlayers.find(
            player => String(player.personId) === currentPlayerId
          )
          if (fallback) {
            options.push(fallback)
          }
        }
      }
      return options
    },
    [lineupByClub, allPlayers]
  )

  const assistAvailable = newEventForm.eventType === 'GOAL'
  const editingAssistAvailable = editingDraft?.eventType === 'GOAL'
  const penaltyHintVisible = !penaltyEligible

  const homeScoreId = selectedMatch ? `judge-score-home-${selectedMatch.id}` : 'judge-score-home'
  const awayScoreId = selectedMatch ? `judge-score-away-${selectedMatch.id}` : 'judge-score-away'
  const penaltyHomeId = selectedMatch
    ? `judge-penalty-home-${selectedMatch.id}`
    : 'judge-penalty-home'
  const penaltyAwayId = selectedMatch
    ? `judge-penalty-away-${selectedMatch.id}`
    : 'judge-penalty-away'

  const newEventPlayers = buildPlayerOptions(newEventForm.teamId, newEventForm.playerId)
  const isTeamSelected = Number(newEventForm.teamId) > 0

  useEffect(() => {
    if (!judgeToken) {
      reset()
      return
    }
    if (status === 'idle') {
      void loadMatches(judgeToken)
    }
  }, [judgeToken, status, loadMatches, reset])

  useEffect(() => {
    setScoreForm(createScoreForm(selectedMatch))
    setNewEventForm(createEventDraft(selectedMatch))
    setEditingEventId(null)
    setEditingDraft(null)
  }, [selectedMatch])

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

  useEffect(() => {
    if (penaltyEligible || !scoreForm.hasPenaltyShootout) {
      return
    }
    setScoreForm(prev => ({
      ...prev,
      hasPenaltyShootout: false,
      penaltyHomeScore: '0',
      penaltyAwayScore: '0',
    }))
  }, [penaltyEligible, scoreForm.hasPenaltyShootout])

  useEffect(() => {
    if (assistAvailable || !newEventForm.relatedPlayerId) {
      return
    }
    setNewEventForm(prev => (prev.relatedPlayerId ? { ...prev, relatedPlayerId: '' } : prev))
  }, [assistAvailable, newEventForm.relatedPlayerId])

  useEffect(() => {
    if (editingAssistAvailable) {
      return
    }
    setEditingDraft(prev => {
      if (!prev || !prev.relatedPlayerId) {
        return prev
      }
      return { ...prev, relatedPlayerId: '' }
    })
  }, [editingAssistAvailable])

  const handleScoreChange = (field: keyof ScoreFormState, value: string | boolean) => {
    setScoreForm(prev => ({
      ...prev,
      [field]: value,
    }))
  }

  const handleScoreSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!judgeToken || !selectedMatch) return
    await updateScore(judgeToken, selectedMatch.id, {
      homeScore: parseNumber(scoreForm.homeScore),
      awayScore: parseNumber(scoreForm.awayScore),
      hasPenaltyShootout: scoreForm.hasPenaltyShootout,
      penaltyHomeScore: parseNumber(scoreForm.penaltyHomeScore),
      penaltyAwayScore: parseNumber(scoreForm.penaltyAwayScore),
    })
  }

  const handleSelectMatch = async (matchId: string) => {
    if (!judgeToken) return
    await selectMatch(judgeToken, matchId)
  }

  const handleCreateEvent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!judgeToken || !selectedMatch) return
    if (!newEventForm.minute || !newEventForm.teamId || !newEventForm.playerId) return
    await createEvent(judgeToken, selectedMatch.id, {
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
    if (!judgeToken || !selectedMatch || !editingEventId || !editingDraft) return
    if (!editingDraft.minute || !editingDraft.teamId || !editingDraft.playerId) return
    await updateEvent(judgeToken, selectedMatch.id, editingEventId, {
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
    if (!judgeToken || !selectedMatch) return
    await deleteEvent(judgeToken, selectedMatch.id, eventId)
  }

  const handleRefresh = async () => {
    if (!judgeToken) return
    await refreshMatches(judgeToken)
    if (selectedMatchId) {
      await selectMatch(judgeToken, selectedMatchId)
    }
  }

  const isLoadingMatches = Boolean(loading.matches) || status === 'loading'
  const isActionBusy = Boolean(loading.action)
  const isEventsLoading = Boolean(loading.events)
  const isLineupLoading = Boolean(loading.lineup)

  return (
    <div className="judge-panel" onFocus={() => clearError()}>
      <header className="judge-header">
        <div>
          <h1>Панель Судьи</h1>
          <p className="judge-meta">
            Управление событиями и счётом матчей за последние двое суток.
          </p>
        </div>
        <div className="judge-actions">
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

      <div className="judge-body">
        <aside className="judge-matches">
          <h2>Матчи</h2>
          {isLoadingMatches ? <p className="judge-placeholder">Загружаем матчи…</p> : null}
          {!isLoadingMatches && matches.length === 0 ? (
            <p className="judge-placeholder">За последние двое суток нет матчей для модерации.</p>
          ) : null}
          <ul>
            {matches.map(match => {
              const isSelected = match.id === selectedMatchId
              const scoreLabel = `${match.homeScore}:${match.awayScore}`
              return (
                <li key={match.id}>
                  <button
                    type="button"
                    className={isSelected ? 'judge-match active' : 'judge-match'}
                    onClick={() => handleSelectMatch(match.id)}
                    disabled={isLoadingMatches}
                  >
                    <span className="club-name">
                      {match.homeClub.shortName || match.homeClub.name}
                    </span>
                    <span className="score">{scoreLabel}</span>
                    <span className="club-name">
                      {match.awayClub.shortName || match.awayClub.name}
                    </span>
                    <span className={`status status-${match.status.toLowerCase()}`}>
                      {match.status === 'LIVE' ? 'Идёт' : 'Завершён'}
                    </span>
                    <span className="match-date">
                      {formatDateTime(match.matchDateTime)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </aside>

        <section className="judge-details">
          {selectedMatch ? (
            <div className="judge-content">
              <article className="judge-card">
                <h2>Изменение счёта</h2>
                <form className="score-form" onSubmit={handleScoreSubmit}>
                  <div className="score-grid">
                    <label className="score-field" htmlFor={homeScoreId}>
                      <span className="score-field-title">{selectedMatch.homeClub.name}</span>
                      <input
                        id={homeScoreId}
                        className="form-control"
                        type="number"
                        min={0}
                        value={scoreForm.homeScore}
                        onChange={event => handleScoreChange('homeScore', event.target.value)}
                      />
                    </label>
                    <label className="score-field" htmlFor={awayScoreId}>
                      <span className="score-field-title">{selectedMatch.awayClub.name}</span>
                      <input
                        id={awayScoreId}
                        className="form-control"
                        type="number"
                        min={0}
                        value={scoreForm.awayScore}
                        onChange={event => handleScoreChange('awayScore', event.target.value)}
                      />
                    </label>
                  </div>

                  <label className={penaltyToggleDisabled ? 'penalty-toggle disabled' : 'penalty-toggle'}>
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
                    <p className="penalty-hint">Пенальти доступны только при ничейном счёте.</p>
                  ) : null}

                  {scoreForm.hasPenaltyShootout ? (
                    <div className="score-grid">
                      <label className="score-field" htmlFor={penaltyHomeId}>
                        <span className="score-field-title">
                          Пенальти {selectedMatch.homeClub.name}
                        </span>
                        <input
                          id={penaltyHomeId}
                          className="form-control"
                          type="number"
                          min={0}
                          value={scoreForm.penaltyHomeScore}
                          onChange={event =>
                            handleScoreChange('penaltyHomeScore', event.target.value)
                          }
                        />
                      </label>
                      <label className="score-field" htmlFor={penaltyAwayId}>
                        <span className="score-field-title">
                          Пенальти {selectedMatch.awayClub.name}
                        </span>
                        <input
                          id={penaltyAwayId}
                          className="form-control"
                          type="number"
                          min={0}
                          value={scoreForm.penaltyAwayScore}
                          onChange={event =>
                            handleScoreChange('penaltyAwayScore', event.target.value)
                          }
                        />
                      </label>
                    </div>
                  ) : null}

                  <button className="button-primary" type="submit" disabled={isActionBusy}>
                    {isActionBusy ? 'Сохраняем…' : 'Сохранить счёт'}
                  </button>
                </form>
              </article>

              <article className="judge-card">
                <h2>События матча</h2>
                {isEventsLoading ? <p className="judge-placeholder">Загружаем события…</p> : null}
                <form className="event-form" onSubmit={handleCreateEvent}>
                  <div className="event-grid">
                    <label>
                      Минута
                      <input
                        className="form-control"
                        type="number"
                        min={1}
                        value={newEventForm.minute}
                        onChange={event =>
                          setNewEventForm(prev => ({ ...prev, minute: event.target.value }))
                        }
                        required
                      />
                    </label>
                    <label>
                      Тип события
                      <select
                        className="form-control form-select"
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
                    </label>
                    <label>
                      Команда
                      <select
                        className="form-control form-select"
                        value={newEventForm.teamId}
                        onChange={event =>
                          setNewEventForm(prev => ({ ...prev, teamId: event.target.value }))
                        }
                        required
                      >
                        <option value="">—</option>
                        <option value={String(selectedMatch.homeClub.id)}>
                          {selectedMatch.homeClub.name}
                        </option>
                        <option value={String(selectedMatch.awayClub.id)}>
                          {selectedMatch.awayClub.name}
                        </option>
                      </select>
                    </label>
                    <label>
                      Игрок
                      <select
                        className="form-control form-select"
                        value={newEventForm.playerId}
                        onChange={event =>
                          setNewEventForm(prev => ({ ...prev, playerId: event.target.value }))
                        }
                        disabled={!isTeamSelected || newEventPlayers.length === 0}
                        required
                      >
                        <option value="">—</option>
                        {newEventPlayers.map(player => (
                          <option key={player.personId} value={String(player.personId)}>
                            {formatPlayerLabel(player)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Связанный игрок
                      <select
                        className="form-control form-select"
                        value={newEventForm.relatedPlayerId}
                        onChange={event =>
                          setNewEventForm(prev => ({
                            ...prev,
                            relatedPlayerId: event.target.value,
                          }))
                        }
                        disabled={!assistAvailable}
                      >
                        <option value="">—</option>
                        {allPlayers.map(player => (
                          <option key={`assist-${player.personId}`} value={String(player.personId)}>
                            {formatPlayerLabel(player)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <button className="button-secondary" type="submit" disabled={isActionBusy}>
                    Добавить событие
                  </button>
                  <p className="judge-meta">
                    Выберите игрока из заявки нужной команды. Второй игрок доступен только для гола.
                  </p>
                </form>

                <ul className="event-list">
                  {events.map(entry => {
                    const isEditing = editingEventId === entry.id
                    if (isEditing && editingDraft) {
                      const editingPlayers = buildPlayerOptions(
                        editingDraft.teamId,
                        editingDraft.playerId
                      )
                      const editingTeamSelected = Number(editingDraft.teamId) > 0
                      return (
                        <li key={entry.id} className="event-item">
                          <form className="event-inline" onSubmit={handleUpdateEvent}>
                            <input
                              className="form-control"
                              type="number"
                              min={1}
                              value={editingDraft.minute}
                              onChange={event =>
                                setEditingDraft(prev =>
                                  prev ? { ...prev, minute: event.target.value } : prev
                                )
                              }
                              required
                            />
                            <select
                              className="form-control form-select"
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
                              className="form-control form-select"
                              value={editingDraft.teamId}
                              onChange={event =>
                                setEditingDraft(prev =>
                                  prev ? { ...prev, teamId: event.target.value } : prev
                                )
                              }
                              required
                            >
                              <option value={String(selectedMatch.homeClub.id)}>
                                {selectedMatch.homeClub.shortName || selectedMatch.homeClub.name}
                              </option>
                              <option value={String(selectedMatch.awayClub.id)}>
                                {selectedMatch.awayClub.shortName || selectedMatch.awayClub.name}
                              </option>
                            </select>
                            <select
                              className="form-control form-select"
                              value={editingDraft.playerId}
                              onChange={event =>
                                setEditingDraft(prev =>
                                  prev ? { ...prev, playerId: event.target.value } : prev
                                )
                              }
                              disabled={!editingTeamSelected || editingPlayers.length === 0}
                              required
                            >
                              <option value="">—</option>
                              {editingPlayers.map(player => (
                                <option
                                  key={`edit-player-${player.personId}`}
                                  value={String(player.personId)}
                                >
                                  {formatPlayerLabel(player)}
                                </option>
                              ))}
                            </select>
                            <select
                              className="form-control form-select"
                              value={editingDraft.relatedPlayerId}
                              onChange={event =>
                                setEditingDraft(prev =>
                                  prev ? { ...prev, relatedPlayerId: event.target.value } : prev
                                )
                              }
                              disabled={!editingAssistAvailable}
                            >
                              <option value="">—</option>
                              {allPlayers.map(player => (
                                <option
                                  key={`edit-assist-${player.personId}`}
                                  value={String(player.personId)}
                                >
                                  {formatPlayerLabel(player)}
                                </option>
                              ))}
                            </select>
                            <div className="event-buttons">
                              <button
                                className="button-primary"
                                type="submit"
                                disabled={isActionBusy}
                              >
                                Сохранить
                              </button>
                              <button className="button-ghost" type="button" onClick={cancelEdit}>
                                Отменить
                              </button>
                            </div>
                          </form>
                        </li>
                      )
                    }

                    return (
                      <li key={entry.id} className="event-item">
                        <div className="event-row">
                          <div className="event-minute">{entry.minute}&apos;</div>
                          <div className="event-type">
                            {EVENT_OPTIONS.find(option => option.value === entry.eventType)
                              ?.label ?? entry.eventType}
                          </div>
                          <div className="event-team">
                            {entry.teamId === selectedMatch.homeClub.id
                              ? selectedMatch.homeClub.shortName || selectedMatch.homeClub.name
                              : selectedMatch.awayClub.shortName || selectedMatch.awayClub.name}
                          </div>
                          <div className="event-player">
                            {entry.player
                              ? `${entry.player.shirtNumber ? `#${entry.player.shirtNumber}` : '—'} ${`${entry.player.lastName ?? ''} ${entry.player.firstName ?? ''}`.trim()}`.trim()
                              : `ID ${entry.playerId}`}
                          </div>
                          <div className="event-controls">
                            <button
                              className="button-ghost"
                              type="button"
                              onClick={() => beginEditEvent(entry)}
                            >
                              Править
                            </button>
                            <button
                              className="button-danger"
                              type="button"
                              onClick={() => handleDeleteEvent(entry.id)}
                              disabled={isActionBusy}
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

              <article className="judge-card">
                <h2>Заявки команд</h2>
                {isLineupLoading ? <p className="judge-placeholder">Загружаем заявки…</p> : null}
                {!isLineupLoading && lineup.length === 0 ? (
                  <p className="judge-placeholder">Для выбранного матча заявка пока отсутствует.</p>
                ) : null}
                {!isLineupLoading && lineup.length > 0 ? (
                  <div className="judge-lineup-columns">
                    <section>
                      <h3>{selectedMatch.homeClub.name}</h3>
                      {homePlayers.length === 0 ? (
                        <p className="judge-placeholder">Игроки хозяев не найдены.</p>
                      ) : (
                        <ul>
                          {homePlayers.map(entry => (
                            <li key={`home-lineup-${entry.personId}`}>
                              <span className="lineup-number">
                                {entry.shirtNumber ? `#${entry.shirtNumber}` : '—'}
                              </span>
                              <span className="lineup-name">{`${entry.person.lastName} ${entry.person.firstName}`}</span>
                              <span className="lineup-role">
                                {entry.role === 'STARTER' ? 'Старт' : 'Запас'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                    <section>
                      <h3>{selectedMatch.awayClub.name}</h3>
                      {awayPlayers.length === 0 ? (
                        <p className="judge-placeholder">Игроки гостей не найдены.</p>
                      ) : (
                        <ul>
                          {awayPlayers.map(entry => (
                            <li key={`away-lineup-${entry.personId}`}>
                              <span className="lineup-number">
                                {entry.shirtNumber ? `#${entry.shirtNumber}` : '—'}
                              </span>
                              <span className="lineup-name">{`${entry.person.lastName} ${entry.person.firstName}`}</span>
                              <span className="lineup-role">
                                {entry.role === 'STARTER' ? 'Старт' : 'Запас'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  </div>
                ) : null}
              </article>
            </div>
          ) : (
            <div className="judge-placeholder">Выберите матч из списка, чтобы продолжить.</div>
          )}
        </section>
      </div>
    </div>
  )
}
