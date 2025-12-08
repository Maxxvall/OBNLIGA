import { FormEvent, useEffect, useState } from 'react'
import { adminDelete, adminPost, adminPut } from '../../api/adminClient'
import { useAdminStore } from '../../store/adminStore'
import { AchievementLevel, AchievementType } from '../../types'

type LevelFormState = {
  level: number
  threshold: number | ''
  title: string
  description: string
  rewardPoints?: number | null
}

type AchievementFormState = {
  name: string
  description: string
  metric: AchievementType['metric']
  levels: LevelFormState[]
}

type AchievementEditFormState = AchievementFormState & { id: number | '' }

type FeedbackLevel = 'success' | 'error' | 'info'

const metricLabels: Record<AchievementType['metric'], string> = {
  DAILY_LOGIN: 'Ежедневная активность',
  TOTAL_PREDICTIONS: 'Общее число прогнозов',
  CORRECT_PREDICTIONS: 'Удачные прогнозы',
  SEASON_POINTS: 'Сезонные очки',
  PREDICTION_STREAK: 'Серия побед',
  EXPRESS_WINS: 'Угаданные экспрессы',
  BROADCAST_WATCH_TIME: 'Часы просмотра трансляций',
}

const rewardPointsByMetric: Record<AchievementType['metric'], Record<number, number>> = {
  DAILY_LOGIN: { 1: 20, 2: 200, 3: 1000 },
  TOTAL_PREDICTIONS: { 1: 50, 2: 350, 3: 1000 },
  SEASON_POINTS: { 1: 50, 2: 250, 3: 1000 },
  CORRECT_PREDICTIONS: { 1: 20, 2: 200, 3: 1000 },
  PREDICTION_STREAK: { 1: 50, 2: 250, 3: 1000 },
  EXPRESS_WINS: { 1: 50, 2: 250, 3: 1000 },
  BROADCAST_WATCH_TIME: { 1: 50, 2: 200, 3: 1500 },
}

const getRewardPoints = (metric: AchievementType['metric'], level: number): number | null =>
  rewardPointsByMetric[metric]?.[level] ?? null

const refreshRewardPointsForLevels = (
  levels: LevelFormState[],
  metric: AchievementType['metric']
): LevelFormState[] => levels.map(level => ({ ...level, rewardPoints: getRewardPoints(metric, level.level) }))

const buildLevelForm = (
  metric: AchievementType['metric'],
  ordinal: number,
  base?: Partial<AchievementLevel>
): LevelFormState => ({
  level: base?.level ?? ordinal,
  threshold: base?.threshold ?? '',
  title: base?.title ?? `Уровень ${ordinal}`,
  description: base?.description ?? '',
  rewardPoints: getRewardPoints(metric, base?.level ?? ordinal),
})

const defaultLevels: LevelFormState[] = [1, 2, 3].map(level => buildLevelForm('TOTAL_PREDICTIONS', level, { level }))

const defaultAchievementForm: AchievementFormState = {
  name: '',
  description: '',
  metric: 'TOTAL_PREDICTIONS',
  levels: defaultLevels,
}

