# GH51 — Design : connexion SSO du desktop sur une forge (OAuth2 PKCE)

Spec : `specs/GH51.md` (D1 à D7 validées le 2026-11-27, recommandations retenues).
Tests : `specs/GH51-tests.md`. Base : branche `milestone-A`.

## 1. Existant réutilisé

| Brique | Où | Usage |
|---|---|---|
| Connexion forge (PAT, mot de passe) | `auth.service.ts` `setup`, `loginWithPassword`, `persistToken` | même enregistrement de compte pour le SSO (identité, jetons, `auth.json`, levée de révocation) |
| Appels HTTP forge (proxy d'entreprise, délais, garde d'URL) | `forge/forge-http.ts` `forgeRequest` | échange de code et renouvellement |
| Ouverture du navigateur | `host.openExternal` (`HostContext`) | page d'autorisation |
| Jetons par compte, lecture à chaque appel | `tokenFor` (`auth.service.ts`) | point d'entrée du renouvellement |
| Bannière « à reconnecter » | `markAccessRevoked` + `guard` (`forge.service.ts`) + `revokedError` | refus de renouvellement, jeton expiré sans renouvellement |
| Faux serveur de forge | `forge/fake-forge.test-util.ts` `startFakeForge` | tests de bout en bout du flux (corps de requête enregistré) |
| Config machine | `services/machine-config.ts` | clé `forgeSsoClientId` |

**Non réutilisé** : `web-server/auth/oidc.ts`. Il fait la même chose côté serveur web, mais il appelle `fetch` (pas le proxy
d'entreprise du poste) et exige un secret client. Le poste ne doit pas dépendre de la couche `web-server`. Le PKCE (une
ligne de `createHash` + `randomBytes`) est réécrit dans le module desktop.

## 2. Choix de conception

