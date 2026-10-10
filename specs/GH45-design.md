# GH45 — Design technique

Entrée : `specs/GH45.md` (validée le 2026-10-09, amendée multi-instance, commit aeda6b0).
Base : branche `GH45` créée depuis `GH44` @ ece9810 (`HostContext`/`TokenStore`, serveur web S2).

## 1. Contraintes qui structurent le design

| Constat | Conséquence |
|---|---|
| Pas de Docker ni de WSL sur le poste de dev. | Les tests sur un vrai Forgejo ou un vrai Gitea se font **sur le VPS** (`vps-f515f9c6`, avant tout client). Le kit d'infra de base passe donc **avant** le code Polenta. |
| Les deux transports (IPC Electron, bridge HTTP de GH44) ne transmettent que `error.message`. | La classification 401/403 voyage **dans le message**, sous forme d'un marqueur structuré (§3.4). |
| `git-http.ts` porte déjà un garde d'URL (`setGitRemoteGuard`, anti-SSRF du web). | Les appels API de forge passent par le **même garde** (§3.2). |
| `@polenta/types` contient déjà du code runtime (`parameter-refs.ts`, `schema.ts`…). | Le marqueur d'erreur partagé entre main et renderer y vit (§3.4). |
| La démo (`demo-ll800-produit`) déclare 4 composants sur github.com, épinglés par branche, tag ou SHA. | Le miroir de démo importe les 5 repos (tags compris) puis réécrit les URLs dans `polenta-repo.yaml` (§5.5). |
| Le multi-instance donne un sous-domaine par client. | **Prérequis humain** : un domaine avec un enregistrement wildcard (`*.forge.<domaine>` en A et AAAA vers le VPS). Le nom OVH du VPS ne fournit pas de sous-domaines. |

## 2. Découpage en sprints

| Sprint | Contenu | Dépend de | Débloque |
|---|---|---|---|
| **S1** | Infra de base : `polenta-host.sh setup`, `instance add/list/stop/start`, `polenta-admin.sh` (sauf `access report`), sites Caddy, isolation. **Point de vérification API** (§6). | Prérequis humains (§7) | Forge réelle pour S2 ; GH44 S3 (OIDC : `oauth-app create`) |
| **S2** | P0 Polenta : providers, identité, configuration machine, connexion par mot de passe → jeton, 401/403 (bannière, auto-pull), compte courant, message GH30. Tests réels Forgejo + Gitea. | S1 | **GH44 S3** |
| **S3** | Infra exploitation : sauvegarde/restauration, `update` avec retour arrière, `export`/`remove`, fail2ban, `access report`, RUNBOOK. Test de réinstallation de l'OS. | S1 | **GH44 S4** |
| **S4** | P1 : liste des repos, création sur le serveur (projet et composant), champ `user`, diagnostic de droits. Mises à jour SPEC (dernier sprint). | S2 | — |

S2 et S3 sont indépendants l'un de l'autre et peuvent s'enchaîner dans un ordre ou l'autre.

---

## 3. Polenta — P0 (sprint S2)

### 3.1 Types partagés — `packages/types/src/forge.ts` (nouveau)

```ts
export type ForgeKind = 'github' | 'forgejo' | 'generic'

export interface ForgeIdentity { login: string; name: string; email: string }

export interface ForgeAccount {          // ce que l'UI affiche du compte courant (sans jeton)
  key: string                            // `${host}:${login}` — clé keytar et defaultAccount actuels
  provider: ForgeKind
  baseUrl: string                        // scheme + host + port, sans slash final
  host: string
  login: string; name: string; email: string
}

export interface MachineConfig {
  defaultServer?: string                 // baseUrl normalisée
  hideGithub: boolean
  demoProjectUrl?: string
  autoUpdate?: false                     // seule valeur significative
}

export type PasswordLoginResult =
  | { status: 'ok'; account: ForgeAccount }
  | { status: 'otp-required' }
  | { status: 'invalid-otp' }
  | { status: 'invalid-credentials' }
  | { status: 'account-disabled' }
  | { status: 'not-a-forge' }
  | { status: 'network'; message: string }

// Marqueur d'erreur d'accès (§3.4)
export interface ForgeAccessIssue { status: 401 | 403; host: string; repo?: string }
export function encodeForgeAccessError(issue: ForgeAccessIssue, humanMessage: string): string
export function parseForgeAccessError(message: string): { issue: ForgeAccessIssue; humanMessage: string } | null
```

`AppSettings` (`app.ts`) gagne `autoCheckUpdatesLocked?: boolean`, en lecture seule, calculé et jamais
écrit. `IntegrationRemoteState` gagne `accessRevoked?: boolean`, à côté de `offline` (GH43).

### 3.2 Couche forge — `apps/desktop/src/main/services/forge/` (nouveau dossier)

Exception assumée à « services à plat » (SPEC-ELECTRON-DESKTOP §2–3) : 6 fichiers cohérents. La SPEC
sera mise à jour au S4.

