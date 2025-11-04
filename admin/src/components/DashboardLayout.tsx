import { useEffect, useState } from 'react'
import { AdminTab, useAdminStore } from '../store/adminStore'
import { TeamsTab } from './tabs/TeamsTab'
import { MatchesTab } from './tabs/MatchesTab'
import { StatsTab } from './tabs/StatsTab'
import { PlayersTab } from './tabs/PlayersTab'
import { UsersTab } from './tabs/UsersTab'
import { NewsTab } from './tabs/NewsTab'
import { PredictionsTab } from './tabs/PredictionsTab'
import { RatingsTab } from './tabs/RatingsTab'
import { ScrollToTopButton } from './ScrollToTopButton'

const tabMeta: Record<AdminTab, { title: string; description: string }> = {
  teams: {
    title: 'Команды',
    description: 'Справочники: клубы, люди, стадионы и соревнования.',
  },
  matches: {
    title: 'Матчи',
    description: 'Сезоны, участники, серии, расписание и фиксация результатов.',
  },
  stats: {
    title: 'Статистика',
    description: 'Таблица и индивидуальная статистика по сезонам и карьере.',
  },
  players: {
    title: 'Ростеры и дисквалификации',
    description: 'Регистрация составов по сезонам, контроль заявок и санкций.',
  },
  predictions: {
    title: 'Прогнозы',
    description: 'Настройка рынков и тоталов для предстоящих матчей.',
  },
  ratings: {
    title: 'Рейтинги',
    description: 'Управление окнами расчёта и мониторинг лидербордов.',
  },
  news: {
    title: 'Новости',
    description: 'Публикация новостей, предпросмотр и отправка в Telegram.',
  },
  users: {
    title: 'Пользователи и активность',
    description: 'Управление пользователями, прогнозами и достижениями.',
  },
}

const tabsOrder: AdminTab[] = [
  'teams',
  'matches',
  'stats',
  'players',
  'predictions',
  'ratings',
  'news',
  'users',
]

type StoreState = ReturnType<typeof useAdminStore.getState>

export const DashboardLayout = () => {
  const { logout, activeTab, setTab } = useAdminStore((state: StoreState) => ({
    logout: state.logout,
    activeTab: state.activeTab,
    setTab: state.setTab,
  }))
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    if (!menuOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [menuOpen])

  const handleTabClick = (tab: AdminTab) => {
    setTab(tab)
    setMenuOpen(false)
  }

  const toggleMenu = () => setMenuOpen(value => !value)

  const closeMenu = () => setMenuOpen(false)

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'teams':
        return <TeamsTab />
      case 'matches':
        return <MatchesTab />
      case 'stats':
        return <StatsTab />
      case 'players':
        return <PlayersTab />
      case 'predictions':
        return <PredictionsTab />
      case 'ratings':
        return <RatingsTab />
      case 'news':
        return <NewsTab />
      case 'users':
        return <UsersTab />
      default:
        return null
    }
  }

  return (
    <div className="dashboard-shell neo-accents">
      <div className="shell-header">
        <h2>Обнинск лига — админ</h2>
      </div>
      <div className="tabs" role="tablist" aria-label="Админские вкладки">
        <div className="tabs-toolbar">
          <button
            type="button"
            className="tab-burger"
            aria-expanded={menuOpen}
            aria-controls="admin-tabs"
            onClick={toggleMenu}
          >
            <span className="tab-burger-label">Разделы</span>
          </button>
          <div className="user-badge" role="status" aria-live="polite">
            <span>online</span>
            <button className="user-logout" type="button" onClick={() => logout()}>
              Выйти
            </button>
          </div>
        </div>
        <div id="admin-tabs" className={`tab-list${menuOpen ? ' open' : ''}`}>
          {tabsOrder.map(tab => (
            <button
              key={tab}
              className={`tab-button${activeTab === tab ? ' active' : ''}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => handleTabClick(tab)}
            >
              {tabMeta[tab].title}
            </button>
          ))}
        </div>
        {menuOpen ? <div className="tab-overlay" role="presentation" onClick={closeMenu} /> : null}
      </div>
      <div className="tab-panel" role="tabpanel">
        {renderActiveTab()}
      </div>
      <ScrollToTopButton />
    </div>
  )
}
