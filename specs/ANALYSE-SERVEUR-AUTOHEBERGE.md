# Analyse — Serveur git auto-hébergé pour un client sans GitHub

> Statut : analyse préalable — issue #45 (lien avec #44 §8). Date : 2026-10-08.
> Objet : permettre à un client d'utiliser Polenta avec ses propres serveur, comptes, équipes et
> droits d'accès, sans GitHub, sur un VPS déployable simplement.

---

## 1. Besoin exprimé

| # | Besoin | Côté |
|---|--------|------|
| B1 | Pas de GitHub : les repos vivent sur un serveur maîtrisé par le client (ou par nous pour lui) | Client |
| B2 | Création de repos (projets Polenta, composants) | Client / admin |
| B3 | Création et désactivation de comptes utilisateur | Admin |
| B4 | Droits d'accès par repo | Admin |
| B5 | Équipes : un compte hérite des accès de ses équipes | Admin |
| B6 | Déploiement le plus simple possible (Docker, script) sur un VPS | Nous / admin |

Besoins implicites qu'il faut traiter dès le départ, sinon ils reviendront en production :

| # | Besoin implicite | Pourquoi |
|---|------------------|----------|
| B7 | Sauvegardes externalisées et restauration testée | Le serveur devient la référence des spécifications (audit, certification IEC). |
| B8 | Départ d'un salarié : couper l'accès immédiatement | Un jeton reste valide sur son poste tant qu'il n'est pas révoqué côté serveur. |
| B9 | Mises à jour de sécurité de l'OS et du serveur git | Le service est exposé sur Internet. |
| B10 | Identité fiable dans l'historique git | `createdBy`/`updatedBy` viennent de `git log`. C'est la trace d'audit. |
| B11 | HTTPS avec un certificat valide | Polenta (Electron 31, donc Node 20) n'utilise pas le magasin de certificats de l'OS (cf. §4.6). |
| B12 | Mises à jour de Polenta sans passer par github.com | L'auto-update lit aujourd'hui les GitHub Releases (`update.service.ts`). |
| B13 | Hébergement des données en UE, voire en France | Le client refuse GitHub : la souveraineté des données est probablement la vraie raison. |
| B14 | SSO / annuaire existant (AD, Entra ID, Google Workspace) | Évite un mot de passe de plus et automatise B3/B5/B8. |

---

## 2. Décision structurante : ne pas développer de serveur, déployer une forge git

Toute la gestion demandée (comptes, organisations, équipes, héritage des droits, création de
repos, administration web, API, jetons, LDAP/OIDC, 2FA) existe déjà dans les forges git
open source. La développer dans Polenta (`apps/api` NestJS) coûterait des mois et créerait une
surface de sécurité à maintenir, sans valeur ajoutée pour le métier de Polenta (exigences et
traçabilité).

**Recommandation : [Forgejo](https://forgejo.org)**, déployé en Docker derrière Caddy (HTTPS
automatique).

| Critère | Forgejo | Gitea | GitLab CE | Git nu + SSH (gitolite) |
|---|---|---|---|---|
| Comptes, organisations, équipes, droits par repo | ✅ | ✅ | ✅ | ⚠️ fichier de conf, pas d'UI |
| L'équipe donne des droits à ses membres (B5) | ✅ natif | ✅ natif | ✅ (groupes) | ❌ |
| Mémoire au repos | ~200–400 Mo | ~200–400 Mo | 4–8 Go | négligeable |
| Déploiement | 1 conteneur (+ Postgres en option) | idem | lourd, nombreux services | simple mais tout à la main |
| API REST pour automatiser (création repo, user, team) | ✅ `/api/v1` | ✅ `/api/v1` (même API) | ✅ (API différente) | ❌ |
| LDAP / OIDC, synchro groupes → équipes | ✅ | ✅ | ✅ | ❌ |
| Licence / gouvernance | GPLv3+, association Codeberg e.V. (UE) | MIT, société Gitea Ltd (open core) | MIT + édition EE payante | — |
| Compatible avec le transport git de Polenta (HTTPS + jeton) | ✅ | ✅ | ✅ | ❌ SSH uniquement |

