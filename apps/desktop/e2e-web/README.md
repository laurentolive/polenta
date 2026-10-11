# Tests de bout en bout du client web (`e2e-web/`)

Tests Playwright qui pilotent **un vrai navigateur** (Chromium) sur le **serveur web buildé**
(`out/web-server` + `out/web`), comme un utilisateur : clics, saisies, sélecteurs de fichiers,
téléchargements, publication vers une forge git. Introduits par GH44 ; à réutiliser par tout ticket
qui touche le renderer, les services du main ou le serveur web.

```bash
cd apps/desktop
pnpm test:e2e:web                 # build web + toute la suite (≈ 1 min 30 hors build)
npx playwright test               # sans rebuild (le build web doit être à jour)
npx playwright test parity        # un fichier
npx playwright test -g "S2-9"     # un test par son titre
npx playwright test --headed      # navigateur visible
npx playwright test --debug       # pas à pas (inspecteur Playwright)
npx playwright show-report e2e-web/.report
```

Prérequis, une fois par poste : `pnpm install`, `npx playwright install chromium`, `git` dans le
`PATH` (le serveur git de test utilise `git http-backend`). Le réseau est nécessaire à chaque
exécution : la démo est clonée depuis GitHub pour amorcer la forge locale, et ses dépendances sont
lues sur github.com. Pour travailler hors ligne, passez un clone local dans
`POLENTA_E2E_DEMO_SOURCE` ; les dépendances restent alors injoignables.

> **Rebuild.** Les tests tournent sur le build. Après une modification du renderer ou du serveur,
> utilisez `pnpm test:e2e:web`, ou lancez `pnpm build:web` avant `npx playwright test`.

## Architecture

```
Playwright (runner)
 ├─ global-setup.ts ── clone --bare de la démo ─▶ <run>/remotes/demo-ll800-produit.git
 │                  └─ git-http-server.ts (127.0.0.1:8798) ── git http-backend ── « la forge »
 ├─ webServer : node out/web-server/index.cjs (127.0.0.1:8797, mode dev, utilisateur « e2e »)
 │      données : <run>/data/users/e2e/{workspaces,userData}
 └─ Chromium ── http://127.0.0.1:8797 ── renderer web + bridge window.polenta
```

- `<run>` = `%TEMP%/polenta-e2e-web/<horodatage>` : un dossier neuf par exécution. Rien n'est effacé
  sous un serveur démarré, et l'état d'une exécution précédente reste disponible pour l'enquête.
- **La forge locale** remplace GitHub ou Forgejo : Publier y pousse réellement, et les tests relisent
  l'historique du repo nu (`support/forge.ts`).
- **L'utilisateur** est fixe (mode dev du serveur) : `E2E Tester <e2e@polenta.test>`, login `e2e`.
- **Hôtes git autorisés** : `127.0.0.1` (la forge locale) et `github.com` (dépendances de la démo).

## Tests contre la forge réelle (connexion OIDC)

`s3-oidc.spec.ts` pilote la **vraie connexion** : redirection vers la forge Forgejo de test du kit
`deploy/` (instance `acme`), formulaire de connexion de la forge, consentement, retour dans l'application.
Ces tests sont ignorés sans accès SSH à l'hôte de test :

```bash
POLENTA_E2E_SSH="ssh -o BatchMode=yes debian@<hôte>" [POLENTA_E2E_INSTANCE=acme] pnpm test:e2e:web
```

Avec `POLENTA_E2E_SSH`, la config démarre un **second serveur web en mode `oidc`** (port 8796,
`support/oidc-env.ts`). Avant tout test, le process principal fait trois choses :
- il lève le bannissement fail2ban de l'IP de test (`unbanSelf`) ;
- il (re)crée l'application OAuth2 `polenta-web-e2e`, dont l'adresse de retour est
  `http://127.0.0.1:8796/auth/callback` (`forge-setup.py oauth-app`) ;
- il passe identifiant et secret au serveur.

Les comptes `itest-auteur|testeur|lecteur` et le repo `acme/itest` sont recréés par
`resetAccounts()` et `seedItest()`, qui viennent de l'outillage des tests desktop de #45
(`e2e-desktop/support/forge.ts`).

| Élément | Rôle |
|---|---|
| `support/oidc-env.ts` | `OIDC.enabled`, `OIDC.baseUrl`, `OIDC.forgeUrl`, environnement du serveur oidc, `prepareOidcApp()`. |
| `support/ui.ts` | `publish(page, titre)` : Publier comme un utilisateur, en refermant puis en rouvrant le popover s'il signale « l'état a changé ». `LABELS` : libellés français et anglais. |
| `e2e-desktop/support/forge.ts` | `resetAccounts`, `seedItest`, `setTeamConfig`, `admin('user disable …')`, `repoInfo`, `deleteRepos`, `oauthApp`, `unbanSelf`. |

