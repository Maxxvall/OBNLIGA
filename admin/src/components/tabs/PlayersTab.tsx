import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  adminDelete,
  adminPost,
  adminPut,
  applyPlayerTransfers,
  fetchClubPlayers,
  PlayerTransferInput,
} from '../../api/adminClient'
import { useAdminStore } from '../../store/adminStore'
import { Club, Disqualification, Person, Season } from '../../types'

type EditPersonFormState = {
  id: number | ''
  firstName: string
  lastName: string
  isPlayer: boolean
  transferSeasonId: number | ''
  transferFromClubId: number | ''
  transferClubId: number | ''
}

type DisqualificationFormState = {
  personId: number | ''
  clubId: number | ''
  reason: Disqualification['reason']
  banDurationMatches: number | ''
  sanctionDate: string
}

type FeedbackLevel = 'success' | 'error' | 'info'

type TransferDraft = {
  id: string
  payload: PlayerTransferInput
  person: Person
  fromClub: Club | null
  toClub: Club
  season: Season
}

const defaultEditPersonForm: EditPersonFormState = {
  id: '',
  firstName: '',
  lastName: '',
  isPlayer: true,
  transferSeasonId: '',
  transferFromClubId: '',
  transferClubId: '',
}

const defaultDisqualificationForm: DisqualificationFormState = {
  personId: '',
  clubId: '',
  reason: 'RED_CARD',
  banDurationMatches: '',
  sanctionDate: new Date().toISOString().slice(0, 10),
}

const formatDisqualificationReason = (reason: Disqualification['reason']) => {
  switch (reason) {
    case 'RED_CARD':
      return 'Красная карточка'
    case 'SECOND_YELLOW':
      return 'Вторая жёлтая'
    case 'ACCUMULATED_CARDS':
      return 'Накопление карточек'
    default:
      return 'Другое'
  }
}

