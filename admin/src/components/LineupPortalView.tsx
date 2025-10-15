import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { formatPlayersCount } from '@shared/utils/wordForms'
import { lineupFetchMatches, lineupFetchRoster, lineupUpdateRoster } from '../api/adminClient'
import { useAdminStore } from '../store/adminStore'
import type { LineupPortalMatch, LineupPortalRosterEntry } from '../types'
import { formatDateTime } from '../utils/date'
import '../lineup.css'

const statusLabels: Record<LineupPortalMatch['status'], string> = {
  SCHEDULED: 'Запланирован',
  LIVE: 'В игре',
  FINISHED: 'Завершён',
  POSTPONED: 'Перенесён',
}

const formatKickoff = (iso: string) =>
  formatDateTime(iso, {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })

const formatMatchesRemaining = (count: number) => {
  const absCount = Math.max(0, count)
  const remainder10 = absCount % 10
  const remainder100 = absCount % 100
  if (remainder10 === 1 && remainder100 !== 11) return `${absCount} матч`
  if (remainder10 >= 2 && remainder10 <= 4 && (remainder100 < 10 || remainder100 >= 20))
    return `${absCount} матча`
  return `${absCount} матчей`
}

const getDisqualificationReasonLabel = (info: LineupPortalRosterEntry['disqualification']) => {
  if (!info) return null
  switch (info.reason) {
    case 'RED_CARD':
      return 'Красная карточка'
    case 'ACCUMULATED_CARDS':
      return 'Накопление карточек'
    case 'OTHER':
    default:
      return 'Санкция'
  }
}

const mapError = (code: string) => {
  switch (code) {
    case 'persons_not_in_roster':
      return 'Некоторые игроки отсутствуют в заявке сезона.'
    case 'club_not_in_match':
      return 'Выбранная команда не участвует в этом матче.'
    case 'match_not_found':
      return 'Матч не найден или удалён.'
    case 'payload_invalid':
      return 'Неверный формат данных. Попробуйте обновить страницу.'
    case 'player_disqualified':
      return 'Один или несколько игроков пропускают матч. Уберите их из заявки и попробуйте снова.'
    default:
      if (code.toLowerCase().includes('fetch')) {
        return 'Не удалось связаться с сервером. Проверьте подключение.'
      }
      return 'Не удалось выполнить запрос. Повторите попытку.'
  }
}

