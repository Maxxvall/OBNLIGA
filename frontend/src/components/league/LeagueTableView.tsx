import React from 'react'
import type { LeagueTableGroup, LeagueTableResponse } from '@shared/types'
import { useAppStore } from '../../store/appStore'

type LeagueTableViewProps = {
  table?: LeagueTableResponse
  loading: boolean
  error?: string
  onRetry: () => void
}

export const LeagueTableView: React.FC<LeagueTableViewProps> = ({
  table,
  loading,
  error,
  onRetry,
}) => {
  const openTeamView = useAppStore(state => state.openTeamView)

  const standings = React.useMemo(
    () => table?.standings ?? [],
    [table]
  )
  const groups = table?.groups ?? undefined

  const standingsByClubId = React.useMemo(() => {
    const map = new Map<number, LeagueTableResponse['standings'][number]>()
    standings.forEach(entry => {
      map.set(entry.clubId, entry)
    })
    return map
  }, [standings])

  const hasServerGroups = Array.isArray(groups) && groups.length > 0

  const fallbackGroupSections = React.useMemo<
    Array<{ meta: LeagueTableGroup; entries: LeagueTableResponse['standings'][number][] }>
  >(() => {
    if (hasServerGroups) {
      return []
    }

    const grouped = new Map<
      number,
      { label: string | null; entries: LeagueTableResponse['standings'][number][] }
    >()

    standings.forEach(entry => {
      const index = entry.groupIndex
      if (index === null || index === undefined) {
        return
      }
      const bucket = grouped.get(index)
      if (bucket) {
        bucket.entries.push(entry)
        if (!bucket.label && entry.groupLabel) {
          bucket.label = entry.groupLabel
        }
      } else {
        grouped.set(index, {
          label: entry.groupLabel ?? null,
          entries: [entry],
        })
      }
    })

    if (grouped.size === 0) {
      return []
    }

    return Array.from(grouped.entries())
      .sort((left, right) => left[0] - right[0])
      .map(([groupIndex, bucket]) => {
        const sortedEntries = bucket.entries
          .slice()
          .sort((leftEntry, rightEntry) => {
            if (rightEntry.points !== leftEntry.points) {
              return rightEntry.points - leftEntry.points
            }
            const leftDiff = leftEntry.goalDifference
            const rightDiff = rightEntry.goalDifference
            if (rightDiff !== leftDiff) {
              return rightDiff - leftDiff
            }
            if (rightEntry.goalsFor !== leftEntry.goalsFor) {
              return rightEntry.goalsFor - leftEntry.goalsFor
            }
            return leftEntry.clubName.localeCompare(rightEntry.clubName, 'ru')
          })
        return {
          meta: {
            groupIndex,
            label: bucket.label ?? '',
            qualifyCount: 0,
            clubIds: sortedEntries.map(entry => entry.clubId),
          },
          entries: sortedEntries,
        }
      })
  }, [hasServerGroups, standings])

  const groupSections = React.useMemo<
    Array<{ meta: LeagueTableGroup; entries: LeagueTableResponse['standings'][number][] }>
  >(
    () => {
      if (hasServerGroups && groups) {
        return groups
          .map(group => {
            const entries = group.clubIds
              .map(clubId => standingsByClubId.get(clubId))
              .filter((entry): entry is LeagueTableResponse['standings'][number] => Boolean(entry))
            if (entries.length === 0) {
              return null
            }
            return { meta: group, entries }
          })
          .filter((section): section is { meta: LeagueTableGroup; entries: LeagueTableResponse['standings'][number][] } => section !== null)
      }
      return fallbackGroupSections
    },
    [fallbackGroupSections, groups, hasServerGroups, standingsByClubId]
  )
  const hasGroups = groupSections.length > 0

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

  const { season } = table
  const isRefreshing = loading && Boolean(table)

  const renderHeaderRow = () => (
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
  )

  const renderRow = (
    entry: LeagueTableResponse['standings'][number],
    position: number,
    qualifierCount = 0
  ) => {
    const qualified = qualifierCount > 0 && position <= qualifierCount
    const shortName = entry.clubShortName || entry.clubName
    return (
      <div
        role="row"
        className="league-table-row"
        key={entry.clubId}
        data-qualified={qualified || undefined}
      >
        <span role="cell" className="col-pos">
          {position}
        </span>
        <span role="cell" className="col-logo">
          <button
            type="button"
            className="club-logo-button"
            onClick={() => openTeamView(entry.clubId)}
            aria-label={`Открыть страницу клуба ${entry.clubName}`}
          >
            {entry.clubLogoUrl ? (
              <img src={entry.clubLogoUrl} alt="" aria-hidden="true" className="club-logo" />
            ) : (
              <span className="club-logo fallback" aria-hidden="true">
                {shortName.slice(0, 2).toUpperCase()}
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
    )
  }

  return (
    <section className="league-table" aria-label="Турнирная таблица" data-refreshing={isRefreshing || undefined}>
      <header className="league-table-header">
        <div>
          <h2>{season.name}</h2>
          <p>{season.competition.name}</p>
        </div>
      </header>
      {hasGroups ? (
        <div className="league-table-groups">
          {groupSections.map(({ meta, entries }) => {
            const label = meta.label?.trim()
            const groupTitle = label && label.length ? `Группа ${label}` : `Группа ${meta.groupIndex + 1}`
            const qualifierLabel = meta.qualifyCount > 0 ? `Выходят: ${meta.qualifyCount}` : null
            return (
              <section key={meta.groupIndex} className="league-table-group">
                <div className="league-table-group-header">
                  <h3>{groupTitle}</h3>
                  {qualifierLabel && <span className="league-table-qualify">{qualifierLabel}</span>}
                </div>
                <div className="league-table-scroll group">
                  <div role="table" className="league-table-grid">
                    {renderHeaderRow()}
                    {entries.length === 0 ? (
                      <div role="row" className="league-table-row empty">
                        <span role="cell" className="col-empty">
                          Нет данных по этой группе.
                        </span>
                      </div>
                    ) : (
                      entries.map((entry, index) => renderRow(entry, index + 1, meta.qualifyCount))
                    )}
                  </div>
                </div>
              </section>
            )
          })}
        </div>
      ) : (
        <div className="league-table-scroll">
          <div role="table" className="league-table-grid">
            {renderHeaderRow()}
            {standings.length === 0 ? (
              <div role="row" className="league-table-row empty">
                <span role="cell" className="col-empty">
                  Нет сыгранных матчей.
                </span>
              </div>
            ) : (
              standings.map(entry => renderRow(entry, entry.position))
            )}
          </div>
        </div>
      )}
    </section>
  )
}
