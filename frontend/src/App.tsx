import React, { useEffect, useState } from 'react'
import './app.css'
import './styles/splash.css'
import Profile from './Profile'
import { AdCarousel } from './components/AdCarousel'
import { NewsSection } from './components/NewsSection'
import LeaguePage from './pages/LeaguePage'
import { TeamView } from './components/team/TeamView'
import { MatchDetailsPage } from './pages/MatchDetailsPage'
import { useAppStore } from './store/appStore'

export default function App() {
  const [showSplash, setShowSplash] = useState(true)
  const [progress, setProgress] = useState(0)
  const [isExiting, setIsExiting] = useState(false)
  const currentTab = useAppStore(state => state.currentTab)
  const setTab = useAppStore(state => state.setTab)
  const tapLeagueNav = useAppStore(state => state.tapLeagueNav)
  const leagueMenuOpen = useAppStore(state => state.leagueMenuOpen)
  const matchDetailsOpen = useAppStore(state => state.matchDetails.open)

  useEffect(() => {
    const duration = 1600 // splash duration in ms
    const start = Date.now()
    const interval = setInterval(() => {
      const elapsed = Date.now() - start
      const p = Math.min(100, Math.round((elapsed / duration) * 100))
      setProgress(p)
      if (p >= 100) {
        clearInterval(interval)
        // start exit sequence (small delay for smoothness)
        setIsExiting(true)
      }
    }, 40)

    return () => {
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    if (!isExiting) return
    const t = setTimeout(() => setShowSplash(false), 350)
    return () => clearTimeout(t)
  }, [isExiting])

  if (showSplash) {
    return (
      <div className={'app-root splash' + (isExiting ? ' exiting' : '')}>
        <div className="splash-inner">
          {/* use league logo from public/ so it's served at /logo_liga.png */}
          <img src="/logo_liga.png" alt="Логотип Лиги" className="logo animate heartbeat" />
          <h2 className="neon-title">Футбольная Лига</h2>
          <p className="neon-sub">Загружаем...</p>
          <div className="splash-progress">
            <div className="progress" aria-hidden>
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <span className="progress-percent">{progress}%</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app-root main">
      <div className="content-wrapper">
        {currentTab === 'home' && (
          <>
            <AdCarousel />
            <NewsSection />
          </>
        )}
        {currentTab === 'league' && <LeaguePage />}
        {currentTab === 'profile' ? (
          <Profile />
        ) : (
          currentTab !== 'home' && currentTab !== 'league' && (
            <div className="placeholder">
              <div className="placeholder-card">
                <h2>Страница в разработке</h2>
                <p>Эта вкладка ещё не реализована — работаем над ней.</p>
              </div>
            </div>
          )
        )}
      </div>

      {!leagueMenuOpen && (
        <nav className="bottom-nav" role="navigation" aria-label="Основные вкладки">
          <button
            className={'tab' + (currentTab === 'home' ? ' active' : '')}
            onClick={() => setTab('home')}
            aria-current={currentTab === 'home'}
          >
            <span className="icon">🏠</span>
            <span className="label">Главная</span>
          </button>
          <button
            className={'tab' + (currentTab === 'league' ? ' active' : '')}
            onClick={() => tapLeagueNav(performance.now())}
          >
            <span className="icon">🏆</span>
            <span className="label">Лига</span>
          </button>
          <button
            className={'tab' + (currentTab === 'predictions' ? ' active' : '')}
            onClick={() => setTab('predictions')}
          >
            <span className="icon">📈</span>
            <span className="label">Прогнозы</span>
          </button>
          <button
            className={'tab' + (currentTab === 'leaderboard' ? ' active' : '')}
            onClick={() => setTab('leaderboard')}
          >
            <span className="icon">🥇</span>
            <span className="label">Лидерборд</span>
          </button>
          <button
            className={'tab' + (currentTab === 'shop' ? ' active' : '')}
            onClick={() => setTab('shop')}
          >
            <span className="icon">🛒</span>
            <span className="label">Магазин</span>
          </button>
          <button
            className={'tab' + (currentTab === 'profile' ? ' active' : '')}
            onClick={() => setTab('profile')}
          >
            <span className="icon">👤</span>
            <span className="label">Профиль</span>
          </button>
        </nav>
      )}
      <TeamView />
      {matchDetailsOpen && <MatchDetailsPage />}
    </div>
  )
}
