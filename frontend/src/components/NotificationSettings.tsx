/**
 * Компонент настроек уведомлений для профиля пользователя.
 * Позволяет управлять подписками и параметрами уведомлений.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  fetchSubscriptionsSummary,
  fetchNotificationSettings,
  updateNotificationSettings,
  unsubscribeFromClub,
  type NotificationSettingsView,
  type ClubSubscriptionView,
} from '../api/subscriptionApi'
import './NotificationSettings.css'

interface NotificationSettingsProps {
  className?: string
}

export const NotificationSettings: React.FC<NotificationSettingsProps> = ({ className = '' }) => {
  const [settings, setSettings] = useState<NotificationSettingsView | null>(null)
  const [clubs, setClubs] = useState<ClubSubscriptionView[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summaryVersion, setSummaryVersion] = useState<string | undefined>(undefined)
  const [settingsVersion, setSettingsVersion] = useState<string | undefined>(undefined)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const [summaryResult, settingsResult] = await Promise.all([
        fetchSubscriptionsSummary({ version: summaryVersion }),
        fetchNotificationSettings({ version: settingsVersion }),
      ])

      if (summaryResult.ok && !('notModified' in summaryResult && summaryResult.notModified)) {
        setClubs(summaryResult.data.clubs)
        if ('version' in summaryResult && summaryResult.version) {
          setSummaryVersion(summaryResult.version)
        }
      }

      if (settingsResult.ok && !('notModified' in settingsResult && settingsResult.notModified)) {
        setSettings(settingsResult.data)
        if ('version' in settingsResult && settingsResult.version) {
          setSettingsVersion(settingsResult.version)
        }
      }
    } catch (err) {
      console.error('Failed to load notification settings:', err)
      setError('Не удалось загрузить настройки')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const handleSettingChange = useCallback(
    async (key: keyof NotificationSettingsView, value: boolean | number) => {
      if (!settings || saving) return

      setSaving(true)
      const previousSettings = { ...settings }

      // Optimistic update
      setSettings({ ...settings, [key]: value })

      try {
        const result = await updateNotificationSettings({ [key]: value })
        if (result.ok && !('notModified' in result && result.notModified)) {
          setSettings(result.data)
        } else if (!result.ok) {
          // Rollback
          setSettings(previousSettings)
          console.error('Failed to update setting:', result.error)
        }
      } catch (err) {
        // Rollback
        setSettings(previousSettings)
        console.error('Failed to update setting:', err)
      } finally {
        setSaving(false)
      }
    },
    [settings, saving]
  )

  const handleUnsubscribe = useCallback(
    async (clubId: number) => {
      try {
        const result = await unsubscribeFromClub(clubId)
        if (result.ok) {
          setClubs(prev => prev.filter(c => c.clubId !== clubId))
        }
      } catch (err) {
        console.error('Failed to unsubscribe:', err)
      }
    },
    []
  )

  if (loading) {
    return (
      <div className={`notification-settings ${className}`.trim()}>
        <div className="notification-settings-skeleton">
          <div className="skeleton skeleton-heading" />
          <div className="skeleton skeleton-row" />
          <div className="skeleton skeleton-row" />
          <div className="skeleton skeleton-row" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`notification-settings ${className}`.trim()}>
        <div className="notification-settings-error" role="alert">
          <p>{error}</p>
          <button type="button" className="button-secondary" onClick={loadData}>
            Повторить
          </button>
        </div>
      </div>
    )
  }

  if (!settings) return null

  return (
    <div className={`notification-settings ${className}`.trim()}>
      <header className="notification-settings-header">
        <h3>🔔 Уведомления</h3>
      </header>

      <div className="notification-settings-content">
        {/* Главный переключатель */}
        <div className="notification-setting-row main">
          <div className="notification-setting-info">
            <span className="notification-setting-label">Уведомления включены</span>
            <span className="notification-setting-hint">
              Получать напоминания о матчах в Telegram
            </span>
          </div>
          <label className="notification-toggle">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={e => handleSettingChange('enabled', e.target.checked)}
              disabled={saving}
            />
            <span className="notification-toggle-track" />
          </label>
        </div>

        {settings.enabled && (
          <>
            <div className="notification-settings-divider" />

            {/* Дополнительные уведомления */}
            <div className="notification-setting-row">
              <div className="notification-setting-info">
                <span className="notification-setting-label">Начало матча</span>
                <span className="notification-setting-hint">
                  Уведомление когда матч начинается
                </span>
              </div>
              <label className="notification-toggle small">
                <input
                  type="checkbox"
                  checked={settings.matchStartEnabled}
                  onChange={e => handleSettingChange('matchStartEnabled', e.target.checked)}
                  disabled={saving}
                />
                <span className="notification-toggle-track" />
              </label>
            </div>

            <div className="notification-setting-row">
              <div className="notification-setting-info">
                <span className="notification-setting-label">Завершение матча</span>
                <span className="notification-setting-hint">
                  Уведомление с итоговым счётом
                </span>
              </div>
              <label className="notification-toggle small">
                <input
                  type="checkbox"
                  checked={settings.matchEndEnabled}
                  onChange={e => handleSettingChange('matchEndEnabled', e.target.checked)}
                  disabled={saving}
                />
                <span className="notification-toggle-track" />
              </label>
            </div>
          </>
        )}

        {/* Подписки на команды */}
        {clubs.length > 0 && (
          <>
            <div className="notification-settings-divider" />
            <div className="notification-subscriptions">
              <h4 className="notification-subscriptions-title">Подписки на команды</h4>
              <div className="notification-subscriptions-list">
                {clubs.map(club => (
                  <div key={club.id} className="notification-subscription-item">
                    <div className="notification-subscription-club">
                      {club.clubLogoUrl ? (
                        <img
                          src={club.clubLogoUrl}
                          alt=""
                          className="notification-subscription-logo"
                        />
                      ) : (
                        <span className="notification-subscription-logo fallback">
                          {club.clubShortName.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      <span className="notification-subscription-name">{club.clubName}</span>
                    </div>
                    <button
                      type="button"
                      className="notification-unsubscribe-btn"
                      onClick={() => handleUnsubscribe(club.clubId)}
                      aria-label={`Отписаться от ${club.clubName}`}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {clubs.length === 0 && settings.enabled && (
          <>
            <div className="notification-settings-divider" />
            <div className="notification-empty-hint">
              💡 Подпишитесь на команду, чтобы получать уведомления о её матчах.
              Кнопка подписки находится на странице команды.
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default NotificationSettings
