# GH44 — Design technique : client web

Entrée : `specs/GH44.md` (validée le 2026-10-08). Dépendance : #45 (P0 + infra) — **livrée le
2026-10-10** ; les sprints 3 et 4 sont révisés en §10 à partir de ce qui existe réellement.

## 1. Vue d'ensemble

```
Navigateur                                   Serveur polenta-web (Node, 1 process)
┌──────────────────────────────┐            ┌─────────────────────────────────────────────┐
│ Renderer desktop (inchangé)  │            │ Fastify                                      │
│  └ ApiClient (createIpcClient)│            │  ├ /auth/*   OIDC forge (S3) / dev (S2)      │
│      └ window.polenta  ◄──────┼── bridge ──┼─►├ POST /rpc/:channel   ── ChannelPolicy ──┐ │
│         (web/bridge.ts)       │   HTTP+WS  │  ├ GET  /events (WebSocket)               │ │
│  └ adaptateurs dialogues      │            │  ├ POST /upload · GET /download/:id       │ │
│    (input file / download)    │            │  └ static: build web du renderer          │ │
└──────────────────────────────┘            │                                            ▼ │
                                             │ UserContainerPool : login → Container     │
                                             │   (mêmes services que le desktop,          │
                                             │    HostContext + PlatformHost « web »)     │
                                             │ <data>/users/<login>/{workspaces,userData} │
                                             └─────────────────────────────────────────────┘
```

Trois idées structurantes :

1. **Le renderer ne change pas de transport** : il continue d'appeler `window.polenta.invoke/on`.
   Le build web installe, avant `main.tsx`, un `window.polenta` implémenté en HTTP/WebSocket
   (`renderer/web/bridge.ts`). `@polenta/api-client` et les ~196 appels restent intacts.
2. **Les handlers ne dépendent plus d'`ipcMain`** : `registerIpcHandlers(c)` devient
   `registerHandlers(registry, c, host)`. Le desktop passe un registre qui délègue à
   `ipcMain.handle`, le serveur un registre en mémoire (`Map<channel, fn>`) par utilisateur. Le code
   des handlers n'est pas réécrit.
3. **Tout ce qui touche au poste local passe par des interfaces injectées** (`HostContext`,
   `PlatformHost`, `PrintRenderer`) avec une implémentation Electron (desktop, comportement actuel)
   et une implémentation web (serveur).

## 2. Décisions et alternatives rejetées

| # | Décision | Alternatives rejetées |
|---|---|---|
| D1 | Réutiliser le renderer desktop tel quel, avec un second point d'entrée web (`web.html` → `web/main.tsx`). | Déplacer le renderer dans un package partagé : churn énorme sur tous les fichiers, conflits avec les branches en cours, aucun gain fonctionnel. Reprendre `apps/web` : squelette antérieur à T130, ne partage rien. |
| D2 | RPC générique : `POST /rpc/:channel` (corps = tableau JSON des arguments), WebSocket `/events` pour `on()`. | Une route REST par channel : 196 routes à maintenir en double. tRPC/GraphQL : refonte de l'`ApiClient`. |
| D3 | Serveur dans `apps/desktop/src/web-server/`, bundlé par esbuild comme le serveur MCP (`--alias:electron=…shim`). | Extraire un `packages/core` avec tous les services : souhaitable à terme, mais déplacement massif hors périmètre ; le précédent MCP montre que le bundle depuis `apps/desktop` fonctionne. Nouveau `apps/server` important `../desktop/src/main` : mêmes inconvénients sans le bénéfice. |
| D4 | Fastify (+ `@fastify/websocket`, `@fastify/cookie`, `@fastify/multipart`, `@fastify/static`) et `openid-client` pour OIDC. | NestJS (`apps/api`) : décorateurs et modules inutiles pour un endpoint générique. Express : pas de gain. |
| D5 | Un `Container` (services complets) **par utilisateur**, créé à la demande, évincé après inactivité. | Services partagés multi-utilisateurs : il faudrait passer l'utilisateur à chaque méthode (auth, userData, index) ; refonte profonde et risque de fuite entre utilisateurs. Un process par utilisateur : isolation maximale, mais coût mémoire et orchestration hors proportion pour ≤ 50 utilisateurs. |
| D6 | Liste blanche des channels (`ChannelPolicy`) : tout channel absent est refusé (404). | Liste noire : un nouveau channel desktop deviendrait exposé par défaut. |
| D7 | Les dialogues natifs sont remplacés **côté navigateur** par des adaptateurs du bridge (sélecteur de fichiers, upload, download), qui appellent des channels serveur `web:*` dédiés. | Faire « attendre » le serveur sur un dialogue distant : aller-retour bloquant, incompatible HTTP. |
| D8 | PDF / instantanés drawio : Chromium headless (Playwright) charge les mêmes routes `/print/*` du serveur web. | Reconstruire le PDF côté serveur (pdfkit…) : perte de la parité de rendu voulue par T43. |
| D9 | Supprimer `apps/web` et `apps/api` (squelettes morts, Auth0). | Les garder « pour la version web » (SPEC-ELECTRON-DESKTOP §2) : trompeur, ils ne seront jamais la version web. |
| D10 | Sessions en mémoire (cookie signé `HttpOnly` → id de session), jetons forge jamais persistés. Redémarrage du serveur = reconnexion (silencieuse si la session forge est encore active). | Store Redis/fichier : utile au-delà d'une instance, hors besoin on-premise. |

## 3. Sprint 1 — Découplage du desktop (sans dépendance à #45, aucun changement de comportement)

### 3.1 `HostContext` — fin des `app.getPath('userData')`

Nouveau `apps/desktop/src/main/host/host-context.ts` :

