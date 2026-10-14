# RUNBOOK — hôte de forges Polenta

Procédures d'exploitation du kit `deploy/` : une forge Forgejo (ou Gitea) isolée par client, derrière
un Caddy partagé qui gère le HTTPS. Deux lecteurs :

- **Partie A — exploitant** : la personne qui a un accès SSH à l'hôte (l'éditeur, ou la DSI d'un
  client qui héberge sa propre forge) ;
- **Partie B — admin du client** : le propriétaire de l'organisation dans la forge du client, sans
  accès SSH.

Toutes les commandes `polenta-host` / `polenta-admin` s'exécutent **en root** (`sudo`) sur l'hôte.
`polenta-host` sans argument affiche son aide.

---

## Partie A — exploitant

### A1. Ce qu'il y a sur l'hôte

```
/opt/polenta/
├── host.env                  configuration de l'hôte (root, 600) — clé S3, niveau de durcissement HARDEN_HOST
├── kit/                      copie installée du kit (polenta-host, polenta-admin → /usr/local/bin)
├── caddy/etc/sites/          un fichier <instance>.caddy par client ; _*.caddy = sites additionnels
├── instances/<nom>/
│   ├── instance.env          secrets de l'instance (SECRET_KEY, mot de passe restic…) — 600
│   ├── data/                 dépôts git, base SQLite, journaux de la forge
│   ├── admin.log             journal des commandes polenta-admin
│   └── polenta-config.json   config.json Polenta pré-rempli à distribuer aux postes
├── exports/                  archives de restitution (instance export / remove)
└── /var/log/polenta/         backup.log (sauvegarde nocturne), host.log
```

Chaque instance = un projet Docker compose `polenta-<nom>`, un réseau `polenta-<nom>`, aucun port
publié. Seul Caddy (ports 80/443) est exposé. Une instance ne peut joindre aucune autre.

### A2. Préparer un hôte

Prérequis : VPS Debian 12/13 ou Ubuntu 24.04, accès SSH par clé avec un utilisateur sudo (pas root),
un domaine.

1. **DNS** : `*.forge.mondomaine.fr` → IPv4 (A) et IPv6 (AAAA) de l'hôte. Une forge s'appellera
   `<nom>.forge.mondomaine.fr`.
2. **Stockage des sauvegardes** : un bucket S3 chez un **autre fournisseur** que l'hôte (ex.
   Scaleway Object Storage, `fr-par`) et une clé d'API limitée à ce bucket. Noter la date
   d'expiration de la clé (cf. A9).
3. **Copier le kit** depuis le monorepo :
   ```
   scp -r deploy/. admin@hote:polenta-kit/
   ssh admin@hote
   cd ~/polenta-kit && sudo ./polenta-host.sh setup
   ```
   Le premier passage crée `/opt/polenta/host.env` depuis l'exemple et s'arrête : le compléter
   (`sudo nano /opt/polenta/host.env`) — `ACME_EMAIL`, `BASE_DOMAIN`, `BACKUP_S3_*`, facultatifs
   `SMTP_*`, `ADMIN_IPS` (A8), `POLENTA_DOWNLOAD_URL`, `BACKUP_PING_URL` — puis relancer
   `sudo ./polenta-host.sh setup`.
4. `setup` est rejouable sans effet de bord. Au niveau par défaut (`HARDEN_HOST=full`), il installe
   Docker, restic, le pare-feu (22/80/443), fail2ban, les mises à jour de sécurité automatiques, la
   sauvegarde nocturne (02:30), et durcit SSH (clé uniquement, root interdit) **seulement si** une
   clé est déjà autorisée.
5. Vérifier : `sudo polenta-host status` (bloc « Durcissement » : état détecté de chaque module).

#### Serveur déjà administré : choisir le niveau de durcissement

`full` convient à un VPS neuf dédié à Polenta. Sur un serveur qui héberge déjà d'autres projets
dockerisés, il peut couper des accès existants (SSH sans mot de passe ni root, pare-feu fermé hors
22/80/443, redémarrage nocturne des conteneurs, bannissements fail2ban). Fixer le niveau dans
`/opt/polenta/host.env` **avant** le premier `setup` :

