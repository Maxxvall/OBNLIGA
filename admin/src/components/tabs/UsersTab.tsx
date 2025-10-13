import { FormEvent, useEffect, useMemo, useState } from 'react'
import { adminDelete, adminPost, adminPut } from '../../api/adminClient'
import { useAdminStore } from '../../store/adminStore'
import { AchievementType, Prediction } from '../../types'

type UserEditFormState = {
  id: number | ''
  firstName: string
  currentStreak: number | ''
  totalPredictions: number | ''
}

type AchievementFormState = {
  name: string
  description: string
  requiredValue: number | ''
  metric: AchievementType['metric']
}

type AchievementEditFormState = AchievementFormState & { id: number | '' }

type PredictionEditState = {
  pointsAwarded: number | ''
  isCorrect: boolean | null
}

type FeedbackLevel = 'success' | 'error' | 'info'

const defaultUserForm: UserEditFormState = {
  id: '',
  firstName: '',
  currentStreak: '',
  totalPredictions: '',
}

const defaultAchievementForm: AchievementFormState = {
  name: '',
  description: '',
  requiredValue: '',
  metric: 'TOTAL_PREDICTIONS',
}

const defaultAchievementEditForm: AchievementEditFormState = {
  id: '',
  ...defaultAchievementForm,
}

const metricLabels: Record<AchievementType['metric'], string> = {
  DAILY_LOGIN: 'Ежедневная активность',
  TOTAL_PREDICTIONS: 'Общее число прогнозов',
  CORRECT_PREDICTIONS: 'Удачные прогнозы',
}