Pourquoi Forgejo plutôt que Gitea : même base de code et même API (Polenta supporterait les
deux sans effort), gouvernance associative européenne (argument de vente face à un client
méfiant vis-à-vis de GitHub), branches LTS. Gitea reste une alternative valable si le client
veut un support commercial (Gitea Enterprise). GitLab est surdimensionné pour ce besoin.
« Git nu + SSH » est exclu : Polenta parle git en HTTPS via isomorphic-git, et le SSH passe
par le binaire `git` natif (`sync.service.ts`, T154), ce qui imposerait git et des clés SSH sur
chaque poste. Ce n'est pas réaliste pour des ingénieurs mécaniques ou des testeurs.

### Correspondance besoin → fonctionnalité Forgejo

| Besoin | Forgejo |
|---|---|
| B2 création de repos | UI web, API `POST /api/v1/orgs/{org}/repos`, droit « créer des repos » donné par équipe |
| B3 comptes | Admin du site : créer, désactiver, forcer la réinitialisation du mot de passe ; inscriptions publiques désactivées |
| B4 droits par repo | Lecture / écriture / admin, par équipe ou par collaborateur individuel |
| B5 héritage par équipe | Une équipe d'organisation a un niveau de droit et une liste de repos (ou « tous les repos de l'organisation ») ; chaque membre en hérite |
| B8 départ | Désactiver le compte : tous ses jetons deviennent inutilisables immédiatement |
| B14 SSO | Source d'authentification LDAP/AD ou OIDC (Entra ID, Google, Keycloak), avec synchronisation des groupes LDAP vers les équipes |

---

## 3. Modèle de droits proposé au client

Une **organisation par client** (ex. `acme`), avec des équipes standard créées par le script
d'installation :

| Équipe Forgejo | Droit repos | Rôle Polenta correspondant (SPEC §4) |
|---|---|---|
| `owners` (natif) | admin, tous repos | Admin |
| `auteurs` | écriture | Auteur, Relecteur |
| `testeurs` | écriture | Testeur |
| `lecteurs` | lecture | Observateur |
| `projet-<nom>` (option) | écriture sur les repos du projet seulement | cloisonnement par projet ou sous-traitant |

### Point à expliquer franchement au client

Le serveur ne contrôle que **lecture / écriture / admin, par repo**. Git ne sait pas restreindre
l'écriture à certains fichiers. Or dans Polenta, un testeur écrit des résultats de campagne et un
relecteur écrit des commentaires de review : les deux ont besoin du droit d'écriture. Les rôles
fins de Polenta (Auteur ≠ Testeur ≠ Relecteur) relèvent donc de l'interface, pas d'une barrière de
sécurité. Garanties réelles :

- **Observateur** : garanti par le serveur (lecture seule).
- **Cloisonnement entre projets ou avec un sous-traitant** : garanti par le serveur (repos
  séparés, équipes séparées). Cela concerne aussi les composants : un utilisateur doit pouvoir
  lire tous les repos déclarés dans `polenta-repo.yaml` du projet qu'il ouvre.
- **Branche d'intégration** : une protection de branche Forgejo peut restreindre le push sur
  `int-*` à une liste d'équipes. Attention, « Publier » pousse directement sur l'intégration
  (SPEC §5) : toute équipe qui publie doit figurer dans cette liste.
- **Option avancée, non recommandée en v1** : un hook `pre-receive` côté serveur qui refuse les
  modifications hors de certains chemins selon l'équipe. Les hooks git sont réservés à l'admin
  dans Forgejo et désactivés par défaut pour raison de sécurité. À n'envisager que si le client
  en fait une exigence contractuelle.

---

## 4. Ce qu'il faut modifier dans Polenta

État actuel (lu dans le code) :

- `auth.service.ts` : jeton dans le trousseau OS (keytar), PAT pour tout hôte, Device Flow
  OAuth pour github.com uniquement.
- `resolveIdentity` ne connaît que `api.github.com`. Pour tout autre hôte, l'identité vaut
  `{ login: 'unknown', name: 'Unknown User' }` ou `{ login: 'git', … }`. Le support Gitea
  (`/api/v1/user`) a été retiré en T130.
