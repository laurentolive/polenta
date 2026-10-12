# GH63 — Scénarios de test : administration du serveur depuis Polenta

Références : `specs/GH63.md` (critères 1–20, UC1–UC7), `specs/GH63-design.md`.

Légende : **[A]** automatique (vitest `apps/admin-service/test`, `apps/desktop/src/web-server/**/*.test.ts`,
`deploy/tests/acceptance.sh`, `deploy/tests/lib-*.test.sh`) ; **[E2E]** Playwright
(`apps/desktop/e2e-web/gh63-*.spec.ts`, faux service admin) ; **[M]** manuel sur hôte réel.

Environnement : hôte de test Debian 13 avec instances `acme` (client web actif, ORG `acme`) et `globex`
(ORG `globex`) ; instance d'exploitation `ops` (`ADMIN_INSTANCE=ops`). Comptes : `alice` propriétaire
d'`acme`, `bob` membre non propriétaire d'`acme`, `carl` désactivé, `olga` propriétaire de `ops`,
`gina` propriétaire de `globex`. Stockage S3 de test (MinIO). Valeurs sentinelles : `SENTINEL-<nom>`.

## Sprint 1 — Scripts du kit

### Nominal
| ID | Scénario | Attendu |
|---|---|---|
| S1-1 [A] | `polenta-host instance list --json`, `status --json`, `instance snapshots acme --json`. | JSON valide (`jq .`) sur le descripteur de résultat ; le journal humain reste sur stdout/stderr ; `status --json` liste les modules actifs (#62), Caddy, versions. |
| S1-2 [A] | `polenta-host instance add t1 --non-interactive --json …`. | Aucun `read` (stdin fermé), sortie 0 ; résultat : URL, comptes, mot de passe temporaire **uniquement** dans le résultat, absent du journal. |
| S1-3 [A] | `instance remove t1` sans `--confirm`, puis `--confirm autre`, puis `--confirm t1`. | Sorties 3, 3, 0 ; seule la troisième supprime ; export préalable exigé (sinon 6). |
| S1-4 [A] | `dns check forge.exemple.fr --json` sur les 4 cas (résout, ne résout pas, pointe ailleurs, AAAA incohérent). | Verdicts `ok`, `no-resolve`, `elsewhere`, `aaaa-mismatch` identiques à `check_dns_points_here` ; enregistrement à créer affiché ; aucune requête hors résolveur public (trace réseau). |
| S1-5 [A] | `instance update acme --version <v-inexistante>`. | Sortie 14 ; « rien n'a été modifié » ; instance intacte. |
| S1-6 [A] | `POLENTA_TEST_FAIL_UPDATE=1 instance update acme --version <v>`. | Sortie 17 ; version et données d'avant ; instantané `pre-update` cité dans le résultat. |
| S1-7 [A] | `s3-key rotate` avec clé invalide, puis avec clé valide mais `POLENTA_TEST_FAIL_KEYCHECK=1`, puis nominale. | Sorties 16 (rien modifié), 19 (clé précédente restaurée, `host.env` identique octet pour octet), 0. |
| S1-8 [A] | `s3-purge acme` sans clé de purge, avec instance existante, sans confirmation, sans export (sans `--sans-export`). | Refus 6/3 à chaque cas ; rien supprimé dans le bucket. |

### Verrou et concurrence
| ID | Scénario | Attendu |
|---|---|---|
| S1-9 [A] | Deux `instance backup acme` simultanés. | Le second sort 5 en < 1 s, message avec opération, origine, depuis quand (`.lock.owner`). |
| S1-10 [A] | Lectures (`list`, `snapshots`, `dns check`) pendant un verrou pris. | Réussissent sans attendre. |
| S1-11 [A] | Tuer le script verrouillant (`kill -9`). | Verrou libéré (flock) ; `.lock.owner` périmé ignoré (pid absent). |

### Cas limites et sécurité
| ID | Scénario | Attendu |
|---|---|---|
| S1-12 [A] | `--non-interactive` avec une commande qui demanderait confirmation. | Sortie 3, jamais d'attente sur stdin. |
| S1-13 [A] | Journal d'un `instance add` : recherche de `password|secret|token|key` en clair et du mot de passe temporaire. | Aucune valeur ; motifs masqués (`***`). |
| S1-14 [A] | `s3-purge` : `ps -ef`, `/proc/<pid>/cmdline` et `environ` pendant l'exécution. | La clé de purge n'y figure pas ; transmise par descripteur ; aucun fichier écrit sur disque (`find / -newer` + `grep`). |
| S1-15 [A] | Import CSV (`user import --preview --json`) : 200 lignes dont 3 invalides ; fichier de 5,1 Mo ; 2 001 lignes ; BOM UTF-8. | Aperçu : 197 valides, 3 rejetées avec ligne et cause, équipes inconnues listées ; > 5 Mo ou > 2 000 lignes refusé (sortie 2) avant traitement ; BOM accepté. |
| S1-16 [A] | `acceptance.sh` existant (modes par défaut, `external`, `none`). | Passe **sans modification** (critère 16). |
| S1-17 [A] | `shellcheck deploy/**/*.sh`. | Zéro avertissement. |
| S1-18 [M] | Usage SSH historique : `instance add`, `backup`, `restore` interactifs. | Comportement identique à avant (confirmations interactives, sortie colorée). |

## Sprint 2 — Service `polenta-admin` et proxy Docker

### Nominal
| ID | Scénario | Attendu |
|---|---|---|
| S2-1 [M] | Installer le module `admin`, `docker compose -p polenta-admin ps`. | `polenta-admin` et `polenta-docker-proxy` en service ; aucun port publié ; aucune route Caddy. |
| S2-2 [A] | `POST /jobs {operation:'backup.run', instance:'acme'}` avec jeton d'`acme` + jeton utilisateur d'`alice`. | 202 ; état `running` → `succeeded` ; `GET jobs/:id/log` rend le journal ; instantané créé. |
| S2-3 [A] | Même appel, puis `kill` du service en cours de travail et redémarrage. | Le travail reprend en suivi (processus fils indépendant) ou, si le processus a disparu, `interrupted` ; jamais bloqué `running`. |
| S2-4 [A] | `docker restart polenta-web-acme` pendant un travail. | Suivi retrouvé après retour du web avec le même `jobId`. |
| S2-5 [A] | Travail interrompu par le redémarrage de l'hôte (`boot_id` différent). | `interrupted` ; verrou levé ; ligne d'audit. |

### Autorisation et cloisonnement (critère 2)
| ID | Scénario | Attendu |
|---|---|---|
| S2-6 [A] | Jeton de service de `globex` visant `acme`, utilisateur propriétaire d'`acme`. | 403 ; aucun travail créé ; état d'`acme` inchangé (comparaison `instance list --json` avant/après) ; audit `refused`. |
| S2-7 [A] | Jeton d'`acme`, opération « hôte » (`host.setup`, `s3.rotate`, `instance.add`). | 403. |
| S2-8 [A] | Jeton d'`ops` + propriétaire d'`ops` visant `acme`, puis hôte. | 202 (niveau hôte). |
| S2-9 [A] | Jeton valide, `X-Polenta-Forge-Token` absent, invalide, ou d'un non-propriétaire (`bob`). | 401 / 401 / 403. |
| S2-10 [A] | `X-Polenta-Actor: alice` annoncé avec le jeton de `bob`. | 403 (revérification auprès de la forge : l'affirmation n'est pas crue). |
| S2-11 [A] | Propriétaire retiré de l'équipe, jeton révoqué : requête suivante après 5 s ; opération destructive dans les 60 s. | Lecture : refusée après ≤ 60 s ; destructive : refusée immédiatement (pas de cache). |
| S2-12 [A] | 30 jetons erronés en 1 min. | Limiteur : 429 ; jeton valide toujours accepté depuis une autre source. |
| S2-13 [A] | Comparaison de jetons à temps constant (revue + test `timingSafeEqual`). | Utilisé ; jetons stockés hachés (aucune valeur claire dans `/opt/polenta/admin/`). |

### Proxy Docker (critère 3)
| ID | Scénario | Attendu |
|---|---|---|
| S2-14 [A] | `docker inspect polenta-admin` : montages et `HostConfig`. | Pas de `/var/run/docker.sock` ; `Privileged=false`, `CapAdd` vide, `CapDrop=[ALL]`, `no-new-privileges`, `User=1500`. |
| S2-15 [A] | Via le proxy : `containers/create` avec `Privileged:true` ; avec `Binds:["/:/host"]` ; avec `Binds:["/etc:/x"]` ; avec `NetworkMode:host` ; `CapAdd:[SYS_ADMIN]`. | Chaque cas : 403, motif journalisé. |
| S2-16 [A] | Via le proxy : `POST /build`, `swarm/init`, `volumes/create` (nom hors `polenta-*`), `plugins/install`, `containers/prune`, chemin inconnu. | 403. |
| S2-17 [A] | Via le proxy : `ps`, `inspect`, `logs`, `exec`, `start/stop/restart` sur `forgejo-acme`, `docker compose up/down/pull` d'un projet `polenta-*`. | Autorisés (200/201/204). |
| S2-18 [A] | `exec`/`stop` visant un conteneur étranger (`autre-projet-db`, projet dockerisé voisin). | 403. |

### Travaux et verrou
| ID | Scénario | Attendu |
|---|---|---|
| S2-19 [A] | `POST /jobs` pendant un travail mutant. | 409 avec `runningJob {operation, actor, since}` ; aucun nouveau travail. |
| S2-20 [A] | Travail SSH en cours (`polenta-host instance backup acme`), puis `POST /jobs`. | 409 ; `GET /jobs` liste le travail « externe » (origine `ssh`). |
| S2-21 [A] | Lectures (liste, snapshots, DNS) pendant le verrou. | 200, sans verrou. |
| S2-22 [A] | Annulation : `backup.run` annulé ; `forge.update`, `backup.restore` annulés. | Premier : `cancelled`, forge redémarrée, dépôt restic déverrouillé ; autres : 409 « non annulable » (aucun signal envoyé). |
| S2-23 [A] | Mise à jour échouée (`POLENTA_TEST_FAIL_UPDATE=1`). | État `rolled-back` ≠ `failed`, `result.restoredVersion`, fin du journal de la forge (critère 8). |
| S2-24 [A] | Rétention : 250 travaux de 100 jours + 10 récents. | Purge des travaux > 90 jours **et** > 200 ; `audit.log` intact. |

### Confirmations et refus (critère 9)
| ID | Scénario | Attendu |
|---|---|---|
| S2-25 [A] | `instance.remove` sans `confirm`, avec `confirm:true`, avec un autre nom, avec le nom exact. | 400, 400, 400, 202 (API directe sans interface). |
| S2-26 [A] | `instance.remove ops` depuis `ops` ; `web.disable ops` depuis le client web d'`ops` ; `host.reboot` pendant un travail ; arrêt de l'instance d'exploitation depuis elle-même. | Refus explicites (code 18 / 409) ; audit `refused`. |
| S2-27 [A] | Paramètres : nom d'instance `../x`, `A;rm`, domaine `a b`, version `latest`, IP `1.2.3`. | 400 ; rien exécuté (aucun `argv` construit à partir d'une chaîne non validée). |

