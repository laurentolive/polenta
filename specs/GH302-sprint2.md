# GH302 — Sprint 2 (web) — sprint final

## Fichiers modifiés

- `apps/desktop/src/web-server/release-check.ts` (nouveau) — `ReleaseCheck` : dernière release de la
  marque (GitHub `releases/latest`, ou `latest.yml` d'une source `generic`), démarrage puis 4 h,
  résultat en mémoire, échec journalisé ; `isNewer` (pré-version < release), `versionFromLatestYml`.
- `web-server/config.ts` — `updateCheck` (`POLENTA_WEB_UPDATE_CHECK`, défaut actif ; absent dans les
  configurations de test).
- `web-server/app.ts`, `user-pool.ts`, `web-handlers.ts`, `channel-policy.ts` — channel web-only
  `web:update-state`.
- `vite.web.config.ts` — `__POLENTA_WEB_VERSION__` (même calcul que le serveur, build seulement).
- `renderer/web/bridge.ts` — adaptateur `update:get-state` (version de l'onglet vs version servie →
  `servedVersion`) ; sondage 5 min (onglet visible seulement, au retour de visibilité, à chaque
  reconnexion du canal d'événements) sans redirection vers la connexion sur 401 ; émission seulement
  si l'état change ; `addListener` partagé avec `window.polenta.on`.
- `UpdateBadge.tsx`, `UpdateInstallingOverlay.tsx` — jetons de couleur (voir ci-dessous).
- `e2e-web/support/env.ts` — `POLENTA_WEB_UPDATE_CHECK=false` (pas de requête vers GitHub en e2e).
- Tests : `release-check.gh302.test.ts`, `app.test.ts`, `channel-policy.test.ts`,
  `e2e-web/gh302-update.spec.ts` (E1, E2, E2b).

## Comportement implémenté

- W1 : un onglet dont le serveur a été redéployé affiche « Recharger la page » (tout utilisateur).
- W2 : l'administrateur de l'instance voit « Nouvelle version disponible », les notes de version et
  `polenta-host instance web enable <instance> --version <v>` ; les autres utilisateurs ne voient rien.

## Divergences par rapport au design

- Version de l'onglet figée au build (`__POLENTA_WEB_VERSION__`) plutôt que lue au premier appel
  (revue : un redéploiement avant la première réponse serait passé inaperçu). En `dev:web`, repli sur
  la première réponse.
- Sondage suspendu onglet caché ; pas de redirection vers la connexion depuis le sondage de fond.
- **Correctif hors design** : le lien « Voir les nouveautés » utilisait `text-status-info-fg`, qui est
  **blanc** (texte sur fond plein) — invisible sur le popover, déjà le cas depuis GH26. Remplacé par
  `text-status-info` ; même correction pour l'avertissement (`text-status-warning-fg` → `text-status-warning`).
  L'e2e E2 vérifie que la couleur du lien diffère du fond du popover.

## Constats de revue écartés

- Filtrage administrateur côté serveur de `web:update-state` : la version de l'instance est déjà
  exposée à tout utilisateur (`/healthz`, `app:get-version`) et la release est publique.
- Source `generic` : `latest.yml` ne garantit pas l'existence de l'image web — relève de #305.
- Durée du rôle administrateur en e2e : `durationMs` du faux service est la durée d'un travail, pas
  du rôle.

## Mises à jour SPEC

- `SPEC-TECH-stack.md` §9 — ligne « Mises à jour (GH26, GH302) » réécrite (vérification toujours,
  4 h, préférence = téléchargement, verrou = information, états, installation visible, web).
- `SPEC-ACCOUNTS-AUTH.md` §6 (`autoUpdate: false`) et §7 (`updates: managed`) — verrou = information,
  plus « aucune requête vers github.com » (décision D2, modifie GH45 §7).
- `SPEC-ELECTRON-DESKTOP.md` §19.2 — badge de mise à jour, confirmation, écran d'installation.
- `SPEC-WEB.md` — tableau desktop / web, ligne « Mise à jour automatique ».
- `SPEC-INDEX.md` — colonne MAJ → GH302 pour ces quatre entrées.

## Vérifications

- `pnpm typecheck` : OK. `pnpm test` complet : 1563/1563 (desktop), 118 (+3 ignorés) admin-service,
  79 merge-core.
- e2e `e2e-web/gh302-update.spec.ts` : 3/3 (après `pnpm build:web`).
- Revue de code : 10 constats, 7 corrigés, 3 écartés (ci-dessus).

## Comment tester manuellement

- Web : `pnpm dev:web` puis redémarrer le serveur avec une autre version de `package.json` → le bouton
  « Recharger » apparaît (en dev, repli sur la première réponse).
- Desktop : voir `GH302-sprint1.md` (installation de bout en bout : deux versions publiées).