| `HARDEN_HOST` | Ce que `setup` applique en plus de Docker, restic, sauvegarde nocturne, Caddy |
|---|---|
| `full` (défaut) | pare-feu ufw, fail2ban (sshd + forges), mises à jour auto avec redémarrage 04:00, SSH durci, LLMNR/mDNS coupés, console |
| `basic` | fail2ban (sshd + forges), mises à jour auto **sans** redémarrage ; aucun changement de pare-feu ni de SSH |
| `none` | rien d'autre : aucun paquet de durcissement, aucun fichier sous `/etc/ssh`, `/etc/fail2ban`, `/etc/apt/apt.conf.d`… |

Une valeur invalide arrête `setup` avant toute modification. `HOST_MODULES=a,b,c` (facultatif)
remplace la liste du niveau (modules : voir `host.env.example`).

Limites :
- `setup` **n'annule jamais** : passer de `full` à `none` laisse en place ce qui est déjà posé ;
  `setup` et `status` le signalent (`hors niveau`). Retrait manuel, module par module :
  - pare-feu : `sudo ufw disable` (ou supprimer les règles 22/80/443 ajoutées par le kit) ;
  - SSH : `sudo rm /etc/ssh/sshd_config.d/10-polenta.conf && sudo systemctl reload ssh` ;
  - fail2ban : `sudo rm /etc/fail2ban/jail.d/10-polenta-sshd.local /etc/fail2ban/jail.d/20-polenta-forge.local /etc/fail2ban/filter.d/polenta-forge.conf && sudo systemctl restart fail2ban` ;
  - mises à jour : supprimer `/etc/apt/apt.conf.d/52polenta-unattended` (redémarrage 04:00) et/ou `20auto-upgrades` ;
  - `resolved` / `console` : supprimer `/etc/systemd/resolved.conf.d/10-polenta.conf` (puis `systemctl restart systemd-resolved`) / `/etc/sysctl.d/10-polenta-console.conf`.
- Si `ufw` est déjà actif et que le niveau ne le gère pas, `setup` ne le modifie pas mais avertit
  si 80/443 n'y sont pas ouverts : Caddy serait injoignable. Les ports publiés par Docker
  contournent `ufw`.

Contrôler un hôte au niveau `none` (sur l'hôte, après `setup`) :
```
sudo ~/polenta-kit/tests/harden-none.test.sh [--ufw-before ufw.txt] [--sshd-before sshd.txt]
deploy/tests/acceptance.sh --harden-level none <nom>.forge.mondomaine.fr   # depuis l'extérieur
```
Tests sans hôte : `deploy/tests/harden-modules.test.sh`.

Mettre à jour le kit plus tard = recopier `deploy/` puis relancer `setup` (le kit installé dans
`/opt/polenta/kit` est remplacé, `host.env` jamais).

### A3. Ajouter un client

```
sudo polenta-host instance add acme --org acme --client-admin alice alice@acme.fr
```

Options : `--domain` (sinon `acme.<BASE_DOMAIN>`), `--app-name "Forge ACME"`, `--no-demo` (pas
d'import des projets de démonstration), `--image`/`--version` (Gitea au lieu de Forgejo, version
précise).

La commande vérifie le DNS, démarre la forge, obtient le certificat, crée l'organisation, le compte
de l'admin client (mot de passe temporaire affiché, à changer à la première connexion), le dépôt
`polenta-config` et la première sauvegarde. Elle affiche à la fin l'URL, les comptes et le chemin du
`polenta-config.json`.

À transmettre à l'admin du client : URL, identifiant et mot de passe temporaire (deux canaux
différents), le lien d'invitation affiché, et la **Partie B** de ce document.

Remise à niveau d'une instance existante après une évolution du kit : `instance sync <nom>`.
Arrêt / redémarrage : `instance stop|start <nom>`.

### A4. Sauvegardes

- **Nocturne** automatique (cron 02:30, toutes les instances) : arrêt de la forge ~10-15 s, copie
  chiffrée de `data/` + `instance.env` vers `s3:…/<bucket>/<instance>`, redémarrage. Rétention :
  7 quotidiennes, 4 hebdomadaires, 12 mensuelles. Journal : `/var/log/polenta/backup.log`.
- **À la demande** : `sudo polenta-host instance backup acme` (ou `--all`).
- **Liste** : `sudo polenta-host instance snapshots acme`. Colonne « dernière sauvegarde » :
  `instance list`.
- **Supervision** (recommandé) : `BACKUP_PING_URL` = une URL healthchecks.io (ou équivalent) ;
  appelée à chaque succès, `…/fail` en cas d'échec ; sans ping pendant 25 h → alerte par e-mail.
  L'échec d'une instance n'empêche pas la sauvegarde des autres.

