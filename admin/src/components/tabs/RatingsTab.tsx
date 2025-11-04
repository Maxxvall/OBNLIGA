import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react'
import { useAdminStore } from '../../store/adminStore'
import type { AdminRatingLeaderboardEntry } from '../../types'
import { formatDateTime } from '../../utils/date'
import type { RatingLevel } from '@shared/types'

type FeedbackKind = 'success' | 'error' | 'info'

type FeedbackState = {
  kind: FeedbackKind
  message: string
  meta?: string
} | null

type SettingsFormState = {
  currentScopeDays: string
  yearlyScopeDays: string
  recalc: boolean
}

const levelLabels: Record<RatingLevel, string> = {
  BRONZE: 'Бронза',
  SILVER: 'Серебро',
  GOLD: 'Золото',
  PLATINUM: 'Платина',
  DIAMOND: 'Алмаз',
  MYTHIC: 'Мифик',
}

const scopeLabels: Record<'current' | 'yearly', string> = {
  current: 'Текущее окно',
  yearly: 'Годовой рейтинг',
}

const pageSizeOptions = [25, 50, 100]

const formatIsoDate = (value?: string | null): string => {
  if (!value) {
    return '—'
  }
  const formatted = formatDateTime(value, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  return formatted || value
}

const parseScopeDays = (value: string): number | null => {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  const normalized = Number(trimmed.replace(',', '.'))
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return null
  }
  return Math.trunc(normalized)
}

const parseUserIds = (value: string): number[] => {
  const tokens = value
    .split(/[\s,;]+/)
    .map(token => token.trim())
    .filter(Boolean)

  if (!tokens.length) {
    return []
  }

  const ids = tokens
    .map(token => Number(token))
    .filter(candidate => Number.isFinite(candidate) && candidate > 0)
    .map(candidate => Math.trunc(candidate))

  return Array.from(new Set(ids))
}

const getScopePoints = (entry: AdminRatingLeaderboardEntry, scope: 'current' | 'yearly'): number => {
  return scope === 'yearly' ? entry.yearlyPoints : entry.seasonalPoints
}

const buildMeta = (parts: Array<string | undefined>): string | undefined => {
  const filtered = parts.filter(Boolean)
  return filtered.length ? filtered.join(' • ') : undefined
}

