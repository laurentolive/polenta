import { createRootRoute, Outlet, useRouterState } from '@tanstack/react-router'
import { AppLayout } from '../components/layout/AppLayout'
import { TabBar } from '../components/layout/TabBar'
import { useMenuEvents } from '../hooks/useMenuEvents'
import { useTabShortcuts } from '../hooks/useTabShortcuts'
import { ThemeProvider } from '../contexts/ThemeContext'
import { TabsProvider } from '../contexts/TabsContext'

// T101 — owns h-screen; AppLayout's own root div is h-full, sized by the flex-1 wrapper below.
function AppChrome() {
  useTabShortcuts()
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <TabBar />
      <div className="flex-1 min-h-0">
        <AppLayout />
      </div>
    </div>
  )
}

function RootLayout() {
  useMenuEvents()
  const pathname = useRouterState({ select: s => s.location.pathname })
  // Les routes /print/* (T43) ne sont jamais visitées par l'utilisateur — chargées uniquement par
  // la fenêtre Electron cachée d'un export PDF, sans chrome d'appli (sidebar/activity bar/onglets).
  const isBareRoute = pathname === '/login' || pathname.startsWith('/print/')
  return (
    <ThemeProvider>
      {isBareRoute ? <Outlet /> : <TabsProvider><AppChrome /></TabsProvider>}
    </ThemeProvider>
  )
}

export const Route = createRootRoute({
  component: RootLayout,
})