| # | Choix | Justification |
|---|---|---|
| C1 | Port : `listen(0)` sur `127.0.0.1`, port attribué par le système (D1). | Un port libre est toujours attribué : voir l'écart E1 sur AC8. |
| C2 | Chemins fixes `/login/oauth/authorize` et `/login/oauth/access_token` (pas de découverte OIDC). Identité lue par `GET /api/v1/user` via `persistToken`. | Chemins donnés par la spec ; pas d'`id_token` à valider. |
| C3 | L'échange et le renouvellement passent par `forgeRequest` avec une nouvelle option `form` (corps `application/x-www-form-urlencoded`). | Le poste passe par le proxy d'entreprise ; `fetch` ne le fait pas. |
| C4 | Access token dans le magasin existant (clés `<hôte>` et `<hôte>:<login>`, comme `persistToken`). Refresh token et `expiresAt` dans une troisième entrée du même magasin, `<hôte>:<login>#sso`, au format JSON `{ refreshToken?, expiresAt? }`. Rien dans `auth.json`. | D7 : magasin de jetons du poste. Un enregistrement par PAT, mot de passe ou Device Flow supprime l'entrée `#sso` du compte : pas de refresh token orphelin. |
| C5 | Renouvellement dans `tokenFor` : si `expiresAt − 60 s ≤ maintenant` et qu'il existe un refresh token, renouvellement avant de rendre le jeton ; une seule requête en vol par compte. Refus 4xx du renouvellement : entrée `#sso` effacée, hôte marqué révoqué, jeton périmé rendu (le 401 suivant affiche la bannière existante). Erreur réseau ou 5xx : jeton courant conservé (comportement de `SessionTokenStore`). Sans refresh token (D5) : jeton rendu tel quel, la forge répond 401. | D5 : les deux cas sont couverts par le code, en attente du résultat de la vérification préalable. |
| C6 | `ForgeService.guard` reçoit le jeton en paramètre (`op: (token) => …`). Sur 401, si le compte a un refresh token, renouvellement forcé puis **une** relance de l'opération avec le nouveau jeton ; sinon révocation comme aujourd'hui. | AC9 : « la requête est rejouée ». Les 12 appels de `guard` changent de signature, sans changement de logique. |
| C7 | `auth.ssoLogin(remote)` est un appel IPC long : sa promesse se résout au retour de la forge, ou se rejette (code d'erreur). `auth.ssoCancel()` l'interrompt. Pas de polling, contrairement au Device Flow. Un nouvel appel annule le précédent. | Pas d'état à synchroniser avec le renderer ; `Annuler` n'est qu'un appel. |
| C8 | Erreurs : classe `SsoLoginError` avec un `code` (`not-configured`, `not-a-forge`, `cancelled`, `timeout`, `denied`, `state`, `no-code`, `exchange`, `identity`, `bind`, `network`). Messages fixes en français, sans jeton, `code` ni `code_verifier`. Le renderer n'affiche que le message ; `cancelled` ne s'affiche pas. | AC4, AC11. |
| C9 | `forgeSsoClientId` est rattaché à `defaultServer` (même origine). Le bouton n'apparaît que si le serveur saisi a la même origine que `defaultServer` ; `ssoLogin` refuse sinon (`not-configured`). Clé sans `defaultServer` : ignorée et signalée. | Un client OAuth n'existe que sur la forge qui l'a créé. Une seule clé par poste, comme `defaultServer`. Voir E2. |
| C10 | Serveur loopback : écoute `127.0.0.1` seulement ; seul `GET /callback` est traité (autre chemin : 404) ; le premier retour valide est retenu, les suivants sont ignorés ; réponse HTML qui ne contient aucune donnée ; serveur fermé dans tous les cas (retour, erreur, annulation, délai de 5 min). | Surface d'attaque minimale ; AC7. |
| C11 | Admin : `polenta-admin oauth-app create --public <nom> <redirect>` crée `confidential_client: false` et n'affiche que `client_id`. Sans l'option, le script est inchangé. | D2, AC12. |
| C12 | Renderer : bouton « Se connecter avec le navigateur » au-dessus de la connexion par identifiant (forge Forgejo, si C9 est satisfait). Pendant l'attente : « Terminez la connexion dans votre navigateur » et « Annuler ». Le PAT reste le repli (D4). Textes en `fr.json` et `en.json`. | D4, AC1. |

## 3. Fichiers

| Fichier | Changement | Sprint |
|---|---|---|
| `packages/types/src/forge.ts` | `MachineConfig.forgeSsoClientId?: string` | S1 |
| `apps/desktop/src/main/services/machine-config.ts` | lecture de `forgeSsoClientId` (chaîne non vide, 200 car. max) | S1 |
| `apps/desktop/src/main/services/forge/forge-http.ts` | option `form` | S1 |
| `apps/desktop/src/main/services/forge/forgejo-sso.ts` (nouveau) | PKCE, URL d'autorisation, échange et renouvellement, `OAuthTokenError` | S1 |
| `apps/desktop/src/main/services/forge/loopback-callback.ts` (nouveau) | serveur de retour : `startLoopbackCallback({ timeoutMs, signal, createServer? })` → `{ redirectUri, result }` | S1 |
| `apps/desktop/src/main/services/auth.service.ts` | `ssoLogin`, `ssoCancel`, `persistToken(…, sso?)`, `tokenFor` avec renouvellement, `refreshAfterUnauthorized`, `logout` et `getToken` | S1 |
| `apps/desktop/src/main/services/forge/forge.service.ts` | `guard(account, (token) => …)` avec relance sur 401 (12 appels) | S2 |
| `apps/desktop/src/main/ipc/index.ts`, `main/ipc/channels.ts` | `auth:sso-login`, `auth:sso-cancel` (liste des canaux desktop) | S2 |
| `apps/desktop/src/web-server/channel-policy.ts` | aucune ligne si les canaux sont desktop-only (vérifié par `channel-policy.test.ts`) | S2 |
| `packages/api-client/src/types.ts`, `ipc-client.ts` | `ssoLogin`, `ssoCancel` | S2 |
| `apps/desktop/src/renderer/routes/login.tsx`, `i18n/locales/{fr,en}.json` | bouton, attente, annulation | S2 |
| `deploy/polenta-admin.sh` | option `--public` | S2 |

## 4. Flux détaillé

1. Renderer : clic sur le bouton → `api.auth.ssoLogin(serveur)`.
2. `ssoLogin` : vérifie C9 ; `detectForge` doit renvoyer `forgejo` ; annule un flux en cours ; démarre le serveur loopback (C10) ; `redirectUri = http://127.0.0.1:<port>/callback`.
3. Génère `verifier` (43 car., base64url de 32 octets), `challenge` (S256) et `state` (16 octets, base64url).
4. `openExternal(<baseUrl>/login/oauth/authorize?response_type=code&client_id=…&redirect_uri=…&state=…&code_challenge=…&code_challenge_method=S256)`.
5. Retour sur `/callback` : `error` → `denied` ; `state` absent ou différent → `state` (aucune requête de jeton) ; `code` absent → `no-code` ; sinon le code est retenu.
6. `POST /login/oauth/access_token` (`grant_type=authorization_code`, `code`, `client_id`, `redirect_uri`, `code_verifier`, sans secret). Refus 4xx → `exchange`.
7. `persistToken(baseUrl, accessToken, 'forgejo', undefined, { refreshToken, expiresAt })` : identité vérifiée ; échec → `identity`. Retour : `ForgeAccount`.
8. Délai : 5 minutes après l'ouverture du navigateur → `timeout`, serveur fermé. `ssoCancel` → `cancelled`.

## 5. Stockage (C4)

| Clé du magasin | Contenu | Écrit par |
|---|---|---|
| `<hôte>` | access token (si le compte est SSO, à jour) | `persistToken`, renouvellement |
| `<hôte>:<login>` | access token | `persistToken`, renouvellement |
| `<hôte>:<login>#sso` | JSON `{ refreshToken?, expiresAt? }` | `persistToken` (SSO), renouvellement, `logout`, `persistToken` sans SSO (suppression) |

`auth.json` n'est pas modifié par le SSO (AC10) : le compte porte les mêmes champs que pour un PAT.

## 6. Points d'attention

- **Concurrence** : un seul renouvellement en vol par compte (promesse partagée). Un renouvellement terminé après une reconnexion n'écrase pas les nouveaux jetons (même garde que `SessionTokenStore`).
- **Coût** : `tokenFor` lit une entrée de plus (`#sso`) à chaque appel. Acceptable (lecture trousseau locale).
- **Journaux** : aucun appel de journal ne reçoit le code, le verifier, le state, ni un jeton. Les erreurs de `forgeRequest` ne contiennent ni en-tête ni corps de requête (forge-http.ts).
- **Git** : un 401 pendant une opération git n'est pas rejoué (E3).

## 7. Écarts avec la spec (à confirmer à la revue)

- **E1 — AC8 (port occupé)** : avec `listen(0)`, le système ne rend jamais un port occupé ; « essai du port suivant » n'a donc pas d'objet. Le code couvre l'échec de liaison : message `bind`, sans blocage. AC8 est couvert par ce test, pas par un essai de ports successifs.
- **E2 — AC1 (bouton)** : le bouton dépend de `forgeSsoClientId` et de `defaultServer` (C9). Sans la clé, il n'apparaît pas.
- **E3 — AC9 (requête rejouée)** : rejeu sur 401 pour les appels API (`guard`). Pour git, le renouvellement se fait avant chaque demande d'identifiants (marge de 60 s) ; un 401 en pleine opération git n'est pas rejoué, il remonte comme aujourd'hui.

## 8. Découpage en sprints

- **S1 — cœur main** : types et config (`forgeSsoClientId`), option `form`, `forgejo-sso.ts`, `loopback-callback.ts`, `auth.service.ts` (`ssoLogin`, `ssoCancel`, renouvellement, `logout`). Tests unitaires et intégration avec `startFakeForge` (voir `GH51-tests.md`). Vérification niveau 1.
- **S2 — intégration** : `guard` (C6), canaux IPC et api-client (C7), renderer et i18n (C12), script d'admin (C11). Tests : canaux (`channel-policy.test.ts`), `guard` (relance sur 401), script (`deploy/tests`). Vérification niveau 2 (`pnpm test` complet, puis specs e2e voisines du login). Mise à jour de `specs/ANALYSE-SERVEUR-AUTOHEBERGE.md` §4.3-10 et §4.5 si le code diverge du texte ; chaque mise à jour est notée dans `GH51-sprint2.md`.

## 9. Vérification préalable (bloquante avant merge)

Non faite. Elle nécessite la forge de test (kit, `polenta-admin oauth-app create --public`). Le résultat décide de C5 (renouvellement ou nouvelle connexion) et sera consigné ici :

| # | Point | Résultat |
|---|---|---|
| 1 | client public, pas de `client_secret` | à faire |
| 2 | PKCE S256, redirection `http://127.0.0.1:<port>/callback` à un port non enregistré | à faire |
| 3 | échange avec `code_verifier` ; sans verifier refusé | à faire |
| 4 | `expires_in` mesuré | à faire |
| 5 | présence du `refresh_token` ; échange `grant_type=refresh_token` | à faire |

Les tests du fake forge prouvent la logique du client, pas le comportement réel de Forgejo.
