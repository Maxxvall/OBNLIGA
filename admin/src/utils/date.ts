const MOSCOW_TIME_ZONE = 'Europe/Moscow'
const MOSCOW_TIME_SUFFIX = '+03:00'
const RU_LOCALE = 'ru-RU'

export const formatDateTime = (
  value: string | number | Date,
  options?: Intl.DateTimeFormatOptions
): string => {
  if (value === null || value === undefined) {
    return ''
  }

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const baseOptions: Intl.DateTimeFormatOptions = options ?? {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }

  const finalOptions: Intl.DateTimeFormatOptions = {
    hour12: false,
    ...baseOptions,
    timeZone: MOSCOW_TIME_ZONE,
  }

  return new Intl.DateTimeFormat(RU_LOCALE, finalOptions).format(date)
}

export const formatDateTimeInput = (value: string | number | Date): string => {
  if (value === null || value === undefined) {
    return ''
  }

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const formatter = new Intl.DateTimeFormat(RU_LOCALE, {
    timeZone: MOSCOW_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  const parts = formatter.formatToParts(date)
  const lookup = (type: string) => parts.find(part => part.type === type)?.value ?? ''

  const year = lookup('year')
  const month = lookup('month')
  const day = lookup('day')
  const hour = lookup('hour')
  const minute = lookup('minute')

  if (!year || !month || !day || !hour || !minute) {
    return ''
  }

  return `${year}-${month}-${day}T${hour}:${minute}`
}

export const toMoscowISOString = (value: string): string | null => {
  if (!value) {
    return null
  }

  const trimmed = value.trim().replace(' ', 'T')
  const normalized = trimmed.length === 16 ? `${trimmed}:00` : trimmed
  const candidate = `${normalized}${MOSCOW_TIME_SUFFIX}`
  const date = new Date(candidate)

  if (Number.isNaN(date.getTime())) {
    return null
  }

  return date.toISOString()
}
