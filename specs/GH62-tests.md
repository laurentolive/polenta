# GH62 — Scénarios de test : durcissement de l'hôte en modules

Références : `specs/GH62.md` (critères 1–14), `specs/GH62-design.md`.

Légende :
- **[A]** test automatique (script du dépôt, sans hôte réel ou depuis le poste de dev) ;
- **[H]** à exécuter sur un hôte de test (`sudo` requis) ;
- **[M]** test manuel (relecture).

Environnement :
- VM de test `vm-harden`, Debian 13 neuve, sans `ufw`/`fail2ban`/`unattended-upgrades`, utilisateur
  sudo `admin` avec clé SSH autorisée, DNS `*.forge.<domaine>` vers la VM, `host.env` rempli ;
  snapshot avant chaque scénario `[H]` ;
- variante `vm-harden-ufw` : même VM avec `ufw` actif et la seule règle `8443/tcp` (plus 22/tcp) ;
- `H(niveau)` = fixer le niveau : `sudo sed -i '/^HARDEN_HOST=/d' /opt/polenta/host.env && echo
  HARDEN_HOST=<niveau> | sudo tee -a /opt/polenta/host.env`.

## Tests purs (sans root) — `deploy/tests/harden-modules.test.sh`

| ID | Scénario | Attendu |
|---|---|---|
| N1 [A] | `harden_level_normalize` avec `""`, `full`, ` FULL `, `Basic`, `none`. | `full`, `full`, `full`, `basic`, `none` ; code 0. |
| N2 [A] | `harden_level_normalize strict`. | Code 1 ; message contient `full\|basic\|none` et `strict`. |
| N3 [A] | `modules_for_level full`, `basic`, `none` comparés au tableau de la spec. | `full` = 8 facultatifs + drapeau `unattended-reboot` ; `basic` = `fail2ban fail2ban-forge unattended backup-cron`, sans drapeau ; `none` = `backup-cron` seul ; `docker restic` ajoutés par `modules_resolve` dans les trois cas. |
| N4 [A] | `HOST_MODULES=fail2ban-forge`, sans `fail2ban`. | Code 1 ; message nomme `fail2ban-forge` et `fail2ban`. |
| N5 [A] | `HOST_MODULES=bidule`. | Code 1 ; message nomme `bidule`. |
| N6 [A] | `HOST_MODULES=" Firewall , fail2ban,,fail2ban-forge "`. | Code 0 ; ensemble = `firewall fail2ban fail2ban-forge docker restic` (espaces, casse, éléments vides tolérés). |
| N7 [A] | `HOST_MODULES=firewall` avec `HARDEN_HOST=none`. | Ensemble = `firewall docker restic` : la surcharge remplace ; `HARDEN_LEVEL` reste `none` ; `backup-cron` absent. |
| N8 [A] | `HOST_MODULES=unattended`, puis `unattended,unattended-reboot`, puis `unattended-reboot` seul. | Pas de drapeau ; drapeau ; le dernier : code 1, requiert `unattended`. |
| N9 [A] | `modules_packages` pour `full`, `basic`, `none`. | `full` : `ca-certificates curl jq dnsutils restic ufw fail2ban python3-systemd unattended-upgrades apt-listchanges` (ordre historique) ; `basic` : sans `ufw` ; `none` : socle + `restic` seulement. |
| N10 [A] | `module_detect` avec `POLENTA_ETC=<dossier temporaire>` contenant (ou non) chaque fichier de configuration du kit. | `actif`/`inactif` conforme au tableau du design §5 pour `ssh-hardening`, `backup-cron`, `resolved`, `console`, `unattended` (+ annotation de redémarrage). |
| N11 [A] | `bash -n deploy/polenta-host.sh deploy/lib/*.sh deploy/tests/*.sh` ; `shellcheck deploy/**/*.sh` (sur l'hôte). | Aucune erreur ni avertissement. |

## Critère 1 — `full` identique

| ID | Scénario | Attendu |
|---|---|---|
| N12 [H] | VM neuve, `HARDEN_HOST` absent : `sudo ./polenta-host.sh setup \| tee s-avant.txt` avec le kit de `main` ; restaurer le snapshot, relancer avec le kit GH62 (`\| tee s-apres.txt`). Comparer `sudo find /etc/ufw /etc/fail2ban /etc/ssh/sshd_config.d /etc/apt/apt.conf.d/20auto-upgrades /etc/apt/apt.conf.d/52polenta-unattended /etc/systemd/resolved.conf.d /etc/sysctl.d/10-polenta-console.conf /etc/cron.d/polenta /etc/logrotate.d/polenta -type f -exec sha256sum {} +` entre les deux. | Diff vide ; `diff s-avant.txt s-apres.txt` vide (même ordre, mêmes messages). |
| N13 [H] | Idem avec `HARDEN_HOST=` (vide) puis `HARDEN_HOST=full`. | Même résultat que N12. |
| N14 [A] | `deploy/tests/acceptance.sh acme.forge.<d>` depuis le poste de dev, après N12. | Toutes les vérifications passent, script appelé sans option. |

## Critères 2, 4, 13 — niveau `none` sur hôte nu

| ID | Scénario | Attendu |
|---|---|---|
| N15 [H] | `H(none)`, `sudo ./polenta-host.sh setup`. | Sortie 0. `command -v ufw` vide ; `dpkg-query -W fail2ban ufw unattended-upgrades` code ≠ 0 pour les trois ; `/etc/ssh/sshd_config.d/10-polenta.conf` absent ; `/etc/fail2ban` absent ; `20auto-upgrades` et `52polenta-unattended` absents ; aucun `10-polenta*` sous `resolved.conf.d` / `sysctl.d`. |
| N16 [H] | Même hôte : `docker compose version`, `restic version`, `ls /etc/cron.d/polenta /etc/logrotate.d/polenta`, `docker ps --filter name=caddy`. | Tout présent ; Caddy en service. |
| N17 [H] | `sudo polenta-host instance add acme --domain acme.forge.<d> --org acme --client-admin alice alice@…` puis `instance backup acme`. | Les deux réussissent (code 0) ; aucun fichier créé sous `/etc/fail2ban` ; aucune erreur fail2ban. |
| N18 [H] | `instance restore acme --from latest --force`, puis `instance remove acme`. | Réussissent ; `/etc/fail2ban` toujours absent ; aucune erreur fail2ban. |
| N19 [H] | `sudo deploy/tests/harden-none.test.sh` sur l'hôte des N15–N18. | Une ligne ✓ par contrôle (critères 2 à 4) ; code 0. Après création manuelle de `/etc/fail2ban/x` : code ≠ 0 avec la ligne ✗ correspondante. |

## Critère 3 — `none` sur hôte au pare-feu actif

| ID | Scénario | Attendu |
|---|---|---|
| N20 [H] | `vm-harden-ufw` : `ufw status verbose > ufw-avant.txt` ; `sshd -T \| grep -E 'permitrootlogin\|passwordauthentication' > sshd-avant.txt` ; `H(none)` ; `setup` ; mêmes commandes vers `-apres`. | `cmp ufw-avant.txt ufw-apres.txt` et `cmp sshd-avant.txt sshd-apres.txt` : identiques ; aucune commande `ufw` lancée par le kit. |

## Critère 5 — `basic`

| ID | Scénario | Attendu |
|---|---|---|
| N21 [H] | VM neuve, `H(basic)`, `setup`. | Sortie 0 ; `systemctl is-active fail2ban` = active ; `fail2ban-client status` liste `sshd` et `polenta-forge` ; `20auto-upgrades` présent ; `52polenta-unattended` **absent** ; `command -v ufw` vide ; `10-polenta.conf` (SSH) absent ; ni `resolved.conf.d/10-polenta.conf` ni `sysctl.d/10-polenta-console.conf`. Sortie « sans redémarrage automatique ». |
| N22 [H] | `H(basic)` puis `instance add acme …`. | `fail2ban-client get polenta-forge logpath` contient le journal de `acme`. |

## Critère 6 — rejeu

| ID | Scénario | Attendu |
|---|---|---|
| N23 [H] | Pour `full`, `basic`, `none` (VM neuve chacun) : relever `systemctl show -p ActiveEnterTimestamp docker fail2ban ssh` (fail2ban absent en `none`) ; relancer `setup \| tee rejeu.txt` ; relever à nouveau. | Aucune ligne `✓` dans `rejeu.txt` (que des `· … (déjà fait)`, avertissements `!` ou informations) ; timestamps identiques ; sortie 0. |

## Critères 7 et 8 — valeurs invalides

| ID | Scénario | Attendu |
|---|---|---|
| N24 [H] | VM neuve, `host.env` présent, `H(strict)` ; `sha256sum host.env` ; `sudo ./polenta-host.sh setup ; echo $?`. | Code ≠ 0 ; message « HARDEN_HOST invalide : « strict » — valeurs admises : full\|basic\|none » ; `dpkg-query -W ufw fail2ban restic` échoue ; pas de `/opt/polenta/kit` ; pas de `/etc/docker` ; `sha256sum` de `host.env` inchangé. |
| N25 [H] | `HARDEN_HOST=full`, `HOST_MODULES=fail2ban-forge`, `setup`. | Code ≠ 0 ; message nomme `fail2ban-forge` et « requiert fail2ban » ; aucun paquet installé. |
| N26 [H] | `HOST_MODULES=bidule`, `setup`. | Code ≠ 0 ; message nomme `bidule` et liste les modules connus ; aucun paquet installé. |
| N27 [H] | `HARDEN_HOST=" NONE "` (espaces, casse). | Accepté comme `none` (code 0, comportement N15). |

## Critère 9 — `status`

| ID | Scénario | Attendu |
|---|---|---|
| N28 [H] | Après N12 (`full`) : `sudo polenta-host status`. | Bloc « Durcissement : niveau full (HARDEN_HOST), 10 modules » ; tous les modules `actif`, dont `ssh-hardening` (clé autorisée), annotation « (redémarrage auto 04:00) » ; sans clé autorisée : `ssh-hardening  inactif  (attendu, absent)` en rouge. |
| N29 [H] | Après N21 (`basic`). | `docker restic fail2ban fail2ban-forge unattended backup-cron` actifs ; `firewall ssh-hardening resolved console` inactifs **sans marqueur** ; pas d'annotation de redémarrage. |
| N30 [H] | Après N15 (`none`). | Actifs : `docker restic backup-cron` ; tous les autres `inactif`, neutres. |
| N31 [H] | Après N12 (`full`), passer `host.env` à `none` **sans** rejouer `setup`, puis `status`. | Les modules actifs autres que `docker restic backup-cron` portent `(hors niveau)`. |
| N32 [H] | `full` établi, supprimer `/etc/cron.d/polenta` à la main, `status`. | `backup-cron  inactif  (attendu, absent)` en rouge ; `setup` rejoué le restaure. |
| N33 [H] | `find /etc /opt/polenta -type f -newer <repère>` et `systemctl show -p ActiveEnterTimestamp fail2ban ssh docker` avant/après `status`. | Aucun fichier modifié, aucun service redémarré. |
| N34 [H] | `H(strict)` puis `status`. | Ligne « Durcissement : niveau invalide : strict » ; le reste (hôte, Caddy, instances) affiché ; code 0. |
| N35 [H] | `HOST_MODULES=firewall,fail2ban` puis `status` (sans `setup`). | En-tête mentionne `HOST_MODULES` ; `fail2ban-forge` actif porte `(hors niveau)` ; modules prévus et actifs sans marqueur. |

## Critère 10 — changement de niveau

| ID | Scénario | Attendu |
|---|---|---|
| N36 [H] | `full` établi (N12), `ufw status > a.txt`, `H(none)`, `setup`, `ufw status > b.txt`. | `cmp a.txt b.txt` identiques ; `10-polenta.conf` (SSH), jails fail2ban, `52polenta-unattended` toujours présents, fail2ban actif ; une ligne `!` par module actif hors niveau (`firewall`, `fail2ban`, `fail2ban-forge`, `unattended`, `ssh-hardening`, `resolved`, `console`) citant « RUNBOOK A2 » ; sortie 0. |
| N37 [H] | `full` → `basic`, `setup`. | Ligne `!` signalant le redémarrage automatique 04:00 conservé ; `52polenta-unattended` toujours présent. |
| N38 [H] | `none` établi → `full`, `setup`. | Modules manquants appliqués (lignes `✓`), aucun `!`. |

## Critères 11 et 12 — avertissements

| ID | Scénario | Attendu |
|---|---|---|
| N39 [H] | `vm-harden-ufw` (règle `8443/tcp` seule, pas de 80/443), `H(basic)` puis `H(none)`, `setup`. | Avertissement « ufw actif : Caddy sera injoignable depuis l'extérieur tant que 80/443 ne sont pas ouverts » ; `ufw status` inchangé ; sortie 0. |
| N40 [H] | `ufw` actif avec 80/tcp, 443/tcp, 443/udp autorisés, niveau `none`. | Pas d'avertissement. |
| N41 [H] | `ufw` absent ou inactif, niveau `none`. | Pas d'avertissement. |
| N42 [H] | `H(none)` avec `ADMIN_IPS=203.0.113.7`. | Information « ADMIN_IPS ignoré : fail2ban non géré par ce niveau ». |
| N43 [H] | `ADMIN_IPS=203.0.113.7` en `full` puis `basic`. | Pas de message ; `ignoreip` des deux jails contient `203.0.113.7`. |

## Cas d'usage restants

| ID | Scénario | Attendu |
|---|---|---|
| N44 [H] | `vm-harden-ufw`, `H(full)`, `setup`. | `ufw status` : règle `8443/tcp` conservée, 22/80/443 ajoutées ; politique par défaut du `ufw` actif inchangée ; message « 22, 80, 443 ouverts (autres règles existantes conservées) ». |
| N45 [H] | `full`, sans clé dans `authorized_keys`, puis avec clé. | Sans clé : avertissement « SSH non durci », `sshd_config` intact ; avec clé : durcissement, `sshd -t` avant rechargement (comportement GH45 identique). |
| N46 [H] | `H(none)` : exécuter `sudo polenta-host backup-cron`. | Sauvegarde réussie sans fail2ban ni `ufw`. |

## Critère 13 — outillage de test

| ID | Scénario | Attendu |
|---|---|---|
| N47 [A] | `deploy/tests/harden-modules.test.sh` sur le poste de dev, sans root. | N1–N10 verts, code 0 ; un test volontairement cassé (dépendance retirée de `modules.sh`) → code ≠ 0. |
| N48 [A] | `deploy/tests/acceptance.sh --harden-level none acme.forge.<d>` contre un hôte `none` (port 8443 ouvert exprès) ; idem avec `ACCEPT_HARDEN=none`. | HTTPS, en-têtes, forge protégée contrôlés ; aucun contrôle de ports ; pas d'échec pour un port supplémentaire ouvert. |
| N49 [A] | `acceptance.sh --harden-level strict …`. | Code 2 et message des valeurs admises. |
| N50 [M] | Relire le RUNBOOK A2. | La procédure d'exécution de `harden-none.test.sh` y figure, commandes copiables. |

## Critère 14 — documentation

| ID | Scénario | Attendu |
|---|---|---|
| N51 [A] | `grep -n -E 'HARDEN_HOST\|HOST_MODULES' deploy/host.env.example`. | Blocs commentés : valeurs `full\|basic\|none`, défaut `full`, tableau abrégé ; `HOST_MODULES=` commenté et vide. |
| N52 [M] | Relire `deploy/RUNBOOK.md` A1, A2 (choix du niveau, limites, retrait manuel par module), A8 (`none`/`basic`, `ADMIN_IPS`, ports Docker contournant `ufw`). | Conforme à la spec ; formule « d'autres projets dockerisés sur un même serveur » utilisée. |
| N53 [A] | Recherche insensible à la casse du nom d'un projet tiers dans `specs/GH62*.md` et `deploy/` (`git grep -n -i <nom>`). | Aucune occurrence. |

## Matrice critères → scénarios

| Critère | Scénarios |
|---|---|
| 1 | N12, N13, N14 |
| 2 | N15, N19 |
| 3 | N20 |
| 4 | N16, N17, N18, N19 |
| 5 | N21, N22 |
| 6 | N23 |
| 7 | N2, N24, N27 |
| 8 | N4, N5, N25, N26 |
| 9 | N10, N28 à N35 |
| 10 | N36, N37, N38 |
| 11 | N39, N40, N41 |
| 12 | N42, N43 |
| 13 | N11, N19, N47, N48, N49, N50 |
| 14 | N51, N52, N53 |
