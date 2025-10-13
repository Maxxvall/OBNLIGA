import React, { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ClubSummaryResponse } from '@shared/types'
import { useAppStore, TeamSubTab } from '../../store/appStore'
import '../../styles/teamView.css'

const TAB_CONFIG: Array<{ key: TeamSubTab; label: string }> = [
  { key: 'overview', label: 'Обзор' },
  { key: 'matches', label: 'Матчи' },
  { key: 'squad', label: 'Состав' },
]

const formatDateTime = (value?: string) => {
  if (!value) {
    return ''
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const STAT_LABELS: Array<{
  key: keyof ClubSummaryResponse['statistics']
  label: string
  hint?: string
}> = [
  { key: 'matchesPlayed', label: 'Матчи', hint: 'Всего сыграно' },
  { key: 'wins', label: 'Победы' },
  { key: 'draws', label: 'Ничьи' },
  { key: 'losses', label: 'Поражения' },
  { key: 'goalsFor', label: 'Забито' },
  { key: 'goalsAgainst', label: 'Пропущено' },
  { key: 'cleanSheets', label: 'Сухие матчи' },
  { key: 'yellowCards', label: 'Жёлтые' },
  { key: 'redCards', label: 'Красные' },
]

const FORM_LABEL: Record<ClubSummaryResponse['form'][number]['result'], string> = {
  WIN: 'Победа',
  DRAW: 'Ничья',
  LOSS: 'Поражение',
}

const FORM_TONE: Record<ClubSummaryResponse['form'][number]['result'], string> = {
  WIN: 'win',
  DRAW: 'draw',
  LOSS: 'loss',
}

const getRoot = () => {
  if (typeof document === 'undefined') {
    return null
  }
  let host = document.getElementById('team-view-root')
  if (!host) {
    host = document.createElement('div')
    host.id = 'team-view-root'
    document.body.appendChild(host)
  }
  return host
}

const useBodyScrollLock = (active: boolean) => {
  useEffect(() => {
    if (!active || typeof document === 'undefined') {
      return
    }
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = original
    }
  }, [active])
}

const useEscClose = (enabled: boolean, close: () => void) => {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return
    }
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [enabled, close])
}

const formatOpponent = (summary: ClubSummaryResponse['form'][number]) => {
  const descriptor = summary.isHome ? 'Дом' : 'В гостях'
  const opponentLabel = summary.opponent.shortName || summary.opponent.name
  return `${descriptor} · ${opponentLabel}`
}

const renderAchievements = (summary: ClubSummaryResponse) => {
  if (summary.achievements.length === 0) {
    return (
      <div className="team-achievements-empty" role="status">
        Достижения клуба появятся после публикации администратором.
      </div>
    )
  }
  return (
    <ul className="team-achievements-list">
      {summary.achievements.map(item => (
        <li key={item.id} className="team-achievement">
          <span className="team-achievement-title">{item.title}</span>
          {item.subtitle && <span className="team-achievement-subtitle">{item.subtitle}</span>}
        </li>
      ))}
    </ul>
  )
}

const renderForm = (summary: ClubSummaryResponse) => {
  if (summary.form.length === 0) {
    return (
      <div className="team-form-empty" role="status">
        У клуба пока нет сыгранных матчей.
      </div>
    )
  }
  return (
    <div className="team-form-compact">
      {summary.form.map(entry => {
        const tone = FORM_TONE[entry.result]
        const formattedDate = formatDateTime(entry.matchDateTime).split(' ').slice(0, 1).join(' ')
        return (
          <div key={entry.matchId} className="team-form-item">
            <span className="team-form-date-compact">{formattedDate}</span>
            {entry.opponent.logoUrl ? (
              <img
                src={entry.opponent.logoUrl}
                alt=""
                aria-hidden="true"
                className="team-form-logo"
              />
            ) : (
              <span className="team-form-logo fallback" aria-hidden="true">
                {entry.opponent.shortName.slice(0, 2).toUpperCase()}
              </span>
            )}
            <span className="team-form-score-compact">
              {entry.score.home}-{entry.score.away}
            </span>
            <span className={`team-form-badge tone-${tone}`}>{entry.result.charAt(0)}</span>
          </div>
        )
      })}
    </div>
  )
}