**Mots de passe des sauvegardes — IMPÉRATIF.** Chaque instance a son propre dépôt restic chiffré
par un mot de passe stocké dans `instance.env`. Si l'hôte est perdu, ces mots de passe le sont
aussi : **sans eux, aucune restauration n'est possible.** Après chaque `instance add` :

```
sudo polenta-host instance keys
```

et ranger la sortie dans un gestionnaire de mots de passe **hors de l'hôte**.

### A5. Restaurer

```
# Revenir à la dernière sauvegarde (remplace TOUTES les données actuelles)
sudo polenta-host instance restore acme --from latest --force

# Une sauvegarde précise (identifiant de « instance snapshots »), ou la dernière d'un type
sudo polenta-host instance restore acme --from 208d222a --force
sudo polenta-host instance restore acme --from latest:pre-update --force

# Copie de contrôle sous un autre nom et un autre domaine, sans toucher à acme
sudo polenta-host instance restore acme-test --source acme --from latest

# Hôte neuf (instance.env absent) : mot de passe restic dans un fichier
sudo polenta-host instance restore acme --from latest --password-file /root/acme.restic
```

Les comptes, mots de passe, double authentification, équipes et dépôts reviennent à l'identique.

**Test de restauration trimestriel** (obligatoire — une sauvegarde jamais restaurée n'est pas une
sauvegarde) :

1. `sudo polenta-host instance restore <nom>-test --source <nom> --from latest` (DNS joker : le
   domaine `<nom>-test.<BASE_DOMAIN>` existe déjà) ;
2. se connecter sur `https://<nom>-test.<BASE_DOMAIN>` avec le compte d'exploitation ou un compte
   de test, vérifier dépôts et derniers commits ;
3. `sudo polenta-host instance remove <nom>-test --confirm <nom>-test` puis supprimer l'export
   produit dans `/opt/polenta/exports/` et purger son dépôt restic (A7) ;
4. noter la date et le résultat dans le registre d'exploitation.

### A6. Mettre à jour une forge

```
sudo polenta-host instance update acme 16.0.5      # ou --all 16.0.5
```

Déroulé : téléchargement de la version (si elle n'existe pas : **rien n'est modifié**), sauvegarde
`pre-update`, démarrage de la nouvelle version, contrôle de santé HTTPS. En cas d'échec : **retour
arrière automatique** à l'ancienne version et aux données d'avant (la base a pu être migrée). Durée
mesurée : ~45 s d'interruption pour une instance, retour arrière compris. Les autres instances ne
sont pas interrompues.

Choisir une version LTS de Forgejo, lire les notes de version (changements cassants), mettre à jour
d'abord une instance de test.

Instance avec client web (GH57) : la page de consentement de la forge est régénérée pour la nouvelle
version avant son démarrage. Si `update` affiche « page de consentement du client web non générée »,
la nouvelle version a changé cette page : la mise à jour est faite, mais les utilisateurs revoient
l'écran « Autoriser polenta-web » à leur première connexion web — à signaler (évolution du kit).
Vérification sur l'instance de test : `apps/desktop/e2e-web/gh57-consent.spec.ts`.

Les mises à jour de sécurité de l'OS sont automatiques ; redémarrer l'hôte quand
`/var/run/reboot-required` existe (les forges redémarrent seules).

### A7. Départ d'un client : restitution et suppression

1. `sudo polenta-host instance export acme` → `/opt/polenta/exports/acme-<date>.tar.gz` + `.sha256`.
   Contenu : `forge-dump.tar.gz` (export officiel Forgejo), `data.tar.gz` (le dossier `/data`
   complet), `forge.env` (configuration, dont la `SECRET_KEY` indispensable pour relire la double
   authentification), `instance.env` expurgé, `LISEZMOI.md` (procédure pour remonter la forge avec
   l'image Docker officielle, testée).
2. Remettre l'archive au client par un canal sûr (lien de téléchargement temporaire, support
   chiffré). L'archive contient des secrets.
3. `sudo polenta-host instance remove acme --confirm acme` : refait un export, puis supprime
   conteneur, réseau, site Caddy, données et `instance.env`. Les autres instances et les sites
   additionnels ne sont pas touchés.
