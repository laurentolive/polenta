# GH61 — Sprint 2 : preuves d'acceptation et RUNBOOK (dernier sprint)

Périmètre : `specs/GH61-design.md` §4, sprint 2 (critères 12 à 14). Le comportement par défaut (`managed`) et les
scripts existants ne sont pas modifiés, hormis l'option `--external` d'`acceptance.sh` (sans option : inchangé).

## Fichiers modifiés

- `deploy/tests/acceptance-external.sh` (nouveau) : scénario **sur l'hôte** (root), critères 2 à 6. Préconditions
  (`host.env` en external, réseau présent, nom d'instance libre) ; empreintes avant (règles ufw 80/443, listeners
  80/443 via `ss`, fichiers `_*.caddy`) ; `docker events` en tâche de fond ; `polenta-host setup` (désactivable par
  `--no-setup`) ; aucun conteneur `polenta-caddy` et pas de `/opt/polenta/caddy` ; `instance add` d'une instance de
  test (`--no-demo --yes`) ; bloc `<nom>.caddy` comparé octet pour octet au rendu des fonctions du kit ; réseaux de
  `forgejo-<nom>` (`polenta-<nom>` et `EDGE_NETWORK`) ; Caddy d'essai éphémère (sans port publié, `local_certs`) et
  `GET /api/healthz` → 200 par une sonde `curl` sur `EDGE_NETWORK` ; option `--web-domain/--web-version[/--web-image]`
  pour `web enable/disable` ; vérification qu'aucun conteneur autre que forge/web n'a rejoint `polenta-<nom>` (événements
  `network connect`) ; `instance remove` puis blocs supprimés, `_*.caddy` d'empreinte inchangée, ufw et listeners
  inchangés sur l'ensemble. Sortie non nulle au premier écart ; `trap EXIT` supprime l'instance de test, le Caddy d'essai
  et l'export.
- `deploy/tests/acceptance.sh` : option `--external` (80/443 non exigés, 22 exigé, test HTTP → HTTPS sauté ;
  `2222 3000 5355 8080 2375` toujours vérifiés fermés) ; aide mise à jour.
- `deploy/RUNBOOK.md` : A1 (arborescence et mode external), A2 (préparation : serveur déjà occupé, pare-feu), A10 (sites
  additionnels en external), A12 (reprise : `CADDY_SITES_DIR`, réseau, Caddy existant), nouvelle section **A16**
  « Cohabitation avec d'autres projets dockerisés sur un même serveur » (prérequis, exemple de montage et d'`import`,
  exemple de `host.env`, `CADDY_RELOAD_CMD`, limites d'isolation, instances antérieures, migrations dans les deux sens,
  dépannage, vérification).
- `specs/SPEC-WEB.md`, `specs/SPEC-INDEX.md` : voir ci-dessous.

## Mises à jour SPEC

| Section | Modification |
|---|---|
| `specs/SPEC-WEB.md` §9 (« Build, image et déploiement », puce « Kit `deploy/` ») | Ajout du paragraphe « Caddy optionnel » (GH61) : `CADDY_MODE=external`, blocs dans `CADDY_SITES_DIR`, `CADDY_RELOAD_CMD`, `EDGE_NETWORK` partagé (isolation réseau non garantie), sonde `wait_edge_http`, renvois RUNBOOK A16 et scripts d'acceptation. |
| `specs/SPEC-INDEX.md` ligne SPEC-WEB `§global` | Résumé complété (Caddy optionnel, GH61), mots-clés `CADDY_MODE`, `external`, `EDGE_NETWORK`, `CADDY_SITES_DIR`, `CADDY_RELOAD_CMD`, cohabitation, `wait_edge_http` ; colonne `MAJ` : `GH61`. |
| `deploy/RUNBOOK.md` A1, A2, A10, A12, A16 (nouvelle) | Voir ci-dessus (critère 14). |

Autres `## Refs SPEC` de `GH61.md` : `GH45.md`, `GH45-design.md`, `GH44.md` sont des specs de tickets antérieurs, non modifiées ;
aucune autre section SPEC-* n'est concernée (le ticket ne touche ni `apps/` ni `packages/`).

## Divergences par rapport au design

1. Le design ne prévoyait pas d'exigences sur le moyen de sonder le routage ; `acceptance-external.sh` utilise une image
   `curlimages/curl` (variable `ACC_CURL_IMAGE`, tirée du registre si absente) plutôt que la seule image `caddy`, dont le
   `wget` BusyBox ne garantit pas le SNI.
2. `acceptance-external.sh` relance `polenta-host setup` par défaut (c'est ce qui prouve le critère 3 « avant/après setup ») ;
   `--no-setup` le saute.
3. La vérification « aucun `docker network connect` vers un Caddy » (critère 6) s'appuie sur `docker events` (connexions au
   réseau `polenta-<nom>` hors forge/web), et non sur une trace des commandes émises ; la non-émission côté code reste couverte
   par `deploy/tests/caddy-external.test.sh` (simulé).
4. Le client web n'est joué que si `--web-domain` et `--web-version` sont fournis (image du client web requise sur l'hôte).

## Scénarios de `specs/GH61-tests.md` (sprint 2)

Poste Windows / Git Bash : ni Docker, ni ufw, ni `ss`, ni `shellcheck`, pas de droits root. Les `.sh` sont stockés en LF par git
(`autocrlf`) ; les vérifications ci-dessous ont été faites sur une copie LF de `deploy/`.

