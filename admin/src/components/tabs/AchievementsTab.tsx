import { FormEvent, useEffect, useState } from 'react'
import { adminDelete, adminPost, adminPut } from '../../api/adminClient'
import { useAdminStore } from '../../store/adminStore'
import { AchievementType } from '../../types'

type AchievementFormState = {
  name: string
  description: string
  requiredValue: number | ''
  metric: AchievementType['metric']
}

type AchievementEditFormState = AchievementFormState & { id: number | '' }

type FeedbackLevel = 'success' | 'error' | 'info'

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

export const AchievementsTab = () => {
  const { token, data, fetchAchievements, loading } = useAdminStore(state => ({
    token: state.token,
    data: state.data,
    fetchAchievements: state.fetchAchievements,
    loading: state.loading,
  }))

  const [achievementForm, setAchievementForm] =
    useState<AchievementFormState>(defaultAchievementForm)
  const [achievementEditForm, setAchievementEditForm] = useState<AchievementEditFormState>(
    defaultAchievementEditForm
  )
  const [feedback, setFeedback] = useState<string | null>(null)
  const [feedbackLevel, setFeedbackLevel] = useState<FeedbackLevel>('info')

  const isLoading = Boolean(loading.achievements)

  useEffect(() => {
    if (!token) return
    if (!data.achievementTypes.length || !data.userAchievements.length) {
      void fetchAchievements().catch(() => undefined)
    }
  }, [token, data.achievementTypes.length, data.userAchievements.length, fetchAchievements])

  const handleFeedback = (message: string, level: FeedbackLevel) => {
    setFeedback(message)
    setFeedbackLevel(level)
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
    if (!achievementEditForm.id || !achievementEditForm.name || !achievementEditForm.requiredValue) {
      handleFeedback('Выберите достижение и заполните поля', 'error')
      return
    }
    try {
      await adminPut(token, `/api/admin/achievements/types/${achievementEditForm.id}`, {
        name: achievementEditForm.name.trim(),
        description: achievementEditForm.description.trim() || undefined,
        requiredValue: Number(achievementEditForm.requiredValue),
        metric: achievementEditForm.metric,
      })
      handleFeedback('Тип достижения обновлён', 'success')
      await fetchAchievements()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось обновить достижение'
      handleFeedback(message, 'error')
    }
  }

  const handleDeleteAchievement = async (id: number) => {
    if (!window.confirm('Удалить этот тип достижения?')) return
    try {
      await adminDelete(token, `/api/admin/achievements/types/${id}`)
      handleFeedback('Тип достижения удалён', 'success')
      await fetchAchievements()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось удалить'
      handleFeedback(message, 'error')
    }
  }

  const selectAchievementForEdit = (achievementTypeId: number) => {
    const achievement = data.achievementTypes.find(item => item.id === achievementTypeId)
    if (!achievement) return
    setAchievementEditForm({
      id: achievement.id,
      name: achievement.name,
      description: achievement.description ?? '',
      requiredValue: achievement.requiredValue,
      metric: achievement.metric,
    })
  }

  return (
    <>
      <header className="tab-header">
        <h2>Достижения</h2>
        <p>Управление типами достижений, метриками и прогрессом пользователей.</p>
      </header>

      {feedback ? <div className={`inline-feedback ${feedbackLevel}`}>{feedback}</div> : null}

      <section className="card-grid">
        {/* Создание нового типа достижения */}
        <article className="card">
          <header>
            <h4>Создать тип достижения</h4>
          </header>
          <form className="stacked" onSubmit={handleAchievementSubmit}>
            <label>
              Название
              <input
                type="text"
                value={achievementForm.name}
                onChange={e => setAchievementForm({ ...achievementForm, name: e.target.value })}
                placeholder="Например: Новичок в прогнозах"
              />
            </label>
            <label>
              Описание
              <textarea
                value={achievementForm.description}
                onChange={e => setAchievementForm({ ...achievementForm, description: e.target.value })}
                placeholder="Краткое описание достижения"
                rows={2}
              />
            </label>
            <label>
              Метрика
              <select
                value={achievementForm.metric}
                onChange={e =>
                  setAchievementForm({
                    ...achievementForm,
                    metric: e.target.value as AchievementType['metric'],
                  })
                }
              >
                {Object.entries(metricLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Требуемое значение
              <input
                type="number"
                value={achievementForm.requiredValue}
                onChange={e =>
                  setAchievementForm({
                    ...achievementForm,
                    requiredValue: e.target.value === '' ? '' : Number(e.target.value),
                  })
                }
                placeholder="10"
                min="1"
              />
            </label>
            <button type="submit" className="button-primary" disabled={isLoading}>
              Создать
            </button>
          </form>
        </article>

        {/* Редактирование существующего */}
        <article className="card">
          <header>
            <h4>Редактировать тип достижения</h4>
          </header>
          <form className="stacked" onSubmit={handleAchievementEditSubmit}>
            <label>
              Выбрать достижение
              <select
                value={achievementEditForm.id}
                onChange={e => {
                  const id = e.target.value === '' ? '' : Number(e.target.value)
                  if (id === '') {
                    setAchievementEditForm(defaultAchievementEditForm)
                  } else {
                    selectAchievementForEdit(id)
                  }
                }}
              >
                <option value="">-- Выберите --</option>
                {data.achievementTypes.map(achievement => (
                  <option key={achievement.id} value={achievement.id}>
                    {achievement.name} ({metricLabels[achievement.metric]}: {achievement.requiredValue})
                  </option>
                ))}
              </select>
            </label>
            {achievementEditForm.id !== '' ? (
              <>
                <label>
                  Название
                  <input
                    type="text"
                    value={achievementEditForm.name}
                    onChange={e =>
                      setAchievementEditForm({ ...achievementEditForm, name: e.target.value })
                    }
                  />
                </label>
                <label>
                  Описание
                  <textarea
                    value={achievementEditForm.description}
                    onChange={e =>
                      setAchievementEditForm({ ...achievementEditForm, description: e.target.value })
                    }
                    rows={2}
                  />
                </label>
                <label>
                  Метрика
                  <select
                    value={achievementEditForm.metric}
                    onChange={e =>
                      setAchievementEditForm({
                        ...achievementEditForm,
                        metric: e.target.value as AchievementType['metric'],
                      })
                    }
                  >
                    {Object.entries(metricLabels).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Требуемое значение
                  <input
                    type="number"
                    value={achievementEditForm.requiredValue}
                    onChange={e =>
                      setAchievementEditForm({
                        ...achievementEditForm,
                        requiredValue: e.target.value === '' ? '' : Number(e.target.value),
                      })
                    }
                    min="1"
                  />
                </label>
                <div className="form-actions">
                  <button type="submit" className="button-primary" disabled={isLoading}>
                    Сохранить изменения
                  </button>
                  <button
                    type="button"
                    className="button-danger"
                    onClick={() => handleDeleteAchievement(Number(achievementEditForm.id))}
                    disabled={isLoading}
                  >
                    Удалить
                  </button>
                </div>
              </>
            ) : null}
          </form>
        </article>
      </section>

      {/* Список достижений пользователей */}
      <section className="card" style={{ gridColumn: '1 / -1' }}>
        <header>
          <h4>Прогресс пользователей</h4>
          <p>Всего записей: {data.userAchievements.length}</p>
        </header>
        {data.userAchievements.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>User ID</th>
                <th>Достижение</th>
                <th>Дата</th>
              </tr>
            </thead>
            <tbody>
              {data.userAchievements.map((item, index) => {
                const achievementType = data.achievementTypes.find(
                  at => at.id === item.achievementTypeId
                )
                return (
                  <tr key={`${item.userId}-${item.achievementTypeId}-${index}`}>
                    <td>{item.userId}</td>
                    <td>{achievementType?.name ?? `ID ${item.achievementTypeId}`}</td>
                    <td>{new Date(item.achievedDate).toLocaleString('ru')}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <p className="muted">Пока никто не разблокировал достижений.</p>
        )}
      </section>
    </>
  )
}
