# GH44 — Sprint 3 : connexion par la forge (OIDC), sessions, révocation, multi-utilisateurs

Périmètre : `specs/GH44-design.md` §5, révisé §10.2 après la livraison de #45 ; révisions issues de
l'implémentation : §10.2 « Révisions issues de l'implémentation du sprint 3 ».

## Fichiers modifiés

**Serveur web** (`apps/desktop/src/web-server/`) :
- `auth/oidc.ts` (nouveau) : client OAuth2/OIDC minimal (découverte, PKCE S256, échange, rafraîchissement).
- `config.ts` : modes `oidc` | `dev`, contrôles (secret de session, URL publique, forge), `maxActiveUsers`.
- `app.ts` : `/auth/login` → forge, `/auth/callback`, `POST /auth/logout`, `/auth/logged-out`,
  `/auth/revoked`, révocation (marqueur, marque du conteneur, vérification périodique), époque des
  jetons, sessions révoquées, WebSocket revérifiée, pages d'erreur, 503 « plafond ».
- `session.ts` : sessions révoquées mémorisées, `destroyLogin`, `activeLogins`,
  `PendingAuthorizations` (état OIDC, plafonné).
- `web-host.ts` : `SessionTokenStore` (jetons OAuth, rafraîchissement, époque, révocation).
- `user-pool.ts` : magasin de jetons par utilisateur, plafond d'utilisateurs chargés (éviction
  prudente, `PoolFullError`), appels en cours, `revoke()`.
- `index.ts` : avertissement de jeton vide limité au mode dev.
- Tests : `oidc.test.ts` (nouveau, fausse forge OIDC), `user-pool.test.ts` (nouveau), `app.test.ts`.

**Noyau** : `main/services/auth.service.ts` — `connectWithToken(url, jeton, type, identité?)`.

**Renderer** : `web/bridge.ts` (401 `revoked` → `/auth/revoked`, événement `auth:session-revoked`,
fermeture 4402, une seule redirection), `lib/webSession.ts` (déconnexion `POST` + CSRF mutualisé).

**Tests e2e** (`apps/desktop/e2e-web/`) : `s3-oidc.spec.ts` (nouveau, forge réelle),
`support/oidc-env.ts` (serveur oidc, application OAuth2), `support/ui.ts` (`publish`, `LABELS`),
`playwright.config.ts` (second serveur), `parity.spec.ts` et `s2-core.spec.ts` (`publish` partagé),
`README.md`. Outillage #45 étendu : `e2e-desktop/support/forge-setup.py` (`oauth-app`),
`forge.ts` (`oauthApp`, `unbanSelf`).

## Comportement implémenté

En production (`POLENTA_WEB_AUTH=oidc`), l'utilisateur se connecte **par la forge de l'instance**.
Polenta Web redirige vers Forgejo (connexion, 2FA et consentement gérés par la forge), récupère un
jeton OAuth2 qu'il garde en mémoire côté serveur, vérifie l'identité par l'API de la forge et ouvre
une session (cookie signé `HttpOnly`). Le jeton sert directement à git et à l'API ; il est
rafraîchi avant son expiration. Les commits sont à l'identité Forgejo de l'utilisateur.

Un accès révoqué (compte désactivé, jeton retiré, rafraîchissement refusé), détecté par une
opération git, par l'API, par la synchronisation automatique ou par la vérification toutes les
5 minutes, détruit toutes les sessions de l'utilisateur. Le navigateur affiche « Votre accès a été
révoqué ou a expiré, reconnectez-vous. Vos modifications non publiées sont conservées. »
Configuration d'équipe, projets d'équipe, vue d'ouverture, création sur le serveur et refus
d'écriture (#45) fonctionnent dans le navigateur.

## Divergences par rapport au design

Détail dans `GH44-design.md` §10.2 (révisions d'implémentation) :
- pas de bibliothèque `openid-client` ni de validation de l'`id_token` ;
- état OIDC lié au navigateur par un cookie signé ;
- **époque des jetons**, qui protège une reconnexion contre les échecs de la génération
  précédente ;
- **sessions révoquées mémorisées** et code de fermeture 4402 ;
- révocation aussi sur la marque `isAccessRevoked` posée sans erreur par la synchronisation
  automatique de #45, cause d'une instabilité de S3-6 identifiée par les tests réels ;
- pages d'erreur explicites à la place du JSON brut ;
- éviction du pool limitée aux utilisateurs inactifs depuis au moins 1 minute et sans appel en
  cours.

## Mises à jour SPEC

Aucune (sprint non final ; SPEC-WEB au sprint 4).

## Vérifications

- `pnpm typecheck` (monorepo) : 0 erreur. `pnpm test` : desktop 158 (dont **62 tests serveur web**,
  23 nouveaux : OIDC, pool, magasin de jetons), merge-core 34/34.
- **E2E** (Chromium, serveur buildé) : sans SSH 14/14 (+ 7 ignorés) ; avec la forge réelle `acme`
  (`POLENTA_E2E_SSH`) **21/21**, sur 3 exécutions complètes consécutives avant les correctifs de revue, puis 2 après.
- `/code-review` : 10 constats (courses de révocation et de rafraîchissement après reconnexion,
  WebSocket revérifiée, table d'état non bornée, éviction d'un utilisateur actif, erreurs du callback,
  code de fermeture, double lecture d'identité, vérification séquentielle, CSRF dupliqué) — tous
  corrigés, les courses couvertes par des tests.

## Comment tester manuellement

```bash
# Sur l'hôte du kit : application OAuth2 de l'instance
sudo polenta-admin --instance acme oauth-app create polenta-web http://127.0.0.1:8787/auth/callback
# Poste de dev
cd apps/desktop && pnpm build:web
POLENTA_WEB_AUTH=oidc POLENTA_WEB_DEFAULT_SERVER=https://acme.forge.esquaresoft.fr \
POLENTA_WEB_OIDC_CLIENT_ID=<id> POLENTA_WEB_OIDC_CLIENT_SECRET=<secret> \
POLENTA_WEB_PUBLIC_URL=http://127.0.0.1:8787 POLENTA_WEB_SESSION_SECRET=$(openssl rand -hex 32) \
pnpm start:web
```

Puis : connexion, clone de `acme/itest`, publication (auteur = identité Forgejo), lecteur
(publication refusée, bannière), `polenta-admin user disable <login>` (page « accès révoqué »),
déconnexion. Scénarios encore manuels : S3-5, S3-8, S3-9, S3-10, S3-11 (`GH44-tests.md`).
