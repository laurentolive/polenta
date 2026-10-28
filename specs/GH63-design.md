# GH63 — Design : administration du serveur depuis Polenta

Références : `specs/GH63.md` (validée le 2026-10-12, défauts des Questions ouvertes confirmés),
`specs/GH44-design.md` §4.3, §5 ; `specs/GH45-design.md` §5 ; issues #61 (`CADDY_MODE`,
`EDGE_NETWORK`, `CADDY_SITES_DIR`) et #62 (`HARDEN_HOST`, `HOST_MODULES`, `status --json`).

## 1. Vue d'ensemble

Cinq éléments, du plus bas au plus haut :

```
 navigateur ─HTTPS─> Caddy ─> polenta-web (instance X) ─ polenta-admin-net ─> polenta-admin (API interne)
   renderer: page Administration        web-server: /admin/api/*              │ jobs, audit, filtre secrets
   (isWeb && capabilities.serverAdmin)  droit lu dans la forge, CSRF          ├─ docker CLI ─> polenta-docker-proxy ─> docker.sock
                                                                              ├─ volume /opt/polenta + scripts du kit (deploy/)
                                                                              └─ socket Unix ─> polenta-host-agent (systemd, hôte)
```

Principe directeur : **les scripts du kit sont la seule implémentation** ; `polenta-admin` (service)
valide, met en file, lance un script, relaie journal et résultat. Le web-server ne parle jamais à
Docker, à `/opt/polenta` ni à l'agent : uniquement à l'API interne.

Nommage : le service s'appelle `polenta-admin` (compose) ; le script existant `deploy/polenta-admin.sh`
(opérations dans une instance) garde son nom — dans ce document, « le service » = conteneur,
« `polenta-admin.sh` » = le script.

## 2. Décisions et alternatives rejetées

| # | Décision | Alternative rejetée et raison |
|---|---|---|
| D1 | Service Node (Fastify) dans le monorepo : `apps/admin-service/` (paquet `@polenta/admin-service`), image `deploy/admin/Dockerfile` | Bash/CGI : pas de SSE, pas de tests unitaires sérieux ; Go : nouvelle chaîne d'outils. Node/Fastify = pile du web-server, types partagés. |
| D2 | Proxy Docker **maison** `polenta-docker-proxy` (petit service Node, même paquet, filtre méthode + chemin **+ corps** des créations) | `tecnativa/docker-socket-proxy` : filtre par famille de points d'accès seulement, laisse passer `POST /containers/create` avec `Privileged`/`Binds` arbitraires : ne satisfait pas le critère 3. |
| D3 | Le service parle au proxy via la CLI `docker`/`docker compose` (`DOCKER_HOST=tcp://polenta-docker-proxy:2375`), ce que les scripts utilisent déjà | Appels REST directs depuis Node : réimplémenterait les scripts. |
| D4 | Droit « propriétaire » = `GET /api/v1/users/{login}/orgs/{org}/permissions` avec le jeton de l'utilisateur, champ **`is_owner` seul** (pas `can_create_repository`, que `forgejo.provider.ts` accepte pour un autre usage) | Réutiliser `ForgeProvider.canCreateRepo` : donnerait l'accès aux simples créateurs de dépôts. Nouvelle fonction `isOrgOwner` dans le provider. |
| D5 | Jeton de service **par instance**, haché (scrypt) côté service, en clair `0600` dans `web.env` (`ADMIN_SERVICE_TOKEN`) | Jeton unique pour tout l'hôte : un `polenta-web` compromis vaudrait hôte. |
| D6 | Jobs persistés en **fichiers** (`/opt/polenta/admin/jobs/<id>/{job.json,log.ndjson,result.json}`) | SQLite : binaire natif de plus, aucun besoin de requête. |
| D7 | Verrou unique `/opt/polenta/.lock` pris par `flock` **dans les scripts** (donc SSH inclus) ; le service lit le propriétaire du verrou (`.lock.owner`, JSON) pour le 409 | Verrou applicatif dans le service : ne protégerait pas contre SSH. |
| D8 | Résultats structurés : le script écrit le JSON de résultat sur le descripteur **3** (`--json`) ; stdout/stderr = journal humain. Mots de passe temporaires et clés restic uniquement dans ce résultat | Analyser la sortie texte : fragile. |
| D9 | Transport interne HTTP simple sur `polenta-admin-net` (Q10) | TLS mutuel : coût d'exploitation disproportionné. |
| D10 | Conteneur `polenta-admin` **root dans le conteneur, capacités limitées** : `cap_drop: [ALL]` puis `cap_add: [CHOWN, DAC_OVERRIDE, DAC_READ_SEARCH, FOWNER]`, `no-new-privileges`, système de fichiers en lecture seule, un seul montage `/opt/polenta`, ni socket Docker ni port. Critère 4 = « pas de root **hôte** ». (Révisé le 2026-10-28 après le spike R1, décision de Benoit.) | uid 1500 non root : spike R1 négatif (état du kit root 0600, données de la forge 1000:1000 illisibles) ; exigerait une refonte des droits de fichiers du kit. `userns-remap` : réglage global du démon, inacceptable sur un hôte partagé. |
| D11 | Versions de forge proposées : fichier `deploy/forge-versions.json` livré avec le kit + saisie libre validée par `docker pull` (Q12) | `host.env` : oblige l'exploitant à maintenir la liste. |
| D12 | Vérification DNS : commande `polenta-host dns check <domaine> --json`, résolveur public interrogé par `dig @1.1.1.1 +short` (lecture seule) | Appel d'API DNS fournisseur : hors scope. |
| D13 | Notifications de suivi par **sondage** (`GET jobs/{id}?since=<offset>`, 1 s) avec SSE en option si le proxy Caddy le permet ; le sondage seul reste correct | SSE seul : la reprise après coupure (mise à jour de la forge) est plus simple avec offset. |
| D14 | Pas de nouveau channel `/rpc` : `/admin/api/*` est une route propre, hors `channel-policy.ts` (critère 19) | Faire passer l'admin par `ChannelPolicy` : mélange deux modèles de droit. |