Recette de connexion, avec la fonction `forgeLogin` / `completeForgeLogin` de `s3-oidc.spec.ts` :
- la page de connexion de la forge est remplie si la forge la présente ;
- « Authorize Application » est cliqué si l'application n'est pas encore autorisée ;
- on attend ensuite le retour dans l'application, avec le bridge prêt.

Pièges propres à la forge réelle :
- **fail2ban** : les 401 normaux de git et les scénarios de révocation finissent par bannir l'IP
  de test (10 en 10 min). `unbanSelf()` lève le ban à chaque exécution ; en cours d'exécution, un ban
  se manifeste par une forge injoignable (page 503 « serveur de connexion injoignable »).
- **Langue** : la configuration d'équipe de l'instance impose l'anglais aux `auteurs`. Utilisez
  `LABELS` ou des expressions bilingues (`/Mes projets|My projects/`).
- **Délais de la forge** : après une création ou une publication, la forge peut exposer un repo
  avant sa branche. Relisez avec `expect.poll`.

## Écrire un test

Un fichier = un parcours. Nommez-le d'après le ticket ou la fonctionnalité, par exemple
`gh52-import-reqif.spec.ts`. Le squelette :

```ts
import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

const s = setupSession() // session connectée + démo clonée à neuf et ouverte

test('GH52-1 — import ReqIF depuis la vue Exigences', async () => {
  await s.openView('Exigences')
  await s.page.getByRole('button', { name: 'Importer' }).click()
  // …
  const reqs = await s.invoke<Array<{ id: string }>>('requirements:list', s.project.localPath)
  expect(reqs.length).toBeGreaterThan(53)
})
```

`setupSession(options)` déclare les hooks du fichier et le passe en exécution série :

| Option | Défaut | Effet |
|---|---|---|
| `project` | `{ repo: 'demo-ll800-produit' }` | Repo de la forge locale cloné et ouvert avant le premier test. `null` : aucun projet, la session reste sur l'accueil. |
| `checkConsole` | `true` | Après chaque test, échec s'il y a eu une erreur console ou une exception non capturée. |

Ce que renvoie la session :

| Membre | Usage |
|---|---|
| `s.page`, `s.context` | Page et contexte Playwright (cookies de session inclus). |
| `s.project` | `{ workspaceDir, localPath, name }` du projet ouvert. |
| `s.invoke(channel, ...args)` | Appel d'un channel **par le bridge de la page** (`window.polenta.invoke`), c'est-à-dire le même chemin que les composants. |
| `s.openView(titre)` | Clic dans la barre d'activité : `Compte`, `Projet`, `Suivi`, `Exigences`, `Tests`, `Campagnes`, `Paramètres`, `Recherche`, `Version`, `Analyse d'impact`. |
| `s.projectUrl(route, search?)` | URL d'une route du projet, par exemple `s.page.goto(s.projectUrl('/requirements'))`. |
| `s.allowConsoleErrors(/regex/)` | Erreurs console attendues dans le test courant (coupure réseau simulée…). |
| `s.shot(nom)` | Capture dans `e2e-web/.results/<nom>.png`. |
| `s.cloneAndOpen(repo)` | Ouvre un autre projet de la forge locale dans la même session. |

### Boîte à outils (`support/`)

| Module | Contenu |
|---|---|
| `session.ts` | `setupSession`, `activityBar(page)`, `projectIdOf(workspaceDir)`. |
| `forge.ts` | Accès hors application à la forge : `remoteLog(format)`, `remoteChangedFiles(n)`, `remoteTags()`, `bareRepoPath()`, et `outsideClone(nom)` pour simuler **un autre utilisateur** qui pousse depuis son poste (conflits, rafraîchissement). |
| `helpers.ts` | `invoke(page, …)`, `collectErrors(page)`, `recordEvents(page, channel, nom)` / `recordedEvents(page, nom)` pour écouter les événements poussés (`repo:file-changed`, `web:events-reconnected`…). |
| `files.ts` | Fichiers d'upload prêts à l'emploi : `PNG_1PX`, `DRAWIO_MINIMAL`. |
| `env.ts` | Ports, dossiers, utilisateur, variables du serveur de test (`E2E`). |
| `git-http-server.ts`, `global-setup.ts` | La forge locale. |

### Recettes

**Sélecteurs.** Utilisez les rôles et les libellés visibles en français :
`getByRole('button', { name: 'Publier' })`, `getByPlaceholder('Mon dashboard…')`. Pour découvrir
un écran, enregistrez son arbre d'accessibilité depuis un test temporaire :
`fs.writeFileSync('e2e-web/.results/x.txt', await s.page.locator('body').ariaSnapshot())`.
`npx playwright codegen http://127.0.0.1:8797/auth/login` fonctionne aussi, avec un serveur lancé
à la main.

