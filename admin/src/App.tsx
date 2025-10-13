import './theme.css'
import './app.css'
import { useAdminStore } from './store/adminStore'
import { LoginForm } from './components/LoginForm'
import { DashboardLayout } from './components/DashboardLayout'
import { LineupPortalView } from './components/LineupPortalView'
import { JudgePanel } from './components/JudgePanel'
import { AssistantPanel } from './components/AssistantPanel'

export const App = () => {
  type StoreState = ReturnType<typeof useAdminStore.getState>
  const { status, mode } = useAdminStore((state: StoreState) => ({
    status: state.status,
    mode: state.mode,
  }))

  const isAuthenticated = status === 'authenticated'

  let content: JSX.Element = <LoginForm />
  if (isAuthenticated) {
    if (mode === 'lineup') {
      content = <LineupPortalView />
    } else if (mode === 'judge') {
      content = <JudgePanel />
    } else if (mode === 'assistant') {
      content = <AssistantPanel />
    } else {
      content = <DashboardLayout />
    }
  }

  return (
    <div className="root-frame neo-accents">
      <div className="auth-panel">{content}</div>
    </div>
  )
}
