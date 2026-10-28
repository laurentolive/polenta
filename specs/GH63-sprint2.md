# GH63 — Sprint 2 : service `polenta-admin` et proxy Docker

Périmètre : `specs/GH63-design.md` §7 Sprint 2. Scénarios : `specs/GH63-tests.md` §Sprint 2.

## Fichiers

| Fichier | Changement |
|---|---|
| `apps/admin-service/` (nouveau paquet `@polenta/admin-service`) | Service Fastify (port 8787) et proxy Docker, même image. |
| `src/config.ts` | Environnement du conteneur ; `host.env` relu à chaque requête (`ADMIN_INSTANCE`, `CADDY_MODE`, modules `HARDEN_HOST` / `HOST_MODULES`). |
| `src/auth/service-token.ts` | Jetons de service : empreintes SHA-256 de `admin/service-tokens.json`, comparées à temps constant à **toutes** les entrées. |
| `src/auth/forge-owner.ts` | Revérification auprès de la forge de l'instance d'origine : identité par `GET /api/v1/user` (le login annoncé n'est pas cru), droit par `…/orgs/{org}/permissions`, `is_owner` seul. Cache 60 s, contourné pour une opération destructive. |
| `src/auth/levels.ts`, `src/auth/rate-limit.ts` | Niveau instance / hôte, portée de la cible ; 10 échecs par minute et par source. |
| `src/jobs/registry.ts` | Catalogue fermé : `instance.list|add|stop|start|sync|remove`, `forge.update`, `backup.run|list`, `dns.check`, `web.enable|disable` ; actions agent (`host.setup`, `fail2ban.*`, `host.reboot`) déclarées, 503 tant que l'agent est absent. argv en tableau, paramètres à motif strict, champs d'audit en liste blanche. |
| `src/jobs/runner.ts` | Processus détaché par travail (enveloppe bash fixe : relais de SIGTERM, `exit.code`), sorties relayées et filtrées vers `log.ndjson`, résultat par `POLENTA_RESULT_FILE`, reprise au démarrage (`interrupted` si processus disparu ou autre `boot_id`). |
| `src/jobs/store.ts`, `src/jobs/lock.ts`, `src/audit.ts`, `src/secrets/redact.ts` | Travaux en fichiers (§5.4), rétention 90 j / 200, secret à usage unique 10 min ; verrou testé par `flock -n` sur le fichier partagé + `.lock.owner` ; audit JSONL en ajout seul, export CSV. |
| `src/app.ts`, `src/service.ts`, `src/index.ts` | Routes §5.1/§5.2 du sprint : `/me`, `/instances`, `/jobs` (création, suivi, journal, annulation, secret), `/backups/:i`, `/dns`, `/audit(.csv)`, `/healthz`. `Cache-Control: no-store` partout. |
| `src/docker-proxy/{policy,server,main}.ts` | `polenta-docker-proxy` : liste fermée méthode + chemin (défaut refus), inspection des corps de création (privilèges, capacités, espaces de noms de l'hôte, montages hors `/opt/polenta/`, réseaux), conteneurs résolus par le démon (nom ou projet compose du kit), relais des connexions `exec`. |
| `apps/admin-service/test/*` | Vitest : proxy, droits, travaux, verrou, reprise, contre un kit et une forge simulés. |
| `packages/types/src/admin.ts` | Types partagés §4 (`AdminApiError` au lieu de `ApiError`, nom libre dans le paquet). |
| `deploy/admin/{Dockerfile,docker-compose.yml,install.sh}` | Image (node 22 alpine + outils GNU du kit), compose (root conteneur limité, D10) du module (aucun port, socket monté par le proxy seul, réseaux internes), installation rejouable et `--remove`. |
| `deploy/instance/docker-compose.admin.yml` | Surcharge : forge et client web rejoignent `polenta-admin-net` quand `ADMIN_UI=on`. |
| `deploy/polenta-host.sh` | `inst_compose` ajoute cette surcharge ; `instance sync` rend `web.env` et recrée les conteneurs quand `ADMIN_UI=on` ; `service-tokens.json` appartient à l'uid du service. |
| `pnpm-lock.yaml` | Entrée du nouveau paquet (versions déjà présentes dans le lockfile). |

## Divergences par rapport au design

1. **La forge rejoint `polenta-admin-net`** (en plus du client web) : le réseau est interne (pas de
   sortie Internet), c'est le seul moyen pour le service de revérifier `is_owner` auprès de la forge
   de l'instance d'origine (§5.2). Les forges sont de toute façon publiques via Caddy.
2. **Résultat par fichier** (`POLENTA_RESULT_FILE`, prévu par le Sprint 1) plutôt que par fd 3 : le
   travail est un processus détaché qui doit survivre à un redémarrage du service ; un tube ne le
   permet pas. Les sorties brutes (`out.raw`, `err.raw`, 0600) restent dans le dossier du travail le
   temps du relais, déjà masquées par le kit en mode administration, puis sont supprimées.
3. **Le service lance le kit de l'hôte** (`/opt/polenta/kit`, monté) et non la copie de l'image :
   même version que l'usage SSH ; la copie de l'image sert de repli.
4. **Refus « instance d'exploitation »** élargi : arrêt, suppression et désactivation du client web
   de l'instance d'**origine** sont refusés (422, `exitCode: 18`), pas seulement d'`ADMIN_INSTANCE`.
5. **`ADMIN_INSTANCE` vide** : personne n'a le niveau hôte (commentaire de `host.env.example`), même
   sur un hôte à instance unique.
6. **Reprise après redémarrage** : un travail survit à un redémarrage du **processus** Node ; un
   redémarrage du **conteneur** arrête ses processus, le travail passe alors à `interrupted`.

## Risque R1 (spike fait sur VM le 2026-10-28)

Sous l'uid 1500, les scripts du kit ne peuvent pas fonctionner : `instance.env` (root 0600) est
illisible, `instance list --json` rend une liste vide, les données de la forge (1000:1000, 0700) sont
illisibles (sauvegarde impossible) et les dossiers d'instance non inscriptibles. Le service lui-même
refuse alors tout jeton (instance d'origine inconnue).

**Décision (Benoit, 2026-10-28) : option « root limité dans le conteneur »**, design D10 et R1 révisés.
Root **dans** le conteneur avec `cap_drop: ALL` puis `cap_add: [CHOWN, DAC_OVERRIDE, DAC_READ_SEARCH,
FOWNER]`, `no-new-privileges`, système de fichiers en lecture seule, un seul montage `/opt/polenta`,
aucun socket Docker, aucun port ; c'est le seul mode (`deploy/admin/docker-compose.yml`), sans option
d'installation. `POLENTA_OPERATOR_UID` vaut 0 par défaut (`common.sh`). Le critère 4 devient « pas de
root **hôte** ». L'uid 1500 resterait possible au prix d'une refonte des droits de fichiers du kit.

## Tests

**Unitaires** (`pnpm --filter @polenta/admin-service test`, typecheck zéro erreur) :
- Linux (conteneur `node:22-bookworm`) : **82/82 verts**, annulation par SIGTERM (S2-22) comprise ;
- Windows (Node 20 portable) : 82 verts, 1 sauté (SIGTERM non transmis à bash MSYS).

**Hôte de test** (VM WSL2 Ubuntu 24.04, Docker 29.1, kit réel copié dans `/opt/polenta/kit`,
instances simulées sans forge) : 37 contrôles, tous verts :
- `install.sh` (image locale), deux services en marche, **aucun port publié** (S2-1) ;
- `polenta-admin` sans socket Docker, un seul montage `/opt/polenta`, `Privileged=false`,
  `CapDrop=ALL`, `CapAdd` = les 4 capacités de fichier, `no-new-privileges`, utilisateur `0:0` (S2-14) ;
  seul le proxy monte le socket ; état du kit et données de la forge lisibles par les scripts ;
- API joignable seulement depuis `polenta-admin-net` ; `/me` sans jeton 401, forge absente 502 ;
- via le proxy (S2-17) : `ps`, `compose pull`, `compose up -d`, `inspect`, `logs`, `exec`,
  `stop/start/restart`, `compose up --force-recreate`, `compose down` d'un projet `polenta-*` ;
- refus (S2-15, S2-16, S2-18) : `--privileged`, `-v /:/host`, `-v /etc`, `-v docker.sock`, `--network
  host`, `--cap-add`, nom hors kit, `build`, `volume create` hors `polenta-*`, `swarm init`,
  `container prune`, `exec`/`stop` d'un conteneur étranger, rattachement au réseau du proxy ;
  chaque refus journalisé par le proxy.

Corrigé grâce à la VM : recréation compose (nom temporaire `<id>_<nom>` refusé à la création) ;
image sans outils GNU (`sed -u`, `find -printf` du kit en échec sous busybox) ; `POLENTA_OPERATOR_UID`
du conteneur transmis au kit ; `pnpm` installé par npm dans l'image (corepack ignore le proxy HTTP).

**Kit** (Debian 13 jetable, après passage de `POLENTA_OPERATOR_UID` à 0) : `lib-common` 39,
`host-json` 26, `host-ops` 36, `admin-users` 22, `host-admin-env` 13, tous verts ; `shellcheck -x -S
warning` sur `polenta-host.sh`, `polenta-admin.sh`, `admin/install.sh`, `lib/*.sh` : zéro avertissement.

Restent pour un hôte complet (forge réelle, DNS, sauvegarde S3) : S2-2 de bout en bout avec une vraie
forge, S2-4 (`docker restart polenta-web-*`), S2-23 réel, `acceptance.sh`.

Note Windows : les sorties brutes sont ouvertes en `w` (pas `a`) — bash MSYS n'écrit rien dans un
fichier ouvert en ajout par Node.

## Comment tester (VM de test, jamais la production)

```bash
pnpm --filter @polenta/admin-service test
pnpm --filter @polenta/admin-service typecheck
# sur la VM : ADMIN_UI=on et ADMIN_INSTANCE=ops dans /opt/polenta/host.env
sudo /opt/polenta/kit/admin/install.sh --build ~/polenta
docker compose -p polenta-admin ps                                      # S2-1 : aucun port
docker inspect polenta-admin --format '{{json .HostConfig}}' | jq '{Privileged,CapAdd,CapDrop,SecurityOpt}'
# depuis le réseau interne (S2-2) :
docker run --rm --network polenta-admin-net curlimages/curl -s \
  -H "Authorization: Bearer $(sudo grep ^ADMIN_SERVICE_TOKEN= /opt/polenta/instances/acme/instance.env | cut -d= -f2)" \
  -H "X-Polenta-Forge-Token: <jeton d'alice>" http://polenta-admin:8787/me
```
