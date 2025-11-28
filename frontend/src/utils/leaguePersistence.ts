/**
 * Persistence helper для кэширования данных лиги в localStorage
 */

const STORAGE_PREFIX = 'obnliga_league_'
// Версия 3: сброс после внедрения эталонной системы кубка (28.11.2025)
// Старые данные могли иметь неверную структуру групп
const STORAGE_VERSION = 3

type StorageKey = 
  | 'tables'
  | 'schedules'
  | 'results'
  | 'stats'
  | 'tableVersions'
  | 'scheduleVersions'
  | 'resultsVersions'
  | 'resultsRoundVersions'
  | 'resultsRoundFetchedAt'
  | 'statsVersions'

type StorageEntry<T> = {
  version: number
  timestamp: number
  data: T
}

const buildKey = (key: StorageKey): string => {
  return `${STORAGE_PREFIX}${key}_v${STORAGE_VERSION}`
}

export const readFromStorage = <T>(key: StorageKey): T | null => {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.localStorage.getItem(buildKey(key))
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as StorageEntry<T>
    if (parsed.version !== STORAGE_VERSION) {
      window.localStorage.removeItem(buildKey(key))
      return null
    }

    return parsed.data
  } catch {
    return null
  }
}

export const writeToStorage = <T>(key: StorageKey, data: T): void => {
  if (typeof window === 'undefined') {
    return
  }

  try {
    const entry: StorageEntry<T> = {
      version: STORAGE_VERSION,
      timestamp: Date.now(),
      data,
    }
    window.localStorage.setItem(buildKey(key), JSON.stringify(entry))
  } catch (err) {
    // Игнорируем ошибки записи (переполнение quota, private mode и т.п.)
    console.warn('[localStorage] Failed to write', key, err)
  }
}

export const clearStorage = (key?: StorageKey): void => {
  if (typeof window === 'undefined') {
    return
  }

  try {
    if (key) {
      window.localStorage.removeItem(buildKey(key))
    } else {
      // Удаляем все ключи с префиксом
      const keysToRemove: string[] = []
      for (let i = 0; i < window.localStorage.length; i++) {
        const storageKey = window.localStorage.key(i)
        if (storageKey?.startsWith(STORAGE_PREFIX)) {
          keysToRemove.push(storageKey)
        }
      }
      keysToRemove.forEach(k => window.localStorage.removeItem(k))
    }
  } catch {
    // Игнорируем ошибки
  }
}
