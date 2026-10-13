# GH61 — Sprint 1 : noyau « Caddy et réseau Docker optionnels »

Périmètre : `specs/GH61-design.md` §4, sprint 1 (critères 1 à 11 et 13). RUNBOOK, `acceptance.sh --external`,
`acceptance-external.sh` et SPEC-INDEX relèvent du sprint 2.

## Fichiers modifiés

- `deploy/lib/common.sh` : constantes `DEFAULT_CADDY_MODE|EDGE_NETWORK|CADDY_SITES_DIR` ; `load_host_env` lit
  `CADDY_MODE`, `EDGE_NETWORK`, `CADDY_SITES_DIR`, `CADDY_RELOAD_CMD` ; nouvelle `validate_host_env` (refus
  en français : mode hors `managed|external`, `EDGE_NETWORK` hors `[a-zA-Z0-9][a-zA-Z0-9_.-]*`, `CADDY_SITES_DIR` relatif).
- `deploy/lib/caddy.sh` : `name: ${EDGE_NETWORK}` dans le compose Caddy (identique par défaut) ; `caddy_external`,
  `caddy_sites_dir`, `site_apply` (factorise les deux ajouts de site), `site_reload`, `external_reload`, `site_remove`,
  `edge_network_require`, `caddy_external_guard`, `caddy_managed_ports_guard`, `wait_edge_http` ;
  `caddy_write_compose` / `caddy_connect_network` / `caddy_disconnect_network` sans effet en external.
- `deploy/polenta-host.sh` : `setup_firewall` (22 seul en external, jamais de suppression), `cmd_setup` (validation et
  garde-fous avant toute modification, vérification du réseau après Docker, `setup_external_sites`), `inst_compose`
  (surcharge compose + `EDGE_NETWORK` exporté en external), `wait_front` / `front_ok` / `check_front_dns`,
  `edge_network_require` en entrée de `instance add`, `restore`, `update`, `start`, `web_start`, `cmd_status`
  (ligne Caddy externe), `cmd_instance_sync` (external : recréation des conteneurs + réécriture des blocs).
- `deploy/instance/docker-compose.external.yml` (nouveau) ; `deploy/instance/docker-compose.yml` (commentaire seul).
- `deploy/host.env.example` : section « Cohabitation avec d'autres projets dockerisés sur un même serveur ».
- `deploy/tests/caddy-external.test.sh` (nouveau) : 26 vérifications simulées (sans Docker).

**Mises à jour SPEC / RUNBOOK** : aucune dans ce sprint (RUNBOOK A1, A2, A10, A12, nouvelle section et SPEC-INDEX au sprint 2).

## Comportement implémenté

