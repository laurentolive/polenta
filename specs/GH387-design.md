# GH387 — Design : suite e2e complète en moins de 10 minutes

Spec : `specs/GH387.md`. Ce design ne touche que l'outillage de test (`apps/desktop/e2e-web/`,
`playwright.config.ts`, `package.json`) et la documentation (README e2e, WORKFLOW). Aucun code de
production n'est modifié.

## 1. Point de départ mesuré (passage M0, § 6 de la spec)

| Mesure | Valeur |
|---|---|
| `pnpm build:web` | **19 s** |
| Playwright (wall) | **1278 s** (21,3 min) |
| Somme des corps de test (JSON reporter) | **529 s** |
| Hors corps de test (`beforeAll`/`afterAll`, ~99 fichiers) | **≈ 750 s**, soit ≈ 7,5 s par fichier |

Le passage n'est pas allé au bout : le serveur web s'est arrêté au bout de 1 263 s (code `0xC0000409`,
856 Mo de RSS, issue #396). En conséquence, 13 tests ont échoué et 50 n'ont pas été lancés. Les
chiffres ci-dessus sous-estiment donc un peu le coût réel.

Conclusions :
- le **build** ne pèse que 19 s : la piste 3 (le sauter) a peu d'intérêt (§ 4.3) ;
- le **`beforeAll`** pèse plus que les corps de test. `cloneAndOpen` clone la démo par HTTP, puis à
  l'ouverture ses **4 composants depuis github.com**, soit 5 clones par fichier, dont 4 passent par le réseau ;
- `networkidle` coûte au moins 500 ms par appel. `openView`, appelé 127 fois, en contient un, tout
  comme `setupSession` (connexion) et `cloneAndOpen`.

## 2. Découpage en sprints

| Sprint | Contenu | Mesure de sortie |
|---|---|---|
| 1 | Chronométrage du `beforeAll` (§ 3) + clone modèle (piste 1, § 4.1) | passage complet, en série |
| 2 | Une pile par worker sur des ports dynamiques (piste 6, § 4.6) ; correction des dépendances entre fichiers | passage complet avec N workers ; choix de N |
| 3 | `networkidle` (piste 2), `waitForTimeout` (piste 4), fichiers coûteux (piste 5), décision sur le build (piste 3) ; README et WORKFLOW ; deux passages complets consécutifs | critères d'acceptation |

## 3. Chronométrage

- `setupSession` horodate ses étapes : contexte, connexion, préparation du projet (copie ou clone),
  ouverture, navigation. Si `POLENTA_E2E_TIMINGS` vaut un chemin de fichier, il y ajoute une ligne
  JSON par fichier de test : `{ file, worker, login, prepare, open, goto, total, mode: 'copy'|'clone' }`.
  `afterAll` ajoute aussi sa durée. Sans la variable, rien n'est écrit.
- `e2e-web/support/timings.mjs <timings.jsonl> [report.json]` résume les mesures : sommes par
  étape, et somme des corps de test lue dans le rapport JSON de Playwright. Le script sert à remplir
  le § 6 de la spec. Il est aussi documenté dans le README.

## 4. Pistes

### 4.1 Clone modèle (sprint 1)

Dans `session.ts`, un cache est propre au processus du worker : un modèle par repo, avec sa
**signature**.

1. La signature d'un repo est la sortie de `git for-each-ref` sur son repo nu de la forge du worker
   (`E2E.remotesDir/<repo>.git`). Elle change à chaque publication, quelle que soit la branche.
2. `setupSession` (projet par défaut, ou `project: { repo }`) compare la signature :
   - **modèle valide** : `web:new-workspace-dir`, puis `fs.cpSync(modèle, dir, { recursive: true,
     preserveTimestamps: true })`, puis `workspace:open-project`, `mark-recent`, `resolve` et la
     navigation, comme aujourd'hui ;
   - **pas de modèle, ou signature changée** : vrai clone (`cloneAndOpen` actuel). Le dossier ouvert
     est ensuite copié vers `<racine du worker>/templates/<repo>-<n>`, avant le premier test.
     L'ancien modèle reste sur le disque, car rien n'est effacé pendant un passage.
3. Le modèle est copié juste après l'ouverture, avant tout test. Les fichiers écrits à l'ouverture
   (`.polenta/tree.cache.yaml`, clones des composants) en font partie, et la copie reproduit donc l'état
   « fraîchement cloné et ouvert ». On a vérifié qu'aucun chemin absolu n'est écrit dans les YAML du
   workspace.
4. `s.cloneAndOpen(...)` (appel explicite) et les parcours de clone dans l'UI (`s2-core`, accueil)
   **gardent le vrai clone** : c'est leur objet.
5. On garde la sémantique « un fichier voit les publications des fichiers passés avant lui » : une
   publication change la signature, et le fichier suivant reclone.

Alternatives rejetées :
- un `git fetch` sur une copie : il coûte un processus git par composant et ne remet pas
  les composants à jour ;
- un modèle préparé dans le global setup : il demanderait de lancer le serveur pour ouvrir le projet
  (clone des composants, cache de l'arbre). Le premier fichier du worker le fait déjà naturellement.

### 4.2 `networkidle` (sprint 3)

121 occurrences. Règle appliquée, au cas par cas :
- **helpers** (`openView`, connexion, `cloneAndOpen`) : on attend l'élément qui signale l'écran
  prêt. Pour `openView`, c'est le bouton actif déplié (`aria-expanded="true"`) suivi du contenu
  principal de la vue. Pour la connexion, c'est la fin de la redirection. Pour le dashboard, c'est son
  titre ;
- **après `goto` / `reload` dans les specs** : on attend l'élément que l'assertion suivante utilise. Si
  l'assertion suivante est déjà un `expect(...).toBeVisible()` qui attend, l'attente est supprimée ;
- une occurrence qui protège une vraie course (une écriture IPC à attendre) devient une attente sur
  la condition (`expect.poll` sur `invoke`).

### 4.3 Build (sprint 3)

Le build ne prend que 19 s. Un saut « build à jour » repose sur une détection des sources, qui peut
se tromper : on risquerait un test lancé sur un build périmé, pour 19 s gagnées. **Proposition : on
garde le build systématique** et on le note dans le § 6. Si, une fois les autres pistes faites, la
suite dépasse encore le budget de peu, on réévalue (empreinte des sources dans `out/.e2e-build-stamp`).

### 4.4 `waitForTimeout` (sprint 3)

18 occurrences. Chacune est remplacée par une attente sur la condition visée (`expect.poll`,
`toHaveText`, événement). Pour une pause qui vérifie qu'« il ne se passe rien » (absence d'écriture,
de requête), la durée est conservée, mais la pause est encadrée par une condition positive avant et
après, et un commentaire explique pourquoi elle reste.

### 4.5 Fichiers coûteux (sprint 3)

Fichiers en tête de M0 : `gh246-render-loop` (70 s), `gh300-scroll-position` (33 s), `gh56-activity-bar`
(24 s), `gh74-editing` (20 s), `gh107-adopt` (16 s), `gh276-integration-gaps`, `gh342-concurrent`,
`gh203-saved-views`, `gh126-split-column`. Pour chacun, on lit ce qui coûte (trace) :
- la préparation de l'état passe par `invoke` quand elle n'est pas l'objet du test ;
- une durée imposée par le test lui-même (fenêtre de mesure d'une boucle de rendu, par exemple) est
  laissée telle quelle et justifiée dans le § 6.

### 4.6 Une pile par worker (sprint 2)

**Global setup** (`global-setup.ts`, reçoit `config.workers` = N) :
1. Il clone la démo en repo nu **une fois** depuis `E2E.demoSource`, dans `<run>/seed/`.
2. Pour chaque worker `i` de 0 à N−1 :
   - il crée `<run>/w<i>/{remotes,data,downloads}` et copie le repo nu vers `w<i>/remotes` ;
   - il choisit des ports libres (`listen(0)` puis fermeture) pour le web, la forge et l'administration ;
   - il démarre la forge git HTTP dans son propre processus, comme aujourd'hui, ainsi que le faux service d'administration et le
     serveur web (`run-server.mjs`), en processus enfants. Leur stderr est relayé avec le
     préfixe `[w<i>]`, à la place de `[WebServer]`. On garde l'avertissement d'arrêt de GH330 ;
   - il attend `/healthz` des deux serveurs. Les N piles démarrent en parallèle.
3. Il écrit `<run>/stacks.json` : `[{ index, root, dataDir, remotesDir, downloadsDir, port, gitPort, adminPort }]`.
4. Teardown : il ferme les forges et tue les arbres de processus (`taskkill /T /F` sous Windows).

**`env.ts`** : `E2E` garde la même forme pour les specs. Les champs propres au worker (`dataDir`,
`remotesDir`, `downloadsDir`, `baseUrl`, `gitPort`, `gitBaseUrl`, `demoRemote`, `adminPort`,
`adminUrl`) deviennent des getters. Ils lisent l'entrée `TEST_PARALLEL_INDEX` de `stacks.json` (lu
une fois, à la demande). `TEST_PARALLEL_INDEX` est stable quand un worker redémarre après un échec :
le nouveau worker retrouve sa pile et son état. Aucune spec n'est modifiée pour lire sa pile.
`serverEnv(i)` construit l'environnement d'un serveur à partir de sa pile.

**`playwright.config.ts`** :
- `workers` vaut `POLENTA_E2E_WORKERS`, ou une valeur par défaut fixée au sprint 2 d'après la
  mesure (on vise 4) ; `fullyParallel` reste à `false`, pour que les tests d'un même fichier restent en
  série dans un seul worker ;
- `webServer` ne garde que le serveur OIDC (s3, port 8796 enregistré sur la forge) ;
- `use.baseURL` : la config est rechargée dans chaque worker, et le getter y lit la pile du worker. Pour
  ne pas dépendre de ce détail, `setupSession` passe aussi `baseURL` explicitement à
  `browser.newContext`. Les specs qui créent leur contexte elles-mêmes (`gh342-*`, `gh343`, `s2-core`,
  `s4-print`) sont vérifiées.

**Ports forcés** : `POLENTA_E2E_PORT`, `POLENTA_E2E_GIT_PORT` et `POLENTA_E2E_ADMIN_PORT` restent
acceptés comme **base**. Le worker `i` prend alors `base + 10·i`. Sans ces variables, les ports sont
dynamiques : deux worktrees peuvent lancer leurs e2e en même temps sans rien régler.

**Dépendances entre fichiers** : avec une pile par worker, un fichier ne voit que les publications
des fichiers passés avant lui dans son worker. Les fichiers qui en dépendent sont repérés de deux
façons : par un passage complet avec N workers, puis par un passage en ordre inversé
(`--shard`/ordre différent si les échecs sont ambigus). Chacun est corrigé pour préparer lui-même
son état.

**Fichiers qui changent un état global du serveur** (rôle d'administration `__role`, dernier projet
ouvert, `auth.json`, préférences utilisateur) : l'état reste propre à la pile. Ces fichiers se
gênent comme aujourd'hui, mais seulement à l'intérieur d'un worker. Aucun changement n'est donc
attendu, sauf un ordre qui variait déjà.

Alternatives rejetées :
- une fixture Playwright `{ scope: 'worker', auto: true }` qui démarre la pile : il faudrait changer
  l'import de `test` dans les 101 specs, et le démarrage d'un serveur se ferait dans le processus du
  worker, donc serait relancé quand le worker redémarre après un échec, avec un état neuf ;
- un serveur partagé entre les workers (rejeté par l'humain, § 2 de la spec).

## 5. Fichiers modifiés

| Fichier | Modification |
|---|---|
| `e2e-web/support/session.ts` | chronométrage ; clone modèle ; `baseURL` explicite ; `networkidle` des helpers |
| `e2e-web/support/env.ts` | champs propres au worker lus dans `stacks.json` ; ports de base |
| `e2e-web/support/global-setup.ts` | N piles, ports dynamiques, `stacks.json`, teardown |
| `e2e-web/support/stack.ts` (nouveau) | démarrage et arrêt d'une pile (ports libres, processus enfants, attente `/healthz`) |
| `e2e-web/support/timings.mjs` (nouveau) | résumé des mesures |
| `playwright.config.ts` | `workers`, `webServer` limité à OIDC |
| `e2e-web/*.spec.ts` | `networkidle`, `waitForTimeout`, préparation par `invoke`, dépendances entre fichiers |
| `e2e-web/README.md`, `WORKFLOW.md` | durée, workers, ports, mesure |
| `specs/SPEC-WEB.md` §10 | outillage e2e (piles par worker) si la section le décrit |