## Sprint 3 — Agent hôte

| ID | Scénario | Attendu |
|---|---|---|
| S3-1 [M] | `ss -xlpn` / `ss -tlnp` pour `polenta-host-agent` ; `stat /run/polenta/agent.sock`. | Un seul socket Unix `0660 root:polenta-agent` ; aucun port TCP/UDP ouvert (critère 4). |
| S3-2 [A] | Envoi des six actions valides. | Réponses `ok` ; `host.status` renvoie les modules actifs. |
| S3-3 [A] | Action inconnue (`host.exec`), paramètre supplémentaire, `fail2ban.unban` avec `1.2.3`, `1.2.3.4; reboot`, `::gg`, chaîne vide, 10 Ko. | `{ok:false, error:'invalid'}` ; rien exécuté (journal de l'agent, processus). |
| S3-4 [A] | `fail2ban.unban 203.0.113.9` puis `2001:db8::1`. | IPv4 et IPv6 débloquées dans `polenta-forge` et `sshd` ; `fail2ban-client status` confirme. |
| S3-5 [A] | Revue de l'unité : `systemd-analyze security polenta-host-agent`. | `NoNewPrivileges`, `ProtectSystem=strict`, `RestrictAddressFamilies=AF_UNIX`, pas de réseau ; score documenté. |
| S3-6 [M] | `host.reboot` depuis le service (confirmation = nom d'hôte). | Trace écrite avant l'appel ; travail `rebooting` ; après retour (≤ 15 min) `succeeded` ; `boot_id` différent ; verrou levé (critère 6). |
| S3-7 [M] | Hôte qui ne revient pas (simulé : `REBOOT_WAIT_MIN=1`, agent arrêté après). | `failed` avec consigne console KVM (RUNBOOK A8). |
| S3-8 [A] | `host.setup` avec module `ssh-hardening` actif, sans `sshHardeningConfirmed`, puis confirmé. | Refus 3 / exécution ; le script garde sa règle « ne jamais enfermer » (aucune clé → pas de modification). |
| S3-9 [A] | Agent arrêté (`systemctl stop`) : `GET /me`. | `agent: 'absent'` ; actions agent refusées avec 503 explicite ; opérations hors agent OK (critère 14). |
| S3-10 [A] | Agent absent et module `fail2ban` non installé (#62, `HARDEN_HOST=none`). | `fail2ban.unban` et `firewall.status` refusées (module absent) ; aucune installation implicite. |

## Sprint 4 — Web-server et renderer

### Droit et visibilité (critère 1)
| ID | Scénario | Attendu |
|---|---|---|
| S4-1 [E2E] | Connexion `alice` (propriétaire d'`acme`). | Entrée « Administration » dans le menu compte ; page ouvre ; niveau `instance`. |
| S4-2 [E2E] | Connexion `bob` (membre non propriétaire). | Aucune entrée ; aucune erreur console ; `GET /admin/api/me` = 403 ; `/admin/api/jobs` = 403. |
| S4-3 [A] | `carl` (compte désactivé), session `print: true`, session `dev` avec `NODE_ENV=production`. | 403/404 sur chaque route `/admin/api/*`. |
| S4-4 [A] | `POLENTA_WEB_ADMIN_DEV=1` en mode `dev` ; même variable avec `NODE_ENV=production`. | Accès en dev pour les tests ; **démarrage refusé** en production. |
| S4-5 [E2E] | `olga` (propriétaire d'`ops`). | Niveau `host` : pages Hôte et sélecteur d'instance visibles. |
| S4-6 [E2E] | Desktop (`platform !== 'web'`). | Aucune entrée Administration ; aucune requête `/admin/api` (critère 19). |
| S4-7 [A] | `ADMIN_UI=off` / service injoignable. | `/admin/*` 404 / entrée masquée proprement (pas de bouton mort, pas d'erreur console). |
| S4-8 [A] | `channel-policy` : aucune entrée `admin:*` ; `POST /rpc/admin:anything`. | Refusé comme tout channel inconnu ; la suite desktop passe sans importer le code admin (critère 19). |
| S4-9 [A] | Sans CSRF sur `POST /admin/api/jobs` ; session expirée. | 403 (CSRF) ; 401. |

### Cloisonnement de bout en bout (critère 2)
| ID | Scénario | Attendu |
|---|---|---|
| S4-10 [E2E] | `alice` forge la requête `POST /admin/api/jobs {instance:'globex'}` avec le cookie d'`acme`. | 403 ; état de `globex` inchangé. |
| S4-11 [E2E] | `alice` : opération « hôte » en API directe. | 403. |
| S4-12 [A] | Le web-server d'`acme` configuré avec le jeton de service de `globex`. | Refus du service (403) pour toute cible ≠ `globex` ; l'utilisateur d'`acme` n'est pas propriétaire de `globex` (revérification) : 403. |

### Opérations courantes (critère 5, UC1, UC2, UC7)
| ID | Scénario | Attendu |
|---|---|---|
| S4-13 [E2E] | Liste des instances, état, disque, dernière sauvegarde. | Une ligne par instance (niveau hôte) ou sa ligne (niveau instance) ; égale à `instance list --json`. |
| S4-14 [E2E] | Lancer une sauvegarde, fermer l'onglet, rouvrir. | Travail retrouvé avec état et journal (critère 6). |
| S4-15 [E2E] | Mise à jour : choisir une version épinglée ; avertissement « la connexion sera interrompue » ; échec forcé. | Écran `rolled-back` distinct (« revenue en X avec les données d'avant, instantané Y ») ; version inchangée. |
| S4-16 [E2E] | Second travail pendant un premier (autre navigateur, autre administrateur). | Bandeau global ; refus 409 « opération X en cours (lancée par Y à HH:MM) » avec lien de suivi. |
| S4-17 [E2E] | Ajouter une instance : DNS ne résout pas. | Pré-contrôle bloque avant lancement avec IP attendue/trouvée ; aucun travail. |
| S4-18 [E2E] | Vérification DNS des 4 verdicts. | Verdict, enregistrement à créer, réponse du résolveur public ; aucun bouton « appliquer chez le fournisseur ». |
| S4-19 [E2E] | Activer / désactiver le client web d'une autre instance ; désactiver le sien. | OK / **refusé** avec explication « depuis un autre accès ». |
| S4-20 [E2E] | Agent absent : page Hôte. | Quatre actions grisées, explication et **commande SSH équivalente** ; autres actions actives (critère 14). |
| S4-21 [E2E] | `CADDY_MODE=external` et `HARDEN_HOST=none` simulés. | Libellé « à importer par votre Caddy » ; fail2ban, pare-feu, `ADMIN_IPS` absents ou grisés ; aucune action ne propose de créer Caddy ni de toucher 80/443, SSH, fail2ban (critère 15). |
| S4-22 [E2E] | Annulation d'une sauvegarde ; bouton absent pour la mise à jour. | `cancelled` ; pas de bouton pour les non annulables, avec explication. |
| S4-23 [E2E] | Accessibilité : confirmation par saisie du nom au clavier seul ; annonce `aria-live` des états de travail. | Navigable sans souris ; changements d'état annoncés ; focus piégé dans la boîte de confirmation. |
| S4-24 [E2E] | Bascule fr/en. | Aucune chaîne en dur (test de clés i18n) ; textes complets dans les deux langues. |
| S4-25 [A] | Panne du service interne en cours de session. | Message d'erreur clair, aucune fuite de jeton ou d'en-tête dans la réponse. |

## Sprint 5 — Opérations sensibles et fonctions sans équivalent Forgejo

### Secrets (critères 10, 11, 12)
| ID | Scénario | Attendu |
|---|---|---|
| S5-1 [A] | Injecter `SENTINEL-S3SECRET`, `-S3NEW`, `-PURGEKEY`, `-OPSTOKEN`, `-OAUTHSECRET`, `-SESSIONSECRET`, `-SERVICETOKEN`, `-USERTOKEN`, exécuter toutes les opérations, puis `grep -r` des réponses HTTP, journaux de travaux, audit, logs `polenta-web`/`polenta-admin`/proxy/agent. | Zéro occurrence. |
| S5-2 [E2E] | « Afficher la clé » restic sans confirmation, avec mauvais nom, avec le bon nom (niveau hôte). | Refus ×2 ; clé affichée masquée avec copie et téléchargement ; réponse `Cache-Control: no-store` ; rien dans le journal du travail ; audit « clé affichée » (acteur, instance, heure, **sans valeur**). |
| S5-3 [A] | Relire `/jobs/:id/secret` une seconde fois ; après 10 min. | 404 les deux fois ; fichier supprimé. |
| S5-4 [A] | Mot de passe temporaire après `instance add` / import CSV. | Visible une fois (résultat à usage unique) ; absent du journal, de l'audit, du résultat persisté. |
| S5-5 [E2E] | Remplacer la clé S3 : clé invalide ; puis valide avec échec de la sauvegarde de contrôle. | Rien modifié (`host.env` inchangé) ; puis clé précédente restaurée, état `rolled-back` ; affichage « …XYZ » (4 derniers caractères) sans jamais renvoyer la valeur. |
| S5-6 [E2E] | Remplacer la clé S3 nominale. | Test d'objet de contrôle, sauvegarde `key-rotation` de toutes les instances, `restic check` ; `succeeded` ; non annulable après l'étape 2. |
| S5-7 [E2E] | Purge S3 sans clé de purge ; avec instance existante ; sans les deux temps de confirmation ; sans export. | Refus pour chacun ; avec `--sans-export` coché, avertissement affiché. |
| S5-8 [M] | Purge nominale (instance supprimée, export présent, nom + phrase, liste lue avant). | Nombre d'instantanés, taille, dates extrêmes affichés avant ; suppression ; audit sans clé ; `ps`/`/proc` sans clé, rien sur disque (critère 12). |
| S5-9 [A] | Clé de purge non conservée : redémarrage du service puis lecture de `/opt/polenta/admin/` et `host.env`. | Aucune trace de la clé de purge. |

### Restauration, export, client web
| ID | Scénario | Attendu |
|---|---|---|
| S5-10 [E2E] | Restaurer sur l'instance existante : prévisualisation, confirmation par le nom cible. | Sauvegarde `pre-restore` automatique, puis restauration ; données conformes à l'instantané ; état final identique à la commande SSH (critère 5). |
| S5-11 [M] | Restaurer sous un autre nom/domaine. | Copie de contrôle fonctionnelle ; instance d'origine inchangée. |
| S5-12 [E2E] | Export de restitution, téléchargement en flux d'une archive de 2 Go. | Mémoire du service stable (< 100 Mo de plus) ; `Content-Disposition` ; somme de contrôle égale ; droit revérifié à chaque téléchargement. |
| S5-13 [A] | Lien de téléchargement réutilisé après 10 min, ou depuis une autre session. | 403 ; archive intacte. |
| S5-14 [E2E] | Suppression de l'archive (confirmation simple) ; annulation d'un export en cours. | Archive supprimée, audit ; fichier partiel supprimé après annulation. |
| S5-15 [E2E] | Suppression d'instance sans export préalable. | Refusée avec message « exporter d'abord » ; avec export : confirmation par le nom, suppression ; sauvegardes S3 conservées. |

### Utilisateurs (critère 17, UC5)
| ID | Scénario | Attendu |
|---|---|---|
| S5-16 [E2E] | Import CSV de 200 lignes dont 3 invalides : aperçu puis import. | Aperçu : 197 valides, 3 rejetées avec ligne et cause, équipes inconnues ; import : 197 comptes créés, rapport ligne par ligne ; aucun mot de passe dans le journal ; CSV de mots de passe téléchargeable une seule fois ; fichier déposé supprimé. |
| S5-17 [A] | Fichier > 5 Mo ; > 2 000 lignes ; non UTF-8 ; colonne manquante ; doublons de login ; BOM. | Refus avant traitement (taille/lignes) ; rejets avec cause (colonne, doublon) ; BOM accepté. |
| S5-18 [E2E] | Avec SMTP configuré : import. | Mots de passe envoyés par la forge, non affichés. |
| S5-19 [E2E] | Rapport d'accès croisé : filtre par utilisateur/dépôt, export CSV. | Tableau utilisateur × dépôt × droit ; CSV identique à l'affichage ; lecture seule, sans verrou. |
| S5-20 [E2E] | Message d'invitation pour un compte créé dans la session, puis pour un ancien compte. | Premier : lien `polenta://connect?server=…&login=…` + mot de passe temporaire + `POLENTA_DOWNLOAD_URL` ; second : sans mot de passe, proposition « réinitialiser dans Forgejo ». |
| S5-21 [E2E] | Lien « Administration de Forgejo ». | Ouvre la forge de l'instance dans un nouvel onglet (`noopener`) ; aucune fonction de comptes/équipes/dépôts reproduite. |

### Audit (critère 13)
| ID | Scénario | Attendu |
|---|---|---|
| S5-22 [A] | Une opération réussie, échouée, refusée (droit), refusée (confirmation), annulée, 409. | Une ligne d'audit chacune avec acteur, instance d'origine, IP, opération, cible, résultat ; paramètres expurgés ; sans secret. |
| S5-23 [A] | Tentative de modification de `audit.log` par le service (réécriture, troncature). | Impossible (ouverture `O_APPEND` seule ; `chattr +a` quand disponible) ; revue de code : aucune API de modification. |
| S5-24 [E2E] | Journal : `alice` (niveau instance) puis `olga` (hôte) ; export CSV. | Alice : ses seules lignes ; Olga : toutes ; CSV conforme ; commandes SSH marquées `origin: ssh`. |

### Équivalence UI/SSH et RUNBOOK (critères 5, 16, 20)
| ID | Scénario | Attendu |
|---|---|---|
| S5-25 [M] | Sur deux hôtes jumeaux, exécuter chacune des 16 opérations (instances ×6, mise à jour, sauvegardes ×4, export, client web, préparation, déblocage, redémarrage, DNS, clé S3, purge) : l'une depuis l'interface, l'autre par SSH. | `instance list --json` identique ; différences de `host.log`/`admin.log` limitées aux horodatages et à l'origine. |
| S5-26 [A] | `acceptance.sh` complet : défaut, `CADDY_MODE=external`, `HARDEN_HOST=none`, + `scenario_admin_*`. | Tout vert ; scénarios `--json`, `--non-interactive`, verrou, codes de sortie ajoutés. |
| S5-27 [M] | Désinstaller le module `admin` (RUNBOOK A16). | Service, proxy, agent, socket et réseau `polenta-admin-net` supprimés ; instances intactes ; `ADMIN_UI=off`. |
| S5-28 [A] | RUNBOOK : section « Administration depuis Polenta » présente avec le tableau opération ↔ commande SSH complet (24 opérations du catalogue). | Test de cohérence : chaque `OperationId` du registre figure dans le tableau. |
| S5-29 [M] | Installation par la commande unique sur hôte neuf ; premier `instance add` par SSH. | Service et agent installés ; interface atteignable après le premier client web (UC, spec §1.7, Q13). |

## Non-régression (transverse)
| ID | Scénario | Attendu |
|---|---|---|
| NR-1 [A] | `pnpm test` (desktop, services, web-server). | Vert ; aucun import de `admin/` par le main ou le preload. |
| NR-2 [E2E] | `pnpm --filter @polenta/desktop test:e2e:web` (suites existantes). | Vert. |
| NR-3 [A] | `pnpm typecheck` et lint. | Zéro erreur nouvelle. |
| NR-4 [M] | UC6 : propriétaire du client A parcourt toute l'interface. | Aucune opération « Hôte », aucune autre instance proposée ou atteignable. |
