# SPEC-AUDIT — Divergences spec vs code

> Généré le 2026-06-24. À traiter avant de créer des tickets dans les domaines concernés.  
> **Légende** : `[ABSENT]` feature spec non implémentée · `[DIVERGENCE]` comportement différent · `[NON DOC]` code non spécifié
>
> **T130 (2026-07-21)** : revue de tous les `specs/SPEC-*.md` restants contre le code — les items
> `SPEC-TESTS §4+`/`SPEC-TRACEABILITY §3+`/`SPEC-SYSTEM-VIEW`/baselines listés ici ont été
> re-confirmés d'actualité (sauf l'entrée `§2.2` marquée résolue ci-dessous), pas dupliqués dans
> `specs/T130.md`. Ce fichier n'était pas référencé dans `SPEC-INDEX.md` — ajouté à T130.

---

## Résumé

| Domaine | ABSENT | DIVERGENCE | NON DOC | Criticité |
|---------|--------|------------|---------|-----------|
| SPEC-TESTS §4+ | 10 | 5 | 3 | Élevée |
| SPEC-TRACEABILITY §3+ | 10 | 4 (1 résolue T63, T130) | 2 | Élevée |
| SPEC-SYSTEM-VIEW | 4 | 5 | 4 | Moyenne |

---

## SPEC-TESTS §4+

### §2.2 — Champs système TestCase

**[ABSENT] `type` (manual/automated/semi-automated)**  
Le champ `type: ENUM` défini dans la spec n'existe pas dans `packages/types/src/test.ts` ni dans `CreateTestCaseSchema`.

**[ABSENT] `currentVersion` et `hasDraft`**  
Absents de `TestCase` et de `tests.service.ts`.

**[ABSENT] `linkedRequirements` inline dans TestCase**  
La spec définit `linkedRequirements: [{reqId, reqVersion, coverageType}]` dans le YAML du TestCase. Les liens passent actuellement par le mécanisme `ObjectLink` séparé — le champ inline n'existe pas dans le type ni dans les DTOs.

### §3.2 — Attributs TestRun

**[ABSENT] `testCaseVersion`**  
`packages/types/src/test.ts` et `tests.service.ts:execute()` ne renseignent pas la version du test exécutée.

**[DIVERGENCE] `duration` toujours à 0**  
`tests.service.ts` ligne 100 : `duration: 0` hardcodé. La spec attend la durée réelle en secondes.

**[DIVERGENCE] `calibrationDate` : DATE vs DATETIME**  
La spec définit `calibrationDate` comme `DATE`. `EquipmentUsedSchema` (`packages/zod-schemas/src/test.schema.ts` ligne 49) valide avec `z.string().datetime()` — exige un datetime ISO 8601 complet.

**[NON DOC] `executedAt` fixé côté serveur**  
`tests.service.ts:execute()` fixe `executedAt: now` sans permettre de le passer dans le DTO.

### §3.4 — StepResult

**[ABSENT] `executedAt` dans `StepResultSchema`**  
L'interface `StepResult` déclare `executedAt: string | null` mais le schéma Zod ne l'inclut pas. `execute()` force `executedAt: now` pour tous les steps, écrasant les steps `NOT_EXECUTED`.

### §3.5 — Import JUnit XML

**[ABSENT]** Aucun handler IPC `tests:import`, aucun service d'import JUnit XML / JSON Polenta.

### §4.1 — TestCampaign vs CampaignRun

**[DIVERGENCE majeure] Fusion des deux concepts**  
La spec sépare `TestCampaign` (plan) et `CampaignRun` (exécution, ID `CRUN-XXXX`, champs `environment`, `productVersion`, `startedAt`, `assignedTo`). Le code fusionne tout dans un seul objet `TestCampaign` avec `runs: CampaignTestRun[]` inline. Pas de répertoire `campaign-runs/`, pas d'IDs `CRUN-*`.

**[ABSENT] `environment`, `productVersion`, `startedAt`, `assignedTo` sur le run**  
Absents de `CampaignTestRun`.

**[ABSENT] `testCaseVersion` dans la définition de campagne**  
La spec exige `testCases: [{testCaseId, testCaseVersion}]`. Le code stocke uniquement `testCaseIds: string[]`.

**[ABSENT] `createdBy` sur TestCampaign**

### §4.2 — Statuts

**[DIVERGENCE] `in_progress` vs `in-progress`**  
La spec utilise `in_progress`, le code utilise `in-progress` (tiret).

**[DIVERGENCE] `PASS/FAIL/BLOCKED/INCOMPLETE` vs `passed/failed/blocked/skipped`**  
Casse et valeurs différentes. La valeur `skipped` du code n'existe pas dans la spec. `INCOMPLETE` → `'skipped'` dans `campaign.$campaignId.execute.$testId.tsx` ligne 54.

### §4.3 — Tableau de bord CampaignRun

**[ABSENT]** Métriques taux d'exécution, taux de succès, couverture d'exigences par campagne non implémentées.