- `projectUsername` et `hasAnyAccount` ne sondent que `github.com` et `gitlab.com` en dur, en
  plus de l'hôte `origin`.
- `login.tsx` propose `github.com` / `gitlab.com` / « Autre… ».
- Le transport HTTPS passe par `git-http.ts` (undici + proxy). C'est déjà compatible.
- L'auto-update utilise `provider: github` (`electron-builder.yml`, `update.service.ts`).

### 4.1 P0 — indispensable pour que ça fonctionne proprement

1. **Identité Forgejo/Gitea** : rétablir `GET {remote}/api/v1/user` dans `resolveIdentity`
   (login, `full_name`, `email`). Sans cela, les commits sont signés « Unknown User » ou
   « Polenta User », et `createdBy`/`updatedBy` deviennent inutilisables. **Bloquant pour
   l'audit.** Détection : sonder `GET /api/v1/version` (ou `/api/forgejo/v1/version`) au
   moment du login pour typer l'hôte.
2. **Introduire une abstraction `GitProvider`** (`github` | `forgejo`) avec `resolveIdentity`,
   `listRepos`, `createRepo` et `listMembers`. Le type de provider est mémorisé dans
   `StoredAccount`. Cela supprime les `if (host === 'github.com')` dispersés et les hôtes
   codés en dur.
3. **Serveur pré-configuré** : un fichier de configuration machine, par exemple
   `%ProgramData%\Polenta\config.json` (Windows) ou `/etc/polenta/config.json`, contenant
   `{ "defaultServer": "https://git.acme.fr", "hideGithub": true }`. Le DSI le déploie par GPO ou
   par l'outil de télédistribution : l'utilisateur n'a jamais à saisir d'URL, et l'écran de
   login n'affiche que le serveur de l'entreprise.
