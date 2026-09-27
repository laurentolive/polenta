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
(**T173**). La suppression d'un lien reste possible depuis l'éditeur de l'élément.

### 3.4 Exigences approuvées sans test exécuté

Sous-ensemble de 3.1 : exigences couvertes (un test lié existe) mais dont aucun run n'a encore été exécuté.

```
SW-0044  Exigence SW — Mode Normal  [couvert]  [jamais exécuté]
```

---

## 4. Analyse d'impact

### 4.1 Principe

Quand un élément est modifié (exigence ou test), l'analyse d'impact calcule la liste de tout ce qui doit être **revu ou revalidé**. Elle est déclenchée :
- Automatiquement à l'ouverture d'un brouillon ("Modifier") sur une exigence ou un test approuvé
- Manuellement depuis la fiche d'un élément (bouton "Analyser l'impact")

### 4.2 Impact d'une modification d'exigence

Quand l'exigence `REQ` est modifiée (nouveau brouillon ouvert) :

**Niveau 1 — Liens directs :**

| Élément impacté | Type | Action requise |
|----------------|------|----------------|
| TestCases couvrant `REQ` | Lien de couverture | Vérifier que le test couvre toujours l'exigence modifiée |
| Exigences ayant `REQ` comme parent | Lien PARENT_CHILD | Vérifier la cohérence avec la nouvelle version |
| Exigences liées par DERIVES_FROM, SATISFIES, REFINES | Lien sémantique | Vérifier la cohérence |

**Niveau 2 — Impacts transitifs (propagation) :**

Les exigences enfants et les tests qui les couvrent sont également listés, avec indication que l'impact est indirect.

**Format de la liste d'impact :**

```
Impact de la modification de SW-0042

▸ Tests à revalider (liens directs)
  TEST-0007  "Démarrage moteur — mode Éco"         [dernier run: PASS  2026-05-01]
  TEST-0012  "Démarrage moteur — batterie faible"   [dernier run: FAIL  2026-04-15]

▸ Exigences filles à vérifier
  COMP-0007  "Composant — Contrôleur moteur"        [approuvé v1]
  COMP-0008  "Composant — Capteur température"      [brouillon en cours]

▸ Exigences liées à vérifier
  SYS-0003  SATISFIES  "Exigence sys — Performance aspiration"  [approuvé v2]

▸ Campagnes en cours utilisant ces tests
  CAMP-0002  "Validation release v1.5"  [en cours — 3/8 tests exécutés]
```

### 4.3 Impact d'une modification de cas de test

Quand le TestCase `TC` est modifié :

| Élément impacté | Raison |
|----------------|--------|
| Exigences couvertes par `TC` | Le test peut ne plus couvrir la même chose |
| Campagnes `in_progress` incluant `TC` | L'exécution en cours repose sur la version précédente |
| TestRuns passés de `TC` | Ne sont plus valides pour la nouvelle version (informationnel) |

### 4.4 Propagation configurable

La profondeur de propagation est configurable :

| Niveau | Ce qui est inclus |
|--------|------------------|
| 1 | Liens directs seulement |
| 2 | Liens directs + un niveau de transitivité |
| Complet | Tout le graphe de dépendance (peut être large) |

Défaut : **niveau 1** — suffisant pour la majorité des cas, évite le bruit sur les grands projets.

> **T46** : cette section décrit `getImpactReport` (élément unique, déclenché à l'édition, index
> vivant). Le flux d'analyse d'impact entre deux baselines (§4.6) ne suit pas cette règle — il parcourt
> toujours le graphe complet dans les deux directions, sans réglage de profondeur.

### 4.5 Marquer les impacts comme vérifiés

Depuis la liste d'impact, chaque élément peut être marqué **"Vérifié"** (avec commentaire optionnel). Cela enregistre un `ImpactAcknowledgement` dans git :

```yaml
# impact-acknowledgements/<uuid>.yaml
elementId: TEST-0007
elementType: test_case
triggerReqId: SW-0042
triggerReqVersion: 3
acknowledgedAt: "2026-06-01T14:00:00Z"
acknowledgedBy: user-456
comment: "Test toujours valide — le délai de 500ms n'a pas changé dans la nouvelle version."
```

Les acknowledgements sont affichés dans la liste d'impact et dans l'historique de l'élément.

### 4.6 Analyse d'impact entre deux baselines (T46)

Flux séparé de celui décrit en §4.1–4.5 (qui reste inchangé) — pour le cas d'usage "comparer deux
jalons figés" plutôt que "je viens d'éditer un élément". Accessible depuis le panneau Version →
"Analyse d'impact" (`/impact-analysis`).

**Bornes toujours des baselines.** Les deux bornes comparées sont exclusivement des baselines existantes
(tags immuables, `BaselineService.list`) — jamais une branche ou un commit arbitraire. Si on veut
comparer par rapport à l'état courant de l'intégration (ex. mesurer l'impact d'une modification sur une
branche `dev-*` avant de la livrer), il faut d'abord poser une baseline sur cet état — la création de
baseline (§5) n'est plus verrouillée à la branche d'intégration configurée depuis T46 : seule une
modification en attente (staged/unstaged) bloque encore la création, sur n'importe quelle branche.

**Calcul, entièrement figé à la création :**
1. **Diff exigence-par-exigence** entre les deux baselines — ajoutée/supprimée/modifiée avec le détail
   des champs changés (`status`, `title`, `fields.*`), calculé sur les blobs git bruts des deux tags
   (`TraceabilityService.diffRequirementsBetweenRefs`), indépendant de l'index vivant.
