# GH51 — Scénarios de test

Design : `specs/GH51-design.md`. Critères : `specs/GH51.md` (AC1 à AC12).
Les tests de flux utilisent `startFakeForge` et un faux navigateur (le `openExternal` injecté lit l'URL d'autorisation,
puis appelle `redirect_uri` avec le `state` reçu et un code). Le faux serveur vérifie le PKCE (S256 du `code_verifier`
contre le `code_challenge` reçu). Il prouve la logique du client, pas le comportement réel de Forgejo (voir la
vérification préalable, design §9).

## 1. Scénarios nominaux (golden path)

| # | Scénario | Attendu | AC |
|---|---|---|---|
| N1 | `ssoLogin` sur un serveur `defaultServer` avec `forgeSsoClientId` | l'URL ouverte contient `response_type=code`, `client_id`, `redirect_uri=http://127.0.0.1:<port>/callback`, `state`, `code_challenge` (43 à 128 car.), `code_challenge_method=S256` ; pas de `scope` | AC2 |
| N2 | retour avec `state` et `code` corrects | échange envoyé avec `code_verifier`, `client_id`, `redirect_uri`, `grant_type=authorization_code`, sans `client_secret` ; compte enregistré (`auth.json`, clés `<hôte>` et `<hôte>:<login>`) | AC5 |
| N3 | identité vérifiée | `GET /api/v1/user` avec le nouveau jeton ; compte `forgejo` avec `login`, `name`, `email` | AC5 |
| N4 | après connexion | le serveur loopback est fermé ; le port ne répond plus | AC7 (fermeture) |
| N5 | `auth.json` après connexion | aucun jeton, aucun refresh token, aucun `expiresAt` | AC10 |
| N6 | `logout` d'un compte SSO | jeton d'accès, entrée `#sso` et refresh token effacés du magasin ; `auth.json` sans trace | AC10 |

## 2. Retours anormaux

| # | Scénario | Attendu | AC |
|---|---|---|---|
| A1 | `state` différent | `SsoLoginError('state')`, aucune requête vers `/login/oauth/access_token`, aucun compte | AC3 |
| A2 | `state` absent | idem A1 | AC3 |
| A3 | `error=access_denied` | `SsoLoginError('denied')`, aucun compte, aucun jeton | AC4 |
| A4 | retour sans `code` (et `state` correct) | `SsoLoginError('no-code')`, aucun compte | AC4 |
| A5 | échange refusé (400, `invalid_grant`) | `SsoLoginError('exchange')`, aucun compte | AC6 |
| A6 | échange sans `code_verifier` (ou verifier faux) | refusé par le faux serveur (PKCE) ; rien n'est enregistré | AC6 |
| A7 | `/identity` en 401 après l'échange | `SsoLoginError('identity')`, rien n'est enregistré | AC5 |
| A8 | retour sur un autre chemin que `/callback` | 404, la connexion continue d'attendre | C10 |
| A9 | second retour valide après le premier | ignoré ; un seul échange | C10 |
| A10 | aucun retour pendant 5 min | `SsoLoginError('timeout')`, serveur fermé | AC7 |
| A11 | `ssoCancel` pendant l'attente | `SsoLoginError('cancelled')`, serveur fermé, aucun compte | AC7 |
| A12 | deuxième `ssoLogin` pendant un premier | le premier se termine en `cancelled`, le second suit son cours | C7 |
| A13 | liaison du serveur loopback en échec (`createServer` injecté qui échoue) | `SsoLoginError('bind')` immédiat, sans attente | AC8 (écart E1) |
| A14 | serveur sans client public configuré (`forgeSsoClientId` absent) | `SsoLoginError('not-configured')`, aucune ouverture du navigateur | AC1 |
| A15 | serveur différent de `defaultServer` | `SsoLoginError('not-configured')` | C9 |
| A16 | serveur qui n'est pas Forgejo (GitHub, générique) | `SsoLoginError('not-a-forge')` | AC1 |

## 3. Renouvellement (AC9, D5)

