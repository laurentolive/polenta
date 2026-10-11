# GH45 — Sprint S3 : infra d'exploitation

Périmètre : spec §9.2-9.9, design §5.7-5.9, tests S3-1 à S3-15.
Hôte de test : `vps-f515f9c6` (OVH, 4 Go, Debian 13), forges `acme` (Forgejo 15.0.9), `globex`
(Forgejo, mise à jour en 16.0.5), `gitea-test` (Gitea 28.1.0). Stockage des sauvegardes : Scaleway
Object Storage `fr-par`, bucket `polenta-sauvegardes`.

## Fichiers

Créés :

| Fichier | Rôle |
|---|---|
| `deploy/lib/backup.sh` | restic par instance : dépôt, sauvegarde (arrêt court), résolution et extraction de snapshot, date d'un snapshot, ping de supervision, nettoyage des dossiers temporaires |
| `deploy/RUNBOOK.md` | Partie A exploitant (A1-A14), partie B admin du client (B1-B6) |

Modifiés :
- `deploy/polenta-host.sh` : `instance backup|snapshots|keys|restore|update|export|remove`,
  `backup-cron` ; `setup` : cron 02:30 + logrotate, fail2ban des forges, console (`kernel.printk`),
  `ignoreip` ; `instance add` : première sauvegarde ; `instance_health` ;
- `deploy/polenta-admin.sh` : `access report [--csv]` ;
- `deploy/host.env.example` : `ADMIN_IPS`.

## Comportement implémenté

- **Sauvegarde** : arrêt de la forge, `restic backup` de `data/`, `instance.env`, `admin.log`,
  `polenta-config.json` (chemins relatifs, lancé depuis le dossier de l'instance), redémarrage si
  l'instance tournait, `LAST_BACKUP`. Tags `nightly`, `pre-update`, `manual`. Codes restic distingués :
  10 → création du dépôt, 12 → mot de passe incorrect (jamais de création), autre → stockage
  inaccessible.
- **Nocturne** (`backup-cron`, 02:30) : toutes les instances, l'échec de l'une n'arrête pas les autres,
  `restic unlock` (verrous périmés) puis `forget` (7/4/12), `--prune` le dimanche, ping `ok`/`fail`,
  journal `/var/log/polenta/host.log`.
- **`instance keys`** : mots de passe restic à conserver hors de l'hôte (rappelé par `instance add`).
- **Restauration** : snapshot et mot de passe vérifiés **avant** d'arrêter une instance remplacée ;
  extraction dans un dossier temporaire, puis arrêt, remplacement de `data/`, `instance.env` réécrit
  (nom, dossier, domaine, `LAST_BACKUP` = date du snapshot), journal de la forge renommé
  (`gitea.log.avant-restauration-<date>`), DNS vérifié, image, Caddy, `wait_https`, `polenta-config.json`,
  fail2ban. `--source` + `--domain` : copie sous un autre nom ; `--password-file` : hôte neuf.
- **Mise à jour** : `pull` d'abord (version absente → rien n'est modifié), sauvegarde `pre-update`,
  nouvelle version, santé + HTTPS ; en échec, restauration du snapshot `pre-update` et ancienne version.
  Crochet de test `POLENTA_TEST_FAIL_UPDATE=1` (échec simulé **après** démarrage de la nouvelle version).
- **Export** : `forgejo dump` (ou `gitea dump`), `data.tar.gz` (arrêt court), `instance.env` expurgé,
  `forge.env` au format `docker run --env-file`, `LISEZMOI.md` (procédure testée, port lié à
  `127.0.0.1`), `.sha256`, fichiers en 600. Une instance arrêtée est démarrée pour le dump puis
  laissée arrêtée.
- **Retrait** : confirmation par le nom (`--confirm <nom>` ou saisie), export, `compose down -v`, site
  Caddy, réseau, dossier ; fail2ban relu ; avertissement sur le dépôt restic conservé.
- **fail2ban** : jail `polenta-forge` (journaux de toutes les instances, liste réécrite à chaque
  `add`/`restore`/`remove`), échecs d'authentification web/git et créations de jeton refusées,
  `banaction = iptables-allports` + `chain = DOCKER-USER`, `datepattern`, 10 essais / 10 min / 1 h ;
  `ignoreip` = `ADMIN_IPS` (aussi pour `sshd`).
- **`access report`** : droit maximal par (utilisateur, repo), via équipes et collaborateurs directs.

## Divergences par rapport à la spec et au design

