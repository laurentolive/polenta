# GH44 — Sprint 4 : impression côté serveur, image Docker, déploiement, SPEC (sprint final)

Périmètre : `specs/GH44-design.md` §6, révisé §10.3 ; révisions issues de l'implémentation et de la
revue : §10.3 « Révisions issues de l'implémentation du sprint 4 ».

## Fichiers modifiés

**Serveur web** (`apps/desktop/src/web-server/`) :
- `print/headless-print.ts` (nouveau) : `HeadlessPrinter`, impression des routes `/print/*` par
  Chromium headless (playwright-core) — PDF, instantanés draw.io par lots de 20, 2 rendus
  simultanés, navigateur partagé fermé après 10 min.
- `app.ts` : imprimante branchée sur le pool, session d'impression par rendu (durée du rendu),
  `printHost` (adresse interne = adresse d'écoute), 404 pour un fichier statique absent (plus de
  `web.html` servi à la place d'un script ou d'une image).
- `session.ts` : `createPrint` — sessions d'impression exclues de `hasLogin` / `activeLogins`.
- `user-pool.ts` : `createPrintRenderer` (remplace l'imprimante « non disponible » des sprints 2-3).
- `config.ts` : `POLENTA_WEB_PRINT` ; `index.ts` : `POLENTA_WEB_APP_ROOT`.
- Tests : `print.test.ts` (nouveau), `app.test.ts` et `oidc.test.ts` (`print: false`).

**Renderer** : `routes/dashboard.tsx` — la sélection automatique du premier tableau de bord ne
s'applique plus si l'utilisateur a déjà quitté la vue (défaut trouvé sur l'instance déployée).

**Build et image** : `Dockerfile.web`, `/.dockerignore` (nouveaux), `scripts/web-runtime-package.mjs`
(nouveau), `scripts/build-web-server.ts` (playwright-core externe), `package.json` (Fastify et
playwright-core en `devDependencies` : hors de l'installeur desktop), `pnpm-lock.yaml`.

**Kit `deploy/`** (#45) : `polenta-host.sh` (`instance web enable|disable`, `web.env`, application
OAuth2, profil `web`, restauration et export, aide), `lib/caddy.sh` (site `<nom>.web.caddy`),
`lib/backup.sh` (`web-data`, `web.env`), `lib/common.sh` (`POLENTA_WEB_IMAGE` de `host.env`, fichiers
600 écrits sans fenêtre lisible), `instance/docker-compose.yml` (`web.env`, dépendance à la forge
saine), `RUNBOOK.md` (A13 dimensionnement, A15 client web, B7 côté client).

**Tests e2e** : `e2e-web/s4-print.spec.ts` (S4-1, S4-2, S4-3), `e2e-web/s4-deployed.spec.ts`
(S4-5, S4-7 contre l'instance déployée), `e2e-web/support/forge-login.ts` (connexion forge
partagée, pages en anglais ou en français), `s3-oidc.spec.ts`, `README.md`. Outillage #45 :
`e2e-desktop/support/forge.ts` (`ssh`, `TEAM_CONFIG` partagé), `forge-setup.py` (branches `null`
juste après une création), `forge.spec.ts` / `forge-p1.spec.ts` (levée du bannissement fail2ban,
configuration d'équipe posée par chaque fichier, vue d'accueil réelle du projet).

**SPEC** (sprint final) : `SPEC-WEB.md` (nouveau), `SPEC-ELECTRON-DESKTOP.md` §1, §2, §11.3, §11.4,
§12, §13, §15 ; `SPEC-ACCOUNTS-AUTH.md` §8a ; `SPEC-MCP-SERVER.md` §3 ; `SPEC-TECH-stack.md` §2, §9 ;
`SPEC-TESTS.md` §4.5 ; `SPEC-TEMPLATES.md` (note après §3.4) ; `CONTEXT.md` D5b ; `SPEC-INDEX.md`
(9 lignes MAJ = GH44, dont la nouvelle ligne SPEC-WEB).

## Comportement implémenté

Les exports PDF et les diagrammes draw.io des exports par gabarit sont rendus **sur le serveur**, par
le même code React que le desktop, dans un Chromium headless : PDF A4 téléchargé, diagrammes en
PNG nets dans les documents Word. Polenta Web est livré en **image Docker** (1,2 Go, une par version
et par marque) et s'active sur une instance du kit en une commande :

```bash
sudo polenta-host instance web enable acme --domain acme-web.forge.example.fr --version 0.0.9
```

Elle crée l'application OAuth2 de la forge, écrit la configuration, démarre le conteneur derrière
Caddy (HTTPS, WebSocket) ; sauvegarde, restauration et export de l'instance incluent les espaces des
utilisateurs. Instance de test en service : `https://acme-web.forge.esquaresoft.fr` (forge
`acme`, image `polenta-web:gh44-s4`).

## Divergences par rapport au design

Détail dans `GH44-design.md` §10.3 :
- pas de jeton d'impression à usage unique : une session de l'utilisateur par rendu, détruite
  ensuite (S4-4 sans objet) ; page imprimée chargée par l'adresse interne du serveur ;
- image `node:20-bookworm-slim` + Chromium headless seul, au lieu de l'image Playwright (3,6 → 1,2 Go) ;
- commande `instance web enable|disable` dans `polenta-host` (et non `polenta-admin`) ;
- la sauvegarde arrête aussi le client web : sessions perdues, reconnexion sans ressaisie si la
  session de la forge est active ;
- correctif de navigation du tableau de bord (renderer, profite aussi au desktop).

## Mises à jour SPEC

Voir « Fichiers modifiés ». Limite documentée : un utilisateur web ne peut pas ajouter les
gabarits d'export propres au client (seuls les exemples), suite proposée.

## Vérifications

- `pnpm typecheck` : 0 erreur. `pnpm test` : desktop **163** (dont 5 nouveaux : impression),
  merge-core 34/34.
- **E2E web** (Chromium, serveur buildé + forge `acme` + instance déployée, `POLENTA_E2E_SSH`,
  `POLENTA_E2E_WEB_URL`, `POLENTA_E2E_MEASURE=1`) : **29/29**.
- **Instance déployée** : `https://…/healthz` OK, HSTS / `nosniff` / `X-Frame-Options`, connexion
  OIDC réelle, clone, PDF imprimé dans l'image, `web-data` peuplé ; `polenta-host instance backup
  acme` : `web-data` et `web.env` dans l'instantané restic ; `web.env` en 600.
- **Mémoire (S4-7)** : repos 168 Mo, 3 utilisateurs sur la démo 253 Mo (**28 Mo par utilisateur**,
  objectif < 300 Mo), après trois impressions 306 Mo.
- **E2E desktop** (`e2e-desktop/`, #45, build Electron) : 17/18 à chaque exécution, **un test
  différent en échec à chaque fois** (S2-6, S2-9/S2-11, S2-15, S4-9, S4-10, S2b-6), chacun vert
  isolément ; même comportement avec le correctif renderer de ce sprint retiré. Instabilité
  antérieure de cette suite (course de navigation T105 à l'ouverture d'un projet, état partagé de la
  forge) : corrections partielles ici (fail2ban, configuration d'équipe, branches `null`), suite
  proposée.
- `/code-review` : 10 constats — 9 corrigés (durée de la session d'impression, taille d'URL des
  diagrammes, export de `web-data` pendant l'arrêt, échec du client web non bloquant à la
  restauration, adresse interne, déconnexion pendant un rendu, `web.env` 600 dès l'écriture,
  dépendances web hors de l'installeur, commentaire déplacé), 1 accepté (dépendances transitives de
  l'image sans lockfile, justifié dans le Dockerfile).

## Reste à faire (manuel)

- S4-6 : **restauration** de l'instance avec client web (sauvegarde vérifiée seulement).
- S4-8 : installeur desktop (`pnpm package`) — la suite e2e desktop tourne sur le build Electron.
- S4-1 : PDF des autres vues (tests, campagne, requête, analyse d'impact) — même rendu.
- Scénarios S3 encore manuels : S3-5, S3-8 à S3-11.

## Comment tester

```bash
# Image (hôte du kit, depuis une copie du dépôt)
docker build -f apps/desktop/Dockerfile.web --build-arg POLENTA_BRAND=polenta -t polenta-web:gh44-s4 .
sudo polenta-host instance web enable acme --domain acme-web.forge.esquaresoft.fr --version gh44-s4 --image polenta-web
# Poste de dev : toutes les suites web
cd apps/desktop
POLENTA_E2E_SSH="ssh -o BatchMode=yes debian@<hôte>" \
POLENTA_E2E_WEB_URL=https://acme-web.forge.esquaresoft.fr pnpm test:e2e:web
```

Dans un navigateur : `https://acme-web.forge.esquaresoft.fr` → connexion avec un compte de la forge
`acme`, clone d'un projet, export PDF, export Word avec le gabarit « Cahier des exigences » des
exemples (Compte → Installer les exemples).