**Interface ou bridge ?** Passez par l'interface pour le comportement que le ticket livre ou
modifie. Utilisez `s.invoke(...)` pour préparer les données ou relire l'état, ce qui est plus
rapide et plus stable.

**Sélecteur de fichier.** Les channels qui ouvrent un dialogue sur le desktop ouvrent un `<input
type=file>` sur le web. Lancez l'appel sans l'attendre, puis servez le fichier :

```ts
const pending = s.invoke('image:pick-file', s.project.localPath)
const chooser = await s.page.waitForEvent('filechooser')
await chooser.setFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG_1PX }) // [] = annuler
const result = await pending
```

**Téléchargement.** `const d = s.page.waitForEvent('download')`, déclenchez l'export, puis
`await (await d).saveAs(path.join(E2E.downloadsDir, (await d).suggestedFilename()))`.

**Un autre utilisateur, un conflit.** `outsideClone('nom')` → `.write(rel, contenu)` →
`.commitAndPush('message')`, puis Publier depuis le navigateur (voir `parity.spec.ts`, P-4).

**Coupure réseau.** `setOffline` ne ferme pas une WebSocket déjà ouverte. Faites transiter la
connexion d'événements par le test avec `page.routeWebSocket` (voir `s2-core.spec.ts`, S2-8).

**Attendre un effet asynchrone** (push, notification) : `await expect.poll(() => …).toBe(…)`, jamais un
`waitForTimeout` suivi d'une assertion.

**Dialogues natifs** (`window.confirm`) : Playwright les rejette par défaut. Pour les accepter :
`s.page.once('dialog', d => d.accept())` avant l'action.

### Pièges connus

- **État serveur partagé entre fichiers.** Tous les fichiers utilisent le même utilisateur sur le
  même serveur. Le « dernier projet ouvert », les récents et les préférences passent d'un fichier à
  l'autre (S2-1 vide le dernier projet ouvert avant de tester l'accueil). Les fichiers s'exécutent
  par ordre alphabétique, dans un seul worker.
- **La forge évolue pendant l'exécution.** Les fichiers qui publient modifient le repo nu, et les
  suivants clonent cet état. Comparez « avant / après » (`remoteLog('%H')`) plutôt qu'un état absolu.
- **Projet fraîchement cloné.** `AGENTS.md` est généré à l'ouverture et apparaît comme modification
  en attente : publiez avant toute action qui exige des repos propres (baseline, P-3).
- **`.results/` est vidé à chaque exécution** (dossier de sortie de Playwright). Captures, traces
  (`trace.zip` en cas d'échec) et contextes d'erreur y sont écrits.
- **Ports** : 8797 (serveur web) et 8798 (forge). Ils sont modifiables par `POLENTA_E2E_PORT` et
  `POLENTA_E2E_GIT_PORT`.

## Contenu actuel

| Fichier | Scénarios (`specs/GH44-tests.md`) |
|---|---|
| `s2-core.spec.ts` | S2-1 accueil, S2-2 clone par l'UI, S2-3 parité (données + vues), S2-4 upload image/draw.io, S2-5 export téléchargé, S2-6 classeur d'exécution, S2-7 deux onglets, S2-8 coupure réseau, S2-9 Publier, S2-25 Origin WebSocket ; S2-20 (console) après chaque test. |
| `parity.spec.ts` | P-1 recherche et remplacement, P-2 dashboard et widget, P-3 baseline, P-4 conflit résolu dans le navigateur (GH37). |
| `s3-oidc.spec.ts` (forge réelle) | S3-1/S3-2 connexion OIDC sans jeton côté navigateur, S3-3 commit à l'identité forge, S3-4 isolation de deux utilisateurs, S3-17 lecteur : écriture refusée, S3-6 compte désactivé → « accès révoqué » et travail conservé, S3-15/S3-21 projets et préférences d'équipe, S3-16 « Créer sur le serveur ». |

## Variables

| Variable | Défaut | Rôle |
|---|---|---|
| `POLENTA_E2E_DEMO_SOURCE` | URL GitHub de la démo | Source du repo nu (chemin local accepté). |
| `POLENTA_E2E_PORT` | 8797 | Port du serveur web de test. |
| `POLENTA_E2E_GIT_PORT` | 8798 | Port de la forge locale. |
| `POLENTA_E2E_RUN` | horodatage | Identifiant du dossier d'exécution (fixé automatiquement). |
| `POLENTA_E2E_SSH` | — | Accès SSH à l'hôte de la forge de test : active `s3-oidc.spec.ts` et le serveur oidc. |
| `POLENTA_E2E_INSTANCE` | `acme` | Instance du kit utilisée comme forge de test. |
| `POLENTA_E2E_OIDC_PORT` | 8796 | Port du serveur web en mode oidc. |
