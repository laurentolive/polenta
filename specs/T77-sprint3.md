# T77 — Sprint 3 : dashboards pré-configurés + retrait de l'ancien tableau de bord

**Statut** : coding sprint 3 (dernier) → prêt pour revue humaine
**Branche** : T77
**Worktree** : `../polenta-T77/`

---

## Périmètre réalisé

Conforme au périmètre sprint 3 de `specs/T77-design.md` § "Découpage en sprints" :
extension du dataset du moteur de requête (`coverageStatus` + 5 critères de
maturité), seed automatique des 3 dashboards partagés par défaut, retrait de
l'ancien "Tableau de bord" de `project.$id.tsx`. Dernier sprint : relecture des
`## Refs SPEC` de `specs/T77.md` et mises à jour SPEC associées (§ dédiée
ci-dessous).

En cours de revue (`/code-review high`, 8 angles), un bug **préexistant** hors
scope T77 a été découvert et corrigé : le calcul `computeCoverageStatus` de
`apps/desktop/src/main/services/traceability.service.ts` n'avait jamais reçu le
correctif T63 (contrairement à sa copie `apps/api`) — voir § "Découvertes en
revue" ci-dessous.

---

## Fichiers créés / modifiés

### Main process
- `apps/desktop/src/main/services/maturity.util.ts` **(NEW)** — calcul des 5
  critères de maturité (`computeMaturity`), schema-driven, documenté en détail
  ci-dessous (§ "Critères de maturité — implémentation exacte").
- `apps/desktop/src/main/services/dashboard-seed.service.ts` **(NEW)** —
  `DashboardSeedService.ensureSeeded()` : seed des 3 dashboards partagés par
  défaut au premier accès à l'onglet "Suivi" (dossier `dashboards/` vide),
  jamais recréés après suppression volontaire (marqueur `dashboards/.seeded.yaml`,
  écrit uniquement en cas de succès complet), protégé contre les accès
  concurrents (cache en mémoire des tentatives en cours) et contre l'écriture sur
  une branche en lecture seule.
- `apps/desktop/src/main/services/query-engine.service.ts` **(MODIFIED)** —
  `buildDataset()` restructuré : agrège requirements/tests/links de tous les
  repos du périmètre AVANT de calculer `coverageStatus`/maturité (au lieu d'un
  calcul par repo isolé, cf. § Découvertes en revue), expose les colonnes
  dérivées sur `requirements`, résolution de schéma mémoïsée par repo. Constructeur
  étendu avec `TraceabilityService`. `resolveTableInfo` simplifié (une seule
  construction du `Set` d'allowlist au lieu de deux branches dupliquées).
- `apps/desktop/src/main/services/traceability.service.ts` **(MODIFIED)** —
  `computeCoverageStatus` exportée et **corrigée** (priorité `covered`/`validated`,
  cf. § Découvertes en revue) ; extraction de `computeCoverage()` (méthode
  publique, réutilisée par le moteur de requête) et nouvelle méthode
  `computeRevalidationReqIds()` (critère de maturité 5), toutes deux extraites de
  logique jusque-là interne/dupliquée plutôt que dupliquées à nouveau.
- `apps/desktop/src/main/services/schema-lookup.util.ts` **(MODIFIED)** —
  `findObjectTypeDef` durci contre un `objectTypeRef` manquant/malformé (frontmatter
  édité à la main) : ne plante plus (`.includes` sur `undefined`), traite ce cas
  comme `'unresolvable'`.
- `apps/desktop/src/main/container.ts` **(MODIFIED)** — instancie
  `DashboardSeedService`, injecte `traceability` dans `QueryEngineService`.
- `apps/desktop/src/main/ipc/index.ts` **(MODIFIED)** — le handler
  `dashboards:list` appelle désormais `dashboardSeed.ensureSeeded()` avant de
  lister.

### Types partagés
- `packages/types/src/traceability.ts` **(MODIFIED)** — commentaires de
  `CoverageStatus` précisés (le cas mixte pass+not_run était sous-documenté,
  contributeur indirect du bug historique).

### Renderer
- `apps/desktop/src/renderer/routes/project.$id.tsx` **(MODIFIED)** — retrait des
  `StatCard`, répartitions par domaine/statut/priorité, liste "récemment
  modifiées" et de tout le code qui ne servait qu'à ça (`countBy`, `StatCard`,
  `STATUS_COLORS`, `STATUS_BAR_COLORS`, `PRIORITY_COLORS`, la requête
  `api.requirements.list`, l'import `Requirement`, `useNavigate` — plus aucun
  usage après retrait). Conservés : `PrjBranchSelector` (sélecteur de baseline) et
  `SyncBar`.

