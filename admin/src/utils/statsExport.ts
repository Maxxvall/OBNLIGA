import type { Season } from '../types'

export type ExportTableColumn = {
  key: string
  title: string
  align?: 'left' | 'center' | 'right'
  width?: string
}

export type ExportTableRow = {
  cells: Record<string, string | number>
  highlight?: boolean
}

export type StatsExportSection = {
  title: string
  subtitle?: string
  note?: string
  columns: ExportTableColumn[]
  rows: ExportTableRow[]
}

export type StatsExportChip = {
  label: string
  active: boolean
}

export type StatsExportPayload = {
  season: Pick<Season, 'name' | 'startDate' | 'endDate'>
  competitionName: string
  viewKey: string
  viewLabel: string
  chips: StatsExportChip[]
  sections: StatsExportSection[]
  dateRange?: string
  footerNote?: string
}

const sanitizeFileName = (value: string): string => {
  const normalized = value.replace(/[\\/:*?"<>|]+/g, ' ').trim()
  if (!normalized) {
    return 'stats-export'
  }
  return normalized.replace(/\s+/g, '-').toLowerCase()
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

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

  .export-controls {
    position: fixed;
    top: 24px;
    right: 24px;
    display: flex;
    gap: 10px;
    z-index: 1000;
    flex-wrap: wrap;
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

  .print-shell {
    width: min(1100px, 100%);
    margin: 0 auto;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(0, 0, 0, 0.65));
    border-radius: 26px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    padding: 32px;
    display: flex;
    flex-direction: column;
    gap: 26px;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.45);
  }

  .stats-header {
    display: flex;
    flex-direction: column;
    gap: 6px;
    text-transform: uppercase;
    letter-spacing: 0.7px;
  }

  .stats-header .competition-name {
    font-size: 14px;
    color: rgba(210, 232, 255, 0.82);
  }

  .stats-header h1 {
    margin: 0;
    font-size: 32px;
    letter-spacing: 1px;
    font-weight: 700;
  }

  .view-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .view-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 9px 12px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.7px;
    text-transform: uppercase;
    background: rgba(0, 240, 255, 0.12);
    border: 1px solid rgba(0, 240, 255, 0.2);
    color: rgba(235, 246, 255, 0.9);
  }

  .view-chip.active {
    background: rgba(0, 240, 255, 0.28);
    border-color: rgba(0, 240, 255, 0.4);
    color: #0b111f;
    box-shadow: 0 8px 20px rgba(0, 240, 255, 0.28);
  }

  .stats-subtitle {
    font-size: 14px;
    color: rgba(210, 232, 255, 0.78);
    text-transform: none;
  }

  .stats-section-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 18px;
  }

  .stats-card {
    background: rgba(8, 14, 26, 0.94);
    border: 1px solid rgba(0, 240, 255, 0.18);
    border-radius: 20px;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    box-shadow: 0 18px 36px rgba(0, 0, 0, 0.35);
  }

  .stats-card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }

  .stats-card-title {
    margin: 0;
    font-size: 16px;
    letter-spacing: 0.6px;
    text-transform: uppercase;
  }

  .stats-card-subtitle {
    margin: 4px 0 0;
    color: rgba(210, 232, 255, 0.78);
    font-size: 13px;
  }

  .stats-card-note {
    margin: 0;
    color: rgba(200, 222, 255, 0.76);
    font-size: 12px;
  }

  .stats-table {
    width: 100%;
    border-collapse: collapse;
    border-spacing: 0;
    font-size: 13px;
    letter-spacing: 0.3px;
  }

  .stats-table thead th {
    text-transform: uppercase;
    color: rgba(210, 232, 255, 0.78);
    font-weight: 700;
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  }

  .stats-table th,
  .stats-table td {
    padding: 10px 8px;
    text-align: center;
  }

  .stats-table td.align-left,
  .stats-table th.align-left {
    text-align: left;
  }

  .stats-table td.align-right,
  .stats-table th.align-right {
    text-align: right;
  }

  .stats-table tbody tr {
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .stats-table tbody tr:last-child {
    border-bottom: none;
  }

  .stats-table tbody tr.highlight-row {
    background: rgba(0, 240, 255, 0.08);
  }

  .footer {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    padding-top: 16px;
    font-size: 13px;
    color: rgba(210, 232, 255, 0.8);
  }

  .footer-links {
    display: flex;
    gap: 18px;
    flex-wrap: wrap;
  }

  .footer a {
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

const buildChipMarkup = (chip: StatsExportChip): string => {
  const classes = chip.active ? 'view-chip active' : 'view-chip'
  return `<span class="${classes}">${escapeHtml(chip.label)}</span>`
}

const buildSectionMarkup = (section: StatsExportSection): string => {
  if (!section.columns.length) {
    throw new Error('Не заданы колонки для экспорта статистики')
  }
  const rowsMarkup = section.rows
    .map(row => {
      const cellsMarkup = section.columns
        .map(column => {
          const value = row.cells[column.key]
          const text =
            value === undefined || value === null ? '—' : typeof value === 'number' ? value.toString() : value
          const alignClass = column.align ? ` align-${column.align}` : ''
          const widthStyle = column.width ? ` style="width:${column.width}"` : ''
          return `<td class="${alignClass.trim()}"${widthStyle}>${escapeHtml(text)}</td>`
        })
        .join('')
      const rowClass = row.highlight ? ' class="highlight-row"' : ''
      return `<tr${rowClass}>${cellsMarkup}</tr>`
    })
    .join('')

  return `
    <article class="stats-card">
      <div class="stats-card-header">
        <div>
          <h3 class="stats-card-title">${escapeHtml(section.title)}</h3>
          ${section.subtitle ? `<p class="stats-card-subtitle">${escapeHtml(section.subtitle)}</p>` : ''}
        </div>
        ${section.note ? `<p class="stats-card-note">${escapeHtml(section.note)}</p>` : ''}
      </div>
      <div class="stats-table-wrapper">
        <table class="stats-table">
          <thead>
            <tr>
              ${section.columns
                .map(column => {
                  const alignClass = column.align ? ` align-${column.align}` : ''
                  const widthStyle = column.width ? ` style="width:${column.width}"` : ''
                  return `<th class="${alignClass.trim()}"${widthStyle}>${escapeHtml(column.title)}</th>`
                })
                .join('')}
            </tr>
          </thead>
          <tbody>
            ${rowsMarkup}
          </tbody>
        </table>
      </div>
    </article>
  `
}

export const buildStatsExportHtml = (payload: StatsExportPayload): string => {
  if (!payload.sections.length) {
    throw new Error('Нет данных для экспорта выбранной вкладки')
  }

  const hasRows = payload.sections.some(section => section.rows.length > 0)
  if (!hasRows) {
    throw new Error('Нет строк для экспорта выбранной вкладки')
  }

  const chipsMarkup = payload.chips.length
    ? `<div class="view-chips">${payload.chips.map(buildChipMarkup).join('')}</div>`
    : ''
  const sectionsMarkup = payload.sections.map(buildSectionMarkup).join('')

  const competitionName = payload.competitionName?.trim() || 'Соревнование'
  const seasonName = payload.season.name?.trim() || 'Сезон'
  const dateRange =
    payload.dateRange?.trim() || `${payload.season.startDate?.slice(0, 10) ?? ''} — ${payload.season.endDate?.slice(0, 10) ?? ''}`
  const fileBaseName = sanitizeFileName(`${seasonName}-${payload.viewLabel}`)

  return `<!DOCTYPE html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(seasonName)} – ${escapeHtml(payload.viewLabel)}</title>
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
      <header class="stats-header">
        <span class="competition-name">${escapeHtml(competitionName)}</span>
        <h1>${escapeHtml(seasonName)}</h1>
        <p class="stats-subtitle">${escapeHtml(payload.viewLabel)}${dateRange ? ` · ${escapeHtml(dateRange)}` : ''}</p>
        ${chipsMarkup}
      </header>
      <section class="stats-section-grid">
        ${sectionsMarkup}
      </section>
      <footer class="footer">
        <span>${escapeHtml(payload.footerNote ?? 'Все данные обновляются автоматически после завершения матчей.')}</span>
        <div class="footer-links">
          <a href="https://t.me/footballobn_bot" target="_blank" rel="noreferrer">t.me/footballobn_bot</a>
          <a href="https://vk.com/nochligaobninsk" target="_blank" rel="noreferrer">vk.com/nochligaobninsk</a>
        </div>
      </footer>
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

        function waitForImages(root, timeoutMs) {
          timeoutMs = timeoutMs || 3000
          var imgs = Array.from((root || document).querySelectorAll('img'))
          var promises = imgs.map(function (img) {
            return new Promise(function (resolve) {
              if (img.complete && img.naturalWidth > 0) {
                if (typeof img.decode === 'function') {
                  img.decode().then(resolve).catch(function () {
                    resolve()
                  })
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
              function onLoad() {
                done()
              }
              function onError() {
                done()
              }
              function cleanup() {
                img.removeEventListener('load', onLoad)
                img.removeEventListener('error', onError)
              }
              img.addEventListener('load', onLoad)
              img.addEventListener('error', onError)

              if (img.complete && typeof img.decode === 'function') {
                img.decode().then(onLoad).catch(function () {})
              }
            })
          })

          return Promise.race([
            Promise.all(promises),
            new Promise(function (res) {
              setTimeout(res, timeoutMs)
            }),
          ])
        }

        var downloadImage = function (format) {
          ensureHtml2Canvas(function (html2canvas) {
            waitForImages(shell, 3000).then(function () {
              html2canvas(shell, { backgroundColor: null, scale: 2, useCORS: true })
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
            })
          })
        }

        buttons.forEach(function (button) {
          button.addEventListener('click', function () {
            var format = button.getAttribute('data-format')
            var action = button.getAttribute('data-action')
            if (format === 'png' || format === 'jpg') {
              downloadImage(format)
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