4. **Login par identifiant / mot de passe → jeton** : demander à un utilisateur non technicien
   de créer un PAT dans l'interface web est le principal point de friction. Polenta peut appeler
   `POST /api/v1/users/{user}/tokens` en Basic Auth (plus l'en-tête OTP si la 2FA est active),
   avec des scopes minimaux (`write:repository`, `read:user`, `read:organization`). Il stocke le
   jeton dans keytar et **ne conserve jamais le mot de passe**, ce qui respecte la règle de
   SPEC-ACCOUNTS-AUTH §1. Le formulaire PAT reste disponible.
5. **Session révoquée** : sur un 401 pendant fetch/push (compte désactivé, jeton révoqué),
   afficher « Votre accès a été révoqué ou a expiré, reconnectez-vous » plutôt qu'une erreur
   réseau générique.

### 4.2 P1 — ce qui rend l'outil agréable pour le client

6. **Navigateur de repos** : remplacer le collage d'URL (`routes/index.tsx`) par une liste des
   repos accessibles (`GET /api/v1/user/repos`), avec recherche. L'utilisateur choisit et clone.
7. **« Nouveau projet sur le serveur »** : choisir l'organisation, nommer le projet, puis
   `POST /api/v1/orgs/{org}/repos`, initialiser depuis le template Polenta et pousser. Pareil
   pour un nouveau composant, ajouté directement en dépendance dans `polenta-repo.yaml`.
8. **Sélecteur d'utilisateurs** : alimenter les relecteurs de review et les champs de type USER
   avec les membres de l'organisation (`GET /api/v1/orgs/{org}/members`) au lieu d'une saisie
   libre.
9. **Diagnostic de droits** : à l'ouverture d'un projet, vérifier (`GET /api/v1/repos/{o}/{r}`,
   champ `permissions`) que l'utilisateur a l'écriture sur la racine et la lecture sur chaque
   dépendance. Sinon, afficher « Accès manquant au composant X, contactez votre administrateur ».
   Aujourd'hui, un repo privé inaccessible renvoie un 404 trompeur (cf. GH30).

### 4.3 P2 — selon le client

10. **SSO via OAuth2 + PKCE** : Forgejo est fournisseur OAuth2. Polenta ouvre le navigateur,
    reçoit le code sur une redirection loopback `http://127.0.0.1:<port>/callback`, puis
    l'échange. Indispensable si le client branche Forgejo sur son AD ou Entra ID, car il n'y a
    alors plus de mot de passe Forgejo et le §4.1-4 ne fonctionne plus. *À vérifier sur la
    version déployée : support des clients publics et des ports loopback dynamiques.* Le Device
    Flow (RFC 8628) n'est, à ma connaissance, pas supporté par Forgejo/Gitea.
11. **Flux de mise à jour auto-hébergé** : `electron-updater` en provider `generic` qui pointe
    vers `https://git.acme.fr/polenta-updates/`, fichiers statiques servis par Caddy. Choix du
    provider via la config machine (§4.1-3). Nécessaire si le pare-feu du client bloque
    github.com. Alternative : désactiver l'auto-update et laisser le DSI distribuer le MSI.
12. **Certificat interne** : si le client exige un serveur uniquement interne avec sa propre
    autorité de certification, Node 20 (Electron 31) ne lit pas le magasin Windows. Il faut alors
    injecter la CA dans le dispatcher undici (`git-http.ts`, `net-proxy.ts`) depuis un chemin
    déclaré dans la config machine. Avec Let's Encrypt (cas par défaut, §5), rien à faire.

### 4.4 Ce qu'on ne fait PAS dans Polenta

- **Pas de console d'administration des comptes et des équipes dans Polenta** : l'interface
  d'admin de Forgejo le fait déjà, avec ses propres contrôles de sécurité. Un lien
  « Administration du serveur » dans le menu compte suffit.
- **Pas de Git LFS** : isomorphic-git ne le gère pas. Garder les repos en YAML et drawio, et
  fixer une taille maximale de fichier côté serveur.

### 4.5 Intégrité de l'audit (point d'attention pour la certification)

L'auteur d'un commit est déclaré par le client git. N'importe qui ayant le droit d'écriture
peut pousser un commit au nom d'un autre. Pour un audit IEC 60335 ou 62133, deux niveaux :

- **v1** : Polenta écrit toujours l'auteur depuis l'identité serveur (P0-1). Forgejo journalise
  quel compte a poussé (activité du repo et journaux Caddy). C'est suffisant dans la plupart
  des cas.
- **Plus tard, si exigé** : commits signés, ou hook serveur qui vérifie que l'auteur du commit
  correspond au compte qui pousse.

### 4.6 Estimation de charge (ordre de grandeur)

| Lot | Contenu | Charge |
|---|---|---|
| P0 | §4.1 points 1 à 5 | 4–6 j |
| P1 | §4.2 points 6 à 9 | 5–8 j |
| P2 | §4.3 points 10 à 12 | 4–6 j |
| Infra | compose, scripts, documentation d'exploitation (§5–6) | 2–3 j |

---

## 5. Déploiement serveur

### 5.1 Architecture

```
Internet ──443──▶ Caddy (TLS Let's Encrypt automatique, HTTP/2, en-têtes de sécurité)
                    ├─▶ forgejo:3000      (web + API + git HTTPS)
                    └─▶ /polenta-updates/ (fichiers statiques, option §4.3-11)
                 forgejo ──▶ SQLite (défaut) ou Postgres (option > 50 utilisateurs)
cron quotidien : forgejo dump ──▶ restic ──▶ stockage objet externe (autre fournisseur ou autre région)
```

Un seul `docker-compose.yml`, trois services au maximum. SSH git désactivé : Polenta n'en a pas
besoin, et c'est un port de moins exposé. Ports ouverts sur le VPS : 22 (admin, clé
uniquement), 80 (redirection et challenge ACME), 443.

SQLite convient pour un client de 5 à 50 personnes et simplifie la sauvegarde et la
restauration. Postgres s'impose au-delà, ou si le client a une politique de base de données.

### 5.2 Livrable : un dossier `deploy/` versionné

```
deploy/
├── docker-compose.yml      ← caddy + forgejo (+ postgres en profil optionnel)
├── Caddyfile
├── .env.example            ← DOMAIN, ADMIN_EMAIL, ORG_NAME, SMTP_*, BACKUP_REPO, BACKUP_PASSWORD
├── install.sh              ← installation initiale, idempotente
├── update.sh               ← sauvegarde, pull de l'image (version épinglée), redémarrage, contrôle de santé
├── backup.sh / restore.sh
├── polenta-admin.sh        ← opérations courantes (cf. §5.4)
└── RUNBOOK.md              ← procédures pour l'admin du client
```