export const PlayersTab = () => {
  const {
    token,
    data,
    selectedSeasonId,
    fetchDictionaries,
    fetchDisqualifications,
    fetchSeasons,
    loading,
    error,
  } = useAdminStore(state => ({
    token: state.token,
    data: state.data,
    selectedSeasonId: state.selectedSeasonId,
    fetchDictionaries: state.fetchDictionaries,
    fetchDisqualifications: state.fetchDisqualifications,
    fetchSeasons: state.fetchSeasons,
    loading: state.loading,
    error: state.error,
  }))

  const [editPersonForm, setEditPersonForm] = useState<EditPersonFormState>(defaultEditPersonForm)
  const [disqualificationForm, setDisqualificationForm] = useState<DisqualificationFormState>(
    defaultDisqualificationForm
  )
  const [feedback, setFeedback] = useState<string | null>(null)
  const [feedbackLevel, setFeedbackLevel] = useState<FeedbackLevel>('info')
  const [filter, setFilter] = useState('')
  const [showPlayersOnly, setShowPlayersOnly] = useState<boolean>(true)
  const [clubPlayers, setClubPlayers] = useState<Person[]>([])
  const [clubPlayersLoading, setClubPlayersLoading] = useState(false)
  const [transferDrafts, setTransferDrafts] = useState<TransferDraft[]>([])
  const transferCounterRef = useRef(0)
  const [transferProcessing, setTransferProcessing] = useState(false)

  const isLoading = Boolean(loading.dictionaries || loading.disqualifications || loading.seasons)

  // Одноразовая инициализация словарей и дисквалификаций
  const bootRef = useRef(false)
  const clubPlayersCacheRef = useRef<Map<number, Person[]>>(new Map())
  useEffect(() => {
    if (!token || bootRef.current) return
    bootRef.current = true
    void fetchDictionaries().catch(() => undefined)
    void fetchDisqualifications().catch(() => undefined)
    void fetchSeasons().catch(() => undefined)
  }, [token, fetchDictionaries, fetchDisqualifications, fetchSeasons])

  useEffect(() => {
    if (editPersonForm.transferSeasonId || !data.seasons.length) return
    const preferredSeason =
      (selectedSeasonId && data.seasons.find(season => season.id === selectedSeasonId)) ||
      data.seasons.find(season => season.isActive) ||
      data.seasons[0]
    if (preferredSeason) {
      setEditPersonForm(form => ({ ...form, transferSeasonId: preferredSeason.id }))
    }
  }, [data.seasons, editPersonForm.transferSeasonId, selectedSeasonId])

  useEffect(() => {
    const clubId =
      typeof disqualificationForm.clubId === 'number' ? disqualificationForm.clubId : undefined
    if (!clubId) {
      setClubPlayers([])
      setClubPlayersLoading(false)
      return
    }

    const cached = clubPlayersCacheRef.current.get(clubId)
    if (cached) {
      setClubPlayers(cached)
      setClubPlayersLoading(false)
      return
    }

    let cancelled = false
    setClubPlayersLoading(true)
    setClubPlayers([])

    const load = async () => {
      try {
        const data = await fetchClubPlayers(token, clubId)
        if (cancelled) return
        const players = data.map(entry => entry.person).filter(person => person.isPlayer)
        clubPlayersCacheRef.current.set(clubId, players)
        setClubPlayers(players)
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Не удалось загрузить список игроков'
        handleFeedback(message, 'error')
      } finally {
        if (!cancelled) {
          setClubPlayersLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [disqualificationForm.clubId, token])

  const handleFeedback = (message: string, level: FeedbackLevel = 'info') => {
    setFeedback(message)
    setFeedbackLevel(level)
  }

  const handleAddTransferDraft = () => {
    if (!editPersonForm.id) {
      handleFeedback('Выберите игрока для перехода', 'error')
      return
    }
    if (!editPersonForm.transferSeasonId || typeof editPersonForm.transferSeasonId !== 'number') {
      handleFeedback('Выберите сезон для перехода', 'error')
      return
    }
    const transferSeason = data.seasons.find(season => season.id === editPersonForm.transferSeasonId)
    if (!transferSeason) {
      handleFeedback('Сезон недоступен для перехода', 'error')
      return
    }

    const seasonClubIds = new Set(seasonClubs.map(club => club.id))
    const targetClubId =
      typeof editPersonForm.transferClubId === 'number' ? editPersonForm.transferClubId : null
    if (!targetClubId) {
      handleFeedback('Выберите клуб для перехода', 'error')
      return
    }
    if (!seasonClubIds.has(targetClubId)) {
      handleFeedback('Клуб не участвует в выбранном сезоне', 'error')
      return
    }

    const person = data.persons.find(item => item.id === editPersonForm.id)
    if (!person) {
      handleFeedback('Выбранный игрок не найден', 'error')
      return
    }

    const toClub =
      seasonClubs.find(club => club.id === targetClubId) ||
      data.clubs.find(club => club.id === targetClubId)
    if (!toClub) {
      handleFeedback('Клуб для перехода не найден', 'error')
      return
    }

    const selectedFromClubId =
      typeof editPersonForm.transferFromClubId === 'number' ? editPersonForm.transferFromClubId : null
    const fromClub =
      selectedFromClubId && seasonClubIds.has(selectedFromClubId)
        ? seasonClubs.find(club => club.id === selectedFromClubId) ?? null
        : null
    if (fromClub && fromClub.id === toClub.id) {
      handleFeedback('Игрок уже закреплён за выбранным клубом', 'error')
      return
    }

    const payload: PlayerTransferInput = {
      personId: person.id,
      toClubId: toClub.id,
      fromClubId: fromClub?.id ?? null,
    }

    setTransferDrafts(previous => {
      const filtered = previous.filter(draft => draft.payload.personId !== person.id)
      transferCounterRef.current += 1
      const draftId = `transfer-${transferCounterRef.current}-${person.id}`
      return [
        ...filtered,
        {
          id: draftId,
          payload,
          person,
          fromClub,
          toClub,
          season: transferSeason,
        },
      ]
    })
    setEditPersonForm(form => ({ ...form, transferClubId: '', transferFromClubId: '' }))
    handleFeedback('Переход добавлен в список', 'success')
  }

  const handleRemoveDraft = (draftId: string) => {
    setTransferDrafts(previous => previous.filter(draft => draft.id !== draftId))
  }

  const handleApplyTransfers = async () => {
    if (!transferDrafts.length) {
      handleFeedback('Список переходов пуст', 'info')
      return
    }
    setTransferProcessing(true)
    try {
      const payload = { transfers: transferDrafts.map(draft => draft.payload) }
      const result = await applyPlayerTransfers(token, payload)
      let message: string
      if (result.movedCount) {
        const base = `Трансферы зафиксированы: ${result.movedCount}`
        message = result.news?.title ? `${base}. Новость: «${result.news.title}».` : base
      } else {
        message = 'Изменений не обнаружено'
      }
      handleFeedback(message, result.movedCount ? 'success' : 'info')
      setTransferDrafts([])
      transferCounterRef.current = 0
      clubPlayersCacheRef.current.clear()
      setClubPlayers([])
      await Promise.all([fetchDictionaries({ force: true }), fetchDisqualifications()])
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось зафиксировать трансферы'
      handleFeedback(message, 'error')
    } finally {
      setTransferProcessing(false)
    }
  }

  const filteredPersons = useMemo(() => {
    return data.persons.filter(person => {
      if (showPlayersOnly && !person.isPlayer) return false
      if (!filter) return true
      const target = `${person.lastName} ${person.firstName}`.toLowerCase()
      return target.includes(filter.toLowerCase())
    })
  }, [data.persons, filter, showPlayersOnly])

  const limitedPersons = useMemo(() => filteredPersons.slice(0, 5), [filteredPersons])
  const hasMorePersons = filteredPersons.length > limitedPersons.length
  const selectedPerson = useMemo(
    () =>
      typeof editPersonForm.id === 'number'
        ? data.persons.find(item => item.id === editPersonForm.id)
        : undefined,
    [data.persons, editPersonForm.id]
  )

  const selectedSeason = useMemo<Season | undefined>(
    () =>
      typeof editPersonForm.transferSeasonId === 'number'
        ? data.seasons.find(season => season.id === editPersonForm.transferSeasonId)
        : undefined,
    [data.seasons, editPersonForm.transferSeasonId]
  )

  const seasonClubs = useMemo(() => {
    if (!selectedSeason?.participants?.length) {
      return data.clubs
    }
    const seen = new Set<number>()
    const clubs: Club[] = []
    selectedSeason.participants.forEach(participant => {
      const club = participant.club ?? data.clubs.find(entry => entry.id === participant.clubId)
      if (club && !seen.has(club.id)) {
        seen.add(club.id)
        clubs.push(club)
      }
    })
    return clubs.length ? clubs : data.clubs
  }, [data.clubs, selectedSeason])

  const personSeasonClubs = useMemo(() => {
    const allowed = new Set(seasonClubs.map(club => club.id))
    const clubs: Club[] = []
    const pushClub = (club?: Club | null) => {
      if (club && allowed.has(club.id) && !clubs.some(item => item.id === club.id)) {
        clubs.push(club)
      }
    }
    if (selectedPerson) {
      pushClub(selectedPerson.currentClub)
      selectedPerson.clubs?.forEach(pushClub)
    }
    return clubs
  }, [seasonClubs, selectedPerson])

  const handlePersonEditSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editPersonForm.id) {
      handleFeedback('Выберите игрока для редактирования', 'error')
      return
    }
    try {
      await adminPut(token, `/api/admin/persons/${editPersonForm.id}`, {
        firstName: editPersonForm.firstName.trim() || undefined,
        lastName: editPersonForm.lastName.trim() || undefined,
        isPlayer: editPersonForm.isPlayer,
      })
      handleFeedback('Данные игрока обновлены', 'success')
      setEditPersonForm(defaultEditPersonForm)
      await fetchDictionaries({ force: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось обновить запись'
      handleFeedback(message, 'error')
    }
  }

  const handlePersonDelete = async (person: Person) => {
    if (!window.confirm(`Удалить ${person.lastName} ${person.firstName}?`)) return
    try {
      await adminDelete(token, `/api/admin/persons/${person.id}`)
      handleFeedback('Игрок удалён', 'success')
      await fetchDictionaries({ force: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось удалить запись'
      handleFeedback(message, 'error')
    }
  }

  const handleSelectPersonToEdit = (personId: number) => {
    const person = data.persons.find(item => item.id === personId)
    if (!person) return
    const nextSeasonId =
      editPersonForm.transferSeasonId ||
      selectedSeasonId ||
      data.seasons.find(season => season.isActive)?.id ||
      data.seasons[0]?.id ||
      ''
    const seasonForSelection =
      typeof nextSeasonId === 'number'
        ? data.seasons.find(season => season.id === nextSeasonId)
        : undefined
    const seasonClubsForSelection = (() => {
      if (seasonForSelection?.participants?.length) {
        const seen = new Set<number>()
        const clubs: Club[] = []
        seasonForSelection.participants.forEach(participant => {
          const club = participant.club ?? data.clubs.find(entry => entry.id === participant.clubId)
          if (club && !seen.has(club.id)) {
            seen.add(club.id)
            clubs.push(club)
          }
        })
        if (clubs.length) {
          return clubs
        }
      }
      return data.clubs
    })()
    const allowedIds = new Set(seasonClubsForSelection.map(club => club.id))
    const currentClubIdCandidate =
      person.currentClub && allowedIds.has(person.currentClub.id) ? person.currentClub.id : ''
    setEditPersonForm({
      id: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      isPlayer: person.isPlayer,
      transferSeasonId: nextSeasonId,
      transferFromClubId: currentClubIdCandidate,
      transferClubId: '',
    })
  }

  const handleDisqualificationSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const clubId =
      typeof disqualificationForm.clubId === 'number' ? disqualificationForm.clubId : undefined
    if (!clubId || !disqualificationForm.personId || !disqualificationForm.banDurationMatches) {
      handleFeedback('Выберите клуб, игрока и срок дисквалификации', 'error')
      return
    }
    try {
      await adminPost(token, '/api/admin/disqualifications', {
        personId: disqualificationForm.personId,
        clubId,
        reason: disqualificationForm.reason,
        banDurationMatches: Number(disqualificationForm.banDurationMatches),
        sanctionDate: disqualificationForm.sanctionDate,
      })
      handleFeedback('Дисквалификация создана', 'success')
      setDisqualificationForm(defaultDisqualificationForm)
      await fetchDisqualifications()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось создать дисквалификацию'
      handleFeedback(message, 'error')
    }
  }

  const handleDisqualificationUpdate = async (
    entry: Disqualification,
    updates: Partial<Disqualification>
  ) => {
    try {
      await adminPut(token, `/api/admin/disqualifications/${entry.id}`, updates)
      handleFeedback('Запись обновлена', 'success')
      await fetchDisqualifications()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось обновить запись'
      handleFeedback(message, 'error')
    }
  }

  const handleDisqualificationDelete = async (entry: Disqualification) => {
    if (!window.confirm('Удалить запись о дисквалификации?')) return
    try {
      await adminDelete(token, `/api/admin/disqualifications/${entry.id}`)
      handleFeedback('Запись удалена', 'success')
      await fetchDisqualifications()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось удалить запись'
      handleFeedback(message, 'error')
    }
  }

  const activeDisqualifications = data.disqualifications.filter(entry => entry.isActive)
  const historyDisqualifications = data.disqualifications.filter(entry => !entry.isActive)

  return (
    <div className="tab-sections">
      <header className="tab-header">
        <div>
          <h3>Игроки и дисциплина</h3>
          <p>Создавайте игроков, обновляйте роли и отслеживайте дисквалификации.</p>
        </div>
        <button
          className="button-ghost"
          type="button"
          disabled={isLoading}
          onClick={() =>
            Promise.all([fetchDictionaries({ force: true }), fetchDisqualifications()])
          }
        >
          {isLoading ? 'Обновляем…' : 'Обновить данные'}
        </button>
      </header>
      {feedback ? <div className={`inline-feedback ${feedbackLevel}`}>{feedback}</div> : null}
      {error ? <div className="inline-feedback error">{error}</div> : null}

      <section className="card-grid">
        <article className="card">
          <header>
            <h4>Список переходов</h4>
            <p>Добавляйте игроков через форму редактирования и фиксируйте изменения разом.</p>
          </header>
          {transferDrafts.length ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Игрок</th>
                  <th>Сезон</th>
                  <th>Было</th>
                  <th>Станет</th>
                  <th aria-label="Действия" />
                </tr>
              </thead>
              <tbody>
                {transferDrafts.map(draft => (
                  <tr key={draft.id}>
                    <td>
                      {draft.person.lastName} {draft.person.firstName}
                    </td>
                    <td>{draft.season?.name ?? '—'}</td>
                    <td>{draft.fromClub ? draft.fromClub.name : 'Свободный агент'}</td>
                    <td>{draft.toClub.name}</td>
                    <td className="table-actions">
                      <button
                        type="button"
                        onClick={() => handleRemoveDraft(draft.id)}
                        disabled={transferProcessing}
                      >
                        Удалить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">
              Список пуст. Выберите игрока, задайте клуб перехода и добавьте запись.
            </p>
          )}
          <div className="form-actions">
            <button
              className="button-primary"
              type="button"
              onClick={handleApplyTransfers}
              disabled={!transferDrafts.length || transferProcessing}
            >
              {transferProcessing ? 'Фиксируем…' : 'Зафиксировать трансферы'}
            </button>
            <button
              className="button-secondary"
              type="button"
              onClick={() => setTransferDrafts([])}
              disabled={!transferDrafts.length || transferProcessing}
            >
              Очистить список
            </button>
          </div>
        </article>

        <article className="card">
          <header>
            <h4>Редактировать игрока</h4>
            <p>Выберите запись из справочника для изменения.</p>
          </header>
          <form className="stacked" onSubmit={handlePersonEditSubmit}>
            <label>
              Игрок
              <select
                value={editPersonForm.id}
                onChange={event => {
                  const value = event.target.value ? Number(event.target.value) : ''
                  setEditPersonForm(form => ({ ...form, id: value }))
                  if (value) handleSelectPersonToEdit(Number(value))
                }}
              >
                <option value="">—</option>
                {data.persons.map(person => (
                  <option key={person.id} value={person.id}>
                    {person.lastName} {person.firstName}
                  </option>
                ))}
              </select>
            </label>
            {selectedPerson ? (
              <p className="muted">
                Текущий клуб:{' '}
                {selectedPerson.currentClub ? selectedPerson.currentClub.name : 'Свободный агент'}
              </p>
            ) : null}
            <label>
              Сезон
              <select
                value={editPersonForm.transferSeasonId}
                onChange={event => {
                  const value = event.target.value ? Number(event.target.value) : ''
                  setEditPersonForm(form => ({
                    ...form,
                    transferSeasonId: value,
                    transferClubId: '',
                    transferFromClubId: '',
                  }))
                }}
              >
                <option value="">—</option>
                {data.seasons.map(season => (
                  <option key={season.id} value={season.id}>
                    {season.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Текущий клуб
              <select
                value={editPersonForm.transferFromClubId}
                onChange={event => {
                  const value = event.target.value ? Number(event.target.value) : ''
                  setEditPersonForm(form => ({ ...form, transferFromClubId: value }))
                }}
              >
                <option value="">Свободный агент</option>
                {personSeasonClubs.map(club => (
                  <option key={club.id} value={club.id}>
                    {club.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Клуб перехода
              <select
                value={editPersonForm.transferClubId}
                onChange={event => {
                  const value = event.target.value ? Number(event.target.value) : ''
                  setEditPersonForm(form => ({ ...form, transferClubId: value }))
                }}
              >
                <option value="">—</option>
                {seasonClubs.map(club => (
                  <option key={club.id} value={club.id}>
                    {club.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Фамилия
              <input
                value={editPersonForm.lastName}
                onChange={event =>
                  setEditPersonForm(form => ({ ...form, lastName: event.target.value }))
                }
              />
            </label>
            <label>
              Имя
              <input
                value={editPersonForm.firstName}
                onChange={event =>
                  setEditPersonForm(form => ({ ...form, firstName: event.target.value }))
                }
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={editPersonForm.isPlayer}
                onChange={event =>
                  setEditPersonForm(form => ({ ...form, isPlayer: event.target.checked }))
                }
              />
              Игрок
            </label>
            <div className="form-actions">
              <button
                className="button-primary"
                type="button"
                onClick={handleAddTransferDraft}
                disabled={
                  !editPersonForm.id ||
                  !editPersonForm.transferClubId ||
                  !editPersonForm.transferSeasonId ||
                  transferProcessing
                }
              >
                Добавить в список
              </button>
              <button className="button-secondary" type="submit" disabled={!editPersonForm.id}>
                Сохранить профиль
              </button>
              <button
                className="button-ghost"
                type="button"
                onClick={() => setEditPersonForm(defaultEditPersonForm)}
                disabled={!editPersonForm.id}
              >
                Очистить
              </button>
            </div>
          </form>
        </article>

        <article className="card">
          <header>
            <h4>Дисквалификации</h4>
            <p>Создавайте и управляйте активными санкциями.</p>
          </header>
          <form className="stacked" onSubmit={handleDisqualificationSubmit}>
            <label>
              Клуб
              <select
                value={disqualificationForm.clubId}
                onChange={event => {
                  const value = event.target.value ? Number(event.target.value) : ''
                  setFeedback(null)
                  setDisqualificationForm(form => ({ ...form, clubId: value, personId: '' }))
                }}
                required
              >
                <option value="">Выберите клуб</option>
                {data.clubs.map(club => (
                  <option key={club.id} value={club.id}>
                    {club.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Игрок
              <select
                value={disqualificationForm.personId}
                onChange={event =>
                  setDisqualificationForm(form => ({
                    ...form,
                    personId: event.target.value ? Number(event.target.value) : '',
                  }))
                }
                disabled={clubPlayersLoading || !disqualificationForm.clubId}
                required
              >
                <option value="">
                  {clubPlayersLoading
                    ? 'Загружаем…'
                    : disqualificationForm.clubId
                      ? 'Выберите игрока'
                      : 'Сначала выберите клуб'}
                </option>
                {clubPlayers.map(person => (
                  <option key={person.id} value={person.id}>
                    {person.lastName} {person.firstName}
                  </option>
                ))}
              </select>
            </label>
            {!clubPlayersLoading && disqualificationForm.clubId && !clubPlayers.length ? (
              <p className="muted">В выбранном клубе пока нет заявленных игроков.</p>
            ) : null}
            <label>
              Причина
              <select
                value={disqualificationForm.reason}
                onChange={event =>
                  setDisqualificationForm(form => ({
                    ...form,
                    reason: event.target.value as Disqualification['reason'],
                  }))
                }
              >
                <option value="RED_CARD">Красная карточка</option>
                <option value="ACCUMULATED_CARDS">Накопление карточек</option>
                <option value="OTHER">Другое</option>
              </select>
            </label>
            <label>
              Дата
              <input
                type="date"
                value={disqualificationForm.sanctionDate}
                onChange={event =>
                  setDisqualificationForm(form => ({ ...form, sanctionDate: event.target.value }))
                }
                required
              />
            </label>
            <label>
              Матчей пропустить
              <input
                type="number"
                min={1}
                value={disqualificationForm.banDurationMatches}
                onChange={event =>
                  setDisqualificationForm(form => ({
                    ...form,
                    banDurationMatches: event.target.value ? Number(event.target.value) : '',
                  }))
                }
                required
              />
            </label>
            <button className="button-primary" type="submit">
              Создать запись
            </button>
          </form>
        </article>
      </section>

      <section className="card" style={{ gridColumn: '1 / -1' }}>
        <header>
          <h4>Справочник персон</h4>
          <p>Быстрый поиск по размерам базы, переключайте фильтры для роли.</p>
        </header>
        <div className="toolbar">
          <label>
            <input
              type="search"
              placeholder="Поиск"
              value={filter}
              onChange={event => setFilter(event.target.value)}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={showPlayersOnly}
              onChange={event => setShowPlayersOnly(event.target.checked)}
            />
            Только игроки
          </label>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Фамилия</th>
              <th>Имя</th>
              <th>Роль</th>
              <th>Клуб</th>
              <th aria-label="Действия" />
            </tr>
          </thead>
          <tbody>
            {limitedPersons.map(person => (
              <tr key={person.id}>
                <td>{person.lastName}</td>
                <td>{person.firstName}</td>
                <td>{person.isPlayer ? 'Игрок' : 'Персонал'}</td>
                <td>{person.currentClub ? person.currentClub.name : 'Свободный агент'}</td>
                <td className="table-actions">
                  <button type="button" onClick={() => handleSelectPersonToEdit(person.id)}>
                    Изм.
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => handlePersonDelete(person)}
                  >
                    Удал.
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filteredPersons.length ? <p className="muted">Список пуст.</p> : null}
        {hasMorePersons ? (
          <p className="muted">Показаны первые 5 записей, уточните поиск.</p>
        ) : null}
      </section>

      <section className="card" style={{ gridColumn: '1 / -1' }}>
        <header>
          <h4>Активные дисквалификации</h4>
          <p>Обновляйте количество пропущенных матчей и закрывайте санкции.</p>
        </header>
        <table className="data-table">
          <thead>
            <tr>
              <th>Игрок</th>
              <th>Клуб</th>
              <th>Причина</th>
              <th>Срок</th>
              <th>Отбыто</th>
              <th>Осталось</th>
              <th aria-label="Действия" />
            </tr>
          </thead>
          <tbody>
            {activeDisqualifications.map(entry => (
              <tr key={entry.id}>
                <td>
                  {entry.person.lastName} {entry.person.firstName}
                </td>
                <td>{entry.club?.name ?? '—'}</td>
                <td>{formatDisqualificationReason(entry.reason)}</td>
                <td>{entry.banDurationMatches}</td>
                <td>{entry.matchesMissed}</td>
                <td>{entry.matchesRemaining}</td>
                <td className="table-actions">
                  <button
                    type="button"
                    onClick={() =>
                      handleDisqualificationUpdate(entry, {
                        matchesMissed: entry.matchesMissed + 1,
                        isActive: entry.matchesMissed + 1 < entry.banDurationMatches,
                      })
                    }
                    disabled={entry.matchesRemaining <= 0}
                  >
                    +1 матч
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDisqualificationUpdate(entry, { isActive: false })}
                  >
                    Снять
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => handleDisqualificationDelete(entry)}
                  >
                    Удал.
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!activeDisqualifications.length ? (
          <p className="muted">Активных дисквалификаций нет.</p>
        ) : null}
      </section>

      <section className="card" style={{ gridColumn: '1 / -1' }}>
        <header>
          <h4>История дисквалификаций</h4>
          <p>В архиве показываются завершённые санкции.</p>
        </header>
        <table className="data-table">
          <thead>
            <tr>
              <th>Игрок</th>
              <th>Клуб</th>
              <th>Причина</th>
              <th>Срок</th>
              <th>Отбыто</th>
              <th aria-label="Действия" />
            </tr>
          </thead>
          <tbody>
            {historyDisqualifications.map(entry => (
              <tr key={entry.id}>
                <td>
                  {entry.person.lastName} {entry.person.firstName}
                </td>
                <td>{entry.club?.name ?? '—'}</td>
                <td>{formatDisqualificationReason(entry.reason)}</td>
                <td>{entry.banDurationMatches}</td>
                <td>{entry.matchesMissed}</td>
                <td className="table-actions">
                  <button
                    type="button"
                    className="danger"
                    onClick={() => handleDisqualificationDelete(entry)}
                  >
                    Удал.
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!historyDisqualifications.length ? <p className="muted">История пуста.</p> : null}
      </section>
    </div>
  )
}
