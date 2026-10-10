# SPEC-ACCOUNTS-AUTH — Connexion et gestion des comptes git

> Dernière révision : 2026-10-11 (GH45 — forges Forgejo/Gitea, connexion par mot de passe, configuration machine et par équipe, accès révoqué)  
> Dépend de : [SPEC-ELECTRON-DESKTOP.md](SPEC-ELECTRON-DESKTOP.md)

---

## 1. Principes fondamentaux

| Règle | Détail |
|-------|--------|
| **Un compte = un serveur + un jeton** | Aucun mot de passe n'est jamais stocké. Tout accès git/API passe par un jeton (PAT, jeton OAuth, ou jeton créé par la forge à la connexion par mot de passe), stocké dans le trousseau OS via `keytar` (service `polenta`), jamais en clair sur disque. |
| **`auth.json` (`userData`) ne stocke pas de secrets** | Métadonnées seulement : `StoredAccount` (`remoteHost`, `username`, `name`, `email`, `provider`, `baseUrl`) et le compte par défaut (`<hôte>:<login>`). |
| **Provider de forge** (GH45) | Chaque compte a un type de forge : `github`, `forgejo` (Forgejo **et** Gitea, API `/api/v1` commune) ou `generic` (git HTTPS sans API connue). Un `auth.json` antérieur sans `provider`/`baseUrl` est lu ainsi : `github.com` → `github`, sinon `generic` ; `baseUrl = https://<hôte>`. Aucune migration n'est écrite. Code : `main/services/forge/` (providers, détection, erreurs d'accès). |
| **Méthodes de connexion** | GitHub : jeton ou Device Flow. Forgejo/Gitea : **identifiant + mot de passe (+ code 2FA)** → jeton créé par la forge, ou jeton. Autre serveur : jeton. Toutes aboutissent au même stockage (`persistToken`). |
| **Identité = celle du serveur** | Nom et e-mail de l'auteur des commits viennent du compte de la forge (`/api/v1/user` ou `api.github.com/user`). Pour `github` et `forgejo`, un échec de résolution d'identité **fait échouer la connexion** (plus de compte « Git User ») ; le repli minimal ne reste que pour `generic`. |

---

## 2. Écran de connexion (`/login`, desktop)