const defaultAchievementEditForm: AchievementEditFormState = {
  id: '',
  ...defaultAchievementForm,
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

  const normalizeLevels = (
    metric: AchievementType['metric'],
    levels?: AchievementLevel[]
  ): LevelFormState[] => {
    const existing = new Map<number, AchievementLevel>()
    levels?.forEach(level => existing.set(level.level, level))
    return [1, 2, 3].map(level => buildLevelForm(metric, level, existing.get(level)))
  }

  const handleMetricChange = (metric: AchievementType['metric']) => {
    setAchievementForm(prev => ({
      ...prev,
      metric,
      levels: refreshRewardPointsForLevels(prev.levels, metric),
    }))
  }

  const handleMetricChangeEdit = (metric: AchievementType['metric']) => {
    setAchievementEditForm(prev => ({
      ...prev,
      metric,
      levels: refreshRewardPointsForLevels(prev.levels, metric),
    }))
  }

  const updateCreateLevelField = (
    levelNumber: number,
    field: keyof LevelFormState,
    value: string
  ) => {
    setAchievementForm(prev => ({
      ...prev,
      levels: prev.levels.map(level =>
        level.level === levelNumber
          ? {
              ...level,
              [field]:
                field === 'threshold' ? (value === '' ? '' : Number(value)) : (value as string),
            }
          : level
      ),
    }))
  }

  const updateEditLevelField = (
    levelNumber: number,
    field: keyof LevelFormState,
    value: string
  ) => {
    setAchievementEditForm(prev => ({
      ...prev,
      levels: prev.levels.map(level =>
        level.level === levelNumber
          ? {
              ...level,
              [field]:
                field === 'threshold' ? (value === '' ? '' : Number(value)) : (value as string),
            }
          : level
      ),
    }))
  }

  const validateLevels = (levels: LevelFormState[]): { ok: boolean; error?: string } => {
    const thresholds: number[] = []
    for (const level of levels) {
      if (level.threshold === '' || !Number.isFinite(Number(level.threshold))) {
        return { ok: false, error: 'Заполните пороги для всех уровней' }
      }
      const value = Number(level.threshold)
      if (value <= 0) {
        return { ok: false, error: 'Порог должен быть больше нуля' }
      }
      thresholds.push(value)
    }
    return { ok: true }
  }

  const prepareLevelsPayload = (levels: LevelFormState[]) =>
    levels
      .map(level => ({
        level: level.level,
        threshold: Number(level.threshold),
        title: level.title.trim() || `Уровень ${level.level}`,
        description: level.description.trim() || undefined,
        iconUrl: undefined,
      }))
      .sort((a, b) => a.level - b.level)

  const handleAchievementSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const levelsValidation = validateLevels(achievementForm.levels)
    if (!achievementForm.name || !levelsValidation.ok) {
      handleFeedback(levelsValidation.error || 'Название и уровни обязательны', 'error')
      return
    }
    const levelsPayload = prepareLevelsPayload(achievementForm.levels)
    const requiredValue = Math.max(...levelsPayload.map(level => level.threshold))
    try {
      await adminPost(token, '/api/admin/achievements/types', {
        name: achievementForm.name.trim(),
        description: achievementForm.description.trim() || undefined,
        metric: achievementForm.metric,
        requiredValue,
        levels: levelsPayload,
      })
      setAchievementForm({ ...defaultAchievementForm, levels: normalizeLevels(achievementForm.metric) })
      handleFeedback('Тип достижения создан', 'success')
      await fetchAchievements()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось создать достижение'
      handleFeedback(message, 'error')
    }
  }

  const handleAchievementEditSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const levelsValidation = validateLevels(achievementEditForm.levels)
    if (!achievementEditForm.id || !achievementEditForm.name || !levelsValidation.ok) {
      handleFeedback(levelsValidation.error || 'Выберите достижение и заполните уровни', 'error')
      return
    }
    const levelsPayload = prepareLevelsPayload(achievementEditForm.levels)
    const requiredValue = Math.max(...levelsPayload.map(level => level.threshold))
    try {
      await adminPut(token, `/api/admin/achievements/types/${achievementEditForm.id}`, {
        name: achievementEditForm.name.trim(),
        description: achievementEditForm.description.trim() || undefined,
        metric: achievementEditForm.metric,
        requiredValue,
        levels: levelsPayload,
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
      metric: achievement.metric,
      levels: normalizeLevels(achievement.metric, achievement.levels),
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
                onChange={e => handleMetricChange(e.target.value as AchievementType['metric'])}
              >
                {Object.entries(metricLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="levels-grid">
              {achievementForm.levels.map(level => (
                <div key={level.level} className="level-card">
                  <div className="level-header">
                    <strong>Уровень {level.level}</strong>
                    {level.rewardPoints ? (
                      <span className="muted">+{level.rewardPoints} очков</span>
                    ) : null}
                  </div>
                  <label>
                    Порог значения
                    <input
                      type="number"
                      min="1"
                      value={level.threshold}
                      onChange={e =>
                        updateCreateLevelField(level.level, 'threshold', e.target.value)
                      }
                      placeholder="Например, 10"
                    />
                  </label>
                  <label>
                    Заголовок уровня
                    <input
                      type="text"
                      value={level.title}
                      onChange={e => updateCreateLevelField(level.level, 'title', e.target.value)}
                    />
                  </label>
                  <label>
                    Описание уровня
                    <textarea
                      rows={2}
                      value={level.description}
                      onChange={e =>
                        updateCreateLevelField(level.level, 'description', e.target.value)
                      }
                    />
                  </label>
                </div>
              ))}
            </div>
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
                    onChange={e => handleMetricChangeEdit(e.target.value as AchievementType['metric'])}
                  >
                    {Object.entries(metricLabels).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="levels-grid">
                  {achievementEditForm.levels.map(level => (
                    <div key={level.level} className="level-card">
                      <div className="level-header">
                        <strong>Уровень {level.level}</strong>
                        {level.rewardPoints ? (
                          <span className="muted">+{level.rewardPoints} очков</span>
                        ) : null}
                      </div>
                      <label>
                        Порог значения
                        <input
                          type="number"
                          min="1"
                          value={level.threshold}
                          onChange={e =>
                            updateEditLevelField(level.level, 'threshold', e.target.value)
                          }
                        />
                      </label>
                      <label>
                        Заголовок уровня
                        <input
                          type="text"
                          value={level.title}
                          onChange={e =>
                            updateEditLevelField(level.level, 'title', e.target.value)
                          }
                        />
                      </label>
                      <label>
                        Описание уровня
                        <textarea
                          rows={2}
                          value={level.description}
                          onChange={e =>
                            updateEditLevelField(level.level, 'description', e.target.value)
                          }
                        />
                      </label>
                    </div>
                  ))}
                </div>
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