export const RatingsTab = () => {
  const {
    token,
    data,
    ratingScope,
    ratingPage,
    ratingPageSize,
    loading,
    fetchRatingSettings,
    fetchRatingLeaderboard,
    setRatingScope,
    setRatingPagination,
    updateRatingSettings,
    recalculateRatings,
  } = useAdminStore(state => ({
    token: state.token,
    data: state.data,
    ratingScope: state.ratingScope,
    ratingPage: state.ratingPage,
    ratingPageSize: state.ratingPageSize,
    loading: state.loading,
    fetchRatingSettings: state.fetchRatingSettings,
    fetchRatingLeaderboard: state.fetchRatingLeaderboard,
    setRatingScope: state.setRatingScope,
    setRatingPagination: state.setRatingPagination,
    updateRatingSettings: state.updateRatingSettings,
    recalculateRatings: state.recalculateRatings,
  }))

  const ratingSettings = data.ratingSettings
  const ratingLeaderboard = data.ratingLeaderboard

  const [formState, setFormState] = useState<SettingsFormState>({
    currentScopeDays: '',
    yearlyScopeDays: '',
    recalc: false,
  })
  const [settingsFeedback, setSettingsFeedback] = useState<FeedbackState>(null)
  const [recalcInput, setRecalcInput] = useState('')
  const [recalcFeedback, setRecalcFeedback] = useState<FeedbackState>(null)

  const numberFormatter = useMemo(() => new Intl.NumberFormat('ru-RU'), [])

  const loadingSettings = Boolean(loading.ratingSettings)
  const savingSettings = Boolean(loading.ratingSettingsUpdate)
  const loadingLeaderboard = Boolean(loading.ratingLeaderboard)
  const recalculating = Boolean(loading.ratingRecalculate)

  useEffect(() => {
    if (!token) {
      return
    }
    if (!ratingSettings) {
      void fetchRatingSettings({ force: true }).catch(() => undefined)
    }
  }, [token, ratingSettings, fetchRatingSettings])

  useEffect(() => {
    if (!token) {
      return
    }
    if (!ratingLeaderboard) {
      void fetchRatingLeaderboard({ force: true }).catch(() => undefined)
    }
  }, [token, ratingLeaderboard, fetchRatingLeaderboard])

  useEffect(() => {
    if (!ratingSettings) {
      return
    }
    setFormState({
      currentScopeDays: String(ratingSettings.settings.currentScopeDays),
      yearlyScopeDays: String(ratingSettings.settings.yearlyScopeDays),
      recalc: false,
    })
  }, [ratingSettings])

  const scopePointsLabel = ratingScope === 'yearly' ? 'Очки (год)' : 'Очки (текущее окно)'
  const totalPages = useMemo(() => {
    if (!ratingLeaderboard || ratingLeaderboard.pageSize <= 0) {
      return 1
    }
    return Math.max(1, Math.ceil(ratingLeaderboard.total / ratingLeaderboard.pageSize))
  }, [ratingLeaderboard])

  const currentPage = ratingLeaderboard?.page ?? ratingPage
  const currentPageSize = ratingLeaderboard?.pageSize ?? ratingPageSize
  const entries: AdminRatingLeaderboardEntry[] = ratingLeaderboard?.entries ?? []

  const handleFormChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = event.target
    setFormState(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }))
    setSettingsFeedback(null)
  }

  const handleResetCurrent = () => {
    if (!ratingSettings) {
      return
    }
    setFormState({
      currentScopeDays: String(ratingSettings.settings.currentScopeDays),
      yearlyScopeDays: String(ratingSettings.settings.yearlyScopeDays),
      recalc: false,
    })
    setSettingsFeedback(null)
  }

  const handleApplyDefaults = () => {
    if (!ratingSettings) {
      return
    }
    setFormState(prev => ({
      ...prev,
      currentScopeDays: String(ratingSettings.settings.defaults.currentScopeDays),
      yearlyScopeDays: String(ratingSettings.settings.defaults.yearlyScopeDays),
    }))
    setSettingsFeedback({
      kind: 'info',
      message: 'Подставлены значения по умолчанию. Проверьте перед сохранением.',
    })
  }

  const handleSettingsSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSettingsFeedback(null)
    const currentDays = parseScopeDays(formState.currentScopeDays)
    if (currentDays === null) {
      setSettingsFeedback({
        kind: 'error',
        message: 'Укажите длительность текущего окна (положительное число дней).',
      })
      return
    }
    const yearlyDays = parseScopeDays(formState.yearlyScopeDays)
    if (yearlyDays === null) {
      setSettingsFeedback({
        kind: 'error',
        message: 'Укажите длительность годового окна (положительное число дней).',
      })
      return
    }

    try {
      const result = await updateRatingSettings({
        currentScopeDays: currentDays,
        yearlyScopeDays: yearlyDays,
        recalculate: formState.recalc,
      })
      setSettingsFeedback({
        kind: 'success',
        message: 'Настройки обновлены.',
        meta: buildMeta([
          result.meta?.recalculated ? 'пересчёт выполнен' : undefined,
          typeof result.meta?.affectedUsers === 'number'
            ? `обновлено пользователей: ${numberFormatter.format(result.meta.affectedUsers)}`
            : undefined,
        ]),
      })
      setFormState(prev => ({ ...prev, recalc: false }))
      await fetchRatingSettings({ force: true })
      await fetchRatingLeaderboard({ force: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось обновить настройки рейтинга.'
      setSettingsFeedback({ kind: 'error', message })
    }
  }

  const handleRecalculate = async () => {
    setRecalcFeedback(null)
    const ids = parseUserIds(recalcInput)
    try {
      const result = await recalculateRatings(ids.length ? ids : undefined)
      setRecalcFeedback({
        kind: 'success',
        message: ids.length ? 'Частичный пересчёт выполнен.' : 'Полный пересчёт выполнен.',
        meta: buildMeta([
          result.meta?.partial ? 'выбранные пользователи' : undefined,
          typeof result.meta?.affectedUsers === 'number'
            ? `затронуто пользователей: ${numberFormatter.format(result.meta.affectedUsers)}`
            : undefined,
        ]),
      })
      await fetchRatingSettings({ force: true })
      await fetchRatingLeaderboard({ force: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось пересчитать рейтинг.'
      setRecalcFeedback({ kind: 'error', message })
    }
  }

  const handleRefresh = () => {
    setSettingsFeedback(null)
    setRecalcFeedback(null)
    void fetchRatingSettings({ force: true }).catch(() => undefined)
    void fetchRatingLeaderboard({ force: true }).catch(() => undefined)
  }

  const handleScopeChange = (scope: 'current' | 'yearly') => {
    if (scope === ratingScope) {
      return
    }
    setRecalcFeedback(null)
    void setRatingScope(scope).catch(() => undefined)
  }

  const handlePrevPage = () => {
    if (currentPage <= 1) {
      return
    }
    void setRatingPagination(currentPage - 1, currentPageSize).catch(() => undefined)
  }

  const handleNextPage = () => {
    if (!ratingLeaderboard) {
      return
    }
    if (ratingLeaderboard.page >= totalPages) {
      return
    }
    void setRatingPagination(ratingLeaderboard.page + 1, ratingLeaderboard.pageSize).catch(
      () => undefined
    )
  }

  const handlePageSizeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = Number(event.target.value)
    if (!Number.isFinite(value) || value <= 0) {
      return
    }
    void setRatingPagination(1, Math.trunc(value)).catch(() => undefined)
  }

  const canPrev = currentPage > 1
  const canNext = Boolean(ratingLeaderboard && ratingLeaderboard.page < totalPages)

  return (
    <div className="tab-sections ratings-tab">
      <section>
        <div className="tab-header">
          <div>
            <h3>Настройки рейтинга</h3>
            <p>
              Управляйте длиной скользящих окон, чтобы влиять на расчёт текущего и годового рейтинга.
              При необходимости запустите пересчёт вручную.
            </p>
          </div>
          <div className="tab-header-actions">
            <button
              type="button"
              className="button-secondary"
              onClick={handleRefresh}
              disabled={loadingSettings || loadingLeaderboard || savingSettings || recalculating}
            >
              Обновить данные
            </button>
          </div>
        </div>
        <div className="card-grid">
          <section className="card ratings-card">
            <h4>Параметры расчёта</h4>
            <form className="stacked ratings-form" onSubmit={handleSettingsSubmit}>
              <label>
                Текущее окно (дней)
                <input
                  name="currentScopeDays"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={formState.currentScopeDays}
                  onChange={handleFormChange}
                  disabled={savingSettings || loadingSettings}
                />
              </label>
              <label>
                Годовое окно (дней)
                <input
                  name="yearlyScopeDays"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={formState.yearlyScopeDays}
                  onChange={handleFormChange}
                  disabled={savingSettings || loadingSettings}
                />
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  name="recalc"
                  checked={formState.recalc}
                  onChange={handleFormChange}
                  disabled={savingSettings}
                />
                Пересчитать рейтинг после сохранения
              </label>
              <div className="form-actions">
                <button
                  type="submit"
                  className="button-primary compact"
                  disabled={savingSettings}
                >
                  Сохранить
                </button>
                <button
                  type="button"
                  className="button-secondary compact"
                  onClick={handleResetCurrent}
                  disabled={savingSettings || loadingSettings}
                >
                  Текущие значения
                </button>
                <button
                  type="button"
                  className="button-secondary compact"
                  onClick={handleApplyDefaults}
                  disabled={savingSettings || loadingSettings}
                >
                  Значения по умолчанию
                </button>
              </div>
              {settingsFeedback ? (
                <div className={`inline-feedback ${settingsFeedback.kind}`}>
                  <span>{settingsFeedback.message}</span>
                  {settingsFeedback.meta ? (
                    <span className="feedback-meta">{settingsFeedback.meta}</span>
                  ) : null}
                </div>
              ) : null}
            </form>
          </section>
          <section className="card ratings-card">
            <h4>Сводка окна</h4>
            {ratingSettings ? (
              <dl className="ratings-meta">
                <div className="ratings-meta-row">
                  <dt>Текущее окно</dt>
                  <dd>{numberFormatter.format(ratingSettings.settings.currentScopeDays)} дн.</dd>
                </div>
                <div className="ratings-meta-row">
                  <dt>Годовое окно</dt>
                  <dd>{numberFormatter.format(ratingSettings.settings.yearlyScopeDays)} дн.</dd>
                </div>
                <div className="ratings-meta-row">
                  <dt>Дата изменения</dt>
                  <dd>{formatIsoDate(ratingSettings.settings.updatedAt)}</dd>
                </div>
                <div className="ratings-meta-row">
                  <dt>Текущее окно начинается</dt>
                  <dd>{formatIsoDate(ratingSettings.windows.currentWindowStart)}</dd>
                </div>
                <div className="ratings-meta-row">
                  <dt>Годовое окно начинается</dt>
                  <dd>{formatIsoDate(ratingSettings.windows.yearlyWindowStart)}</dd>
                </div>
                <div className="ratings-meta-row">
                  <dt>Опорная дата</dt>
                  <dd>{formatIsoDate(ratingSettings.windows.anchor)}</dd>
                </div>
                <div className="ratings-meta-row">
                  <dt>Последний пересчёт</dt>
                  <dd>{formatIsoDate(ratingSettings.lastRecalculatedAt)}</dd>
                </div>
                <div className="ratings-meta-row">
                  <dt>Участники в рейтинге</dt>
                  <dd>{numberFormatter.format(ratingSettings.totals.ratedUsers)}</dd>
                </div>
                <div className="ratings-meta-row">
                  <dt>Игроки уровня Мифик</dt>
                  <dd>{numberFormatter.format(ratingSettings.totals.mythicPlayers)}</dd>
                </div>
              </dl>
            ) : (
              <div className="inline-feedback info">Нет данных о настройках. Обновите вкладку.</div>
            )}
            <div className="ratings-divider" />
            <h4>Ручной пересчёт</h4>
            <div className="stacked">
              <label>
                ID пользователей (через запятую или пробел)
                <input
                  type="text"
                  value={recalcInput}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    setRecalcInput(event.target.value)
                    setRecalcFeedback(null)
                  }}
                  placeholder="Оставьте пустым для полного пересчёта"
                  disabled={recalculating}
                />
              </label>
              <div className="form-actions">
                <button
                  type="button"
                  className="button-danger compact"
                  onClick={handleRecalculate}
                  disabled={recalculating}
                >
                  Запустить пересчёт
                </button>
              </div>
              {recalcFeedback ? (
                <div className={`inline-feedback ${recalcFeedback.kind}`}>
                  <span>{recalcFeedback.message}</span>
                  {recalcFeedback.meta ? (
                    <span className="feedback-meta">{recalcFeedback.meta}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </section>

      <section>
        <div className="tab-header">
          <div>
            <h3>Таблица лидеров</h3>
            <p>
              Просматривайте позиции пользователей и переключайтесь между текущим и годовым окнами.
              Снимок фиксируется при каждом пересчёте или попадании новых данных в кэш.
            </p>
          </div>
          <div className="tab-header-actions ratings-scope-switch">
            {(Object.keys(scopeLabels) as Array<'current' | 'yearly'>).map(scope => (
              <button
                key={scope}
                type="button"
                className={`button-ghost${ratingScope === scope ? ' active' : ''}`}
                onClick={() => handleScopeChange(scope)}
                disabled={loadingLeaderboard}
              >
                {scopeLabels[scope]}
              </button>
            ))}
          </div>
        </div>
        <section className="card ratings-card">
          {ratingLeaderboard ? (
            <div className="ratings-meta ratings-meta-inline">
              <div className="ratings-meta-row">
                <dt>Снимок на</dt>
                <dd>{formatIsoDate(ratingLeaderboard.capturedAt)}</dd>
              </div>
              <div className="ratings-meta-row">
                <dt>Текущее окно</dt>
                <dd>{formatIsoDate(ratingLeaderboard.currentWindowStart)}</dd>
              </div>
              <div className="ratings-meta-row">
                <dt>Годовое окно</dt>
                <dd>{formatIsoDate(ratingLeaderboard.yearlyWindowStart)}</dd>
              </div>
              <div className="ratings-meta-row">
                <dt>Участников</dt>
                <dd>{numberFormatter.format(ratingLeaderboard.total)}</dd>
              </div>
            </div>
          ) : null}
          {loadingLeaderboard ? (
            <div className="inline-feedback info">Загружаем таблицу лидеров…</div>
          ) : null}
          {!loadingLeaderboard && entries.length === 0 ? (
            <div className="inline-feedback info">Нет записей для выбранного окна.</div>
          ) : null}
          {entries.length ? (
            <div className="ratings-table-wrapper">
              <table className="ratings-table">
                <thead>
                  <tr>
                    <th>Место</th>
                    <th>Пользователь</th>
                    <th>{scopePointsLabel}</th>
                    <th>Всего очков</th>
                    <th>Уровень</th>
                    <th>Серия</th>
                    <th>Последний прогноз</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(entry => {
                    const scopePoints = getScopePoints(entry, ratingScope)
                    const level = levelLabels[entry.currentLevel]
                    const levelMeta =
                      entry.currentLevel === 'MYTHIC' && entry.mythicRank
                        ? `${level} #${entry.mythicRank}`
                        : level
                    const streakLabel = `${entry.currentStreak || 0}/${entry.maxStreak || 0}`
                    return (
                      <tr key={entry.userId}>
                        <td className="points">{numberFormatter.format(entry.position)}</td>
                        <td>
                          <div className="ratings-user">
                            <strong>{entry.displayName}</strong>
                            {entry.username ? (
                              <span className="ratings-username">@{entry.username}</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="points">{numberFormatter.format(scopePoints)}</td>
                        <td className="points">{numberFormatter.format(entry.totalPoints)}</td>
                        <td>{levelMeta}</td>
                        <td>{streakLabel}</td>
                        <td>{formatIsoDate(entry.lastPredictionAt)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="ratings-pagination">
            <div className="ratings-pagination-controls">
              <button
                type="button"
                className="button-ghost"
                onClick={handlePrevPage}
                disabled={!canPrev || loadingLeaderboard}
              >
                Назад
              </button>
              <button
                type="button"
                className="button-ghost"
                onClick={handleNextPage}
                disabled={!canNext || loadingLeaderboard}
              >
                Вперёд
              </button>
              <span className="ratings-pagination-info">
                Страница {currentPage} из {totalPages}
              </span>
            </div>
            <label className="ratings-page-size">
              Показывать по
              <select
                className="tab-select"
                value={currentPageSize}
                onChange={handlePageSizeChange}
                disabled={loadingLeaderboard}
              >
                {pageSizeOptions.map(size => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
      </section>
    </div>
  )
}