| # | Scénario | Attendu |
|---|---|---|
| R1 | jeton à 61 s ou moins de l'expiration, refresh token présent | renouvellement avant de rendre le jeton ; nouveau jeton et nouvelle `expiresAt` enregistrés |
| R2 | deux appels concurrents à `tokenFor` | un seul `grant_type=refresh_token` envoyé |
| R3 | renouvellement sans nouveau refresh token | l'ancien refresh token est conservé |
| R4 | renouvellement refusé (400 / 401) | entrée `#sso` effacée, `isAccessRevoked(hôte)` vrai, jeton périmé rendu |
| R5 | renouvellement en erreur 500 ou réseau | jeton courant rendu, `#sso` conservé |
| R6 | jeton expiré, pas de refresh token (D5) | jeton rendu tel quel ; l'appel API reçoit 401 et affiche la bannière de reconnexion |
| R7 | 401 sur un appel API, refresh token présent | renouvellement forcé, **une** relance avec le nouveau jeton, réussie |
| R8 | 401 après la relance | bannière de reconnexion, pas de deuxième relance |
| R9 | connexion par PAT après une connexion SSO | entrée `#sso` supprimée |

## 4. Sécurité et journaux (AC11)

| # | Scénario | Attendu |
|---|---|---|
| S1 | toute erreur de la chaîne (A1 à A16, R4, R5) | le message ne contient ni `code`, ni `state`, ni `verifier`, ni jeton |
| S2 | journaux pendant un flux complet | aucune occurrence du code, du verifier, du state ou du jeton (spy sur `console` et sur le logger) |
| S3 | serveur loopback | écoute uniquement sur `127.0.0.1` (adresse de l'écoute vérifiée) |

## 5. Autres couches

| # | Couche | Scénario | Fichier |
|---|---|---|---|
| F1 | `forgeRequest` | option `form` : `Content-Type: application/x-www-form-urlencoded`, corps encodé, proxy appliqué | `forge-http.test.ts` (existant, cas ajouté) |
| F2 | `machine-config` | `forgeSsoClientId` valide, vide, non chaîne (ignoré et signalé) | `machine-config.test.ts` |
| F3 | canaux IPC | `auth:sso-login` et `auth:sso-cancel` listés comme desktop-only, absents du serveur web | `channel-policy.test.ts` (existant) |
| F4 | `ForgeService.guard` | relance sur 401 (R7, R8) | `forge.service.test.ts` (cas ajouté) |
| F5 | script admin | `oauth-app create --public` : `confidential_client: false`, sortie sans secret ; sans l'option, inchangé | `deploy/tests/` (sur le modèle de `admin-users.test.sh`) |
| F6 | renderer | bouton visible seulement si C9 est satisfait ; « Annuler » appelle `ssoCancel` ; `cancelled` n'affiche rien | vérification manuelle (pas de test renderer unitaire pour cette page) |

## 6. Fichiers de test

- `apps/desktop/src/main/services/forge/forgejo-sso.gh51.test.ts` : PKCE, URL d'autorisation, échange, renouvellement (N1, N2, R1 à R5, A5, A6).
- `apps/desktop/src/main/services/forge/loopback-callback.gh51.test.ts` : retour, chemin, second retour, délai, annulation, liaison (A3, A4, A8, A9, A10, A11, A13, S3).
- `apps/desktop/src/main/services/auth-sso.gh51.test.ts` : flux complet avec `startFakeForge` (N1 à N6, A1, A2, A7, A12, A14 à A16, R2 à R4, R6 à R9, S1, S2).
- Cas ajoutés aux fichiers existants : F1, F2, F3, F4, F5.

## 7. Critères de sortie

- Niveau 1 à chaque sprint : `pnpm typecheck`, `pnpm lint`, `npx vitest run <fichiers touchés>`.
- Niveau 2 en fin de S2 : `pnpm test` complet ; specs e2e voisines du login (`e2e-web` ou `test:e2e:desktop` ciblé) si elles existent.
- Niveau 3 : au merge du lot (hors de ce ticket).
- Vérification préalable (design §9) : à faire avec la forge de test ; non bloquante pour les sprints, bloquante pour le merge.