4. **Purge des sauvegardes** (le kit ne la fait pas, volontairement : une suppression par erreur
   reste rattrapable tant que le dépôt restic existe). Une fois le client d'accord et l'archive
   reçue : console du fournisseur S3 → bucket → supprimer le dossier `<instance>/` (Scaleway :
   Object Storage → bucket → cocher le dossier → Supprimer).
5. Supprimer l'archive d'export de l'hôte après remise, et la ligne DNS si le domaine était
   spécifique.

### A8. Sécurité : fail2ban, blocage de l'exploitant, console

- **SSH** : 5 échecs → bannissement. **Forges** : 10 échecs d'authentification (web, git, création
  de jeton) en 10 min → l'IP est bannie **de toutes les forges** (pas de SSH) pendant 1 h. Les
  règles des forges sont dans la chaîne `DOCKER-USER` d'iptables.
- Aux niveaux `basic` et `none`, voir A2 : en `none`, fail2ban n'est pas géré par le kit et
  `ADMIN_IPS` est sans effet (`setup` l'indique) ; en `basic`, fail2ban l'est, mais sans pare-feu ni
  SSH durci.
- `ADMIN_IPS` (host.env) : IP fixes de l'exploitant **jamais** bannies. À laisser vide avec une IP
  dynamique ou mobile ; relancer `setup` après modification. Une campagne de tests de connexion
  (mauvais mots de passe, codes 2FA faux) atteint vite le seuil : ajouter temporairement l'IP du
  testeur, ou lever le bannissement entre deux séries.
- Voir / lever un bannissement :
  ```
  sudo fail2ban-client status polenta-forge        # ou sshd
  sudo fail2ban-client set polenta-forge unbanip 203.0.113.7
  ```
- **Exploitant bloqué en SSH** (sa propre IP bannie) :
  1. se connecter depuis une autre IP (partage de connexion du téléphone) et lever le
     bannissement ;
  2. à défaut, **console KVM** du fournisseur (OVH : espace client → VPS → « KVM »). Le clavier de
     la console est souvent en **QWERTY** : taper le mot de passe en conséquence (a↔q, z↔w, m↔,),
     le collage n'est pas toujours possible. L'utilisateur doit avoir un mot de passe (`sudo passwd
     <utilisateur>` à faire **dès l'installation**, puisque SSH n'accepte que les clés) ;
  3. ultime recours : mode rescue du fournisseur.
- Les journaux de la forge restaurés sont renommés `gitea.log.avant-restauration-<date>` pour
  que fail2ban ne recompte pas d'anciens échecs.

### A9. Échéances à suivre

| Quoi | Quand | Action |
|---|---|---|
| Clé d'API S3 | expiration fixée à la création (Scaleway : 1 an max) | créer une nouvelle clé, mettre à jour `BACKUP_S3_ACCESS_KEY`/`SECRET_KEY` dans host.env, `instance backup --all`, puis révoquer l'ancienne |
| Test de restauration | tous les trimestres | A5 |
| Revue des accès | tous les semestres (ou à chaque départ) | `polenta-admin --instance acme access report --csv` envoyé à l'admin du client |
| Version Forgejo LTS | à chaque nouvelle LTS / correctif de sécurité | A6 |
| Mots de passe restic hors hôte | après chaque `instance add` | `instance keys` |

### A10. Sites additionnels sur le même hôte

Le Caddy du kit peut servir d'autres sites (ex. site vitrine). Convention : un fichier
`/opt/polenta/caddy/etc/sites/_<nom>.caddy` (préfixe `_`), le conteneur du site rattaché au réseau
`polenta-edge`, ses fichiers hors de `/opt/polenta` (ex. `/opt/<nom>/`). Le kit ne crée, ne modifie
ni ne supprime jamais les fichiers `_*.caddy`. Recharger Caddy après modification :
`docker exec polenta-caddy caddy reload --config /etc/caddy/Caddyfile`.

Ces sites **ne sont pas sauvegardés** par le kit : garder leurs sources ailleurs (dépôt git).

### A11. Incidents

| Symptôme | Diagnostic | Remède |
|---|---|---|
| Une forge ne répond plus | `polenta-host instance list` (état), `docker logs forgejo-<nom> --tail 50` | `instance start <nom>` ; si la base est corrompue : A5 |
| Toutes les forges en erreur | `docker ps`, `systemctl status docker`, `df -h` | redémarrer Docker ; libérer le disque |
| Disque plein | `df -h`, `du -sh /opt/polenta/instances/*`, `docker system df` | `docker image prune -a` (images inutilisées), supprimer les vieux exports, agrandir le disque |
| Certificat expiré / HTTPS en erreur | `docker logs polenta-caddy --tail 50` (Let's Encrypt), DNS | vérifier que le DNS pointe toujours vers l'hôte et que 80/443 sont ouverts |
| Sauvegarde nocturne en échec | `/var/log/polenta/backup.log`, alerte du ping | clé S3 expirée (A9), bucket plein, réseau ; relancer `instance backup <nom>` |
| Utilisateur bloqué « trop de tentatives » | `fail2ban-client status polenta-forge` | `unbanip` (A8) |
| **Hôte perdu** (panne, piratage) | — | A12 |

### A12. Reprise sur un hôte neuf / changement d'hôte

Prouvé au test S3-13 (réinstallation complète de l'OS, 2026-10-11) : `setup` 1 min 50, restauration
~35 s par client, comptes / 2FA / droits / dépôts intacts. Compter ~15 min au total hors délai de
réinstallation du fournisseur.

**Avant** une réinstallation volontaire : `instance backup --all`, puis copier hors de l'hôte
`instance keys`, `/opt/polenta/host.env` et les sites additionnels.

1. Nouvel hôte (ou OS réinstallé) : utilisateur sudo, clé SSH, mot de passe pour la console (A8).
   OVH : vérifier la version choisie dans la liste (Debian **13**, pas 11 — `setup` refuse un OS non
   supporté) ; le mot de passe de `debian` doit être changé à la première connexion SSH
   interactive, avant toute commande automatisée. L'empreinte SSH de l'hôte change :
   `ssh-keygen -R <hôte>` sur le poste de l'exploitant.
2. Copier le kit et le `host.env` d'origine (gardé hors de l'hôte, ou le recréer) ; `setup` (A2).
3. Si l'adresse IP change : mettre à jour le DNS (`*.forge…` A et AAAA, TTL court conseillé à
   l'avance) et attendre la propagation (`dig +short acme.forge.mondomaine.fr`).
4. Pour chaque client, avec son mot de passe restic (A4) :
   ```
   echo 'mot-de-passe' | sudo tee /root/acme.restic >/dev/null; sudo chmod 600 /root/acme.restic
   sudo polenta-host instance restore acme --from latest --password-file /root/acme.restic
   sudo rm /root/acme.restic
   ```
5. Republier les sites additionnels (A10).
6. `polenta-host status` ; les postes Polenta se reconnectent seuls (même adresse).

Les verrous restic laissés par l'ancien hôte sont levés automatiquement par la sauvegarde nocturne
(`restic unlock`, verrous périmés uniquement).

**Bascule planifiée** vers un nouvel hôte : préparer le nouvel hôte, `instance backup <nom>` sur
l'ancien juste avant, arrêter l'instance sur l'ancien (`instance stop`), basculer le DNS, puis
`instance restore` sur le nouveau.

### A13. Dimensionnement

Mesuré : ~105-130 Mo de RAM par forge au repos, Caddy ~26 Mo ; 6-10 Mo de disque par instance
démo comprise ; images Docker ~700 Mo. Client web (A15), mesuré le 2026-10-11 sur le projet de
démonstration : ~125-170 Mo au repos, ~30 Mo par utilisateur actif (libérés après 30 min
d'inactivité), ~55 Mo de plus pendant les impressions PDF (navigateur fermé après 10 min sans
impression) — 3 utilisateurs et impression : ~310 Mo ; image ~1,2 Go ; `web-data` = copies de
travail des projets.

| Hôte | Clients raisonnables |
|---|---|
| 2 vCPU / 4 Go / 40 Go | jusqu'à ~10 petites équipes |
| 4 vCPU / 8 Go / 80 Go | jusqu'à ~25 |

Le disque est dominé par les dépôts git (fichiers binaires : ne pas y mettre de gros médias).

### A14. Évolutions du kit

Toute évolution du kit qui touche aux données (sauvegarde, restauration, mise à jour, suppression)
se valide d'abord sur un **hôte jetable** (VPS à l'heure ou VM locale), jamais directement sur
l'hôte de production.

---

### A15. Client web (Polenta dans le navigateur)

Chaque instance peut avoir son **client web** (GH44) : Polenta dans un navigateur, sans installation,
sur un domaine distinct de la forge (ex. `acme-web.forge.example.fr`, couvert par le DNS joker
`*.forge`). Les utilisateurs s'y connectent **avec leur compte de la forge** (OIDC) : mêmes droits,
même désactivation, commits à leur nom.

**Image** — construite depuis le dépôt Polenta, une fois par version (et par marque) :

```bash
docker build -f apps/desktop/Dockerfile.web --build-arg POLENTA_BRAND=polenta -t polenta-web:0.0.9 .
# ou poussée sur un registre : … -t ghcr.io/<org>/polenta-web:0.0.9 && docker push …
```

Image par défaut de l'hôte : `POLENTA_WEB_IMAGE=ghcr.io/<org>/polenta-web` dans `host.env`
(sinon `polenta-web`, image locale).

**Activer, mettre à jour, désactiver :**

```bash
sudo polenta-host instance web enable acme --domain acme-web.forge.example.fr --version 0.0.9
sudo polenta-host instance web enable acme --version 0.0.10     # mise à jour : même commande
sudo polenta-host instance web disable acme                     # arrêt ; données conservées
```

`enable` vérifie l'image et le DNS, crée l'application OAuth2 `polenta-web` de la forge (adresse de
retour `https://<domaine web>/auth/callback`), écrit `web.env` (chmod 600 : client OAuth2, secret de
session, projet de démonstration de la forge s'il existe), démarre le conteneur `polenta-web-<instance>` et publie le site Caddy `<instance>.web.caddy`.
Rejouable sans risque. Ensuite, `stop`, `start`, `backup`, `restore`, `export` et `remove` de
l'instance incluent le client web.

**Pas d'écran de consentement (GH57)** — sans rien de plus, la forge demanderait à chaque utilisateur,
à sa première connexion web, d'« Autoriser polenta-web à accéder à son compte ». `enable` dépose donc
une page de consentement personnalisée dans la forge (`data/gitea/templates/user/auth/grant.tmpl`,
générée à partir de celle de la version installée) qui valide automatiquement l'autorisation pour la
seule application `polenta-web` de l'instance (reconnue par son `client_id`) ; toute autre
application garde la page d'origine. La forge est redémarrée (quelques secondes) quand cette page
change. Ce fichier appartient au kit : ne pas le modifier. `disable` le retire ; `update` le
régénère (A6). Si la page ne peut pas être générée, un avertissement l'indique et la page d'origine
est conservée (les utilisateurs voient alors l'écran de consentement, sans autre conséquence). La sauvegarde arrête le client web avec la forge : les utilisateurs
connectés à ce moment se reconnectent (sans ressaisie si leur session de la forge est active).

**Données** — `web-data/` : un espace par utilisateur (copies de travail des projets ouverts dans le
navigateur, dont les **modifications pas encore publiées**). Sauvegardé avec l'instance (`web-data`,
`web.env`), inclus dans l'export de restitution (`web-data.tar.gz`). Après une restauration sous un
autre domaine de forge, `restore` réaligne `web.env` ; si le **domaine web** change, relancer
`instance web enable <nom> --domain <nouveau>` (nouvelle adresse de retour OAuth2).

**Incidents :**

| Symptôme | Cause probable | Action |
|---|---|---|
| Page « Le serveur de connexion est injoignable » | forge arrêtée, ou IP de l'hôte bannie par fail2ban de la forge | `instance list`, `fail2ban-client status polenta-forge` |
| « La connexion n'a pas abouti » au retour de la forge | application OAuth2 supprimée ou secret changé | `instance web enable <nom>` (recrée l'application) |
| « Votre accès a été révoqué » | compte désactivé (`polenta-admin user disable`) ou jeton retiré | normal ; `user enable` pour rétablir |
| Export PDF en erreur | navigateur headless de l'image | `docker logs polenta-web-<nom>` |

Journaux : `docker logs polenta-web-<instance>`.

## Partie B — admin du client

Vous êtes propriétaire de l'organisation de votre entreprise sur votre forge
(`https://<votre-forge>`). Tout se fait dans l'interface web, sans intervention de l'exploitant.

### B1. Utilisateurs

- **Ajouter** : Administration du site → Comptes → Créer un compte (identifiant, e-mail, mot de
  passe temporaire, « exiger le changement de mot de passe »). Puis l'ajouter à une ou plusieurs
  équipes (B2). Lui transmettre l'URL de la forge, son identifiant, son mot de passe temporaire
  (par un autre canal), et le lien d'invitation Polenta :
  `polenta://connect?server=https://<votre-forge>&login=<identifiant>` (ouvre Polenta sur l'écran de
  connexion pré-rempli).
- **Départ** : désactiver le compte (Comptes → modifier → décocher « actif ») plutôt que le
  supprimer : l'historique reste attribué. Effet immédiat : Polenta affiche « accès révoqué » au
  poste concerné, aucun push n'est plus accepté.
- **Mot de passe oublié** : Comptes → modifier → nouveau mot de passe temporaire.
- **Double authentification** : recommandée, chaque utilisateur l'active dans ses paramètres
  (Sécurité). Polenta demande alors le code à la connexion.

### B2. Équipes et cloisonnement

Les droits se donnent **par équipe** ; un compte hérite des droits de toutes ses équipes.

- Organisation → Équipes → Nouvelle équipe : nom, droit (**lecture** ou **écriture**), dépôts
  concernés (tous, ou une liste). Un membre d'une équipe limitée à `projet-x` ne voit pas les autres
  dépôts.
- Ajouter / retirer un membre : page de l'équipe.
- Dépôt confidentiel : créer une équipe dédiée qui n'a que ce dépôt, ne pas l'ajouter aux équipes
  « tous les dépôts ».
- Revue des accès : demander à l'exploitant le rapport `access report` (qui a quel droit sur quel
  dépôt).