### 5.3 `install.sh` — ce qu'il fait (Debian 12/13 ou Ubuntu 24.04)

1. Vérifie l'OS, que le DNS du domaine pointe bien sur l'IP du VPS, et que les ports 80/443
   sont libres.
2. Installe Docker (dépôt officiel), `ufw`, `fail2ban`, `unattended-upgrades` et `restic`.
3. Durcit SSH : clé uniquement, root interdit, utilisateur `deploy` dans le groupe docker.
4. Génère les secrets (`SECRET_KEY`, `INTERNAL_TOKEN`, mot de passe Postgres) dans `.env`
   (chmod 600).
5. Écrit la configuration Forgejo avec les valeurs sûres par défaut :
   - `DISABLE_REGISTRATION = true` : seuls les admins créent des comptes ;
   - `REQUIRE_SIGNIN_VIEW = true` : rien n'est visible sans être connecté ;
   - `DEFAULT_PRIVATE = private`, `FORCE_PRIVATE = true` ;
   - `DISABLE_SSH = true`, `ROOT_URL = https://<DOMAIN>/` ;
   - mailer SMTP (réinitialisation de mot de passe, notifications) ;
   - taille maximale d'upload et de fichier raisonnable ;
   - 2FA : obligatoire pour les admins au minimum (*option d'obligation globale selon la
     version, à vérifier*).
6. `docker compose up -d`, puis attend que `/api/healthz` réponde.
7. Crée le premier admin (`forgejo admin user create … --must-change-password`).
8. Via l'API : crée l'organisation du client, les équipes `auteurs`/`testeurs`/`lecteurs` du
   §3, et un repo d'exemple initialisé depuis le template Polenta.
9. Installe le cron de sauvegarde et fait une première sauvegarde suivie d'une vérification
   (`restic check`).
10. Affiche le récapitulatif : URL, identifiants admin temporaires, fichier de config machine
    Polenta à distribuer (§4.1-3).

Cible : **un VPS vierge en service en moins de 30 minutes**. L'admin copie le dossier
`deploy/`, remplit `.env` et lance `./install.sh`.

### 5.4 `polenta-admin.sh` — opérations courantes sans passer par l'interface web

| Commande | Effet |
|---|---|
| `user add <login> <email> [--team auteurs]` | Crée le compte, envoie le mail d'activation, l'ajoute à l'équipe |
| `user import users.csv` | Création en masse (login, nom, email, équipes) |
| `user disable <login>` | Départ : désactive le compte et révoque ses jetons (B8) |
| `team add <équipe> <droit> [repos…]` | Crée une équipe projet |
| `team member add/rm <équipe> <login>` | |
| `project create <nom> [--team …]` | Crée le repo depuis le template et l'attache aux équipes |
| `access report` | Export CSV des accès (utilisateur × repo × droit), pour la revue d'accès annuelle (ISO 27001) |

L'interface web de Forgejo fait tout cela aussi. Le script sert aux opérations en masse, à la
traçabilité des actions d'admin et aux admins qui préfèrent la ligne de commande.

### 5.5 Sauvegarde et restauration (B7)

- **Quotidien** : `forgejo dump` (repos, base, configuration), envoyé par restic vers un
  stockage objet S3 chez un autre fournisseur ou dans une autre région. Le contenu est chiffré
  côté serveur avant l'envoi.
- **Rétention** : 7 quotidiennes, 4 hebdomadaires, 12 mensuelles.
- **En plus** : snapshot VPS hebdomadaire proposé par l'hébergeur (restauration rapide, mais
  pas une vraie sauvegarde, car même fournisseur).
- **Supervision de la sauvegarde** : ping vers un service de type healthchecks.io à la fin du
  cron. Une alerte part si la sauvegarde n'a pas tourné.
- **Restauration testée** : `restore.sh` sur un VPS jetable, au moins à la mise en service puis
  une fois par trimestre. Une sauvegarde jamais restaurée n'est pas une sauvegarde.
