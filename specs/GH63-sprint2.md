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
| `deploy/admin/{Dockerfile,docker-compose.yml,install.sh}` | Image (node 22 alpine + outils du kit, uid 1500), compose du module (aucun port, socket monté par le proxy seul, réseaux internes), installation rejouable et `--remove`. |
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

## Risque R1 (non levé)

Le spike « scripts du kit sous l'uid 1500 » n'a pas pu être fait (pas d'hôte Linux). Points connus :
`instance.env` et la plupart des fichiers d'état sont `root 0600`, `instance add` fait des `chown
1000:1000`. `install.sh --root-fallback` lance le service en root **dans** le conteneur (toujours sans
socket ni port) : repli documenté au design, à trancher sur la VM.

## Tests

`pnpm --filter @polenta/admin-service typecheck` : zéro erreur. `pnpm --filter @polenta/admin-service
test` (vitest, Windows, Node 20) : **81 verts, 1 sauté** — l'annulation par SIGTERM (S2-22) ne se
teste pas sous Windows (signal non transmis à bash MSYS), à exécuter sous Linux. Bundle `pnpm build`
démarré à la main : `/healthz` 200, `/me` sans jeton 401, proxy `POST /build` 403.

Couverts en automatique : S2-2, S2-3/S2-5 (reprise), S2-6 à S2-13, S2-15 à S2-21, S2-23, S2-24,
S2-25 à S2-27. À faire sur une VM Linux avec Docker : S2-22 (annulation), S2-1, S2-4, S2-14, S2-17 en
réel (`docker compose up/down` d'une instance derrière le proxy, risque R2), image, `install.sh`,
`shellcheck` des scripts modifiés.

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
