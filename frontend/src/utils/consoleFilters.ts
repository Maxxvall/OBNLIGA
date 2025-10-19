const TELEGRAM_PREFIX = '[Telegram.WebView]'
const SUPPRESSED_PREFIXES = [TELEGRAM_PREFIX]

export const setupConsoleFilters = (): void => {
  if (typeof window === 'undefined') {
    return
  }

  const consoleRef = window.console
  const originalLog = consoleRef.log.bind(consoleRef)
  const markerKey = '__obnligaConsoleFiltered__'
  if ((consoleRef as unknown as Record<string, unknown>)[markerKey]) {
    return
  }

  consoleRef.log = (...args: unknown[]) => {
    if (args.length > 0 && typeof args[0] === 'string') {
      const message = args[0]
      if (SUPPRESSED_PREFIXES.some(prefix => message.startsWith(prefix))) {
        return
      }
    }
    originalLog(...args)
  }

  (consoleRef as unknown as Record<string, unknown>)[markerKey] = true
}