const renderOverview = (summary: ClubSummaryResponse) => {
  const stats = summary.statistics
  return (
    <>
      <section className="team-section">
        <h3 className="team-section-title">Форма</h3>
        {renderForm(summary)}
      </section>

      <section className="team-section">
        <h3 className="team-section-title">Статистика</h3>
        <div className="team-overview-grid">
          {STAT_LABELS.map(item => (
            <div key={item.key} className="team-overview-card">
              <span className="team-overview-value">{stats[item.key]}</span>
              <span className="team-overview-label">{item.label}</span>
              {item.hint && <span className="team-overview-hint">{item.hint}</span>}
            </div>
          ))}
        </div>
      </section>

      <section className="team-section">
        <h3 className="team-section-title">Достижения</h3>
        {renderAchievements(summary)}
      </section>
    </>
  )
}

export const TeamView: React.FC = () => {
  const open = useAppStore(state => state.teamView.open)
  const clubId = useAppStore(state => state.teamView.clubId)
  const activeTab = useAppStore(state => state.teamView.activeTab)
  const close = useAppStore(state => state.closeTeamView)
  const setTab = useAppStore(state => state.setTeamSubTab)
  const summaries = useAppStore(state => state.teamSummaries)
  const loadingId = useAppStore(state => state.teamSummaryLoadingId)
  const errors = useAppStore(state => state.teamSummaryErrors)
  const fetchSummary = useAppStore(state => state.fetchClubSummary)

  const summary = clubId !== undefined ? summaries[clubId] : undefined
  const isLoading = clubId !== undefined && loadingId === clubId
  const error = clubId !== undefined ? errors[clubId] : undefined

  useBodyScrollLock(open)
  useEscClose(open, close)

  const closeButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (open && closeButtonRef.current) {
      closeButtonRef.current.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open || !clubId) {
      return
    }
    if (!summary && !isLoading && !error) {
      void fetchSummary(clubId)
    }
  }, [open, clubId, summary, isLoading, error, fetchSummary])

  const host = useMemo(getRoot, [])
  if (!open || !clubId || !host) {
    return null
  }

  const handleRetry = () => {
    if (clubId) {
      void fetchSummary(clubId, { force: true })
    }
  }

  const renderContent = () => {
    if (isLoading && !summary) {
      return (
        <div className="team-view-feedback" aria-busy="true">
          Загружаем данные клуба…
        </div>
      )
    }

    if (error && !summary) {
      return (
        <div className="team-view-feedback error" role="alert">
          <p>Не удалось получить данные клуба. Код: {error}</p>
          <button type="button" className="button-secondary" onClick={handleRetry}>
            Повторить
          </button>
        </div>
      )
    }

    if (!summary) {
      return null
    }

    if (activeTab === 'overview') {
      return (
        <>
          {error && (
            <div className="team-view-feedback warning" role="status">
              Показаны сохранённые данные. Последний запрос завершился с ошибкой: {error}
            </div>
          )}
          {renderOverview(summary)}
        </>
      )
    }

    if (activeTab === 'matches' || activeTab === 'squad') {
      return (
        <div className="team-view-feedback" role="status">
          Раздел в разработке — данные появятся позже.
        </div>
      )
    }

    return null
  }

  const header = summary ?? null
  const updatedAt = summary ? formatDateTime(summary.generatedAt) : undefined

  return createPortal(
    <div className="team-view-backdrop" role="presentation" onClick={close}>
      <section
        className="team-view-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-view-title"
        onClick={event => event.stopPropagation()}
      >
        <header className="team-view-header">
          <div className="team-view-title-block">
            {header?.club.logoUrl ? (
              <img
                src={header.club.logoUrl}
                alt={`Логотип клуба ${header.club.name}`}
                className="team-view-logo"
              />
            ) : (
              <span className="team-view-logo fallback" aria-hidden>
                {header?.club.shortName.slice(0, 2).toUpperCase() ?? '??'}
              </span>
            )}
            <div className="team-view-heading">
              <h2 id="team-view-title">{header?.club.name ?? 'Клуб'}</h2>
              <span className="team-view-meta">{updatedAt ? `Обновлено ${updatedAt}` : 'Актуальные данные'}</span>
            </div>
          </div>
          <div className="team-view-actions">
            <button
              type="button"
              className="button-secondary"
              onClick={handleRetry}
              disabled={isLoading}
            >
              Обновить
            </button>
            <button
              type="button"
              className="button-primary"
              onClick={close}
              ref={closeButtonRef}
            >
              Закрыть
            </button>
          </div>
        </header>

        <nav className="team-view-tabs" aria-label="Разделы клуба">
          {TAB_CONFIG.map(tab => (
            <button
              key={tab.key}
              type="button"
              className={`team-view-tab${tab.key === activeTab ? ' active' : ''}`}
              onClick={() => setTab(tab.key)}
              aria-pressed={tab.key === activeTab}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="team-view-body">{renderContent()}</div>
      </section>
    </div>,
    host
  )
}
