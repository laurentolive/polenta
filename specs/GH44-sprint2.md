# GH44 — Sprint 2 : serveur web, bridge navigateur, mode dev

Périmètre : `specs/GH44-design.md` §4 (révisions : §4.7). Pas de dépendance à #45 : authentification
en mode **dev** (un utilisateur fixe, jeton en variable d'environnement).

## Fichiers modifiés

**Serveur** (`apps/desktop/src/web-server/`, nouveau) :
- `index.ts` : point d'entrée (config, durcissement, écoute).
- `config.ts` : variables `POLENTA_WEB_*`, mode dev refusé avec `NODE_ENV=production`.
- `app.ts` : Fastify — `/auth/login|logout|me`, `POST /rpc/:channel`, WebSocket `/events`,
  `POST /upload`, `GET /download/:id`, `/healthz`, build web statique + fallback SPA.
- `session.ts` : sessions en mémoire, cookie signé `HttpOnly`, CSRF double-submit.
- `user-pool.ts` : un conteneur de services par utilisateur, éviction après inactivité, purge des
  fichiers temporaires, jetons en mémoire.
- `web-host.ts` : `MemoryTokenStore`, `HostContext`/`PlatformHost` web, `pendingPrintRenderer`.
- `web-handlers.ts` : `app:get-version`, `web:workspaces-root|list-workspaces|new-workspace-dir|
  delete-workspace|image-import|drawio-import|execution-sheet-preview|execution-sheet-export|export`.
- `channel-policy.ts` : `WEB_EXPOSED` (177), `WEB_HIDDEN` (4), `WEB_ONLY_CHANNELS`, `ROOT_ARGS`,
  `CONTENT_ARGS`.
- `path-guard.ts` : validation des arguments (racine utilisateur, liens résolus, `..`, DTO).
- `file-store.ts` : uploads / téléchargements (`<uuid>/<nom>`, durée de vie).
- `hardening.ts` : dossier courant vide, liens symboliques neutralisés, hôtes git autorisés.
- Tests : `path-guard.test.ts`, `channel-policy.test.ts`, `app.test.ts`, `hardening.test.ts`.

**Renderer** :
- `web.html`, `web/main.tsx`, `web/bridge.ts` : entrée web et `window.polenta` HTTP/WebSocket avec
  adaptateurs (sélecteur de fichiers + upload, téléchargement, titre, état de mise à jour).
- `platform.ts` (`isWeb`, `capabilities`), `lib/webSession.ts`, `lib/webEvents.ts`.
- `components/home/WebProjectList.tsx` ; `routes/index.tsx` (« Mes projets », dossiers serveur).
- Adaptations : `routes/login.tsx`, `routes/account.tsx`, `AccountMenu.tsx`, `AccountPanel.tsx`,
  `ExportButton.tsx`, `ExecutionSheetMenu.tsx`, `EditView.tsx`, `DrawioEmbedView.tsx`,
  `useTabShortcuts.ts` (Alt+T / Alt+W sur le web), `useLiveFileSync.ts` (reconnexion), i18n FR/EN.

**Noyau partagé** :
- `main/ipc/channels.ts` (liste desktop-only) ; `desktop-only.handlers.ts` typé dessus.
- `main/services/git-http.ts` : `setGitRemoteGuard` (aucun garde sur le desktop).
- `main/services/workspace-tree.service.ts` : `isSafeMountName` (noms de montage = un segment).
- `packages/api-client` : namespace `web`.

**Build / dépôt** :
- `apps/desktop/package.json` : `dev:web`, `build:web`, `build:web-server`, `start:web`, `test` ;
  dépendances Fastify, `vitest`, `concurrently`, `@types/node@^20`.
- `vite.web.config.ts`, `vitest.config.ts`.
- **Supprimés** : `apps/web`, `apps/api` (squelettes du commit initial) ; `.gitignore` mis à jour.

## Comportement implémenté

`pnpm dev:web` (ou `build:web` puis `start:web`) sert Polenta dans un navigateur : même interface,
mêmes vues, mêmes services que le desktop. Chaque utilisateur a son espace
`<data>/users/<login>/{workspaces,userData}`. L'accueil web liste « Mes projets » et crée la démo,
un clone ou un nouveau projet dans un dossier serveur neuf. Images / diagrammes / classeurs passent
par l'upload, les exports par un téléchargement. Les fonctions propres au poste (ouvrir un dossier,
draw.io local, mise à jour, gestion de jetons) sont masquées.