### §5 — Stockage Git

**[DIVERGENCE] Chemins TestRun**  
Spec : `executions/TEST-XXXX/RUN-YYYYMMDD-NNN.yaml`. Code : `test-runs/<testCaseId>/<runId>.yaml` (`tests-index.service.ts` ligne 83, `tests.service.ts` ligne 106).

**[DIVERGENCE] Format ID TestRun**  
Spec : `RUN-20260601-001`. Code : `<testCaseId>-run-<seq>` (ex: `TEST-0042-run-0001`).

**[ABSENT] Répertoire `test-versions/`** — snapshots de version approuvée absents.  
**[ABSENT] Répertoire `campaign-runs/`** — cohérent avec la fusion §4.1.

### §6 — Index mémoire

**[DIVERGENCE] Campagnes non indexées en mémoire**  
`TestsIndexService` ne contient que `testCases` et `runsByTestCase`. Les campagnes sont relues depuis git à chaque appel via `campaigns.service.ts`.

**[ABSENT] Méthodes de traçabilité**  
`findTestsByRequirement(reqId)`, `findPassingRunsFor(testCaseId, version)`, `coverageForRequirement(reqId)` absentes de `TestsIndexService`.

**[ABSENT] MiniSearch dans TestsIndexService**  
`RequirementsIndexService` l'utilise, `TestsIndexService` non.

---

## SPEC-TRACEABILITY §3+

### §2.2 — Matrice de couverture

**[RÉSOLU T63]** ~~Ordre de priorité des statuts inversé~~ — corrigé par T63. Vérifié par lecture
directe (`traceability.service.ts:786-792`, `computeCoverageStatus`) : l'ordre réel est déjà
`needs_revalidation > failing > covered > validated > not_covered`, conforme à la spec. Entrée
laissée barrée plutôt que supprimée pour tracer qu'elle a été vue et confirmée résolue (T130).

**[DIVERGENCE] Filtre statut `approved` absent**  
La spec dit `covered` = "au moins un TestCase **approuvé** lié". `getMatrix` n'applique aucun filtre sur `tc.status === 'approved'`.

**[ABSENT] Filtres `campaignRunId` et `branch`**  
`MatrixFiltersSchema` ne contient pas ces deux filtres décrits en §2.4.

**[ABSENT] Vue hiérarchique (§2.5)**  
Aucune méthode `buildHierarchicalView` dans `TraceabilityService`. La matrice retourne uniquement des `MatrixRow[]` plats.

### §3 — Liens manquants

**[DIVERGENCE] Filtre statut `approved` absent pour exigences et tests orphelins**  
`getMissingLinks` retourne toutes les exigences sans lien et tous les TestCases sans lien, sans filtrage par statut.

**[ABSENT] Action rapide "Créer un test pour cette exigence"**  
Aucun IPC handler ni composant React dédié. Pas de route `/traceability` dans le renderer.

**[ABSENT] Bouton "Revalider" un lien (§3.3)**  
Aucun handler IPC `requirements:link-revalidate`. Seule la suppression est disponible (`requirements:link-delete`).

**[ABSENT] Liste "Exigences couvertes mais jamais exécutées" (§3.4)**  
Cette catégorie n'est ni calculée ni retournée par `getMissingLinks`.

### §4 — Analyse d'impact

**[ABSENT] Déclenchement automatique à l'ouverture d'un brouillon (§4.1)**  
`traceability:impact` est un appel manuel. Aucun hook dans `requirements.service.ts` ou `tests.service.ts`.

**[ABSENT] Campagnes en cours dans le rapport d'impact (§4.2)**  
`getImpactReport` ligne 246 : `activeCampaignRuns: []` hardcodé.

**[ABSENT] Trigger `test_case` pour l'analyse d'impact (§4.3)**  
`getImpactReport(repoPath, reqId, depth)` — toujours `triggerType: 'requirement'`. Aucune logique pour un trigger de type `test_case`.

**[ABSENT] `triggerReqVersion` dans `ImpactAcknowledgement` (§4.5)**  
Absent de l'interface `ImpactAcknowledgement` et non renseigné dans `acknowledgeImpact`.

**[DIVERGENCE] Profondeur "Complet" non gérée (§4.4)**  
Aucune valeur sentinelle pour un parcours complet du graphe.

### §5 — Génération de plan de test

**[ABSENT] `generateTestPlan` ne crée pas de `TestCampaign` (§5.2)**  
Retourne un `TestPlanDraft` mais n'appelle pas `CampaignsService.create()`.

**[DIVERGENCE] Filtre `testCaseFilter` ignoré dans le service desktop (§5.1)**  
Le champ `dto.testCaseFilter` est déclaré dans le DTO mais non appliqué dans `traceability.service.ts` desktop (contrairement à `apps/api`).

### §6 — API TraceabilityService

**[ABSENT] Méthode `coverageStatus(repoPath, reqId)`**  
Non exposée séparément. La couverture individuelle est calculée uniquement en interne dans `getMatrix`.

