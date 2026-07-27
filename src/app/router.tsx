import { createBrowserRouter } from 'react-router-dom'
import { DashboardPage } from '../features/dashboard/DashboardPage'
import { EnergyPage } from '../features/energy/EnergyPage'
import { NotFoundPage } from '../features/not-found/NotFoundPage'
import { SystemPage } from '../features/system/SystemPage'
import { TrackPage } from '../features/track/TrackPage'
import { AppLayout } from './layout/AppLayout'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'energie', element: <EnergyPage /> },
      { path: 'traseu', element: <TrackPage /> },
      { path: 'sistem', element: <SystemPage /> },
    ],
  },
  {
    path: '*',
    element: <NotFoundPage />,
  },
])
