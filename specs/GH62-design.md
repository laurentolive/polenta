# GH62 — Design : durcissement de l'hôte en modules facultatifs

Références : `specs/GH62.md` (spec validée, défauts des « Questions ouvertes » confirmés),
`specs/GH45-design.md` §5, §12. Code concerné : `deploy/polenta-host.sh`, `deploy/lib/common.sh`,
`deploy/host.env.example`, `deploy/tests/`, `deploy/RUNBOOK.md`. Aucun code applicatif Polenta
(`apps/`) n'est touché : kit d'exploitation uniquement.

## 1. Fichiers à modifier ou créer

| Fichier | Nature | Pourquoi |
|---|---|---|
| `deploy/lib/modules.sh` | **nouveau** | Fonctions pures de résolution des modules (niveaux, `HOST_MODULES`, dépendances, paquets) : aucune dépendance à root, à `apt` ni à l'hôte, donc testables sur un poste de dev. Sourcé par `polenta-host.sh` après `common.sh`. |
| `deploy/lib/common.sh` | modifié | `load_host_env` (l. 113-127) lit en plus `HARDEN_HOST` et `HOST_MODULES` (variables `HARDEN_HOST_RAW`, `HOST_MODULES_RAW`), sans les valider (une valeur invalide ne doit pas faire échouer `instance add`, `status`…). Aucune autre modification. |
| `deploy/polenta-host.sh` | modifié | voir §1.1. |
| `deploy/host.env.example` | modifié | Blocs commentés `HARDEN_HOST` et `HOST_MODULES`. |
| `deploy/RUNBOOK.md` | modifié | A1 (niveau dans l'inventaire), A2 (choix du niveau, limites, retrait manuel par module, exécution du test `none`), A8 (`none`/`basic` : pas de fail2ban, `ADMIN_IPS` sans effet ; ports Docker contournant `ufw`). Texte : « d'autres projets dockerisés sur un même serveur ». |
| `deploy/tests/acceptance.sh` | modifié | Option `--harden-level none` / `ACCEPT_HARDEN=none` (§6). |
| `deploy/tests/harden-modules.test.sh` | **nouveau** | Test pur bash de `modules.sh`, modèle `grant-template.test.sh`. |
| `deploy/tests/harden-none.test.sh` | **nouveau** | Vérification sur l'hôte (root) du scénario `none` : contrôles des critères 2 à 4, sortie non nulle au moindre écart. |

### 1.1 `deploy/polenta-host.sh`

- **En-tête (l. 3-20)** : mentionner `HARDEN_HOST` dans l'aide de `setup` (l'aide est le bloc de
  commentaires, fonction `usage` l. 36).
- **`. lib/modules.sh`** après l. 28 (`source` de `backup.sh`), avec directive `shellcheck source=`.
- **`setup_packages` (l. 81-94)** : la liste `wanted` n'est plus constante ; elle devient
  `modules_packages` (socle + `restic` toujours, puis paquets des modules actifs, **dans l'ordre
  historique** `… restic ufw fail2ban python3-systemd unattended-upgrades apt-listchanges` pour que
  le message `paquets installés : …` reste identique en `full`). Ne retire jamais un paquet.
- **`setup_unattended` (l. 172-182)** : n'écrit `52polenta-unattended` que si le drapeau
  `unattended-reboot` est actif ; sinon message `ok` « mises à jour de sécurité automatiques (sans
  redémarrage automatique) ». Sortie `full` inchangée à l'octet.
- **`setup_firewall` (l. 143-153)** : seul le message de succès change quand `ufw` était déjà actif :
  « pare-feu : 22, 80, 443 ouverts (autres règles existantes conservées) » (question ouverte 7).
  Hôte neuf : message d'origine conservé (« seuls 22, 80, 443 ouverts »). Détection « était actif »
  = `ufw status` testé avant la première modification (variable `was_active`).
- **Nouveau `setup_firewall_warn` (lecture seule)** : si `ufw` présent et `Status: active`, vérifie
  80/tcp, 443/tcp, 443/udp dans `ufw status` ; sinon `warn` « ufw actif : Caddy sera injoignable
  depuis l'extérieur tant que 80/443 ne sont pas ouverts ». Appelé par `cmd_setup` quand `firewall`
  est hors ensemble. `command -v ufw` d'abord (`ufw` absent = rien).
