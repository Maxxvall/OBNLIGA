import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { formatPlayersCount } from '@shared/utils/wordForms'
import './app.css'

type LineupMatch = {
  id: string
  matchDateTime: string
  status: 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'POSTPONED'
  season: { id: number; name: string }
  round?: { id: number; label: string | null }
  homeClub: { id: number; name: string; shortName: string; logoUrl?: string | null }
  awayClub: { id: number; name: string; shortName: string; logoUrl?: string | null }
}

type DisqualificationInfo = {
  reason: 'RED_CARD' | 'ACCUMULATED_CARDS' | 'OTHER'
  sanctionDate: string
  banDurationMatches: number
  matchesMissed: number
  matchesRemaining: number
}

type LineupRosterEntry = {
  personId: number
  person: { id: number; firstName: string; lastName: string }
  shirtNumber: number
  selected: boolean
  disqualification: DisqualificationInfo | null
}

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string }

const formatKickoff = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })

const API_BASE_RAW = import.meta.env.VITE_LINEUP_API_BASE ?? ''
const API_BASE_URL = API_BASE_RAW ? API_BASE_RAW.replace(/\/$/, '') : ''
const buildApiUrl = (path: string) => {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return API_BASE_URL ? `${API_BASE_URL}${normalized}` : normalized
}

const formatMatchesRemaining = (count: number) => {
  const absCount = Math.max(0, count)
  const remainder10 = absCount % 10
  const remainder100 = absCount % 100
  if (remainder10 === 1 && remainder100 !== 11) return `${absCount} матч`
  if (remainder10 >= 2 && remainder10 <= 4 && (remainder100 < 10 || remainder100 >= 20))
    return `${absCount} матча`
  return `${absCount} матчей`
}

const DISQUALIFICATION_LABELS: Record<DisqualificationInfo['reason'], string> = {
  RED_CARD: 'Красная карточка',
  ACCUMULATED_CARDS: 'Накопление карточек',
  OTHER: 'Санкция',
}

const getDisqualificationReasonLabel = (info: DisqualificationInfo | null) =>
  info ? DISQUALIFICATION_LABELS[info.reason] ?? 'Санкция' : null

const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: 'Неверный логин или пароль.',
  unauthorized: 'Сессия истекла. Войдите заново.',
  persons_not_in_roster: 'Некоторые игроки отсутствуют в заявке сезона.',
  club_not_in_match: 'Выбранная команда не участвует в этом матче.',
  match_not_found: 'Матч не найден или удалён.',
  shirt_invalid: 'Укажите корректные номера для всех игроков.',
  duplicate_shirt_numbers: 'Номера игроков внутри клуба должны быть уникальными.',
  player_disqualified:
    'Один или несколько игроков пропускают матч. Уберите их из заявки и попробуйте снова.',
}

const mapError = (code: string) =>
  ERROR_MESSAGES[code] ?? 'Не удалось выполнить запрос. Повторите попытку.'

