# GH45 — Sprint 1 : infra de base (kit `deploy/`)

Périmètre : `specs/GH45-design.md` §2 (S1), §5.1 à §5.6, §6. Hôte de test : `vps-f515f9c6`
(OVH, Debian 13, 2 vCPU / 3,7 Go / 40 Go), `BASE_DOMAIN=forge.esquaresoft.fr` (wildcard
`*.forge` → CNAME `forge`). Dates : 2026-10-09 et 2026-10-10.

## Fichiers créés

| Fichier | Rôle |
|---|---|
| `deploy/polenta-host.sh` | `setup`, `status`, `instance add/list/stop/start` (le reste répond « sprint 3 ») |
| `deploy/polenta-admin.sh` | `user add/import/disable/enable`, `team add`, `team member add/rm`, `project create`, `oauth-app create` |
| `deploy/lib/common.sh` | journal, erreurs (`die` code 3 + piège `ERR` : aucune sortie silencieuse), env sans `source`, écritures idempotentes, DNS, `admin.log` |
| `deploy/lib/forgejo-api.sh` | client API via le Caddy local (`--resolve 127.0.0.1`), délais, pagination, équipes |
| `deploy/lib/caddy.sh` | Caddyfile et compose de Caddy générés, un site par instance, réseaux reliés à chaud |
| `deploy/instance/docker-compose.yml` | une forge, réseau `polenta-<nom>`, aucun port publié ; profil `web` (GH44) inactif |
| `deploy/host.env.example`, `deploy/config.example.json` | modèles |
| `deploy/tests/acceptance.sh` | vérifications externes (critère 14) |
| `deploy/.gitattributes` | fins de ligne LF forcées (scripts exécutés sous Linux depuis un poste Windows) |

## Comportement implémenté

- **Hôte** : Docker 29.9 (dépôt officiel), journaux Docker tournants, `ufw` (22/80/443 + 443/udp),
  fail2ban (sshd), mises à jour de sécurité automatiques (redémarrage 04:00), SSH par clé
  uniquement et root interdit (seulement si l'admin a une clé), LLMNR/mDNS coupés (port 5355,
  ouvert sur l'image OVH), Caddy partagé. `setup` complet en 46 s, second passage sans aucune
  écriture.
- **Instance** : nom, DNS, mémoire et domaine vérifiés avant toute création ; secrets générés par
  l'image elle-même ; forge sur son réseau ; site Caddy à chaud ; HTTPS Let's Encrypt ; compte
  d'exploitation `polenta-ops` + jeton ; organisation privée ; équipes `auteurs` (écriture +
  création de repos), `testeurs` (écriture), `lecteurs` (lecture) ; admin client facultatif
  (admin de l'instance, propriétaire de l'organisation) ; démo importée (5 repos, tags compris) avec
  les URLs des dépendances réécrites sur **toutes les branches** ; `polenta-config.json` pré-rempli.
  Ajout en 25 à 30 s. Un ajout interrompu reprend là où il s'est arrêté ; un ajout terminé est
  refusé.
- **Administration** : chaque commande d'écriture est tracée dans `admin.log` (jamais de mot de
  passe). Le mot de passe temporaire d'un compte est affiché dès sa création, avant les étapes qui
  peuvent échouer.

## Résultats du point de vérification API (design §6)

Mesuré sur Forgejo 15.0.9 (`acme`) et Gitea 28.1.0 (`gitea-test`) avec une sonde Python (comptes
`probe*` créés puis supprimés).