```ts
export interface TokenStore {            // remplace les appels directs à keytar
  get(account: string): Promise<string | null>
  set(account: string, token: string): Promise<void>
  delete(account: string): Promise<boolean>
}
export interface HostContext {
  userDataDir: string                     // desktop : app.getPath('userData')
  tokenStore: TokenStore                  // desktop : KeytarTokenStore
  openExternal?: (url: string) => Promise<void>        // Device Flow ; absent hors desktop
  mcpServerLaunch?: () => McpServerLaunchConfig        // .mcp.json ; absent hors desktop
}
```

*(S1 — révisé)* `AGENTS.md` reste écrit sur le web (contenu du repo, utile à tous) ; seul
`.mcp.json`, qui désigne le binaire MCP **du poste**, est conditionné — par la présence de
`mcpServerLaunch` plutôt qu'un booléen, ce qui sort aussi `mcp-launch` (qui lit `app.isPackaged`)
du noyau : déplacé en `host/mcp-launch.ts`.

- `host/electron-host.ts` : `createElectronHostContext()` (keytar + `app.getPath`).
- Services modifiés pour recevoir `HostContext` (ou seulement `userDataDir`) au constructeur au lieu
  d'importer `electron`/`keytar` : `auth.service.ts`, `app-settings.service.ts`,
  `workspace.service.ts` (`.mcp.json` conditionné par `mcpServerLaunch`),
  `merge-resolution.service.ts`.
- **Coordination #45** : #45 P0 introduit `GitProvider` et un stockage de jeton injecté. Si #45 est
  mergé avant, réutiliser son interface au lieu de `TokenStore` ; sinon #45 se rebase sur celle-ci.
  Un seul concept, nommé une fois.

### 3.2 `PlatformHost` — dialogues, shell, fenêtres

`host/platform-host.ts` :

```ts
export interface PlatformHost {
  kind: 'desktop' | 'web'
  broadcast(channel: string, ...args: unknown[]): void   // remplace BrowserWindow.getAllWindows().send
}
```

Les handlers à dialogue (`dialog:*`, `image:pick-file`, `export:save`,
`campaigns:execution-sheet-export|preview`) sont scindés : **le corps métier est extrait** dans
`ipc/file-ops.ts` en fonctions pures prenant un chemin source/destination :

| Fonction extraite | Utilisée par (desktop) | Utilisée par (web, S2) |
|---|---|---|
| `importImageIntoRepo(repoPath, srcPath)` | `image:pick-file` | `web:image-import` |
| `importDrawioIntoRepo(repoPath, srcPath)` | `dialog:pick-drawio-file` | `web:drawio-import` |
| `saveExport(c, destPath, …)` | `export:save` | `web:export` |
| `saveExecutionSheet(c, destPath, …)` | `campaigns:execution-sheet-export` | `web:execution-sheet-export` |

*(S1 — révisé)* `importImageIntoRepo`/`importDrawioIntoRepo` sont une seule fonction
`importFileIntoRepo(repoPath, srcPath, 'images' | 'diagrams', displayName?)`. Pas d'extraction pour
`dialog:pick-image-file` (lecture base64 faite par le navigateur en web) ni pour l'aperçu du
classeur (simple appel `c.campaignExecution.preview(repoPath, id, srcPath)`).

Les handlers desktop gardent le dialogue Electron puis appellent la fonction : comportement identique.

### 3.3 Registre de handlers

```ts
export interface HandlerRegistry {
  handle(channel: string, fn: (event: unknown, ...args: any[]) => unknown): void
}
```

- `ipc/index.ts` : `registerIpcHandlers(c)` → `registerHandlers(r: HandlerRegistry, c, host: PlatformHost)`,
  remplacement mécanique `ipcMain.handle(` → `r.handle(` ; idem `pref.handlers.ts`.
- Les handlers **purement locaux** restent enregistrés dans un fichier séparé
  `ipc/desktop-only.handlers.ts` (dialogues natifs, `shell.*`, `app:open-release-page`, `update:*`,
  `auth:device-flow-*`, `export:show-in-folder|open-file`, `drawio:open-external`) : ils ne sont
  **jamais** enregistrés côté serveur, ce qui garantit l'AC 6 indépendamment de la liste blanche.
- `container.ts` : `createContainer(host: HostContext, platform: PlatformHost, print: PrintRenderer)`
  renvoie le `Container` ; l'enregistrement est fait par l'appelant (`main/index.ts` desktop, pool
  serveur en S2). `UpdateService` reste créé côté desktop uniquement.
- Le serveur MCP (`mcp-server/container.ts`) est aligné sur `createElectronHostContext` / un
  `HostContext` headless — sans changement fonctionnel.

### 3.4 `PrintRenderer`

```ts
export interface PrintRenderer {
  renderPdf(printPath: string, params: Record<string, string>, destPath: string): Promise<void>
  snapshotDrawios: DrawioSnapshotter
}
```

`pdf.util.ts` et `drawio-snapshot.ts` deviennent l'implémentation `ElectronPrintRenderer`
(`host/electron-print.ts`) ; `ExportService` / `TemplateExportService` reçoivent le `PrintRenderer`
au lieu d'importer `BrowserWindow`. La table `PRINT_ROUTE_BY_KIND` reste partagée.

**Fin de S1** : `grep "from 'electron'" src/main/services` ne renvoie plus que `net-proxy.ts`
(best-effort, déjà toléré par le shim) et `update.service.ts` (desktop only).
`createContainer` devient synchrone et ne contient plus `UpdateService` (créé par `main/index.ts`
avec les channels desktop-only).

## 4. Sprint 2 — Serveur web + bridge (mode dev mono-utilisateur, sans dépendance à #45)

### 4.1 Arborescence

