# GH237 — Design : zoom de l'interface

Spec : `specs/GH237.md`. Un seul sprint.

## Principe

Le **main** est seul maître du niveau : il lit/écrit la préférence, l'applique aux fenêtres de
l'application et diffuse le nouveau niveau. Le renderer ne fait que remonter des intentions
(`in` / `out` / `reset`) et afficher la bulle.

- **Molette** : Electron émet `webContents` `zoom-changed` (`'in'` | `'out'`) sur Ctrl+molette /
  pincement **seulement si la page n'a pas consommé l'événement** (`preventDefault`). L'éditeur
  et la visionneuse draw.io consomment leur Ctrl+molette → pas d'événement, leur zoom reste le
  leur, sans code dédié.
- **Clavier** : écouté dans le renderer (`keydown` sur `window`). Une frappe dans l'iframe de
  l'éditeur draw.io ne remonte pas au document parent → draw.io garde ses raccourcis, sans code
  dédié. (Rejeté : `before-input-event` dans le main — il voit aussi les frappes de l'iframe
  draw.io, il faudrait savoir où est le focus.)

## Fichiers

| Fichier | Rôle |
|---|---|
| `apps/desktop/src/shared/zoom.ts` (nouveau) | `ZOOM_STEPS`, `ZOOM_DEFAULT = 1`, `normalizeZoomFactor(unknown)` (palier le plus proche dans [0,5 ; 3], 1 si non numérique), `stepZoom(factor, 'in'\|'out'\|'reset')`. Partagé main / renderer. |
| `apps/desktop/src/shared/zoom.test.ts` (nouveau) | Tests unitaires. |
| `packages/types/src/app.ts` | `AppSettings.zoomFactor?: number` ; type `ZoomAction = 'in' \| 'out' \| 'reset'`. |
| `apps/desktop/src/main/services/app-settings.service.ts` | `read()` : `zoomFactor` normalisé, présent seulement s'il ≠ 1 ; `set()` : idem (clé supprimée à 1). Même convention que `networkTimeoutSeconds`. |
| `apps/desktop/src/main/services/app-settings.service.gh237.test.ts` (nouveau) | Persistance, absence à 1, valeurs invalides. |
| `apps/desktop/src/main/host/app-zoom.ts` (nouveau) | `initAppZoom(settings)`, `currentZoomFactor()` (facteur courant gardé en mémoire), `attachAppZoom(win)` (abonnement `zoom-changed`, fenêtre ajoutée à l'ensemble des fenêtres de l'application), `applyZoom(action)` : calcule le palier, écrit la préférence, `setZoomFactor` sur chaque fenêtre de l'application, diffuse `app:zoom-changed` (facteur) à ces fenêtres, retourne le facteur. |
| `apps/desktop/src/main/index.ts` | `webPreferences.zoomFactor: currentZoomFactor()` (niveau appliqué avant le premier paint), `attachAppZoom(win)` ; `initAppZoom(container.appSettings)` avant la première fenêtre. |
| `apps/desktop/src/main/ipc/channels.ts`, `desktop-only.handlers.ts` | Channel desktop-only `app:zoom` (action) → facteur. |
| `packages/api-client/src/types.ts`, `ipc-client.ts` | `app.zoom(action): Promise<number>`. |
| `apps/desktop/src/renderer/platform.ts` | `capabilities.appZoom = !isWeb`. |
| `apps/desktop/src/renderer/components/layout/zoomShortcut.ts` (nouveau) + test | `zoomShortcutAction(e)` → `ZoomAction \| null` : Ctrl (Cmd sur macOS), sans Alt ; `key` `=`/`+` → in, `-` → out, `0` → reset ; `code` `NumpadAdd`/`NumpadSubtract`/`Numpad0`/`Digit0` en repli (AZERTY : Ctrl+0 de la rangée produit `à`). |
| `apps/desktop/src/renderer/components/layout/ZoomIndicator.tsx` (nouveau) | Raccourcis clavier + bulle : écoute `app:zoom-changed`, affiche `NN %` et « Réinitialiser » (≠ 100 %), masquée 1,5 s après le dernier changement, minuterie suspendue au survol. `position: fixed`, haut-centre, `pointer-events` limités à la bulle, `role="status"`. |
| `apps/desktop/src/renderer/routes/__root.tsx` | `ZoomIndicator` monté hors `/print/*` (aussi sur `/login`), si `capabilities.appZoom`. |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | `zoom.reset`, `zoom.label`. |
| `apps/desktop/e2e-desktop/gh237-zoom.spec.ts` (nouveau) | Scénarios E1–E4 de `GH237-tests.md`. |

Fenêtres hors écran (`electron-pdf.ts`, `electron-drawio-snapshot.ts`) : jamais passées à
`attachAppZoom`. Le zoom Chromium est mémorisé par origine, mais sous `file://` la clé est l'URL
complète et ces fenêtres chargent `index.html?…` : elles restent à 100 % sans modification
(vérifié en e2e). Limite connue, développement seulement : sous `pnpm dev` (http://localhost) le
zoom peut s'y propager.

## Décisions

- Paliers et non facteur continu : pas d'accumulation flottante, valeurs stables dans le fichier.
- Pas de préférence dans le panneau compte (hors scope spec).
- La bulle est montée à la racine (pas dans `AppLayout`) pour couvrir aussi `/login`.

## Sprints

Un sprint : tout le périmètre ci-dessus.
