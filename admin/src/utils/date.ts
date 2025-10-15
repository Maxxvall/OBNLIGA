const MOSCOW_TIME_ZONE = 'Europe/Moscow'
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

  const finalOptions: Intl.DateTimeFormatOptions = {
    hour12: false,
    ...options,
    timeZone: MOSCOW_TIME_ZONE,
  }

  return new Intl.DateTimeFormat(RU_LOCALE, finalOptions).format(date)
}
