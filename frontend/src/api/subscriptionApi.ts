/**
 * API клиент для работы с подписками и уведомлениями.
 */

import { httpRequest, type ApiResponse } from './httpClient'
import { authHeader } from './sessionToken'

// =================== ТИПЫ ===================

export interface ClubSubscriptionView {
  id: number
  clubId: number
  clubName: string
  clubShortName: string
  clubLogoUrl: string | null
  createdAt: string
}

export interface MatchSubscriptionView {
  id: number
  matchId: string
  homeClubName: string
  awayClubName: string
  matchDateTime: string
  createdAt: string
}

export interface NotificationSettingsView {
  enabled: boolean
  remindBefore: number
  matchStartEnabled: boolean
  matchEndEnabled: boolean
  goalEnabled: boolean
}

export interface SubscriptionsSummaryView {
  clubs: ClubSubscriptionView[]
  matches: MatchSubscriptionView[]
  settings: NotificationSettingsView
}

export interface SubscribeResult {
  subscribed: boolean
  alreadySubscribed?: boolean
}

export interface SubscriptionStatusResult {
  subscribed: boolean
}

// =================== ЛОКАЛЬНЫЙ КЭШ ===================

const SUBSCRIPTION_CACHE_KEY = 'obnliga_club_subscriptions'
const SUBSCRIPTION_CACHE_TTL = 5 * 60 * 1000 // 5 минут

interface SubscriptionCache {
  clubs: Set<number>
  timestamp: number
}

let subscriptionCache: SubscriptionCache | null = null

function loadCacheFromStorage(): SubscriptionCache | null {
  try {
    const stored = localStorage.getItem(SUBSCRIPTION_CACHE_KEY)
    if (!stored) return null
    const parsed = JSON.parse(stored)
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.timestamp !== 'number') return null
    if (!Array.isArray(parsed.clubs)) return null
    if (Date.now() - parsed.timestamp > SUBSCRIPTION_CACHE_TTL) {
      localStorage.removeItem(SUBSCRIPTION_CACHE_KEY)
      return null
    }
    return {
      clubs: new Set(parsed.clubs),
      timestamp: parsed.timestamp,
    }
  } catch {
    return null
  }
}

function saveCacheToStorage(cache: SubscriptionCache) {
  try {
    localStorage.setItem(
      SUBSCRIPTION_CACHE_KEY,
      JSON.stringify({
        clubs: Array.from(cache.clubs),
        timestamp: cache.timestamp,
      })
    )
  } catch {
    // ignore
  }
}

function getCache(): SubscriptionCache {
  if (!subscriptionCache) {
    subscriptionCache = loadCacheFromStorage()
  }
  if (!subscriptionCache) {
    subscriptionCache = { clubs: new Set(), timestamp: Date.now() }
  }
  return subscriptionCache
}

function invalidateCache() {
  subscriptionCache = null
  try {
    localStorage.removeItem(SUBSCRIPTION_CACHE_KEY)
  } catch {
    // ignore
  }
}

// =================== API ФУНКЦИИ ===================

/**
 * Получает список подписок на команды.
 */
export async function fetchClubSubscriptions(
  options?: { signal?: AbortSignal; version?: string }
): Promise<ApiResponse<ClubSubscriptionView[]>> {
  const result = await httpRequest<ClubSubscriptionView[]>('/api/subscriptions/clubs', {
    ...options,
    headers: authHeader(),
  })
  
  // Обновляем локальный кэш
  if (result.ok && !('notModified' in result && result.notModified)) {
    const cache = getCache()
    cache.clubs = new Set(result.data.map(sub => sub.clubId))
    cache.timestamp = Date.now()
    saveCacheToStorage(cache)
  }
  
  return result
}

/**
 * Проверяет статус подписки на команду (с использованием локального кэша).
 */
