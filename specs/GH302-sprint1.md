# GH302 — Sprint 1 (desktop)

## Fichiers modifiés

- `packages/types/src/app.ts` — `UpdateStatus` + `available`, `installing` ; `UpdateState.progress`,
  `managed`, `servedVersion` ; `UpdateInstallPlan` ; sens de `autoCheckUpdates` (téléchargement auto).
- `packages/api-client` — `update.download()`, `update.prepareInstall()`.
- `apps/desktop/src/main/ipc/channels.ts`, `desktop-only.handlers.ts` — `update:download`,
  `update:prepare-install`.
- `apps/desktop/src/main/services/update.service.ts` — réécrit (voir ci-dessous).
- `apps/desktop/src/main/services/app-settings.service.ts` — `onChange()` (abonnés isolés en try/catch).
- `apps/desktop/src/renderer/components/layout/UpdateBadge.tsx` — rendu par état ; `updateView.ts`
  (logique pure, testée) ; `UpdateInstallConfirm.tsx` ; `UpdateInstallingOverlay.tsx` (monté dans
  `AppLayout`).
- `apps/desktop/src/renderer/web/bridge.ts` — nouveaux channels dans `UNAVAILABLE`.
- i18n FR/EN — `update.*` restructuré, libellé et infobulle de la préférence.
- Tests : `update.service.gh302.test.ts` (remplace `update.service.gh293.test.ts`, cas GH293 repris),
  `updateView.test.ts`.

## Comportement implémenté

- Vérification au démarrage puis toutes les 4 h, quelle que soit la préférence ou le verrou.
- `autoDownload` d'electron-updater toujours `false` : le service télécharge lui-même si la
  préférence est cochée et sans verrou ; cochée pendant `available` → téléchargement immédiat.
- États : `available` dès `update-available` ; `downloading` avec `progress` entier (une diffusion par
  pourcentage) ; `ready` ; `error` **seulement** pour un téléchargement interrompu (une vérification
  en échec est silencieuse et ne masque pas une version connue) ; `update-not-available` remet au
  repos (release retirée) sauf pendant/après un téléchargement.
- `download()` (bouton « Télécharger » / « Réessayer ») : revérifie, ne télécharge que si la release
  existe toujours ; verrou arrivé après coup → l'état passe en `managed`, rien n'est téléchargé.
- Installation : confirmation dans l'app (onglets non enregistrés de la fenêtre, autres fenêtres
  visibles avec avertissement sur leurs modifications, serveurs MCP) → état `installing` (écran dans
  toutes les fenêtres) → 1,2 s → arrêt des serveurs MCP → `quitAndInstall(false, true)` : installeur
  NSIS visible, relance. Installeur non lancé (`error` pendant `installing`) → retour à `ready`.

## Divergences par rapport au design

- `error` restreint au téléchargement interrompu (revue de code : une vérification périodique hors
  ligne affichait « téléchargement échoué » à tort, y compris en mode verrouillé).
- `update-not-available` efface la version connue hors téléchargement (release retirée).
- Les autres fenêtres comptées sont les fenêtres **visibles** (fenêtres cachées de rendu PDF et
  draw.io exclues).

## Vérifications

- `pnpm typecheck` : OK. `pnpm lint` : aucun package ne définit de script lint (no-op).
- Unitaires ciblés : 25/25. `pnpm test` complet : 1554/1556 ; les 2 échecs
  (`repo-settings.gh108.test.ts`, délai de 48 s sous charge) passent seuls (19/19), sans rapport.
- Revue de code (`/code-review`) : 9 constats, tous corrigés sauf « code web inactif » (branché en S2).

## Comment tester manuellement

`POLENTA_FORCE_DEV_UPDATE=1 pnpm dev` (lit `dev-app-update.yml`) : bouton disponible → téléchargement
→ prête. Installation de bout en bout : seulement avec deux versions empaquetées publiées (M1).
