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

const resolveClubLogoUrl = (logoUrl?: string | null): string | null => {
  if (!logoUrl) {
    return null
  }
  const trimmed = logoUrl.trim()
  if (!trimmed) {
    return null
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed
  }
  let filename = trimmed
  if (filename.includes('/')) {
    filename = filename.split('/').pop() ?? filename
  }
  return `/teamlogos/${filename}`
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

  const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' })
  const weekdayFormatter = new Intl.DateTimeFormat('ru-RU', { weekday: 'long' })

  const buildLabel = (date: Date): string => {
    const datePart = dateFormatter.format(date)
    const weekdayPart = capitalizeFirst(weekdayFormatter.format(date))
    return `${datePart}, ${weekdayPart}`
  }

  if (parsedDates.length === 1 || isSameCalendarDay(parsedDates[0], parsedDates[parsedDates.length - 1])) {
    return buildLabel(parsedDates[0])
  }

  return `${buildLabel(parsedDates[0])} – ${buildLabel(parsedDates[parsedDates.length - 1])}`
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
    return `Команда #${fallbackId}`
  }
  const name = club.name?.trim()
  if (name && name.length > 0) {
    return name
  }
  const shortName = club.shortName?.trim()
  if (shortName && shortName.length > 0) {
    return shortName
  }
  return `Команда #${fallbackId}`
}

const getClubInitial = (name: string): string => {
  const trimmed = name.trim()
  if (!trimmed) {
    return '#'
  }
  const match = trimmed.match(/[A-Za-zА-Яа-яЁё0-9]/u)
  if (match && match[0]) {
    return match[0].toUpperCase()
  }
  return trimmed.charAt(0).toUpperCase()
}

const parseMatchDate = (value: string | undefined): Date | null => {
  if (!value) {
    return null
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }
  return parsed
}

const formatMatchTime = (value: string | undefined): string => {
  const parsed = parseMatchDate(value)
  if (!parsed) {
    return '--:--'
  }
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(parsed)
}

const buildTeamCell = (club: Club | undefined, fallbackId: number, side: 'left' | 'right'): string => {
  const displayName = getClubName(club, fallbackId)
  const resolvedLogoUrl = resolveClubLogoUrl(club?.logoUrl)
  const logoMarkup = resolvedLogoUrl
    ? `<img src="${escapeHtml(resolvedLogoUrl)}" alt="${escapeHtml(displayName)}" width="44" height="44" style="display:block;width:44px;height:44px;object-fit:contain;object-position:center;background:transparent;border:none;border-radius:0;" />`
    : `<span aria-hidden="true">${escapeHtml(getClubInitial(displayName))}</span>`
  if (side === 'left') {
    // имя, затем логотип, выровнено к правой границе колонки
    return `
      <div class="team-left">
        <span class="team-badge-name">${escapeHtml(displayName)}</span>
        <div class="team-logo">${logoMarkup}</div>
      </div>
    `
  }
  // логотип, затем имя, выровнено к левой границе колонки
  return `
    <div class="team-right">
      <div class="team-logo">${logoMarkup}</div>
      <span class="team-badge-name">${escapeHtml(displayName)}</span>
    </div>
  `
}

const getStadiumName = (stadiumId: number | null | undefined, stadiumMap: Map<number, Stadium>): string | null => {
  if (!stadiumId) {
    return null
  }
  const stadium = stadiumMap.get(stadiumId)
  if (!stadium) {
    return null
  }
  const name = stadium.name?.trim()
  if (!name) {
    return null
  }
  return name
}

const buildMatchRow = (
  match: MatchSummary,
  clubMap: Map<number, Club>,
  stadiumMap: Map<number, Stadium>
): string => {
  const homeClub = clubMap.get(match.homeTeamId)
  const awayClub = clubMap.get(match.awayTeamId)
  const stadiumName = getStadiumName(match.stadiumId, stadiumMap)
  const timeLabel = formatMatchTime(match.matchDateTime)
  const statusClass = statusClassMap[match.status]
  return `
    <article class="schedule-match-row ${statusClass}" data-match-id="${escapeHtml(String(match.id))}">
      <div class="match-time-block">
        <span class="match-time-label">${escapeHtml(timeLabel)}</span>
        
      </div>
      <div class="match-teams">
        ${buildTeamCell(homeClub, match.homeTeamId, 'left')}
        <span class="match-vs" aria-hidden="true">×</span>
        ${buildTeamCell(awayClub, match.awayTeamId, 'right')}
      </div>
      <div class="match-location">${escapeHtml(stadiumName ?? '—')}</div>
    </article>
  `
}

