# GH45 — Sprint 2 : support des forges Forgejo/Gitea dans Polenta (P0)

Périmètre : `specs/GH45-design.md` §3 (révisé §12). Branche `GH45` rebasée sur `GH44` @ f5325d6.
Forges réelles de test : `acme` (Forgejo 15.0.9) et `gitea-test` (Gitea 28.1.0) sur
`vps-f515f9c6` (kit du sprint 1).

## Fichiers

Créés :

| Fichier | Rôle |
|---|---|
| `packages/types/src/forge.ts` | Types partagés (`ForgeKind`, `ForgeAccount`, `MachineConfig`, `ForgeDetection`, `PasswordLoginResult`) et marqueur d'erreur d'accès `⟦forge-access …⟧` (encodage/décodage) |
| `main/services/forge/remote-guard.ts` | Garde d'URL anti-SSRF (extrait de `git-http.ts`), commun à git et à l'API |
| `main/services/forge/forge-http.ts` | Client HTTP des forges : garde, proxy, délais, redirections GET suivies (sans jeton vers un autre hôte), erreurs sans en-têtes ni corps de requête |
| `main/services/forge/forge-provider.ts` | Interface `ForgeProvider` (identité ; P1 au sprint 4) |
| `main/services/forge/github.provider.ts` | Identité et Device Flow GitHub ; seul endroit où `github.com` est logique |
| `main/services/forge/forgejo.provider.ts` | Détection Forgejo/Gitea, identité, création de jeton (classification des refus), sonde d'accès, URL de changement de mot de passe |
| `main/services/forge/forge-access.ts` | `ForgeAccessError`, statut HTTP d'une erreur git/API, push refusé, réponse non-git |
| `main/services/machine-config.ts` | Lecture et validation de `config.json` (jamais d'exception) |
| `renderer/lib/forgeAccessNotices.ts`, `renderer/components/layout/ForgeAccessBanner.tsx` | Bannière unique « accès révoqué » par serveur |
| `renderer/hooks/useCurrentAccount.ts` | Compte courant (desktop : `auth:current-account` ; web : session) |
| `apps/desktop/scripts/forge-smoke.ts` | Test d'intégration contre une vraie forge (22 scénarios) |
| Tests : `machine-config.test.ts`, `auth.service.test.ts`, `forge/forgejo.provider.test.ts`, `forge/forge-access.test.ts`, `forge/fake-forge.test-util.ts` | 49 tests unitaires (faux serveur rejouant les réponses mesurées) |

Modifiés : `auth.service.ts` (réécrit), `sync.service.ts`, `workspace-tree.service.ts`,
`app-settings.service.ts`, `git-http.ts`, `container.ts`, `host/{host-context,electron-host}.ts`,
`ipc/{index,channels,desktop-only.handlers}.ts`, `mcp-server/container.ts`,
`web-server/{config,web-host,user-pool,app,channel-policy}.ts` (+ 2 fixtures de tests),
`packages/api-client/src/{ipc-client,types}.ts`, `packages/types/src/{index,app}.ts`,
`renderer/{api.ts,routes/login.tsx,routes/index.tsx,routes/account.tsx}`,
`renderer/components/{AccountMenu,sidebar/AccountPanel,layout/AppLayout}.tsx`,
`renderer/hooks/useAutoPull.ts`, `renderer/i18n/locales/{fr,en}.json`, `vitest.config.ts`,
`apps/desktop/package.json` (script `test` : tous les tests).

## Comportement implémenté

- **Comptes typés** : `provider` (`github` | `forgejo` | `generic`) et `baseUrl` dans `auth.json`,
  déduits à la lecture pour un compte antérieur (aucune migration écrite).
- **Identité réelle** : un compte `forgejo` résout son identité par `/api/v1/user` ; si elle est
  introuvable, la connexion **échoue** (plus de compte « Git User »). `generic` garde le
  comportement d'avant.
- **Auteur des commits** : le compte de l'hôte d'`origin` d'abord, puis le compte par défaut —
  avec un compte GitHub par défaut et un compte Forgejo, un commit poussé sur la forge porte
  l'identité Forgejo (critère 1).
- **Connexion identifiant + mot de passe** : détection du type de forge à la saisie, création d'un
  jeton `polenta-<poste>-<AAAAMMJJ-HHmm>-<aléa>` (scopes `write:repository`, `read:user`,
  `write:organization`), 2FA (`X-Gitea-OTP`), refus distingués : identifiants, code 2FA requis /
  invalide, compte désactivé, **compte neuf dont le mot de passe temporaire doit être changé**
  (bouton qui ouvre la page de la forge), serveur qui n'est pas une forge, réseau. Le mot de passe
  n'est ni stocké, ni journalisé, ni présent dans une erreur. Formulaire « jeton » toujours
  disponible ; GitHub (Device Flow + jeton) inchangé.
- **Configuration machine** : `%ProgramData%\Polenta\config.json` (ou `POLENTA_CONFIG`) —
  `defaultServer`, `hideGithub`, `demoProjectUrl`, `autoUpdate: false` (case des mises à jour
  désactivée et verrouillée, aucune requête GitHub). Web : `POLENTA_WEB_DEFAULT_SERVER` /
  `POLENTA_WEB_DEMO_PROJECT_URL` (défaut : premier hôte git autorisé).
- **Accès révoqué** (jeton supprimé, compte désactivé) : `ForgeAccessError(401)` sur toute
  opération git HTTPS, bannière « Se reconnecter » unique par serveur (serveur pré-rempli),
  auto-pull suspendu sans appel réseau jusqu'à la reconnexion, working tree intact.
- **Droits insuffisants** : push refusé (lecteur, branche protégée) → « Vous n'avez pas le droit de
  publier sur … », commit local conservé.
- **Message GH30** : version Forgejo (« demandez à l'administrateur de vous ajouter à une équipe »),
  version GitHub inchangée.
- **Compte courant / déconnexion** : un seul hook remplace les 3 boucles `KNOWN_REMOTES` ; la
  déconnexion retire le compte et ses jetons (y compris un jeton hérité sans compte) et signale
  que le jeton reste révocable dans les paramètres de la forge.
- **Accueil** : bouton Démo selon la configuration machine ; champ « URL du repo » pré-rempli avec
  le serveur de l'entreprise.

## Divergences par rapport au design (révisions dans `GH45-design.md` §12)

1. **Détection** : une forge qui exige la connexion répond `403 {"message":"Only signed in user…"}`
   sur `/api/v1/version` — reconnue comme forge. Forgejo/Gitea distingués par
   `/api/forgejo/v1/version` (403 vs 404). Redirections suivies (base = origine finale).
2. **Compte neuf** (mot de passe temporaire) : 403 « You must change your password. Change it at:
   <url> » (Forgejo `/user/change_password`, Gitea `/user/settings/change_password`) — nouveau
   résultat `password-change-required`. Le desktop n'ouvre **que** l'URL annoncée par la forge à
   la dernière connexion (aucune URL fournie par le renderer).
3. **Push d'un lecteur** : pas de 403 — HTTP 200 puis « pre-receive hook declined ». Reconnu comme
   refus de droits.
4. **Nom du jeton** : suffixe aléatoire — deux connexions dans la même minute faisaient refuser le
   second jeton (nom déjà pris).
5. **Sonde d'API** limitée aux réponses non-git (page HTML d'un compte désactivé) et aux 403 : un
   rejet non fast-forward n'attend jamais un aller-retour réseau supplémentaire.
6. **Bannière** : l'issue porte `serverUrl` (scheme + port), pas seulement l'hôte.
7. **Erreurs dans un résultat** (`parse-error` à l'ouverture d'un workspace) : `renderer/api.ts`
   nettoie aussi le champ `error` des résultats, pas seulement les rejets.
8. **`migrateLegacyBareTokens` non implémentée** : la compatibilité des jetons « nus » hérités est
   assurée par `hasAnyAccount`/`projectUsername`/`logout` (liste `LEGACY_BARE_TOKEN_HOSTS`), sans
   écriture.
9. **Critère 9** : il ne reste aucune logique `host === 'github.com'` hors du provider. Restent en
   dur, assumés : URL des releases, démo publique, choix proposés à l'écran de connexion
   (`github.com`, `gitlab.com`), liste héritée, valeurs par défaut du mode dev web de GH44.
10. **Pas d'ESLint** dans le dépôt (aucune configuration, `turbo lint` n'exécute rien) : le
    typecheck sert de garde-fou.

