import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { DashboardPage } from '../features/dashboard/DashboardPage'
import { DriversPage } from '../features/drivers/DriversPage'
import { EnergyPage } from '../features/energy/EnergyPage'
import { NotFoundPage } from '../features/not-found/NotFoundPage'
import { SessionsPage } from '../features/sessions/SessionsPage'
import { StatisticsPage } from '../features/statistics/StatisticsPage'
import { SystemPage } from '../features/system/SystemPage'
import { TrackPage } from '../features/track/TrackPage'
import { WeatherPage } from '../features/weather/WeatherPage'

/**
 * Toate paginile trăiesc sub același shell, ca WebSocketul să rămână deschis la
 * navigare. Zonele urmează împărțirea din documentul de arhitectură: stare
 * generală, energie, temperaturi/alarme și traseu.
 */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'statistici', element: <StatisticsPage /> },
      { path: 'energie', element: <EnergyPage /> },
      { path: 'traseu', element: <TrackPage /> },
      { path: 'vreme', element: <WeatherPage /> },
      { path: 'piloti', element: <DriversPage /> },
      { path: 'sistem', element: <SystemPage /> },
      { path: 'sesiuni', element: <SessionsPage /> },
    ],
  },
  {
    path: '*',
    element: <NotFoundPage />,
  },
])