```
apps/desktop/
  src/web-server/
    index.ts               ← bootstrap Fastify, config (env), static, routes
    config.ts              ← POLENTA_WEB_* (cf. §6.3), validé par zod
    auth/dev-auth.ts       ← S2 : mode dev — un utilisateur fixe, jeton PAT en variable d'env
    session.ts             ← SessionStore en mémoire (id → { login, identity, tokens, lastSeen })
    user-pool.ts           ← UserContainerPool (création, cache, éviction §5.3)
    web-host.ts            ← HostContext/PlatformHost web (SessionTokenStore, broadcast WS)
    channel-policy.ts      ← liste blanche + règles de chemins (§4.3)
    path-guard.ts          ← validation des arguments (§4.3)
    rpc.ts                 ← POST /rpc/:channel
    events.ts              ← WebSocket /events
    files.ts               ← POST /upload, GET /download/:id, channels web:*
    *.test.ts              ← vitest (path-guard, channel-policy, rpc)
  src/renderer/
    web.html               ← entrée web (charge web/main.tsx)
    web/bridge.ts          ← window.polenta HTTP/WS + adaptateurs §4.4
    web/main.tsx           ← import './bridge' puis '../main'
    platform.ts            ← platform + capabilities (§4.5)
  vite.web.config.ts       ← build du renderer web → out/web/ (mêmes alias/plugins)
```

Scripts : `dev:web` (vite web + tsx web-server en watch), `build:web`
(`vite build -c vite.web.config.ts && esbuild src/web-server/index.ts --bundle --platform=node
--alias:electron=./src/mcp-server/electron-shim.ts --external:keytar … → out/web-server/index.cjs`).
Le shim est étendu (`dialog`, `BrowserWindow`, `ipcMain`) en proxys « indisponible » : tout appel
résiduel échoue explicitement.

### 4.2 RPC et événements

- `POST /rpc/:channel` — session requise, en-tête CSRF `X-Polenta-CSRF` (double-submit cookie), corps
  `{ args: unknown[] }`. Réponse `200 { ok: true, value }` ou `200 { ok: false, error: { message } }`
  pour une erreur métier (rejet de promesse côté service : même message que l'IPC, qui ne transmet
  que `message`), `401` session absente/expirée, `403` chemin refusé, `404` channel non exposé.
  Le bridge rejette la promesse avec `new Error(message)` : comportement identique à
  `ipcRenderer.invoke` pour les composants.
- Sérialisation : JSON. Vérifier en S2 qu'aucun channel ne renvoie de `Buffer`/`Date`/`Map` (l'IPC
  utilise le structured clone) ; les cas trouvés sont convertis par le bridge ou corrigés à la
  source.