- Les clones locaux des utilisateurs forment une copie partielle de fait. Ils ne remplacent pas
  la sauvegarde : ils n'ont ni toutes les branches, ni les comptes, ni les droits.

### 5.6 Supervision et maintenance (B9)

- **Disponibilité** : sonde externe sur `https://<DOMAIN>/api/healthz` (Uptime Kuma sur une
  autre machine, ou un service SaaS).
- **Alertes** : disque > 80 %, certificat qui expire dans moins de 14 jours (Caddy renouvelle,
  mais on surveille quand même).
- **OS** : `unattended-upgrades` pour les correctifs de sécurité, redémarrage automatique la
  nuit si nécessaire.
- **Forgejo** : image épinglée sur une version **LTS** et `update.sh` mensuel (sauvegarde,
  mise à jour, contrôle de santé, retour arrière possible). Ne jamais utiliser `latest`.
- **Journaux** : rotation des journaux Docker (`max-size`) ; `fail2ban` sur sshd et sur les
  échecs de connexion Forgejo.

---

## 6. Questions à poser au client avant de démarrer

1. **Qui exploite le serveur ?** Nous (infogérance, à facturer au mois) ou leur DSI (on livre
   le script et le RUNBOOK) ? Cela détermine qui reçoit les alertes et qui a l'accès root. À
   formaliser dans un tableau RACI.
2. **Annuaire** : ont-ils AD, Entra ID ou Google Workspace ? Si oui, on branche LDAP ou OIDC,
   les comptes et équipes se synchronisent, et le §4.3-10 (OAuth PKCE) passe en P0.
3. **Souveraineté** : UE suffit, ou France exigée ? Qualification SecNumCloud requise ? Cela
   restreint le choix de l'hébergeur.
4. **Accès réseau** : serveur public sur Internet (le plus simple, Let's Encrypt), ou interne
   et VPN uniquement (CA interne, §4.3-12, et DNS interne) ?
5. **Domaine** : un sous-domaine chez eux (`polenta.acme.fr`, ils créent l'enregistrement DNS
   A), ou chez nous ?
6. **Nombre d'utilisateurs** et nombre de projets et composants prévus à 2 ans.
7. **Postes clients** : qui installe Polenta ? Déploiement par MSI et GPO ? github.com est-il
   joignable (auto-update, §4.3-11) ? Y a-t-il un proxy d'entreprise (déjà géré par
   `net-proxy.ts`) ?
8. **Exigences d'audit** : le cloisonnement par rôle au niveau des fichiers (§3) ou la
   signature des commits (§4.5) sont-ils contractuels ?
9. **Sous-traitants et partenaires externes** : doivent-ils accéder à certains composants ? Si
   oui, prévoir des équipes dédiées et des comptes externes à durée limitée.
10. **Engagement de service** : disponibilité attendue, fenêtre de maintenance, RPO (perte de
    données maximale acceptable, 24 h avec une sauvegarde quotidienne) et RTO (délai de
    remise en service).

### Point commercial

Un VPS par client plutôt qu'un serveur mutualisé avec une organisation par client : isolation
des données, aucun risque de fuite entre clients, résiliation simple (on rend la sauvegarde et
on détruit le VPS), et coût marginal faible (§7). Le kit `deploy/` devient un produit
réutilisable : « Polenta Server », vendu en licence avec installation, ou en infogérance.

---

## 7. Recommandation VPS

Forgejo est très léger et les repos Polenta (YAML, drawio) sont petits. La taille du VPS se
joue sur la marge (pics de clone, `forgejo dump`, mises à jour) plus que sur la charge.

| Profil | vCPU | RAM | Disque | Exemples d'offres (UE, ordres de prix 2026, à vérifier) |
|---|---|---|---|---|
| **Recommandé : 5 à 50 utilisateurs** | 2 | 4 Go | 80 Go NVMe | Hetzner CX/CPX 2 vCPU (DE/FI) ~5–9 €/mois · OVHcloud VPS (FR) ~7–12 €/mois · Scaleway (FR) ~10–15 €/mois |
| 50 à 200 utilisateurs, ou Forgejo Actions (CI `check.py`) sur la même machine | 4 | 8 Go | 160 Go NVMe | ~15–30 €/mois |
| Minimum absolu (démo, POC) | 1 | 2 Go | 40 Go | ~4–6 €/mois |

