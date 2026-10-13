# GH61 — Scénarios de test : Caddy et réseau Docker optionnels

Références : `specs/GH61.md` (critères 1–14), `specs/GH61-design.md`.

Légende : **[A]** automatique (script du dépôt) ; **[M]** manuel sur l'hôte de test.

Environnement :
- hôte de test = VM Debian 13 ou Ubuntu 24.04, root, kit installé dans `/opt/polenta/kit` ;
- `$D` = domaine de test résolu vers la VM (ex. `t1.forge.test.example`), `$W` = `web-t1.forge.test.example` ;
- instance de test `t1` (`--no-demo`) ; image web de test disponible ;
- « tiers » = conteneur Caddy d'essai (`caddy:2`) sur `EDGE_NETWORK`, jamais géré par le kit ;
- `host.env` **A** : sans nouvelle clé ; **B** : `CADDY_MODE=external`, `EDGE_NETWORK=polenta-edge`, `CADDY_SITES_DIR=/opt/polenta/caddy-sites`, `CADDY_RELOAD_CMD='docker exec tiers caddy reload --config /etc/caddy/Caddyfile'`.

## Sprint 1 — Noyau

### Mode managed (non-régression)
| ID | Scénario | Attendu |
|---|---|---|
| S1-1 [M] | Sur `main` (avant) : `host.env` A, `setup`, `instance add t1 --domain $D --no-demo --yes`, `instance web enable t1 --domain $W --version <v>` ; copier `caddy/docker-compose.yml`, `caddy/etc/Caddyfile`, `caddy/etc/sites/` vers `/tmp/avant`. Réinitialiser l'hôte, refaire avec la branche GH61 vers `/tmp/apres`. | `diff -r /tmp/avant /tmp/apres` vide ; `docker port polenta-caddy` liste 80, 443, 443/udp (critère 1). |
| S1-2 [A] | `deploy/tests/acceptance.sh $D` depuis le poste de dev (managed). | Mêmes vérifications qu'avant, toutes vertes (critère 1). |
| S1-3 [M] | `host.env` A : `setup` rejoué ; `docker inspect forgejo-t1`. | Rien de modifié ; seul le réseau `polenta-t1` est listé. |

### Validation de configuration (critère 9)
| ID | Scénario | Attendu |
|---|---|---|
| S1-4 [M] | `CADDY_MODE=foo` ; relever `ufw status`, `docker ps -a`, `ls /opt/polenta`, puis `polenta-host setup`. | Sortie ≠ 0, message français citant `CADDY_MODE` et `managed|external` ; relevés identiques avant/après. |
| S1-5 [M] | `EDGE_NETWORK='a b'` puis `polenta-host status` et `instance add`. | Sortie ≠ 0, message citant `EDGE_NETWORK` et le motif accepté ; rien créé. |
| S1-6 [M] | `CADDY_SITES_DIR=relatif` (mode external), `setup`. | Sortie ≠ 0, « chemin absolu » ; dossier non créé. |
| S1-7 [M] | `EDGE_NETWORK=-x` (commence par un tiret). | Refusé comme S1-5. |

### Mode external : setup, pare-feu, Caddy (critères 2, 3, 10)
Préparation : `docker network create polenta-edge` ; tiers : `docker run -d --name tiers --network polenta-edge -p 80:80 -p 443:443 -v /opt/polenta/caddy-sites:/sites:ro -v /tmp/tiers/Caddyfile:/etc/caddy/Caddyfile caddy:2` avec un Caddyfile `{ local_certs }` + `import /sites/*.caddy` ; un `_vitrine.caddy` factice dans `/opt/polenta/caddy-sites` ; règles ufw 80/443 posées à part ; `ufw status numbered > /tmp/ufw-avant`. `host.env` B.
| ID | Scénario | Attendu |
|---|---|---|
| S1-8 [M] | `polenta-host setup`. | Sortie 0 ; « pare-feu : seul 22 ouvert (Caddy externe : 80/443 non gérés) » ; ligne `import /opt/polenta/caddy-sites/*.caddy` affichée ; aucun « Caddy démarré ». |
| S1-9 [M] | `docker ps -a --filter name=polenta-caddy -q` ; `test -e /opt/polenta/caddy`. | Sortie vide ; `/opt/polenta/caddy` absent (critère 2). |
| S1-10 [M] | Comparer les lignes 80 et 443 de `ufw status numbered` avec `/tmp/ufw-avant` ; `curl -sk --resolve x:443:127.0.0.1 https://x/` sur le tiers pendant et après `setup`. | Aucune différence ; le tiers répond en continu ; aucune règle supprimée (critère 3). |
| S1-11 [M] | Hôte neuf, ufw inactif, `host.env` B, `setup`. | ufw actif, seule 22/tcp ouverte ; 80/443 non ouverts (spec §2.3, Q7). |
| S1-12 [M] | `setup` rejoué. | « rien à faire » partout, sortie 0, aucun fichier modifié hors journaux. |
| S1-13 [M] | `docker rm -f tiers`, `docker network rm polenta-edge`, `setup`. | Sortie ≠ 0 ; message citant `polenta-edge` et `docker network create polenta-edge` (critère 7). Recréer ensuite réseau et tiers. |
| S1-14 [M] | Hôte managed en service (`polenta-caddy` actif), passer `host.env` en B, `setup`. | Refus avec l'instruction de retirer `polenta-caddy` ; `docker ps`, `ufw status` et fichiers identiques avant/après (critère 10). |
| S1-15 [M] | Hôte external, 80 occupé par le tiers, passer à `CADDY_MODE=managed`, `setup`. | Refus : 80/443 occupés par un autre processus ; tiers intact. |