export async function checkClubSubscriptionStatus(
  clubId: number,
  options?: { signal?: AbortSignal; skipCache?: boolean }
): Promise<boolean> {
  // Сначала проверяем локальный кэш
  if (!options?.skipCache) {
    const cache = getCache()
    if (Date.now() - cache.timestamp < SUBSCRIPTION_CACHE_TTL) {
      return cache.clubs.has(clubId)
    }
  }

  // Если кэш устарел — запрашиваем с сервера
  const result = await httpRequest<SubscriptionStatusResult>(
    `/api/subscriptions/clubs/${encodeURIComponent(clubId)}/status`,
    { ...options, headers: authHeader() }
  )

  if (result.ok && !('notModified' in result && result.notModified)) {
    const cache = getCache()
    if (result.data.subscribed) {
      cache.clubs.add(clubId)
    } else {
      cache.clubs.delete(clubId)
    }
    cache.timestamp = Date.now()
    saveCacheToStorage(cache)
    return result.data.subscribed
  }

  return false
}

/**
 * Подписаться на команду.
 */
export async function subscribeToClub(
  clubId: number,
  options?: { signal?: AbortSignal }
): Promise<ApiResponse<SubscribeResult>> {
  const result = await httpRequest<SubscribeResult>(
    `/api/subscriptions/clubs/${encodeURIComponent(clubId)}`,
    { ...options, method: 'POST', headers: authHeader() }
  )

  if (result.ok && !('notModified' in result && result.notModified)) {
    const cache = getCache()
    cache.clubs.add(clubId)
    cache.timestamp = Date.now()
    saveCacheToStorage(cache)
  }

  return result
}

/**
 * Отписаться от команды.
 */
export async function unsubscribeFromClub(
  clubId: number,
  options?: { signal?: AbortSignal }
): Promise<ApiResponse<SubscribeResult>> {
  const result = await httpRequest<SubscribeResult>(
    `/api/subscriptions/clubs/${encodeURIComponent(clubId)}`,
    { ...options, method: 'DELETE', headers: authHeader() }
  )

  if (result.ok) {
    const cache = getCache()
    cache.clubs.delete(clubId)
    cache.timestamp = Date.now()
    saveCacheToStorage(cache)
  }

  return result
}

/**
 * Получает настройки уведомлений.
 */
export async function fetchNotificationSettings(
  options?: { signal?: AbortSignal; version?: string }
): Promise<ApiResponse<NotificationSettingsView>> {
  return httpRequest<NotificationSettingsView>('/api/notifications/settings', {
    ...options,
    version: options?.version,
    headers: authHeader(),
  })
}

/**
 * Обновляет настройки уведомлений.
 */
export async function updateNotificationSettings(
  settings: Partial<NotificationSettingsView>,
  options?: { signal?: AbortSignal }
): Promise<ApiResponse<NotificationSettingsView>> {
  const auth = authHeader()
  return httpRequest<NotificationSettingsView>('/api/notifications/settings', {
    ...options,
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...auth,
    },
    body: JSON.stringify(settings),
  })
}

/**
 * Получает полную сводку подписок пользователя.
 */
export async function fetchSubscriptionsSummary(
  options?: { signal?: AbortSignal; version?: string }
): Promise<ApiResponse<SubscriptionsSummaryView>> {
  const result = await httpRequest<SubscriptionsSummaryView>('/api/subscriptions/summary', {
    ...options,
    version: options?.version,
    headers: authHeader(),
  })

  // Обновляем локальный кэш
  if (result.ok && !('notModified' in result && result.notModified)) {
    const cache = getCache()
    cache.clubs = new Set(result.data.clubs.map(sub => sub.clubId))
    cache.timestamp = Date.now()
    saveCacheToStorage(cache)
  }

  return result
}

/**
 * Проверяет из локального кэша, подписан ли на команду (без запроса к серверу).
 * Полезно для быстрого отображения UI.
 */
export function isSubscribedToClubCached(clubId: number): boolean | null {
  const cache = loadCacheFromStorage()
  if (!cache) return null
  if (Date.now() - cache.timestamp > SUBSCRIPTION_CACHE_TTL) return null
  return cache.clubs.has(clubId)
}

/**
 * Инвалидирует локальный кэш подписок.
 */
export function invalidateSubscriptionsCache() {
  invalidateCache()
}