2. **Deux arbres d'impact par exigence changée** (montant et descendant), calculés sur un **snapshot
   chargé à la baseline B** (`loadSnapshotAtRef` + `buildImpactTreesFromSnapshot`) — pas l'index vivant.
   Contrairement à `getImpactReport` (§4.2) : profondeur illimitée (tout le graphe, pas de niveau 1 par
   défaut), les deux directions sont suivies (montant = liens sortants de l'exigence, jamais parcouru par
   `getImpactReport`), et chaque nœud visité (pas seulement l'exigence déclenchante) porte les tests qui
   le couvrent directement. Un même élément n'apparaît qu'une fois par exigence changée (garde-fou
   anti-cycle partagé entre les deux arbres) ; il peut réapparaître sous une autre exigence changée de la
   même analyse. **Liens de couverture test ↔ exigence suivis dans les deux sens** (T175) : un test
   est rattaché à une exigence que le lien ait été créé depuis le test (`sourceId` = test) ou depuis
   l'exigence (`targetId` = test) — même règle que `matchCoverageLink`. Avant T175 seul le premier sens
   était suivi ; les analyses déjà persistées ne sont pas recalculées. Les liens exigence ↔ exigence
   gardent leur sens (source = enfant, cible = parent).

Une fois créée, une analyse est un **instantané reproductible** : la rouvrir plus tard restitue
exactement le même diff et les mêmes arbres, quoi qu'il arrive au projet depuis. Il n'y a pas de
"recalcul" — comparer une évolution ultérieure nécessite une nouvelle baseline et une nouvelle analyse.

**Statut par élément impacté** — enum plat à 8 valeurs, librement modifiable (pas de machine à états) :
`impact_non_verifie` (défaut), `pas_d_impact_reel`, `impact_a_tester`, `impact_teste`,
`modification_a_faire`, `modification_faite`, `modification_a_tester`, `modification_verifiee`. Un
commentaire optionnel peut accompagner chaque changement de statut. Persisté avec l'analyse — pas de
mécanisme d'acquittement séparé comme en §4.5 (`ImpactAcknowledgement` reste dédié au flux élément-unique).

**Indicateur de complétude** : `pas_d_impact_reel`, `impact_teste`, `modification_verifiee` comptent comme
**clos** ; tout le reste comme **ouvert**. Un bandeau signale l'analyse "complète" quand zéro élément
reste ouvert — informatif, pas bloquant.

**Génération de campagne** : un bouton collecte tous les éléments en statut `impact_a_tester` ou
`modification_a_tester`, ajoute directement les TestCases, résout les exigences vers leurs TestCases
approuvés couvrants via `generateTestPlan` (§5, réutilisé tel quel), déduplique, puis pré-remplit
`/campaign/new` (titre + sélection de TestCases) plutôt que de dupliquer l'écran de création.

**Persistance** : `impact-analyses/<id>.yaml`, un fichier par analyse (même pattern que
`impact-acks/<reqId>/<ackId>.yaml`, §4.5).

**Stockage réel** : les exigences/tests sont des fichiers `.yaml` purs sous `requirements/`/`tests/`
(pas de frontmatter Markdown) ; les liens vivent dans un fichier unique `links/links.yaml`. `GitService`
expose `readYamlRef`/`listFilesAtRef`/`readYamlDirAtRef` (et, depuis T171, `readYamlAtTag`, qui distingue
tag introuvable et fichier absent — lecture des paramètres à la baseline d'une campagne) pour lire ces données à un sha arbitraire (utilisé
par le diff et le snapshot ci-dessus).

### 4.7 Analyse d'impact des modifications locales (T175)

Troisième flux, **live** : l'impact des modifications non commitées (working tree) par rapport au dernier
commit (`HEAD`) — le cas « je viens de modifier des exigences/tests, qu'est-ce que ça touche ? » sans
passer par une baseline.

**Présentation** : dans le panneau Analyse d'impact, une entrée « Modifications locales (vs HEAD) » s'affiche
en tête de la liste des analyses tant qu'au moins un élément diffère de `HEAD` (compteur d'éléments, pas de
date ni de suppression). À l'ouverture de la vue (montage du panneau) sans analyse active, elle est
sélectionnée automatiquement — une seule fois : une désélection par l'utilisateur n'est pas annulée, et une
analyse enregistrée sélectionnée n'est jamais remplacée. Quand les modifications disparaissent (commit,
Publier, abandon), l'entrée disparaît et, si elle était active, la vue revient à « aucune analyse ». Le
sélecteur de baselines reste utilisable. Valeur sentinelle `LOCAL_IMPACT_ANALYSIS_ID` dans
`ImpactAnalysisContext.activeAnalysisId`.

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
qu'en §4.6 (`buildImpactTreesFromSnapshot`) mais sur un **snapshot du working tree multi-repo** (lecture
disque, pas l'index vivant ; exigences, tests et liens de tous les repos agrégés, doublon d'id → le repo
racine gagne). Pour un **test** changé : arbre descendant vide, arbre montant = exigences qu'il couvre puis
leurs ascendants. Un élément hors du repo racine porte `repo: { path, name }` (badge dans l'UI, popup ouvert
dans son repo). Sans aucun changement, le snapshot n'est pas chargé. Type `LocalImpactAnalysis`
(`changedRequirements` contient exigences **et** tests, `elementType` optionnel ; absent = exigence).

**Nature** : jamais persisté (aucune écriture disque), pas de statut, commentaire, complétude, export ni
génération de campagne — lecture seule, bouton Rafraîchir. Recalcul quand `useLiveFileSync` reçoit un
`repo:file-changed` sur `requirements/`, `tests/`, `links/` ou un changement de ref (`'*'`) de n'importe
quel repo, au retour du focus, ou au clic sur Rafraîchir — pas de polling. Pour un suivi (statuts,
campagne), commiter, poser une baseline et utiliser §4.6.

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