const buildRoundSection = (
  group: SeasonMatchGroup,
  index: number,
  clubMap: Map<number, Club>,
  stadiumMap: Map<number, Stadium>
): string => {
  const rowsMarkup = group.matches.map(match => buildMatchRow(match, clubMap, stadiumMap)).join('')
  const roundId = resolveRoundIdentifier(group, index)
  const roundDate = formatRoundDate(group.matches)
  // Форматируем метку раунда как: "ГРУППА X - ТУР Y" в верхнем регистре
  const rawLabel = group.label ? group.label.trim() : ''
  let formattedLabel = rawLabel.toUpperCase()
  if (rawLabel) {
    // Попробуем разбить по первому дефису/тире чтобы получить левую и правую части
    const parts = rawLabel.split(/\s*[—–-]\s*/)
    if (parts.length >= 2) {
      const left = parts[0].toUpperCase()
      const right = parts.slice(1).join(' - ').toUpperCase()
      formattedLabel = `ГРУППА ${left} - ${right}`
    } else {
      formattedLabel = `ГРУППА ${rawLabel.toUpperCase()}`
    }
  }

  return `
    <section class="league-round-card" data-round-id="${escapeHtml(roundId)}" data-round-label="${escapeHtml(
      group.label || ''
    )}">
      <header class="schedule-round-header">
        <div class="schedule-round-title">${escapeHtml(formattedLabel)}</div>
        ${roundDate ? `<div class="schedule-round-date">${escapeHtml(roundDate)}</div>` : ''}
      </header>
      <div class="schedule-round-divider" aria-hidden="true"></div>
      <div class="schedule-match-list">
        ${rowsMarkup}
      </div>
    </section>
  `
}