### SPEC (dernier sprint, cf. § dédiée)
- `SPEC.md`, `specs/SPEC-DASHBOARDS.md` **(NEW)**, `specs/SPEC-TECH-stack.md`,
  `specs/SPEC-TRACEABILITY.md`, `specs/SPEC-INDEX.md`.

---

## Comportement implémenté

### Dataset — `coverageStatus` + critères de maturité

- `coverageStatus` exposé directement sur chaque ligne de `requirements`,
  réutilisant `TraceabilityService.computeCoverage()` — aucune ré-implémentation
  du matching lien test↔exigence.
- 6 colonnes booléennes/texte dérivées : `maturityRequiredFieldsOk`,
  `maturityEarsOk`, `maturityAcceptanceOk`, `maturityVerificationOk`,
  `maturityNoRevalidation`, `maturityOk`, `maturityMissingCriteria` (libellés
  des critères manquants séparés par virgule).
- Toutes deux calculées sur le **graphe agrégé de tous les composants du
  périmètre** (repo courant + submodules), pas repo par repo — voir § Découvertes
  en revue.

### Critères de maturité — implémentation exacte (documentée dans le code)

Toutes les heuristiques sont **schema-driven** (aucun nom de champ codé en dur) :

1. **Champs `required` remplis** — pour chaque champ custom du type marqué
   `required: true`, vérifie que la valeur est non vide (chaîne non blanche,
   tableau non vide, ou toute valeur présente pour les autres types). Type non
   résolvable → passant (impossible à vérifier ≠ invalide) — **sauf** si
   `objectTypeRef` lui-même est manquant/malformé, auquel cas c'est signalé
   explicitement (`"type d'objet invalide"` dans `maturityMissingCriteria`).
2. **Syntaxe EARS** — appliqué à **tous** les champs dont `validator: EARS`
   dans le schéma (pas seulement un champ nommé `statement`). Heuristique :
   après suppression de la syntaxe Markdown de tête (heading/blockquote/liste/
   emphase — les champs richtext sont persistés en **Markdown**, pas en HTML,
   cf. `RichTextField.tsx`/`RichTextViewer.tsx`), le texte doit commencer par un
   des 5 mots-clés EARS et contenir `SHALL`. Aucun champ `validator: EARS` →
   passant par défaut.
3. **Critère d'acceptance mesurable** — cherche un champ dont le nom/label
   contient "accept" (convention `acceptanceCriteria` de `CLAUDE.md`, non codée
   en dur). "Mesurable" = non vide ET (checklist markdown `- [ ]`/`- [x]` OU
   contient un chiffre). Opère sur le texte **brut** (pas la version
   EARS-nettoyée : la syntaxe checklist doit rester intacte). Aucun champ
   correspondant → passant par défaut.
4. **Lien de vérification si approuvé** — réutilise `coverageStatus` :
   `!isApproved OR coverageStatus !== 'not_covered'`. Le statut "approuvé" est
   résolu depuis `typeDef.statuses[].isApproval` (pas la chaîne littérale
   `'approved'`) — repli sur `'approved'` seulement si non résolvable.
5. **Aucun lien `needsRevalidation`** — scan de tous les liens du périmètre
   agrégé où l'exigence est source OU cible (pas seulement les liens de
   couverture).

### Seed des 3 dashboards pré-configurés

- Déclenché côté main process, dans le handler IPC `dashboards:list` (pas dans
  `DashboardsService` lui-même, pour ne pas lui faire dépendre de
  `SavedQueriesService` et créer un cycle — limite documentée dans le code : un
  futur appelant de `DashboardsService.list()` qui contournerait ce handler IPC
  manquerait le seed).
- 7 requêtes SQL partagées + 3 dashboards partagés (Couverture : 2 widgets,
  Avancement : 2 widgets, Maturité : 3 widgets — KPI taux global, barres taux par
  domaine, table des non-conformes).
