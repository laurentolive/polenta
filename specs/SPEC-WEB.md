# SPEC-WEB — Polenta dans le navigateur (client web)

> Ticket d'origine : GH44 (#44). Design détaillé et historique : `specs/GH44-design.md` (§10 =
> état livré). Tests : `specs/GH44-tests.md`, `apps/desktop/e2e-web/README.md`.
> Déploiement : `deploy/RUNBOOK.md` A15 (exploitant), B7 (admin du client).

## 1. Principe

Le client web est le **troisième point d'entrée** sur le noyau de services de `apps/desktop`
(après l'application Electron et le serveur MCP) :

```
Navigateur                                   polenta-web (Node, 1 process)
 renderer desktop (même code)                 Fastify
  └ ApiClient (ipc-client)                     ├ /auth/*        OIDC forge (prod) / dev
     └ window.polenta  ◄── HTTP + WebSocket ──►├ POST /rpc/:channel   liste blanche + garde de chemins
        (renderer/web/bridge.ts)               ├ GET  /events         WebSocket (diffusion)
  └ adaptateurs (sélecteur, upload, download)  ├ POST /upload · GET /download/:id
                                               ├ GET  /healthz
                                               └ statique : out/web (web.html)
                                              UserPool : login → Container (services complets)
                                              <data>/users/<login>/{workspaces,userData}
```

Règles :

1. **Le renderer ne connaît pas le transport** : il appelle `window.polenta.invoke/on/off`. Le build
   web installe un `window.polenta` HTTP/WebSocket avant `main.tsx` (`web.html` → `web/main.tsx`).
2. **Les handlers sont les mêmes** que sur le desktop : `registerHandlers(registry, container,
   platform)` (`main/ipc/index.ts`), enregistrés dans un registre en mémoire par utilisateur.
3. **Le noyau ne dépend pas d'Electron** : ce qui touche au poste passe par `HostContext`,
   `PlatformHost`, `PrintRenderer` (`main/host/`) — implémentation web dans `web-server/web-host.ts`
   et `web-server/print/`.
4. **Un `Container` par utilisateur connecté** (pas de services partagés entre utilisateurs).
5. Le desktop **ne dépend pas** du serveur web ; il reste sans port HTTP
   (`SPEC-ELECTRON-DESKTOP.md` §1).

## 2. Arborescence

```
apps/desktop/
  src/web-server/
    index.ts            démarrage (config, durcissement, écoute)
    app.ts              routes Fastify, sessions, OIDC, révocation, impression
    config.ts           variables POLENTA_WEB_* (§8)
    session.ts          sessions en mémoire, cookies polenta_sid / polenta_csrf
    auth/oidc.ts        client OIDC minimal (découverte, PKCE S256, échange, refresh)
    user-pool.ts        UserPool : conteneurs par utilisateur, éviction, plafond
    web-host.ts         HostContext / PlatformHost web, SessionTokenStore
    web-handlers.ts     channels web:* (espaces, uploads, exports)
    channel-policy.ts   WEB_EXPOSED / WEB_HIDDEN / WEB_ONLY_CHANNELS, ROOT_ARGS, CONTENT_ARGS
    path-guard.ts       validation des chemins
    hardening.ts        durcissement du process (cwd vide, liens symboliques, hôtes git)
    file-store.ts       uploads / téléchargements
    print/headless-print.ts   impression par Chromium headless (§6)
  src/renderer/
    web.html, web/main.tsx, web/bridge.ts
    platform.ts         isWeb, capabilities
  vite.web.config.ts    build du renderer web → out/web
  scripts/build-web-server.ts   bundle esbuild → out/web-server/index.cjs
  scripts/web-runtime-package.mjs   dépendances externes du bundle (image)
  Dockerfile.web        image (§9)
  e2e-web/              tests de bout en bout Playwright
```

## 3. Transport

- `POST /rpc/:channel` — session requise, en-tête `X-Polenta-CSRF` égal au cookie `polenta_csrf`
  (double-submit), corps `{ args, undefinedArgs }` (positions des arguments `undefined`, restaurés
  côté serveur). Réponses : `200 { ok: true, value }` ; `200 { ok: false, error: { message } }` pour
  une erreur métier (même message que l'IPC, marqueur `⟦forge-access …⟧` compris) ; `401` session
  absente/expirée (`{ revoked: true }` si révoquée) ; `403` chemin refusé ; `404` channel non exposé ;
  `503` plafond d'utilisateurs actifs atteint.
- `GET /events` — WebSocket, cookie de session, Origin vérifiée (même hôte). Diffuse
  `{ channel, args }` de `platform.broadcast` à toutes les sockets de l'utilisateur. Fermeture `4402`
  = accès révoqué. Reconnexion automatique du bridge ; à la reconnexion, événement synthétique
  `web:events-reconnected` (le renderer invalide ses requêtes).
- Sérialisation JSON (pas de structured clone) : les channels exposés ne renvoient ni `Buffer`, ni
  `Map`, ni `Date`.

## 4. Sécurité

| Mesure | Règle |
|---|---|
| Liste blanche | `WEB_EXPOSED` (noyau), `WEB_ONLY_CHANNELS` (`web:*`, `app:get-version`). `WEB_HIDDEN` (jetons) et `DESKTOP_ONLY_CHANNELS` (`main/ipc/channels.ts` : dialogues, shell, mises à jour, Device Flow) ne sont jamais exposés. Un test vérifie que **tout** channel enregistré est classé : un nouveau channel non classé fait échouer la CI. GH106 : `integration:state` / `integration:designate` / `integration:create` exposés (argument racine `[0]`). |
| Garde de chemins | Arguments racine (`ROOT_ARGS` : `repoPath`, `workspaceDir`…) absolus et sous `<data>/users/<login>/` après résolution des liens ; autres chaînes et clés de chemin des DTO sans `..`, `\0` ni lecteur ; `CONTENT_ARGS` (texte libre) non inspectés. Violation → 403 journalisé (login, channel, index — jamais la valeur). |
| Process | Dossier courant vide (`<data>/.cwd`) ; liens symboliques des repos recréés en fichiers (comme `core.symlinks=false`) ; git et API des forges limités à `POLENTA_WEB_GIT_HOSTS` en HTTPS (`remote-guard.ts`, anti-SSRF). |
| Login | Normalisé en minuscules, `[a-z0-9][a-z0-9._-]{0,63}`, sinon connexion refusée (nom de dossier). |
| Cookies | `polenta_sid` signé, `HttpOnly`, `SameSite=Lax`, `Secure` si l'URL publique est en https ; `polenta_csrf` lisible par le bridge. |
| Fichiers | Upload multipart plafonné (`POLENTA_WEB_MAX_UPLOAD_MB`), extensions du desktop, purge > 24 h ; un téléchargement n'est servi qu'à son propriétaire, supprimé après envoi ou après 1 h. |
| Statique | Un chemin avec extension absent du build répond 404 (pas de repli sur `web.html`). |

## 5. Authentification et sessions

- **OIDC (production)** : `GET /auth/login` → Authorization Code + PKCE S256 vers la forge Forgejo de
  l'instance (émetteur = `POLENTA_WEB_DEFAULT_SERVER`), `scope=openid profile email`, client
  confidentiel. `state` à usage unique (10 min) conservé côté serveur **et** dans le cookie signé
  `polenta_oidc`. `GET /auth/callback` : échange du code, identité relue par `GET /api/v1/user`
  (l'`id_token` n'est pas exploité), `AuthService.connectWithToken(…, 'forgejo', identité)` dans
  l'espace de l'utilisateur. Détail : `SPEC-ACCOUNTS-AUTH.md` §Web.
- **Consentement (GH57)** : la forge ne présente pas sa page « Autoriser polenta-web » : le kit y
  installe une page de consentement personnalisée, générée à partir de celle de la version de la
  forge, qui valide automatiquement l'autorisation pour la seule application `polenta-web` de
  l'instance (comparaison du `client_id`) — page d'origine pour toute autre application, et en cas
  de doute (forme inattendue après une mise à jour). L'autorisation reste enregistrée et révocable
  dans les paramètres du compte. Détail : `specs/GH57-design.md`, `deploy/RUNBOOK.md` A15.
- **Jetons** : le jeton OAuth2 sert directement à git et à l'API de la forge. `SessionTokenStore`
  (implémente `TokenStore`) les garde **en mémoire uniquement**, rafraîchit une minute avant
  l'expiration ; une **époque** par connexion isole les rafraîchissements et erreurs d'une connexion
  antérieure.
- **Sessions** en mémoire (`POLENTA_WEB_SESSION_HOURS`, défaut 12 h). Redémarrage du serveur =
  reconnexion (silencieuse si la session forge est active). `POST /auth/logout` (CSRF) ; pages
  `/auth/logged-out`, `/auth/revoked` et pages d'erreur explicites (forge injoignable, refus,
  échange refusé, espace indisponible) — jamais de JSON brut dans le navigateur.
- **Révocation** (compte désactivé, jeton retiré) — une seule action (`revokeLogin` : sessions
  détruites, jetons effacés, événement `auth:session-revoked`, sockets fermées en 4402), trois
  déclencheurs : marqueur `forge-access` 401 de la forge de la session dans une erreur RPC ; marque
  `isAccessRevoked` posée par le conteneur pendant un appel ; sonde toutes les 5 min par utilisateur
  actif. Les sessions révoquées sont mémorisées 10 min (appels en vol → `401 { revoked: true }`).
- **Mode dev** (`POLENTA_WEB_AUTH=dev`) : un utilisateur fixe et un jeton en variable
  d'environnement, pour le développement et les tests e2e ; **refusé** avec `NODE_ENV=production`.

## 6. Espaces utilisateurs, pool et impression

- **Espace** : `<data>/users/<login>/workspaces/` (« Mes projets » : copies de travail, dont les
  modifications non publiées) et `userData/` (comptes, préférences, brouillons de merge GH37,
  uploads, téléchargements). Channels `web:workspaces-root`, `web:list-workspaces`,
  `web:new-workspace-dir`, `web:delete-workspace` (refus si non publié, sauf `force`).
- **UserPool** : conteneur créé à la première requête (création sérialisée par login), évincé après
  `POLENTA_WEB_IDLE_MINUTES` sans socket ouverte ; au-delà de `POLENTA_WEB_MAX_ACTIVE_USERS`, n'évince
  qu'un utilisateur sans vue ouverte, sans appel en cours et inactif depuis ≥ 1 min, sinon 503.
- **Impression** (`PrintRenderer` web, `print/headless-print.ts`) : un Chromium headless
  (playwright-core) partagé, lancé à la première impression et fermé après 10 min d'inutilisation ;
  au plus 2 rendus simultanés ; un contexte par rendu. Chaque rendu ouvre une **session
  d'impression** de l'utilisateur (valable la durée maximale du rendu, détruite après ; elle ne
  compte pas comme une connexion) et charge le renderer depuis l'adresse d'écoute du serveur
  (`http://127.0.0.1:<port>/?__print=<route>&…` si le serveur écoute sur toutes les interfaces) :
  mêmes routes `/print/*` et même code React que le desktop. Le bridge appelle
  `__polentaPrintReady` / `__polentaDrawioSnapshotReady`, exposées par la page headless. PDF :
  `page.pdf` A4 ; diagrammes d'un export par gabarit : captures à l'échelle 2, **par lots de 20**
  (la liste voyage dans l'URL). Délais : PDF 20 s ; diagrammes 30 s + 12 s par diagramme et par lot
  (les diagrammes non rendus retombent sur le repli texte). `POLENTA_WEB_PRINT=false` désactive
  l'impression (message explicite).

## 7. Renderer : capacités et adaptateurs

`renderer/platform.ts` : `isWeb`, `capabilities` (`localFilesystem`, `externalDrawioEditor`,
`autoUpdate`, `accountManagement`) — faux sur le web ; `serverAdmin` (GH63) vrai sur le web seulement. Les fonctions propres au poste sont
**masquées**, pas réécrites :

| Desktop | Web |
|---|---|
| Choisir un dossier (ouvrir, cloner, créer, démo) | Dossier neuf sous « Mes projets » (`web:new-workspace-dir`) ; liste « Mes projets » sur l'accueil |
| Sélecteur d'image / de fichier draw.io / de classeur d'exécution | `<input type=file>` → `POST /upload` → `web:image-import`, `web:drawio-import`, `web:execution-sheet-preview` |
| Export enregistré sur disque, « Ouvrir », « Afficher dans le dossier » | `web:export` / `web:execution-sheet-export` → téléchargement `GET /download/:id`, message « Téléchargé » |
| Comptes, PAT, Device Flow, « Changer de compte » | Identité de la session (`/auth/me`), « Se déconnecter » |
| « Ouvrir dans draw.io » | masqué (édition dans le desktop ou remplacement du fichier) |
| Mise à jour automatique | masquée ; « À propos » affiche la version du serveur |
| `Ctrl+T` / `Ctrl+W` | `Alt+T` / `Alt+W` en plus (raccourcis capturés par le navigateur) |
| Titre de fenêtre | `document.title` |
| Administration du serveur | Page « Administration » pour les propriétaires (GH63, §12) — absente du desktop |

Un channel desktop appelé par erreur depuis le web est rejeté par le bridge (« Non disponible dans
la version web »).

## 8. Configuration (`POLENTA_WEB_*`)

| Variable | Défaut | Rôle |
|---|---|---|
| `POLENTA_WEB_AUTH` | `dev` | `oidc` en production (`dev` refusé avec `NODE_ENV=production`). |
| `POLENTA_WEB_DEFAULT_SERVER` | — (oidc) | Forge de l'instance : émetteur OIDC, forge par défaut. |
| `POLENTA_WEB_OIDC_CLIENT_ID` / `_SECRET` | — (oidc) | Application OAuth2 `polenta-web` de la forge. |
| `POLENTA_WEB_PUBLIC_URL` | — (oidc) | URL publique (retour `…/auth/callback`). |
| `POLENTA_WEB_SESSION_SECRET` | — (oidc, ≥ 32 car.) | Signature des cookies. |
| `POLENTA_WEB_DATA_DIR` | `<app>/.web-data` (image : `/var/lib/polenta-web`) | Espaces utilisateurs. |
| `POLENTA_WEB_HOST` / `_PORT` | `127.0.0.1` / `8787` | Écoute (image : `0.0.0.0`). |
| `POLENTA_WEB_GIT_HOSTS` | hôte de la forge | Hôtes git/API autorisés (virgules). |
| `POLENTA_WEB_GIT_ALLOW_HTTP` | `false` | Git en HTTP clair (forge interne sans TLS). |
| `POLENTA_WEB_SECURE_COOKIES` | `true` si URL publique https | Cookies `Secure`. |
| `POLENTA_WEB_SESSION_HOURS` | 12 | Durée max d'une session. |
| `POLENTA_WEB_IDLE_MINUTES` | 30 | Éviction d'un conteneur inactif. |
| `POLENTA_WEB_MAX_ACTIVE_USERS` | 50 | Plafond de conteneurs en mémoire. |
| `POLENTA_WEB_MAX_UPLOAD_MB` | 20 | Taille max d'un upload. |
| `POLENTA_WEB_PRINT` | `true` | Impression headless. |
| `POLENTA_WEB_DEMO_PROJECT_URL` | démo | Projet de démonstration proposé. |
| `POLENTA_WEB_STATIC_DIR`, `_RESOURCES_DIR`, `_APP_ROOT`, `_NO_STATIC` | build local | Emplacements (image, dev Vite). |
| `POLENTA_WEB_DEV_LOGIN`, `_TOKEN`, `_REMOTE`, `_NAME`, `_EMAIL` | — | Mode dev uniquement. |
| `POLENTA_ADMIN_URL` / `POLENTA_ADMIN_SERVICE_TOKEN` | — | API d'administration (GH63, écrits par le kit si `ADMIN_UI=on`) ; absents = `/admin/*` en 404. |
| `POLENTA_WEB_ADMIN_DEV` | — | `1` : administration en mode dev (tests) ; démarrage refusé avec `NODE_ENV=production`. |

## 9. Build, image et déploiement

- **Build** : `pnpm build:web` (renderer web + bundle serveur), marque appliquée par
  `POLENTA_BRAND` (GH49). Dev : `pnpm dev:web` (Vite 5180 + serveur 8787 en mode dev).
- **Image** `apps/desktop/Dockerfile.web` (contexte = racine du monorepo, `--build-arg
  POLENTA_BRAND`) : build `node:20-bookworm` (pnpm, sans binaire Electron ni navigateurs) ; exécution
  `node:20-bookworm-slim` + dépendances externes du bundle (Fastify, playwright-core) + Chromium
  headless et ses dépendances système (`playwright-core install --with-deps --only-shell chromium`).
  Utilisateur `node` (uid 1000), volume `/var/lib/polenta-web`, `HEALTHCHECK` sur `/healthz`.
- **Kit `deploy/`** (#45) : service compose `polenta-web` (profil `web`, `web.env` de l'instance,
  démarre après la forge saine) ; `polenta-host instance web enable <nom> --domain <d> --version <v>
  [--image <i>]` crée l'application OAuth2 de la forge, installe la page de consentement
  personnalisée (GH57, `deploy/lib/grant-template.py`), écrit `web.env` (600), démarre le conteneur
  et publie le site Caddy `<nom>.web.caddy` (reverse proxy vers `polenta-web-<nom>:8787`, WebSocket
  compris) ; `instance web disable` l'arrête (données conservées). Sauvegarde, restauration et export
  de l'instance incluent `web-data` et `web.env`. Procédures : `deploy/RUNBOOK.md` A15.
  **Caddy optionnel** (GH61) : avec `CADDY_MODE=external` (`host.env`, défaut `managed`), le kit ne crée
  aucun Caddy et n'ouvre pas 80/443 ; les blocs `<nom>.caddy` / `<nom>.web.caddy` (contenu identique)
  sont écrits dans `CADDY_SITES_DIR`, le Caddy existant est rechargé par `CADDY_RELOAD_CMD`, forge et client
  web rejoignent `EDGE_NETWORK` (réseau créé par l'exploitant, partagé avec ce Caddy : l'isolation réseau
  entre instances n'est alors plus garantie) et la santé est sondée sur ce réseau interne
  (`wait_edge_http`) au lieu de `https://`. Procédures, migrations et dépannage : `deploy/RUNBOOK.md` A16 ;
  preuves : `deploy/tests/acceptance-external.sh` (hôte), `deploy/tests/acceptance.sh --external`.

## 10. Tests

- Unitaires (vitest) : `web-server/*.test.ts` — liste blanche exhaustive, garde de chemins,
  durcissement, pool, sessions et OIDC (forge simulée).
- Bout en bout (Playwright, `apps/desktop/e2e-web/`) : serveur en mode dev contre une forge git
  locale (parité des parcours, impression), et OIDC réel contre l'instance de test quand
  `POLENTA_E2E_SSH` est défini. Mode d'emploi : `e2e-web/README.md`.

## 11. Limites connues

- Édition des diagrammes draw.io : pas d'éditeur externe sur le web (#46).
- Sessions en mémoire : un redémarrage du serveur demande une reconnexion.
- Isolation par conteneur de services dans un seul process (pas un process par utilisateur) ;
  dossier courant partagé mais vide.
- Révocation constatée au plus tard après 5 min pour un utilisateur sans opération git.

## 12. Administration du serveur (GH63)

Zone « Administration » du client web, réservée aux **propriétaires** de l'organisation Forgejo de
l'instance (`is_owner`) : niveau **instance** (sa propre instance) ou **hôte** (propriétaires de
l'instance d'exploitation `ADMIN_INSTANCE` : toutes les instances et l'hôte). Détail : `specs/GH63.md`,
`specs/GH63-design.md`, exploitation : `deploy/RUNBOOK.md` A17.

- **Chemin** : navigateur → `/admin/api/*` (web-server, session + CSRF, sessions d'impression refusées,
  liste fermée de chemins) → service interne `polenta-admin` (`apps/admin-service`, réseau
  `polenta-admin-net`, aucun port publié) → scripts du kit `deploy/`, Docker par `polenta-docker-proxy`,
  hôte par `polenta-host-agent`. Hors `ChannelPolicy` : aucun channel `admin:*`.
- **Droit** : jamais stocké côté web ; le service le revérifie auprès de la forge avec le jeton de
  l'utilisateur (cache 60 s, aucun pour une opération destructive). Le web-server transmet le jeton de
  service de l'instance (`POLENTA_ADMIN_SERVICE_TOKEN`) et le jeton forge de la session.
- **Découverte** : `GET /admin/status` (toujours 200, `{available, me}`) ; pas d'erreur console pour un
  non-propriétaire ni sur un serveur sans administration.
- **Renderer** : entrée « Administration du serveur » dans le panneau Compte ; onglets Instances,
  Sauvegardes, Exports, Utilisateurs, Journal, DNS (+ Hôte, Stockage S3 au niveau hôte) ; suivi des
  travaux par sondage, bandeau global « opération en cours » (interface ou SSH) ; confirmation par saisie
  du nom pour les opérations destructives ; valeurs à usage unique (clé de sauvegarde, mots de passe
  temporaires) affichées une fois, masquées par défaut.
- **Tests** : `src/web-server/admin/admin-routes.test.ts` ; e2e `gh63-admin.spec.ts`,
  `gh63-sensitive.spec.ts` contre `e2e-web/support/fake-admin-service.mjs`.