- `GET /events` (WebSocket, session via cookie) : le `PlatformHost.broadcast` de l'utilisateur
  diffuse `{ channel, args }` à toutes ses sockets ; `bridge.on/off` s'y abonnent. Reconnexion auto
  avec backoff ; à la reconnexion, le bridge émet un `repo:file-changed` synthétique `'*'` pour
  invalider les caches (même effet qu'un changement de ref).

### 4.3 `ChannelPolicy` et `PathGuard`

`channel-policy.ts` : un objet `Record<channel, Policy>` couvrant **tous** les channels exposés ;
un test vitest vérifie que chaque channel enregistré par `registerHandlers` est soit dans la
politique, soit dans une liste explicite `DESKTOP_ONLY` (aucun oubli possible en ajoutant un
channel).

```ts
type Policy = { absPathArgs?: number[]; relPathArgs?: number[]; dtoPathKeys?: true }
```

Règles appliquées par `path-guard.ts` avant l'appel du handler :

1. Tout argument **top-level de type string** : si absolu → doit être sous la racine de
   l'utilisateur après `path.resolve` + `fs.realpath` du plus long préfixe existant (pas
   d'échappement par lien symbolique) ; sinon, interdit s'il contient un segment `..`, un `\0` ou
   un `:` de lecteur. Couvre `repoPath`, `workspaceDir`, IDs, tags, branches, chemins relatifs.
2. Arguments objet (DTO) : les clés `repoPath`, `workspaceDir`, `dir`, `filePath`, `path`,
   `relativePath`, `relPath` rencontrées récursivement suivent la règle 1. Les champs de contenu
   (richtext, énoncés…) ne sont pas inspectés.
3. Violation → `403`, journalisée (login, channel, index d'argument — jamais la valeur complète).

Racine utilisateur : `<data>/users/<login>/` ; `login` = identifiant forge normalisé
(`[a-z0-9._-]`, sinon refus de connexion).

### 4.4 Bridge web et adaptateurs

`window.polenta = { platform: 'web', invoke, on, off }`. `invoke` intercepte quelques channels
avant le réseau :

| Channel appelé par le renderer | Adaptateur web |
|---|---|
| `dialog:pick-image-file` | `<input type=file accept=…>` + FileReader → `{ mimeType, base64 }` (aucun appel serveur). |
| `image:pick-file(repoPath)` | sélecteur → `POST /upload` → `web:image-import(repoPath, uploadId)` → même résultat `{status, path, copied}`. Le cas « fichier déjà dans le repo » n'existe plus (`copied: true` toujours). |
| `dialog:pick-drawio-file(repoPath)` | idem → `web:drawio-import`. |
| `campaigns:execution-sheet-preview(repoPath, id)` | sélecteur `.xlsx` → upload → `web:execution-sheet-preview(repoPath, id, uploadId)` ; le `filePath` renvoyé (dans `userData/uploads/`) est repassé tel quel à `campaigns:execution-sheet-apply` (autorisé par la règle 1). |
| `export:save(…)` | `web:export(…)` → `{ downloadId, fileName }` → déclenche le téléchargement (`<a download>` vers `GET /download/:id`) → renvoie `{ status: 'ok', filePath: fileName }`. |
| `campaigns:execution-sheet-export(…)` | idem via `web:execution-sheet-export`. |
| `app:set-title(t)` | `document.title = t` (local). |
| `export:print-ready`, `export:drawio-snapshot-ready` | appel de la fonction exposée par Playwright (`window.__polentaPrint*`), cf. §5.4. |
| `dialog:pick-folder`, `drawio:open-external`, `export:show-in-folder`, `export:open-file`, `app:open-release-page`, `update:*`, `auth:device-flow-*` | ne devraient pas être appelés (UI masquée §4.5) ; si appelés : rejet `Error('Non disponible dans la version web')` et `console.warn` en dev. |

Uploads : `POST /upload` (multipart, taille max `POLENTA_WEB_MAX_UPLOAD_MB`, extensions de la liste du
desktop) → fichier dans `userData/uploads/<uuid>/<nom>` ; purge > 24 h. Downloads :
`userData/downloads/<uuid>/<nom>`, `GET /download/:id` réservé au même utilisateur, supprimé après
envoi ou au plus tard après 1 h.

### 4.5 Capacités côté renderer

`renderer/platform.ts` :

```ts
export const platform: 'desktop' | 'web' = (window.polenta as { platform?: 'web' }).platform ?? 'desktop'
export const capabilities = {
  localFilesystem: platform === 'desktop', // choisir un dossier, afficher dans le dossier, ouvrir le fichier
  externalDrawioEditor: platform === 'desktop',
  autoUpdate: platform === 'desktop',
  accountManagement: platform === 'desktop', // PAT, device flow, multi-comptes
}
```

Composants adaptés (masquage, pas de réécriture) :

| Fichier | Adaptation |
|---|---|
| `routes/index.tsx` | Web : composant `WebHome` (S3) — « Mes projets », « Depuis un repo », « Créer », « Démo » sans `pickFolder` (destinations calculées sous `workspaces/` via `web:workspaces-root`). S2 : version minimale (liste + clone par URL). |
| `routes/login.tsx` | Web : redirection vers `/auth/login`. |
| `routes/account.tsx`, `components/sidebar/AccountPanel.tsx`, `components/AccountMenu.tsx` | Web : identité de session + « Se déconnecter » (`/auth/logout`) ; gestion des jetons masquée ; `exportTemplatesPick` (dossier local) masqué. |
| `components/export/ExportButton.tsx` | Masque « Ouvrir » / « Afficher dans le dossier » ; message « Téléchargé ». |
| `components/system/EditView.tsx`, `tiptap/DrawioEmbedView.tsx` | Masque « Ouvrir dans draw.io » (cf. #46). |
| `components/layout/UpdateBadge.tsx` | Rien en web ; « À propos » affiche la version serveur (`app:get-version`). |
| `routes/preferences.tsx` | Masque la préférence d'auto-update. |
| `hooks/useTabShortcuts.ts` | Web : Ctrl+T/Ctrl+W sont capturés par le navigateur → raccourcis `Alt+T` / `Alt+W` en plus (documentés dans l'aide). |

### 4.6 Mode dev (S2)

`POLENTA_WEB_AUTH=dev` + `POLENTA_WEB_DEV_LOGIN`, `POLENTA_WEB_DEV_TOKEN`, `POLENTA_WEB_DEV_REMOTE` :
un seul utilisateur, sans OIDC, pour développer et tester S2 sans #45. Refusé au démarrage si
`NODE_ENV=production`.

### 4.7 Révisions issues de l'implémentation (S2)

- **Liste blanche explicite** : `WEB_EXPOSED` (177 channels du noyau), `WEB_HIDDEN` (4 channels de
  jetons), `WEB_ONLY_CHANNELS` (10 channels `web:*` + `app:get-version`). Les channels desktop-only
  sont listés dans `main/ipc/channels.ts` et `registerDesktopOnlyHandlers` est typé dessus. Pas de
  champ `Policy` par channel : la garde de chemins applique des règles génériques, complétées par
  `ROOT_ARGS` (positions des arguments racine, dérivées des signatures — test de synchronisation) et
  `CONTENT_ARGS` (texte libre : message de commit, contenu de fichier, commentaire).
- **Arguments racine** (`repoPath`, `workspaceDir`, `containerDir`…) : absolus obligatoires — un
  relatif serait résolu depuis le dossier courant du serveur (constat de revue).
- **Durcissement du process serveur** (`web-server/hardening.ts`, jamais sur le desktop) :
  dossier courant vide (`<data>/.cwd`) ; liens symboliques recréés en fichiers texte comme git avec
  `core.symlinks=false` (un repo cloné ne peut pas pointer vers `/etc/passwd` ni vers l'espace d'un
  autre) ; clone/fetch/push limités aux hôtes de `POLENTA_WEB_GIT_HOSTS` en HTTPS (SSRF), via
  `setGitRemoteGuard` dans `git-http.ts`.
- **Noms de montage** (`polenta-repo.yaml`, overrides) : un seul segment (`isSafeMountName`, partagé
  desktop/web) — une dépendance nommée `../x` est ignorée avec un avertissement.
- **WebSocket** : Origin vérifiée (même hôte) — pas d'en-tête CSRF possible sur un handshake.
- **Arguments `undefined`** : JSON les transformerait en `null` (paramètres par défaut perdus) ; le
  bridge transmet leurs positions (`undefinedArgs`), le serveur les restaure.
- **Reconnexion** des événements : canal synthétique `web:events-reconnected` → `useLiveFileSync`
  invalide toutes les requêtes (desktop : jamais émis).
- **Accueil web** (anticipé de §5.4) : `WebProjectList` + `web:new-workspace-dir` (dossier neuf
  sous « Mes projets » à la place du sélecteur), suppression avec refus si non publié. Un échec
  pendant l'action supprime le dossier créé ; une erreur à l'ouverture ne le supprime jamais.
- **Compte** : identité lue sur `/auth/me` (le renderer n'appelle plus `auth:get-token` sur le web),
  déconnexion par `/auth/logout`, bouton « Changer de compte » masqué.
- **Shim Electron non étendu** : un import résiduel de `dialog`/`BrowserWindow` fait échouer le
  bundle esbuild (« No matching export »), ce qui est plus sûr qu'un proxy à l'exécution.
- **Export PDF** : `pendingPrintRenderer` (message explicite) jusqu'au sprint 4 ; un export par
  gabarit rend ses diagrammes en repli texte.
- **Ports** : serveur 8787 (`POLENTA_WEB_PORT`), client Vite de dev 5180 (`POLENTA_WEB_CLIENT_PORT`)
  — 8080/5173 souvent occupés sur les postes de dev.
- **`@types/node@^20`** déclaré dans `apps/desktop` (auparavant hérité d'`apps/api`).

## 5. Sprint 3 — Authentification forge et multi-utilisateurs (nécessite #45 P0 — livré ; voir révisions §10.2)

### 5.1 OIDC

- `GET /auth/login` → Authorization Code + PKCE vers la forge (`openid-client`, découverte
  `/.well-known/openid-configuration` de Forgejo). Scopes : `openid profile email` + scopes de
  dépôt nécessaires au clone/push (à valider sur Forgejo : jeton OAuth2 utilisable en HTTPS git).
- `GET /auth/callback` → session créée, `access_token` + `refresh_token` stockés **en mémoire**
  dans la session ; identité via `GitProvider.resolveIdentity` (#45). Cookie `polenta_sid`
  (`HttpOnly; Secure; SameSite=Lax`, signé) + cookie CSRF lisible.
- `GET /auth/logout` → session détruite, sockets fermées (le Container reste jusqu'à l'éviction).
- `GET /auth/me` → `{ login, name, email }` pour le bridge.
- `SessionTokenStore` (implémente `TokenStore`) : renvoie le jeton de la session courante pour
  l'hôte de la forge ; rafraîchit avec le `refresh_token` avant expiration.

### 5.2 Révocation

- Refresh en échec, ou 401 de la forge pendant fetch/push/clone (détecté dans `SessionTokenStore` /
  `git-http.ts` via #45 P0-5) → session invalidée, toutes les sockets reçoivent
  `auth:session-revoked`, les RPC suivants répondent `401`. Le bridge, sur `401` ou cet événement,
  affiche le message de #45 P0-5 puis redirige vers `/auth/login`.
- Vérification périodique légère (toutes les 5 min par session active : refresh ou `GET /user`)
  pour couvrir un utilisateur qui ne fait aucune opération git (AC 3 « au plus tard » ⇒ +5 min
  documenté).

### 5.3 `UserContainerPool`

- `get(login)` : crée si besoin `createContainer(webHost(login), webPlatform(login), print)` et un
  registre `Map` rempli par `registerHandlers`. Création sérialisée par login.
- `lastSeen` mis à jour à chaque RPC/événement. Éviction (`POLENTA_WEB_IDLE_MINUTES`, défaut 30) :
  aucune socket ouverte et inactif → `watcher.unwatchAll()`, abandon des références (index, caches),
  sessions de merge GH37 déjà persistées dans `userData/merge-drafts/`. Ajouter
  `Container.dispose()` regroupant ces libérations.
- Garde-fou : `POLENTA_WEB_MAX_ACTIVE_USERS` (défaut 50) ; au-delà, évince le moins récemment utilisé
  sans socket ouverte, sinon `503` explicite.

### 5.4 Écran d'accueil web

Channels `web:*` ajoutés : `web:workspaces-root` (renvoie `<root>/workspaces`),
`web:list-workspaces` (dossiers de `workspaces/` reconnus par `workspace:detect`),
`web:delete-workspace(dir)` (refus si modifications non publiées sans `force`).
`WebHome` réutilise les popups existantes (clone, création, démo) en remplaçant le choix de dossier
par un nom.

## 6. Sprint 4 — Rendu PDF, packaging, déploiement (révisions §10.3)

### 6.1 `PlaywrightPrintRenderer`

- Un navigateur Chromium headless partagé (lancé à la première impression, fermé après 10 min
  d'inutilisation), **un contexte par impression**.
- Le serveur émet un jeton d'impression à usage unique (60 s) lié au login → cookie de session
  restreint ajouté au contexte ; la session d'impression n'a accès qu'à `/rpc` (lecture) et à
  `/print/*`.
- `page.exposeFunction('__polentaPrintReady', …)` / `__polentaDrawioSnapshotReady` appelés par le
  bridge (§4.4) ; `page.pdf({ format: 'A4', printBackground: true })` ; captures drawio par
  `page.screenshot({ clip })` avec `deviceScaleFactor: 2`. Mêmes délais que le desktop.
- Concurrence : au plus 2 rendus simultanés (file d'attente).

### 6.2 Image Docker

`apps/desktop/Dockerfile.web` multi-stage : build (`pnpm install --frozen-lockfile` avec
`ELECTRON_SKIP_BINARY_DOWNLOAD=1`, `pnpm --filter @polenta/desktop build:web`) → runtime
`mcr.microsoft.com/playwright:<version>-noble` (Chromium + polices), copie de `out/web-server`,
`out/web`, dépendances externes du bundle. Utilisateur non root, volume `/data`, `HEALTHCHECK`
sur `GET /healthz`.

### 6.3 Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `POLENTA_WEB_PUBLIC_URL` | — | URL publique (redirections OIDC, cookies `Secure`). |
| `POLENTA_WEB_DEFAULT_SERVER` | 1er hôte git | URL de la forge (issuer OIDC + forge par défaut). *Révisé : variable introduite par #45, remplace `POLENTA_WEB_FORGE_URL`.* |
| `POLENTA_WEB_DEMO_PROJECT_URL` | démo GitHub | Projet de démonstration proposé (#45). |
| `POLENTA_WEB_OIDC_CLIENT_ID` / `_SECRET` | — | Application OAuth2 créée dans Forgejo (`install.sh` de #45). |
| `POLENTA_WEB_SESSION_SECRET` | — | Signature des cookies. |
| `POLENTA_WEB_DATA_DIR` | `/data` | Racine des espaces utilisateurs. |
| `POLENTA_WEB_SESSION_HOURS` | 12 | Durée max d'une session. |
| `POLENTA_WEB_IDLE_MINUTES` | 30 | Éviction mémoire. |
| `POLENTA_WEB_MAX_ACTIVE_USERS` | 50 | Garde-fou mémoire. |
| `POLENTA_WEB_MAX_UPLOAD_MB` | 20 | Taille max d'upload. |
| `POLENTA_WEB_PORT` | 8787 | Port d'écoute (S2). |
| `POLENTA_WEB_GIT_HOSTS` | hôte de la forge | Hôtes git autorisés, séparés par des virgules (S2, SSRF). |
| `POLENTA_WEB_GIT_ALLOW_HTTP` | false | Autoriser git en HTTP clair (forge interne sans TLS). |
| `POLENTA_WEB_AUTH` | `oidc` | `dev` interdit en production. |

### 6.4 Intégration au kit `deploy/` de #45

Service `polenta-web` dans le compose (profil activable), route Caddy `polenta.<domaine>` →
`polenta-web:8080`, volume `polenta-web-data` ajouté à `backup.sh`/`restore.sh`, création de
l'application OAuth2 Forgejo dans `polenta-admin.sh`, section RUNBOOK. Si `deploy/` n'existe pas
encore au moment du sprint : le ticket reste `status:blocked` (dépend de #45) sur ce seul lot.

### 6.5 Mises à jour SPEC (sprint final)

- `SPEC-ELECTRON-DESKTOP.md` §1 : la règle « pas de serveur HTTP » vaut pour l'app desktop ; ajout
  du serveur web comme troisième point d'entrée sur le même noyau (comme le MCP). §2 : arborescence
  (`host/`, `web-server/`, `renderer/web/`, suppression `apps/web`/`apps/api`).
- Nouveau `SPEC-WEB.md` : architecture, ChannelPolicy, PathGuard, bridge et adaptateurs, sessions,
  pool, impression, configuration, déploiement.
- `SPEC-ACCOUNTS-AUTH.md` : connexion web OIDC, `TokenStore`.
- `SPEC-TECH-stack.md` §2 (Fastify, openid-client, Playwright), §9 (image Docker).
- `SPEC-MCP-SERVER.md` : `HostContext` headless.
- `CONTEXT.md` : nouvelle décision D-web (complète D5).
- `SPEC-INDEX.md` : lignes correspondantes, colonne MAJ = GH44.

## 7. Fichiers impactés (résumé)

| Sprint | Créés | Modifiés | Supprimés |
|---|---|---|---|
| S1 | `main/host/{host-context,electron-host,platform-host,electron-print}.ts`, `main/ipc/{file-ops,desktop-only.handlers}.ts` | `main/index.ts`, `main/container.ts`, `main/ipc/index.ts`, `main/ipc/pref.handlers.ts`, `services/{auth,app-settings,workspace,merge-resolution,export,export/template/template-export}.service.ts`, `services/pdf.util.ts`, `services/export/template/drawio-snapshot.ts`, `mcp-server/container.ts` | — |
| S2 | `src/web-server/**`, `renderer/{web.html,web/bridge.ts,web/main.tsx,platform.ts}`, `vite.web.config.ts`, vitest config | `package.json` (scripts, deps Fastify), `mcp-server/electron-shim.ts`, composants §4.5 | `apps/web/`, `apps/api/`, entrées associées (`pnpm-workspace.yaml`, `turbo.json` si cités) |
| S3 | `web-server/auth/oidc.ts`, `web-server/session-token-store.ts`, `renderer/components/web/WebHome.tsx` | `user-pool.ts`, `session.ts`, `bridge.ts`, `routes/index.tsx`, `services/git-http.ts` (si 401 non couvert par #45) | — |
| S4 | `web-server/print/playwright-print.ts`, `Dockerfile.web`, `.dockerignore`, `deploy/` (compléments), `specs/SPEC-WEB.md` | specs listées §6.5 | — |

## 8. Découpage en sprints et dépendances

| Sprint | Contenu | Dépend de | Livrable vérifiable |
|---|---|---|---|
| **S1** | Découplage desktop (§3) | — | Desktop identique (parcours manuel T-S1 de `GH44-tests.md`), typecheck, aucun `electron` dans les services sauf exceptions listées. |
| **S2** | Serveur, bridge, build web, mode dev, adaptateurs, capacités UI, suppression squelettes (§4) | S1 | Polenta Web utilisable en local en mode dev, mono-utilisateur, tous les parcours sauf PDF. |
| **S3** | OIDC forge, sessions, révocation, pool multi-utilisateurs, accueil web (§5, §10.2) | S2, #45 P0 ✓ | Deux utilisateurs Forgejo réels, isolation, révocation. |
| **S4** | Playwright, Docker, intégration `deploy/`, campagne de parité, SPEC (§6, §10.3) | S3, #45 infra ✓ | Image déployée sur l'instance de test (`acme`) derrière Caddy. |

Ordre recommandé : S1 et S2 peuvent démarrer **tout de suite** ; S3 attend le P0 de #45 (le ticket
passera `status:blocked` — « dépend de #45 » — entre S2 et S3 si nécessaire).

## 9. Risques

| Risque | Mitigation |
|---|---|
| Valeurs non sérialisables en JSON renvoyées par certains channels (structured clone IPC). | Inventaire automatisé en S2 (test qui passe les réponses des parcours au travers de `JSON.parse(JSON.stringify())` et compare). |
| Mémoire : un Container + index par utilisateur actif. | Éviction, plafond d'utilisateurs actifs, mesure en S4 (objectif : < 300 Mo par utilisateur sur le projet de démo). |
| Jeton OAuth2 Forgejo utilisable pour git HTTPS : à confirmer. | Test en tout début de S3 ; repli : création d'un jeton d'accès via l'API Forgejo à la connexion (même mécanisme que #45 P0-4), révoqué à la déconnexion. |
| Divergence future : un nouveau channel desktop oublié dans la politique web. | Test d'exhaustivité `ChannelPolicy` ∪ `DESKTOP_ONLY` = channels enregistrés (S2). |
| Dossier courant partagé par tous les utilisateurs : un chemin relatif dans un DTO (non couvert par `ROOT_ARGS`) y serait résolu. | Dossier vide, sans `..` possible ; seules des écritures d'un utilisateur y seraient visibles d'un autre. Isolation complète (un process par utilisateur) hors périmètre (D5). |
| Logout par `GET /auth/logout` déclenchable depuis une autre page (déconnexion forcée). | Impact limité (aucune donnée exposée) ; passage en POST au sprint 3 avec OIDC. |
| Fichiers modifiés par S1 très partagés (`ipc/index.ts`, `container.ts`) → conflits avec les autres tickets. | S1 court, mécanique, mergé tôt dans main après validation. |

## 10. Révisions après la livraison de #45 et GH49 (2026-10-11)

État de départ : `main` @ `e8d804e` contient GH44 S1–S2 (les commits de GH44 ont été intégrés par le
merge de GH45, branché sur GH44 @ `f5325d6`), GH45 (sprints 1 à 4), GH49 (marque blanche), GH43,
GH47. La branche `GH44` est avancée sur `main` (fast-forward). Vérifié sur cet état : typecheck,
135 + 34 tests unitaires, 14/14 tests e2e web.

### 10.1 Ce que #45 a déjà fait côté web (rien à refaire)

| Sujet | Où |
|---|---|
| `HostContext` étendu : `machineConfig`, `deviceLabel: 'web'` | `web-server/web-host.ts`, `config.ts` (`webMachineConfig`, `POLENTA_WEB_DEFAULT_SERVER`, `POLENTA_WEB_DEMO_PROJECT_URL`) |
| Garde des hôtes commun à git **et** à l'API des forges | `main/services/forge/remote-guard.ts` (`setGitRemoteGuard` conservé en alias, `hardening.ts` inchangé) |
| Nouveaux channels classés : exposés (`auth:current-account`, `app:get-team-config`, `app:team-projects`, `forge:*`, `workspace:create-on-server`…) et masqués (`auth:login-password`, `auth:detect-forge`) ; `ROOT_ARGS` complété | `web-server/channel-policy.ts` (test de synchronisation vert) |
| Compte courant web = session | `renderer/hooks/useCurrentAccount.ts` (remplace les branches `isWeb` d'`AccountMenu`, `AccountPanel`, `routes/account.tsx`) |
| Accueil : « Projets de votre équipe », repos du serveur, « Créer sur le serveur » passent par `pickDestination` (dossier neuf de « Mes projets » sur le web) | `renderer/routes/index.tsx` |
| Bannière d'accès (`ForgeAccessBanner`) alimentée par le marqueur `⟦forge-access …⟧` contenu dans le message d'erreur : le bridge web le transmet tel quel | `renderer/components/layout/ForgeAccessBanner.tsx`, `web/bridge.ts` (inchangé) |
| Marque (GH49) appliquée au build web et au serveur | `vite.web.config.ts`, `scripts/build-web-server.ts`, `BRAND.productName` dans `app.ts`/`hardening.ts` |

### 10.2 Sprint 3 révisé (OIDC, sessions, multi-utilisateurs)

- **Jeton** : le jeton OAuth2 de la session OIDC sert **directement** à git et à l'API (mesuré par
  #45 §12 ; risque §9 levé). Pas de création de jeton d'accès à la connexion. Le `refresh_token`
  est conservé en mémoire avec la session ; `SessionTokenStore` rafraîchit avant `expires_in`.
- **Application OAuth2** : `polenta-admin --instance <nom> oauth-app create polenta-web
  https://<domaine-web>/auth/callback` (#45) fournit `client_id` / `client_secret` →
  `POLENTA_WEB_OIDC_CLIENT_ID` / `_SECRET`. Issuer = `POLENTA_WEB_DEFAULT_SERVER`.
- **Compte de la session** : à la connexion, `auth.saveAccount({ remoteHost, username, name, email,
  provider: 'forgejo', baseUrl })` dans l'espace de l'utilisateur, identité via
  `providerFor('forgejo').resolveIdentity` (#45) ; jetons posés dans le `MemoryTokenStore` sous
  `host` et `host:login` (convention d'`AuthService`). `auth.clearAccessRevoked(host)` à chaque
  connexion réussie.
- **Révocation** : la détection existe (#45 §3.4 : 401, 403 « prohibited », sonde `GET /user` sur
  réponse non-git). Le serveur web ajoute seulement : dans `POST /rpc`, si le message d'erreur porte
  un marqueur `forge-access` 401 pour l'hôte de la forge de la session → session détruite, jetons
  effacés, événement `auth:session-revoked` aux sockets, réponse 401 (le bridge redirige vers
  `/auth/login`). `autoSync` renvoie déjà `accessRevoked` sans réseau. Vérification périodique
  (5 min) inchangée.
- **Configuration d'équipe** : `forge-config.service` fonctionne par conteneur d'utilisateur avec le
  jeton de la session ; à appeler à la connexion (équivalent du rafraîchissement déclenché par le
  renderer desktop). Le cache `userData/forge-config.json` vit dans l'espace de l'utilisateur.
- **Mode dev** conservé pour le développement et les tests e2e sans forge OIDC.
- **Logout** : `POST /auth/logout` (CSRF) au lieu de `GET` (risque §9).
- **Tests e2e S3** : contre l'instance Forgejo de test `acme` (comptes `itest-*`, actions
  d'administration par SSH via `POLENTA_E2E_SSH`, comme `e2e-desktop/` de #45), en réutilisant
  `e2e-web/support/session.ts` avec une connexion OIDC réelle ; les tests existants restent en
  mode dev (forge locale).

#### Révisions issues de l'implémentation du sprint 3 (`GH44-sprint3.md`)

| Point | Révision |
|---|---|
| Client OIDC | Implémentation minimale (`web-server/auth/oidc.ts`), sans bibliothèque : découverte (émetteur = forge, points d'accès sur la forge), Authorization Code + PKCE S256, client confidentiel (secret dans le corps), `scope=openid profile email`. **`id_token` non exploité** : jetons obtenus du point d'échange en TLS avec authentification du client, identité relue par `GET /api/v1/user` (comme le desktop). Le consentement Forgejo confirme que le jeton donne accès aux repos privés. |
| État | `state` aléatoire, à usage unique, 10 min, conservé côté serveur (`PendingAuthorizations`, plafonné à 10 000) **et** dans un cookie signé `polenta_oidc` : le retour n'est accepté que dans le navigateur qui a lancé la connexion. |
| Identité | Lue une seule fois au retour ; `AuthService.connectWithToken(url, jeton, 'forgejo', identité)` enregistre le compte et lève la révocation. Login normalisé en minuscules pour le dossier de l'utilisateur, refusé hors `[a-z0-9._-]`. |
| Jetons | `SessionTokenStore` (remplace `MemoryTokenStore`) : jeton d'accès + `refresh_token` en mémoire, rafraîchis une minute avant l'expiration (un seul à la fois), jamais recopiés dans la table générique. **Époque** incrémentée à chaque connexion : un rafraîchissement ou une erreur d'une génération antérieure n'affecte jamais la connexion suivante. |
| Révocation | Trois voies, une seule action (`revokeLogin` : sessions détruites, jetons effacés, `auth:session-revoked` puis fermeture 4402) : marqueur `forge-access` 401 de la forge de la session dans une erreur RPC ; marque `isAccessRevoked` posée par le conteneur pendant un appel, même réussi (synchronisation automatique #45, qui ne lève pas) ; vérification toutes les 5 min (sonde #45, en parallèle, sans chevauchement). Toujours conditionnée à l'époque de l'appel. |
| Sessions révoquées | Mémorisées 10 min : les appels encore en vol reçoivent `401 { revoked: true }` et la WebSocket est fermée en 4402, pour que le navigateur affiche « accès révoqué » et non une reconnexion silencieuse. Bridge : la première redirection l'emporte. |
| Pages hors application | `/auth/logged-out`, `/auth/revoked`, et pages d'erreur explicites : forge injoignable (503), refus côté forge (403), échange refusé (502), espace indisponible (503 si plafond). Plus de JSON brut dans le navigateur. |
| Déconnexion | `POST /auth/logout` avec jeton CSRF ; `GET` supprimé (risque §9 levé). |
| Pool | `POLENTA_WEB_MAX_ACTIVE_USERS` (défaut 50) : n'évince qu'un utilisateur sans vue ouverte, sans appel en cours et inactif depuis au moins 1 min ; sinon 503. |
| Configuration | `POLENTA_WEB_AUTH=oidc` exige `POLENTA_WEB_DEFAULT_SERVER`, `POLENTA_WEB_OIDC_CLIENT_ID|SECRET`, `POLENTA_WEB_PUBLIC_URL` et un `POLENTA_WEB_SESSION_SECRET` d'au moins 32 caractères ; cookies `Secure` par défaut si l'URL publique est en https ; hôtes git par défaut = hôte de la forge. |

### 10.3 Sprint 4 révisé (impression, image, déploiement)

- **Kit existant** (#45) : service compose `polenta-web` (profil `web`, image
  `${POLENTA_WEB_IMAGE}:${POLENTA_WEB_VERSION}`, volume `<instance>/web-data` →
  `/var/lib/polenta-web`, propriétaire uid 1000). **À ajouter par GH44 S4** :
  - environnement du service (fichier `web.env` de l'instance : `POLENTA_WEB_*`, secret de session,
    client OAuth2), port interne 8787 ;
  - commande `polenta-host instance web enable|disable <nom> [--domain <d>]` : crée l'application
    OAuth2, écrit `web.env`, active le profil, ajoute le site Caddy ;
  - site Caddy `polenta-web-<instance>:8787` sur le domaine web de l'instance (sous-domaine
    configurable), WebSocket `/events` compris ;
  - **sauvegarde** : `backup_instance` (lib `backup.sh`) n'inclut que `data`, `instance.env`,
    `admin.log`, `polenta-config.json` → ajouter `web-data` et `web.env` quand le profil est actif ;
    restauration et export alignés ;
  - RUNBOOK : section « client web », dimensionnement par instance avec `polenta-web`.
- **Image** : construite **par marque** (GH49 : `POLENTA_BRAND` au build), utilisateur uid 1000,
  `POLENTA_WEB_DATA_DIR=/var/lib/polenta-web`, Chromium de Playwright pour l'impression.
- **#50** (EPERM intermittent au nettoyage des tests, Windows) : corrigé dans GH44 (suppression d'un
  téléchargement à la fermeture du flux, sans rejection non gérée ; réessais de `rm`).
