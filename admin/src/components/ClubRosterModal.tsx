import { FormEvent, useEffect, useMemo, useState } from 'react'
import { fetchClubPlayers, importClubPlayers, updateClubPlayers } from '../api/adminClient'
import { Club, ClubPlayerLink, Person } from '../types'

type ClubRosterModalProps = {
  club: Club
  token: string | undefined
  onClose: () => void
  onSaved: (players: ClubPlayerLink[]) => void
}

type EditablePlayer = {
  personId: number
  defaultShirtNumber: number | null
  person: Person
}

export const ClubRosterModal = ({ club, token, onClose, onSaved }: ClubRosterModalProps) => {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [bulkValue, setBulkValue] = useState('')
  const [bulkLoading, setBulkLoading] = useState(false)
  const [roster, setRoster] = useState<EditablePlayer[]>([])

  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        setLoading(true)
        setError(null)
        const data = await fetchClubPlayers(token, club.id)
        if (!mounted) return
        const next = data.map(entry => ({
          personId: entry.personId,
          defaultShirtNumber: entry.defaultShirtNumber ?? null,
          person: entry.person,
        }))
        setRoster(next)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Не удалось загрузить состав'
        if (mounted) setError(message)
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void load()
    return () => {
      mounted = false
    }
  }, [club.id, token])

  const sortedRoster = useMemo(() => {
    return [...roster].sort((a, b) => {
      const left = a.defaultShirtNumber ?? 9999
      const right = b.defaultShirtNumber ?? 9999
      if (left !== right) return left - right
      return a.person.lastName.localeCompare(b.person.lastName)
    })
  }, [roster])

  const handleBulkAdd = async () => {
    const lines = bulkValue
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)

    if (!lines.length) {
      setError('Введите хотя бы одну строку с фамилией и именем.')
      return
    }

    try {
      setBulkLoading(true)
      setError(null)
      setFeedback(null)
      const previousCount = roster.length
      const data = await importClubPlayers(token, club.id, { lines })
      const next = data.map(entry => ({
        personId: entry.personId,
        defaultShirtNumber: entry.defaultShirtNumber ?? null,
        person: entry.person,
      }))
      setRoster(next)
      setBulkValue('')
      const diff = data.length - previousCount
      if (diff > 0) {
        const suffix = diff < lines.length ? ' Повторяющиеся ФИО пропущены.' : ''
        setFeedback(
          `Добавлено ${diff} ${diff === 1 ? 'игрок' : diff < 5 ? 'игрока' : 'игроков'}.${suffix}`
        )
      } else {
        setFeedback(
          'Новых игроков не добавлено: вероятно, все указанные фамилии уже есть в составе.'
        )
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось создать игроков'
      setError(message)
    } finally {
      setBulkLoading(false)
    }
  }

  const handleRemove = (personId: number) => {
    setFeedback(null)
    setRoster(prev => prev.filter(entry => entry.personId !== personId))
  }

  const handleNumberChange = (personId: number, value: string) => {
    setFeedback(null)
    const numeric = value.replace(/[^0-9]/g, '')
    const parsed = numeric ? Math.min(999, Number(numeric)) : null
    setRoster(prev =>
      prev.map(entry =>
        entry.personId === personId
          ? {
              ...entry,
              defaultShirtNumber: parsed,
            }
          : entry
      )
    )
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!roster.length) {
      if (!window.confirm('Состав пуст. Очистить список игроков клуба?')) return
    }
    try {
      setSaving(true)
      setError(null)
      setFeedback(null)
      const payload = {
        players: roster.map(entry => ({
          personId: entry.personId,
          defaultShirtNumber:
            typeof entry.defaultShirtNumber === 'number' && entry.defaultShirtNumber > 0
              ? entry.defaultShirtNumber
              : null,
        })),
      }
      const data = await updateClubPlayers(token, club.id, payload)
      const nextRoster = data.map(entry => ({
        personId: entry.personId,
        defaultShirtNumber: entry.defaultShirtNumber ?? null,
        person: entry.person,
      }))
      setRoster(nextRoster)
      onSaved(data)
      onClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось сохранить состав'
      setError(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="club-roster-title"
    >
      <div className="modal-card">
        <header className="modal-header">
          <div>
            <h4 id="club-roster-title">Состав клуба «{club.name}»</h4>
            <p>
              Управляйте заявочным списком клуба. Эти данные используются в мастере создания сезона.
            </p>
          </div>
          <button className="button-secondary" type="button" onClick={onClose} disabled={saving}>
            Закрыть
          </button>
        </header>
        <form className="modal-body" onSubmit={handleSubmit}>
          {error ? <div className="inline-feedback error">{error}</div> : null}
          {feedback ? <div className="inline-feedback success">{feedback}</div> : null}
          {loading ? <div className="inline-feedback info">Загружаем состав…</div> : null}
          <div className="modal-content-grid">
            <section className="modal-panel">
              <header>
                <h5>Создание игроков</h5>
                <p>
                  Вставьте список строк формата «Фамилия Имя». Игроки будут созданы и привязаны к
                  клубу автоматически.
                </p>
              </header>
              <div className="stacked">
                <label>
                  Список фамилий и имён
                  <textarea
                    className="bulk-import-textarea"
                    value={bulkValue}
                    onChange={event => setBulkValue(event.target.value)}
                    placeholder={'Например:\nИванов Сергей\nКапустин Илья'}
                  />
                </label>
                <p className="muted">
                  Каждая строка — отдельный игрок. Будет создан максимум 200 записей за один импорт.
                </p>
                <button
                  className="button-primary"
                  type="button"
                  onClick={handleBulkAdd}
                  disabled={bulkLoading}
                >
                  {bulkLoading ? 'Создаём…' : 'Создать и добавить'}
                </button>
              </div>
            </section>
            <section className="modal-panel">
              <header>
                <h5>Текущий состав ({roster.length})</h5>
                <p>Настройте игровые номера и удалите лишних игроков.</p>
              </header>
              <div className="roster-list">
                {sortedRoster.length === 0 ? (
                  <p className="empty-placeholder">
                    Состав пуст. Добавьте игроков через форму слева.
                  </p>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Игрок</th>
                        <th>№</th>
                        <th aria-label="Действия" />
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRoster.map(entry => (
                        <tr key={entry.personId}>
                          <td>
                            {entry.person.lastName} {entry.person.firstName}
                          </td>
                          <td>
                            <input
                              className="number-input"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={entry.defaultShirtNumber ?? ''}
                              onChange={event =>
                                handleNumberChange(entry.personId, event.target.value)
                              }
                            />
                          </td>
                          <td className="table-actions">
                            <button
                              type="button"
                              className="danger"
                              onClick={() => handleRemove(entry.personId)}
                            >
                              Удалить
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          </div>
          <footer className="modal-footer">
            <button className="button-secondary" type="button" onClick={onClose} disabled={saving}>
              Отмена
            </button>
            <button className="button-primary" type="submit" disabled={saving}>
              {saving ? 'Сохраняем…' : 'Сохранить состав'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
