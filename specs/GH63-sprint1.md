# GH63 — Sprint 1 : scripts du kit (sans service ni interface)

Périmètre : `specs/GH63-design.md` §7 Sprint 1. Scénarios : `specs/GH63-tests.md` §Sprint 1.

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `deploy/lib/common.sh` | Codes de sortie par cause (§5.5, `E_*`), `die [code] message` (marque propre au processus : plus de « Erreur inattendue » répétée), `parse_global_opts` (`--json`, `--non-interactive`, `--confirm`), `emit_result` (fd 3, ou `POLENTA_RESULT_FILE`, sinon stdout), `redact` (journal masqué en `--json` / mode administration), `confirm` sans attente en non interactif, verrou `acquire_lock` (`flock` sur `/opt/polenta/.lock`, `.lock.owner` JSON), `SIGTERM` → 10, `require_operator`, `dns_verdict` (extrait de `check_dns_points_here`, messages inchangés), réglages `ADMIN_UI` / `ADMIN_INSTANCE` / `ADMIN_AGENT_SOCKET` lus et validés, `EXIT_HOOKS`. |
| `deploy/lib/backup.sh` | Nettoyage branché sur `EXIT_HOOKS` (le piège EXIT est celui de `common.sh`, qui libère aussi le verrou). |
| `deploy/lib/s3.sh` (nouveau) | Requêtes S3 signées par `curl --aws-sigv4`, identifiants passés par `-K -` : test de clé, liste paginée, suppression ; lecture de secrets sur un descripteur (`s3_read_fd`). |
| `deploy/polenta-host.sh` | Options globales dans `main`. Verrou sur toutes les commandes qui modifient l'hôte. `status --json`, `instance list --json`, `instance snapshots --json`, `dns check <domaine> [--json]`, `exports list|delete`, `s3-key rotate`, `s3-purge`. `instance add` : 13 si existante, 14 si image introuvable, mot de passe temporaire seulement dans le résultat en `--json`, jeton de service. `instance remove` : `--confirm <nom>` (3), export obligatoire (6), refus pour `ADMIN_INSTANCE` (18). `instance update` : 14 / 17, `--version` accepté, résultat avec l'instantané `pre-update`. `instance restore` : sauvegarde `pre-restore` avant remplacement. `instance backup --tag` validé, 6 sans stockage. `web.env` : `POLENTA_ADMIN_URL` et `POLENTA_ADMIN_SERVICE_TOKEN` si `ADMIN_UI=on`. Avertissements shellcheck existants corrigés. |
| `deploy/polenta-admin.sh` | Options globales, `require_operator`, verrou sur les écritures. `user import <csv> [--preview]` (validation commune, limites 5 Mo / 2 000 lignes, BOM), `access-report --json`, `invite <login>`. Mots de passe hors journal en `--json`. |
| `deploy/host.env.example` | `ADMIN_UI`, `ADMIN_INSTANCE`, `ADMIN_AGENT_SOCKET`, `BACKUP_S3_REGION`. |
| `deploy/forge-versions.json` (nouveau) | Versions de forge proposées (défaut = `DEFAULT_FORGE_VERSION`). |
| `deploy/tests/*.test.sh` (nouveaux) | `lib-common`, `host-json`, `host-ops`, `host-s3`, `admin-users`, `host-admin-env`. |

## Comportement

- Usage SSH : mêmes commandes, mêmes questions interactives, mêmes messages. Nouveau : une
  question posée alors que l'entrée est fermée sort en 3 au lieu d'échouer en « erreur inattendue ».
- `--json` : résultat sur le descripteur 3, journal humain inchangé sur stdout/stderr, mais masqué
  (`password|secret|token|key…=***`). Le résultat n'est jamais masqué : c'est le seul endroit où
  figurent les mots de passe temporaires.
- Verrou : une opération concurrente sort en 5 en quelques millisecondes, avec l'opération,
  l'origine, l'acteur et l'heure (`POLENTA_ORIGIN` / `POLENTA_ACTOR`, posés par le futur service ;
  `ssh` / `SUDO_USER` sinon). Les lectures ne le prennent pas.
- Purge S3 : aperçu (`--preview`, clé nocturne, lecture) puis purge avec la clé de purge lue sur un
  descripteur et la phrase `--confirm "supprimer définitivement les sauvegardes de <nom>"`.

## Divergences par rapport au design

1. **Empreinte du jeton de service** : SHA-256 au lieu de scrypt (D5). Le jeton est un aléa de
   256 bits, pas un mot de passe humain : une fonction lente n'apporte rien contre une recherche
   exhaustive, et le kit n'a pas d'outil scrypt sans exposer le secret en argument. Le service
   (sprint 2) comparera l'empreinte SHA-256 à temps constant.
2. **Verrou et `kill -9`** (S1-11) : `flock` est libéré quand le script **et ses sous-processus**
   ont disparu. Si seul le script est tué, un sous-processus encore actif (restic, docker) garde le
   verrou : la commande suivante sort en 5 avec « opération interrompue (pid … arrêté) dont des
   sous-processus tiennent encore le verrou ». Rien n'est forcé. Le test tue le groupe de processus.
3. **Purge S3** par requêtes S3 directes (curl signé) et non par restic, qui ne sait pas effacer un
   dépôt entier.
4. **Code de sortie par défaut** : une erreur expliquée non classée sort désormais en 1 (avant : 3
   pour toutes). 3 est réservé à la confirmation (§5.5).
5. **`instance update --all`** : chaque instance garde son retour arrière propre ; la première
   version introuvable arrête la boucle (14), comme avant.

## Tests

Automatiques, en root dans un conteneur Debian 13 jetable (`jq`, `curl`, `procps`, `iproute2`) :
`lib-common` (39), `host-json` (26), `host-ops` (35), `admin-users` (22), `host-admin-env` (13),
`host-s3` (32, contre un stockage S3 de test SeaweedFS). Tous verts. `shellcheck -x -S warning`
sur `deploy/` : zéro avertissement (S1-17).

Non exécutés dans ce sprint (hôte réel nécessaire) :
- S1-2 `instance add --non-interactive --json` complet, S1-6 retour arrière d'une mise à jour, la
  partie « sauvegarde de contrôle » de S1-7 avec de vraies instances ;
- S1-16 `acceptance.sh` (inchangé dans ce sprint) contre un hôte ;
- S1-18 manuel : usage SSH historique.

## Comment tester manuellement (hôte de test, jamais la production)

```bash
sudo polenta-host status --json 3>&1 >/dev/null | jq .
sudo polenta-host dns check forge.exemple.fr --json 3>&1 >/dev/null | jq .
sudo polenta-host instance remove t1 --non-interactive            # → 3, rien supprimé
sudo polenta-host instance update acme 99.0.0                     # → 14, rien modifié
sudo polenta-host s3-key rotate                                   # saisie interactive, clé testée d'abord
sudo polenta-host s3-purge ancien --preview
sudo polenta-admin --instance acme user import users.csv --preview --json 3>&1 >/dev/null | jq .
# deux sauvegardes simultanées : la seconde sort en 5 en moins d'une seconde
sudo polenta-host instance backup acme & sudo polenta-host instance backup acme; echo $?
```

Tests du kit (poste de développement avec Docker) :

```bash
docker run --rm -v "$PWD/deploy:/kit:ro" debian:13 bash -c \
  'apt-get update -qq && apt-get install -y -qq jq curl procps iproute2 >/dev/null && \
   for t in lib-common host-json host-ops admin-users host-admin-env; do bash /kit/tests/$t.test.sh || exit 1; done'
```
