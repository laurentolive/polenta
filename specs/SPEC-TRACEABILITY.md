# SPEC-TRACEABILITY — Module Traçabilité

> Référence parent : [SPEC.md](../SPEC.md) §2.4  
> Dépend de : [SPEC-REQ-requirements.md](SPEC-REQ-requirements.md), [SPEC-TESTS.md](SPEC-TESTS.md)

---

## 1. Vue d'ensemble

La traçabilité est un module **lecture seule** : elle ne stocke rien, elle calcule et présente des vues dérivées des données existantes (exigences, liens, tests, exécutions).

Trois fonctions principales :

| Fonction | Question à laquelle elle répond |
|----------|--------------------------------|
| **Matrice de couverture** | Quelles exigences sont couvertes par quels tests ? |
| **Liens manquants** | Qu'est-ce qui n'est pas encore couvert ou connecté ? |
| **Analyse d'impact** | Si je modifie cet élément, qu'est-ce qui doit être revu ? |

Tout est calculé à la volée depuis l'**index en mémoire** — aucune table de traçabilité à maintenir.

---

## 2. Matrice de couverture

### 2.1 Structure

La matrice croise les **exigences** (lignes) avec les **cas de test** (colonnes).

```
              TEST-001  TEST-002  TEST-003  TEST-004
SYS-0001        ✓ PASS    ·         ·         ·
SYS-0002        ✓ PASS    ✓ FAIL    ·         ·
SW-0042         ·         ✓ PASS    ✓ PASS    ·
SW-0051         ·         ·         ·         ⚠ revalider
BAT-0010        ·         ·         ·         ·      ← non couvert
```

### 2.2 Statut de couverture d'une exigence

Calculé depuis les liens `linkedRequirements` des TestCases et les résultats des TestRuns.

| Statut | Icône | Condition |
|--------|-------|-----------|
| `not_covered` | ○ | Aucun TestCase approuvé lié |
| `covered` | ◑ | Au moins un TestCase approuvé lié, mais aucune exécution PASS |
| `validated` | ✓ | Au moins un TestCase approuvé avec au moins une exécution PASS |
| `failing` | ✗ | TestCases liés exécutés, dernier run = FAIL ou BLOCKED |
| `needs_revalidation` | ⚠ | L'exigence, ou un des tests qui la couvrent, est marqué `needsRevalidation` (T172, SPEC-REQ §5.3) — une exigence marquée l'est même sans test lié |

**Priorité de calcul** (si plusieurs statuts applicables) :
`needs_revalidation` > `failing` > `covered` > `validated` > `not_covered`