Voir `specs/GH61.md` §2. Par défaut (`CADDY_MODE=managed`) le comportement est inchangé : mêmes fichiers rendus
(vérifié octet pour octet contre `origin/main`), mêmes ports, mêmes commandes docker. En `external` : aucun Caddy,
pare-feu limité à 22/tcp, blocs `<instance>.caddy` / `.web.caddy` dans `CADDY_SITES_DIR`, rechargement par
`CADDY_RELOAD_CMD` (une fois par modification effective, rollback du bloc en cas d'échec), forge et client web
rattachés à `EDGE_NETWORK`, sonde réseau interne à la place de `wait_https`.

## Divergences par rapport au design

1. `cmd_instance_sync` en external réécrit aussi le bloc `.web.caddy` si `WEB_DOMAIN` est renseigné (nécessaire à la migration).
2. Le contrôle DNS en external affiche une ligne grisée « DNS … non vérifié (géré par votre Caddy) » (fonction `check_front_dns`)
   au lieu de `skip` (qui ajouterait « (déjà fait) », trompeur).
3. `edge_network_require` est appelé aussi dans `setup` juste après `setup_docker` (avant le pare-feu), et non à la fin.
4. Le garde-fou « 80/443 occupés » en managed s'exécute en début de `setup` (avant toute modification), s'il y a `ss` et pas de conteneur `polenta-caddy`.
5. `wait_front` choisit la cible (forge ou client web) selon le chemin de santé (`/healthz` = client web), pour garder la signature des appels existants.
6. Message « réseau … absent » à `docker compose up` (§2.3) : couvert par la vérification préalable `edge_network_require`, pas par une réécriture de l'erreur compose.
7. Ajout non prévu : `deploy/tests/caddy-external.test.sh` (tests simulés exécutables ici).

## Scénarios de `specs/GH61-tests.md`

Poste Windows / Git Bash : pas de Docker, ufw, ss, jq ni shellcheck.

| Scénario | Statut |
|---|---|
| S1-1 (diff avant/après managed) | **Partiel, simulé** : rendu du compose, du Caddyfile et des deux blocs de site comparé à `origin/main` = identique (`caddy-external.test.sh`). Le diff sur hôte reste à exécuter sur un hôte Debian/Ubuntu jetable. |
| S1-2, S1-3 | Non exécutés (hôte jetable requis). |
| S1-4, S1-5, S1-7 | **Exécutés (simulés)** via `load_host_env` : refus rc=3, message citant la clé et les valeurs acceptées. « Aucune modification de l'hôte » (relevés ufw/docker/ls) non vérifiée ici. |
| S1-6 | **Exécuté (simulé)** : refus « chemin absolu » ; la non-création du dossier est non vérifiée sur `setup` réel. |
| S1-8 à S1-12, S1-14, S1-15 | Non exécutés (hôte jetable). Garde-fou S1-14 : logique de `caddy_external_guard` **simulée** (refus si `polenta-caddy` tourne, accord sinon). S1-15 (`caddy_managed_ports_guard`) non testée. |
| S1-13, S1-33 | Non exécutés ; `edge_network_require` **simulée** (refus citant le réseau et `docker network create`). |
| S1-16, S1-19, S1-26, S1-27, S1-28, S1-29, S1-31, S1-32 | Non exécutés (hôte jetable). |
| S1-17, S1-18, S1-22 | Non exécutés ; S1-18 partiellement **simulé** : aucun appel `docker` (connect/disconnect/exec) émis par les fonctions Caddy en external. Fusion compose des `networks` et routage réel non vérifiés (pas de `docker compose config` ici). |
| S1-20, S1-21 | **Exécutés (simulés)** : blocs externes identiques au rendu managed ; `_vitrine.caddy` d'empreinte inchangée après ajout et suppression. |
| S1-23, S1-24, S1-25 | **Exécutés (simulés)** avec `CADDY_RELOAD_CMD` réel : un rechargement par modification effective, aucun en cas d'identique ni de suppression sans bloc ; `false` : échec rc=3 et bloc retiré ; vide : un seul avertissement, bloc conservé. |
| S1-30 | Non exécuté ; **simulé** : suppression de blocs sans appel `docker network disconnect`. |
| S1-34 (shellcheck) | **Non exécuté** : shellcheck indisponible. Seul `bash -n` passé sur `polenta-host.sh`, `polenta-admin.sh`, `lib/*.sh` et le nouveau test. |
| S1-35 | **Exécuté** : `deploy/tests/grant-template.test.sh` sortie 0. |

## Comment tester

- Ici : `bash deploy/tests/caddy-external.test.sh` (26 vérifications, sortie OK) et `bash deploy/tests/grant-template.test.sh`.
- Sur un hôte Debian 13 / Ubuntu 24.04 jetable : dérouler `specs/GH61-tests.md` Sprint 1 (S1-1 à S1-33), `shellcheck -x deploy/polenta-host.sh deploy/lib/*.sh deploy/tests/*.sh`.

## Points d'attention

- `docker-compose.external.yml` dépend de la fusion de listes `networks` par compose v2 (risque a du design) : à confirmer par S1-17 / S1-19.
- La commande `setup` valide `host.env` avant toute modification seulement si le fichier existe déjà ; au premier lancement il est validé juste après sa copie.
- Les messages d'`instance add`/`start`/`restore` en external indiquent que `https://<domaine>` n'est pas vérifié.