export const UsersTab = () => {
  const { token, data, fetchUsers, fetchPredictions, fetchAchievements, loading, error } =
    useAdminStore(state => ({
      token: state.token,
      data: state.data,
      fetchUsers: state.fetchUsers,
      fetchPredictions: state.fetchPredictions,
      fetchAchievements: state.fetchAchievements,
      loading: state.loading,
      error: state.error,
    }))

  const [userForm, setUserForm] = useState<UserEditFormState>(defaultUserForm)
  const [achievementForm, setAchievementForm] =
    useState<AchievementFormState>(defaultAchievementForm)
  const [achievementEditForm, setAchievementEditForm] = useState<AchievementEditFormState>(
    defaultAchievementEditForm
  )
  const [feedback, setFeedback] = useState<string | null>(null)
  const [feedbackLevel, setFeedbackLevel] = useState<FeedbackLevel>('info')
  const [userFilter, setUserFilter] = useState('')
  const [predictionEdits, setPredictionEdits] = useState<Record<string, PredictionEditState>>({})

  const isLoading = Boolean(loading.users || loading.predictions || loading.achievements)

  useEffect(() => {
    if (!token) return
    if (!data.users.length) void fetchUsers().catch(() => undefined)
    if (!data.predictions.length) void fetchPredictions().catch(() => undefined)
    if (!data.achievementTypes.length || !data.userAchievements.length) {
      void fetchAchievements().catch(() => undefined)
    }
  }, [
    token,
    data.users.length,
    data.predictions.length,
    data.achievementTypes.length,
    data.userAchievements.length,
    fetchUsers,
    fetchPredictions,
    fetchAchievements,
  ])

  const handleFeedback = (message: string, level: FeedbackLevel) => {
    setFeedback(message)
    setFeedbackLevel(level)
  }

  const selectUser = (userId: number) => {
    const user = data.users.find(item => item.id === userId)
    if (!user) return
    setUserForm({
      id: user.id,
      firstName: user.firstName ?? '',
      currentStreak: user.currentStreak,
      totalPredictions: user.totalPredictions,
    })
  }

  const handleUserSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!userForm.id) {
      handleFeedback('Выберите пользователя', 'error')
      return
    }
    try {
      await adminPut(token, `/api/admin/users/${userForm.id}`, {
        firstName: userForm.firstName || undefined,
        currentStreak: userForm.currentStreak === '' ? undefined : Number(userForm.currentStreak),
        totalPredictions:
          userForm.totalPredictions === '' ? undefined : Number(userForm.totalPredictions),
      })
      handleFeedback('Данные пользователя сохранены', 'success')
      await fetchUsers()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось обновить пользователя'
      handleFeedback(message, 'error')
    }
  }

  const handleAchievementSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!achievementForm.name || !achievementForm.requiredValue) {
      handleFeedback('Название и значение обязательны', 'error')
      return
    }
    try {
      await adminPost(token, '/api/admin/achievements/types', {
        name: achievementForm.name.trim(),
        description: achievementForm.description.trim() || undefined,
        requiredValue: Number(achievementForm.requiredValue),
        metric: achievementForm.metric,
      })
      setAchievementForm(defaultAchievementForm)
      handleFeedback('Тип достижения создан', 'success')
      await fetchAchievements()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось создать достижение'
      handleFeedback(message, 'error')
    }
  }

  const handleAchievementEditSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!achievementEditForm.id) {
      handleFeedback('Выберите достижение', 'error')
      return
    }
    try {
      await adminPut(token, `/api/admin/achievements/types/${achievementEditForm.id}`, {
        name: achievementEditForm.name.trim() || undefined,
        description: achievementEditForm.description.trim() || undefined,
        requiredValue:
          achievementEditForm.requiredValue === ''
            ? undefined
            : Number(achievementEditForm.requiredValue),
        metric: achievementEditForm.metric,
      })
      handleFeedback('Достижение обновлено', 'success')
      setAchievementEditForm(defaultAchievementEditForm)
      await fetchAchievements()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось обновить достижение'
      handleFeedback(message, 'error')
    }
  }

  const handleAchievementDelete = async (achievementTypeId: number) => {
    if (!window.confirm('Удалить тип достижения?')) return
    try {
      await adminDelete(token, `/api/admin/achievements/types/${achievementTypeId}`)
      handleFeedback('Тип достижения удалён', 'success')
      await fetchAchievements()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось удалить достижение'
      handleFeedback(message, 'error')
    }
  }

  const handlePredictionUpdate = async (prediction: Prediction, edit: PredictionEditState) => {
    try {
      await adminPut(token, `/api/admin/predictions/${prediction.id}`, {
        isCorrect: edit.isCorrect,
        pointsAwarded: edit.pointsAwarded === '' ? undefined : Number(edit.pointsAwarded),
      })
      handleFeedback('Прогноз обновлён', 'success')
      await fetchPredictions()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось обновить прогноз'
      handleFeedback(message, 'error')
    }
  }

  const initPredictionEdit = (prediction: Prediction) => {
    setPredictionEdits(edits => ({
      ...edits,
      [prediction.id]: {
        pointsAwarded: prediction.pointsAwarded,
        isCorrect: prediction.isCorrect ?? null,
      },
    }))
  }

  const filteredUsers = useMemo(() => {
    return data.users.filter(user => {
      if (!userFilter) return true
      const fullName = `${user.username ?? ''} ${user.firstName ?? ''}`.toLowerCase()
      return fullName.includes(userFilter.toLowerCase())
    })
  }, [data.users, userFilter])

  const userAchievements = useMemo(() => {
    const grouped = new Map<number, AchievementType[]>()
    for (const entry of data.userAchievements) {
      const current = grouped.get(entry.userId) ?? []
      const type = data.achievementTypes.find(item => item.id === entry.achievementTypeId)
      if (type) current.push(type)
      grouped.set(entry.userId, current)
    }
    return grouped
  }, [data.achievementTypes, data.userAchievements])

  return (
    <div className="tab-sections">
      <header className="tab-header">
        <div>
          <h3>Пользователи и прогнозы</h3>
          <p>Отслеживайте активность, управляйте достижениями и корректируйте очки.</p>
        </div>
        <button
          className="button-ghost"
          type="button"
          disabled={isLoading}
          onClick={() => Promise.all([fetchUsers(), fetchPredictions(), fetchAchievements()])}
        >
          {isLoading ? 'Обновляем…' : 'Обновить данные'}
        </button>
      </header>
      {feedback ? <div className={`inline-feedback ${feedbackLevel}`}>{feedback}</div> : null}
      {error ? <div className="inline-feedback error">{error}</div> : null}

      <section className="card-grid">
        <article className="card">
          <header>
            <h4>Редактирование пользователя</h4>
            <p>Используйте форму для ручной корректировки streak и имени.</p>
          </header>
          <form className="stacked" onSubmit={handleUserSubmit}>
            <label>
              Пользователь
              <select
                value={userForm.id}
                onChange={event => {
                  const value = event.target.value ? Number(event.target.value) : ''
                  setUserForm(form => ({ ...form, id: value }))
                  if (value) selectUser(Number(value))
                }}
              >
                <option value="">—</option>
                {data.users.map(user => (
                  <option key={user.id} value={user.id}>
                    {user.username ?? user.telegramId} ({user.firstName ?? '—'})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Имя
              <input
                value={userForm.firstName}
                onChange={event =>
                  setUserForm(form => ({ ...form, firstName: event.target.value }))
                }
              />
            </label>
            <label>
              Текущая серия
              <input
                type="number"
                min={0}
                value={userForm.currentStreak}
                onChange={event =>
                  setUserForm(form => ({
                    ...form,
                    currentStreak: event.target.value ? Number(event.target.value) : '',
                  }))
                }
              />
            </label>
            <label>
              Всего прогнозов
              <input
                type="number"
                min={0}
                value={userForm.totalPredictions}
                onChange={event =>
                  setUserForm(form => ({
                    ...form,
                    totalPredictions: event.target.value ? Number(event.target.value) : '',
                  }))
                }
              />
            </label>
            <button className="button-primary" type="submit" disabled={!userForm.id}>
              Сохранить
            </button>
          </form>
        </article>

        <article className="card">
          <header>
            <h4>Новое достижение</h4>
            <p>Добавьте геймификацию для мотивации пользователей.</p>
          </header>
          <form className="stacked" onSubmit={handleAchievementSubmit}>
            <label>
              Название
              <input
                value={achievementForm.name}
                onChange={event =>
                  setAchievementForm(form => ({ ...form, name: event.target.value }))
                }
                required
              />
            </label>
            <label>
              Описание
              <textarea
                value={achievementForm.description}
                onChange={event =>
                  setAchievementForm(form => ({ ...form, description: event.target.value }))
                }
              />
            </label>
            <label>
              Метрика
              <select
                value={achievementForm.metric}
                onChange={event =>
                  setAchievementForm(form => ({
                    ...form,
                    metric: event.target.value as AchievementType['metric'],
                  }))
                }
              >
                <option value="TOTAL_PREDICTIONS">Общее число прогнозов</option>
                <option value="DAILY_LOGIN">Ежедневная активность</option>
                <option value="CORRECT_PREDICTIONS">Точность</option>
              </select>
            </label>
            <label>
              Необходимое значение
              <input
                type="number"
                min={1}
                value={achievementForm.requiredValue}
                onChange={event =>
                  setAchievementForm(form => ({
                    ...form,
                    requiredValue: event.target.value ? Number(event.target.value) : '',
                  }))
                }
                required
              />
            </label>
            <button className="button-primary" type="submit">
              Добавить
            </button>
          </form>
        </article>

        <article className="card">
          <header>
            <h4>Редактировать достижение</h4>
            <p>При изменении метрики система пересчитает награды.</p>
          </header>
          <form className="stacked" onSubmit={handleAchievementEditSubmit}>
            <label>
              Достижение
              <select
                value={achievementEditForm.id}
                onChange={event => {
                  const value = event.target.value ? Number(event.target.value) : ''
                  if (!value) {
                    setAchievementEditForm(defaultAchievementEditForm)
                    return
                  }
                  const achievement = data.achievementTypes.find(item => item.id === value)
                  if (!achievement) return
                  setAchievementEditForm({
                    id: achievement.id,
                    name: achievement.name,
                    description: achievement.description ?? '',
                    requiredValue: achievement.requiredValue,
                    metric: achievement.metric,
                  })
                }}
              >
                <option value="">—</option>
                {data.achievementTypes.map(achievement => (
                  <option key={achievement.id} value={achievement.id}>
                    {achievement.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Название
              <input
                value={achievementEditForm.name}
                onChange={event =>
                  setAchievementEditForm(form => ({ ...form, name: event.target.value }))
                }
              />
            </label>
            <label>
              Описание
              <textarea
                value={achievementEditForm.description}
                onChange={event =>
                  setAchievementEditForm(form => ({ ...form, description: event.target.value }))
                }
              />
            </label>
            <label>
              Метрика
              <select
                value={achievementEditForm.metric}
                onChange={event =>
                  setAchievementEditForm(form => ({
                    ...form,
                    metric: event.target.value as AchievementType['metric'],
                  }))
                }
              >
                <option value="TOTAL_PREDICTIONS">Общее число прогнозов</option>
                <option value="DAILY_LOGIN">Ежедневная активность</option>
                <option value="CORRECT_PREDICTIONS">Точность</option>
              </select>
            </label>
            <label>
              Значение
              <input
                type="number"
                min={1}
                value={achievementEditForm.requiredValue}
                onChange={event =>
                  setAchievementEditForm(form => ({
                    ...form,
                    requiredValue: event.target.value ? Number(event.target.value) : '',
                  }))
                }
              />
            </label>
            <div className="form-actions">
              <button className="button-primary" type="submit" disabled={!achievementEditForm.id}>
                Сохранить
              </button>
              <button
                className="button-secondary"
                type="button"
                onClick={() => setAchievementEditForm(defaultAchievementEditForm)}
              >
                Очистить
              </button>
            </div>
          </form>
        </article>
      </section>

      <section className="card" style={{ gridColumn: '1 / -1' }}>
        <header>
          <h4>Список пользователей</h4>
          <p>Фильтруйте базу и отслеживайте текущие streak.</p>
        </header>
        <div className="toolbar">
          <input
            type="search"
            placeholder="Поиск по имени"
            value={userFilter}
            onChange={event => setUserFilter(event.target.value)}
          />
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Username</th>
              <th>Имя</th>
              <th>Серия</th>
              <th>Прогнозов</th>
              <th>Достижения</th>
              <th aria-label="Действия" />
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map(user => (
              <tr key={user.id}>
                <td>{user.id}</td>
                <td>{user.username ?? '—'}</td>
                <td>{user.firstName ?? '—'}</td>
                <td>{user.currentStreak}</td>
                <td>{user.totalPredictions}</td>
                <td>
                  {(userAchievements.get(user.id) ?? [])
                    .map(achievement => achievement.name)
                    .join(', ') || '—'}
                </td>
                <td className="table-actions">
                  <button type="button" onClick={() => selectUser(user.id)}>
                    Изм.
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filteredUsers.length ? <p className="muted">Пользователей не найдено.</p> : null}
      </section>

      <section className="card" style={{ gridColumn: '1 / -1' }}>
        <header>
          <h4>Типы достижений</h4>
          <p>Удаление приведёт к пересчёту прогресса у всех пользователей.</p>
        </header>
        <table className="data-table">
          <thead>
            <tr>
              <th>Название</th>
              <th>Метрика</th>
              <th>Значение</th>
              <th aria-label="Действия" />
            </tr>
          </thead>
          <tbody>
            {data.achievementTypes.map(achievement => (
              <tr key={achievement.id}>
                <td>{achievement.name}</td>
                <td>{metricLabels[achievement.metric]}</td>
                <td>{achievement.requiredValue}</td>
                <td className="table-actions">
                  <button
                    type="button"
                    onClick={() =>
                      setAchievementEditForm({
                        id: achievement.id,
                        name: achievement.name,
                        description: achievement.description ?? '',
                        requiredValue: achievement.requiredValue,
                        metric: achievement.metric,
                      })
                    }
                  >
                    Изм.
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => handleAchievementDelete(achievement.id)}
                  >
                    Удал.
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.achievementTypes.length ? <p className="muted">Ещё нет достижений.</p> : null}
      </section>

      <section className="card" style={{ gridColumn: '1 / -1' }}>
        <header>
          <h4>Прогнозы пользователей</h4>
          <p>Правьте начисленные очки и отмечайте результат.</p>
        </header>
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Пользователь</th>
              <th>Матч</th>
              <th>1X2</th>
              <th>Очки</th>
              <th>Точный?</th>
              <th aria-label="Действия" />
            </tr>
          </thead>
          <tbody>
            {data.predictions.map(prediction => {
              const edit = predictionEdits[prediction.id] ?? {
                pointsAwarded: prediction.pointsAwarded,
                isCorrect: prediction.isCorrect ?? null,
              }
              return (
                <tr key={prediction.id}>
                  <td>{prediction.id}</td>
                  <td>{prediction.user?.username ?? prediction.userId}</td>
                  <td>{prediction.matchId}</td>
                  <td>{prediction.result1x2 ?? '—'}</td>
                  <td>
                    <input
                      type="number"
                      className="score-input"
                      value={edit.pointsAwarded}
                      onFocus={() => initPredictionEdit(prediction)}
                      onChange={event =>
                        setPredictionEdits(edits => ({
                          ...edits,
                          [prediction.id]: {
                            ...edits[prediction.id],
                            pointsAwarded: event.target.value ? Number(event.target.value) : '',
                          },
                        }))
                      }
                    />
                  </td>
                  <td>
                    <select
                      value={edit.isCorrect === null ? '' : edit.isCorrect ? 'true' : 'false'}
                      onFocus={() => initPredictionEdit(prediction)}
                      onChange={event =>
                        setPredictionEdits(edits => ({
                          ...edits,
                          [prediction.id]: {
                            ...edits[prediction.id],
                            isCorrect:
                              event.target.value === '' ? null : event.target.value === 'true',
                          },
                        }))
                      }
                    >
                      <option value="">—</option>
                      <option value="true">Да</option>
                      <option value="false">Нет</option>
                    </select>
                  </td>
                  <td className="table-actions">
                    <button type="button" onClick={() => handlePredictionUpdate(prediction, edit)}>
                      Сохранить
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!data.predictions.length ? <p className="muted">Прогнозов нет.</p> : null}
      </section>
    </div>
  )
}