| § | Question | Forgejo 15.0.9 | Gitea 28.1.0 |
|---|---|---|---|
| 6.1 | Préfixe des variables | `FORGEJO__` et `GITEA__` lus | `GITEA__` seul |
| 6.2 | Scopes minimaux | `write:repository` + `read:user` suffisent pour repos, git, membres, permissions ; **créer un repo d'organisation exige `write:organization`** (`read:organization` → 403) | idem |
| 6.3 | Jeton : mauvais mot de passe | 401 « user's password is invalid » | 401 « invalid username, password or token » |
| 6.3 | Jeton : utilisateur inconnu | 401 « user does not exist » | 401 générique (idem) |
| 6.3 | Jeton : 2FA, code absent ou faux | 401 « invalid provided OTP » | 401 générique (idem) |
| 6.3 | Jeton : 2FA, bon code | 201 avec `X-Gitea-OTP` **ou** `X-Forgejo-OTP` | 201 avec `X-Gitea-OTP` seulement |
| 6.3 | Jeton : compte interdit | 401 « user is not allowed login » | 401 générique (idem) |
| 6.4 | Organisations où créer | `GET /users/{u}/orgs/{org}/permissions` → `can_create_repository` | idem (`can_read`/`can_write` incohérents, ne pas s'y fier) |
| 6.5 | Jeton existant d'un compte interdit | API **403** « prohibited from signing in » ; git : **HTTP 200 + page HTML** (`info/refs`) | idem |
| 6.5 | Lister les jetons d'un autre (admin + `Sudo`) | 200 | 401 |
| 6.6 | Journal d'échec (fail2ban) | `gitea.log` : « Failed authentication attempt for X from IP » (connexion web) ; ligne de routeur « completed … for IP:0, 401 Unauthorized » (git **et** API) ; IP réelle du client bien journalisée | — |
| 6.7 | Jeton OAuth2 utilisable pour git HTTPS | **Oui** (nom d'utilisateur quelconque, ex. `oauth2`) ; API en `token` et `Bearer` ; `expires_in` + `refresh_token` | Oui, idem |

Autres constats :
- Gitea 28 refuse une équipe qui porte à la fois `units` et `units_map` (400) : seul `units_map`
  est envoyé.
- Forgejo 15 n'a plus de champ `_csrf` dans ses formulaires (protection par en-têtes
  `Origin`/`Sec-Fetch-Site`). Sans effet sur Polenta, qui n'utilise que l'API.
- Un jeton invalide sur git : 401 `text/plain` (classable normalement).

## Divergences par rapport au design (et révisions faites dans `GH45-design.md` §12)

1. Variables de la forge : préfixe `GITEA__` seul, valeurs entre apostrophes (docker compose
   interprète `$` et `#` dans une valeur nue). Plus d'`app.ini.tmpl`.
2. Caddyfile **généré** (`/opt/polenta/caddy/etc/Caddyfile`, ligne `email` seulement si
   `ACME_EMAIL` est renseigné — il est facultatif) et dossier `etc/` monté entier : un fichier
   monté seul ne voit pas un remplacement atomique.
3. `request_body max_size 1GB` au lieu de 60 Mo : le push git transporte le packfile dans le corps.
4. `project create` ne pousse que le `.gitignore` ; `AGENTS.md` est (re)généré par Polenta à la
   première ouverture.
5. Démo : URLs réécrites sur toutes les branches de tous les repos (`comp-moteur` dépend aussi
   d'`if-bus-interne`). **Limite** : les tags `RE1`/`RE2` (baselines) gardent leurs URLs GitHub —
   les réécrire changerait l'historique ; ouvrir ces baselines sur un poste sans accès à GitHub ne
   récupérera pas les composants.
6. Points qui changent le S2 (design §3) : scopes du jeton, en-tête OTP, champ 2FA facultatif pour
   Gitea, détection du compte désactivé (403 API / HTML côté git, pas de 401).
7. Point qui change le S3 (design §5.9) : fichier `gitea.log` (et non `forgejo.log`), filtre sur la
   ligne de routeur 401.

## Revue de code

`/code-review` (medium) sur `deploy/` : 10 constats, tous traités.

| Constat | Traitement |
|---|---|
| Mot de passe perdu si l'ajout à une équipe échoue (`user add`/`import`) | Affiché dès la création ; en import, inclus dans la ligne d'erreur |
| Mot de passe de l'admin client perdu si la démo échoue | Affiché dès la création |
| `polenta-repo.yaml` de `comp-moteur` et autres branches non réécrits | Toutes les branches de tous les repos (limite des tags documentée) |
| Site Caddy invalide laissé sur disque après un rechargement refusé | Fichier retiré, Caddy rechargé, erreur explicite |
| Réseau externe déclaré pour une instance jamais démarrée | Seuls les réseaux existants sont déclarés |
| Révocation des jetons via `Sudo` jamais exécutée | **Infirmé sur Forgejo** (200, §6.5), confirmé sur Gitea (401) ; garantie = interdiction de connexion, vérifiée sur les deux ; commentaire et message alignés |
| Ubuntu 24.04 : `reload ssh` échoue (activation par socket), `/run/sshd` absent | Rechargement seulement si le service est actif ; `/run/sshd` créé |
| Secret vide si sa génération échoue | `ensure_generated_secret` : arrêt sur échec ou valeur vide |
| `$`/`#` dans un mot de passe SMTP corrompus par compose | Valeurs entre apostrophes ; apostrophe refusée avec message |
| `API_STATUS` = « 000\n000 », pas de délai, erreur d'API prise pour « équipe absente » | Statut normalisé, délais (10 s connexion, 60 s, 600 s pour un import), résultats par variable globale (plus de `die` perdu dans un sous-shell) |

## Tests exécutés (`specs/GH45-tests.md`, sprint 1)

| ID | Résultat |
|---|---|
| S1-1 | ✓ `setup` en 46 s |
| S1-2 | ✓ second passage : aucun fichier modifié sous `/etc` et `/opt/polenta` |
| S1-3 | ✓ `acme` (+ admin client `alice`, démo 5 repos, URLs réécrites) |
| S1-4 | ✓ relance refusée ; reprise d'un ajout interrompu vérifiée (incident `random_secret` corrigé) |
| S1-5 | ✓ `globex` ajouté ; sonde sur `acme` : 65 requêtes, 0 échec |
| S1-6 | ✓ `instance list` |
| S1-7 | ✓ `user add` (+ équipes, mot de passe affiché, `admin.log` sans secret) |
| S1-8 | ✓ import de 10 lignes : 8 créés, 2 erreurs motivées, import mené au bout |
| S1-9 | ✓ équipe `projet-x` limitée à un repo, membre ajouté |
| S1-10 | ✓ `project create essai --team projet-x` (privé) |
| S1-11 | ✓ `oauth-app create polenta-web` |
| S1-12 | ✓ stop/start `acme` ; sonde sur `globex` : 38 requêtes, 0 échec |
| S1-13 | ✓ `acceptance.sh` sur les 3 instances (18 vérifications chacune) |
| S1-14 | ✓ compte d'`acme` refusé sur `globex` (401) |
| S1-15 | ✓ depuis `forgejo-acme` : nom `forgejo-globex` non résolu, IP injoignable |
| S1-16 | ✓ repo demandé public → créé privé |
| S1-17 | ✓ `--instance` omis avec 2 instances : erreur listant les instances |
| S1-18 | ✓ domaine qui ne pointe pas sur l'hôte : refus avant toute création |
| S1-19 | ✓ sans clé autorisée : avertissement, configuration SSH inchangée |
| S1-20 | ✓ `shellcheck` : zéro avertissement |
| S1-21 | ✓ point de vérification §6 sur Forgejo et Gitea (ci-dessus) |

Mesures : forge ~105-130 Mo de RAM par instance au repos, Caddy ~26 Mo ; disque : ~6-9 Mo par
instance (démo comprise), images Docker 680 Mo au total.

## État laissé sur l'hôte

- Instances de test : `acme` (Forgejo, démo, comptes `alice`, `bob`, `u01`…`u10`, `charlie`, `dora`),
  `globex` (Forgejo, vide), `gitea-test` (Gitea 28.1.0, gardée pour les tests de compatibilité du
  S2).
- **Hors kit** : le site `www.esquaresoft.fr` (conteneur `esquaresoft-web`, `/opt/esquaresoft`),
  servi par le Caddy du kit via `etc/sites/_esquaresoft.caddy` et le réseau `polenta-edge`. Le kit
  ne touche à aucun fichier `_*.caddy` ni à ce réseau. **Conséquence : les tests destructifs du S3
  (réinstallation de l'OS, S3-13/S3-15) couperaient le site.**

## Retour de validation (2026-10-10)

- **Accueil public** : `https://acme.forge.esquaresoft.fr/` affichait la page marketing de
  Forgejo (« Forgejo: Beyond coding. We forge. ») sans connexion. Aucune donnée exposée (repos,
  exploration et API redirigeaient déjà vers la connexion), mais le test d'acceptation ne
  contrôlait pas la racine. Corrigé : `server.LANDING_PAGE=login`, nom d'instance
  `APP_NAME` (défaut « Forge <organisation> », option `instance add --app-name`), et nouvelle
  vérification « accueil → page de connexion » dans `acceptance.sh` (échoue avant le correctif,
  passe après, sur les 3 instances).
- **Tests destructifs du S3** (réinstallation de l'OS, S3-13/S3-15) : le demandeur accepte des
  micro-coupures de `www.esquaresoft.fr`, à condition de republier le site et de le vérifier dans
  le cadre du test.

## Comment tester manuellement

```bash
# Depuis le poste
bash deploy/tests/acceptance.sh acme.forge.esquaresoft.fr globex.forge.esquaresoft.fr

# Sur l'hôte
sudo polenta-host status
sudo polenta-admin --instance acme user add test1 test1@esquaresoft.fr --team lecteurs
```

Dans un navigateur : `https://acme.forge.esquaresoft.fr`, connexion avec `alice` (mot de passe
temporaire transmis à part), puis vérifier l'organisation `acme`, ses équipes et les 5 repos de
démo.