Sécurité : liste blanche des channels (404 sinon), garde de chemins (403), session + CSRF (401/403),
Origin du WebSocket, aucun jeton renvoyé au navigateur, erreurs sans pile, liens symboliques et
hôtes git maîtrisés côté serveur.

## Divergences par rapport au design

Détaillées dans `GH44-design.md` §4.7 : liste blanche explicite + `ROOT_ARGS`/`CONTENT_ARGS` au lieu
d'une `Policy` par channel ; durcissement du process (non prévu, issu de la revue) ; accueil web
anticipé du sprint 3 (liste, création, suppression) ; shim Electron non étendu (échec au bundle) ;
ports 8787 / 5180 ; export PDF indisponible jusqu'au sprint 4.

## Mises à jour SPEC

Aucune (sprint non final).

## Vérifications

- `pnpm typecheck` (monorepo) : 0 erreur. `pnpm test` : merge-core 34/34, serveur web 39/39.
- Builds : desktop (electron-vite), MCP, web (Vite + bundle serveur) OK. Les 198 channels desktop
  inchangés (sprint 1) ; aucun channel desktop-only enregistré côté serveur (test).
- Bout en bout sur le serveur bundlé et durci : login dev, clone de la démo (≈ 3,5 s), ouverture,
  53 exigences / 16 tests lus, statut git, « Mes projets », dernier projet ouvert ; clone vers un
  hôte non autorisé refusé ; dossier courant du serveur resté vide.
- Rendu réel (Electron utilisé comme navigateur sans preload sur le client web) : dashboards avec
  données, accueil « Mes projets », panneau Compte (identité de session, sans « Changer de
  compte »), aucune erreur console. Ce test a révélé un hook placé après un `return` dans
  l'accueil — corrigé.
- **Tests de bout en bout automatisés** (Playwright, Chromium, serveur buildé, forge git locale) :
  11/11 — S2-1 accueil, S2-2 clone par l'UI, S2-3 parité (données + 10 vues), S2-4 image et
  draw.io par upload (et annulation), S2-5 export Word téléchargé, S2-6 classeur d'exécution aller-
  retour, S2-7 deux onglets, S2-8 coupure et reconnexion, S2-9 Publier (auteur du commit distant =
  identité de l'utilisateur), S2-25 Origin WebSocket, S2-20 aucune erreur console (après chaque
  test) ; parité : P-1 recherche/remplacement, P-2 dashboard + widget, P-3 baseline, P-4 conflit
  résolu dans le navigateur (GH37) — **14/14, stable sur 3 exécutions**. Outillage réutilisable et
  documenté pour les tickets suivants : `apps/desktop/e2e-web/README.md` (`setupSession`, forge
  locale, autre utilisateur, uploads/téléchargements, événements) ; WORKFLOW.md (Agent Dev, étape 6)
  y renvoie.
- `/code-review` : 10 constats (dont 6 de sécurité : racines relatives, liens symboliques, noms de
  montage, jetons au logout, Origin WebSocket, SSRF), tous traités et couverts par des tests.

## Limites connues

- Export PDF et instantanés draw.io : sprint 4.
- Authentification : mode dev uniquement (OIDC Forgejo au sprint 3, dépend de #45 P0).
- Dossier courant partagé entre utilisateurs (vide) : voir risques du design.
- `GET /auth/logout` sans CSRF : passage en POST au sprint 3.

## Comment relancer les tests automatisés

```bash
cd apps/desktop
pnpm test            # vitest : garde de chemins, politique de channels, serveur, durcissement
pnpm test:e2e:web    # build web + Playwright (première fois : npx playwright install chromium)
```

## Comment tester manuellement

```bash
cd apps/desktop
# Jeton facultatif (clone public de la démo sans jeton) ; requis pour publier.
POLENTA_WEB_DEV_LOGIN=moi POLENTA_WEB_DEV_REMOTE=https://github.com POLENTA_WEB_DEV_TOKEN=<PAT> pnpm dev:web
# → http://localhost:5180
```

Scénarios S2-1 à S2-20 de `specs/GH44-tests.md` (les cas automatisés sont couverts par `pnpm test`),
en particulier : démo, clone, édition + Publier, image / drawio par upload, exports Word/Excel
téléchargés, classeur d'exécution, deux onglets, coupure réseau (devtools offline), console sans
erreur.
