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

const FORM_LABEL: Record<ClubSummaryResponse['form'][number]['result'], string> = {
  WIN: 'В',
  DRAW: 'Н',
  LOSS: 'П',
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
        const resultLabel = FORM_LABEL[entry.result]
        const formattedDate = formatDateTime(entry.matchDateTime).split(' ').slice(0, 1).join(' ')
        return (
          <div key={entry.matchId} className="team-form-item">
            <span className="team-form-date-compact">{formattedDate}</span>
            <div className="team-form-match">
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
              <span className={`team-form-result-badge tone-${tone}`}>{resultLabel}</span>
            </div>
            <span className="team-form-score-compact">
              {entry.score.home}-{entry.score.away}
            </span>
          </div>
        )
      })}
    </div>
  )
}

const renderSquad = (summary: ClubSummaryResponse) => {
  if (!summary.squad || summary.squad.length === 0) {
    return (
      <div className="team-view-feedback" role="status">
        Информация о составе команды пока недоступна.
      </div>
    )
  }

  return (
    <div className="team-squad-table-wrapper">
      <div role="table" className="team-squad-table">
        <div role="row" className="team-squad-row head">
          <span role="columnheader" className="col-num">#</span>
          <span role="columnheader" className="col-player">Игрок</span>
          <span role="columnheader" className="col-stat">И</span>
          <span role="columnheader" className="col-stat">ЖК</span>
          <span role="columnheader" className="col-stat">КК</span>
          <span role="columnheader" className="col-stat">П</span>
          <span role="columnheader" className="col-stat">Г</span>
        </div>
        {summary.squad.map((player, index) => (
          <div role="row" className="team-squad-row" key={player.playerId}>
            <span role="cell" className="col-num">{index + 1}</span>
            <span role="cell" className="col-player">{player.playerName}</span>
            <span role="cell" className="col-stat">{player.matches}</span>
            <span role="cell" className="col-stat">{player.yellowCards}</span>
            <span role="cell" className="col-stat">{player.redCards}</span>
            <span role="cell" className="col-stat">{player.assists}</span>
            <span role="cell" className="col-stat">{player.goals}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const renderOverview = (summary: ClubSummaryResponse) => {
  const stats = summary.statistics
  
  // Вычисляем процент каждого результата для полукруга
  const total = stats.wins + stats.draws + stats.losses
  const winPercent = total > 0 ? (stats.wins / total) * 100 : 0
  const drawPercent = total > 0 ? (stats.draws / total) * 100 : 0
  // Генерируем градиент с отступами между сегментами
  const generateArcGradient = () => {
    if (total === 0) return undefined
    
    const segments: string[] = []
    let currentPos = 0
    const gap = 1 // 1% отступ между сегментами
    
    // Победы (зелёный)
    if (stats.wins > 0) {
      segments.push(`rgba(0, 255, 128, 0.6) ${currentPos}%`)
      currentPos += winPercent
      segments.push(`rgba(0, 255, 128, 0.6) ${currentPos}%`)
      if (stats.draws > 0 || stats.losses > 0) {
        segments.push(`transparent ${currentPos}%`)
        currentPos += gap
        segments.push(`transparent ${currentPos}%`)
      }
    }
    
    // Ничьи (серый)
    if (stats.draws > 0) {
      segments.push(`rgba(255, 255, 255, 0.4) ${currentPos}%`)
      currentPos += drawPercent
      segments.push(`rgba(255, 255, 255, 0.4) ${currentPos}%`)
      if (stats.losses > 0) {
        segments.push(`transparent ${currentPos}%`)
        currentPos += gap
        segments.push(`transparent ${currentPos}%`)
      }
    }
    
    // Поражения (красный)
    if (stats.losses > 0) {
      segments.push(`rgba(255, 0, 100, 0.6) ${currentPos}%`)
      segments.push('rgba(255, 0, 100, 0.6) 100%')
    }
    
    return `linear-gradient(to right, ${segments.join(', ')})`
  }
  
  return (
    <>
      <section className="team-section">
        <h3 className="team-section-title">Форма</h3>
        {renderForm(summary)}
      </section>

      <div className="team-divider"></div>

      <section className="team-section">
        <h3 className="team-section-title">Статистика</h3>
        
        {/* Широкий блок с матчами и В/Н/П */}
        <div className="team-stats-wide-block">
          <div className="team-stats-matches">
            <div className="team-stats-arc" style={{
              background: generateArcGradient()
            }}></div>
            <span className="team-stats-matches-value">{stats.matchesPlayed}</span>
            <span className="team-stats-matches-label">матча</span>
          </div>
          <div className="team-stats-wdl">
            <div className="team-stats-wdl-item">
              <span className="team-stats-wdl-bullet">•</span>
              <span className="team-stats-wdl-label">Победы</span>
              <span className="team-stats-wdl-value">{stats.wins}</span>
            </div>
            <div className="team-stats-wdl-item">
              <span className="team-stats-wdl-bullet">•</span>
              <span className="team-stats-wdl-label">Ничьи</span>
              <span className="team-stats-wdl-value">{stats.draws}</span>
            </div>
            <div className="team-stats-wdl-item">
              <span className="team-stats-wdl-bullet">•</span>
              <span className="team-stats-wdl-label">Поражения</span>
              <span className="team-stats-wdl-value">{stats.losses}</span>
            </div>
          </div>
        </div>

        {/* Нижняя статистика: 2 ряда по 3 блока */}
        <div className="team-stats-grid">
          {/* Первый ряд */}
          <div className="team-stats-card">
            <span className="team-stats-card-icon">🏆</span>
            <span className="team-stats-card-value">{stats.tournaments}</span>
            <span className="team-stats-card-label">Турниры</span>
          </div>
          <div className="team-stats-card">
            <span className="team-stats-card-icon">⚽</span>
            <span className="team-stats-card-value">{stats.goalsFor}</span>
            <span className="team-stats-card-label">Забито</span>
          </div>
          <div className="team-stats-card">
            <span className="team-stats-card-icon">⚽</span>
            <span className="team-stats-card-value">{stats.goalsAgainst}</span>
            <span className="team-stats-card-label">Пропущено</span>
          </div>
          
          {/* Второй ряд */}
          <div className="team-stats-card">
            <span className="team-stats-card-icon">🟨</span>
            <span className="team-stats-card-value">{stats.yellowCards}</span>
            <span className="team-stats-card-label">Жёлтых</span>
          </div>
          <div className="team-stats-card">
            <span className="team-stats-card-icon">🟥</span>
            <span className="team-stats-card-value">{stats.redCards}</span>
            <span className="team-stats-card-label">Красных</span>
          </div>
          <div className="team-stats-card">
            <span className="team-stats-card-icon">🛡️</span>
            <span className="team-stats-card-value">{stats.cleanSheets}</span>
            <span className="team-stats-card-label">На «0»</span>
          </div>
        </div>
      </section>

      <div className="team-divider"></div>

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

    if (activeTab === 'squad') {
      return renderSquad(summary)
    }

    if (activeTab === 'matches') {
      return (
        <div className="team-view-feedback" role="status">
          Раздел в разработке — данные появятся позже.
        </div>
      )
    }

    return null
  }

  const header = summary ?? null
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
          <h2 id="team-view-title" className="sr-only">{header?.club.name ?? 'Клуб'}</h2>
          <button
            type="button"
            className="team-view-close"
            onClick={close}
            ref={closeButtonRef}
            aria-label="Закрыть"
          >
            ✕
          </button>
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
