# GH61 — Design technique : Caddy et réseau Docker optionnels (hôte partagé)

Références : `specs/GH61.md` (validée, défauts de « Questions ouvertes » confirmés), `specs/GH45-design.md`.
Aucun code applicatif (`apps/`, `packages/`) n'est touché : uniquement le kit `deploy/`.

## 1. Fichiers à modifier

| Fichier | Fonction / zone | Modification | Pourquoi |
|---|---|---|---|
| `deploy/lib/common.sh` | `load_host_env` (l.113) ; constantes `DEFAULT_*` en tête | Lit `CADDY_MODE`, `EDGE_NETWORK`, `CADDY_SITES_DIR`, `CADDY_RELOAD_CMD` ; défauts (`managed`, `polenta-edge`, `/opt/polenta/caddy-sites`, vide) ; valide : mode ∈ {managed, external}, `EDGE_NETWORK` ~ `^[a-zA-Z0-9][a-zA-Z0-9_.-]*$`, `CADDY_SITES_DIR` absolu. Refus par `die` en français avant toute action. | Point d'entrée commun des `cmd_*` : la validation précède toute modification (critère 9). |
| `deploy/lib/caddy.sh` | `caddy_render_compose` (l.~35, `name: polenta-edge`) | `name: ${EDGE_NETWORK}` (identique par défaut). | Nom configurable en managed sans changer le rendu par défaut. |
| | `caddy_add_site`, `caddy_add_web_site`, `caddy_remove_site`, `caddy_remove_web_site` (l.~140-195) | Utilisent `caddy_sites_dir` (nouveau : `$POLENTA_CADDY/etc/sites` en managed, `$CADDY_SITES_DIR` en external) et le nouveau `site_apply` (factorise les deux blocs `add` dupliqués). `caddy_render_site` / `caddy_render_web_site` inchangées : contenu identique octet pour octet (critère 4). | §2.2-3 et 2.2-4. |
| | `caddy_write_compose`, `caddy_connect_network`, `caddy_disconnect_network` | Retour immédiat en external (aucun fichier Caddy, aucun `docker network connect`). | Critères 2 et 6. |
| | nouvelles fonctions | `site_apply`, `external_reload`, `edge_network_require`, `wait_edge_http`, `caddy_external_guard` (voir §2). | Logique « external » regroupée dans le module Caddy. |
| `deploy/polenta-host.sh` | `setup_firewall` (l.143) | En external : règle `22/tcp` seule, message « pare-feu : seul 22 ouvert (Caddy externe : 80/443 non gérés) » ; ne supprime ni ne remplace aucune règle. | Critère 3. |
| | `cmd_setup` (l.275) | `host.env` est créé par `setup_host_env` : validation (même code que `load_host_env`) juste après. En external : `caddy_external_guard` en tout début (refus avant toute modification, critère 10), `edge_network_require`, création de `CADDY_SITES_DIR` (root, 755), affichage de la ligne `import`, pas de `caddy_up`. En managed : refus si 80/443 sont occupés par un autre processus que `polenta-caddy` (`ss -ltnH`) quand `polenta-caddy` n'existe pas. | §2.2-1, §2.3. |
| | `inst_compose` (l.298) | En external : ajoute `-f $KIT_DIR/instance/docker-compose.external.yml` et exporte `EDGE_NETWORK` pour l'interpolation compose. | Rattachement à `EDGE_NETWORK` (§2.2-2), voir §3. |
| | `wait_https` (l.405) | Inchangée. Nouveau wrapper `wait_front <nom> <domaine> [timeout] [chemin]` : managed → `wait_https`, external → `wait_edge_http`. Remplace les appels l.623, 775, 813, 819, 1128. | Un seul point de bascule. |
| | `cmd_instance_add` (l.553) | `edge_network_require` avant tout effet (après validation du nom, avant `check_dns_points_here` l.591) ; en external, le contrôle DNS est remplacé par `skip "DNS : géré par votre Caddy"` ; message final : `https://<domaine>` non vérifié (certificat dépendant du Caddy existant). | Critère 7 ; le DNS peut viser un autre proxy. |
| | `cmd_instance_restore` (l.727), `cmd_instance_update` (l.~800-820), `cmd_instance_start` (l.1233), `web_start` (l.1115), `cmd_instance_remove` (l.942), `cmd_instance_web_enable` (l.1132) / `web_disable` (l.1163) | Même traitement : `edge_network_require` en entrée des commandes qui démarrent des conteneurs ; `wait_front` ; contrôle DNS neutralisé en external (`restore`, `web enable`). | §2.2-6. |
| | `cmd_instance_sync` (l.660) | En external uniquement : `inst_compose up -d` (recrée les conteneurs d'une instance antérieure pour les rattacher à `EDGE_NETWORK`) puis `caddy_add_site` (réécriture du bloc). | §2.3 « instances créées avant la fonctionnalité » et migration. |
| | `cmd_status` (l.1248) | En external : « Caddy : externe (blocs dans <dossier>, réseau <EDGE_NETWORK>) » ; « réseau absent » en rouge si `docker network inspect` échoue. | §2.2-7. |
| `deploy/instance/docker-compose.external.yml` | **nouveau** | Surcharge compose : `forgejo` et `polenta-web` rejoignent `edge` ; réseau `edge` en `external: true`, `name: ${EDGE_NETWORK}`. | Voir §3. |
| `deploy/instance/docker-compose.yml` | commentaire d'en-tête uniquement | Mentionne la surcharge ; services et réseaux **inchangés**. | Garantit le critère 1. |
| `deploy/host.env.example` | fin de fichier | Section commentée « Cohabitation avec d'autres projets dockerisés » : 4 clés, défauts, prérequis (Caddy existant sur `EDGE_NETWORK`). | §3 de la spec. |
| `deploy/tests/acceptance.sh` | `check_instance` (ports, HTTP→HTTPS) + analyse d'arguments | Option `--external` : 80/443 non exigés, 22 exigé, `2222 3000 5355 8080 2375` fermés, test HTTP→HTTPS sauté. Sans option : inchangé. | Critère 12. |
| `deploy/tests/acceptance-external.sh` | **nouveau** | Scénario sur l'hôte (critères 2 à 6), instance de test créée puis supprimée (`trap`), code non nul au premier écart. | Critère 12. |
| `deploy/RUNBOOK.md` | A1, A2, A10, A12 + nouvelle section (A16, pour ne pas renuméroter les renvois existants) | Voir critère 14 de la spec. | Critère 14. |
| `specs/SPEC-INDEX.md` | ligne SPEC-WEB | Référence à GH61 si la ligne existe. | Convention du dépôt. |

## 2. Nouvelles variables et interfaces

| Variable | Défaut | Porté par | Notes |
|---|---|---|---|
| `CADDY_MODE` | `managed` | `host.env` → `load_host_env` | Variable shell globale, comme `CADDY_VERSION`. |
| `EDGE_NETWORK` | `polenta-edge` | idem ; exportée vers compose par `inst_compose` | Utilisée aussi par `caddy_render_compose` (managed). |
| `CADDY_SITES_DIR` | `/opt/polenta/caddy-sites` | idem | Utilisée uniquement en external. |
| `CADDY_RELOAD_CMD` | vide | idem | Exécutée en root via `bash -c`, sortie affichée seulement en cas d'échec. |

Interfaces internes (shell) :

- `caddy_sites_dir` : imprime le dossier de blocs selon le mode.
- `site_apply <fichier> <contenu> <libellé>` : `write_if_changed` ; si modifié, rechargement (`caddy_reload` en managed, `external_reload` en external). Rechargement refusé : fichier retiré, nouveau rechargement, `die` avec la sortie. Fichier inchangé : aucun rechargement (idempotence, critère 8).
- `external_reload` : commande vide → un seul avertissement par processus ; sinon exécute la commande ; échec → code 1 et sortie sur stderr.
- `edge_network_require` : no-op en managed ; en external `docker network inspect "$EDGE_NETWORK"`, sinon `die` citant le réseau et `docker network create <réseau>`.
- `wait_edge_http <nom> <cible> <chemin> [timeout]` : `docker run --rm --network "$EDGE_NETWORK" --entrypoint wget <image forge de l'instance> -qO- -T 5 http://<cible><chemin>`, boucle de 5 s. L'image est déjà présente (celle de la forge, dont le healthcheck utilise `wget`) ; pour le client web seule la joignabilité réseau de `polenta-web-<nom>:8787` compte.
- `caddy_external_guard` : en external, `die` si le conteneur `polenta-caddy` existe et tourne.
- Aucune nouvelle sous-commande.

## 3. Décisions techniques et alternatives rejetées

1. **Surcharge compose `docker-compose.external.yml`**. Compose n'inclut pas un réseau conditionnellement ; modifier le compose managed risquerait le critère 1 et exigerait `polenta-edge` même en managed. Avec un second `-f`, le fichier managed reste inchangé et les listes `networks` des services sont fusionnées (le service garde `default`, gagne `edge`). Rejeté : fichier unique avec réseau `external: true` toujours déclaré (échec en managed si le réseau n'existe pas).
2. **`EDGE_NETWORK` passé par l'environnement du processus compose**, pas écrit dans `instance.env` : une valeur par instance figerait le réseau à la création et casserait la migration ; `host.env` est la source unique.
3. **Pas de création du réseau en external** (spec §2.3) : il appartient à l'exploitant, le Caddy existant y est déjà. En managed il reste créé par le compose Caddy.
4. **Rechargement par commande générique** `CADDY_RELOAD_CMD` (validé). Rejeté : `EXTERNAL_CADDY_CONTAINER` (couplage au nom d'un conteneur tiers, ne couvre pas systemd).
5. **Sonde réseau interne** `wait_edge_http` (validé). Rejeté : sonde `https://` (dépend du DNS, du certificat et d'un éventuel proxy amont).
6. **Rollback du bloc de site conservé** : sans lui, un bloc refusé (« ambiguous site definition ») bloquerait tous les rechargements suivants du Caddy existant, y compris pour les autres projets.
7. **Garde-fou de bascule** : refus plutôt que migration à chaud (deux Caddy sur 80/443). Détection par `docker inspect polenta-caddy`.
8. **`setup_fail2ban_forge` inchangé** : la chaîne `DOCKER-USER` ne dépend pas du Caddy ; l'IP cliente vient de `X-Forwarded-For` du Caddy existant (noté au RUNBOOK).
9. **Isolation en external** : acceptée et documentée (spec §2.2-8). Rejeté : réseau par instance avec proxy rattaché dynamiquement (hors scope).

Risques : (a) fusion des `networks` par compose : kit déjà dépendant de compose v2, couvert par S1-17 ; (b) `ss` (iproute2) présent sur Debian 13 / Ubuntu 24.04, vérifié par `require_cmd`.

## 4. Découpage en sprints : **2 sprints**

Évaluation : ~8 fichiers modifiés et 2 créés, logique concentrée dans `caddy.sh` et `polenta-host.sh` ; le volume restant (RUNBOOK, scénarios hôte) dépend du comportement stabilisé et se sépare proprement.

- **Sprint 1 — noyau** : `common.sh`, `caddy.sh`, `polenta-host.sh`, `docker-compose.external.yml`, `host.env.example`. Vérifiable seul : critères 1 à 11 et 13. Le comportement par défaut (managed) ne change pas.
- **Sprint 2 — preuves et doc** : `acceptance.sh --external`, `acceptance-external.sh`, RUNBOOK (A1, A2, A10, A12, nouvelle section), SPEC-INDEX ; critères 12 à 14.