- **OS** : Debian 12/13 ou Ubuntu 24.04 LTS.
- **Datacenter** : en France (OVHcloud Gravelines/Roubaix/Strasbourg, Scaleway Paris) si le
  client a une sensibilité souveraineté, ce qui est probable. Sinon Hetzner, le meilleur
  rapport prix/performance en UE.
- **Options à prendre** : snapshots ou sauvegardes automatiques du fournisseur (~20 % du prix
  du VPS) et IPv4 publique.
- **Stockage de sauvegarde externe** : stockage objet S3 chez un **autre** fournisseur ou dans
  une autre région, par exemple Scaleway Object Storage ou OVHcloud Object Storage si le VPS
  est chez Hetzner, ou une Hetzner Storage Box pour un VPS OVH. Quelques €/mois pour moins de
  100 Go.
- **Budget total** : **~10–25 €/mois** d'infrastructure pour le profil recommandé, sauvegarde
  externe comprise.

Mon choix par défaut pour ce client : **OVHcloud VPS 2 vCPU / 4 Go / 80 Go en France**, Debian
12, sauvegardes restic vers Scaleway Object Storage (Paris). Hébergement français, deux
fournisseurs distincts, environ 15 €/mois.

---

## 8. Articulation avec GH44 (client web)

GH44 (accès à Polenta depuis un navigateur, en phase Spec) laisse ouverts l'hébergement,
l'authentification, le multi-utilisateur et l'identité git des commits faits depuis le web. Le
serveur Forgejo décrit ici répond à une partie de ces questions. Les deux chantiers doivent
donc partager les mêmes fondations plutôt que d'en construire deux.

| Sujet | Décision commune proposée |
|---|---|
| **Fournisseur d'identité** | Forgejo, seule source de vérité des comptes, équipes et droits. Le desktop s'y connecte par jeton (§4.1), le client web par OpenID Connect (Forgejo est fournisseur OAuth2/OIDC). Le squelette `apps/web` repose sur Auth0 : à remplacer, pas à réutiliser. |
| **Droits** | Aucun modèle de droits propre au backend web. Il agit **avec le jeton OAuth de l'utilisateur** pour cloner et pousser. Forgejo applique donc les mêmes droits que pour le desktop, et un compte désactivé perd l'accès partout à la fois. |
| **Identité des commits web** | Auteur = identité Forgejo de l'utilisateur, obtenue par le même `GitProvider.resolveIdentity`. Jamais un compte technique partagé, sinon l'audit est perdu (§4.5). |
| **Code partagé** | `GitProvider` et la résolution d'identité doivent vivre hors du code Electron : pas de dépendance à `keytar` ni à `electron`, avec un stockage de jeton injecté (keytar sur le desktop, session serveur sur le web). Même principe que `electron-shim.ts` pour le serveur MCP. |
| **Déploiement** | Le kit `deploy/` prévoit dès le départ une route Caddy et un service compose `polenta-web`, inactif par défaut. Le client web s'ajoute au même VPS sans refaire l'infrastructure. |
| **Dimensionnement** | Le backend web garde un clone et un index en mémoire par workspace ouvert, ce qui fait monter la RAM. Si GH44 est déployé sur le même VPS : passer au profil **4 vCPU / 8 Go / 160 Go** (§7). |

Ordre conseillé : l'issue serveur auto-hébergé (P0 + infra) d'abord. Elle livre l'identité et le
serveur dont GH44 dépendra pour son authentification.

---

## 9. Plan de mise en œuvre proposé

1. Ouvrir une issue « Support serveur auto-hébergé Forgejo » (P0 + infra), et une issue par
   lot P1 et P2.
2. **Infra** : dossier `deploy/` et RUNBOOK, testés sur un VPS jetable, restauration comprise.
3. **P0** : provider Forgejo, config machine, login par mot de passe → jeton, gestion du 401.
4. **Pilote** chez le client : 3 à 5 utilisateurs, un projet, un composant, et un exercice de
   départ d'un salarié (désactivation du compte).
5. **P1**, puis **P2** selon les réponses au §6 (SSO, réseau interne, auto-update).
