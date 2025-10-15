import React from 'react'
import type { LeagueTableResponse } from '@shared/types'
import { useAppStore } from '../../store/appStore'

type LeagueTableViewProps = {
  table?: LeagueTableResponse
  loading: boolean
  error?: string
  onRetry: () => void
  lastUpdated?: number
}

const formatTime = (value?: number): string => {
  if (!value) return ''
  const date = new Date(value)
  return date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export const LeagueTableView: React.FC<LeagueTableViewProps> = ({
  table,
  loading,
  error,
  onRetry,
  lastUpdated,
}) => {
  const openTeamView = useAppStore(state => state.openTeamView)

  const isInitialLoading = loading && !table
  if (isInitialLoading) {
    return (
      <div className="league-table-placeholder" aria-live="polite" aria-busy="true">
        <div className="skeleton skeleton-heading" />
        <div className="skeleton skeleton-row" />
        <div className="skeleton skeleton-row" />
        <div className="skeleton skeleton-row" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="inline-feedback error" role="alert">
        <div>Не удалось загрузить таблицу. Код: {error}</div>
        <button type="button" className="button-secondary" onClick={onRetry}>
          Повторить
        </button>
      </div>
    )
  }

  if (!table) {
    return (
      <div className="inline-feedback info" role="status">
        Данные таблицы пока недоступны.
      </div>
    )
  }

  const { season, standings } = table
  const updatedLabel = lastUpdated ? `Обновлено в ${formatTime(lastUpdated)}` : 'Актуальные данные'
  const isRefreshing = loading && Boolean(table)

  return (
    <section className="league-table" aria-label="Турнирная таблица" data-refreshing={isRefreshing || undefined}>
      <header className="league-table-header">
        <div>
          <h2>{season.name}</h2>
          <p>{season.competition.name}</p>
        </div>
        <span className="muted">{updatedLabel}</span>
      </header>
      <div className="league-table-scroll">
        <div role="table" className="league-table-grid">
          <div role="row" className="league-table-row head">
            <span role="columnheader" className="col-pos">
              №
            </span>
            <span role="columnheader" className="col-logo">
              Лого
            </span>
            <span role="columnheader" className="col-club">
              Клуб
            </span>
            <span role="columnheader" className="col-record">
              В/Н/П
            </span>
            <span role="columnheader" className="col-score">
              ЗП
            </span>
            <span role="columnheader" className="col-diff">
              РГ
            </span>
            <span role="columnheader" className="col-points">
              О
            </span>
          </div>
          {standings.length === 0 ? (
            <div role="row" className="league-table-row empty">
              <span role="cell" className="col-empty">
                Нет сыгранных матчей.
              </span>
            </div>
          ) : (
            standings.map(entry => (
              <div role="row" className="league-table-row" key={entry.clubId}>
                <span role="cell" className="col-pos">
                  {entry.position}
                </span>
                <span role="cell" className="col-logo">
                  <button
                    type="button"
                    className="club-logo-button"
                    onClick={() => openTeamView(entry.clubId)}
                    aria-label={`Открыть страницу клуба ${entry.clubName}`}
                  >
                    {entry.clubLogoUrl ? (
                      <img
                        src={entry.clubLogoUrl}
                        alt=""
                        aria-hidden="true"
                        className="club-logo"
                      />
                    ) : (
                      <span className="club-logo fallback" aria-hidden="true">
                        {entry.clubShortName.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                  </button>
                </span>
                <span role="cell" className="col-club">
                  <span className="club-name">
                    <strong>{entry.clubName}</strong>
                  </span>
                </span>
                <span role="cell" className="col-record">
                  {entry.wins}/{entry.draws}/{entry.losses}
                </span>
                <span role="cell" className="col-score">
                  {entry.goalsFor}-{entry.goalsAgainst}
                </span>
                <span role="cell" className="col-diff" data-positive={entry.goalDifference >= 0}>
                  {entry.goalDifference >= 0 ? '+' : ''}
                  {entry.goalDifference}
                </span>
                <span role="cell" className="col-points">
                  {entry.points}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  )
}
