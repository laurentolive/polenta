import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { routeTree } from './routeTree.gen'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 1000 * 60 } },
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
// `__print` porte le chemin de la route imprimable réellement visée (cf. `pdf.util.ts`).
//
// Un `history.replaceState` avant `createRouter` ne suffit pas : sur une URL `file://` d'entrée,
// TanStack Router peut quand même résoudre son premier match sur `/` (quirk documenté par
// apps/desktop/.claude/skills/run-desktop — "Cold boot sometimes shows a stray Not Found... one
// real client-side navigate() call fixes it"). Sans ce `navigate()` explicite, `HomePage` (`/`)
// peut monter et lancer son propre effet de redirection (`routes/index.tsx`, vers `/login` ou
// `/schema`) avant que la route imprimable ne s'affiche — ni l'un ni l'autre n'appelle jamais
// `notifyPrintReady()`, la fenêtre cachée reste bloquée jusqu'au timeout de `pdf.util.ts`. On
// attend donc explicitement la résolution de la navigation avant de monter `<RouterProvider>`, ce
// qui garantit qu'aucun autre écran ne peut jamais apparaître même brièvement.
const bootParams = new URLSearchParams(window.location.search)
const printTarget = bootParams.get('__print')

async function boot() {
  if (printTarget) {
    bootParams.delete('__print')
    await router.navigate({ to: printTarget as never, search: Object.fromEntries(bootParams) as never, replace: true })
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