- Marqueur `dashboards/.seeded.yaml` écrit **uniquement** si le seed réussit
  entièrement — jamais sur le chemin "dossier déjà non vide" (dashboards
  pré-existants OU reste d'un seed précédent ayant échoué à mi-chemin), pour
  qu'un échec partiel reste retentable au lieu de rester figé indéfiniment.
- Protection contre deux appels concurrents (cache en mémoire des tentatives en
  cours par `repoPath`) et contre l'écriture sur une branche en lecture seule
  (`''`/`prj-*`).

### Retrait de l'ancien tableau de bord

`project.$id.tsx` ne montre plus que le titre "Projet", le sélecteur de baseline
et la `SyncBar`. Tout le code qui ne servait qu'aux StatCards/répartitions a été
retiré (pas seulement commenté).

---

## Découvertes en revue (`/code-review high`, 8 angles)

La revue a identifié deux problèmes réels au-delà du style, tous deux vérifiés
avec des scripts Node contre la vraie logique (pas seulement `tsc`) :

1. **Bug T63 non corrigé côté desktop** — `computeCoverageStatus` dans
   `apps/desktop/src/main/services/traceability.service.ts` implémentait encore
   `if (some(pass)) return 'validated'; return 'covered'` — la version **avant**
   le correctif T63 (qui n'avait été appliqué qu'à la copie `apps/api` du
   service, jamais répliqué côté desktop). Conséquence : une exigence liée à
   deux tests, l'un PASS et l'autre jamais exécuté, était classée `validated` au
   lieu de `covered` — contraire à `specs/SPEC-TRACEABILITY.md` §2.2 elle-même
   ("`covered` > `validated`" en priorité). Corrigé pour appliquer la priorité
   documentée (`if (some(not_run)) return 'covered'; return 'validated'`),
   exactement l'instruction du prompt de ce sprint ("vérifie l'état actuel du
   code — peut-être déjà corrigé — et n'introduis pas de logique dupliquée qui
   réintroduirait un tel bug").
2. **Agrégation de couverture par repo au lieu du périmètre complet** — la
   première version de `buildRepoDataset()` appelait `computeCoverage()`
   séparément pour chaque repo du workspace, alors que `TraceabilityService.
   getMatrix()` (dont la méthode a été extraite) agrège requirements/tests/links
   de **tous** les repos avant de calculer la couverture. Un lien de
   vérification cross-composant (test dans un composant, exigence dans un
   autre — cas réel, T69/T70, IDs globalement uniques) aurait donc rendu
   `coverageStatus` invisible/incohérent avec la Matrice de traçabilité pour les
   mêmes exigences. Corrigé : `buildDataset()` agrège maintenant tous les repos
   avant un seul appel à `computeCoverage()`/`computeRevalidationReqIds()` — la
   résolution de schéma (critères 1-3, spécifique à chaque composant) reste en
   revanche par repo, chaque composant étant schema-autonome.

D'autres correctifs de robustesse identifiés en revue et appliqués :

3. **Crash potentiel sur `objectTypeRef` manquant/malformé** — `findObjectTypeDef`
   appelait `.includes('::')` sans garde ; une exigence dont le frontmatter
   YAML a été édité à la main sans `objectTypeRef` aurait fait planter la
   construction du dataset pour **tout le repo**. Corrigé dans
   `schema-lookup.util.ts` (traite toute valeur non-string/vide comme
   `'unresolvable'`) — vérifié avec un script Node reproduisant l'appel avec
   `undefined`/`null`/`{}`/`[]`/`''`, aucun crash.
4. **`stripHtml` appliqué à du contenu Markdown** — les champs richtext sont
   persistés en **Markdown** (`RichTextField.tsx`/`RichTextViewer.tsx`, TipTap
   `Markdown.configure({ html: false })` + `getMarkdown()`), pas en HTML. La
   suppression de tags `<...>` était un no-op sur du Markdown réel, laissant la
   syntaxe (gras, titre, citation, liste) devant le mot-clé EARS et cassant
   l'ancrage `^\s*(WHEN|...)`. Remplacé par `stripMarkdownForEars()`, qui pèle
   les marqueurs de bloc en tête (heading/blockquote/liste) et les marqueurs
   d'emphase — vérifié avec un script Node contre des cas `**WHEN**...`,
   `> WHEN...`, `- WHEN...`, `# WHEN...`, tous correctement détectés comme
   conformes EARS. `isMeasurableAcceptance` (qui a besoin de la syntaxe
   checklist `- [ ]` intacte) opère volontairement sur le texte brut, pas la
   version EARS-nettoyée.
5. **Statut "approuvé" codé en dur** — le critère 4 comparait `req.status !==
   'approved'` littéralement au lieu de résoudre le statut réel marqué
   `isApproval: true` dans le schéma (déjà utilisé correctement ailleurs dans le
   même fichier pour d'autres besoins). Un projet dont le statut d'approbation
   porte un autre nom (ex. `valide`) aurait vu ce critère ne jamais se
   déclencher. Corrigé (`isApprovedStatus()`), repli sur `'approved'` uniquement
   si non résolvable.
6. **Vérification EARS limitée au premier champ `validator: EARS`** — utilisait
   `.find()` alors que le commentaire annonçait "tout champ EARS". Corrigé en
   `.filter().every()`.
7. **Race TOCTOU + verrouillage permanent sur échec partiel du seed** — voir §
   "Seed des 3 dashboards pré-configurés" ci-dessus.
8. **Écriture sur une branche en lecture seule** — `dashboards:list` est passé
   de lecture pure à lecture+écriture (seed) sans qu'aucun garde-fou readonly
   n'existe côté main process pour quelque écriture que ce soit dans ce repo
   (`isReadonly` de `VersioningContext.tsx` est purement décoratif côté
   renderer — lacune préexistante à tout le projet, pas spécifique à ce sprint).
   Un garde-fou ciblé a été ajouté **seulement** pour ce nouveau chemin d'écriture
   automatique (les autres écritures restent des actions utilisateur explicites,
   profil de risque différent) : le seed est sauté si la branche courante est
   `''` ou `prj-*`.

Nettoyage appliqué (au-delà des bugs) :
- `MaturityColumns`/`REQUIREMENT_DERIVED_FIELDS` dérivés d'un seul objet gabarit
  (`satisfies MaturityColumns`) plutôt que dupliqués (interface + array
  maintenus séparément, risque de dérive).
- Construction de `missing[]` (critères manquants) table-driven plutôt que 6
  `if` répétitifs.
- `resolveTableInfo` unifié (une seule construction du `Set` au lieu de deux
  branches dupliquées).
- Résolution de type (`findObjectTypeDef`) mémoïsée par repo dans
  `buildDataset()` plutôt qu'appelée une fois par exigence.

---

## Vérifications effectuées

- `pnpm --filter @polenta/desktop typecheck` → 0 erreur.
- `pnpm typecheck` (monorepo complet) → 0 nouvelle erreur (seule erreur
  restante : `apps/api/src/modules/git/schema.service.ts:66`, préexistante sur
  `T77`, déjà signalée aux sprints 1 et 2, revérifiée ici).
- `/code-review high` (8 angles) → tous les findings confirmés corrigés (§
  "Découvertes en revue").
- Scripts Node ad hoc contre la logique réelle (pas seulement `tsc`) :
  `isEarsCompliant`/`stripMarkdownForEars` sur des statements EARS enrobés de
  Markdown (gras/citation/liste/titre) + entrées malformées
  (`undefined`/`null`/`123`/`''`) ; `findObjectTypeDef` avec des
  `objectTypeRef` malformés ; requêtes SQL des 3 dashboards pré-configurés
  exécutées contre la vraie librairie `alasql` (dataset synthétique +
  dataset vide) pour confirmer l'absence de crash sur une table vide
  (`COUNT(*) = 0` → une ligne avec valeurs absentes, pas d'erreur, `toNumber()`
  côté widget la ramène à `0`).
- **Vérification interactive de l'app réelle** via le skill `run-desktop`
  (build + driver Playwright) :
  - Projet neuf créé (`T77S3Test`, dossier `dashboards/` initialement absent).
  - Premier accès à l'onglet "Suivi" → les 3 dashboards **Couverture**,
    **Avancement**, **Maturité** apparaissent automatiquement dans le panneau
    latéral, portée partagée (bouton "Partagé" actif sur chacun) — confirmé sur
    disque : `dashboards/DASHBOARD-0001.yaml` à `-0003.yaml` +
    `dashboards/.seeded.yaml` + `queries/QUERY-0001.yaml` à `-0007.yaml`.
  - Dashboard **Maturité** ouvert → 3 widgets rendus sans crash sur un projet
    sans aucune exigence : KPI "Taux de maturité global" affiche `0` (pas
    `NaN`/erreur), les 2 autres widgets affichent l'état vide explicite
    ("Aucune donnée pour cette requête." / "Aucune ligne pour cette requête.")
    plutôt qu'un chart cassé.
  - Page **Projet** rechargée → titre "Projet", sélecteur de baseline,
    `SyncBar` — plus aucune trace de StatCards/répartitions/récemment modifiées.
  - **Suppression manuelle des 3 dashboards** (fichiers YAML supprimés
    directement sur disque) puis réouverture de l'onglet "Suivi" → section
    "Dashboards" affiche "Aucun dashboard" / "Créer le premier" — **pas de
    réapparition** des templates, confirmant que le marqueur bloque bien le
    reseed.
  - Capturas d'écran conservées dans `C:/tmp/shots/` (session locale, non
    committées) : `01-project-page.png`, `04-suivi-panel.png`,
    `07-maturite-dashboard-final.png`, `08-after-manual-delete.png`.

**Non testé interactivement, par manque de temps** : le calcul de maturité sur
un jeu de données réel contenant des exigences volontairement incomplètes
(champ requis manquant, statement non-EARS, sans critère d'acceptance, etc.) —
scénario 13 de `T77-tests.md` ("cohérent avec le nombre d'exigences non
conformes... vérifiable manuellement sur un petit jeu de données") n'a été
vérifié que par le calcul lui-même (scripts Node ad hoc ci-dessus, sur des
entrées synthétiques couvrant les cas limites), pas par une saisie manuelle de
plusieurs exigences dans l'UI puis lecture du dashboard. À faire en revue
humaine si souhaité : créer 2-3 exigences dans `T77S3Test` (une complète et
conforme, une avec un champ requis vide, une avec un statement non-EARS),
rouvrir le dashboard Maturité, vérifier que la table "Exigences non conformes"
et le taux global reflètent bien ces cas.

---

## Divergences par rapport au design

- **Bug T63 desktop trouvé non corrigé et corrigé dans ce sprint** — pas une
  divergence de design à proprement parler, mais un écart entre le
  comportement attendu (documenté dans `SPEC-TRACEABILITY.md` depuis T30/T63)
  et le code réel, découvert en vérifiant l'instruction explicite de ce sprint
  ("vérifie l'état actuel du code — peut-être déjà corrigé"). Voir § Découvertes
  en revue.
- **`DashboardSeedService` n'est PAS un troisième composant de
  `T77-design.md`** — le design mentionnait le seed comme un comportement de
  `dashboards.service.ts` ou du handler IPC, sans trancher. Un petit
  orchestrateur séparé a été choisi pour éviter une dépendance circulaire
  `DashboardsService` → `SavedQueriesService` (l'inverse existe déjà depuis le
  sprint 2). Limite documentée : seul `dashboards:list` déclenche le seed —
  acceptable puisque c'est aujourd'hui son unique appelant.
- **`query-engine.service.ts` (`resolveRepos`) reste distinct de
  `TraceabilityService.resolveRepoPaths()`** — les deux méthodes font une
  résolution de repos très proche mais avec des formes de retour différentes
  (`{repoPath, component}[]` vs `string[]`) ; non unifiées ce sprint (repéré en
  revue, jugé non bloquant, laissé en duplication mineure plutôt que de risquer
  un refactor plus large en fin de ticket).
- **Retrait du dashboard = petite régression UX** — `project.$id.tsx` ne
  préchauffe plus le cache React Query `['requirements', repoPath]` (c'était un
  effet de bord de l'ancien tableau de bord). Naviguer ensuite vers
  Système/Exigences peut afficher un flash de chargement qui n'existait pas
  avant. Mineur, non corrigé (le retrait du préchauffage est une conséquence
  directe et voulue du retrait du tableau de bord demandé par ce sprint).
- **`GitService.nextCounterId()` non verrouillé** — préexistant (partagé par
  `ReviewsService`, `SavedQueriesService`, `DashboardsService`), pas spécifique
  à ce sprint : une création de requête/dashboard par l'utilisateur pendant les
  ~10 appels séquentiels du seed pourrait en théorie obtenir le même ID
  qu'un objet du seed. Non corrigé (verrouillage cross-service hors périmètre
  de ce sprint) ; le seed ne se produit qu'une fois par repo et dans une
  fenêtre de quelques centaines de ms, risque jugé faible.
- **Dashboards "Avancement"/"Maturité" par domaine dépendent d'un champ
  `domain`** qui n'est standard ni dans `CLAUDE.md` ni dans le schéma d'un
  projet donné — cohérent avec l'ancien tableau de bord retiré (qui faisait la
  même hypothèse). Sur un projet sans champ `domain`, les widgets concernés
  affichent un seul groupe (clé vide) plutôt que planter — vérifié par script
  contre `alasql` — mais restent peu lisibles. Non corrigé : c'est le même
  compromis que l'ancien tableau de bord, documenté plutôt que résolu par une
  UI de configuration du seed (hors scope).

---

## Mises à jour SPEC

Dernier sprint — `## Refs SPEC` de `specs/T77.md` relue et comparée à
l'implémentation finale :

| Section relue | Divergence/ajout trouvé | Mise à jour effectuée |
|---|---|---|
| `SPEC.md` §5 (Contraintes techniques) | Aucune (AlaSQL reste cohérent avec "pas de BD relationnelle") | Pas de changement direct à §5 ; nouveau §2.7 ajouté (voir ligne suivante) |
| `SPEC.md` §2.4 (Traçabilité) | Le module traçabilité gagne un nouveau consommateur (dashboards) | §2.4 inchangé ; nouveau **§2.7 "Dashboards et requêtes personnalisées"** ajouté après §2.6, résumé de la feature + lien vers `SPEC-DASHBOARDS.md` |
| `CONTEXT.md` D1 (pas de BD applicative) | Aucune divergence — AlaSQL reste une lecture sur tableaux JS en mémoire, pas un moteur de stockage | Non modifié (la justification de rejet de SQLite est déjà dans `T77-design.md` § Alternatives rejetées, jugé suffisant) |
| `CLAUDE.md` § Règles de cohérence | Base des 5 critères de maturité — implémentation exacte documentée dans `maturity.util.ts` et `SPEC-DASHBOARDS.md` §5.2 | `SPEC-DASHBOARDS.md` créé avec le détail complet (champ par champ, heuristique) |
| `packages/types/src/traceability.ts`, `traceability.service.ts` | `CoverageStatus` réutilisé tel quel, MAIS bug T63 trouvé non corrigé côté desktop (voir § Découvertes en revue) | Code corrigé ; commentaires `CoverageStatus` précisés (cas mixte pass+not_run) ; `computeCoverageStatus` exportée ; `computeCoverage()`/`computeRevalidationReqIds()` extraites en méthodes publiques réutilisables |

Fichiers SPEC modifiés (colonne `MAJ` de `specs/SPEC-INDEX.md` mise à jour →
`T77` pour chacun) :
- **`SPEC.md`** — nouveau §2.7 "Dashboards et requêtes personnalisées" (résumé +
  lien vers `SPEC-DASHBOARDS.md`).
- **`specs/SPEC-DASHBOARDS.md`** *(NEW)* — spec détaillée complète du module
  (moteur de requête, stockage/scope, widgets, dashboards pré-configurés,
  critères de maturité avec heuristiques exactes, panneau latéral).
- **`specs/SPEC-TECH-stack.md`** §2 — ajout des 3 nouvelles dépendances
  (AlaSQL, ExcelJS, recharts) à la table des bibliothèques.
- **`specs/SPEC-TRACEABILITY.md`** §2.2 — note documentant le bug T63 desktop
  trouvé et corrigé ce sprint, et le nouveau consommateur (`computeCoverage()`
  réutilisé par le moteur de requête).
- **`specs/SPEC-INDEX.md`** — 5 nouvelles lignes pour `SPEC-DASHBOARDS.md`,
  colonne `MAJ` mise à jour pour les 2 lignes `SPEC-TECH-stack.md` §2 et
  `SPEC-TRACEABILITY.md` §1-2 touchées.

---

## Comment tester manuellement

Avec `pnpm --filter @polenta/desktop dev` (ou le skill `run-desktop`), suivre
`specs/T77-tests.md` § "Sprint 3 — Dashboards pré-configurés" (scénarios 12-14) :

1. Créer un nouveau projet (dossier `dashboards/` inexistant/vide).
2. Onglet "Suivi" (icône grille dans l'`ActivityBar`) → les 3 dashboards
   **Couverture**, **Avancement**, **Maturité** apparaissent automatiquement
   dans le panneau latéral (section "Dashboards"), portée "Partagé". Vérifiable
   aussi sur disque : `dashboards/DASHBOARD-0001.yaml` à `-0003.yaml`,
   `dashboards/.seeded.yaml`, `queries/QUERY-0001.yaml` à `-0007.yaml`.
3. Ouvrir le dashboard **Maturité** → 3 widgets (KPI taux global, barres taux
   par domaine, table des non-conformes) s'affichent sans crash, même sans
   aucune exigence dans le projet (état vide explicite plutôt qu'un chart
   cassé).
4. Créer 2-3 exigences avec des lacunes volontaires (champ requis vide,
   `statement` non conforme EARS, sans critère d'acceptance, une approuvée
   sans lien de test) → rouvrir le dashboard Maturité → le taux global baisse,
   la table "Exigences non conformes" liste ces exigences avec le(s)
   critère(s) manquant(s) dans `maturityMissingCriteria`.
5. Ouvrir la page **Projet** → seuls le titre, le sélecteur de baseline et la
   barre de synchronisation sont visibles ; plus de StatCards/répartitions/
   récemment modifiées.
6. Supprimer manuellement les 3 dashboards pré-configurés → rouvrir/rafraîchir
   l'onglet "Suivi" → ils ne reviennent PAS (section "Dashboards" vide,
   "Créer le premier").
7. Ouvrir une baseline en lecture seule (branche `prj-*`) sur un projet dont
   `dashboards/` est vide → l'onglet "Suivi" ne doit écrire aucun fichier
   (vérifiable : `dashboards/` reste absent/vide tant qu'on reste sur cette
   branche).

---

## Résumé global des 3 sprints (pour la revue humaine finale)

**Sprint 1** — Moteur de requête AlaSQL (dataset `requirements`/`tests`/`links`
agrégé multi-composants, builder guidé → SQL, mode SQL avancé avec garde-fous
lecture seule durcis en revue), CRUD requêtes sauvegardées + historique
(scope privé/partagé), export Excel, panneau latéral section "Requêtes".

**Sprint 2** — Widgets (5 types, aperçu live, jamais contraints par la forme du
résultat) + Dashboards (grille à tailles prédéfinies réordonnable), règles de
scope/dépendance privé↔partagé (promotion libre avec remap automatique,
rétrogradation/suppression bloquées si dépendants partagés, revalidées à
plusieurs points d'entrée pour tenir même via un appel IPC direct), panneau
latéral section "Dashboards".

**Sprint 3** — `coverageStatus` + 5 critères de maturité exposés sur le
dataset (schema-driven, robuste aux données incomplètes/malformées), seed
automatique des 3 dashboards pré-configurés (une fois, jamais recréés après
suppression), retrait complet de l'ancien tableau de bord de la page Projet. En
cours de route : correction d'un bug préexistant (T63 jamais appliqué côté
desktop) et d'un bug d'agrégation cross-composant introduit puis corrigé dans
ce même sprint avant merge.

**Points d'attention pour la revue humaine** :
- Le bug T63 desktop corrigé ce sprint change le comportement observable de la
  Matrice de traçabilité existante (`getMatrix()`, T30) pour toute exigence
  ayant des tests liés partiellement exécutés — pas seulement les nouveaux
  dashboards. À valider explicitement : c'est un correctif de bug légitime
  (aligne le desktop sur `apps/api` et sur `SPEC-TRACEABILITY.md`), mais il
  change un statut affiché ailleurs dans l'app.
- Aucun test automatisé (`vitest`/`jest`) n'existe dans ce monorepo pour aucun
  des 3 sprints — toute la vérification s'appuie sur `tsc`, `/code-review`,
  des scripts Node ad hoc contre les vraies libs (`alasql`), et des sessions
  interactives via le skill `run-desktop`.
- Scénario 13 de `T77-tests.md` (taux de maturité cohérent sur un petit jeu de
  données réel) non vérifié interactivement avec des exigences réellement
  saisies dans l'UI — voir § "Vérifications effectuées" pour le détail de ce
  qui a été fait à la place et ce qui resterait à faire.