### Mode external : blocs, réseau, rechargement (critères 4, 5, 6, 8)
| ID | Scénario | Attendu |
|---|---|---|
| S1-16 [M] | `instance add t1 --domain $D --no-demo --yes`. | Sortie 0 ; `/opt/polenta/caddy-sites/t1.caddy` existe ; message final : `https://$D` non vérifié (certificat dépendant du Caddy) ; pas de « certificat TLS valide ». |
| S1-17 [M] | `docker inspect -f '{{json .NetworkSettings.Networks}}' forgejo-t1 \| jq 'keys'`. | `["polenta-edge","polenta-t1"]` (critère 6). |
| S1-18 [M] | `bash -x /usr/local/bin/polenta-host instance sync t1 2>&1 \| grep -c 'network connect'` ; `docker inspect tiers`. | `0` ; le tiers n'a pas gagné le réseau `polenta-t1` (critère 6). |
| S1-19 [M] | `instance web enable t1 --domain $W --version <v>`. | `t1.web.caddy` créé ; `docker inspect polenta-web-t1` liste `polenta-edge` et `polenta-t1`. |
| S1-20 [M] | `diff /opt/polenta/caddy-sites/t1.caddy /tmp/avant/sites/t1.caddy` (idem `.web.caddy`), mêmes nom et domaines que S1-1. | Vide : identiques octet pour octet (critère 4). |
| S1-21 [M] | `sha256sum /opt/polenta/caddy-sites/_vitrine.caddy` avant `instance add`, après `add`, après `remove`. | Empreinte constante (critère 4). |
| S1-22 [M] | `curl -sk --resolve $D:443:127.0.0.1 -o /dev/null -w '%{http_code}' https://$D/api/healthz` ; idem `https://$W/healthz`. | `200` via le tiers (critère 5). |
| S1-23 [M] | `CADDY_RELOAD_CMD='echo x >> /tmp/reload.count'` ; supprimer `t1.caddy`, puis `instance sync t1` deux fois. | 1re exécution : un rechargement ; 2e : « déjà à jour », `/tmp/reload.count` inchangé (critère 8). |
| S1-24 [M] | `CADDY_RELOAD_CMD=false` ; `instance add t2 --domain <d2> --no-demo --yes`. | Échec ≠ 0 avec la sortie de la commande ; `t2.caddy` retiré ; `_vitrine.caddy` intact (critère 8). Reprise avec une commande valide : réussit. |
| S1-25 [M] | `CADDY_RELOAD_CMD=` (vide) ; supprimer `t1.caddy`, `instance sync t1`. | Un seul avertissement « blocs de site mis à jour dans /opt/polenta/caddy-sites : rechargez votre Caddy » ; bloc conservé (critère 8). |
| S1-26 [M] | `instance add` avec un domaine déjà déclaré dans `_vitrine.caddy`. | Rechargement refusé par le tiers (« ambiguous site definition ») : bloc retiré, sortie ≠ 0, message explicite. |

