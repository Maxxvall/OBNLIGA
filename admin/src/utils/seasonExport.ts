import type { Club, MatchSummary, Season, Stadium } from '../types'

type SeasonMatchGroup = {
  label: string
  matches: MatchSummary[]
  identifier?: string
}

export type SeasonExportPayload = {
  season: Season
  groupedMatches: SeasonMatchGroup[]
  clubs: Club[]
  stadiums: Stadium[]
}

const statusClassMap: Record<MatchSummary['status'], string> = {
  SCHEDULED: 'scheduled',
  LIVE: 'live',
  FINISHED: 'finished',
  POSTPONED: 'postponed',
}

const metaEnv = ((import.meta as ImportMeta).env ?? {}) as Partial<Record<string, string>>

const resolveAssetBaseUrl = (): string => {
  const candidates = [metaEnv.VITE_BACKEND_URL, metaEnv.VITE_ADMIN_API_BASE]
  for (const candidate of candidates) {
    if (candidate && candidate.trim().length > 0) {
      return candidate.trim().replace(/\/$/, '')
    }
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin
  }
  return ''
}

const assetBaseUrl = resolveAssetBaseUrl()

const isAbsoluteUrl = (value: string): boolean => /^https?:\/\//i.test(value)

const resolveClubLogoUrl = (logoUrl?: string | null): string | null => {
  if (!logoUrl) {
    return null
  }
  const trimmed = logoUrl.trim()
  if (!trimmed) {
    return null
  }
  if (isAbsoluteUrl(trimmed) || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return trimmed
  }
  const fallbackOrigin =
    typeof window !== 'undefined' && window.location?.origin ? window.location.origin : ''
  if (trimmed.startsWith('//')) {
    const schemeSource = (assetBaseUrl || fallbackOrigin || '').toLowerCase()
    const scheme = schemeSource.startsWith('https') ? 'https:' : 'http:'
    return `${scheme}${trimmed}`
  }
  if (!assetBaseUrl) {
    if (trimmed.startsWith('/')) {
      return fallbackOrigin ? `${fallbackOrigin}${trimmed}` : trimmed
    }
    return fallbackOrigin ? `${fallbackOrigin.replace(/\/$/, '')}/${trimmed}` : trimmed
  }
  if (trimmed.startsWith('/')) {
    return `${assetBaseUrl}${trimmed}`
  }
  return `${assetBaseUrl}/${trimmed}`
}

const sanitizeFileName = (value: string): string => {
  const normalized = value.replace(/[\\/:*?"<>|]+/g, ' ').trim()
  if (!normalized) {
    return 'season-schedule'
  }
  return normalized.replace(/\s+/g, '-').toLowerCase()
}

const capitalizeFirst = (value: string): string => {
  if (!value) {
    return value
  }
  return value.charAt(0).toUpperCase() + value.slice(1)
}

const resolveRoundIdentifier = (group: SeasonMatchGroup, index: number): string => {
  const base = group.identifier?.trim()
  if (base && base.length > 0) {
    return base
  }
  const normalizedLabel = group.label
    ? group.label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\s-]+/g, '')
        .replace(/\s+/g, '-')
    : ''
  const fallback = normalizedLabel ? `${normalizedLabel}-${index + 1}` : `round-${index + 1}`
  return fallback
}

const isSameCalendarDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