**Limite à connaître** : le serveur garantit lecture / écriture **par dépôt**. Les rôles internes à
Polenta (qui peut approuver une exigence, etc.) ne sont **pas** contrôlés par le serveur : une
personne qui a le droit d'écriture sur un dépôt peut techniquement tout y modifier. L'historique git
reste la preuve de qui a fait quoi. Pour une séparation stricte, séparer en dépôts distincts.

### B3. Créer un projet

Organisation → Nouveau dépôt (toujours privé), puis donner l'accès aux équipes concernées
(paramètres du dépôt → Collaborateurs / Équipes). Le projet s'ouvre ensuite dans Polenta depuis
l'accueil.

### B4. Configuration Polenta de votre organisation (`polenta-config`)

Le dépôt `<organisation>/polenta-config`, fichier `config.yaml`, définit ce que voient les
postes Polenta de vos utilisateurs — projets proposés à l'accueil, mode de mise à jour, préférences
par défaut — globalement (`defaults`) et **par équipe** (`teams`). Le fichier est commenté ; seuls
les propriétaires de l'organisation peuvent le modifier. Polenta le relit à la connexion, au
démarrage et toutes les 30 minutes.

### B5. Postes de travail

- Cas courant : l'utilisateur installe Polenta et clique sur son lien d'invitation (B1). Rien
  d'autre à configurer.