### Mode external : cycle de vie (critère 11)
| ID | Scénario | Attendu |
|---|---|---|
| S1-27 [M] | `instance stop t1`, requête via le tiers, puis `instance start t1`. | Bloc conservé pendant l'arrêt (502) ; `start` : `wait_edge_http` OK, `healthz` 200. |
| S1-28 [M] | `instance update t1 <version patch>` ; puis avec `POLENTA_TEST_FAIL_UPDATE=1`. | Mise à jour réussie, santé contrôlée par `wait_edge_http` ; retour arrière automatique avec le crochet de test (instance saine, bloc inchangé). |
| S1-29 [M] | `instance backup t1`, `instance remove t1 --confirm t1`, `instance restore t1 --from latest`. | `remove` : `t1.caddy` et `t1.web.caddy` supprimés, `_vitrine.caddy` intact, rechargement exécuté ; `restore` : instance de retour, sur `polenta-edge`, bloc recréé. |
| S1-30 [M] | `instance web disable t1`. | `t1.web.caddy` supprimé, `t1.caddy` conservé, rechargement exécuté ; aucun `docker network disconnect` émis. |
| S1-31 [M] | `polenta-host status` ; puis réseau supprimé. | « Caddy : externe (blocs dans /opt/polenta/caddy-sites, réseau polenta-edge) », jamais « arrêté » ; « réseau absent » en rouge si supprimé. |
| S1-32 [M] | Instance créée **avant** GH61 (migration RUNBOOK) : `instance sync t1`. | Conteneurs recréés ; `forgejo-t1` sur `polenta-edge` ; bloc réécrit dans `CADDY_SITES_DIR`. |
| S1-33 [M] | `docker stop tiers`, `docker network rm polenta-edge`, `instance start t1`. | Échec avec message « réseau … absent » et commande de création ; blocs inchangés. |

### Qualité
| ID | Scénario | Attendu |
|---|---|---|
| S1-34 [A] | `shellcheck -x deploy/polenta-host.sh deploy/lib/*.sh deploy/tests/*.sh`. | Aucun avertissement nouveau par rapport à `main` (critère 13). |
| S1-35 [A] | `deploy/tests/grant-template.test.sh`. | Vert (critère 13). |

## Sprint 2 — Preuves et RUNBOOK

| ID | Scénario | Attendu |
|---|---|---|
| S2-1 [A] | Hôte external préparé (tiers en place) : `sudo deploy/tests/acceptance-external.sh $D`. | Enchaîne les contrôles des critères 2 à 6 (aucun `polenta-caddy`, 80/443 ufw inchangés, blocs présents et `_*.caddy` intact, `healthz` 200 via le tiers, réseaux de la forge, aucun `network connect`) ; instance de test créée puis supprimée ; sortie 0. |
| S2-2 [A] | Même script avec un écart provoqué (`docker run -d --name polenta-caddy hello-world` avant lancement). | Sortie ≠ 0 au premier écart ; instance de test nettoyée (`trap`). |
| S2-3 [A] | `deploy/tests/acceptance.sh --external $D` depuis le poste de dev. | 22 ouvert ; 80/443 non exigés ; `2222 3000 5355 8080 2375` fermés ; en-têtes présents ; sortie 0 (critère 12). |
| S2-4 [A] | `deploy/tests/acceptance.sh $D` (sans option) sur l'hôte external. | Comportement inchangé : exige 80/443 (passe tant que le tiers les publie ; échoue sur « port 80 fermé » sinon). |
| S2-5 [M] | Relire `deploy/RUNBOOK.md` : section « Cohabitation avec d'autres projets dockerisés sur un même serveur », A1, A2, A10, A12. | Prérequis, exemple `host.env`, ligne `import`, exemple `CADDY_RELOAD_CMD`, limites d'isolation, migrations dans les deux sens, dépannage ; A1, A2, A10, A12 à jour (critère 14). |
| S2-6 [M] | Dérouler la migration managed → external du RUNBOOK mot pour mot sur une VM managed avec une instance, puis la procédure inverse. | Instance servie par le Caddy tiers à la fin, sans étape non documentée ; inverse idem. |
| S2-7 [A] | `shellcheck` et `grant-template.test.sh` après le sprint 2. | Verts (critère 13). |

## Matrice critères → scénarios

| Critère | Scénarios |
|---|---|
| 1 Défauts inchangés | S1-1, S1-2, S1-3 |
| 2 Aucun Caddy en external | S1-9, S2-1 |
| 3 80/443 non touchés | S1-10, S1-11, S2-1 |
| 4 Blocs de site | S1-16, S1-19, S1-20, S1-21, S1-29, S1-30 |
| 5 Routage | S1-22, S2-1 |
| 6 Réseau | S1-17, S1-18, S1-19, S2-1 |
| 7 Réseau absent | S1-13, S1-33 |
| 8 Rechargement | S1-23, S1-24, S1-25, S1-26 |
| 9 Validation de configuration | S1-4 à S1-7 |
| 10 Garde-fou de bascule | S1-14, S1-15 |
| 11 Cycle de vie | S1-27 à S1-32 |
| 12 Scénario d'acceptation | S2-1 à S2-4 |
| 13 Qualité | S1-34, S1-35, S2-7 |
| 14 RUNBOOK | S2-5, S2-6 |