1. **Serveur** : liste issue de la configuration machine (§6) — github.com, gitlab.com, « Serveur de votre entreprise… » (URL libre) ; avec `hideGithub` et `defaultServer`, le serveur de l'entreprise est affiché **seul**. Le paramètre de recherche `server` pré-remplit l'URL (bannière d'accès révoqué, lien d'invitation).
2. **Détection** (`auth:detect-forge`, à la validation de l'URL, anti-rebond) :
   - `github.com` → `github`, sans appel réseau ;
   - `GET /api/v1/version` : 200 `{version}`, ou 401/403 JSON « sign in » (forge qui exige la connexion) → famille Gitea ; `/api/forgejo/v1/version` 404 → Gitea, sinon Forgejo ;
   - autre réponse → `generic`. Redirections GET suivies (http → https, hôte canonique) : la base retenue est l'origine finale ; un jeton n'est jamais envoyé à un autre hôte.
3. **Formulaire selon la forge** :
   - `github` : jeton + Device Flow (§4) ;
   - `forgejo` : identifiant / mot de passe ; le champ code 2FA apparaît sur `otp-required` (Forgejo). Gitea ne distingue pas les échecs (§3) : pour un serveur Gitea, le champ « Code 2FA (si activée) » est toujours affiché, facultatif. Lien « Utiliser un jeton d'accès à la place » ;
   - `generic` : jeton.
4. **Lien d'invitation** `polenta://connect?server=<https>&login=<identifiant>` (GH45 S2b) : ouvre l'écran pré-rempli, **jamais** de connexion automatique ; `https` uniquement ; ignoré avec un message si la configuration machine impose un autre serveur. Desktop : instance unique (le lien reçu par un second lancement est transmis à la fenêtre ouverte), protocole enregistré par l'application installée seulement ; un lien reçu avant que l'interface ne soit prête est conservé (`app:take-pending-invite`).

## 3. Connexion par mot de passe (Forgejo/Gitea)

`AuthService.loginWithPassword(serverUrl, login, password, otp?)` → `PasswordLoginResult` :
1. détection : autre chose que `forgejo` → `not-a-forge` ;
2. `POST /api/v1/users/{login}/tokens` en Basic Auth, en-tête `X-Gitea-OTP` si un code est fourni (accepté par Forgejo et Gitea), corps `{ name, scopes }` :
   - nom `polenta-<poste>-<AAAAMMJJ-HHmm>-<aléa>` (deux connexions dans la même minute restent possibles) ;
   - scopes `write:repository`, `read:user`, `write:organization` (ce dernier est nécessaire pour créer un repo d'organisation, §8) ;
3. `persistToken`, puis levée de l'état « accès révoqué » de l'hôte.

Résultats d'échec (mesurés sur Forgejo 15.0.9 et Gitea 28.1.0) :

| Résultat | Réponse de la forge |
|---|---|
| `otp-required` / `invalid-otp` | 401 « invalid provided OTP » sans / avec code envoyé (Forgejo) |
| `account-disabled` | « not allowed login », « prohibited » |
| `password-change-required` + URL | 403 « You must change your password. Change it at: <url> » (compte neuf). Le desktop n'ouvre que l'URL annoncée par la forge **sur le même serveur** (`auth:open-password-change`, sans argument venant du renderer). |
| `invalid-credentials` | Mauvais identifiant ou mot de passe ; **toute** erreur 401 de Gitea |
| `network` | Serveur injoignable, réponse inattendue |

Sécurité : le mot de passe n'apparaît que dans l'en-tête `Authorization` construit localement (`forge-http.ts`). Il n'est ni stocké, ni journalisé, ni renvoyé dans une erreur (les erreurs ne contiennent ni en-têtes ni corps de requête).

## 4. GitHub OAuth Device Flow (T98)

Second mode de connexion, visible uniquement quand le remote effectif résout vers `github.com` (comparaison par hostname normalisé, pas de comparaison de chaîne stricte — tolère `https://github.com/`, casse différente, etc.).

**Prérequis** : une OAuth App GitHub avec *Device Flow* activé (Settings → Developer settings → OAuth Apps → onglet **Optional features**), son `client_id` embarqué en dur (constante `GITHUB_OAUTH_CLIENT_ID`, `forge/github.provider.ts`, non secret par nature — le Device Flow ne nécessite aucun *client secret*). Pas de variable d'environnement : `electron-vite` ne charge pas les `.env` non préfixés dans `process.env` du process main, une config externe aurait été silencieusement ignorée.

**Séquence :**
1. `AuthService.startDeviceFlow(remote)` — vérifie `host === 'github.com'`, `POST github.com/login/device/code`, ouvre `verification_uri` dans le navigateur système (`shell.openExternal`), renvoie `{ deviceCode, userCode, verificationUri, expiresIn, interval }`.
2. Le renderer affiche `userCode` et poll `AuthService.pollDeviceFlow(remote, deviceCode)` — self-scheduling via `setTimeout` (jamais de recouvrement de requêtes), avec un compteur de génération : toute réponse qui arrive après une annulation ou un redémarrage du polling est silencieusement ignorée.
3. `pollDeviceFlow` renvoie un statut discriminé : `pending` (continue), `slow_down` (nouvel intervalle), `success` (identité résolue + jeton persisté via le même `persistToken` que le PAT), `expired`, `denied`, ou `error`.
4. `pollDeviceFlow` vérifie aussi `host === 'github.com'` avant d'interroger l'endpoint GitHub — un remote non-GitHub ne peut jamais faire persister un token GitHub sous son propre host.

**Annulation** : bouton « Annuler » côté renderer — arrête le polling programmé et invalide la génération courante, donc une réponse encore en vol ne peut plus altérer l'état affiché après coup.

## 5. Stockage, compte courant, déconnexion

- `persistToken(remote, token, provider)` (jeton, Device Flow, mot de passe) : jeton sous `${host}:${login}` dans `keytar`, compte dans `auth.json`, compte par défaut = ce compte. `resolveIdentity` reçoit toujours le **remote complet** (scheme + hôte + port), jamais seulement le hostname.
- `auth:current-account` → `ForgeAccount | null` (sans jeton, sans réseau) : le compte par défaut s'il a un jeton, sinon le premier qui en a un. Remplace les anciennes boucles sur une liste d'hôtes codée en dur côté renderer.
- `auth:logout` (desktop) : jetons locaux et compte supprimés, le compte suivant devient compte par défaut. Le jeton reste valide côté forge (révocable dans ses paramètres) : le panneau Compte d'un compte `forgejo` le rappelle.
- Jetons « nus » d'anciennes versions (sans compte, sur `github.com`/`gitlab.com` seulement — `LEGACY_BARE_TOKEN_HOSTS`, seule liste d'hôtes hors provider) : pris en compte à la lecture (`hasAnyAccount`, `projectUsername`, `logout`), sans migration.
- GH45 S4 — `forge:accounts` : comptes `forgejo` connectés (compte par défaut en tête), pour les fonctions de forge de l'accueil (SPEC-PROJECT-MANAGEMENT §9.1).

## 6. Configuration machine (option DSI, GH45)

Fichier facultatif, déployé par l'informatique : `%ProgramData%\Polenta\config.json` (Windows), `/Library/Application Support/Polenta/config.json` (macOS), `/etc/polenta/config.json` (Linux) ; `POLENTA_CONFIG` peut désigner un autre fichier. Absent → comportement inchangé.

| Clé | Effet |
|---|---|
| `defaultServer` | Serveur de l'entreprise pré-sélectionné |
| `hideGithub` | github.com, gitlab.com et le Device Flow masqués ; démo publique masquée |
| `demoProjectUrl` | Projet de démonstration (miroir sur la forge de l'entreprise) |
| `autoUpdate: false` | Vérification des mises à jour désactivée et **verrouillée** (aucune requête vers github.com) |

Validation clé par clé : une clé inconnue ou invalide est ignorée (avertissement dans le journal) ; un JSON illisible équivaut à l'absence de fichier. Web : construite par l'exploitant (`POLENTA_WEB_DEFAULT_SERVER`, `POLENTA_WEB_DEMO_PROJECT_URL`).

## 7. Configuration par équipe (GH45 S2b)

L'utilisateur se contente de se connecter. Sa configuration vient de la forge : `<organisation>/polenta-config/config.yaml`, modifiable par les propriétaires de l'organisation seulement (branche `main` protégée), créé par le kit d'hébergement. Organisation retenue : la plus ancienne de l'utilisateur qui a ce fichier.

- `defaults`, puis une section par **équipe** (`teams.<nom exact>`) dont l'utilisateur est membre :
  - `projects` (« Projets de votre équipe » à l'accueil, seulement ceux auxquels il a accès) — cumulés ;
  - `updates: auto | managed` — `managed` l'emporte (mises à jour verrouillées) ;
  - `preferences` (`language`, `theme`, `projectHome`, `fieldVisibility`) : **valeurs par défaut**, jamais imposées à qui a fait son propre choix ; la première équipe du fichier qui définit une clé l'emporte (`fieldVisibility` : type d'objet par type d'objet).
- Relue à la connexion, au démarrage et toutes les 30 minutes (`app:refresh-team-config`) ; gardée en cache (`userData/forge-config.json`) pour le hors-ligne ; une clé invalide est ignorée et signalée dans le panneau Compte.
- Une politique de la configuration machine (§6) l'emporte toujours sur la configuration d'équipe.

## 8. Accès révoqué ou insuffisant (GH45)

Les deux transports (IPC Electron, bridge web) ne gardent que le message d'une erreur : la nature de l'erreur voyage dans le message sous le marqueur `⟦forge-access {"status":401|403,"host":…}⟧ `, que le renderer retire avant affichage (`renderer/api.ts`).

- **401** (jeton révoqué ou expiré) — y compris un **compte désactivé**, qui ne produit pas de 401 côté git (HTTP 200 + page HTML) : pour un hôte `forgejo`, un échec git inexpliqué déclenche une sonde `GET /api/v1/user` (401, ou 403 « prohibited » → révoqué). L'hôte est marqué « accès révoqué » jusqu'à une reconnexion réussie ; l'auto-pull s'arrête sans appel réseau ni erreur répétée. **Bannière unique** par hôte, « Se reconnecter » pré-rempli (desktop) ; les modifications locales ne sont jamais touchées.
- **403 en écriture** (lecteur, branche protégée — Forgejo répond HTTP 200 puis « pre-receive hook declined ») : « Vous n'avez pas le droit de publier sur <repo> ». Le commit local est conservé.
- Diagnostic à l'ouverture d'un projet (GH45 S4) : lecture seule signalée par un bandeau non bloquant (SPEC-PROJECT-MANAGEMENT §9.3).

## 9. Hors scope actuel

- Device Flow pour GitLab.com (potentiellement supporté par cette plateforme, non implémenté)
- Connexion SSO (OIDC/PKCE) du desktop sur une forge : #51 (P2 de GH45). Le web se connecte par OIDC (GH44).
- Rafraîchissement de token (les tokens OAuth Device Flow d'une GitHub OAuth App classique n'expirent pas par défaut)
- Migration automatique d'un compte PAT existant vers OAuth