const formatRoundDate = (matches: MatchSummary[]): string | null => {
  const parsedDates = matches
    .map(match => new Date(match.matchDateTime))
    .filter(date => !Number.isNaN(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime())

  if (!parsedDates.length) {
    return null
  }

  const firstDate = parsedDates[0]
  const lastDate = parsedDates[parsedDates.length - 1]
  const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' })
  const weekdayFormatter = new Intl.DateTimeFormat('ru-RU', { weekday: 'long' })

  const buildLabel = (date: Date): string => {
    const datePart = dateFormatter.format(date)
    const weekdayPart = capitalizeFirst(weekdayFormatter.format(date))
    return `${datePart}, ${weekdayPart}`
  }

  if (isSameCalendarDay(firstDate, lastDate)) {
    return buildLabel(firstDate)
  }

  return `${buildLabel(firstDate)} — ${buildLabel(lastDate)}`
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const getClubName = (club: Club | undefined, fallbackId: number): string => {
  if (!club) {
    return `Клуб #${fallbackId}`
  }
  const name = club.name?.trim()
  if (name && name.length > 0) {
    return name
  }
  const shortName = club.shortName?.trim()
  return shortName && shortName.length > 0 ? shortName : `Клуб #${fallbackId}`
}

const getClubInitial = (name: string): string => {
  const trimmed = name.trim()
  if (!trimmed) {
    return '#'
  }
  const match = trimmed.match(/[A-Za-zА-Яа-я0-9]/u)
  if (match && match[0]) {
    return match[0].toUpperCase()
  }
  return trimmed.charAt(0).toUpperCase()
}

const buildSeriesLabel = (match: MatchSummary): string | null => {
  const series = match.series
  if (!series) {
    return null
  }
  const parts: string[] = []
  if (series.stageName && series.stageName.trim().length > 0) {
    parts.push(series.stageName.trim())
  }
  if (match.seriesMatchNumber && match.seriesMatchNumber > 0) {
    parts.push(`Матч ${match.seriesMatchNumber}`)
  }
  return parts.length ? parts.join(' · ') : null
}

const buildTeamBlock = (club: Club | undefined, fallbackId: number): string => {
  const displayName = getClubName(club, fallbackId)
  const resolvedLogoUrl = resolveClubLogoUrl(club?.logoUrl)
  const logoMarkup = resolvedLogoUrl
    ? `<img src="${escapeHtml(resolvedLogoUrl)}" alt="${escapeHtml(displayName)}" crossorigin="anonymous" />`
    : `<span class="team-logo-fallback">${escapeHtml(getClubInitial(displayName))}</span>`
  return `
        <div class="league-match-team">
          <div class="team-logo">${logoMarkup}</div>
          <div class="team-name">${escapeHtml(displayName)}</div>
        </div>
      `
}

const buildMatchCard = (match: MatchSummary, clubMap: Map<number, Club>): string => {
  const homeClub = clubMap.get(match.homeTeamId)
  const awayClub = clubMap.get(match.awayTeamId)
  const statusClass = statusClassMap[match.status]
  const hasScore = match.status === 'LIVE' || match.status === 'FINISHED'
  const homeScore = hasScore ? String(match.homeScore ?? 0) : '—'
  const awayScore = hasScore ? String(match.awayScore ?? 0) : '—'
  const penaltyDetail = match.hasPenaltyShootout
    ? `Пенальти ${match.penaltyHomeScore}:${match.penaltyAwayScore}`
    : ''
  const seriesLabel = buildSeriesLabel(match)

  return `
        <article class="league-match-card ${statusClass}">
          <div class="league-match-main">
            ${buildTeamBlock(homeClub, match.homeTeamId)}
            <div class="league-match-score">
              <div class="score-main">
                <span class="score-value">${escapeHtml(homeScore)}</span>
                <span class="score-separator">:</span>
                <span class="score-value">${escapeHtml(awayScore)}</span>
              </div>
              ${penaltyDetail ? `<div class="score-detail">${escapeHtml(penaltyDetail)}</div>` : ''}
              ${seriesLabel ? `<div class="series-info">${escapeHtml(seriesLabel)}</div>` : ''}
            </div>
            ${buildTeamBlock(awayClub, match.awayTeamId)}
          </div>
        </article>
      `
}

const buildRoundSelectorOption = (group: SeasonMatchGroup, index: number): string => {
  const roundId = resolveRoundIdentifier(group, index)
  return `
      <label class="round-option">
        <input type="checkbox" data-round-id="${escapeHtml(roundId)}" checked />
        <span class="round-option-label">${escapeHtml(group.label)}</span>
        <span class="round-option-count">(${group.matches.length})</span>
      </label>
    `
}

const buildRoundSection = (
  group: SeasonMatchGroup,
  index: number,
  clubMap: Map<number, Club>
): string => {
  const { label, matches } = group
  const matchCards = matches.map(match => buildMatchCard(match, clubMap)).join('')
  const dateLabel = formatRoundDate(matches)
  const roundId = resolveRoundIdentifier(group, index)
  return `
      <section class="league-round-card" data-round-id="${escapeHtml(roundId)}" data-round-label="${escapeHtml(label)}">
        <header class="league-round-card-header">
          <h3>${escapeHtml(label)}${dateLabel ? ` <span class="round-meta">· ${escapeHtml(dateLabel)}</span>` : ''}</h3>
        </header>
        <div class="league-round-card-body">
          ${matchCards}
        </div>
      </section>
    `
}

const baseStyles = `
  * {
    box-sizing: border-box;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  body {
    margin: 0;
    font-family: 'Inter', 'Segoe UI', Tahoma, sans-serif;
    background: radial-gradient(circle at top, #051632, #020b1a 45%, #01050d 100%);
    color: rgba(235, 246, 255, 0.96);
    line-height: 1.4;
    padding: 24px;
  }

  .print-shell {
    max-width: 900px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
    align-items: center;
    text-align: center;
  }

  .print-header {
    display: flex;
    flex-direction: column;
    gap: 6px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    align-items: center;
  }

  .print-header h1 {
    margin: 0;
    font-size: 26px;
    letter-spacing: 0.9px;
  }

  .print-header h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0.4px;
    color: rgba(210, 232, 255, 0.82);
  }

  .league-rounds {
    background: rgba(12, 20, 36, 0.84);
    border-radius: 14px;
    border: 1px solid rgba(0, 240, 255, 0.14);
    box-shadow: 0 14px 32px rgba(3, 8, 18, 0.62);
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    align-items: center;
  }

  .league-round-card {
    border-radius: 12px;
    border: 1px solid rgba(0, 240, 255, 0.14);
    background: rgba(0, 240, 255, 0.05);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: center;
    text-align: center;
  }

  .league-round-card-header {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    text-transform: uppercase;
    letter-spacing: 0.6px;
  }

  .league-round-card-header h3 {
    margin: 0;
    font-size: 17px;
    display: inline-flex;
    gap: 8px;
    align-items: baseline;
    text-align: center;
  }

  .round-meta {
    font-size: 12px;
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0.4px;
    color: rgba(200, 222, 255, 0.78);
  }

  .league-round-card-body {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    justify-items: center;
  }

  .league-match-card {
    border-radius: 12px;
    border: 1px solid rgba(0, 240, 255, 0.12);
    background: rgba(8, 21, 37, 0.94);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: min(280px, 100%);
    margin: 0 auto;
  }

  .league-match-card.live {
    border-color: rgba(255, 77, 130, 0.58);
  }

  .league-match-card.finished {
    border-color: rgba(122, 255, 193, 0.3);
  }

  .league-match-card.postponed {
    border-style: dashed;
    opacity: 0.88;
  }

  .league-match-main {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    justify-items: center;
  }

  .league-match-team {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .team-logo {
    width: 64px;
    height: 64px;
    border-radius: 18px;
    background: rgba(0, 240, 255, 0.08);
    border: 1px solid rgba(0, 240, 255, 0.22);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .team-logo img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .team-logo-fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    font-weight: 700;
    letter-spacing: 0.6px;
    color: rgba(210, 232, 255, 0.92);
    background: rgba(0, 240, 255, 0.12);
  }

  .team-name {
    font-weight: 600;
    font-size: 13px;
    letter-spacing: 0.3px;
    text-align: center;
    line-height: 1.3;
    color: rgba(228, 242, 255, 0.94);
  }

  .export-controls {
    position: fixed;
    top: 24px;
    right: 24px;
    display: flex;
    gap: 10px;
    z-index: 1000;
  }

  .export-button {
    border: none;
    border-radius: 999px;
    padding: 10px 16px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    cursor: pointer;
    background: rgba(0, 240, 255, 0.18);
    color: rgba(235, 246, 255, 0.96);
    transition: background 0.2s ease;
  }

  .export-button:hover {
    background: rgba(0, 240, 255, 0.32);
  }

  .export-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(5, 10, 18, 0.78);
    display: none;
    align-items: center;
    justify-content: center;
    padding: 24px;
    z-index: 2000;
  }

  .export-modal-backdrop.open {
    display: flex;
  }

  .export-modal-card {
    width: min(520px, 100%);
    display: flex;
    flex-direction: column;
    background: rgba(8, 14, 26, 0.94);
    border: 1px solid rgba(0, 240, 255, 0.18);
    border-radius: 18px;
    box-shadow: 0 28px 60px rgba(2, 6, 14, 0.6);
    color: rgba(235, 246, 255, 0.96);
  }

  .export-modal-header {
    padding: 20px 24px 16px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
  }

  .export-modal-header h3 {
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.7px;
    font-size: 18px;
  }

  .export-modal-close {
    border: none;
    background: none;
    color: rgba(210, 232, 255, 0.82);
    cursor: pointer;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
  }

  .export-modal-close:hover {
    color: rgba(235, 246, 255, 0.96);
  }

  .export-modal-body {
    padding: 0 24px 24px;
    display: flex;
    flex-direction: column;
    gap: 18px;
    text-align: left;
  }

  .export-modal-body p {
    margin: 0;
    color: rgba(200, 222, 255, 0.78);
    font-size: 13px;
    line-height: 1.4;
  }

  .round-option-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-height: 320px;
    overflow: auto;
  }

  .round-option {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border-radius: 14px;
    background: rgba(0, 240, 255, 0.08);
    border: 1px solid rgba(0, 240, 255, 0.16);
  }

  .round-option input[type="checkbox"] {
    width: 18px;
    height: 18px;
    cursor: pointer;
    accent-color: rgba(0, 240, 255, 0.6);
  }

  .round-option-label {
    flex: 1;
    font-weight: 600;
    letter-spacing: 0.4px;
  }

  .round-option-count {
    color: rgba(200, 222, 255, 0.72);
    font-size: 12px;
  }

  .export-modal-footer {
    padding: 18px 24px 24px;
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    border-top: 1px solid rgba(0, 240, 255, 0.15);
  }

  .export-modal-button {
    border: 1px solid rgba(0, 240, 255, 0.26);
    border-radius: 999px;
    padding: 10px 18px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    background: rgba(0, 0, 0, 0.24);
    color: rgba(235, 246, 255, 0.96);
    cursor: pointer;
    transition: background 0.2s ease, border-color 0.2s ease;
  }

  .export-modal-button.primary {
    background: rgba(0, 240, 255, 0.24);
    border-color: rgba(0, 240, 255, 0.32);
  }

  .export-modal-button:hover {
    background: rgba(0, 240, 255, 0.18);
    border-color: rgba(0, 240, 255, 0.4);
  }

  .round-hidden {
    display: none !important;
  }

  .league-match-score {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }

  .score-main {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: 20px;
    font-weight: 700;
    letter-spacing: 1px;
  }

  .score-value {
    min-width: 24px;
    text-align: center;
  }

  .score-separator {
    opacity: 0.78;
  }

  .score-detail {
    font-size: 11px;
    color: rgba(255, 206, 229, 0.86);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .series-info {
    font-size: 11px;
    color: rgba(200, 222, 255, 0.78);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }

  @page {
    size: A4 portrait;
    margin: 10mm;
  }

  @media print {
    body {
      padding: 0;
    }

    .print-shell {
      gap: 10px;
    }

    .export-controls {
      display: none !important;
    }
  }
`


export const buildSeasonExportHtml = ({
  season,
  groupedMatches,
  clubs,
}: SeasonExportPayload): string => {
  const clubMap = new Map<number, Club>()
  clubs.forEach(club => {
    clubMap.set(club.id, club)
  })

  const roundsMarkup = groupedMatches
    .map((group, index) => buildRoundSection(group, index, clubMap))
    .join('')
  const roundSelectorMarkup = groupedMatches
    .map((group, index) => buildRoundSelectorOption(group, index))
    .join('')

  const competitionName = season.competition?.name?.trim() ?? 'Соревнование'
  const seasonName = season.name?.trim() ?? 'Сезон'
  const fileBaseName = sanitizeFileName(`${seasonName}-${competitionName}`)

  return `<!DOCTYPE html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(seasonName)} — расписание</title>
    <style>${baseStyles}</style>
    <script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js" defer></script>
  </head>
  <body>
    <div class="export-controls">
      <button type="button" class="export-button" data-format="png">Скачать PNG</button>
      <button type="button" class="export-button" data-format="jpg">Скачать JPG</button>
      <button type="button" class="export-button" data-action="print">Печать</button>
    </div>
    <div class="print-shell">
      <header class="print-header">
        <h1>${escapeHtml(seasonName)}</h1>
        <h2>${escapeHtml(competitionName)}</h2>
      </header>
      <section class="league-rounds">
        ${roundsMarkup}
      </section>
    </div>
    <div class="export-modal-backdrop" data-modal="round-selector" hidden>
      <div class="export-modal-card">
        <div class="export-modal-header">
          <div>
            <h3>Выбор туров</h3>
            <p>Отметьте туры, которые должны попасть в изображение.</p>
          </div>
          <button type="button" class="export-modal-close" data-action="cancel">Закрыть</button>
        </div>
        <div class="export-modal-body">
          <p>По умолчанию выбраны все туры. Снимите галочки с тех туров, которые не нужны.</p>
          <div class="round-option-list">
            ${roundSelectorMarkup}
          </div>
        </div>
        <div class="export-modal-footer">
          <button type="button" class="export-modal-button" data-action="cancel">Отмена</button>
          <button type="button" class="export-modal-button primary" data-action="confirm">Скачать</button>
        </div>
      </div>
    </div>
    <script>
      (function () {
        var fileBaseName = ${JSON.stringify(fileBaseName)}
        var shell = document.querySelector('.print-shell')
        var buttons = document.querySelectorAll('.export-button')
        if (!shell || !buttons.length) {
          return
        }

        var ensureHtml2Canvas = function (callback, attempt) {
          if (attempt === void 0) {
            attempt = 0
          }
          if (window.html2canvas) {
            callback(window.html2canvas)
            return
          }
          if (attempt > 25) {
            console.error('Не удалось загрузить html2canvas для экспорта изображения')
            return
          }
          setTimeout(function () {
            ensureHtml2Canvas(callback, attempt + 1)
          }, 160)
        }

        var modal = document.querySelector('[data-modal="round-selector"]')
        var modalCard = modal ? modal.querySelector('.export-modal-card') : null
        var pendingFormat = null

        var downloadImage = function (format, selectedIds) {
          ensureHtml2Canvas(function (html2canvas) {
            var sections = Array.from(document.querySelectorAll('.league-round-card'))
            var hiddenSections = []
            if (Array.isArray(selectedIds) && selectedIds.length) {
              var selectedSet = new Set(selectedIds)
              sections.forEach(function (section) {
                var roundId = section.getAttribute('data-round-id')
                if (roundId && !selectedSet.has(roundId)) {
                  hiddenSections.push(section)
                  section.classList.add('round-hidden')
                }
              })
            }
            var options = { backgroundColor: null, scale: 2, useCORS: true }
            html2canvas(shell, options)
              .then(function (canvas) {
                var mime = format === 'jpg' ? 'image/jpeg' : 'image/png'
                var quality = format === 'jpg' ? 0.92 : undefined
                var link = document.createElement('a')
                link.href = canvas.toDataURL(mime, quality)
                link.download = fileBaseName + (format === 'jpg' ? '.jpg' : '.png')
                link.click()
              })
              .catch(function (error) {
                console.error('Не удалось сформировать изображение:', error)
              })
              .finally(function () {
                hiddenSections.forEach(function (section) {
                  section.classList.remove('round-hidden')
                })
              })
          })
        }

        var closeModal = function () {
          if (!modal) {
            return
          }
          modal.classList.remove('open')
          modal.setAttribute('hidden', 'true')
          pendingFormat = null
        }

        var openModal = function (format) {
          if (!modal) {
            downloadImage(format)
            return
          }
          var checkboxes = modal.querySelectorAll('input[type="checkbox"]')
          if (!checkboxes.length) {
            downloadImage(format)
            return
          }
          checkboxes.forEach(function (input) {
            input.checked = true
          })
          pendingFormat = format
          modal.removeAttribute('hidden')
          modal.classList.add('open')
        }

        if (modal) {
          modal.addEventListener('click', function (event) {
            if (event.target === modal) {
              closeModal()
            }
          })
        }

        if (modalCard) {
          modalCard.addEventListener('click', function (event) {
            event.stopPropagation()
          })
        }

        if (modal) {
          modal.querySelectorAll('[data-action="cancel"]').forEach(function (button) {
            button.addEventListener('click', function () {
              closeModal()
            })
          })
          var confirmButton = modal.querySelector('[data-action="confirm"]')
          if (confirmButton) {
            confirmButton.addEventListener('click', function () {
              if (!pendingFormat) {
                closeModal()
                return
              }
              var selected = Array.from(
                modal.querySelectorAll('input[type="checkbox"]:checked')
              )
                .map(function (input) {
                  return input.getAttribute('data-round-id') || ''
                })
                .filter(function (value) {
                  return value.length > 0
                })
              if (!selected.length) {
                alert('Выберите хотя бы один тур для выгрузки.')
                return
              }
              var format = pendingFormat
              closeModal()
              downloadImage(format, selected)
            })
          }
        }

        buttons.forEach(function (button) {
          button.addEventListener('click', function () {
            var format = button.getAttribute('data-format')
            var action = button.getAttribute('data-action')
            if (format === 'png' || format === 'jpg') {
              openModal(format)
              return
            }
            if (action === 'print') {
              window.print()
            }
          })
        })
      })()
    </script>
  </body>
</html>`
}