| Fichier | Rôle |
|---|---|
| `remote-guard.ts` | `setRemoteGuard` / `checkRemote(url)`, extraits de `git-http.ts`, qui s'en sert désormais. Un seul garde pour git **et** l'API. `setGitRemoteGuard` reste un alias (aucun changement d'appel côté `web-server/hardening.ts`). |
| `forge-http.ts` | `forgeRequest(url, { method, token?, basic?, otp?, json? })` : `checkRemote`, puis proxy (`resolveProxyDispatcher`), puis undici. Lève `ForgeHttpError { status, body, url }` sur un statut ≥ 400 et laisse passer les erreurs réseau (`isNetworkUnreachable` continue de fonctionner). `paginate(url, …)` : `page`/`limit=50` jusqu'à une page incomplète. |
| `forge-provider.ts` | Interface `ForgeProvider` (ci-dessous) et `providerFor(kind)`. |
| `github.provider.ts` | `resolveIdentity` (code actuel de `resolveGithubIdentity`), Device Flow (déplacé depuis `AuthService`), `GITHUB_HOST`. **Seul endroit où `github.com` est écrit en dur** (critère 9). |
| `forgejo.provider.ts` | API `/api/v1`, pour Forgejo et Gitea (§3.3). |
| `forge-detect.ts` | `detectForgeKind(baseUrl)` : hôte du provider GitHub → `github` ; sinon `GET /api/v1/version` → JSON `{version: string}` donne `forgejo` ; sinon `generic`. Erreur réseau → propagée (l'UI affiche le message réseau). |

```ts
export interface ForgeProvider {
  readonly kind: ForgeKind
  resolveIdentity(baseUrl: string, token: string): Promise<ForgeIdentity>
  // Optionnels — implémentés par forgejo seulement en V1 (spec hors scope : rien pour github)
  createAccessToken?(baseUrl: string, login: string, password: string, otp: string | undefined,
                     tokenName: string): Promise<string>
  listRepos?(baseUrl: string, token: string): Promise<ForgeRepo[]>
  listCreatableOrgs?(baseUrl: string, token: string, login: string): Promise<ForgeOrg[]>
  repoExists?(baseUrl: string, token: string, owner: string, name: string): Promise<boolean>
  createOrgRepo?(baseUrl: string, token: string, org: string, name: string): Promise<ForgeRepo>
  repoPermissions?(baseUrl: string, token: string, owner: string, repo: string):
                   Promise<{ pull: boolean; push: boolean; admin: boolean } | null>
  orgMembers?(baseUrl: string, token: string, owner: string): Promise<ForgeMember[] | null>  // null : owner n'est pas une organisation
}
```

`generic` n'a pas de provider : `providerFor('generic')` renvoie `null`, et les appelants gardent le
comportement actuel (repli d'identité minimal, aucune fonction P1).

### 3.3 Provider Forgejo/Gitea

| Fonction | Appel | Notes |
|---|---|---|
| identité | `GET /api/v1/user` | `name = full_name \|\| login` ; `email` tel quel (adresse noreply si l'utilisateur masque la sienne) |
| jeton | `POST /api/v1/users/{login}/tokens`, Basic Auth, en-têtes `X-Gitea-OTP` **et** `X-Forgejo-OTP` si un code est fourni | Corps `{ name, scopes }`. Réponse : `sha1`. Scopes et forme exacte des erreurs (2FA requise, code invalide, compte désactivé) **figés au point de vérification §6**. |
| repos | `GET /api/v1/user/repos` paginé | `full_name`, `clone_url`, `description`, `permissions` |
| orgs créables | `GET /api/v1/user/orgs`, puis `GET /api/v1/users/{login}/orgs/{org}/permissions` → `can_create_repository` | Endpoint à confirmer au §6. Repli : `is_owner \|\| can_create_repository`. |
| existe ? | `GET /api/v1/repos/{owner}/{name}` | 404 → libre |
| création | `POST /api/v1/orgs/{org}/repos` `{ name, private: true, auto_init: false, default_branch: 'main' }` | 409 → nom pris |
| permissions | `GET /api/v1/repos/{owner}/{repo}` → `permissions` | 404/403 → `null` (pas d'accès) |
| membres | `GET /api/v1/orgs/{owner}/members` paginé | 404 sur `/orgs/{owner}` → `null` (owner = utilisateur) |

Nom du jeton : `polenta-<HostContext.deviceLabel>-<AAAAMMJJ-HHmm>`. `deviceLabel` est un nouveau champ
**optionnel** de `HostContext` : `os.hostname()` sur le desktop, `web` sur le serveur web (que GH44 S3
pourra préciser), absent pour MCP (le MCP ne se connecte pas).

### 3.4 Erreurs d'accès — `main/services/forge/forge-access.ts`

- `httpStatusOf(err)` :
  - isomorphic-git `HttpError` → `data.statusCode` (code déplacé depuis `workspace-tree.service.ts`) ;
  - binaire git natif → stderr `/returned error: (401|403)/`, ou `Authentication failed` → 401 ;
  - `ForgeHttpError` → `status`.
- `class ForgeAccessError extends Error` : son `message` = `encodeForgeAccessError(issue, texteFR)`.
  Le marqueur est `⟦forge-access {"status":401,"host":"…"}⟧ `, suivi du texte lisible. Les deux
  transports gardent le message intact. L'IPC Electron le préfixe de `Error invoking remote method …`,
  c'est pourquoi `parseForgeAccessError` cherche le marqueur **n'importe où** dans le message.
- Règles (dans `SyncService`, autour de `clone`, `fetch`, `push`, `pushBranch`, `pull`,
  `pullFastForwardOnly`, `resyncIntegration`, `deleteRemoteBranch` ; et dans les appels API des
  providers) :
  - **401 avec des identifiants envoyés** → `auth.markAccessRevoked(host)`, puis `ForgeAccessError(401)`.
    Sans identifiants (aucun compte pour cet hôte), l'erreur d'origine est conservée : le message
    GH30 « aucun compte configuré » continue de s'appliquer.
  - **403 sur une opération d'écriture** (`push`, `pushBranch`, `deleteRemoteBranch`) →
    `ForgeAccessError(403, repo)`, avec le texte de la spec §5.3. Un 403 en lecture reste l'erreur
    d'origine (chemin GH30).
- `autoSync` : si `auth.isAccessRevoked(host)` → renvoie `integrationState(...)` avec
  `accessRevoked: true`, **sans appel réseau**. Un 401 pendant le tick → marque l'hôte, renvoie aussi
  `accessRevoked: true`, sans lever (même logique que `offline`).
- `markAccessRevoked` est un `Set<host>` en mémoire dans `AuthService` (par processus ; sur le web, par
  conteneur d'utilisateur). Il est levé par une connexion réussie sur cet hôte.

### 3.5 `AuthService` (modifié)

- `StoredAccount` gagne `provider?: ForgeKind` et `baseUrl?: string`. Normalisation **à la lecture** :
  - absents → `provider = host === GITHUB_HOST ? 'github' : 'generic'` ;
  - `baseUrl = https://${remoteHost}`.

  On n'écrit jamais de migration : le fichier n'est réécrit qu'à la prochaine sauvegarde.
- `resolveIdentity(remote, token)` → via `providerFor(kind)` ; `generic` → repli minimal actuel.
- `persistToken(remote, token, kind)` : pour `github`/`forgejo`, un échec d'identité **lève une
  erreur** (plus de compte « Git User »). Le repli ne reste que pour `generic`.
- `setup(remote, pat)` (formulaire jeton) détecte d'abord le type de forge.
- **Nouveau** `loginWithPassword(serverUrl, login, password, otp?)` → `PasswordLoginResult` :
  1. `detectForgeKind` doit renvoyer `forgejo`, sinon `not-a-forge` ;
  2. `createAccessToken` ;
  3. `persistToken` ;
  4. `clearAccessRevoked(host)`.

  Le mot de passe n'est passé qu'à `forgeRequest` (en-tête `Authorization` construit localement).
  Il n'est jamais journalisé, et les messages de `ForgeHttpError` n'incluent ni les en-têtes ni le
  corps de la requête.
- **Nouveau** `currentAccount(): ForgeAccount | null` : compte par défaut, lu dans `auth.json`, sans
  réseau. Il remplace les 3 boucles `KNOWN_REMOTES` du renderer (`AccountMenu.tsx`,
  `AccountPanel.tsx`, `routes/account.tsx`).
- **Nouveau** `logout()` : supprime les jetons (`host` et `host:login`) et le compte de `auth.json`,
  puis promeut le compte suivant en compte par défaut s'il y en a un.
- `hasAnyAccount` / `projectUsername` : comptes enregistrés et hôte d'`origin`. Les jetons nus
  hérités (saisis avant les comptes) sont **migrés une fois** au démarrage
  (`migrateLegacyBareTokens`) : pour chacun des 2 hôtes historiques qui a un jeton nu sans compte, un
  compte est créé (identité résolue ; si l'échec est réseau, on réessaie au prochain démarrage). La
  constante `LEGACY_BARE_TOKEN_HOSTS` est la seule liste d'hôtes hors provider, documentée comme
  migration (critère 9).
- `providerKindForUrl(url)` : compte de cet hôte → son `provider`, sinon `null`. Utilisé par le
  message GH30 et par P1.

### 3.6 Configuration machine

- `main/services/machine-config.ts` (fonction pure + lecture du fichier) :
  `loadMachineConfig({ platform, env, readFile, log }) → MachineConfig`.
  - Chemin :
    - `env.POLENTA_CONFIG` ;
    - sinon, sous Windows, `%ProgramData%\Polenta\config.json` ;
    - sous macOS, `/Library/Application Support/Polenta/config.json` ;
    - sous Linux, `/etc/polenta/config.json`.
  - Validation clé par clé : URL http(s) pour `defaultServer` et `demoProjectUrl` (normalisées),
    booléen pour `hideGithub`, `false` seulement pour `autoUpdate`. Une clé inconnue ou invalide est
    ignorée, avec un `log.warn`. Un JSON illisible donne `{ hideGithub: false }`, avec un `log.warn`.
- `HostContext.machineConfig: MachineConfig` (**requis**) :
  - desktop : `createElectronHostContext()` le charge une fois au démarrage ;
  - web : `web-host.ts` le construit depuis `POLENTA_WEB_DEFAULT_SERVER` (par défaut : premier hôte
    de `POLENTA_WEB_GIT_HOSTS` en https) et `POLENTA_WEB_DEMO_PROJECT_URL`, avec `hideGithub: true`
    si l'hôte n'est pas github.com ;
  - MCP : `{ hideGithub: false }`.
- Nouveau channel partagé `app:get-machine-config`.
- `AppSettingsService` reçoit `machineConfig` : si `autoUpdate === false`, `get()` renvoie
  `autoCheckUpdates: false, autoCheckUpdatesLocked: true`, et `set()` ignore `autoCheckUpdates`.
  `UpdateService.scheduleStartupCheck` ne change pas (il lit `get()`) : aucune requête vers github.com
  (critère 4).

### 3.7 IPC (channels partagés, sauf mention contraire)

| Channel | Service |
|---|---|
| `auth:detect-forge(serverUrl)` | `detectForgeKind` |
| `auth:login-password(serverUrl, login, password, otp?)` | `loginWithPassword` |
| `auth:current-account()` | `currentAccount` |
| `auth:logout()` | `logout` — **desktop uniquement** (le web a sa propre déconnexion de session) |
| `app:get-machine-config()` | `host.machineConfig` |

Ils sont ajoutés à `@polenta/api-client` et à la liste blanche des channels du serveur web
(`channel-policy.ts`). Sur le web, `auth:login-password` **n'est pas exposé** : la connexion se fait par
OIDC (GH44 S3).

### 3.8 Renderer

- `renderer/api.ts` : `createIpcClient(invoke)` reçoit un `invoke` enveloppé. Sur rejet, l'enveloppe
  appelle `parseForgeAccessError(message)` ; si c'est une erreur d'accès, elle appelle
  `forgeAccessNotices.report(issue)` et **relance une erreur dont le message est le texte lisible
  seul**. Toutes les UI existantes (Publier, indicateur de sync, clone) affichent ainsi un texte
  propre sans modification. `@polenta/api-client` : `createIpcClient(invoke = window.polenta.invoke)`
  (paramètre optionnel).
- `renderer/lib/forgeAccessNotices.ts` : petit store (`report` / `subscribe` / `clear(host)`),
  dédupliqué par hôte pour les 401 jusqu'à `clear` (appelé après une connexion réussie).
- `components/layout/ForgeAccessBanner.tsx` (monté dans `AppLayout`) : bannière 401
  « Votre accès au serveur <hôte> a été révoqué ou a expiré. Reconnectez-vous. »
  - desktop : bouton → `/login?server=<baseUrl>` ;
  - web : redirection `/auth/login` (GH44 S3 invalide la session).
- `hooks/useAutoPull.ts` : si `accessRevoked` → `forgeAccessNotices.report({ status: 401, host })` et
  `sync:last-error` avec le texte. Pas de `console.warn` à chaque tick (critère 5).
- `routes/login.tsx` (refonte du formulaire desktop) :
  - le sélecteur de serveur vient de `machineConfig`. Avec `hideGithub` et `defaultServer`, le
    serveur est affiché seul, sans sélecteur ;
  - le type de forge est détecté à la validation de l'URL (`auth:detect-forge`), avec un anti-rebond :
    - `github` → formulaire actuel (jeton + Device Flow) ;
    - `forgejo` → identifiant / mot de passe, puis un champ code 2FA qui n'apparaît que sur
      `otp-required`, et un lien « Utiliser un jeton » ;
    - `generic` → jeton ;
  - le paramètre de recherche `server` pré-remplit l'URL (retour depuis la bannière).
- `AccountMenu.tsx`, `AccountPanel.tsx`, `routes/account.tsx` : un hook `useCurrentAccount()`
  (`auth:current-account`) remplace les 3 boucles `KNOWN_REMOTES` (supprimées). La déconnexion passe
  par `auth:logout`, avec une ligne d'aide (spec §4.5) pour un compte `forgejo`.
- `AccountPanel` : case « Vérifier les mises à jour » désactivée, avec une infobulle, si
  `autoCheckUpdatesLocked`.
- `routes/index.tsx` : bouton Démo → `machineConfig.demoProjectUrl ?? (hideGithub ? masqué :
  DEMO_PROJECT_URL)`.
- i18n FR/EN pour tous les nouveaux textes (`login.*`, `forgeAccess.*`, `account.*`).

### 3.9 Message GH30 (`workspace-tree.service.ts`)

`httpErrorStatus` est remplacé par `httpStatusOf` (§3.4), et un `ForgeAccessError` 401 est reconnu.
Le texte dépend de `auth.providerKindForUrl(node.url)` : pour `forgejo`, « Votre compte n'a pas accès
au dépôt "<nom>" (<url>). Demandez à l'administrateur de vous ajouter à une équipe qui y a accès. »
Pour `github` et `null`, les textes actuels sont inchangés. `WorkspaceTreeService` reçoit `auth` (ajout
au constructeur, `container.ts`).

---

## 4. Polenta — P1 (sprint S4)

### 4.1 Service `ForgeService` — `main/services/forge/forge.service.ts`

Il dépend d'`AuthService` (comptes, jetons, provider par URL) et de `SyncService`/`WorkspaceService`.

| Méthode | Comportement |
|---|---|
| `accounts()` | Comptes `forgejo` (sélecteur quand il y en a plusieurs) |
| `listRepos(accountKey)` | Provider `listRepos`, avec `readOnly = !permissions.push` |
| `creatableOrgs(accountKey)` | `listCreatableOrgs` |
| `repoAccess(repoPath)` | URL d'`origin`, provider, `repoPermissions` ; `null` si hors ligne, non-forgejo ou sans compte (aucune erreur) |
| `orgMembers(repoPath)` | Owner tiré de l'URL d'`origin`, puis `orgMembers`, avec un cache par `(host, org)` pour la durée du processus ; `null` dans les cas sans objet |

### 4.2 Création sur le serveur (côté main, pour un ordre et une gestion d'échec maîtrisés)

`WorkspaceService.createOnServer(containerDir, name, accountKey, org)` :

1. `repoExists` → **erreur avant toute écriture locale** si le nom est pris (spec §6.4).
2. `createOrgRepo`.
3. `createNewProject(containerDir, name)` (inchangé, GH27).
4. Ajout d'`origin` = `clone_url`.
5. `pushBranch(main)`.
6. Résultat `{ ...WorkspaceOpenResult, pushWarning?: string }` : un échec du push n'annule rien (spec
   §6.3). Le repo distant n'est **jamais** supprimé.

`WorkspaceService.createComponentOnServer(workspaceDir, name, accountKey, org)` : mêmes étapes 1 à 5
sur `workspaceDir/<name>`, avec le même contenu initial que `createNewProject`. Il renvoie
`clone_url`, que la modale inscrit dans le champ URL.

Channels :
- `forge:accounts` ;
- `forge:list-repos` ;
- `forge:creatable-orgs` ;
- `forge:repo-access` ;
- `forge:org-members` ;
- `workspace:create-on-server` ;
- `workspace:create-component-on-server`.

Tous sont partagés. La garde de chemins du web s'applique aux arguments `containerDir`/`workspaceDir`.

### 4.3 UI

- `components/home/RepoPickerModal.tsx` (accueil « Depuis un repo ») :
  - liste filtrable (`organisation/nom`, description), badge « lecture seule » ;
  - sélecteur de compte s'il y en a plusieurs ;
  - lien « Saisir une URL » vers le `TextPromptModal` actuel ;
  - n'est affichée que si `forge:accounts` n'est pas vide, sinon flux actuel.
- `components/home/CreateProjectModal.tsx` (accueil « Créer ») :
  - nom, puis choix « Sur ce poste » / « Sur le serveur <hôte> » ;
  - organisation : seulement les organisations créables. S'il n'y en a aucune, l'option est
    désactivée avec une explication ;
  - sans compte `forgejo` → `TextPromptModal` actuel.
- `AddDependencyModal.tsx` : bouton « Créer le repo sur le serveur » (organisation + nom), qui remplit
  l'URL au retour.
- `components/system/UserFieldInput.tsx` : `<input list>` + `<datalist>` alimenté par
  `forge:org-members` (React Query, `staleTime: Infinity`). Il est utilisé par `EditView` (cas
  `user`) et par tout autre éditeur du type `user` repéré au S4. La saisie reste libre.
- `hooks/useRepoAccessDiagnostic.ts` + bandeau dans `AppLayout` :
  - au chargement du workspace, `forge:repo-access` sur la racine ;
  - `push === false` → bandeau non bloquant (spec §8.2). Les dépendances sans accès sont déjà
    signalées par §3.9.

---

## 5. Infra — kit `deploy/` (sprints S1 et S3)

### 5.1 Arborescence (écart à la spec : `app.ini.tmpl` remplacé par des variables d'environnement)

```
deploy/
├── polenta-host.sh            setup | status | instance <add|list|stop|start|update|backup|restore|export|remove>
├── polenta-admin.sh           --instance <nom> user|team|project|access|oauth-app …
├── lib/
│   ├── common.sh              log/die, require_root, check_os, env (lecture/écriture idempotente), confirm
│   ├── forgejo-api.sh         api GET/POST/PATCH/DELETE (curl + jq, jeton ops), pagination
│   ├── caddy.sh               génération du site d'instance, connexion réseau, rechargement à chaud
│   └── backup.sh              restic par instance (env, backup, forget/prune, restore, ping)
├── host/
│   ├── docker-compose.yml     caddy:<version épinglée>, ports 80/443, volumes data/config/sites
│   └── Caddyfile              { email {$ACME_EMAIL} } + import /etc/caddy/sites/*.caddy
├── instance/
│   ├── docker-compose.yml     forgejo (image `${FORGE_IMAGE}:${FORGE_VERSION}`), réseau propre ; profil polenta-web
│   └── instance.env.example
├── host.env.example
├── config.example.json
├── tests/acceptance.sh        vérifications non destructives depuis l'extérieur (§8)
└── RUNBOOK.md
```

État sur l'hôte :
- `/opt/polenta/kit/` : copie du kit ;
- `/opt/polenta/host.env` ;
- `/opt/polenta/caddy/{data,config,sites}/` ;
- `/opt/polenta/instances/<nom>/{instance.env,data/,admin.log}` ;
- `/usr/local/bin/polenta-host` et `/usr/local/bin/polenta-admin` (liens) ;
- `/var/log/polenta/`.

Dépendances installées par `setup` : `docker-ce` + plugin `compose`, `jq`, `curl`, `dnsutils`,
`restic`, `ufw`, `fail2ban`, `unattended-upgrades`.

### 5.2 Configuration Forgejo par variables (`instance.env`)

Variables `FORGEJO__section__KEY`. Pour qu'un même fichier serve aussi au test de compatibilité Gitea
(image surchargée par `FORGE_IMAGE`), le kit les écrit aussi en `GITEA__…`. *La prise en charge du
préfixe par chacune des deux images est vérifiée au §6* ; on n'en garde qu'un si l'autre suffit.

| Clé | Valeur |
|---|---|
| `server.ROOT_URL` / `DOMAIN` | `https://<domaine>/` |
| `server.DISABLE_SSH` / `START_SSH_SERVER` / `LFS_START_SERVER` | `true` / `false` / `false` |
| `service.DISABLE_REGISTRATION` / `REQUIRE_SIGNIN_VIEW` | `true` / `true` |
| `repository.FORCE_PRIVATE` / `DEFAULT_PRIVATE` | `true` / `private` |
| `repository.upload.FILE_MAX_SIZE`, `server.LFS_MAX_FILE_SIZE` | 50 (Mo) / 0 |
| `security.INSTALL_LOCK` / `SECRET_KEY` / `INTERNAL_TOKEN` | `true` / générés |
| `security.DISABLE_GIT_HOOKS` | `true` |
| `security.REVERSE_PROXY_LIMIT` / `REVERSE_PROXY_TRUSTED_PROXIES` | `1` / sous-réseau du réseau d'instance (IP client réelle pour les journaux et fail2ban) |
| `database.DB_TYPE` | `sqlite3` |
| `mailer.*` | Depuis `host.env` (`SMTP_*`), surchargeable par instance ; absent → mailer désactivé |
| `log.MODE` / `log.ROOT_PATH` | `console, file` / `/data/log` (lu par fail2ban) |

`SECRET_KEY` fait partie des données à sauvegarder : il chiffre les secrets 2FA. `instance.env` est
donc inclus dans la sauvegarde restic (chiffrée).

### 5.3 Réseau et TLS

- Chaque instance est un projet compose `polenta-<nom>`, avec un réseau bridge `polenta-<nom>`.
  Forgejo **ne publie aucun port**.
- Caddy est relié à chaque réseau d'instance par `docker network connect`, à chaud, sans redémarrage.
  Le `docker-compose.yml` de l'hôte est régénéré avec la liste des réseaux externes, pour rester
  cohérent si Caddy est recréé. Les instances n'ont aucun réseau commun (critère 15).
- Site d'instance : `/opt/polenta/caddy/sites/<nom>.caddy` → `reverse_proxy forgejo-<nom>:3000`,
  plus les en-têtes (HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options SAMEORIGIN`),
  plus `request_body max_size 60MB`. Rechargement par
  `docker exec caddy caddy reload --config /etc/caddy/Caddyfile` (sans coupure).
- Docker contourne `ufw` pour les ports publiés : seuls 80 et 443 le sont, par Caddy. **fail2ban
  utilise la chaîne `DOCKER-USER`** pour bannir le trafic à destination de Caddy (dans `INPUT`, le ban
  n'aurait aucun effet).

### 5.4 `setup` (S1)

Étapes de spec §9.2, avec deux précisions :

- **IP publique** : `ip -4 route get 1.1.1.1` (adresse source), et l'équivalent en IPv6.
- **Durcissement SSH** : drop-in `/etc/ssh/sshd_config.d/10-polenta.conf`, appliqué seulement si
  `~$SUDO_USER/.ssh/authorized_keys` contient au moins une clé, puis `sshd -t` et un rechargement. Sur
  un échec de `sshd -t`, le drop-in est retiré.

`unattended-upgrades` avec redémarrage automatique à 04:00. Le cron `/etc/cron.d/polenta` est
complété au S3.

### 5.5 `instance add` (S1)

Étapes de spec §9.4. Précisions :

- **Compte d'exploitation** : `forgejo admin user create --admin --username polenta-ops …`, puis
  `forgejo admin user generate-access-token --username polenta-ops --scopes all --raw`. Le jeton
  `OPS_TOKEN` va dans `instance.env`. Toutes les opérations suivantes passent par l'API avec ce jeton.
- **Équipes** (`POST /orgs/{org}/teams`, `includes_all_repositories: true`, unités code/issues/…) :

  | Équipe | Permission | Peut créer des repos |
  |---|---|---|
  | `auteurs` | `write` | **oui** (création de projet depuis Polenta, spec §6.2) |
  | `testeurs` | `write` | non |
  | `lecteurs` | `read` | non |

- **Miroir de démo** (option `--no-demo` pour l'ignorer) :
  1. `POST /repos/migrate` (import simple, pas un miroir, `mirror: false`) pour la racine et les 4
     composants (tags compris, pour les pins `v1.1`/`v2.0` et le SHA) ;
  2. réécriture des URLs github.com → instance dans `polenta-repo.yaml` de la racine
     (`PUT /repos/{org}/{racine}/contents/polenta-repo.yaml`, commit de `polenta-ops`) ;
  3. URL de la racine → `demoProjectUrl` du `config.json` généré.
- **Garde mémoire** : `MemAvailable` < 512 Mo → avertissement et confirmation (`--yes` pour forcer).

### 5.6 `polenta-admin.sh` (S1, sauf `access report` au S3)

- `--instance` est facultatif s'il n'y a qu'une instance, et obligatoire sinon (erreur qui liste les
  instances). L'outil lit `OPS_TOKEN` et le domaine dans `instance.env`.
- **`user add`** : `POST /admin/users` (`must_change_password: true`, mot de passe aléatoire de 20
  caractères). Le mot de passe est **affiché** si le SMTP est absent ; sinon, `send_notify: true`.
- **`user import`** : CSV `;`, en-tête obligatoire, et un rapport `OK/ERREUR` par ligne.
- **`user disable`** : `PATCH /admin/users/{login}` `{ prohibit_login: true }`, puis suppression des
  jetons (`GET`/`DELETE /users/{login}/tokens` avec `Sudo: <login>`). *Le comportement exact (un jeton
  existant est-il refusé dès `prohibit_login` ?) est vérifié au §6.* La suppression explicite des
  jetons garantit le critère 19 dans tous les cas.
- **`project create`** :
  1. création du repo ;
  2. contenu initial = mêmes fichiers que `createNewProject` (`.gitignore`, `AGENTS.md`), poussés par
     `POST /repos/{org}/{repo}/contents` ;
  3. rattachement aux équipes données (sinon, les équipes « tous les repos » s'appliquent déjà).
- **`oauth-app create`** : `POST /user/applications/oauth2`, avec `confidential_client: true` pour
  `polenta-web`.
- **`access report`** (S3) :
  - pour chaque repo, `GET /repos/{o}/{r}/collaborators` + `…/collaborators/{u}/permission` ;
  - équipes : `GET /repos/{o}/{r}/teams` + `GET /teams/{id}/members` ;
  - sortie : droit effectif maximal par (utilisateur, repo), en tableau ou `--csv`.
- Chaque commande d'écriture ajoute une ligne `date ISO | instance | commande (sans mot de passe) |
  OK/ERREUR` dans `admin.log`.

### 5.7 Sauvegarde et restauration (S3)

- **Méthode retenue : arrêt court de l'instance, puis copie restic de `data/` + `instance.env`, puis
  redémarrage** (~10 à 30 s par instance, à 02:30). C'est la seule façon d'obtenir une copie SQLite et
  dépôts parfaitement cohérente sans procédure de restauration SQL. On restaure en remettant le
  dossier en place et en lançant le compose.
  - Rejeté : `forgejo dump` comme sauvegarde principale. Sa restauration est manuelle et non
    triviale. Il est en revanche **inclus dans `instance export`**, parce qu'il est le format portable
    vers un autre Forgejo.
- **Dépôt restic** : `s3:<BACKUP_S3_ENDPOINT>/<bucket>/<instance>`, avec un `RESTIC_PASSWORD` propre à
  l'instance.
  - Rétention : `forget --keep-daily 7 --keep-weekly 4 --keep-monthly 12`, `prune` le dimanche.
  - Tags : `nightly`, `pre-update`, `manual`.
- **Ping** : `BACKUP_PING_URL` en cas de succès, `…/fail` en cas d'échec. Une instance en échec
  n'arrête pas la boucle `--all`.
- **`instance restore <nom> --from <id|latest>`** sur un hôte préparé :
  1. `restic restore` dans `instances/<nom>/` (dossier absent, ou `--force` après confirmation) ;
  2. compose up ;
  3. site Caddy et réseau ;
  4. `healthz`.

  `--domain` permet de restaurer sous un autre nom ou domaine (test, ou bascule). `ROOT_URL` est alors
  réécrit.
- **`instance export <nom>`** → `/opt/polenta/exports/<nom>-<date>.tar.gz` + `.sha256`, contenant :
  - `forgejo dump` (format portable) ;
  - `data/` brut ;
  - `instance.env` **expurgé** de `OPS_TOKEN` et des identifiants S3 (`SECRET_KEY` conservé : il est
    nécessaire pour remonter) ;
  - un `LISEZMOI.md` : comment remonter l'instance avec l'image Forgejo officielle à la même version.
- **`instance remove <nom>`** :
  1. `export` obligatoire ;
  2. saisie du nom pour confirmer ;
  3. `compose down -v`, puis déconnexion du réseau de Caddy ;
  4. suppression du site et rechargement de Caddy ;
  5. `rm -rf instances/<nom>`.

  Le dépôt restic n'est pas touché, et le RUNBOOK documente sa purge.

### 5.8 `instance update` avec retour arrière (S3)

1. Sauvegarde taguée `pre-update`.
2. `docker pull <image>:<version>`. Un échec ici (version inexistante) est le cas « version invalide »
   du critère 17 : **rien n'a changé**, un message s'affiche et la commande sort.
3. Arrêt, réécriture de `FORGE_VERSION`, démarrage.
4. `healthz` pendant 180 s au maximum.
5. En cas d'échec : arrêt, puis **restauration du snapshot `pre-update`**. Forgejo migre la base au
   démarrage, donc remettre seulement l'ancienne image ne suffirait pas. Ensuite, ancienne version,
   démarrage et `healthz`. Message d'échec avec le journal.

`--all` traite les instances l'une après l'autre et s'arrête à la première en échec (après son
retour arrière).

### 5.9 fail2ban (S3)

- Jail `sshd` standard.
- Jail `polenta-forgejo` : `logpath` = glob `/opt/polenta/instances/*/data/log/forgejo.log` (relu
  par `polenta-host` après chaque `add`/`remove`), filtre sur `Failed authentication attempt for .* from <HOST>`
  *(ligne exacte vérifiée au §6)*, `action = iptables-allports[chain=DOCKER-USER]`, 10 essais en
  10 min, ban d'1 h.

---

## 6. Point de vérification sur instance réelle (début de S1, résultats consignés dans `GH45-sprint1.md`)

On monte, sur le VPS, une instance Forgejo de test avec le kit en cours de S1, puis une instance Gitea
temporaire (`FORGE_IMAGE=gitea/gitea`). On vérifie et on fige :

1. préfixe des variables d'environnement accepté par chaque image (§5.2) ;
2. scopes minimaux d'un jeton pour : lire/écrire des repos d'organisation, créer un repo dans une
   organisation, lire l'utilisateur et les membres ;
3. réponses de `POST /users/{login}/tokens` :
   - succès ;
   - mauvais mot de passe ;
   - 2FA requise sans code ;
   - code invalide ;
   - compte `prohibit_login` ;

   statut + corps, avec les deux en-têtes OTP. Elles deviennent des fixtures pour les tests unitaires
   de `forgejo.provider` ;
4. endpoint des permissions d'organisation (`can_create_repository`) ;
5. effet de `prohibit_login` sur un jeton existant (git HTTPS et API) ;
6. ligne de journal d'un échec de connexion (filtre fail2ban) ;
7. un jeton OAuth2 Forgejo est-il utilisable pour git HTTPS ? C'est le risque ouvert par GH44 S3
   (`GH44-design.md` §8), mesuré ici pour lui.

Un résultat qui contredit le design est corrigé dans ce fichier, et signalé au STOP HUMAIN du S1.

## 7. Prérequis humains (avant S1)

1. **Accès SSH par clé** à `debian@vps-f515f9c6.vps.ovh.net` (commande donnée dans le chat du
   2026-10-09).
2. **Domaine de test** avec un wildcard : `*.forge.<domaine>` en A → 152.228.240.152, en AAAA →
   2001:41d0:305:2100::1:87cf. `BASE_DOMAIN=forge.<domaine>`.
3. **Stockage S3 de sauvegarde** (avant S3 seulement) : bucket + clés d'accès, chez un autre fournisseur
   que le VPS (analyse §5.5). Par exemple Scaleway Object Storage (Paris).
4. Facultatif : SMTP (sinon les mots de passe temporaires sont affichés) et une URL de supervision
   (healthchecks.io ou équivalent).

## 8. Tests

- **Unitaires (vitest)** : `vitest.config.ts` inclut aussi `src/main/services/**/*.test.ts`. Tests sur :
  - `machine-config` ;
  - `forge-detect` et `forgejo.provider` (serveur HTTP Node local, avec les fixtures du §6 :
    pagination, 409, 401 OTP…) ;
  - `forge-access` (classification + marqueur aller-retour) ;
  - `AuthService` (normalisation des comptes hérités, `persistToken` qui lève une erreur pour une
    forge connue, absence du mot de passe dans les erreurs).
- **Shell** : `shellcheck` sur tous les scripts (installé sur le VPS au S1, et lancé là-bas).
- **Acceptation infra** : `deploy/tests/acceptance.sh <domaine>...`, lancé depuis le poste de dev :
  - HTTPS valide ;
  - redirection vers la connexion sans session ;
  - `/user/sign_up` désactivé ;
  - ports 22/80/443 ouverts, 3000/2222/8080 fermés ;
  - en-têtes de sécurité.
- **Scénarios** : `specs/GH45-tests.md`.

## 9. Fichiers touchés

| Sprint | Créés | Modifiés |
|---|---|---|
| S1 | `deploy/**` (sauf sauvegarde, update, export, fail2ban), `specs/GH45-sprint1.md` | — |
| S2 | `packages/types/src/forge.ts`, `main/services/forge/{remote-guard,forge-http,forge-provider,github.provider,forgejo.provider,forge-detect,forge-access}.ts`, `main/services/machine-config.ts`, `renderer/lib/forgeAccessNotices.ts`, `renderer/components/layout/ForgeAccessBanner.tsx`, `renderer/hooks/useCurrentAccount.ts`, tests | `packages/types/src/{index,app}.ts`, `packages/api-client/src/{ipc-client,types}.ts`, `main/host/{host-context,electron-host}.ts`, `main/services/{auth.service,sync.service,app-settings.service,workspace-tree.service,git-http}.ts`, `main/container.ts`, `main/ipc/{index,channels}.ts`, `mcp-server/*` (HostContext), `web-server/{web-host,channel-policy}.ts`, `renderer/api.ts`, `renderer/routes/{login,index,account}.tsx`, `renderer/components/{AccountMenu,sidebar/AccountPanel,layout/AppLayout}.tsx`, `renderer/hooks/useAutoPull.ts`, `renderer/i18n/locales/{fr,en}.json`, `vitest.config.ts` |
| S3 | `deploy/lib/backup.sh`, fail2ban, `RUNBOOK.md` | `deploy/polenta-host.sh`, `deploy/polenta-admin.sh` |
| S4 | `main/services/forge/forge.service.ts`, `renderer/components/home/{RepoPickerModal,CreateProjectModal}.tsx`, `renderer/components/system/UserFieldInput.tsx`, `renderer/hooks/useRepoAccessDiagnostic.ts` | `main/services/workspace.service.ts`, `main/container.ts`, IPC, api-client, `channel-policy.ts`, `renderer/routes/index.tsx`, `AddDependencyModal.tsx`, `EditView.tsx`, `AppLayout.tsx`, i18n ; SPEC (§10) |

## 10. Mises à jour SPEC prévues (S4)

- `SPEC-ACCOUNTS-AUTH.md` : providers, connexion par mot de passe → jeton, configuration machine,
  compte courant / déconnexion, 401 révoqué.
- `SPEC-ELECTRON-DESKTOP.md` :
  - §2–3 : dossier `services/forge/`, exception à « services à plat » ;
  - §16 : démo selon la configuration machine, nouvelles modales de l'accueil.
- `SPEC-PROJECT-MANAGEMENT.md` §3+ : création sur le serveur.
- `SPEC-FORKS-BRANCHES-BASELINES.md` §1–2 : 401/403 dans Publier et dans l'auto-pull (`accessRevoked`).
- `SPEC-TECH-stack.md` §9 : `autoUpdate` verrouillé par la configuration machine.
- `SPEC-REQ-requirements.md` §3 : champ `user` (autocomplétion).
- `SPEC-TEMPLATES.md` §3 : `AddDependencyModal` (création distante).
- `SPEC-ELECTRON-DESKTOP.md` §22 : message GH30 par provider.

## 11. Décisions et alternatives rejetées

| Décision | Alternative rejetée | Raison |
|---|---|---|
| Kit en Bash + curl/jq | Ansible ; un binaire Go/Node d'administration | Zéro dépendance sur le poste de l'exploitant. Lisible et modifiable par un admin système. |
| Une instance = un projet compose + un réseau dédié | Un seul compose pour toutes les instances | Isolation, arrêt et mise à jour par client sans toucher aux autres (critère 15). |
| Caddy relié à chaud aux réseaux d'instance | `docker compose up` de Caddy à chaque ajout | Pas de coupure des autres clients. |
| SQLite par instance | Postgres partagé ; un Postgres par instance | Partagé = données mêlées ; un par instance = +200 Mo de RAM chacun. SQLite suffit pour moins de 50 utilisateurs par client. |
| Sauvegarde par arrêt court + restic | `forgejo dump` seul | Restauration triviale et exacte. Le dump reste dans l'export portable. |
| Marqueur d'erreur dans le message | Champs d'erreur structurés dans l'IPC | Les deux transports ne gardent que le message. Changer le bridge GH44 et l'IPC Electron touchait 200 channels. |
| `forgeAccessNotices` + enveloppe de l'`invoke` | Gérer le 401 dans chaque appelant | Un seul point, et tous les textes existants deviennent propres sans modification. |
| Création sur le serveur côté main en une seule étape | Enchaîner depuis le renderer | Ordre et gestion d'échec partiel garantis (spec §6.3), réutilisable par le web. |
| Pas de provider `generic` | Interroger des API inconnues | Comportement actuel conservé pour les remotes inconnus. |

---

## 12. Révisions issues du sprint 1 (mesures sur instance réelle, `GH45-sprint1.md`)

Ces révisions **remplacent** les passages concernés plus haut.

### Pour S2 (Polenta)

| Section | Révision |
|---|---|
| §3.3 jeton | Scopes : `write:repository`, `read:user`, **`write:organization`** (`read:organization` ne permet pas de créer un repo d'organisation). En-tête OTP : **`X-Gitea-OTP`** (accepté par Forgejo et Gitea ; `X-Forgejo-OTP` refusé par Gitea). |
| §3.3 / §3.5 erreurs de connexion | Forgejo : 401 avec message distinctif (« password is invalid », « does not exist », « invalid provided OTP », « not allowed login »). Code 2FA demandé si la réponse est « invalid provided OTP » **et** qu'aucun code n'a été envoyé ; « code invalide » si un code a été envoyé. Gitea : 401 générique pour tous ces cas → résultat `invalid-credentials`, et l'écran de connexion d'un serveur Gitea affiche **toujours** un champ « Code 2FA (si activée) » facultatif. La détection Forgejo / Gitea vient de `GET /api/v1/version` (Forgejo répond aussi à `/api/forgejo/v1/version`). |
| §3.3 organisations créables | `GET /users/{login}/orgs/{org}/permissions` → `can_create_repository` seul (ne pas utiliser `can_read`/`can_write`, incohérents sur Gitea). |
| §3.4 accès révoqué | Un **compte désactivé ne produit pas de 401** : l'API répond **403** « prohibited from signing in », et git reçoit **HTTP 200 + page HTML** sur `info/refs` (erreur de protocole côté client). Règle révisée : pour un hôte `forgejo`, tout échec git qui n'est ni réseau ni un 403 d'écriture **déclenche une sonde** `GET /api/v1/user` avec le jeton → 401 = jeton révoqué/expiré, 403 contenant « prohibited » = compte désactivé ; les deux donnent `ForgeAccessError(401)` (même bannière, texte « accès révoqué ou compte désactivé »). Jeton invalide sur git : 401 `text/plain`, classé directement. |
| §3.4 (GH44 S3) | Un jeton OAuth2 Forgejo/Gitea est utilisable pour git HTTPS (et l'API en `token`/`Bearer`) ; il expire (`expires_in`) et un `refresh_token` est fourni. Risque `GH44-design.md` §8 levé. |

### Pour S3 (infra)

| Section | Révision |
|---|---|
| §5.2 | Variables `GITEA__` seules, valeurs entre apostrophes (fait au S1). |
| §5.6 `user disable` | Garantie = `prohibit_login` (vérifié sur les deux forges : jetons existants refusés). Suppression des jetons en plus sur Forgejo (liste admin + `Sudo` = 200) ; impossible sur Gitea (401), sans conséquence. |
| §5.9 fail2ban | Fichier `data/log/gitea.log` (et non `forgejo.log`). Deux filtres : `Failed authentication attempt for .* from <HOST>` (connexion web) et `completed .* for <HOST>:\d+, 401 Unauthorized` (git et API, dont la création de jeton par mot de passe, qui n'émet pas la première ligne). L'IP réelle du client est journalisée (proxy de confiance OK). |
| §5.5 démo | URLs réécrites sur toutes les branches de tous les repos de démo ; tags `RE1`/`RE2` laissés tels quels (limite à documenter dans le RUNBOOK). |
| Hôte partagé | L'hôte de l'éditeur sert aussi `www.esquaresoft.fr` via le Caddy du kit (`etc/sites/_esquaresoft.caddy`, réseau `polenta-edge`). Le kit ne gère que les fichiers `<instance>.caddy` ; les fichiers `_*.caddy` sont des **sites additionnels** à documenter dans le RUNBOOK. Les tests destructifs S3-13/S3-15 (réinstallation de l'OS) doivent être replanifiés (cf. STOP HUMAIN S1). |

### Révisions issues du sprint 2 (mesures sur Forgejo 15.0.9 et Gitea 28.1.0, `GH45-sprint2.md`)

| Section | Révision |
|---|---|
| §3.2 détection | Forge exigeant la connexion : `/api/v1/version` → 403 `{"message":"Only signed in user…"}`, reconnu comme forge ; Forgejo/Gitea par `/api/forgejo/v1/version` (403 vs 404). Redirections GET suivies, base = origine finale, jeton jamais transmis à un autre hôte. |
| §3.5 connexion | Compte neuf : 403 « You must change your password. Change it at: <url> » → résultat `password-change-required`. Le desktop n'ouvre que l'URL annoncée par la forge lors de ce refus (`auth:open-password-change` sans argument). |
| §3.3 jeton | Nom `polenta-<poste>-<AAAAMMJJ-HHmm>-<aléa>` : deux connexions dans la même minute faisaient refuser le second jeton. |
| §3.4 droits | Push d'un lecteur ou sur branche protégée : HTTP 200 puis « pre-receive hook declined » (pas de 403) → `writeDeniedError`. La sonde d'API n'est faite que pour une réponse non-git (page HTML) ou un 403. L'issue d'accès porte `serverUrl` (bannière). |
| §3.8 renderer | `renderer/api.ts` nettoie aussi le champ `error` des résultats (`parse-error`). |
| §3.5 jetons hérités | Pas de `migrateLegacyBareTokens` : compatibilité par lecture (`hasAnyAccount`, `projectUsername`, `logout`). |
| GitHub sur le web | Les URLs fixes de l'API GitHub ne passent pas par le garde des hôtes git (pas d'entrée utilisateur, pas de risque SSRF). |

---

## 13. Sprint S2b — configuration centralisée par équipe, lien d'invitation, tests d'interface

Entrée : spec §3bis / §3ter (décisions du 2026-10-10). S'intercale entre S2 et S3/S4.

### 13.1 Kit (`deploy/`)

- `instance add` → nouvelle étape idempotente `ensure_config_repo` :
  - repo privé `<org>/polenta-config` avec un `config.yaml` modèle commenté ;
  - protection de la branche `main` (`POST /repos/{org}/polenta-config/branch_protections` :
    push réservé à l'équipe `Owners`).

  Les équipes « tous les repos » y ont donc la lecture et, malgré leur droit d'écriture, ne
  peuvent pas pousser.
- Nouvelle commande **`polenta-host instance sync <nom>`** : rejoue les étapes idempotentes après
  installation (organisation, équipes, repo de config) sur une instance existante (`acme`, `globex`,
  et les instances créées avec une version antérieure du kit).
- `polenta-admin user add|import` : affiche le lien `polenta://connect?server=…&login=…` et un
  message d'invitation prêt à copier. Le lien de téléchargement vient de `POLENTA_DOWNLOAD_URL`
  (`host.env`, facultatif).

### 13.2 Process main

| Fichier | Rôle |
|---|---|
| `services/forge/team-config.ts` (nouveau, pur) | `parseTeamConfig(yaml)` → config validée (clés inconnues ou invalides ignorées et listées) ; `resolveTeamConfig(config, teams)` → `{ projects, updates, preferences }` selon §3bis-4. |
| `services/forge-config.service.ts` (nouveau) | Pour le compte courant : organisations (`GET /user/orgs`), équipes (`GET /user/teams`), lecture de `GET /repos/{org}/polenta-config/raw/config.yaml` (première organisation qui en a un), résolution, cache `userData/forge-config.json` (dernière version + date + erreur). Rafraîchi à la connexion, au démarrage et toutes les 30 min. `effective()` est synchrone, depuis le cache. |
| `services/app-settings.service.ts` | Verrou des mises à jour si machine `autoUpdate: false` **ou** `updates: managed` effectif. |
| `services/update.service.ts` | La décision de vérifier est relue **au moment** de la vérification (la config de la forge peut arriver après le démarrage). |
| `ipc/pref.handlers.ts` | `pref:get-field-visibility` : sans choix personnel pour ce type, renvoie le défaut de la config (vues absentes → défaut Polenta). |
| `host/invite-link.ts` (nouveau, pur) | `parseInviteLink(url)` → `{ server, login }` ou `null` (schéma `polenta:`, hôte `connect`, serveur http(s) uniquement, identifiant `[A-Za-z0-9._-]`). |
| `index.ts` (desktop) | `requestSingleInstanceLock`, `setAsDefaultProtocolClient('polenta')`, lien reçu au lancement (`argv`), par `second-instance` (Windows/Linux) ou `open-url` (macOS) → invitation en attente + événement `app:invite` ; fenêtre ramenée au premier plan. |
| `electron-builder.yml` | `protocols: [{ name: Polenta, schemes: [polenta] }]` (enregistrement par l'installateur NSIS). |
| IPC | `app:get-team-config` (config effective + source + erreur), `app:take-pending-invite` (desktop), événement `app:invite`. |

### 13.3 Renderer

- Écran de connexion :
  - paramètres `server` et `login` (lien d'invitation) ;
  - « Autre… » devient « Serveur de votre entreprise… » ;
  - une adresse saisie sans `https://` est complétée.
- `hooks/useInviteLinks.ts` (dans `__root`) : prend l'invitation en attente au démarrage, écoute
  `app:invite`, puis ouvre la connexion pré-remplie. Si le compte courant est déjà sur ce serveur
  avec cet identifiant, il affiche l'accueil.
- `hooks/useTeamConfig.ts` :
  - langue et thème par défaut appliqués **sans être enregistrés**, et seulement sans choix
    personnel (`localStorage`) ;
  - vue d'ouverture d'un projet (`projectHome`) via un utilitaire `projectHomeRoute(projectId)`,
    qui remplace les navigations codées en dur vers `/dashboard`.
- Accueil : section « Projets de votre équipe ». Seuls les repos accessibles sont affichés (le main
  vérifie l'accès avec le jeton). Un clic ouvre le projet s'il est déjà sur le poste (même URL
  d'`origin`), sinon le clone puis l'ouvre.
- Panneau Compte : « Configuration du serveur : appliquée (équipes : …) » ou « ignorée : … ».

### 13.4 Tests d'interface automatisés (desktop)

- `apps/desktop/e2e-desktop/` : Playwright `_electron.launch` sur le build (`out/main`).
- **Isolation** : `POLENTA_USER_DATA_DIR` (`app.setPath('userData')` avant `ready`) et
  `POLENTA_KEYTAR_SERVICE` (nom de service keytar dédié aux tests). Ce sont deux variables
  d'environnement de test qui ne modifient pas le comportement normal. Les comptes et jetons
  personnels du poste ne sont jamais touchés.
- Contre la forge de test `acme` (comptes `itest-*`, actions d'admin par SSH). Scénarios :
  - connexion par lien d'invitation ;
  - connexion par mot de passe et par 2FA ;
  - compte neuf ;
  - bannière d'accès révoqué puis « Se reconnecter » ;
  - déconnexion ;
  - « Projets de votre équipe » et vue d'ouverture selon l'équipe ;
  - case des mises à jour verrouillée pour un lecteur ;
  - langue par défaut sans choix personnel ;
  - non-régression sans compte forge (écran GitHub inchangé).

### 13.5 Ordre

S2b est commité en un sprint. Les sprints S3 (infra exploitation) et S4 (P1) restent inchangés. Le
S4 réutilisera `forge-config.service` (organisation courante) et la vérification d'accès aux repos.

### 13.6 Révisions issues du sprint S2b (`GH45-sprint2b.md`)

| Point | Révision |
|---|---|
| `projectHome` | `dashboard | requirements | tests | campaigns` (panneaux existants). |
| Lien d'invitation | `https` uniquement ; une politique DSI (serveur imposé) l'emporte, et le lien est alors ignoré avec un message. Protocole enregistré par l'application installée seulement. |
| Rafraîchissement | Déclenché par le renderer (démarrage, connexion, 30 min, déconnexion). |
| Organisation | La plus ancienne qui a une configuration ; le kit interdit aux utilisateurs de créer des organisations. |
| Champs visibles | Résolus type par type (première équipe du fichier qui règle un type). |
| Thème | Choix explicite sous `polenta:theme-choice` (l'ancienne clé était écrite automatiquement). |
| Tests d'interface | `apps/desktop/e2e-desktop/` (Playwright Electron), lancé par `pnpm test:e2e:desktop` avec `POLENTA_E2E_SSH`. |


## 14. Révisions issues du sprint S3 (`GH45-sprint3.md`)

| Point | Révision |
|---|---|
| §5.7 restauration | Extraction dans un dossier temporaire, puis arrêt de l'instance remplacée seulement si l'extraction a réussi. `LAST_BACKUP` prend la date du snapshot, et le journal de la forge est renommé. Nouvelles commandes : `instance snapshots` et `instance keys`. `instance add` fait la première sauvegarde. |
| §5.7 nocturne | `backup-cron` (cron 02:30) : `restic unlock` (verrous périmés) avant `forget`. |
| §5.7 export | `forge.env` au format `docker run --env-file`. Une instance arrêtée est remise à l'arrêt après l'export. Le port du `LISEZMOI` est lié à `127.0.0.1`. |
| §5.8 update | `pull` **avant** la sauvegarde `pre-update`. Crochet de test `POLENTA_TEST_FAIL_UPDATE`. |
| §5.9 fail2ban | Jail `polenta-forge` : `logpath` = liste explicite des `data/log/gitea.log` (réécrite à chaque add/restore/remove). Échecs web/git et créations de jeton refusées sont comptés. `banaction = iptables-allports` et `chain = DOCKER-USER` sont deux clés séparées. `datepattern` explicite. `ignoreip` = `ADMIN_IPS` (sshd aussi). |
| Console | `kernel.printk = 3 4 1 3` (console KVM utilisable). |
| Kit | `ensure_config_repo` : un repo vide renvoie `200 []` → on vérifie que la réponse est bien un fichier. |