- **Parc géré par la DSI** : déposer le fichier `config.json` fourni par l'exploitant
  (`polenta-config.json`) sur chaque poste — Windows `%ProgramData%\Polenta\config.json`, macOS
  `/Library/Application Support/Polenta/config.json`, Linux `/etc/polenta/config.json` (GPO, MDM,
  script). L'écran de connexion ne propose alors que votre forge.

### B7. Polenta dans le navigateur

Si votre exploitant a activé le client web, Polenta s'ouvre à l'adresse qu'il vous a donnée
(ex. `https://acme-web.forge.example.fr`). Chacun se connecte avec **son compte de la forge** :
mêmes droits, mêmes équipes, commits à son nom. Rien à installer. Différences avec l'application :
pas d'ouverture de dossier local (vos projets sont dans « Mes projets », sur le serveur), les
exports sont téléchargés, et l'édition des diagrammes draw.io se fait dans l'application de bureau
(ou par remplacement du fichier).

### B6. Annuaire d'entreprise (LDAP / Active Directory, OIDC)

Non automatisé, faisable dans l'interface : Administration du site → Sources d'authentification →
Ajouter (type LDAP « via BindDN », ou OAuth2 / OpenID Connect pour Entra ID, Google Workspace,
Keycloak…). Paramètres à demander à votre service informatique : hôte, port (636 en LDAPS), DN de
recherche, filtre utilisateurs, attributs `uid`/`mail`. Les comptes sont créés à la première
connexion ; les ajouter ensuite aux équipes (B2). Avec OIDC, la connexion Polenta passe par un jeton
d'accès personnel (paramètres → Applications) tant que la connexion SSO de Polenta n'est pas
disponible. Prévenir l'exploitant avant : il valide la configuration sur une copie de test.