> **T77 sprint 3** : `computeCoverageStatus()` (`apps/desktop/src/main/services/
> traceability.service.ts`) implémentait encore, avant ce sprint, la priorité
> inverse pour `covered`/`validated` (le bug documenté et corrigé sous **T63**,
> mais uniquement dans la copie `apps/api` du service — la copie `apps/desktop`
> n'avait jamais été alignée sur cette spec). Corrigé pour appliquer exactement la
> priorité ci-dessus ; `computeCoverageStatus` est désormais exportée et
> `getMatrix()` délègue le calcul à une nouvelle méthode publique
> `computeCoverage()`, réutilisée telle quelle par le moteur de requête des
> dashboards (T77, cf. [SPEC-DASHBOARDS.md](SPEC-DASHBOARDS.md) §5.3) pour exposer
> `coverageStatus` sans dupliquer cette logique.
>
> **T138** : ce statut (et ces icônes) est aussi affiché par exigence individuelle dans les vues
> Excel/Word/Édition (`coverageStatus`, champ système optionnel — cf.
> [SPEC-SYSTEM-VIEW.md](SPEC-SYSTEM-VIEW.md) §"Configuration des champs"), via l'endpoint
> `traceability:matrix`/`getMatrix()` déjà existant — même calcul, troisième point de consommation
> après la matrice de traçabilité et les dashboards.

### 2.3 Statut d'exécution d'un lien (cellule de la matrice)

Pour chaque paire (exigence, TestCase) :

| Valeur | Condition |
|--------|-----------|
| `not_run` | TestCase approuvé, lié, mais jamais exécuté |
| `pass` | Dernier TestRun pour ce TestCase = PASS |
| `fail` | Dernier TestRun = FAIL |
| `blocked` | Dernier TestRun = BLOCKED |
| `needs_revalidation` | L'exigence ou le test de la paire est marqué `needsRevalidation` (T172) |

> "Dernier TestRun" = le plus récent par `executedAt`, toutes campagnes confondues.
>
> *(T179)* Un `TestRun` qui porte `requirementId` (exécution d'une instance générée pour une
> exigence par `{req.<champ>}`, SPEC-TESTS §4.2) ne compte **que** pour cette exigence : pour la paire
> (exigence, test), le dernier run retenu est le plus récent parmi les runs sans `requirementId` et
> ceux de cette exigence (`latestRunForRequirement`). Même règle pour la couverture du moteur de
> requêtes (dashboards), le rapport d'impact d'une exigence et le plan de test généré.

### 2.4 Filtres de la matrice

La matrice peut être filtrée sur :
- **Type d'exigence** (SYS, SW, HW, BAT…)
- **Statut de couverture** (ex. : afficher uniquement `not_covered` et `failing`)
- **Tags d'exigence** (ex. : `safety`)
- **Campagne spécifique** (restreindre les exécutions à une TestCampaign)
- **Branche** (voir l'état de traçabilité sur une branche de travail)

### 2.5 Vue hiérarchique

En complément de la matrice plate, une vue arborescente montre la couverture par niveau hiérarchique :

```
SYS-0001 ✓ (2/2 tests PASS)
  └── SW-0042 ✓ (1/1 test PASS)
  └── SW-0051 ⚠ (1 test à revalider)
        └── COMP-0007 ○ (non couvert)
BAT-0010 ○ (non couvert)
```

Le statut d'un nœud parent agrège le pire statut de ses enfants :
`not_covered` > `needs_revalidation` > `failing` > `covered` > `validated`

---

## 3. Liens manquants

### 3.1 Exigences non couvertes

Liste des exigences approuvées sans aucun TestCase approuvé lié.

```
BAT-0010  Exigence Batterie — Surcharge cellule    [non couverte]  [high] [safety]
BAT-0011  Exigence Batterie — Sur-décharge         [non couverte]  [high] [safety]
SW-0051   Exigence SW — Mode veille timeout        [non couverte]  [medium]
```

Filtres : par domaine, priorité, tag. Tri par priorité descendante.  
Action rapide : **"Créer un test pour cette exigence"** — ouvre la création d'un TestCase pré-lié à l'exigence sélectionnée.

### 3.2 Tests sans exigence liée (tests orphelins)

TestCases approuvés ne couvrant aucune exigence.

```
TEST-0015  Test démarrage à froid    [approuvé]  [orphelin]
TEST-0031  Test vibrations méca      [approuvé]  [orphelin]
```

Un test orphelin n'est pas forcément un problème (test de régression générale), mais il doit être conscient.

### 3.3 Éléments à revalider (T172)

Depuis T172 le flag est porté par les éléments (SPEC-REQ §5.3) : la liste
(`getMissingLinks().revalidationItems`) contient les exigences et les tests marqués
`needsRevalidation: true` — `{ elementId, elementType, title, status }` — et non plus des liens.

```
SW-0042   exigence  ⚠  impact à vérifier
TEST-0007 test      ⚠  impact à vérifier
```

Pas de bouton « Revalider » par lien : la levée du flag se fait depuis l'analyse d'impact
(**T173**, §4.8 — arbres d'analyse ou liste « Impact à vérifier »). La suppression d'un lien reste
possible depuis l'éditeur de l'élément. `revalidationItems` n'est pas la source de la liste §4.8
(qui a besoin du repo et des éléments liés : `RevalidationService.listFlagged`).

### 3.4 Exigences approuvées sans test exécuté

Sous-ensemble de 3.1 : exigences couvertes (un test lié existe) mais dont aucun run n'a encore été exécuté.

```
SW-0044  Exigence SW — Mode Normal  [couvert]  [jamais exécuté]
```

---

## 4. Analyse d'impact

### 4.1 Principe (GH199)

L'analyse d'impact vit **dans le change** (SPEC-REQ §10) : elle calcule, à partir des éléments que
le change modifie, tout ce qui doit être **revu ou revalidé**. Deux flux sont retirés par GH199 :

- l'**analyse élément unique** (ex-§4.1–4.5 : `getImpactReport` à l'ouverture d'un brouillon,
  profondeur configurable, acquittements `ImpactAcknowledgement`) — les fichiers
  `impact-acks/<id>/*.yaml` existants restent lisibles dans l'historique de l'élément
  (« Acquittements d'impact (anciens) », IPC `traceability:legacy-acks`) ;
- l'**analyse entre deux baselines** (ex-§4.6, T46, `impact-analyses/<id>.yaml`) — remplacée par le
  change « sur l'existant » ; les fichiers existants sont ignorés.

La vue Analyse d'impact (barre d'activité) est retirée : « Modifications locales » (§4.7),
« Impact à vérifier » (§4.8) et la Constellation (§8) sont des entrées du panneau Changements.
Sur une exigence ou un test, **« Analyser l'impact »** ouvre un change non terminal du repo qui
liste l'élément (menu), ou crée un change avec l'élément dans « à modifier ».

### 4.2 Racines et arbres

- **Racines** : éléments « à modifier » + éléments impactés **déclarés** du change ; listes vides :
  toutes les exigences du composant concerné.
- **Arbres** (`buildImpactTreesFromSnapshot`) : pour chaque racine exigence, arbre **descendant**
  (exigences dont elle est la cible, récursivement, et tests qui couvrent chaque nœud) et
  **montant** (exigences qu'elle cible, récursivement) ; pour une racine test, arbre montant
  depuis les exigences qu'il couvre. Profondeur illimitée ; un élément n'apparaît qu'une fois par
  racine (garde anti-cycle partagée par les deux arbres) ; **couverture test ↔ exigence suivie
  dans les deux sens** (T175, `matchCoverageLink`) ; liens exigence ↔ exigence orientés (source =
  enfant, cible = parent).
- **Snapshot** : change **demande** → état courant **sur disque** du repo du change
  (`loadWorkingTreeSnapshot`) ; change **sur l'existant** → état à la borne `to`
  (`loadSnapshotAtRef`).

### 4.3 Lignes des éléments impactés

- Chaque élément atteint (hors racines) est un impacté **calculé** ; un élément atteint depuis
  plusieurs racines n'a **qu'une ligne** et **un statut**, affiché sur chacun de ses nœuds.
- **Statut** — enum plat à 8 valeurs, librement modifiable : `impact_non_verifie` (défaut),
  `pas_d_impact_reel`, `impact_a_tester`, `impact_teste`, `modification_a_faire`,
  `modification_faite`, `modification_a_tester`, `modification_verifiee`, avec un commentaire.
- **Persistance** (`Change.impacted`) : lignes déclarées, et lignes calculées portant une saisie
  (statut ≠ défaut ou commentaire) — `pruneImpacted`. Les autres sont recalculées.
- Une ligne calculée persistée qui n'est plus atteinte reste, marquée « n'est plus atteint ».
- **Complétude** : `pas_d_impact_reel`, `impact_teste`, `modification_verifiee` = clos ; « N ouverts
  / M » ou « Analyse complète ». Informatif.
- **Campagnes en cours** (non closes) contenant un test racine ou atteint : listées.
- **Élément à traiter** (ni `isApproval` ni `isTerminal`, GH199 §8bis) atteint par l'analyse : pas
  exclu (sa vérification reste tracée), badge « à traiter » et action « Passer en à modifier »
  (ligne retirée de `impacted`, élément ajouté à `toModify`).

### 4.4 Live, figée

- **Live** tant que le change n'est pas dans un statut terminal : recalcul à l'ouverture de la page,
  sur changement de fichier (`requirements/`, `tests/`, `links/`, `changes/`) et par
  « Rafraîchir » (IPC `changes:analysis`).
- **Figée** au passage dans un statut `isTerminal` : `ChangeAnalysis` (racines, arbres, lignes,
  campagnes) écrite dans `Change.analysis` (`frozen: true`), relue telle quelle ; statuts non
  modifiables. Retour dans un statut non terminal : instantané retiré, retour au live, statuts
  conservés.

### 4.5 Change « sur l'existant »

Bornes `from` / `to` : tag de baseline ou SHA (complet ou abrégé) d'un commit du repo du change
(`SyncService.resolveCommitish`). À la création, les exigences **et tests** changés entre les
bornes (`diffElementsBetweenRefs`, mêmes règles de comparaison qu'en §4.7) sont ajoutés à « à
modifier » (`state: modified`) ; `Change.range` garde les bornes et leurs SHA. Multi-repo : #208.

### 4.6 Export

Export de l'analyse d'un change (`kind: 'impact-analysis'`) : xlsx (racines puis arbres aplatis,
colonne Profondeur ; feuille « Éléments impactés »), modèle xlsx (mêmes clés que l'ancien export
§4.6 + `impacted`), PDF (route `/print/impact-analysis?repoPath&changeId`). Génération de campagne
depuis le change : #207.

### 4.7 Analyse d'impact des modifications locales (T175)

Troisième flux, **live** : l'impact des modifications non commitées (working tree) par rapport au dernier
commit (`HEAD`) — le cas « je viens de modifier des exigences/tests, qu'est-ce que ça touche ? » sans
passer par une baseline.

**Présentation** (GH199) : entrée « Modifications locales (vs HEAD) » du panneau Changements, affichée
tant qu'au moins un élément diffère de `HEAD` (compteur) ; route `/changes/local`. Plus de sélection
automatique.

**Périmètre** : repo racine **et** composants (`resolveWorkspaceRepoPaths`), chacun comparé à **son** `HEAD`,
quel que soit le repo sélectionné. Seuls `requirements/**/*.yaml` et `tests/**/*.yaml` sont des **éléments
changés** (ajouté / supprimé / modifié, staged + unstaged + non suivis confondus —
`SyncService.workdirChangesVsHead`, `statusMatrix` restreint à ces dossiers). `links/links.yaml` ne compte
pas comme changement mais modifie la construction des arbres ; tout autre fichier est ignoré. Un fichier
identique champ à champ à `HEAD` (reformatage) ne compte pas. Champs comparés : `status`, `title`,
`fields.*`, plus pour un test ses sections racine `preconditions`, `equipment`, `steps`, `postconditions`
(chacune = un champ). Le type de changement vient de git : un YAML illisible (édition en cours) est signalé
(id = nom de fichier si besoin) sans détail de champs, jamais pris pour une suppression.

**Calcul** (`TraceabilityService.computeLocalImpactAnalysis`, IPC `impact-analysis:local`) : mêmes arbres
qu'en §4.2 (`buildImpactTreesFromSnapshot`) mais sur un **snapshot du working tree multi-repo** (lecture
disque, pas l'index vivant ; exigences, tests et liens de tous les repos agrégés, doublon d'id → le repo
racine gagne). Pour un **test** changé : arbre descendant vide, arbre montant = exigences qu'il couvre puis
leurs ascendants. Un élément hors du repo racine porte `repo: { path, name }` (badge dans l'UI, popup ouvert
dans son repo). Sans aucun changement, le snapshot n'est pas chargé. Type `LocalImpactAnalysis`
(`changedRequirements` contient exigences **et** tests, `elementType` optionnel ; absent = exigence).

**Nature** : jamais persisté (aucune écriture disque), pas de statut, commentaire, complétude, export ni
génération de campagne — lecture seule, bouton Rafraîchir. Recalcul quand `useLiveFileSync` reçoit un
`repo:file-changed` sur `requirements/`, `tests/`, `links/` ou un changement de ref (`'*'`) de n'importe
quel repo, au retour du focus, ou au clic sur Rafraîchir — pas de polling. Pour un suivi (statuts,
campagne), créer un change (§4.1).

### 4.8 Levée du flag `needsRevalidation` (T173)

L'utilisateur constate qu'il a traité l'impact sur un élément marqué (§3.3, SPEC-REQ §5.3) et lève
le flag depuis la vue Changements (arbres d'un change, analyse locale, « Impact à vérifier »).

**Règle d'écriture** (`RevalidationService.clear`, IPC `revalidation:clear`) : la clé
`needsRevalidation` est **retirée** du YAML (jamais `false`) ; statut, `version`, autres champs et
`links/links.yaml` inchangés. Permise quel que soit le statut (approuvé verrouillé et terminal
compris), écrite dans le repo propriétaire de l'élément (composant compris), refusée pour un nœud
`readonly`. Idempotente, best-effort par élément, sous le verrou par fichier de `update`/`openDraft` :
résultat `{ cleared, unchanged, failed: [{ id, reason: not_found | readonly | error }] }` ; un échec
partiel s'affiche dans un bandeau fermable en tête de la vue, sans annuler les levées réussies.
**Pas de commit ni de trace** hors git : l'écriture part avec « Publier » (qui/quand = `git log`).

**Dans les arbres** d'un change (§4.2) et §4.7 (local) : un nœud dont l'élément est **actuellement**
marqué affiche ⚠, une case à cocher et « Lever le flag » (sans confirmation). L'état du flag est lu
en direct (`RevalidationService.listFlagged`, IPC `revalidation:list`, tous repos du workspace),
pas depuis le snapshot : une analyse baseline figée reflète le flag courant. Lever une occurrence
lève l'élément partout. Sélection multiple dédupliquée par id, vidée au changement d'analyse ;
bouton d'en-tête « Lever le flag de la sélection (N) » avec confirmation. La ligne « élément changé »
n'affiche que ⚠ (levée depuis la liste de repli). La levée et le statut d'impact d'un nœud de change sont
indépendants. En analyse locale, lever un flag ne fait pas de l'élément un « élément changé ».

**Liste de repli « Impact à vérifier »** : pour les flags qu'aucune analyse n'atteint (paramètre
modifié T171, réouverture déjà publiée…). Entrée en tête du panneau Changements (GH199), au-dessus
de « Modifications locales », affichée ssi au moins un élément du workspace est marqué (compteur) ;
route `/changes/revalidation`. Contenu (`RevalidationList`) : tous les éléments marqués
(exigences puis tests, par id) avec badge, id cliquable (popup dans le repo de l'élément), titre,
badge de repo, statut, case et « Lever le flag » ; « Tout sélectionner » (indéterminé si sélection
partielle). Chaque ligne se déplie sur ses éléments liés (tous liens, sens indifférent, un niveau) :
id, titre, type de lien, `version`, statut — un lié hors approbation est signalé « non approuvé »
(déclencheur probable). Quand le dernier flag est levé, la liste affiche « Aucun élément à revérifier »
et l'entrée disparaît du panneau. Rafraîchissement : mêmes déclencheurs que §4.7 et bouton Rafraîchir.

Après levée, les caches renderer lisant le flag (listes, matrice, maturité, couverture, analyse
locale, état de synchronisation) sont invalidés : ⚠ disparaît partout sans rechargement.

---

## 5. Génération de plan de test

À partir d'une sélection d'exigences, Polenta génère automatiquement une **campagne pré-remplie** avec tous les TestCases couvrant ces exigences.

### 5.1 Paramètres de génération

| Paramètre | Description |
|-----------|-------------|
| Sélection | Exigences choisies (par type, tag, statut, sélection manuelle) |
| Filtre TestCase | `approved_only` (défaut) / `include_draft` |
| Couverture | `full_only` / `all` (inclut les liens `partial`) |
| Déduplication | Un TestCase couvrant plusieurs exigences sélectionnées n'apparaît qu'une fois |

### 5.2 Résultat

Une `TestCampaign` est créée avec :
- La liste des TestCases (version approuvée courante de chacun)
- Un titre généré automatiquement (ex. "Plan de test — Exigences BAT — 2026-06-01")
- Le statut `draft` — à activer manuellement

Un résumé est affiché avant création :
```
Exigences sélectionnées : 12
TestCases trouvés       : 8
  dont : 6 avec un PASS récent
         1 avec un FAIL récent
         1 jamais exécuté
Exigences non couvertes : 4  ← avertissement
```

---

## 6. Implémentation via l'index mémoire

Toutes les vues de traçabilité sont calculées depuis le `RequirementsIndexService` et le `TestsIndexService`.

### 6.1 Requêtes clés

```typescript
// Couverture d'une exigence
coverageStatus(repoPath: string, reqId: string): CoverageStatus

// Matrice complète (filtrée)
buildMatrix(repoPath: string, filters: MatrixFiltersDto): TraceabilityMatrix

// Liens manquants
findUncoveredRequirements(repoPath: string): Requirement[]
findOrphanTests(repoPath: string): TestCase[]
findLinksNeedingRevalidation(repoPath: string): RevalidationItem[]

// Analyse d'impact
analyzeImpact(repoPath: string, elementId: string, elementType: ImpactElementType, depth: number): ImpactReport

// Génération de plan de test
generateTestPlan(repoPath: string, params: TestPlanGenerationParams): TestPlanDraft
```

### 6.2 Performance

Pour un projet de 500 exigences et 300 tests :
- Construction de la matrice complète : < 10ms (tout en mémoire)
- Analyse d'impact niveau 1 : < 1ms
- Analyse d'impact complet (graphe entier) : < 50ms

Pas de cache supplémentaire nécessaire — le `RequirementsIndex` et le `TestsIndex` sont déjà en mémoire.

---

## 7. Export

| Format | Contenu |
|--------|---------|
| CSV | Matrice plate : `reqId, reqTitle, testId, testTitle, coverageType, lastRunResult, lastRunDate` |
| Excel | Matrice colorée avec mise en forme conditionnelle par statut |
| PDF | Rapport de traçabilité formaté pour audit (jalons, certification) |
| YAML | `traceability/matrix.yaml` — généré par `scripts/matrix.py` du template |

Le script `scripts/matrix.py` génère `traceability/matrix.yaml` directement depuis les fichiers git, sans passer par l'API. Utilisable en CI pour vérifier la couverture minimale avant une release.

```yaml
# traceability/matrix.yaml (généré)
generated: "2026-06-01T10:00:00Z"
summary:
  total_requirements: 48
  covered: 35
  not_covered: 8
  needs_revalidation: 5
  coverage_rate: 72.9%
matrix:
  - reqId: SYS-0001
    reqTitle: "..."
    status: validated
    tests:
      - testId: TEST-0001
        coverageType: full
        lastRunResult: PASS
        lastRunDate: "2026-05-20"
  - reqId: BAT-0010
    reqTitle: "..."
    status: not_covered
    tests: []
```

---

## 8. Vue Constellation (GH183)

Vue de lecture seule de l'arbre de raffinement et de sa couverture, route `/constellation`,
ouverte depuis le panneau Changements (GH199).

- **Nœuds** : exigences du workspace (`links:objects`, catégorie `requirement`).
- **Arêtes** : liens dont les deux extrémités sont des exigences ; par défaut la source raffine
  la cible (bouton « Inverser le sens » sinon) ; filtrables par type de lien.
- **Disposition** : racines (sans parent) au centre, un pétale par racine ; un anneau par type
  d'exigence rangé par profondeur moyenne (un seul type → un anneau par profondeur).
- **Couverture** : une exigence terminale est couverte si son `coverageStatus` (§1–2) vaut autre
  chose que `not_covered` ; un nœud affiche la part de ses exigences terminales couvertes. Valeur
  d'affichage, jamais stockée (GH79).
- Logique pure : `apps/desktop/src/renderer/lib/constellationLayout.ts`.