- **`setup_fail2ban` / `setup_fail2ban_forge` (l. 155, 206)** : contenu inchangé.
- **Appels de `setup_fail2ban_forge` hors `setup`** : l. 633 (`instance add`), l. 789 (`instance
  restore`), l. 957 (`instance remove`) remplacés par `setup_fail2ban_forge_if_active` (§3).
- **`cmd_setup` (l. 278-296)** : réécrit autour de l'ordre canonique (§2). Séquence : `require_root;
  check_os` → `setup_host_env` → **`modules_resolve` (arrêt immédiat si invalide)** →
  `setup_install_kit` → `setup_packages` → `setup_docker` → modules dans l'ordre → avertissements
  (§4) → `caddy_up`. Ordre `full` identique à l'actuel : `resolved, firewall, console, fail2ban,
  unattended, ssh-hardening, backup-cron, fail2ban-forge`.
- **`cmd_status` (l. 1243)** : bloc « Durcissement » (§5), avant `cmd_instance_list`.
- **`main` (l. 1252)** : aucun changement (pas de nouvelle sous-commande).

## 2. Modules et dépendances (`deploy/lib/modules.sh`)

```
HOST_MODULE_ORDER=(resolved firewall console fail2ban unattended ssh-hardening backup-cron fail2ban-forge)   # exécution
HOST_MODULE_DISPLAY=(docker restic firewall fail2ban fail2ban-forge unattended ssh-hardening backup-cron resolved console)
HOST_MODULE_FIXED=(docker restic)            # toujours actifs, hors HOST_MODULES facultatif
HOST_MODULE_FLAGS=(unattended-reboot)        # sous-option, pas un module affiché
dépendances : fail2ban-forge -> fail2ban ; unattended-reboot -> unattended
```

Fonctions (sans effet de bord : résultat sur stdout, code de retour 0/1, message d'erreur dans la
variable `MODULES_ERR`) :

- `harden_level_normalize <valeur>` : minuscules, trim ; vide → `full` ; `full|basic|none` sinon
  code 1 et « HARDEN_HOST invalide : « x » — valeurs admises : full|basic|none ».
- `modules_for_level <niveau>` : liste selon le tableau de la spec ; `full` inclut le drapeau
  `unattended-reboot`, `basic` non.
- `modules_parse_list <csv>` : trim/minuscules de chaque élément, ignore les vides ; **nom inconnu**
  → code 1, « module inconnu : « bidule » (modules : …) ».
- `modules_check_deps <liste>` : « module fail2ban-forge : requiert fail2ban » (code 1).
- `modules_resolve` : lit `HARDEN_HOST_RAW` / `HOST_MODULES_RAW` ; calcule `HARDEN_LEVEL` (niveau
  configuré) et `HOST_MODULE_SET` (tableau associatif `nom → 1`, `docker` et `restic` toujours
  ajoutés) ; renvoie 0/1 sans `die` (l'appelant décide). Réinitialise l'état à chaque appel.
- `module_enabled <nom>` : appartenance à `HOST_MODULE_SET`.
- `modules_packages` : socle `ca-certificates curl jq dnsutils restic` + paquets des modules actifs
  (`firewall`→`ufw` ; `fail2ban`→`fail2ban python3-systemd` ; `unattended`→`unattended-upgrades
  apt-listchanges`), dans l'ordre historique.
- `module_detect <nom>` : voir §5.

`cmd_setup` : `modules_resolve || die "$MODULES_ERR"` (code 3, déjà géré par `on_error`). La
résolution a lieu **après** `setup_host_env` (qui ne crée que les dossiers du kit et `host.env`) mais
**avant** `setup_install_kit`, `apt-get` et tout `/etc` : critère 7 (aucun paquet, `host.env`
inchangé). Premier passage sans `host.env` : `setup_host_env` s'arrête déjà (comportement actuel).

## 3. Garde de `fail2ban-forge` hors `setup`

`setup_fail2ban_forge_if_active` (dans `polenta-host.sh`) :

1. `modules_resolve` ; erreur de configuration → sort silencieusement (jamais d'échec).
2. Sort si `fail2ban-forge` n'est pas dans `HOST_MODULE_SET`.
3. Sort si `fail2ban` n'est pas actif (`systemctl is-active --quiet fail2ban`) : module retiré à la
   main ou paquet absent.
4. Sinon appelle `setup_fail2ban_forge`.

Elle retourne toujours 0 : le résultat des commandes `instance` est inchangé. `cmd_setup` appelle
directement `setup_fail2ban_forge` (le module est déjà filtré par l'ordre canonique).

## 4. Rejeu, niveaux, avertissements de fin de `setup`

- Rejouabilité : chaque module garde son `write_if_changed` / `skip` actuel ; aucun redémarrage
  ajouté. `setup_firewall_warn` et les lignes `!` n'écrivent rien.
- Modules hors ensemble : `cmd_setup` n'appelle pas la fonction (ni message `skip`), hors les
  informations ci-dessous.
- **`ADMIN_IPS` ignoré** : si ni `fail2ban` ni `fail2ban-forge` n'est dans l'ensemble et `ADMIN_IPS`
  non vide, ligne d'information « ADMIN_IPS ignoré : fail2ban non géré par ce niveau » (stdout).
- **Modules actifs hors niveau** : pour chaque module facultatif hors ensemble mais détecté actif
  (`module_detect`), `warn` « module X actif sur l'hôte mais hors niveau <niveau> : conservé tel
  quel (procédure de retrait : RUNBOOK A2) ». Cas du drapeau : `52polenta-unattended` présent alors
  que `unattended-reboot` est absent → même ligne pour le redémarrage automatique 04:00.
- Code de sortie 0 dans tous ces cas (critères 10, 11).

## 5. Bloc « Durcissement » de `polenta-host status`

`module_detect <nom>` (lecture seule ; racine des chemins `POLENTA_ETC`, défaut `/etc`, variable
de test uniquement, pour tester sans root) :

| Module | Actif si |
|---|---|
| `docker` | `docker compose version` réussit |
| `restic` | `command -v restic` |
| `firewall` | `ufw` présent et `ufw status` commence par `Status: active` |
| `fail2ban` | `systemctl is-active --quiet fail2ban` **et** `jail.d/10-polenta-sshd.local` |
| `fail2ban-forge` | `jail.d/20-polenta-forge.local` contient `enabled = true` **et** `fail2ban` actif |
| `unattended` | `apt.conf.d/20auto-upgrades` présent (annotation « (redémarrage auto 04:00) » si `52polenta-unattended` présent) |
| `ssh-hardening` | `sshd_config.d/10-polenta.conf` présent |
| `backup-cron` | `/etc/cron.d/polenta` présent |
| `resolved` | `systemd/resolved.conf.d/10-polenta.conf` présent |
| `console` | `sysctl.d/10-polenta-console.conf` présent |

`cmd_status_hardening` : `modules_resolve` ; en cas d'erreur, une ligne « Durcissement : niveau
invalide : <valeur> » et retour 0 (le reste de `status` continue ; `load_host_env` ne valide rien).
Sinon en-tête « Durcissement : niveau <niveau> (HARDEN_HOST), <n> modules » (`n` = nombre de
modules de l'ensemble, 10 en `full` ; le drapeau n'est pas compté), puis une ligne par module dans
l'ordre `HOST_MODULE_DISPLAY` : `actif`/`inactif`, marqueur `(hors niveau)` (actif non prévu) ou
`(attendu, absent)` en rouge (`C_RED`, prévu mais inactif). Inactif et non prévu : neutre. Si
`HOST_MODULES` est défini, l'en-tête l'indique. Aucune écriture : `systemctl is-active`, `ufw
status`, `test -f` uniquement.

## 6. Mode `none` de `acceptance.sh`

Le script traite aujourd'hui tous ses arguments comme des domaines. Ajout d'un parseur d'options
avant la boucle : `--harden-level <full|basic|none>` ; variable `ACCEPT_HARDEN` en repli ; valeur
invalide → exit 2 avec les valeurs admises. Hors `full` : la section « Ports » (dernières lignes de
`check_instance`) est remplacée par un `pass` informatif « ports non vérifiés (niveau X) » ; HTTPS,
redirection, en-têtes, forge protégée (accueil, `/explore/repos`, API, inscription) sont conservés.
Par défaut (`full`), comportement strictement identique. Les contrôles sur l'hôte (critères 2 à 4)
sont dans `harden-none.test.sh`, pas dans ce script externe.

## 7. Décisions techniques et alternatives rejetées

1. **Bibliothèque `modules.sh` séparée de `common.sh`** : `common.sh` est aussi sourcé par
   `polenta-admin.sh`, qui n'a pas besoin des modules. Rejeté : tout mettre dans `polenta-host.sh`
   (non testable sans exécuter le script, qui lance `main "$@"` à la fin).
2. **Pas de validation dans `load_host_env`** : elle ferait échouer `instance add`, `status`, etc.
   sur une faute de frappe de `HARDEN_HOST`. La valeur brute est lue ; la résolution est explicite
   (`setup` fatale, `status` en affichage, garde forge silencieuse).
3. **Ajout automatique de `fail2ban` quand `fail2ban-forge` est demandé** : rejeté (spec : arrêt) ;
   un `HOST_MODULES` explicite n'installe pas ce qu'il n'a pas demandé.
4. **Sous-option `unattended-reboot`** (précision de la spec) : sans elle, `HOST_MODULES` ne pourrait
   pas exprimer « `unattended` sans redémarrage ». Absente d'une liste = pas de redémarrage (côté
   sûr). Rejeté : déduire du niveau configuré, ambigu avec une surcharge.
5. **Détection par fichiers du kit** (et non par état système) pour `ssh-hardening`, `resolved`,
   `console`, `unattended` : un `PermitRootLogin no` posé par un autre projet ne doit pas passer
   pour un module du kit. `firewall` fait exception (l'état d'`ufw` est ce qui compte).
6. **Aucun mode « défaire »** (hors scope) : lignes `!` + RUNBOOK A2.
7. **Niveau par `host.env` seul** (ni option CLI ni variable d'environnement : `sudo` les perd).
8. **Acceptation `none`** : option ajoutée au script externe (vue extérieure) **et** script hôte
   `harden-none.test.sh` (critère 13 : contrôles 2 à 4 exigent root, `dpkg`, `ufw`).
9. **`shellcheck`** non disponible sous Windows : `bash -n` sur le poste de dev, `shellcheck` sur
   l'hôte de test par l'Agent Dev (critère 13).

## 8. Risques

- Régression du comportement `full` : couverte par la comparaison de sortie et de fichiers (N12) et
  par `acceptance.sh` sans modification (N14).
- Tableau associatif bash (`declare -A`) : bash ≥ 4, présent sur Debian 12/13 et Ubuntu 24.04.

## 9. Évaluation du nombre de sprints : **2**

- **Sprint 1 — Modules et `setup`** : `lib/modules.sh`, lecture de `HARDEN_HOST` / `HOST_MODULES`,
  refactor de `cmd_setup`, `setup_packages`, `setup_unattended`, message de `setup_firewall`, garde
  `fail2ban-forge`, test pur `harden-modules.test.sh`, `host.env.example`. Critères 1, 2, 5, 6, 7, 8
  et 13 (test pur).
- **Sprint 2 — Observabilité, avertissements, tests d'hôte, docs** : `module_detect` et bloc
  `status`, avertissements `ufw` / `ADMIN_IPS` / modules hors niveau, `acceptance.sh
  --harden-level`, `harden-none.test.sh`, RUNBOOK A1/A2/A8. Critères 3, 4, 9, 10, 11, 12, 13, 14.

Le volume tiendrait presque en un sprint, mais le code touche la séquence de préparation de l'hôte
(risque de régression `full`) : le sprint 1 s'arrête sur une validation du comportement `full`
avant d'empiler le reste.
