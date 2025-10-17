import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import LineupPortal from './LineupPortal'
import MatchDetailsPage from './pages/MatchDetailsPage'

const root = createRoot(document.getElementById('root')!)
const pathname = window.location.pathname
const isLineupPortal = pathname.startsWith('/lineup')
const matchDetailsMatch = pathname.match(/^\/matches\/(\d+)/)

const RootComponent = isLineupPortal
  ? LineupPortal
  : matchDetailsMatch
    ? () => <MatchDetailsPage matchId={matchDetailsMatch[1]} />
    : App

root.render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>
)
