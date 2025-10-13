import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { adminDelete, adminPost, adminPut } from '../../api/adminClient'
import { useAdminStore } from '../../store/adminStore'
import { Club, ClubPlayerLink, Competition, Person, Stadium } from '../../types'
import { ClubRosterModal } from '../ClubRosterModal'

type FeedbackLevel = 'success' | 'error' | 'info'

type ClubFormState = {
  name: string
  shortName: string
  logoUrl: string
}

type PersonFormState = {
  firstName: string
  lastName: string
  isPlayer: boolean
}

type StadiumFormState = {
  name: string
  city: string
}

type CompetitionFormState = {
  name: string
  type: Competition['type']
  seriesFormat: Competition['seriesFormat']
}

const competitionTypeOptions: Competition['type'][] = ['LEAGUE', 'CUP']

const baseSeriesFormatOptions: Array<Competition['seriesFormat']> = [
  'SINGLE_MATCH',
  'TWO_LEGGED',
  'BEST_OF_N',
  'DOUBLE_ROUND_PLAYOFF',
  'PLAYOFF_BRACKET',
  'GROUP_SINGLE_ROUND_PLAYOFF',
]

const competitionTypeLabels: Record<Competition['type'], string> = {
  LEAGUE: 'Лига',
  CUP: 'Кубок',
}

const seriesFormatLabels: Record<Competition['seriesFormat'], string> = {
  SINGLE_MATCH: 'Один круг (каждый с каждым)',
  TWO_LEGGED: 'Два круга (дом/гости)',
  BEST_OF_N: '1 круг+плей-офф',
  DOUBLE_ROUND_PLAYOFF: '2 круга+плей-офф',
  PLAYOFF_BRACKET: 'Плей-офф сетка (рандом)',
  GROUP_SINGLE_ROUND_PLAYOFF: 'Группы + плей-офф (1 круг)',
}

const getSeriesFormatOptions = (type: Competition['type']): Array<Competition['seriesFormat']> => {
  if (type === 'CUP') {
    return ['GROUP_SINGLE_ROUND_PLAYOFF', 'PLAYOFF_BRACKET']
  }
  return baseSeriesFormatOptions.filter(
    option => option !== 'PLAYOFF_BRACKET' && option !== 'GROUP_SINGLE_ROUND_PLAYOFF'
  )
}

const defaultClubForm: ClubFormState = { name: '', shortName: '', logoUrl: '' }
const defaultPersonForm: PersonFormState = { firstName: '', lastName: '', isPlayer: true }
const defaultStadiumForm: StadiumFormState = { name: '', city: '' }
const defaultCompetitionForm: CompetitionFormState = {
  name: '',
  type: 'LEAGUE',
  seriesFormat: 'SINGLE_MATCH',
}

