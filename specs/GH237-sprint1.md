# GH237 — Sprint 1 (unique) : zoom de l'interface

## Fichiers modifiés

- `apps/desktop/src/shared/zoom.ts` (+ test) — paliers, normalisation, pas suivant / précédent.
- `packages/types/src/app.ts` — `AppSettings.zoomFactor`, `ZoomAction`.
- `apps/desktop/src/main/services/app-settings.service.ts` (+ test `.gh237`) — `zoomFactor` lu / écrit, absent à 100 %.
- `apps/desktop/src/main/host/app-zoom.ts` (nouveau) — niveau courant en mémoire, `zoom-changed`, application à toutes les fenêtres, diffusion `app:zoom-changed`, persistance tolérante aux échecs d'écriture.
- `apps/desktop/src/main/index.ts` — `webPreferences.zoomFactor`, `attachAppZoom`, `initAppZoom`.
- `apps/desktop/src/main/ipc/channels.ts`, `desktop-only.handlers.ts` — channel `app:zoom` (action validée).
- `packages/api-client/src/{types,ipc-client}.ts` — `app.zoom(action)`.
- `apps/desktop/src/renderer/components/layout/zoomShortcut.ts` (+ test), `ZoomIndicator.tsx` — raccourcis (capture sur `window`) et bulle.
- `apps/desktop/src/renderer/components/layout/sidebarCollapse.ts` — `hasCommandModifier` partagé avec les raccourcis de zoom.
- `apps/desktop/src/renderer/routes/__root.tsx`, `platform.ts` (`capabilities.appZoom`), locales fr / en (`zoom.*`).
- `apps/desktop/vitest.config.ts` — inclut `src/shared/**/*.test.ts`.
- `apps/desktop/e2e-desktop/gh237-zoom.spec.ts` — E1–E4 + isolement d'une fenêtre hors écran.

## Comportement implémenté

Conforme à `specs/GH237.md` : zoom global par paliers 50–300 %, Ctrl+molette / pincement et
Ctrl+= / Ctrl++ / Ctrl+- / Ctrl+0 (pavé numérique, AZERTY, Cmd sur macOS), préférence app
`zoomFactor` restaurée avant le premier paint, toutes les fenêtres synchronisées, bulle
temporaire avec Réinitialiser, zoom propre de draw.io préservé, exports à 100 %.

## Divergences par rapport au design

- Le niveau courant est gardé en mémoire dans le main (revue de code : pas de relecture du fichier
  à chaque cran de molette, écriture en `try/catch`) ; `initialZoomFactor` → `currentZoomFactor`.
- Raccourcis écoutés en **capture** : le terminal xterm (GH238) arrête la propagation des touches.
- Fenêtres hors écran : aucune modification nécessaire (clé de zoom `file://` = URL complète,
  vérifié en e2e) ; limite connue sous `pnpm dev`, notée dans la SPEC.

## Mises à jour SPEC

- `SPEC-ELECTRON-DESKTOP.md` §19.2 — nouveau bloc « Zoom de l'interface (GH237) ».
- `SPEC-TECH-stack.md` §9 — `zoomFactor` dans `app-settings.json`.
- `SPEC-PROJECT-MANAGEMENT.md` §2 — menu natif désactivé ⇒ zoom implémenté à part.
- `SPEC-INDEX.md` — lignes correspondantes, colonne MAJ → GH237.

## Tests

- `pnpm typecheck` : OK.
- `pnpm test` : nouveaux tests OK ; un échec ponctuel non lié (`integration-branch.service.test.ts`
  T-01, git), passant à la relance isolée.
- `pnpm test:e2e:desktop -g GH237` : 4/4.

## Comment tester manuellement

Lancer l'appli depuis le worktree du milestone (`pnpm --filter @polenta/desktop dev`, ou build) puis
dérouler les scénarios manuels M1–M6 de `specs/GH237-tests.md` : Ctrl+molette / pincement, éditeur
et visionneuse draw.io, diagramme en lecture en Vue Word, export PDF à 200 %, AZERTY, raccourcis existants.