### §7 — Export

**[ABSENT]** Exports Excel, PDF, YAML non implémentés. Seul `traceability:export-csv` existe.

### SPEC-FORKS §5 — Baselines

**[DIVERGENCE] `BaselineRecord` allégé vs `Baseline` complet**  
`baseline.service.ts` utilise `BaselineRecord` contenant seulement `tag`, `createdAt`, `components[]`. La spec définit `name`, `branch`, `commitSha`, `createdBy`, `milestone`, `description`, `forcedCreation`, `warnings`, `stats`.

**[NON DOC] Stockage dans `.polenta/baselines.yaml` (fichier unique)**  
La spec décrit des fichiers individuels `baselines/v1.0.yaml` dans le repo git. Le code utilise un fichier agrégé `.polenta/baselines.yaml`.

**[ABSENT] Pré-vérifications avant création de baseline (§5.2)**  
`baseline:create` crée le tag directement sans vérifier les brouillons ouverts, la couverture, les `needsRevalidation`.

**[ABSENT] Comparaison entre baselines (§5.6)**  
`BaselineDiff` existe dans les types mais aucun handler IPC `baseline:diff` ni méthode `BaselineService.diff()`.

**[NON DOC] `MatrixFiltersSchema` contient `parentId`**  
Déclaré mais non utilisé dans `getMatrix` desktop.

---

## SPEC-SYSTEM-VIEW

### Toolbar

**[DIVERGENCE] Bouton 🔍 filtre non câblé**  
`filterVisible` est dans `SystemViewContext.tsx` (l. 74) mais `FilterBar` dans `SystemPanel.tsx` est toujours visible — le toggle n'est pas connecté.

**[ABSENT] Bouton "Enregistrer" conditionnel**  
`isEditsDirty` est extrait du contexte (l. 282 de `SystemView.tsx`) mais aucun bouton ne l'utilise. L'auto-save est silencieux.

**[DIVERGENCE] Mode "Édition" absent du sélecteur de vue**  
Le sélecteur n'expose que Excel et Word. Le mode `'edit'` existe en tant que `ViewMode` mais s'active uniquement programmatiquement.

### Configuration des champs ⚙️

**[ABSENT] Onglet "Édition" dans `FieldConfigModal`**  
Seuls `excel` et `word` sont configurables. `visibleFieldsEdit` est persisté mais jamais configurable via le modal.

### Menu contextuel

**[NON DOC] Menu contextuel sur zone vide**  
`ElementTree.tsx` expose un `BgContextMenu` sur clic droit dans la zone vide (l. 883). La spec dit "pas sur zone vide".

### Bouton `+`

**[NON DOC] Bouton `+ Nouvel élément` permanent en fin d'arbre**  
`ElementTree.tsx` l. 865–877. Non mentionné dans la spec.

**[DIVERGENCE] Bouton `+` absent au survol des éléments (items)**  
Le bouton `+` inline n'apparaît qu'au survol des dossiers, pas des items.

### Drag & Drop

**[DIVERGENCE] Ordre de dépôt multi-sélection**  
`nodesToMove` suit l'ordre de sélection, pas l'ordre de l'arbre. La spec exige l'ordre de l'arbre.

**[NON DOC] Ghost drag immédiatement supprimé**  
`handleDragStart` crée puis supprime immédiatement le ghost via `setTimeout(..., 0)`. Comportement différent du feedback visuel décrit (image fantôme semi-transparente).

### Undo / Redo

**[ABSENT] Undo sur les éditions inline Excel / Word**  
La pile Undo de `useTreeState` ne couvre que les mutations d'arbre. Les éditions de champs (`autoSaveMutation`) sont hors scope Undo.

### Copie d'éléments

**[DIVERGENCE] `treeDeepCopyWithNewIds` génère un `objectId` sans objet backend**  
La copie d'un nœud crée un `objectId` fantôme (`generateId()`) sans créer l'objet correspondant en base. L'objet dupliqué n'existe pas côté serveur.

### [NON DOC] Éléments non spécifiés

- Persistance du mode de vue (excel/word) dans `localStorage` sous `polenta:viewMode:${repoPath}`.
- Bouton "← Retour" pour la navigation par liens (conditionné à `backHistory.length > 0`).
- Persistance de la sélection composant/type via l'URL (TanStack Router).

---

## Prochaines étapes

1. **Décider quelles divergences sont "la spec a tort" vs "le code a tort"** — certains `[ABSENT]` peuvent être des features futures intentionnellement non implémentées.
2. **Créer des tickets pour les corrections prioritaires** (divergences de comportement actif : statuts de couverture inversés, `in_progress` vs `in-progress`, copie d'éléments fantômes).
3. **Mettre à jour les sections SPEC** pour les `[NON DOC]` qui reflètent des décisions de conception valides (persistance URL, auto-save, etc.).
4. Mettre à jour la colonne `MAJ` dans `SPEC-INDEX.md` une fois les SPEC corrigées.