const LineupPortal: React.FC = () => {
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('lineupToken'))
  const [matches, setMatches] = useState<LineupMatch[]>([])
  const [matchesLoading, setMatchesLoading] = useState(false)
  const [portalMessage, setPortalMessage] = useState<string | null>(null)
  const [portalError, setPortalError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [activeMatch, setActiveMatch] = useState<LineupMatch | null>(null)
  const [activeClubId, setActiveClubId] = useState<number | null>(null)
  const [roster, setRoster] = useState<LineupRosterEntry[]>([])
  const [rosterLoading, setRosterLoading] = useState(false)
  const [selectedPlayers, setSelectedPlayers] = useState<Record<number, boolean>>({})
  const [shirtNumbers, setShirtNumbers] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState<{ message: string; clubName: string } | null>(null)

  const selectedCount = useMemo(
    () =>
      roster.reduce<number>(
        (count: number, entry: LineupRosterEntry) =>
          entry.disqualification || !selectedPlayers[entry.personId] ? count : count + 1,
        0
      ),
    [roster, selectedPlayers]
  )

  const resetState = useCallback(() => {
    setMatches([])
    setActiveMatch(null)
    setActiveClubId(null)
    setRoster([])
    setSelectedPlayers({})
    setShirtNumbers({})
    setModalError(null)
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    localStorage.removeItem('lineupToken')
    resetState()
  }, [resetState])

  const apiRequest = useCallback(
    async <T,>(path: string, init?: RequestInit, requireAuth = true): Promise<T> => {
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      }
      if (requireAuth) {
        if (!token) {
          throw new Error('unauthorized')
        }
        headers.Authorization = `Bearer ${token}`
      }

      const response = await fetch(buildApiUrl(path), {
        ...init,
        headers: {
          ...headers,
          ...(init?.headers ?? {}),
        },
      })

      if (response.status === 401) {
        throw new Error('unauthorized')
      }

      const payload = (await response.json()) as ApiResponse<T> | { ok: true; token: string }

      if ('token' in payload) {
        return payload as unknown as T
      }

      if (!payload.ok) {
        throw new Error(payload.error)
      }

      return payload.data
    },
    [token]
  )

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPortalError(null)
    setPortalMessage(null)

    if (!login.trim() || !password.trim()) {
      setPortalError('Введите логин и пароль, выданные администратором.')
      return
    }

    try {
      const payload = await apiRequest<{ ok: true; token: string }>(
        '/api/lineup-portal/login',
        {
          method: 'POST',
          body: JSON.stringify({ login, password }),
        },
        false
      )

      if (payload && 'token' in payload) {
        localStorage.setItem('lineupToken', payload.token)
        setToken(payload.token)
        setPortalMessage('Вход выполнен. Выберите матч для подтверждения состава.')
        setPassword('')
      }
    } catch (error) {
      setPortalError(mapError(error instanceof Error ? error.message : ''))
    }
  }

  const fetchMatches = useCallback(async () => {
    if (!token) return
    setMatchesLoading(true)
    setPortalError(null)
    try {
      const data = await apiRequest<LineupMatch[]>('/api/lineup-portal/matches')
      setMatches(data)
      if (!data.length) {
        setPortalMessage('В ближайшие сутки матчей не найдено. Проверьте позже.')
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      if (code === 'unauthorized') {
        logout()
        setPortalError('Сессия истекла. Пожалуйста, войдите снова.')
      } else {
        setPortalError(mapError(code))
      }
    } finally {
      setMatchesLoading(false)
    }
  }, [token, apiRequest, logout])

  useEffect(() => {
    if (token) {
      void fetchMatches()
    }
  }, [token, fetchMatches])

  const openMatchModal = (match: LineupMatch) => {
    setActiveMatch(match)
    setActiveClubId(match.homeClub.id)
    setModalOpen(true)
    setRoster([])
    setSelectedPlayers({})
    setModalError(null)
    setSaveSuccess(null)
  }

  const closeModal = () => {
    setModalOpen(false)
    setActiveClubId(null)
    setRoster([])
    setSelectedPlayers({})
    setShirtNumbers({})
    setModalError(null)
    // Не очищаем saveSuccess, чтобы показать сообщение
  }

  useEffect(() => {
    const loadRoster = async () => {
      if (!modalOpen || !token || !activeMatch || !activeClubId) return
      setRosterLoading(true)
      setPortalError(null)
      setModalError(null)
      try {
        const data = await apiRequest<LineupRosterEntry[]>(
          `/api/lineup-portal/matches/${activeMatch.id}/roster?clubId=${activeClubId}`
        )
        setRoster(data)
        const selectedMap: Record<number, boolean> = {}
        const numbersMap: Record<number, string> = {}
        data.forEach(entry => {
          selectedMap[entry.personId] = entry.disqualification ? false : entry.selected
          numbersMap[entry.personId] = String(entry.shirtNumber ?? '')
        })
        setSelectedPlayers(selectedMap)
        setShirtNumbers(numbersMap)
      } catch (error) {
        const code = error instanceof Error ? error.message : ''
        if (code === 'unauthorized') {
          logout()
          setPortalError('Сессия истекла. Войдите заново, чтобы продолжить.')
          setModalOpen(false)
        } else {
          setModalError(mapError(code))
        }
      } finally {
        setRosterLoading(false)
      }
    }

    void loadRoster()
  }, [modalOpen, token, activeMatch, activeClubId, apiRequest, logout])

  const handlePlayerToggle = (personId: number) => {
    if (saving) return
    const entry = roster.find(item => item.personId === personId)
    if (!entry) return

    if (entry.disqualification) {
      const surname = `${entry.person.lastName} ${entry.person.firstName}`.trim()
      const reasonLabel = getDisqualificationReasonLabel(entry.disqualification)
      const matchesNote = entry.disqualification
        ? ` Осталось ${formatMatchesRemaining(entry.disqualification.matchesRemaining)}.`
        : ''
      setModalError(
        `${surname} пропускает матч${reasonLabel ? ` (${reasonLabel})` : ''}. Уберите его из заявки.${matchesNote}`
      )
      return
    }

    setModalError(previous => (previous && previous.includes('пропускает матч') ? null : previous))
    setSelectedPlayers((prev: Record<number, boolean>) => ({
      ...prev,
      [personId]: !prev[personId],
    }))
  }

  const updateShirtNumber = (personId: number, value: string) => {
    setShirtNumbers((prev: Record<number, string>) => ({ ...prev, [personId]: value }))
  }

  const handleSubmitRoster = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!activeMatch || !activeClubId) return
    const selectedEntries: LineupRosterEntry[] = roster.filter((entry: LineupRosterEntry) => {
      if (entry.disqualification) return false
      return selectedPlayers[entry.personId]
    })
    const payloadIds = selectedEntries.map(entry => entry.personId)

    const missingNumber = selectedEntries.some(entry => {
      const raw = shirtNumbers[entry.personId]
      return !raw || raw.trim() === ''
    })

    if (missingNumber) {
      setModalError('Укажите номер для каждого выбранного игрока.')
      return
    }

    const numberAssignments: Array<{ personId: number; shirtNumber: number }> = selectedEntries.map(
      entry => ({
        personId: entry.personId,
        shirtNumber: Number(shirtNumbers[entry.personId]),
      })
    )

    const hasInvalidNumber = numberAssignments.some(
      ({ shirtNumber }) =>
        !Number.isFinite(shirtNumber) ||
        !Number.isInteger(shirtNumber) ||
        shirtNumber <= 0 ||
        shirtNumber > 999
    )

    if (hasInvalidNumber) {
      setModalError('Укажите корректные номера от 1 до 999 для всех выбранных игроков.')
      return
    }

    const uniqueNumbers = new Set(numberAssignments.map(({ shirtNumber }) => shirtNumber))
    if (uniqueNumbers.size !== numberAssignments.length) {
      setModalError('Номера игроков внутри клуба должны быть уникальными.')
      return
    }

    setSaving(true)
    setPortalError(null)
    setModalError(null)
    try {
      await apiRequest<{ ok: true }>(`/api/lineup-portal/matches/${activeMatch.id}/roster`, {
        method: 'PUT',
        body: JSON.stringify({
          clubId: activeClubId,
          personIds: payloadIds,
          numbers: numberAssignments,
        }),
      })
      const clubName =
        activeMatch.homeClub.id === activeClubId
          ? activeMatch.homeClub.name
          : activeMatch.awayClub.name
      setSaveSuccess({
        message: `Состав сохранён. В заявке: ${formatPlayersCount(payloadIds.length)}.`,
        clubName,
      })
      closeModal()
      if (typeof window !== 'undefined') {
        window.requestAnimationFrame(() => {
          window.scrollTo({ top: 0, behavior: 'smooth' })
        })
      }
      void fetchMatches()
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      if (code === 'unauthorized') {
        logout()
        setPortalError('Сессия истекла. Авторизуйтесь повторно.')
      } else {
        setModalError(mapError(code))
      }
    } finally {
      setSaving(false)
    }
  }

  const renderLogin = () => (
    <form className="portal-form" onSubmit={handleLogin}>
      <label>
        Логин
        <input
          value={login}
          onChange={event => setLogin(event.target.value)}
          placeholder="например, captain01"
        />
      </label>
      <label>
        Пароль
        <input
          type="password"
          value={password}
          onChange={event => setPassword(event.target.value)}
          placeholder="получите у администратора"
        />
      </label>
      <button type="submit" className="portal-primary">
        Войти
      </button>
      <p className="portal-hint">
        Доступ получают капитаны команд. После авторизации выберите матч в ближайшие сутки.
      </p>
    </form>
  )

  const renderMatches = () => (
    <div className="portal-grid">
      <aside className="portal-card">
        <header className="portal-card-header">
          <h2>Ближайшие матчи</h2>
          <button
            type="button"
            className="portal-ghost"
            onClick={() => void fetchMatches()}
            disabled={matchesLoading}
          >
            {matchesLoading ? 'Обновляем…' : 'Обновить'}
          </button>
        </header>
        <p className="portal-sub">Отображаются игры в ближайшие 24 часа.</p>
        <ul className="portal-match-list">
          {matches.map(match => {
            const title = `${match.homeClub.name} vs ${match.awayClub.name}`
            const roundLabel = match.round?.label ? match.round.label : 'Без стадии'
            return (
              <li key={match.id}>
                <button type="button" onClick={() => openMatchModal(match)}>
                  <span className="match-date">{formatKickoff(match.matchDateTime)}</span>
                  <span className="match-round">{roundLabel}</span>
                  <span className="match-opponent">{title}</span>
                  <span className="match-venue">
                    Статус:{' '}
                    {match.status === 'SCHEDULED'
                      ? 'Запланирован'
                      : match.status === 'LIVE'
                        ? 'В игре'
                        : match.status === 'FINISHED'
                          ? 'Завершён'
                          : 'Перенесён'}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        {matches.length === 0 ? (
          <p className="portal-hint">Нет матчей, требующих подтверждения состава.</p>
        ) : null}
      </aside>

      <section className="portal-card">
        <header className="portal-card-header">
          <h2>Инструкция</h2>
          <button type="button" className="portal-ghost" onClick={logout}>
            Выйти
          </button>
        </header>
        <ol className="portal-steps">
          <li>Выберите матч из списка слева. Доступны игры, которые начнутся в ближайшие сутки.</li>
          <li>В появившемся окне выберите свою команду (дом или гости).</li>
          <li>
            Отметьте галочками игроков, которые выйдут на поле. Можно отмечать и снимать отметки до
            свистка.
          </li>
          <li>
            Сохраните изменения — игрокам сразу зачтётся +1 игра, а матч появится в админке с
            подтверждённым составом.
          </li>
        </ol>
        <p className="portal-hint">
          Если состав меняется в последний момент, откройте матч снова и обновите список перед
          стартом.
        </p>
      </section>
    </div>
  )

  const renderModal = () => {
    if (!modalOpen || !activeMatch) return null
    const homeActive = activeClubId === activeMatch.homeClub.id
    const awayActive = activeClubId === activeMatch.awayClub.id

    return (
      <div className="portal-overlay" role="dialog" aria-modal="true">
        <div className="portal-modal">
          <header className="portal-modal-header">
            <div>
              <h3>Подтверждение состава</h3>
              <p>
                {formatKickoff(activeMatch.matchDateTime)} · {activeMatch.homeClub.name} vs{' '}
                {activeMatch.awayClub.name}
              </p>
            </div>
            <button
              type="button"
              className="portal-ghost"
              onClick={closeModal}
              aria-label="Закрыть окно"
            >
              Закрыть
            </button>
          </header>

          <div className="club-switcher">
            <button
              type="button"
              className={`club-chip${homeActive ? ' active' : ''}`}
              onClick={() => setActiveClubId(activeMatch.homeClub.id)}
            >
              {activeMatch.homeClub.name}
            </button>
            <button
              type="button"
              className={`club-chip${awayActive ? ' active' : ''}`}
              onClick={() => setActiveClubId(activeMatch.awayClub.id)}
            >
              {activeMatch.awayClub.name}
            </button>
          </div>

          <form className="portal-roster" onSubmit={handleSubmitRoster}>
            {modalError ? <div className="portal-feedback error in-modal">{modalError}</div> : null}
            {rosterLoading ? <p className="portal-hint">Загружаем заявку клуба…</p> : null}
            <div className="portal-roster-grid">
              {roster.map(entry => {
                const checked = Boolean(selectedPlayers[entry.personId])
                const surname = `${entry.person.lastName} ${entry.person.firstName}`.trim()
                const disqualified = Boolean(entry.disqualification)
                const reasonLabel = getDisqualificationReasonLabel(entry.disqualification)

                return (
                  <div
                    key={entry.personId}
                    className={`roster-card${checked ? ' selected' : ''}${disqualified ? ' disqualified' : ''}`}
                  >
                    <div className="player-number">
                      <input
                        type="number"
                        className="player-number-input"
                        value={shirtNumbers[entry.personId] ?? ''}
                        onChange={event => updateShirtNumber(entry.personId, event.target.value)}
                        min={1}
                        max={999}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        disabled={saving || disqualified}
                        aria-label={`Номер для ${surname}`}
                        placeholder="№"
                      />
                    </div>
                    <button
                      type="button"
                      className="player-toggle"
                      role="checkbox"
                      aria-checked={checked}
                      aria-label={`Игрок ${surname}`}
                      aria-disabled={disqualified || saving}
                      onClick={() => handlePlayerToggle(entry.personId)}
                      data-disqualified={disqualified ? 'true' : undefined}
                    >
                      <span className="checkbox-visual" aria-hidden="true" />
                      <span className="player-text">
                        <span className="player-name">{surname}</span>
                        {disqualified && reasonLabel ? (
                          <span className="player-badge">
                            {reasonLabel} · осталось{' '}
                            {formatMatchesRemaining(entry.disqualification!.matchesRemaining)}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </div>
                )
              })}
            </div>
            <footer className="portal-actions">
              <span>
                Отмечено: {selectedCount} из {roster.length}
              </span>
              <button type="submit" className="portal-primary" disabled={saving}>
                {saving ? 'Сохраняем…' : `Сохранить состав (${selectedCount})`}
              </button>
            </footer>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="portal-root">
      <div className="portal-accent" aria-hidden />
      <div className="portal-shell">
        <header className="portal-header">
          <div>
            <h1>Протокол матча</h1>
            <p>
              Подтвердите состав, чтобы участникам сразу засчиталась игра и админ получил готовую
              заявку.
            </p>
          </div>
          <span className="portal-badge">β</span>
        </header>

        {portalMessage ? <div className="portal-feedback success">{portalMessage}</div> : null}
        {portalError ? <div className="portal-feedback error">{portalError}</div> : null}
        {saveSuccess ? (
          <div className="portal-feedback success">
            <strong>{saveSuccess.clubName}:</strong> {saveSuccess.message}
            <button
              type="button"
              className="feedback-close"
              onClick={() => setSaveSuccess(null)}
              aria-label="Закрыть сообщение"
            >
              ×
            </button>
          </div>
        ) : null}

        {!token ? renderLogin() : renderMatches()}
      </div>

      {renderModal()}
    </div>
  )
}

export default LineupPortal