## Revue de code

`/code-review` (medium) : 10 constats, tous traités.

| Constat | Traitement |
|---|---|
| Marqueur brut affiché quand l'erreur est dans un résultat `parse-error` | `renderer/api.ts` nettoie aussi les résultats et signale la bannière |
| Déconnexion impossible avec un jeton hérité sans compte | `logout` retire les jetons hérités |
| Redirections non suivies → forge prise pour `generic` | Suivi des redirections GET (garde réappliquée, jeton jamais transmis à un autre hôte) |
| Bannière : `https://<hôte>` perd schéma et port | `serverUrl` dans l'issue |
| Sonde d'API sur toute erreur git (latence) | Limitée aux réponses non-git et aux 403 |
| `currentAccount` / `hasAnyAccount` incohérents | Même critère (premier compte qui a un jeton, le compte par défaut d'abord) |
| `openPasswordChange` : URL choisie par le renderer | Plus d'argument : seule l'URL mémorisée lors du refus est ouverte |
| API GitHub bloquée par le garde web | URLs fixes de GitHub exemptées du garde (non fournies par l'utilisateur) |
| Liste des serveurs calculée deux fois | Fonction `serverOptions` |
| Code mort (types P1, `forgePaginate`) ; dossier de démo créé sans URL | Retirés (réintroduits au S4 avec leurs appelants) ; garde avant le choix du dossier |

## Tests

- **Typecheck** : zéro erreur.
- **Unitaires** (vitest, `pnpm --filter @polenta/desktop test`) : 88 tests, dont 49 nouveaux.
  Erreur non gérée `EPERM` intermittente dans `web-server/app.test.ts` : **antérieure** (reproduite
  sur GH44 sans GH45), issue #50.
- **Builds** : desktop (electron-vite), serveur MCP et serveur web (esbuild, couche forge sans
  `electron` ni `keytar`, critère 10).
- **Intégration contre les vraies forges** (`scripts/forge-smoke.ts`) — 22 scénarios, **tous OK sur
  Forgejo 15.0.9 et sur Gitea 28.1.0** :

| Scénario | Forgejo | Gitea |
|---|---|---|
| S2-8 détection | forgejo/forgejo | forgejo/gitea |
| S2-15 mauvais mot de passe / compte neuf / pas une forge | ✓ / ✓ (URL de la forge) / ✓ | ✓ / ✓ / ✓ |
| S2-5 2FA sans code / code faux / bon code | otp-required / invalid-otp / ok | invalid-credentials (générique) / invalid-credentials / ok |
| S2-3 connexion, S2-16 mot de passe absent du stockage | ✓ | ✓ |
| S2-4 clone, commit **à l'identité de la forge**, push effectif | ✓ | ✓ |
| S2-12 push lecteur → « pas le droit de publier », commit local conservé | ✓ | ✓ |
| S2-9 compte désactivé (`polenta-admin user disable`) → accès révoqué ; auto-pull `accessRevoked` ; tick suivant sans réseau (6 ms) ; working tree intact | ✓ | ✓ |
| S2-11 réactivation + reconnexion dans la même minute → auto-pull repris | ✓ | ✓ |
| S2-6 déconnexion | ✓ | ✓ |

## Reste à valider manuellement (UI) — `specs/GH45-tests.md`

- **S2-1** non-régression GitHub sans `config.json` (compte, Device Flow, projets).
- **S2-2 / S2-19 / S2-20** avec un `config.json` (variable `POLENTA_CONFIG` pour tester sans droits
  admin) : écran de connexion limité au serveur de l'entreprise, bouton Démo selon la config,
  comptes GitHub existants toujours utilisables.
- **S2-3 / S2-5** dans l'UI : formulaire identifiant + mot de passe, apparition du champ 2FA.
- **S2-6** ligne d'aide à la déconnexion ; **S2-7** case des mises à jour verrouillée.
- **S2-10 / S2-11** bannière « accès révoqué » et « Se reconnecter » (serveur pré-rempli).
- **S2-13 / S2-14** messages d'accès à un composant (Forgejo / GitHub).
- **S2-26** web en mode dev : `auth:login-password` non exposé.

Exemple de `config.json` pour la forge de test :

```json
{ "defaultServer": "https://acme.forge.esquaresoft.fr", "hideGithub": true,
  "demoProjectUrl": "https://acme.forge.esquaresoft.fr/acme/demo-ll800-produit.git", "autoUpdate": false }
```

Lancement : `set POLENTA_CONFIG=C:\chemin\config.json` puis `pnpm --filter @polenta/desktop dev`.
Comptes de test sur `acme` : `alice` (admin client), `bob`, `charlie` (lecteur), `itest-*` —
mots de passe transmis à part.

## Mises à jour SPEC

Aucune à ce sprint (prévues au dernier sprint, design §10).