export const TeamsTab = () => {
  const { token, data, fetchDictionaries, fetchSeasons, loading, error } = useAdminStore(state => ({
    token: state.token,
    data: state.data,
    fetchDictionaries: state.fetchDictionaries,
    fetchSeasons: state.fetchSeasons,
    loading: state.loading,
    error: state.error,
  }))

  const [feedback, setFeedback] = useState<string | null>(null)
  const [feedbackLevel, setFeedbackLevel] = useState<FeedbackLevel>('info')

  const [clubForm, setClubForm] = useState<ClubFormState>(defaultClubForm)
  const [editingClubId, setEditingClubId] = useState<number | null>(null)

  const [personForm, setPersonForm] = useState<PersonFormState>(defaultPersonForm)
  const [editingPersonId, setEditingPersonId] = useState<number | null>(null)
  const [personSearch, setPersonSearch] = useState('')

  const [stadiumForm, setStadiumForm] = useState<StadiumFormState>(defaultStadiumForm)
  const [editingStadiumId, setEditingStadiumId] = useState<number | null>(null)

  const [competitionForm, setCompetitionForm] =
    useState<CompetitionFormState>(defaultCompetitionForm)
  const [editingCompetitionId, setEditingCompetitionId] = useState<number | null>(null)
  const [activeClub, setActiveClub] = useState<Club | null>(null)

  const isLoading = Boolean(loading.dictionaries)

  // Одноразовая инициализация словарей, чтобы не зациклиться на пустой БД
  const bootRef = useRef(false)
  useEffect(() => {
    if (!token || bootRef.current) return
    bootRef.current = true
    void fetchDictionaries().catch(() => undefined)
  }, [token, fetchDictionaries])

  const groupedPersons = useMemo(() => {
    const query = personSearch.trim().toLowerCase()
    const players: Person[] = []
    const staff: Person[] = []
    for (const person of data.persons) {
      const haystack = `${person.lastName} ${person.firstName}`.toLowerCase()
      if (query && !haystack.includes(query)) continue
      if (person.isPlayer) players.push(person)
      else staff.push(person)
    }
    return { players, staff }
  }, [data.persons, personSearch])

  const handleFeedback = (message: string, level: FeedbackLevel) => {
    setFeedback(message)
    setFeedbackLevel(level)
  }

  const runWithRefresh = async (fn: () => Promise<unknown>, successMessage: string) => {
    if (!token) {
      handleFeedback('Нет токена авторизации', 'error')
      return
    }
    try {
      await fn()
      await Promise.all([fetchDictionaries({ force: true }), fetchSeasons({ force: true })])
      handleFeedback(successMessage, 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось выполнить операцию'
      handleFeedback(message, 'error')
    }
  }

  const availableSeriesFormats = useMemo<Array<Competition['seriesFormat']>>(() => {
    return getSeriesFormatOptions(competitionForm.type)
  }, [competitionForm.type])

  useEffect(() => {
    const options = getSeriesFormatOptions(competitionForm.type)
    if (!options.includes(competitionForm.seriesFormat)) {
      setCompetitionForm(form => ({
        ...form,
        seriesFormat: options[0] ?? form.seriesFormat,
      }))
    }
  }, [competitionForm.type, competitionForm.seriesFormat])

  const handleClubSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!clubForm.name || !clubForm.shortName) {
      handleFeedback('Название и короткое имя обязательны', 'error')
      return
    }
    await runWithRefresh(async () => {
      const payload = {
        name: clubForm.name.trim(),
        shortName: clubForm.shortName.trim(),
        logoUrl: clubForm.logoUrl.trim() || undefined,
      }
      if (editingClubId) {
        await adminPut(token, `/api/admin/clubs/${editingClubId}`, payload)
      } else {
        await adminPost(token, '/api/admin/clubs', payload)
      }
    }, 'Клуб сохранён')
    setClubForm(defaultClubForm)
    setEditingClubId(null)
  }

  const handleClubEdit = (club: Club) => {
    setEditingClubId(club.id)
    setClubForm({ name: club.name, shortName: club.shortName, logoUrl: club.logoUrl ?? '' })
  }

  const handleClubDelete = async (club: Club) => {
    await runWithRefresh(async () => {
      await adminDelete(token, `/api/admin/clubs/${club.id}`)
    }, `Клуб «${club.name}» удалён`)
  }

  const handleRosterSaved = (_players: ClubPlayerLink[]) => {
    handleFeedback('Состав клуба обновлён', 'success')
    void Promise.all([fetchDictionaries({ force: true }), fetchSeasons({ force: true })]).catch(
      () => undefined
    )
  }

  const handlePersonSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!personForm.firstName || !personForm.lastName) {
      handleFeedback('Имя и фамилия обязательны', 'error')
      return
    }
    await runWithRefresh(async () => {
      const payload = {
        firstName: personForm.firstName.trim(),
        lastName: personForm.lastName.trim(),
        isPlayer: personForm.isPlayer,
      }
      if (editingPersonId) {
        await adminPut(token, `/api/admin/persons/${editingPersonId}`, payload)
      } else {
        await adminPost(token, '/api/admin/persons', payload)
      }
    }, 'Персона сохранена')
    setPersonForm(defaultPersonForm)
    setEditingPersonId(null)
  }

  const handlePersonEdit = (person: Person) => {
    setEditingPersonId(person.id)
    setPersonForm({
      firstName: person.firstName,
      lastName: person.lastName,
      isPlayer: person.isPlayer,
    })
  }

  const handlePersonDelete = async (person: Person) => {
    await runWithRefresh(async () => {
      await adminDelete(token, `/api/admin/persons/${person.id}`)
    }, `${person.lastName} ${person.firstName} удалён из базы`)
  }

  const handleStadiumSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!stadiumForm.name || !stadiumForm.city) {
      handleFeedback('Название стадиона и город обязательны', 'error')
      return
    }
    await runWithRefresh(async () => {
      const payload = {
        name: stadiumForm.name.trim(),
        city: stadiumForm.city.trim(),
      }
      if (editingStadiumId) {
        await adminPut(token, `/api/admin/stadiums/${editingStadiumId}`, payload)
      } else {
        await adminPost(token, '/api/admin/stadiums', payload)
      }
    }, 'Стадион сохранён')
    setStadiumForm(defaultStadiumForm)
    setEditingStadiumId(null)
  }

  const handleStadiumEdit = (stadium: Stadium) => {
    setEditingStadiumId(stadium.id)
    setStadiumForm({ name: stadium.name, city: stadium.city })
  }

  const handleStadiumDelete = async (stadium: Stadium) => {
    await runWithRefresh(async () => {
      await adminDelete(token, `/api/admin/stadiums/${stadium.id}`)
    }, `Стадион «${stadium.name}» удалён`)
  }

  const handleCompetitionSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!competitionForm.name) {
      handleFeedback('Название соревнования обязательно', 'error')
      return
    }
    await runWithRefresh(async () => {
      const payload = {
        name: competitionForm.name.trim(),
        type: competitionForm.type,
        seriesFormat: competitionForm.seriesFormat,
      }
      if (editingCompetitionId) {
        await adminPut(token, `/api/admin/competitions/${editingCompetitionId}`, payload)
      } else {
        await adminPost(token, '/api/admin/competitions', payload)
      }
    }, 'Соревнование сохранено')
    setCompetitionForm(defaultCompetitionForm)
    setEditingCompetitionId(null)
  }

  const handleCompetitionEdit = (competition: Competition) => {
    setEditingCompetitionId(competition.id)
    setCompetitionForm({
      name: competition.name,
      type: competition.type,
      seriesFormat: competition.seriesFormat,
    })
  }

  const handleCompetitionDelete = async (competition: Competition) => {
    await runWithRefresh(async () => {
      await adminDelete(token, `/api/admin/competitions/${competition.id}`)
    }, `Соревнование «${competition.name}» удалено`)
  }

  return (
    <div className="tab-sections">
      <header className="tab-header">
        <div>
          <h3>Справочники</h3>
          <p>
            Управляйте клубами, людьми, стадионами и соревнованиями. Все изменения немедленно
            отражаются в базе.
          </p>
        </div>
        <button
          className="button-ghost"
          type="button"
          onClick={() => fetchDictionaries({ force: true })}
          disabled={isLoading}
        >
          {isLoading ? 'Обновляем…' : 'Обновить данные'}
        </button>
      </header>
      {feedback ? <div className={`inline-feedback ${feedbackLevel}`}>{feedback}</div> : null}
      {error ? <div className="inline-feedback error">{error}</div> : null}

      <section className="card-grid">
        <article className="card">
          <header>
            <h4>Клубы</h4>
            <p>Добавляйте новые клубы и управляйте атрибутами бренда.</p>
          </header>
          <form className="stacked" onSubmit={handleClubSubmit}>
            <label>
              Название
              <input
                value={clubForm.name}
                onChange={event => setClubForm(form => ({ ...form, name: event.target.value }))}
                required
              />
            </label>
            <label>
              Короткое имя
              <input
                value={clubForm.shortName}
                onChange={event =>
                  setClubForm(form => ({ ...form, shortName: event.target.value }))
                }
                required
              />
            </label>
            <label>
              Логотип (URL)
              <input
                value={clubForm.logoUrl}
                onChange={event => setClubForm(form => ({ ...form, logoUrl: event.target.value }))}
              />
            </label>
            <div className="form-actions">
              <button className="button-primary" type="submit" disabled={isLoading}>
                {editingClubId ? 'Сохранить изменения' : 'Добавить клуб'}
              </button>
              {editingClubId ? (
                <button
                  className="button-secondary"
                  type="button"
                  onClick={() => {
                    setEditingClubId(null)
                    setClubForm(defaultClubForm)
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
                  <th>Название</th>
                  <th>Коротко</th>
                  <th>Логотип</th>
                  <th aria-label="Действия" />
                </tr>
              </thead>
              <tbody>
                {data.clubs.map(club => (
                  <tr key={club.id}>
                    <td>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => setActiveClub(club)}
                      >
                        {club.name}
                      </button>
                    </td>
                    <td>{club.shortName}</td>
                    <td>{club.logoUrl ? <a href={club.logoUrl}>Ссылка</a> : '—'}</td>
                    <td className="table-actions">
                      <button type="button" onClick={() => handleClubEdit(club)}>
                        Изм.
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => handleClubDelete(club)}
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

        <article className="card">
          <header>
            <h4>Персоны</h4>
            <p>Игроки и тренеры используются в ростерах и событиях матчей.</p>
          </header>
          <form className="stacked" onSubmit={handlePersonSubmit}>
            <label>
              Имя
              <input
                value={personForm.firstName}
                onChange={event =>
                  setPersonForm(form => ({ ...form, firstName: event.target.value }))
                }
                required
              />
            </label>
            <label>
              Фамилия
              <input
                value={personForm.lastName}
                onChange={event =>
                  setPersonForm(form => ({ ...form, lastName: event.target.value }))
                }
                required
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={personForm.isPlayer}
                onChange={event =>
                  setPersonForm(form => ({ ...form, isPlayer: event.target.checked }))
                }
              />
              Игрок
            </label>
            <div className="form-actions">
              <button className="button-primary" type="submit" disabled={isLoading}>
                {editingPersonId ? 'Сохранить' : 'Добавить персону'}
              </button>
              {editingPersonId ? (
                <button
                  className="button-secondary"
                  type="button"
                  onClick={() => {
                    setEditingPersonId(null)
                    setPersonForm(defaultPersonForm)
                  }}
                >
                  Отмена
                </button>
              ) : null}
            </div>
          </form>
          <div className="stacked person-search">
            <label>
              Поиск по базе
              <input
                value={personSearch}
                onChange={event => setPersonSearch(event.target.value)}
                placeholder="Введите фамилию или имя"
              />
            </label>
            <p className="muted">
              Найдено {groupedPersons.players.length + groupedPersons.staff.length} записей
            </p>
          </div>
          <div className="split-columns">
            <div>
              <h5>Игроки ({groupedPersons.players.length})</h5>
              <ul className="list">
                {groupedPersons.players.map(person => (
                  <li key={person.id}>
                    <span>
                      {person.lastName} {person.firstName}
                    </span>
                    <span className="list-actions">
                      <button type="button" onClick={() => handlePersonEdit(person)}>
                        Изм.
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => handlePersonDelete(person)}
                      >
                        Удал.
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h5>Тренеры и персонал ({groupedPersons.staff.length})</h5>
              <ul className="list">
                {groupedPersons.staff.map(person => (
                  <li key={person.id}>
                    <span>
                      {person.lastName} {person.firstName}
                    </span>
                    <span className="list-actions">
                      <button type="button" onClick={() => handlePersonEdit(person)}>
                        Изм.
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => handlePersonDelete(person)}
                      >
                        Удал.
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </article>

        <article className="card">
          <header>
            <h4>Стадионы</h4>
            <p>Основные площадки для календаря матчей.</p>
          </header>
          <form className="stacked" onSubmit={handleStadiumSubmit}>
            <label>
              Название
              <input
                value={stadiumForm.name}
                onChange={event => setStadiumForm(form => ({ ...form, name: event.target.value }))}
                required
              />
            </label>
            <label>
              Город
              <input
                value={stadiumForm.city}
                onChange={event => setStadiumForm(form => ({ ...form, city: event.target.value }))}
                required
              />
            </label>
            <div className="form-actions">
              <button className="button-primary" type="submit" disabled={isLoading}>
                {editingStadiumId ? 'Сохранить' : 'Добавить стадион'}
              </button>
              {editingStadiumId ? (
                <button
                  className="button-secondary"
                  type="button"
                  onClick={() => {
                    setEditingStadiumId(null)
                    setStadiumForm(defaultStadiumForm)
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
                  <th>Стадион</th>
                  <th>Город</th>
                  <th aria-label="Действия" />
                </tr>
              </thead>
              <tbody>
                {data.stadiums.map(stadium => (
                  <tr key={stadium.id}>
                    <td>{stadium.name}</td>
                    <td>{stadium.city}</td>
                    <td className="table-actions">
                      <button type="button" onClick={() => handleStadiumEdit(stadium)}>
                        Изм.
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => handleStadiumDelete(stadium)}
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

        <article className="card">
          <header>
            <h4>Соревнования</h4>
            <p>Определяйте структуру турнира и формат серий плей-офф.</p>
          </header>
          <form className="stacked" onSubmit={handleCompetitionSubmit}>
            <label>
              Название
              <input
                value={competitionForm.name}
                onChange={event =>
                  setCompetitionForm(form => ({ ...form, name: event.target.value }))
                }
                required
              />
            </label>
            <label>
              Тип
              <select
                value={competitionForm.type}
                onChange={event =>
                  setCompetitionForm(form => ({
                    ...form,
                    type: event.target.value as Competition['type'],
                  }))
                }
              >
                {competitionTypeOptions.map(option => (
                  <option key={option} value={option}>
                    {competitionTypeLabels[option]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Формат серий
              <select
                value={competitionForm.seriesFormat}
                onChange={event =>
                  setCompetitionForm(form => ({
                    ...form,
                    seriesFormat: event.target.value as Competition['seriesFormat'],
                  }))
                }
              >
                {availableSeriesFormats.map((option: Competition['seriesFormat']) => (
                  <option key={option} value={option}>
                    {seriesFormatLabels[option]}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-actions">
              <button className="button-primary" type="submit" disabled={isLoading}>
                {editingCompetitionId ? 'Сохранить' : 'Добавить соревнование'}
              </button>
              {editingCompetitionId ? (
                <button
                  className="button-secondary"
                  type="button"
                  onClick={() => {
                    setEditingCompetitionId(null)
                    setCompetitionForm(defaultCompetitionForm)
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
                  <th>Название</th>
                  <th>Тип</th>
                  <th>Формат</th>
                  <th aria-label="Действия" />
                </tr>
              </thead>
              <tbody>
                {data.competitions.map(competition => (
                  <tr key={competition.id}>
                    <td>{competition.name}</td>
                    <td>{competitionTypeLabels[competition.type]}</td>
                    <td>{seriesFormatLabels[competition.seriesFormat]}</td>
                    <td className="table-actions">
                      <button type="button" onClick={() => handleCompetitionEdit(competition)}>
                        Изм.
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => handleCompetitionDelete(competition)}
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
      </section>
      {activeClub ? (
        <ClubRosterModal
          club={activeClub}
          token={token}
          onClose={() => setActiveClub(null)}
          onSaved={players => {
            handleRosterSaved(players)
            setActiveClub(null)
          }}
        />
      ) : null}
    </div>
  )
}
