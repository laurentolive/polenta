# GH342 — Sprint 1 : fenêtres, ouverture sur une page, restauration

## Fichiers

| Fichier | Changement |
|---|---|
| `apps/desktop/src/main/host/app-windows.ts` | nouveau — création des fenêtres (sortie de `main/index.ts`), registre (route, dirty), ordre d'activation, `windows-state.json` (écriture à la fermeture de la dernière fenêtre / `before-quit`), restauration, `openWindowFrom`, `applyBounds` |
| `apps/desktop/src/main/host/window-placement.ts` (+ test, 14 cas) | nouveau, pur — `offsetPlacement`, `fitToDisplays`, `parseSavedWindows`, `isRestorableRoute` |
| `apps/desktop/src/shared/app-route.ts` | nouveau — `isValidAppRoute`, `splitAppRoute`, `routeProjectId` (main, renderer, bridge web) |
| `apps/desktop/src/main/index.ts` | `restoreOrCreateWindows()` ; invitation → dernière fenêtre active (plus de diffusion) ; exécutable relancé sans lien → fenêtre au premier plan |
| `apps/desktop/src/main/ipc/{channels,desktop-only.handlers}.ts` | `app:open-window`, `app:window-state` ; `app:take-pending-invite` réservé à la dernière fenêtre active |
| `apps/desktop/src/main/menu.ts` | import de `createAppWindow` (code mort, compile) |
| `packages/api-client/src/{types,ipc-client}.ts` | `app.openWindow`, `app.setWindowState` |
| `apps/desktop/src/renderer/web/bridge.ts` | web : `window.open` (nouvel onglet), `beforeunload` si non sauvegardé |
| `apps/desktop/src/renderer/main.tsx` | boot : `__open` (desktop), URL d'entrée (web) si le projet existe encore |
| `apps/desktop/src/renderer/hooks/useWindowState.ts`, `routes/__root.tsx` | route de l'onglet actif et état non sauvegardé remontés au main |
| `apps/desktop/src/renderer/hooks/useTabShortcuts.ts` | Ctrl/Cmd+Shift+N (desktop) |
| `apps/desktop/src/renderer/components/layout/TabBar.tsx`, i18n | menu contextuel d'onglet (nouvelle fenêtre, fermer) |
| `apps/desktop/src/renderer/lib/tabHistory.ts` | `hrefOf` |
| `apps/desktop/e2e-desktop/gh342-windows.spec.ts` | F1, F2/F3, D1, R1/R2/R4, R3/R5 |
| `apps/desktop/e2e-web/gh342-windows.spec.ts` | W1, W2, W3 |

## Divergences par rapport au design

- **Pas de contrôle de compte** au boot sur une page à ouvrir (design §1.4) : une page rouverte vient
  d'une session ouverte ; seul l'existence du projet est vérifiée. Design mis à jour.
- **Pas de débounce** sur la remontée de la route : une navigation juste avant la fermeture était
  perdue (revue de code).
- **`fitToDisplays`** : une fenêtre est gardée sur l'écran qui en recouvre au moins la moitié, puis
  recadrée dedans (et non « entièrement contenue, sinon recentrée ») — les bordures invisibles de
  Windows font déborder de 7 px une fenêtre collée au bord (revue de code).
- **Dérive de taille corrigée** (`applyBounds`) : sous Windows à 125 %, la taille passée au
  constructeur ne faisait pas l'aller-retour avec `getNormalBounds()` — +6 px de hauteur à chaque
  relance, mesuré. Compensation relue après `setBounds` : stable sur 3 relances, écran principal
  (1,25) et secondaire (1,0).
- Invitation et relance de l'exécutable traitées dès ce sprint (prévues au sprint 2).

## Vérifications

- `pnpm typecheck` OK ; `pnpm test` : 1738 tests desktop OK (+ merge-core, admin-service).
- e2e desktop `gh342-windows` : 5/5 (trois exécutions). Neighbours : gh210, gh237 OK ; gh202, gh204,
  gh238 échouent **aussi sur `origin/main`** (mise en place via la barre d'activité) → #345.
- e2e web `gh342-windows` : 3/3 ; voisines gh228, gh338, gh300, gh65-navigation, gh56, gh123 : 43/43.
- Revue de code (PR #344) : 9 constats ; 4 corrigés ici, 3 relèvent du sprint 2 (garde de fermeture,
  terminal, dialogues), 1 sans objet (sortie annulée : aucune garde ne l'annule), 1 corrigé (invitation).

## Tester à la main

1. Ouvrir un projet, aller sur une exigence d'un composant ; Ctrl+Shift+N → seconde fenêtre sur la
   même exigence, décalée. Clic droit sur un onglet → « Ouvrir dans une nouvelle fenêtre ».
2. Déplacer la seconde fenêtre sur l'autre écran, y changer de composant ; fermer l'application
   (croix de la dernière fenêtre) puis la relancer → deux fenêtres, chacune sur son écran et sa page.
3. Débrancher l'écran 2, relancer → la fenêtre revient sur l'écran principal.