## 3. Fichiers à créer ou modifier

### 3.1 Kit `deploy/` (Sprint 1, puis intégrations S2/S3)

| Fichier | Changement |
|---|---|
| `deploy/lib/common.sh` | Options globales `--non-interactive`, `--json` ; `emit_result <json>` (fd 3, ou fichier `POLENTA_RESULT_FILE`) ; `die <code> <msg>` avec codes par cause ; `with_lock` (`flock -n 9` sur `/opt/polenta/.lock`, écrit `.lock.owner` : `{op, actor, origin: ssh\|ui, pid, since}`) ; `confirm_arg` (la confirmation est donnée par `--confirm <valeur>`, jamais `read` en `--non-interactive`) ; `redact` (masque `password|secret|token|key` dans le journal) ; `require_operator` remplace `require_root` quand `POLENTA_ADMIN_MODE=1` (uid du conteneur, `POLENTA_OPERATOR_UID`, 0 par défaut — D10). |
| `deploy/polenta-host.sh` | Chaque commande mutante passe par `with_lock`. Nouvelles commandes : `status --json` (modules actifs de #62, Caddy, versions), `instance list --json`, `instance snapshots --json`, `dns check <domaine> --json` (extrait `check_dns_points_here`), `instance export --json`, `instance restore` : étape `pre-restore`, `instance backup --tag`, `s3-key rotate` (§3.7 de la spec), `s3-purge` (§3.8), `exports list|delete`, `instance remove --confirm <nom>`. Mots de passe temporaires hors journal (fd 3). `instance add` crée `polenta-ops` + son jeton **et** le jeton de service §5.2 (`ADMIN_SERVICE_TOKEN`, haché dans `/opt/polenta/admin/service-tokens.json`). `host.env` : `ADMIN_UI`, `ADMIN_INSTANCE`, `ADMIN_AGENT_SOCKET`. `setup` reste rejouable ; nouveau module `admin` (compose `polenta-admin` + proxy + agent) activable. |
| `deploy/polenta-admin.sh` | `--non-interactive`, `--json`, verrou, codes de sortie ; nouvelles commandes `user import --preview --json`, `access-report --json`, `invite <login> --json`. |
| `deploy/lib/backup.sh` | `--tag`, `restic check`, utilisation de la clé de purge par `RESTIC_*` passées par fd (`/dev/fd/N`), jamais en argument. |
| `deploy/admin/docker-compose.yml` | Projet `polenta-admin` : services `polenta-admin`, `polenta-docker-proxy`, réseaux `polenta-admin-net` (interne aux deux services + `polenta-web` des instances) et `docker-proxy-net` (interne, seulement service + proxy). Aucun `ports:`. |
| `deploy/admin/Dockerfile` | Image du service : `node:22-alpine` + bash, restic, jq, curl, bind-tools, git, docker-cli, docker-cli-compose ; copie `deploy/` en `/opt/polenta-kit` ; outils GNU (sed, find, grep) ; root, capacités fixées par le compose (D10). |
| `deploy/admin/host-agent/` | `polenta-host-agent.js` (Node, sans dépendance), `polenta-host-agent.service` (systemd : `User=root`, `ProtectSystem=strict`, `ReadWritePaths=/opt/polenta /run/polenta`, `PrivateTmp`, `NoNewPrivileges`, `RestrictAddressFamilies=AF_UNIX`), `install-agent.sh`. |
| `deploy/instance/docker-compose.yml` | `polenta-web` rejoint `polenta-admin-net` si `ADMIN_UI=on` ; variables `ADMIN_URL`, `ADMIN_SERVICE_TOKEN` dans `web.env`. |
| `deploy/install.sh` (nouveau) | Première installation à commande unique (Docker, kit, agent, service). Hors interface. |
| `deploy/forge-versions.json` (nouveau) | Versions épinglées proposées. |
| `deploy/tests/acceptance.sh` | Inchangé pour l'existant ; nouvelles fonctions `scenario_json`, `scenario_lock`, `scenario_noninteractive`, `scenario_exitcodes` (S1) puis `scenario_admin_*` (S2-S5). |
| `deploy/tests/lib-*.test.sh` (nouveau) | Tests unitaires bash (bats-less) de `common.sh` : verrou, rédaction, codes. |
| `deploy/RUNBOOK.md` | Nouvelle section « Administration depuis Polenta » (A16) : installation service + agent, tableau opération ↔ commande SSH, droits, audit, procédure sans agent, désinstallation. |

### 3.2 Service `apps/admin-service/` (nouveau, Sprint 2)

```
apps/admin-service/
  package.json, tsconfig.json, vitest.config.ts
  src/
    index.ts                 démarrage (port 8787, écoute sur l'interface admin-net seulement)
    config.ts                lecture de l'environnement
    app.ts                   Fastify : routes, authn, erreurs
    auth/service-token.ts    jetons de service hachés, comparaison à temps constant, limiteur de débit
    auth/forge-owner.ts      revérification is_owner auprès de la forge (cache 60 s, jamais pour une destructive)
    auth/levels.ts           calcul du niveau (instance | host) et contrôle de portée (jeton ↔ instance cible)
    jobs/registry.ts         catalogue des opérations (§6.3) : paramètres, niveau, destructive, annulable, agent
    jobs/runner.ts           lancement de script (spawn, fd 3), annulation (SIGTERM), état, reprise au démarrage
    jobs/store.ts            persistance fichiers, rétention, `interrupted`
    jobs/lock.ts             lecture de `.lock.owner`, 409
    audit.ts                 ajout seul `audit.log` (JSONL, 0600), export CSV, filtre par instance
    secrets/redact.ts        filtre du journal (valeurs du travail + motifs)
    secrets/one-time.ts      résultats à usage unique (supprimés à la lecture ou après 10 min)
    agent-client.ts          client du socket Unix de l'agent
    docker-proxy/            `polenta-docker-proxy` (point d'entrée distinct, même paquet)
      server.ts, policy.ts   allowlist méthode+chemin, inspection du corps de `containers/create`
    validators.ts            motifs stricts (nom d'instance, domaine, IP, version, login)
  test/                      vitest
```

### 3.3 Web-server (Sprint 4)

| Fichier | Changement |
|---|---|
| `apps/desktop/src/web-server/config.ts` | `admin: { url, serviceToken } \| null` (variables `POLENTA_ADMIN_URL`, `POLENTA_ADMIN_SERVICE_TOKEN`) ; refus de `adminDev` avec `NODE_ENV=production`. |
| `apps/desktop/src/web-server/admin/admin-routes.ts` (nouveau) | Enregistre `/admin/api/*` (§5). Chaque route : `requireSession(req, reply, mutating)` + refus `session.print` et mode `dev` (sauf `POLENTA_WEB_ADMIN_DEV=1` hors production) + calcul du niveau + proxy vers le service avec `Authorization: Bearer <service>` et `X-Polenta-Forge-Token`. |
| `apps/desktop/src/web-server/admin/admin-client.ts` (nouveau) | Client HTTP du service interne (timeout, aucune fuite d'en-tête dans les erreurs). |
| `apps/desktop/src/web-server/admin/owner-level.ts` (nouveau) | Niveau pour la session (cache 60 s) ; appelle `forgejoProvider.isOrgOwner`. |
| `apps/desktop/src/web-server/app.ts` | `await registerAdminRoutes(app, deps)` ; `/admin/*` répond 404 si `admin === null`. Aucune modification de `channel-policy.ts` (un test garantit l'absence de channel `admin:*`). |
| `apps/desktop/src/web-server/session.ts` | Inchangé (pas de rôle stocké : le droit est lu dans la forge). |
| `apps/desktop/src/main/services/forge/forgejo.provider.ts` + `forge-provider.ts` | `isOrgOwner(login, org, token)` (`is_owner` seul). |
| `packages/types/src/admin.ts` (nouveau) + export | Types partagés (§4). |

### 3.4 Renderer (Sprint 4 et 5)

| Fichier | Changement |
|---|---|
| `renderer/platform.ts` | `capabilities.serverAdmin: isWeb` ; la visibilité réelle vient de `GET /admin/api/me`. |
| `renderer/components/AccountMenu.tsx` | Entrée « Administration » seulement si `serverAdmin` et `me.level`. |
| `renderer/components/admin/` (nouveau) | `AdminPage.tsx`, `InstancesPanel`, `BackupsPanel`, `UpdatePanel`, `HostPanel`, `UsersPanel`, `JournalPanel`, `JobBanner`, `JobView` (journal, `aria-live`), `ConfirmByName` (saisie du nom), `OneTimeSecret` (affichage unique masqué, copie, téléchargement), `DnsCheck`. |
| `renderer/hooks/useAdmin.ts` (nouveau) | Client `/admin/api`, sondage des travaux, bandeau global. |
| `renderer/i18n/{fr,en}` | Clés `admin.*`. |
| `renderer/components/layout/*` | Montage de `JobBanner` ; route de la page Administration. |
| `e2e-web/gh63-*.spec.ts` (nouveau) | S4 et S5 (service admin simulé par un faux `polenta-admin` en dev). |

## 4. Types partagés (`packages/types/src/admin.ts`)

```ts
export type AdminLevel = 'instance' | 'host'
export interface AdminMe { level: AdminLevel; instance: string; hostName: string; agent: AgentState; modules: HostModules; caddyMode: 'managed' | 'external' }
export type AgentState = 'up' | 'absent'
export type HostModules = Record<'docker'|'firewall'|'fail2ban'|'unattended'|'ssh-hardening'|'backup-cron'|'fail2ban-forge', boolean>

export type JobState = 'queued' | 'running' | 'rebooting' | 'succeeded' | 'failed' | 'rolled-back' | 'cancelled' | 'interrupted'
export type OperationId =
  | 'instance.list' | 'instance.add' | 'instance.stop' | 'instance.start' | 'instance.sync' | 'instance.remove'
  | 'forge.update' | 'backup.run' | 'backup.list' | 'backup.keys' | 'backup.restore'
  | 'export.run' | 'export.delete' | 'web.enable' | 'web.disable' | 'dns.check'
  | 'host.setup' | 'fail2ban.unban' | 'fail2ban.status' | 'host.reboot' | 's3.rotate' | 's3.purge'
  | 'users.import' | 'users.accessReport' | 'users.invite'

export interface JobCreate { operation: OperationId; instance?: string; params: Record<string, unknown>; confirm?: string }
export interface JobView {
  id: string; operation: OperationId; instance: string | null
  actor: { login: string; instance: string; ip?: string }
  origin: 'ui' | 'ssh'
  state: JobState; createdAt: string; startedAt?: string; endedAt?: string
  steps: { name: string; state: 'pending'|'running'|'done'|'failed' }[]
  cancellable: boolean; logSize: number
  result?: Record<string, unknown>   // sans secret ; `oneTime: true` si une valeur à usage unique attend
  error?: { code: number; cause: string; message: string }
}
export interface JobLogChunk { offset: number; lines: string[]; eof: boolean }
export interface AuditLine { ts: string; actor: string; actorInstance: string; ip?: string; origin: 'ui'|'ssh'; operation: string; target: string; params: Record<string, unknown>; jobId?: string; result: 'accepted'|'succeeded'|'failed'|'rolled-back'|'cancelled'|'refused' }
export interface ApiError { ok: false; error: { code: string; message: string; runningJob?: { id: string; operation: string; actor: string; since: string } } }
```

## 5. API

### 5.1 Routes du web-server `/admin/api/*` (toutes : session + CSRF sur mutation + niveau)

| Méthode et chemin | Rôle |
|---|---|
| `GET /me` | niveau, agent, modules, Caddy ; 404 si `admin === null`, 403 si pas propriétaire. |
| `GET /instances` · `GET /instances/:name` | liste (hôte) ou sa ligne (instance). |
| `POST /jobs` | crée un travail (`JobCreate`) → `202 {jobId}` ; 400 validation, 403 droit, 409 verrou, 422 pré-condition. |
| `GET /jobs?state=&instance=` · `GET /jobs/:id` · `GET /jobs/:id/log?offset=` | suivi. |
| `POST /jobs/:id/cancel` | seulement si `cancellable`. |
| `GET /jobs/:id/secret` | résultat à usage unique (mot de passe temporaire, clé restic) : supprimé à la lecture ; `Cache-Control: no-store`. |
| `GET /audit?from=&instance=` · `GET /audit.csv` | audit (filtré à l'instance au niveau instance). |
| `GET /backups/:instance` | instantanés (lecture, sans verrou). |
| `GET /dns?domain=` | vérification DNS. |
| `POST /users/import/preview` (multipart ≤ 5 Mo) · `POST /users/import` · `GET /users/access-report(.csv)` · `POST /users/invite` | S5. |
| `GET /exports` · `GET /exports/:name/download` (jeton court lié à la session) · `DELETE /exports/:name` | S5. |
| `GET /host/fail2ban` · `GET /host/s3` (endpoint, bucket, 4 derniers caractères, date) | S4/S5. |

Toutes les opérations de lecture non listées passent par `POST /jobs` avec `readonly` côté registre
(sans verrou, exécutées en direct, traces d'audit conservées).

### 5.2 API interne du service (mêmes ressources, port 8787)

En-têtes : `Authorization: Bearer <service>` (obligatoire), `X-Polenta-Forge-Token` (obligatoire sauf
`/healthz`), `X-Polenta-Actor` (login annoncé, **revérifié**), `X-Polenta-Origin-Instance`,
`X-Polenta-Client-Ip`. Contrôle, dans l'ordre : (1) jeton de service reconnu → instance d'origine ;
(2) cible ⊆ instance d'origine, sauf jeton de `ADMIN_INSTANCE` ; (3) `is_owner` revérifié auprès de la
forge **de l'instance d'origine** avec le jeton utilisateur ; (4) niveau hôte = (1)+(3) sur
`ADMIN_INSTANCE`. Échec = 401/403 + ligne d'audit `refused`. Le jeton utilisateur n'est jamais
persisté, journalisé ni renvoyé ; il est retiré des objets d'erreur et des traces.

### 5.3 Catalogue des opérations (`jobs/registry.ts`)

Chaque entrée : commande du kit (tableau argv codé en dur, jamais de chaîne shell), schéma de paramètres
(motif strict), niveau minimal, `destructive`, `confirm` attendu (nom d'instance ou nom d'hôte), `cancellable`,
`agent`, `mutating`, secrets du travail à masquer. Correspondance avec le §4 de la spec :

| Opération | Commande du kit | Annulable | Destructive (confirmation) | Verrou |
|---|---|---|---|---|
| `instance.list`/`backup.list`/`dns.check`/`users.accessReport` | `polenta-host instance list --json` / `instance snapshots --json` / `dns check --json` / `polenta-admin.sh access-report --json` | oui | non | non |
| `instance.add` | `instance add … --non-interactive --json` | non | non | oui |
| `instance.stop|start|sync` | `instance stop|start|sync` | non | arrêt : confirmation simple | oui |
| `instance.remove` | `instance remove <n> --confirm <n>` (export préalable obligatoire vérifié par le script) | non | nom | oui |
| `forge.update` | `instance update <n> --version <v> --non-interactive --json` | non | non | oui |
| `backup.run` | `instance backup <n|--all> --tag manual` | oui | non | oui |
| `backup.keys` | `instance keys <n> --json` (clé via fd 3 → `/jobs/:id/secret`) | — | sensible : nom | non |
| `backup.restore` | `instance restore … --confirm <cible>` | non | nom cible | oui |
| `export.run` / `export.delete` | `instance export --json` / `exports delete` | oui / — | suppression : simple | oui |
| `web.enable|disable` | `instance web enable|disable` | non | non | oui |
| `host.setup` | agent `host.setup` | non | confirmation SSH explicite si `ssh-hardening` actif | oui |
| `fail2ban.unban` | agent `fail2ban.unban <ip>` | oui | non | oui |
| `host.reboot` | agent `host.reboot` | non | nom d'hôte | oui |
| `s3.rotate` | `s3-key rotate` (secret par fd) | non (après étape 2) | non (retour arrière) | oui |
| `s3.purge` | `s3-purge <n> --confirm-phrase …` (clé de purge par fd) | non | nom + phrase, deux temps | oui |
| `users.import` / `users.invite` | `polenta-admin.sh user import --json` / `invite --json` | non | non | oui / non |

### 5.4 Format d'un travail sur disque

`/opt/polenta/admin/jobs/<id>/` (`id` = ULID) : `job.json` (`JobView` + `argv` expurgé, `pid`,
`secretsHint` : empreintes, jamais valeurs), `log.ndjson` (une ligne `{t, s: 'out'|'err', m}` filtrée
**avant** écriture), `result.json` (résultat sans secret), `secret.json` (`0600`, valeur à usage
unique, supprimé à la consultation ou 10 min). Écriture atomique (`rename`). Au démarrage du service,
tout travail `running` dont le `pid` a disparu ou dont le `boot_id` (`/proc/sys/kernel/random/boot_id`)
diffère passe à `interrupted` et le verrou périmé est levé. Rétention : purge quotidienne des travaux
> 90 jours **et** au-delà du 200e (le plus long des deux) ; `audit.log` jamais purgé.

### 5.5 Codes de sortie des scripts (S1)

| Code | Cause | Code | Cause |
|---|---|---|---|
| 0 | succès | 12 | instance introuvable |
| 1 | erreur générale | 13 | instance déjà existante |
| 2 | usage / paramètre invalide | 14 | version de forge introuvable |
| 3 | confirmation absente ou incorrecte | 15 | DNS ne résout pas / pointe ailleurs |
| 4 | droit insuffisant (non root/opérateur) | 16 | stockage S3 inaccessible / clé invalide |
| 5 | verrou pris (`.lock.owner` affiché) | 17 | mise à jour échouée, **retour arrière effectué** |
| 6 | pré-condition (mémoire, export manquant, module absent) | 18 | opération refusée (instance d'exploitation) |
| 10 | annulé (SIGTERM) | 19 | vérification de sauvegarde échouée (retour clé précédente) |

Le service convertit : 17 et 19 → `rolled-back`, 10 → `cancelled`, 5 → 409, autres ≠ 0 → `failed`.

### 5.6 Actions de l'agent hôte (socket `/run/polenta/agent.sock`, `0660 root:polenta-agent`)

Protocole : JSON délimité par lignes, une requête `{id, action, params}`, une réponse `{id, ok, result|error}`.
Liste **fermée** (table `ACTIONS` dans `polenta-host-agent.js`, motif de validation par paramètre) :

| Action | Paramètres | Commande codée en dur |
|---|---|---|
| `host.status` | — | `polenta-host status --json` |
| `host.setup` | `{sshHardeningConfirmed: boolean}` | `polenta-host setup --non-interactive --json` |
| `host.reboot` | — | écrit la trace du job puis `systemctl reboot` |
| `fail2ban.status` | — | `fail2ban-client status` (prisons `polenta-forge`, `sshd`) |
| `fail2ban.unban` | `{ip}` IPv4/IPv6 strict (`net.isIP`) | `fail2ban-client set <prison> unbanip <ip>` (chaque prison) |
| `firewall.status` | — | `ufw status verbose` |

Toute action inconnue, tout paramètre en trop ou mal formé : `{ok:false, error:'invalid'}`, jamais exécuté.
Aucune interpolation shell (`execFile`). Délai maximal par action, journal d'agent dans `host.log`.
Le client côté service n'a **aucun** autre canal vers l'hôte. L'agent déclare ses modules
(`fail2ban`, `firewall` actifs ?) pour griser les actions (#62).

## 6. Composition compose, réseau, sécurité

### 6.1 Compose `deploy/admin/docker-compose.yml`

```yaml
name: polenta-admin
services:
  polenta-docker-proxy:
    image: ${POLENTA_ADMIN_IMAGE}
    command: ["node", "/app/dist/docker-proxy/server.js"]
    volumes: ["/var/run/docker.sock:/var/run/docker.sock:ro"]   # seul conteneur qui le monte
    networks: [docker-proxy-net]
    read_only: true
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
  polenta-admin:
    image: ${POLENTA_ADMIN_IMAGE}
    user: "0:0"                     # D10 révisé : root conteneur, capacités de fichier seulement
    cap_add: [CHOWN, DAC_OVERRIDE, DAC_READ_SEARCH, FOWNER]
    environment: { DOCKER_HOST: tcp://polenta-docker-proxy:2375, ADMIN_INSTANCE: ${ADMIN_INSTANCE}, … }
    volumes:
      - /opt/polenta:/opt/polenta
      - /run/polenta/agent.sock:/run/polenta/agent.sock
    networks: [polenta-admin-net, docker-proxy-net]
    read_only: true
    tmpfs: ["/tmp"]
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    group_add: ["${AGENT_GID}"]
networks:
  polenta-admin-net: { name: polenta-admin-net, internal: true }
  docker-proxy-net:  { internal: true }
```

Aucun `ports:`, aucun label Caddy. Si `CADDY_MODE=external`, le service ne rejoint pas `EDGE_NETWORK` ;
`polenta-web` rejoint `polenta-admin-net` en plus de `EDGE_NETWORK`.

### 6.2 Politique du proxy Docker

Autorisé (méthode + motif de chemin, versions d'API préfixées acceptées) : `GET /_ping`, `/version`,
`/containers/json`, `/containers/{name}/{json,logs,top}`, `POST /containers/{name}/{start,stop,restart,kill,wait}`,
`POST /containers/{name}/exec` + `/exec/{id}/{start,json}` (conteneurs `polenta-*`, `forgejo-*`, `caddy`
du kit seulement), `GET /networks`, `GET /networks/{name}`, `POST /networks/create` et
`/networks/{name}/{connect,disconnect}` (noms `polenta-*`), `POST /images/create` (pull) et
`GET /images/*/json`, `POST /containers/create` (**sous inspection du corps**), `DELETE /containers/{name}`
(noms du kit). **Refus** : `Privileged`, `CapAdd`, `PidMode`/`IpcMode`/`UsernsMode` = host,
`NetworkMode=host`, `Devices`, `SecurityOpt` desserrant, `Binds`/`Mounts` hors des préfixes autorisés
(`/opt/polenta/` instances, jamais `/`, `/etc`, `/var/run/docker.sock`, `/root`), `build`, `swarm`,
`volumes` hors `polenta-*`, `plugins`, `commit`, `system`, `POST /containers/prune` et tout autre
chemin (liste fermée, défaut = refus 403). Chaque refus est journalisé (méthode, chemin, motif).

### 6.3 Authentification et autorisation

- **Niveaux** (spec §0) : jeton de service (portée instance) + `is_owner` revérifié.
  `ADMIN_INSTANCE` est lue dans `host.env` ; hôte à instance unique = niveaux confondus.
- Aucun cache pour une opération destructive (revérification à la création du travail) ; 60 s sinon.
- Limiteur de débit sur les échecs d'authentification (par jeton et par IP annoncée, 10 / minute).
- Les sessions `print` et `dev` : refusées dans `admin-routes.ts` avant tout appel ; test unitaire.
- `polenta-ops` : ses identifiants ne servent qu'au service et aux scripts ; jamais passés à `polenta-web`.

### 6.4 Audit

`audit.log` (JSONL, `0600`, ouvert `O_APPEND`, `chattr +a` si possible via l'agent à l'installation).
Une ligne `accepted` à la création, puis une ligne de résultat (`succeeded`, `failed`, `rolled-back`,
`cancelled`) ; `refused` pour tout refus (droit, confirmation, verrou, validation). Paramètres
expurgés : liste blanche de champs par opération (le reste n'est pas écrit). Les commandes SSH
continuent d'écrire dans `host.log`/`admin.log` ; leur exécution sous verrou pose une ligne d'audit
`origin: ssh` (écrite par `with_lock`, acteur = utilisateur système).

### 6.5 Secrets

- Valeurs sensibles transmises aux scripts par **descripteur de fichier** (`spawn` `stdio` avec pipe ouvert
  en fd 4+, lu par `/dev/fd/N` ou `read -u`), jamais en `argv` ni en variable d'environnement visible
  de `/proc/<pid>/environ` d'un autre uid (le service est le seul uid concerné), et effacées après.
- Filtre `redact` : valeurs exactes du travail + empreintes + motifs ; appliqué au journal avant écriture
  et sur les réponses d'erreur HTTP.
- Test de sentinelles (§ tests S5) : injection de valeurs `SENTINEL-…` dans clé S3, clé de purge, jeton
  `polenta-ops`, jeton de service, jeton utilisateur, puis `grep -r` des réponses, journaux, audit et logs.
- `Cache-Control: no-store` sur tout `/admin/api/*`.

### 6.6 Conteneur qui s'arrête lui-même

Le service refuse (code 18) : suppression/arrêt de l'instance d'exploitation depuis elle-même ;
désactivation du client web depuis ce même client web (`Origin-Instance == cible` et `web.disable`).
Pour `host.reboot` : écriture de `job.json` (`rebooting`) **avant** l'appel agent ; au retour, le service
compare `boot_id` et conclut `succeeded` ; délai `REBOOT_WAIT_MIN` (15) puis `failed` avec consigne KVM
(RUNBOOK A8). Mise à jour/arrêt de la forge de l'instance courante : avertissement avant lancement et
sondage côté navigateur avec reprise sur `401`/réseau.

## 7. Découpage en sprints (5, chacun livrable et testable)

### Sprint 1 — Scripts du kit (sans service ni interface)

Périmètre : `common.sh` (options, fd 3, `with_lock`, `confirm_arg`, `redact`, codes §5.5) ;
`--non-interactive`/`--json` sur toutes les commandes de l'opération ; `status --json`, `instance list|snapshots --json`,
`dns check --json`, `exports list|delete`, `instance backup --tag`, étape `pre-restore`, `s3-key rotate`,
`s3-purge`, commandes `polenta-admin.sh` `user import --preview`, `access-report`, `invite` ; mots de passe
hors journal ; jeton de service et `host.env` (`ADMIN_UI`, `ADMIN_INSTANCE`) ; `forge-versions.json`.
Dépend de #61/#62 livrés (modules, `status`). Livrable : usage SSH inchangé, `acceptance.sh` existant vert,
nouveaux scénarios verts. Tests : §Sprint 1 de `GH63-tests.md`. Critères visés : 7 (SSH), 16, 18, 11/12
(côté script), 17 (côté script), 8 (côté script).

### Sprint 2 — Service `polenta-admin` et proxy Docker

Périmètre : `apps/admin-service/` complet sauf routes S5 (import/export/clés/S3/purge) ; proxy Docker
et sa politique ; compose et Dockerfile ; installation par `install.sh`/module `admin` ; authn à deux
jetons ; travaux persistés, verrou, audit, filtre, reprise après redémarrage ; opérations de base
(liste, instances, sauvegarde, mise à jour, DNS, client web). Agent encore simulé (`absent`).
Livrable : le service tourne, se pilote par `curl` depuis un conteneur du réseau interne. Critères : 2
(API), 3, 6, 7, 8, 9 (API), 10 (partiel), 13.

### Sprint 3 — Agent hôte

Périmètre : agent, unité systemd, `install-agent.sh`, client du service, états `up/absent`, actions
`host.setup`, `fail2ban.*`, `firewall.status`, `host.reboot` et suivi après redémarrage ; gestion des
modules absents (#62). Livrable : les quatre actions « agent » par `curl` sur le service. Critères : 4,
14 (côté API), 15 (côté API), 6 (redémarrage hôte).

### Sprint 4 — Web-server et renderer (opérations courantes)

Périmètre : routes `/admin/api/*`, niveau de droit (`isOrgOwner`), `capabilities.serverAdmin`,
page Administration (Instances, Sauvegardes, Mises à jour, Hôte, Journal), bandeau de travail, suivi,
DNS, i18n fr/en, accessibilité, e2e `gh63-admin-*.spec.ts` contre un faux service. Livrable : un
propriétaire pilote les opérations courantes depuis le navigateur. Critères : 1, 2 (bout en bout), 5
(opérations non sensibles), 14, 15 (UI), 19.

### Sprint 5 — Opérations sensibles, fonctions sans équivalent Forgejo, RUNBOOK

Périmètre : clés restic (affichage unique), restauration, export + téléchargement en flux + suppression,
clé S3, purge S3 (fd, deux temps), import CSV (aperçu, rapport, mots de passe à usage unique), rapport
d'accès, invitation ; audit complet et export CSV ; test de sentinelles ; RUNBOOK A16 ; e2e
`gh63-sensitive-*.spec.ts` ; comparaison UI/SSH des 16 opérations. Critères : 5 (complet), 9, 10, 11, 12,
13, 17, 18, 20.

Dépendances de sprints : S1 → S2 → S3 ; S4 dépend de S2 (et de S3 pour les actions agent) ; S5 dépend de S4.

## 8. Cohabitation #61 / #62

- `CADDY_MODE=external` : aucune commande du service ne lance ni ne recharge Caddy ; les blocs de site
  sont lus dans `CADDY_SITES_DIR` (monté en lecture seule) ; l'interface affiche « à importer par votre
  Caddy ». Le service lui-même n'a pas de bloc de site (jamais exposé).
- `EDGE_NETWORK` : le proxy de socket autorise `connect/disconnect` sur ce nom ; le service n'y est pas rattaché.
- `HARDEN_HOST=none|basic` : `GET /me` renvoie `modules` (depuis `status --json` via l'agent, ou lu dans
  `host.env` si l'agent est absent) ; l'interface grise les actions dont le module est inactif
  et n'appelle jamais un module de durcissement non listé actif. `host.setup` n'ajoute jamais de module.
- `ADMIN_UI=off` : le service n'est pas démarré, `web.env` n'a pas `POLENTA_ADMIN_URL`, `/admin/*` = 404.

## 9. Risques

- **R1** — Service non root vs scripts écrits pour root. **Spike fait le 2026-10-28 (VM WSL2, Sprint 2) :
  négatif.** Sous l'uid 1500, `instance.env` (root 0600) et les données de la forge (`1000:1000`, 0700)
  sont illisibles, les dossiers d'instance non inscriptibles. Repli retenu (D10, décision de Benoit) :
  root dans le conteneur, `cap_drop: ALL` + 4 capacités de fichier ; critère 4 reformulé « pas de root
  hôte ». `userns-remap` écarté (réglage global du démon).
- **R2** — Politique du proxy trop stricte pour `docker compose up` : liste construite en rejouant
  `acceptance.sh` derrière le proxy (S2) ; tout nouveau chemin = changement revu.
- **R3** — Verrou `flock` sur volume partagé entre conteneur et hôte : fonctionne sur bind mount local ; test S1/S2.
- **R4** — Jeton OAuth2 utilisateur disponible dans le web-server : vérifier dans `UserContainerPool`
  (design GH44 §5.3) ; sinon l'obtenir par le même canal que les appels forge (S4, première tâche).
- **R5** — Clé de purge : la rétention hebdomadaire `forget --prune` exige le droit de suppression (Q3) ;
  décision à acter en S1 : `forget --prune` déplacée dans `s3-purge`/rétention manuelle, ou clé nocturne avec
  suppression limitée aux instantanés `nightly` ; la validation humaine de Q3 retient le défaut « clé séparée ».
- **R6** — `chattr +a` non disponible selon le système de fichiers : l'audit reste en ajout par `O_APPEND`.

## 10. Mises à jour de documentation

`specs/SPEC-WEB.md` (zone Administration), `specs/SPEC-INDEX.md`, `deploy/RUNBOOK.md` (A16), `README` du
kit (variables `ADMIN_UI`, `ADMIN_INSTANCE`, `ADMIN_AGENT_SOCKET`), `apps/desktop/e2e-web/README.md`.