export const LineupPortalView = () => {
  const { lineupToken, logout } = useAdminStore(state => ({
    lineupToken: state.lineupToken,
    logout: state.logout,
  }))

  const [matches, setMatches] = useState<LineupPortalMatch[]>([])
  const [matchesLoading, setMatchesLoading] = useState(false)
  const [portalMessage, setPortalMessage] = useState<string | null>(null)
  const [portalError, setPortalError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [activeMatch, setActiveMatch] = useState<LineupPortalMatch | null>(null)
  const [activeClubId, setActiveClubId] = useState<number | null>(null)
  const [roster, setRoster] = useState<LineupPortalRosterEntry[]>([])
  const [rosterLoading, setRosterLoading] = useState(false)
  const [selectedPlayers, setSelectedPlayers] = useState<Record<number, boolean>>({})
  const [shirtNumbers, setShirtNumbers] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)

  const selectedCount = useMemo(
    () =>
      roster.reduce<number>(
        (count: number, entry: LineupPortalRosterEntry) =>
          entry.disqualification || !selectedPlayers[entry.personId] ? count : count + 1,
        0
      ),
    [roster, selectedPlayers]
  )

  const resetModalState = () => {
    setActiveMatch(null)
    setActiveClubId(null)
    setRoster([])
    setSelectedPlayers({})
    setShirtNumbers({})
    setModalError(null)
    setModalOpen(false)
  }

  const handleUnauthorized = useCallback(() => {
    setPortalError('Сессия истекла. Авторизуйтесь заново.')
    logout()
  }, [logout])

  const fetchMatches = useCallback(async (options?: { preserveMessage?: boolean }) => {
    if (!lineupToken) return
    setMatchesLoading(true)
    setPortalError(null)
    if (!options?.preserveMessage) {
      setPortalMessage(null)
    }
    try {
      const data = await lineupFetchMatches(lineupToken)
      setMatches(data)
      if (!data.length) {
        setPortalMessage('В ближайшие сутки матчей не найдено. Проверьте позже.')
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      if (code === 'unauthorized') {
        handleUnauthorized()
      } else {
        setPortalError(mapError(code))
      }
    } finally {
      setMatchesLoading(false)
    }
  }, [lineupToken, handleUnauthorized])

  useEffect(() => {
    if (lineupToken) {
      void fetchMatches()
    }
  }, [lineupToken, fetchMatches])

  const openMatchModal = (match: LineupPortalMatch) => {
    setActiveMatch(match)
    setActiveClubId(match.homeClub.id)
    setModalOpen(true)
    setRoster([])
    setSelectedPlayers({})
    setShirtNumbers({})
    setModalError(null)
  }

  const closeModal = () => {
    resetModalState()
  }

  useEffect(() => {
    const loadRoster = async () => {
      if (!modalOpen || !lineupToken || !activeMatch || !activeClubId) return
      setRosterLoading(true)
      setPortalError(null)
      setModalError(null)
      try {
        const data = await lineupFetchRoster(lineupToken, activeMatch.id, activeClubId)
        setRoster(data)
        const selected: Record<number, boolean> = {}
        const numbers: Record<number, string> = {}
        data.forEach(entry => {
          selected[entry.personId] = entry.disqualification ? false : entry.selected
          numbers[entry.personId] = entry.shirtNumber ? String(entry.shirtNumber) : ''
        })
        setSelectedPlayers(selected)
        setShirtNumbers(numbers)
      } catch (error) {
        const code = error instanceof Error ? error.message : ''
        if (code === 'unauthorized') {
          handleUnauthorized()
        } else {
          setModalError(mapError(code))
        }
        resetModalState()
      } finally {
        setRosterLoading(false)
      }
    }

    void loadRoster()
  }, [modalOpen, lineupToken, activeMatch, activeClubId, handleUnauthorized])

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
    if (!lineupToken || !activeMatch || !activeClubId) return
    const selectedEntries: LineupPortalRosterEntry[] = roster.filter(
      (entry: LineupPortalRosterEntry) => selectedPlayers[entry.personId]
    )
    const payloadIds = selectedEntries.map(entry => entry.personId)

    const missingNumber = selectedEntries.some(entry => {
      const raw = shirtNumbers[entry.personId]
      return !raw || raw.trim() === ''
    })

    if (missingNumber) {
      setModalError('Для каждого выбранного игрока укажите номер.')
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
    setPortalMessage(null)
    try {
      await lineupUpdateRoster(lineupToken, activeMatch.id, {
        clubId: activeClubId,
        personIds: payloadIds,
        numbers: numberAssignments,
      })
      const clubName =
        activeMatch.homeClub.id === activeClubId
          ? activeMatch.homeClub.name
          : activeMatch.awayClub.name
      setPortalMessage(
        `${clubName}: Состав сохранён. В заявке: ${formatPlayersCount(payloadIds.length)}.`
      )
      closeModal()
      void fetchMatches({ preserveMessage: true })
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      if (code === 'unauthorized') {
        handleUnauthorized()
      } else {
        setModalError(mapError(code))
      }
    } finally {
      setSaving(false)
    }
  }

  if (!lineupToken) {
    return (
      <div className="portal-root">
        <div className="portal-shell" style={{ alignItems: 'center', textAlign: 'center' }}>
          <h2>Токен не найден</h2>
          <p>Сессия недоступна. Выполните вход снова.</p>
          <button type="button" className="portal-primary" onClick={() => logout()}>
            На страницу входа
          </button>
        </div>
      </div>
    )
  }

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
            const isActive = activeMatch?.id === match.id
            return (
              <li key={match.id} className={isActive ? 'active' : undefined}>
                <button type="button" onClick={() => openMatchModal(match)}>
                  <span className="match-date">{formatKickoff(match.matchDateTime)}</span>
                  <span className="match-round">{roundLabel}</span>
                  <span className="match-opponent">{title}</span>
                  <span className="match-venue">Статус: {statusLabels[match.status]}</span>
                </button>
              </li>
            )
          })}
        </ul>
        {matches.length === 0 ? (
          <p className="portal-hint">Нет матчей для подтверждения состава.</p>
        ) : null}
      </aside>

      <section className="portal-card">
        <header className="portal-card-header">
          <h2>Инструкция</h2>
          <button type="button" className="portal-ghost" onClick={() => logout()}>
            Выйти
          </button>
        </header>
        <ol className="portal-steps">
          <li>Выберите матч слева. Доступны игры, которые начнутся в ближайшие сутки.</li>
          <li>Определите свою команду (дом или гости) в открывшемся окне.</li>
          <li>
            Отметьте игроков, которые выйдут на поле. Менять состав можно до стартового свистка.
          </li>
        </ol>
        <p className="portal-hint">
          Если состав меняется в последний момент, обновите список перед стартом матча.
        </p>
      </section>
    </div>
  )

  const renderModal = () => {
    if (!modalOpen || !activeMatch || !activeClubId) return null
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
            <button type="button" className="portal-ghost" onClick={closeModal}>
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
            <h1>Портал капитана</h1>
            <p>Подтвердите состав своей команды перед матчем.</p>
          </div>
          <div className="portal-badge" title="Линия связи активна">
            ✅
          </div>
        </header>

        {portalMessage ? <div className="portal-feedback success">{portalMessage}</div> : null}
        {portalError ? <div className="portal-feedback error">{portalError}</div> : null}

        {renderMatches()}
      </div>
      {renderModal()}
    </div>
  )
}
