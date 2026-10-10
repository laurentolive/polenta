import { createRootRoute, Outlet, useRouterState } from '@tanstack/react-router'
import { AppLayout } from '../components/layout/AppLayout'
import { TabBar } from '../components/layout/TabBar'
import { useMenuEvents } from '../hooks/useMenuEvents'
import { useLiveFileSync } from '../hooks/useLiveFileSync'
import { useTabShortcuts } from '../hooks/useTabShortcuts'
import { ThemeProvider } from '../contexts/ThemeContext'
import { TabsProvider } from '../contexts/TabsContext'
import { useInviteLinks } from '../hooks/useInviteLinks'
import { useTeamConfigEffects } from '../hooks/useTeamConfig'

/** GH45 S2b — lien d'invitation et configuration d'équipe (sous ThemeProvider : thème par défaut). */
function AppEffects({ enabled }: { enabled: boolean }) {
  useInviteLinks()
  useTeamConfigEffects(enabled)
  return null
}

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
  useLiveFileSync()
  const pathname = useRouterState({ select: s => s.location.pathname })
  // Les routes /print/* (T43) ne sont jamais visitées par l'utilisateur — chargées uniquement par
  // la fenêtre Electron cachée d'un export PDF, sans chrome d'appli (sidebar/activity bar/onglets).
  const isBareRoute = pathname === '/login' || pathname.startsWith('/print/')
  const isPrint = pathname.startsWith('/print/')
  return (
    <ThemeProvider>
      {!isPrint && <AppEffects enabled={pathname !== '/login'} />}
      {isBareRoute ? <Outlet /> : <TabsProvider><AppChrome /></TabsProvider>}
    </ThemeProvider>
  )
}

export const Route = createRootRoute({
  component: RootLayout,
})