| Scénario | Statut |
|---|---|
| S2-1 (`acceptance-external.sh` sur hôte external) | **Non exécuté** : à jouer sur un hôte Debian 13 / Ubuntu 24.04 jetable (Caddy tiers ou listener en place). Seuls exécutés ici : `bash -n` (OK), affichage de l'aide, refus hors root (rc=2). Le script n'a jamais tourné contre un vrai Docker : des ajustements sont probables au premier passage. |
| S2-2 (écart provoqué par `polenta-caddy`) | **Non exécuté** (hôte jetable). Attendu par construction : `setup` passe (conteneur arrêté), puis échec à « aucun conteneur polenta-caddy », nettoyage par `trap`. |
| S2-3 (`acceptance.sh --external` depuis l'extérieur) | **Non exécuté** (domaine et hôte réels requis). Seuls exécutés : `bash -n` (OK), aide. |
| S2-4 (`acceptance.sh` sans option sur hôte external) | **Non exécuté** ; le chemin sans option reste le code d'origine (diff : conditions `EXTERNAL` uniquement). |
| S2-5 [M] (relecture RUNBOOK) | **À relire par l'humain** ; RUNBOOK rédigé, cohérent avec les messages du code (« réseau Docker … absent », « polenta-caddy tourne encore », « 80/443 occupés », « ne répond pas sur le réseau », « rechargez votre Caddy »). |
| S2-6 [M] (migration dans les deux sens sur VM) | **Non exécuté** : à dérouler mot pour mot sur un hôte jetable avec le mainteneur. |
| S2-7 (`shellcheck`, `grant-template.test.sh`) | `grant-template.test.sh` **exécuté : sortie 0** ; `caddy-external.test.sh` **exécuté : OK** (sprint 1, relancé). `shellcheck` **non exécuté** (indisponible) : `bash -n` seulement, sur `polenta-host.sh`, `polenta-admin.sh`, `lib/*.sh`, `tests/*.sh`. |

## Exécution sur VM — 2026-10-16

VM VirtualBox jetable `polenta-test`, Ubuntu 24.04.5, hôte simulé « déjà administré » : Docker (`docker.io`), ufw actif
avec une règle tierce (`8443/tcp`), Caddy tiers en conteneur publiant 80/443 (TLS interne, site `vitrine.test` vers
une appli tierce), crontab root. `host.env` : `CADDY_MODE=external`, `EDGE_NETWORK=polenta-edge`,
`CADDY_RELOAD_CMD=docker exec caddy caddy reload --config /etc/caddy/Caddyfile`, `HARDEN_HOST=none` (GH62). Domaines dans
`/etc/hosts`, S3 de test local. Kit : GH62 fusionnée avec `main`, plus les correctifs ci-dessous.

| Scénario | Résultat |
|---|---|
| S2-1 (`acceptance-external.sh`) | **OK** après correction du script (il comparait l'identifiant de conteneur de `docker events` à des noms) : toutes les vérifications passent (ufw et listeners 80/443 inchangés, aucun `polenta-caddy`, bloc identique au rendu managed, réseaux, routage HTTPS → 200 par le Caddy d'essai, suppression). |
| S2-2 (écart `polenta-caddy`) | **OK** : échec attendu à « aucun conteneur polenta-caddy », instance de test nettoyée. |
| S2-3 (`acceptance.sh --external` depuis l'extérieur) | **Partiel** : joué depuis la VM elle-même (CA du Caddy tiers approuvée) — toutes les vérifications passent, y compris combinée à `--harden-level none` (dans les deux ordres). Pas joué depuis un poste extérieur (pas de DNS public). |
| S2-4 (`acceptance.sh` sans option sur hôte external) | **OK** depuis la VM (mêmes réserves) : toutes les vérifications passent. |
| Cas cible complet | **OK** : `setup` (rc 0, rejeu sans ✓), `instance add`, forge servie par le Caddy existant (healthz 200) pendant que le site tiers reste servi, `status` « Caddy : externe », sauvegarde, restauration, `backup-cron`, `instance remove`. Avant/après : sshd effectif, ufw, crontab root, fail2ban (absent), unattended-upgrades inchangés ; Docker et conteneurs tiers non redémarrés ; seuls `/etc/cron.d/polenta` et `/etc/logrotate.d/polenta` ajoutés. |
| S2-6 (migrations) | Non jouées. |

Bugs trouvés et corrigés (détail dans `specs/GH62-tests.md`, section « Résultats d'exécution sur VM ») :
garde-fous du premier `setup` qui ignoraient le `host.env` du kit (external refusé, « 80/443 occupés ») ; API de la forge
appelée par le Caddy existant (`instance add` → « HTTP 000 ») ; `daemon.json` écrasé et Docker redémarré sur un hôte existant ;
scripts non exécutables dans git ; première sauvegarde impossible avec restic < 0.17 (Ubuntu 24.04, Debian 12).

## Comment tester

- Ici : `bash deploy/tests/caddy-external.test.sh`, `bash deploy/tests/grant-template.test.sh`, `bash -n deploy/tests/*.sh`.
- Hôte jetable external : `sudo deploy/tests/acceptance-external.sh <domaine-test> [--web-domain <d> --web-version <v>]`, puis, depuis un
  poste extérieur, `deploy/tests/acceptance.sh --external <domaine>` ; relecture et migrations de `deploy/RUNBOOK.md` A16 ; `shellcheck -x
  deploy/polenta-host.sh deploy/lib/*.sh deploy/tests/*.sh`.

## Points d'attention

- Le domaine de test passé à `acceptance-external.sh` n'a pas besoin de DNS (la sonde utilise `--resolve`), mais il ne doit pas déjà être déclaré dans le Caddy existant (« ambiguous site definition »).
- `instance remove` fait un export avant suppression : l'archive de l'instance de test est effacée par le script.
