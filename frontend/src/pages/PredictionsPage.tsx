import React, { useEffect, useState } from 'react'
import type { ActivePredictionMatch, UserPredictionEntry } from '@shared/types'
import { fetchActivePredictions, fetchMyPredictions } from '../api/predictionsApi'
import '../styles/predictions.css'

const DATE_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

type PredictionsTab = 'upcoming' | 'mine'

const formatDateTime = (iso: string): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }
  return DATE_FORMATTER.format(date)
}

const renderMatchHeader = (match: ActivePredictionMatch | UserPredictionEntry) => (
  <div className="prediction-match-header">
    <div className="prediction-club">
      {match.homeClub.logoUrl ? (
        <img src={match.homeClub.logoUrl} alt={match.homeClub.name} />
      ) : null}
      <span>{match.homeClub.shortName ?? match.homeClub.name}</span>
    </div>
    <span className="prediction-vs">vs</span>
    <div className="prediction-club">
      {match.awayClub.logoUrl ? (
        <img src={match.awayClub.logoUrl} alt={match.awayClub.name} />
      ) : null}
      <span>{match.awayClub.shortName ?? match.awayClub.name}</span>
    </div>
  </div>
)

const renderTemplates = (templates: ActivePredictionMatch['templates']) => {
  if (!templates.length) {
    return <p className="prediction-note">Настройки прогнозов появятся позже.</p>
  }

  return (
    <ul className="prediction-template-list">
      {templates.map(template => {
        const optionSummary =
          template.options && typeof template.options === 'object'
            ? JSON.stringify(template.options)
            : String(template.options ?? '—')

        return (
          <li key={template.id} className="prediction-template-item">
            <div className="prediction-template-market">
              <span className="prediction-market-label">Рынок:</span>
              <strong>{template.marketType}</strong>
            </div>
            <div className="prediction-template-options">
              <span className="prediction-market-label">Варианты:</span>
              <span>{optionSummary}</span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

const renderUserPrediction = (prediction: UserPredictionEntry) => {
  const statusLabel: Record<UserPredictionEntry['status'], string> = {
    PENDING: 'Ожидает',
    WON: 'Засчитано',
    LOST: 'Не угадан',
    VOID: 'Аннулирован',
    CANCELLED: 'Отменён',
    EXPIRED: 'Просрочен',
  }

  return (
    <li key={prediction.id} className={`prediction-entry prediction-entry-${prediction.status.toLowerCase()}`}>
      {renderMatchHeader(prediction)}
      <div className="prediction-entry-meta">
        <span>{formatDateTime(prediction.matchDateTime)}</span>
        <span className={`prediction-status status-${prediction.status.toLowerCase()}`}>
          {statusLabel[prediction.status] ?? prediction.status}
        </span>
      </div>
      <div className="prediction-entry-body">
        <div>
          <span className="prediction-market-label">Выбор:</span>
          <strong>{prediction.selection}</strong>
        </div>
        <div>
          <span className="prediction-market-label">Категория:</span>
          <span>{prediction.marketType}</span>
        </div>
        {typeof prediction.scoreAwarded === 'number' ? (
          <div>
            <span className="prediction-market-label">Очки:</span>
            <span>{prediction.scoreAwarded}</span>
          </div>
        ) : null}
      </div>
    </li>
  )
}

const PredictionsPage: React.FC = () => {
  const [tab, setTab] = useState<PredictionsTab>('upcoming')
  const [upcoming, setUpcoming] = useState<ActivePredictionMatch[]>([])
  const [mine, setMine] = useState<UserPredictionEntry[]>([])
  const [loadingUpcoming, setLoadingUpcoming] = useState(true)
  const [loadingMine, setLoadingMine] = useState(false)
  const [errorUpcoming, setErrorUpcoming] = useState<string | undefined>(undefined)
  const [errorMine, setErrorMine] = useState<string | undefined>(undefined)
  const [mineLoadedOnce, setMineLoadedOnce] = useState(false)
  const [isAuthorized, setIsAuthorized] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoadingUpcoming(true)
      setErrorUpcoming(undefined)
      try {
        const result = await fetchActivePredictions()
        if (!cancelled) {
          setUpcoming(result.data)
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('predictions: failed to load active list', err)
          setErrorUpcoming('Не удалось загрузить список ближайших матчей.')
        }
      } finally {
        if (!cancelled) {
          setLoadingUpcoming(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (tab !== 'mine' || mineLoadedOnce) {
      return
    }

    let cancelled = false
    setLoadingMine(true)
    setErrorMine(undefined)

    const load = async () => {
      try {
        const result = await fetchMyPredictions()
        if (cancelled) return
        setMine(result.data)
        setIsAuthorized(!result.unauthorized)
      } catch (err) {
        if (!cancelled) {
          console.warn('predictions: failed to load my predictions', err)
          setErrorMine('Не удалось получить ваши прогнозы.')
        }
      } finally {
        if (!cancelled) {
          setMineLoadedOnce(true)
          setLoadingMine(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [tab, mineLoadedOnce])

  const upcomingContent = () => {
    if (loadingUpcoming) {
      return <p className="prediction-note">Загружаем ближайшие матчи...</p>
    }

    if (errorUpcoming) {
      return <p className="prediction-error">{errorUpcoming}</p>
    }

    if (!upcoming.length) {
      return <p className="prediction-note">В ближайшие шесть дней нет доступных прогнозов.</p>
    }

    return (
      <ul className="prediction-match-list">
        {upcoming.map(match => (
          <li key={match.matchId} className="prediction-match">
            {renderMatchHeader(match)}
            <div className="prediction-match-meta">
              <span>{formatDateTime(match.matchDateTime)}</span>
              <span className={`prediction-status status-${match.status.toLowerCase()}`}>
                {match.status === 'SCHEDULED' ? 'Запланирован' : match.status}
              </span>
            </div>
            {renderTemplates(match.templates)}
          </li>
        ))}
      </ul>
    )
  }

  const myContent = () => {
    if (isAuthorized === false) {
      return <p className="prediction-note">Войдите в профиль, чтобы просматривать свои прогнозы.</p>
    }

    if (loadingMine) {
      return <p className="prediction-note">Загружаем историю прогнозов...</p>
    }

    if (errorMine) {
      return <p className="prediction-error">{errorMine}</p>
    }

    if (!mine.length) {
      return <p className="prediction-note">Вы ещё не делали прогнозы. Попробуйте выбрать исходы в ближайших матчах.</p>
    }

    return <ul className="prediction-entry-list">{mine.map(renderUserPrediction)}</ul>
  }

  return (
    <div className="predictions-page">
      <div className="predictions-tabs" role="tablist" aria-label="Прогнозы">
        <button
          type="button"
          role="tab"
          className={tab === 'upcoming' ? 'active' : ''}
          aria-selected={tab === 'upcoming'}
          onClick={() => setTab('upcoming')}
        >
          Ближайшие
        </button>
        <button
          type="button"
          role="tab"
          className={tab === 'mine' ? 'active' : ''}
          aria-selected={tab === 'mine'}
          onClick={() => setTab('mine')}
        >
          Мои прогнозы
        </button>
      </div>

      <div className="predictions-tab-panel" role="tabpanel">
        {tab === 'upcoming' ? upcomingContent() : myContent()}
      </div>
    </div>
  )
}

export default PredictionsPage
