import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { routeTree } from './routeTree.gen'
import { api } from './api'
import { isWeb } from './platform'
import { decodeProjectId } from './lib/projectId'
import { isValidAppRoute, routeProjectId, splitAppRoute } from '../shared/app-route'
import './index.css'
import './i18n'

// GH170 — gcTime 30 min (défaut React Query : 5 min) : changer d'onglet remonte la route, et une
// vue quittée plus de 5 min avait perdu son cache → rechargement complet, page vide le temps de
// relire le disque au retour sur l'onglet.
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 1000 * 60, gcTime: 1000 * 60 * 30 } },
})

const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// T43 — la fenêtre Electron cachée d'un export PDF charge toujours `index.html` (via `loadURL`
// avec une query, ou `loadFile(..., {search})` en prod) : `file://.../index.html` ne peut pas
// cibler un sous-chemin directement, c'est le seul point d'entrée disponible pour ces fenêtres.
// `__print` porte le chemin de la route imprimable réellement visée (cf. `electron-pdf.ts`).
//
// Un `history.replaceState` avant `createRouter` ne suffit pas : sur une URL `file://` d'entrée,
// TanStack Router peut quand même résoudre son premier match sur `/` (quirk documenté par
// apps/desktop/.claude/skills/run-desktop — "Cold boot sometimes shows a stray Not Found... one
// real client-side navigate() call fixes it"). Sans ce `navigate()` explicite, `HomePage` (`/`)
// peut monter et lancer son propre effet de redirection (`routes/index.tsx`, vers `/login` ou
// `/schema`) avant que la route imprimable ne s'affiche — ni l'un ni l'autre n'appelle jamais
// `notifyPrintReady()`, la fenêtre cachée reste bloquée jusqu'au timeout de `electron-pdf.ts`. On
// attend donc explicitement la résolution de la navigation avant de monter `<RouterProvider>`, ce
// qui garantit qu'aucun autre écran ne peut jamais apparaître même brièvement.
const bootParams = new URLSearchParams(window.location.search)
const printTarget = bootParams.get('__print')
// GH342 — page d'ouverture d'une fenêtre : nouvelle fenêtre (Ctrl+Shift+N, menu d'onglet) ou
// fenêtre rouverte au lancement (desktop, `__open`, même contrainte `file://` que `__print`) ;
// lien direct, nouvel onglet ou F5 dans le navigateur (web : l'URL d'entrée elle-même).
const openTarget = bootParams.get('__open')
  ?? (isWeb && window.location.pathname !== '/' ? window.location.pathname + window.location.search : null)

/** Page d'un projet : seulement si le projet est encore là (déplacé, supprimé → démarrage
 *  habituel). Page hors projet : ouverte telle quelle. Pas de contrôle de compte comme l'accueil :
 *  une page à rouvrir vient d'une session déjà ouverte (le premier lancement n'en a pas). */
async function canOpen(route: string): Promise<boolean> {
  if (!isValidAppRoute(route)) return false
  const projectId = routeProjectId(route)
  if (!projectId) return true
  try {
    await api.workspace.resolve(decodeProjectId(projectId))
    return true
  } catch {
    return false
  }
}

async function boot() {
  if (printTarget) {
    bootParams.delete('__print')
    await router.navigate({ to: printTarget as never, search: Object.fromEntries(bootParams) as never, replace: true })
  } else if (openTarget && await canOpen(openTarget)) {
    const { pathname, search } = splitAppRoute(openTarget)
    await router.navigate({ to: pathname as never, search: search as never, replace: true })
  } else {
    // T114 — same file://-entry-URL quirk as above, hitting the normal (non-print) boot path too:
    // on a cold boot, TanStack Router's very first match is sometimes computed against the raw
    // `file://.../index.html` entry location instead of "/", landing on a dead-end "Not Found"
    // with nothing on screen to click out of it. Before T108 this was survivable — the sidebar
    // kept its own copy of the Ouvrir/Cloner/Créer buttons, a real navigate() away from them and
    // back "fixed" it — but T108 moved those into the "/" page itself, i.e. exactly the page stuck
    // on "Not Found", closing that escape hatch. One explicit `navigate({ to: '/' })` before the
    // first mount (mirroring the print branch above) forces the correct match up front.
    await router.navigate({ to: '/', replace: true })
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )
}

boot()