const buildRoundSelectorOption = (group: SeasonMatchGroup, index: number): string => {
  const roundId = resolveRoundIdentifier(group, index)
  return `
    <label class="round-option">
      <input type="checkbox" data-round-id="${escapeHtml(roundId)}" />
      <span class="round-option-label">${escapeHtml(group.label)}</span>
      <span class="round-option-count">(${group.matches.length})</span>
    </label>
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
    background: radial-gradient(circle at top, rgba(8, 70, 22, 0.85), #03060d 55%, #010205 100%);
    color: rgba(235, 246, 255, 0.96);
    padding: 24px;
  }

  .print-shell {
    width: min(1100px, 100%);
    margin: 0 auto;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(0, 0, 0, 0.65));
    border-radius: 26px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    padding: 32px;
    display: flex;
    flex-direction: column;
    gap: 28px;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.45);
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
    top: 80px;
    right: 24px;
    width: min(520px, calc(100vw - 48px));
    background: rgba(5, 10, 18, 0.78);
    display: none;
    z-index: 2000;
    max-height: calc(100vh - 100px);
    overflow: auto;
  }

  .export-modal-backdrop.open {
    display: flex;
  }

  .export-modal-card {
    width: 100%;
    display: flex;
    flex-direction: column;
    background: rgba(8, 14, 26, 0.94);
    border: 1px solid rgba(0, 240, 255, 0.18);
    border-radius: 18px;
    box-shadow: 0 28px 60px rgba(2, 6, 14, 0.6);
    color: rgba(235, 246, 255, 0.96);
    max-height: 100%;
    overflow: auto;
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

  .round-selection-controls {
    display: flex;
    gap: 10px;
  }

  .round-control-button {
    border: 1px solid rgba(0, 240, 255, 0.26);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    background: rgba(0, 0, 0, 0.24);
    color: rgba(235, 246, 255, 0.96);
    cursor: pointer;
    transition: background 0.2s ease, border-color 0.2s ease;
  }

  .round-control-button:hover {
    background: rgba(0, 240, 255, 0.18);
    border-color: rgba(0, 240, 255, 0.4);
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

  .print-header {
    display: flex;
    flex-direction: column;
    gap: 6px;
    text-transform: uppercase;
    letter-spacing: 0.7px;
  }

  .print-header .competition-name {
    font-size: 14px;
    color: rgba(210, 232, 255, 0.82);
  }

  .print-header h1 {
    margin: 0;
    font-size: 36px;
    letter-spacing: 1px;
    font-weight: 700;
  }

  .schedule-panel {
    background: rgba(5, 12, 24, 0.88);
    border-radius: 20px;
    border: 1px solid rgba(0, 240, 255, 0.24);
    padding: 26px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .schedule-intro {
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
  }

  .schedule-title {
    font-size: 20px;
  }

  .schedule-subtitle {
    font-size: 14px;
    color: rgba(210, 232, 255, 0.78);
  }

  .schedule-columns {
    display: grid;
    grid-template-columns: minmax(100px, 140px) 1fr minmax(120px, 1fr);
    font-size: 11px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: rgba(192, 216, 255, 0.72);
  }

  .schedule-body {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .league-round-card {
    background: rgba(8, 20, 38, 0.95);
    border-radius: 18px;
    border: 1px solid rgba(0, 224, 255, 0.12);
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .schedule-round-header {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .schedule-round-title {
    font-size: 16px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .schedule-round-date {
    font-size: 13px;
    text-transform: none;
    color: rgba(210, 232, 255, 0.78);
  }

  .schedule-round-divider {
    height: 1px;
    background: linear-gradient(90deg, rgba(0, 240, 255, 0), rgba(0, 240, 255, 0.4), rgba(0, 240, 255, 0));
    margin: 0 -20px;
  }

  .schedule-match-list {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .schedule-match-row {
    display: grid;
    grid-template-columns: minmax(100px, 150px) 1fr minmax(160px, 1fr);
    align-items: center;
    gap: 14px;
    padding: 10px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .schedule-match-row:last-child {
    border-bottom: none;
  }

  .schedule-match-row.finished {
    background: rgba(23, 45, 96, 0.25);
  }

  .schedule-match-row.live {
    background: rgba(255, 77, 130, 0.08);
  }

  .schedule-match-row.postponed {
    background: rgba(255, 195, 77, 0.08);
  }

  .match-time-block {
    display: flex;
    flex-direction: column;
    gap: 4px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .match-time-label {
    font-size: 22px;
    font-weight: 600;
  }

  .match-weekday {
    font-size: 12px;
    color: rgba(210, 232, 255, 0.72);
  }

  .match-teams {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .team-badge {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 160px;
    max-width: 240px;
  }

  .team-badge-logo {
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .team-badge-logo img {
    width: 44px;
    height: 44px;
    object-fit: contain;
    display: block;
  }

  .team-badge-logo span {
    font-weight: 700;
    letter-spacing: 1px;
  }

  .team-badge-name {
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Новая верстка для выравнивания логотипов */
  .match-teams {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 12px;
  }

  .team-left,
  .team-right {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .team-left {
    justify-content: flex-end; /* имя и логотип выровнены к центру области */
  }

  .team-right {
    justify-content: flex-start;
  }

  .team-logo {
    width: 44px;
    height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background: transparent; /* do not render background */
    border: none; /* no border */
    border-radius: 0; /* no rounding */
  }
  .team-logo img { width: 44px; height: 44px; object-fit: contain; display: block; }

  .match-vs {
    font-size: 24px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.6);
  }

  .match-location {
    text-align: right;
    font-size: 13px;
    color: rgba(210, 232, 255, 0.72);
  }

  .schedule-footer {
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    padding-top: 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .schedule-footer .footer-links {
    display: flex;
    gap: 18px;
  }

  .schedule-footer a {
    color: #ffffff;
    text-decoration: none;
    font-weight: 600;
  }

  @media print {
    body {
      padding: 0;
    }
    .export-controls {
      display: none !important;
    }
    .print-shell {
      box-shadow: none;
      border: none;
    }
  }

  @page {
    size: A4 portrait;
    margin: 10mm;
  }
`

export const buildSeasonExportHtml = ({
  season,
  groupedMatches,
  clubs,
  stadiums,
}: SeasonExportPayload): string => {
  const clubMap = new Map<number, Club>()
  clubs.forEach(club => {
    clubMap.set(club.id, club)
  })

  const stadiumMap = new Map<number, Stadium>()
  stadiums.forEach(stadium => {
    stadiumMap.set(stadium.id, stadium)
  })

  const sectionsMarkup = groupedMatches
    .map((group, index) => buildRoundSection(group, index, clubMap, stadiumMap))
    .join('')
  const roundSelectorMarkup = groupedMatches
    .map((group, index) => buildRoundSelectorOption(group, index))
    .join('')

  const competitionName = season.competition?.name?.trim() ?? 'Неизвестное соревнование'
  const seasonName = season.name?.trim() ?? 'Сезон'
  // Подзаголовок: показываем только дату тура (день и месяц), без названия группы/тура
  let headerSubtitle = ''
  if (groupedMatches.length) {
    const roundDate = formatRoundDate(groupedMatches[0].matches)
    if (roundDate) {
      headerSubtitle = roundDate
    }
  }
  const fileBaseName = sanitizeFileName(`${seasonName}-${competitionName}`)

  return `<!DOCTYPE html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(seasonName)} – Расписание</title>
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
        <span class="competition-name">${escapeHtml(competitionName)}</span>
        <h1>${escapeHtml(seasonName)}</h1>
      </header>
      <section class="schedule-panel">
        <div class="schedule-intro">
          <span class="schedule-title">Расписание игр</span>
          ${headerSubtitle ? `<span class="schedule-subtitle">${escapeHtml(headerSubtitle)}</span>` : ''}
        </div>
        <!-- Колонки убраны: заголовки не требуются -->
        <div class="schedule-body">
          ${sectionsMarkup}
        </div>
      </section>
      <footer class="schedule-footer">
        <span>Подготовлено и оформлено командой НЛО</span>
        <div class="footer-links">
          <a href="https://t.me/footballobn_bot" target="_blank" rel="noreferrer">t.me/footballobn_bot</a>
          <a href="https://vk.com/nochligaobninsk" target="_blank" rel="noreferrer">vk.com/nochligaobninsk</a>
        </div>
      </footer>
    </div>
    <div class="export-modal-backdrop" data-modal="round-selector" hidden>
      <div class="export-modal-card">
        <div class="export-modal-header">
          <div>
            <h3>Выбор туров</h3>
            <p>Отметьте туры, которые хотите включить в экспорт.</p>
          </div>
          <button type="button" class="export-modal-close" data-action="cancel">Отмена</button>
        </div>
        <div class="export-modal-body">
          <p>Выберите хотя бы один тур. Экспорт без выбранных туров невозможен.</p>
          <div class="round-selection-controls">
            <button type="button" class="round-control-button" data-action="select-all">Выбрать все</button>
            <button type="button" class="round-control-button" data-action="deselect-all">Снять все</button>
          </div>
          <div class="round-option-list">
            ${roundSelectorMarkup}
          </div>
        </div>
        <div class="export-modal-footer">
          <button type="button" class="export-modal-button" data-action="cancel">Отмена</button>
          <button type="button" class="export-modal-button primary" data-action="confirm">Подтвердить</button>
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
            console.error('Не удалось загрузить html2canvas для создания экспорта')
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

            // Ensure all images inside the shell are decoded/loaded before capturing.
            // Use robust waiting with a short timeout so export proceeds even if some
            // resources are slow or blocked.
            function waitForImages(root, timeoutMs) {
              timeoutMs = timeoutMs || 3000
              var imgs = Array.from((root || document).querySelectorAll('img'))
              var promises = imgs.map(function (img) {
                return new Promise(function (resolve) {
                  // Already loaded and valid
                  if (img.complete && img.naturalWidth > 0) {
                    if (typeof img.decode === 'function') {
                      img.decode().then(resolve).catch(function () { resolve() })
                      return
                    }
                    resolve()
                    return
                  }

                  var settled = false
                  function done() {
                    if (settled) return
                    settled = true
                    cleanup()
                    resolve()
                  }
                  function onLoad() { done() }
                  function onError() { done() }
                  function cleanup() {
                    img.removeEventListener('load', onLoad)
                    img.removeEventListener('error', onError)
                  }
                  img.addEventListener('load', onLoad)
                  img.addEventListener('error', onError)

                  // Also attempt decode if already complete but not decoded
                  if (img.complete && typeof img.decode === 'function') {
                    img.decode().then(onLoad).catch(function () {})
                  }
                })
              })

              return Promise.race([
                Promise.all(promises),
                new Promise(function (res) { setTimeout(res, timeoutMs) }),
              ])
            }

            waitForImages(shell, 3000).then(function () {
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
                  console.error('Не удалось сформировать изображение экспорта:', error)
                })
                .finally(function () {
                  hiddenSections.forEach(function (section) {
                    section.classList.remove('round-hidden')
                  })
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
            input.checked = false
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
              var selected = Array.from(modal.querySelectorAll('input[type="checkbox"]:checked'))
                .map(function (input) {
                  return input.getAttribute('data-round-id') || ''
                })
                .filter(function (value) {
                  return value.length > 0
                })
              if (!selected.length) {
                alert('Выберите хотя бы один тур для экспорта.')
                return
              }
              var format = pendingFormat
              closeModal()
              downloadImage(format, selected)
            })
          }
          var selectAllButton = modal.querySelector('[data-action="select-all"]')
          if (selectAllButton) {
            selectAllButton.addEventListener('click', function () {
              var checkboxes = modal.querySelectorAll('input[type="checkbox"]')
              checkboxes.forEach(function (input) {
                input.checked = true
              })
            })
          }
          var deselectAllButton = modal.querySelector('[data-action="deselect-all"]')
          if (deselectAllButton) {
            deselectAllButton.addEventListener('click', function () {
              var checkboxes = modal.querySelectorAll('input[type="checkbox"]')
              checkboxes.forEach(function (input) {
                input.checked = false
              })
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