| Point | Design | Réalisé | Raison |
|---|---|---|---|
| Ordre de `update` | sauvegarde puis `pull` | `pull` puis sauvegarde | Une version absente ne coûte ni arrêt ni snapshot (critère 17 « rien n'a changé ») |
| Jail | `polenta-forgejo`, glob `forgejo.log`, `iptables-allports[chain=DOCKER-USER]` | `polenta-forge`, liste explicite des `gitea.log`, `chain` séparé, `datepattern` | Nom réel du journal ; paramètre `chain` ignoré dans `banaction` (règle tombée dans INPUT → SSH bloqué) ; dates non lues → vieux échecs recomptés |
| Commandes | — | `instance snapshots`, `instance keys`, `backup-cron` | Exploitation (liste, mots de passe hors hôte, cron) |
| `instance add` | — | première sauvegarde | UC1 « première sauvegarde vérifiée » |
| Console | — | `kernel.printk = 3 4 1 3` | Les journaux du pare-feu rendaient la console KVM inutilisable |

## Incidents pendant la campagne

1. **Exploitant bloqué en SSH** (2026-10-10) : la jail des forges a posé sa règle dans `INPUT`
   (`chain` ignoré) et compté d'anciens échecs relus après une restauration (dates non lues). Console
   KVM inutilisable (messages du noyau, clavier QWERTY). Résolu en changeant d'IP (partage mobile).
   Corrigé : `chain = DOCKER-USER`, `datepattern`, journal restauré renommé, `ADMIN_IPS`, `printk`.
   RUNBOOK §A8.
2. **Snapshot jugé « illisible »** au premier retour arrière : chemins relatifs à la racine du snapshot.
   Le script s'arrêtait avant de toucher aux données. Corrigé (recherche de `instance.env`).
3. **Verrou restic périmé** après la réinstallation (opération interrompue sur l'ancien système) : la
   rétention échouait. Corrigé (`restic unlock` avant `forget`).
4. **`config.yaml` jamais créé** sur une instance neuve : Forgejo répond `200 []` (et non 404) au
   contenu d'un repo vide. Corrigé (test du type de la réponse) ; `instance sync` répare les instances
   concernées. L'application lit `/raw/` (404) et n'était pas touchée.

## Revue de code

Revue du diff S3 complet (kit). Corrigé :

| # | Constat | Correction |
|---|---|---|
| 1 | `restore --force` arrêtait l'instance avant de vérifier mot de passe et snapshot : une erreur la laissait arrêtée | Vérification d'abord ; arrêt seulement après extraction réussie (paramètre `stop` de `restore_snapshot_to`) — testé : instance toujours `healthy` |
| 2 | Messages bruts (`Erreur inattendue (code 12)`) sur mauvais mot de passe / snapshot inconnu | `resolve_snapshot` traduit les codes restic, « rien n'a été modifié » |
| 3 | Export/retrait impossibles sur une instance arrêtée | Démarrage pour le dump, puis instance laissée arrêtée — testé |
| 4 | Dossiers temporaires d'export/restauration (secrets) laissés sur erreur | `CLEANUP` + `trap EXIT` — testé : aucun résidu |
| 5 | `LISEZMOI` : `-p 3000:3000` publiait la forge en HTTP sur toutes les interfaces | `-p 127.0.0.1:3000:3000` |
| 6 | Instance arrêtée affichée `unhealthy` ; une instance `unhealthy` en service n'était pas relancée après sauvegarde | `instance_health` renvoie l'état du conteneur s'il est arrêté ; relance si le conteneur tournait |
| 7 | `LAST_BACKUP` faux après restauration / retour arrière | Date du snapshot restauré |
| 8 | Bruit de `forgejo dump` à l'écran | Journal affiché seulement en cas d'échec |

Non corrigé (accepté) : `update --all` s'arrête à la première instance en échec (après son retour
arrière), comme prévu au design ; la purge du dépôt restic d'un client retiré reste manuelle
(volontaire, RUNBOOK §A7).

shellcheck : aucun avertissement (`polenta-host.sh`, `polenta-admin.sh`, `lib/*.sh`,
`tests/acceptance.sh`).

## Tests

| ID | Résultat |
|---|---|
| S3-1 | ✓ `backup --all` : un snapshot par instance, coupure ~11-14 s chacune, `LAST_BACKUP` affiché |
| S3-2 | ✓ mot de passe d'une autre instance refusé, message clair, aucun dépôt créé |
| S3-3 | ✓ une instance en échec n'empêche pas les autres ; ping `/fail` ; `host.log` |
| S3-4 | ✓ `acme` restaurée en `acme-restore` (autre domaine) en 27 s : 8 repos, 19 comptes, 2FA conservée |
| S3-5 | ✓ `update acme 99.99.99` : rien n'a changé, message |
| S3-6 | ✓ `globex` 15.0.9 → 16.0.5 ; sonde `acme` 139 requêtes, 0 échec |
| S3-7 | ✓ retour arrière forcé 15.0.9 → 16.0.5 → 15.0.9, données identiques (8 repos, 19 comptes), 44 s |
| S3-8 | ✓ archive + `.sha256` valide ; `forge-dump`, `data`, `forge.env`, `instance.env` sans `OPS_*`/`RESTIC_PASSWORD`, `LISEZMOI` |
| S3-9 | ✓ export remonté hors kit avec l'image officielle `forgejo:16.0.5` selon `LISEZMOI` : santé OK, `temoin-avant-maj` et `polenta-config` présents |
| S3-10 | ✓ `remove globex` : export, plus de conteneur/réseau/site/dossier ; sonde `acme` 143/143 ; site `www` jamais coupé |
| S3-11 | ✓ 10 échecs → IP bannie dans `DOCKER-USER` (HTTPS bloqué, SSH ouvert), levée par `unbanip` ; reconfirmé après réinstallation |
| S3-12 | ✓ `access report --csv` cohérent avec les équipes |
| S3-13 | ✓ réinstallation complète (Debian 13.6) : `setup` 1 min 48, `restore` `acme` 34 s / `gitea-test` 36 s depuis S3 avec `--password-file` ; site `www.esquaresoft.fr` republié (certificats réémis) ; suite d'intégration S2 (`forge-smoke`, 22 scénarios : connexion, 2FA, clone/push, lecteur refusé, compte désactivé, reconnexion) **verte sur les deux forges** ; refus propre d'un OS non supporté (Debian 11, installé par erreur) |
| S3-14 | À faire : relecture du RUNBOOK par le demandeur |
| S3-15 | À faire avant le premier client : réinstallation propre |

## Mises à jour SPEC

Aucune au S3 (les mises à jour SPEC de GH45 sont groupées au S4, design §10).
