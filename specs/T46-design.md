# T46 — Design technique

## Vue d'ensemble

**Les deux bornes A et B sont toujours des baselines** (tags immuables listés par `BaselineService`), pas
une branche ni un commit arbitraire — décision utilisateur : comparer contre l'état courant de
l'intégration exige de poser une baseline dessus au préalable, pour que l'état comparé reste identifiable
et retrouvable dans le temps (cf. `T46.md` point 1). Conséquence directe : **toute l'analyse est calculée
une seule fois, à la création, entièrement figée sur A et B** — diff comme arbres d'impact. Rouvrir une
analyse plus tard restitue exactement le même contenu ; seuls les statuts/commentaires évoluent. Pas de
notion de "recalcul" du contenu (cf. D5).

Deux calculs distincts, tous deux exécutés contre les blobs git des baselines (jamais contre l'index vivant working-tree) :

1. **Diff au niveau exigence entre A et B** — sur les blobs bruts des deux tags. Réutilise
   `SyncService.diffBetween`/`diffFileBetween`.
2. **Arbres d'impact (montant/descendant) par exigence changée** — sur l'état des liens/exigences/tests
   tel qu'il existait **à la baseline B** (pas l'index vivant courant). Nécessite un nouveau lecteur
   "snapshot à un sha donné", cf. D1 et section dédiée.

Le résultat des deux est assemblé en une `ImpactAnalysis`, persistée en YAML, avec un statut mutable par
élément impacté.

---

## Nouveaux types (`packages/types/src/impact-analysis.ts`)

```typescript
export type ImpactAnalysisStatus =
  | 'impact_non_verifie'      // défaut à la création
  | 'pas_d_impact_reel'
  | 'impact_a_tester'
  | 'impact_teste'
  | 'modification_a_faire'
  | 'modification_faite'
  | 'modification_a_tester'
  | 'modification_verifiee'

export type RequirementChangeType = 'added' | 'removed' | 'modified'

export interface ChangedField {
  field: string           // 'status' | 'statement' | `fields.${key}`
  from: unknown
  to: unknown
}

// Nœud d'un des deux arbres (montant ou descendant). Les test_case sont toujours des feuilles
// (children: []) ; seules les requirement peuvent avoir des enfants.
export interface ImpactNode {
  elementId: string
  elementType: 'requirement' | 'test_case'
  title: string
  linkType: string              // type du ObjectLink qui relie ce nœud à son parent dans l'arbre
  status: ImpactAnalysisStatus
  comment: string | null
  updatedAt: string | null
  updatedBy: string | null
  children: ImpactNode[]
}

export interface ChangedRequirement {
  reqId: string
  title: string                  // titre côté B ; côté A si removed
  changeType: RequirementChangeType
  changedFields: ChangedField[]  // vide si added/removed
  descendantTree: ImpactNode[]   // enfants directs de reqId dans l'arbre descendant (reqId lui-même n'est pas un ImpactNode : c'est la modification elle-même, pas un "impact")
  ascendantTree: ImpactNode[]    // idem, ascendant
}

export interface BaselineRefPointer {
  tag: string    // nom du tag de la baseline (BaselineRecord.tag)
  sha: string    // résolu au moment de la création — la baseline est déjà immuable, mais on fige le sha ici pour ne jamais dépendre d'une re-résolution
}

export interface ImpactAnalysis {
  id: string
  label: string                  // ex. "v1.0 → v1.1", généré depuis les deux tags, éditable
  repoPath: string
  fromBaseline: BaselineRefPointer
  toBaseline: BaselineRefPointer
  createdAt: string
  createdBy: string
  changedRequirements: ChangedRequirement[]
}

// DTOs
export interface CreateImpactAnalysisDto {
  fromBaselineTag: string
  toBaselineTag: string
  label?: string
}

export interface UpdateImpactItemStatusDto {
  reqId: string        // exigence changée sous laquelle se trouve le nœud (un même elementId peut apparaître sous plusieurs reqId, cf. spec point 2 — la clé est (reqId, elementId, direction))
  direction: 'ascendant' | 'descendant'
  elementId: string
  status: ImpactAnalysisStatus
  comment?: string | null
}
```

**Pourquoi un fichier de types séparé plutôt qu'étendre `traceability.ts`** : `ImpactAnalysis` n'est pas
une vue calculée à la volée comme `ImpactReport` — c'est une entité persistée avec son propre cycle de
vie CRUD. La séparer évite de mélanger les deux familles dans les imports.

---

## Backend (`apps/desktop/src/main`)

### `TraceabilityService` — nouvelles méthodes

Ajoutées à `traceability.service.ts` (pas un nouveau service — le service existant possède déjà
`reqIndex`, `testsIndex`, `git`, et gagne `sync` en dépendance ; garder l'analyse d'impact regroupée en un
seul endroit, cf. D2).

```typescript
constructor(
  private readonly reqIndex: RequirementsIndexService,
  private readonly testsIndex: TestsIndexService,
  private readonly git: GitService,
  private readonly workspaceTree: WorkspaceTreeService,
  private readonly sync: SyncService,   // ← nouveau, pour diffBetween/diffFileBetween
) {}

// 1. Diff requirement-level entre deux baselines (blobs bruts)
async diffRequirementsBetweenRefs(
  repoPath: string, fromSha: string, toSha: string,
): Promise<Array<{ reqId: string; changeType: RequirementChangeType; changedFields: ChangedField[]; titleFrom?: string; titleTo?: string }>>

// 2a. Charge un instantané complet (exigences, tests, liens) tel qu'il existait à un sha donné —
// une seule fois par création d'analyse, partagé par tous les buildImpactTrees() de cette création
async loadSnapshotAtRef(repoPath: string, sha: string): Promise<ImpactSnapshot>

// 2b. Construit les deux arbres pour UNE exigence changée, à partir d'un instantané déjà chargé
// (fonction pure, aucun accès git — appelée une fois par exigence changée avec le même snapshot)
buildImpactTrees(snapshot: ImpactSnapshot, reqId: string): { descendantTree: ImpactNode[]; ascendantTree: ImpactNode[] }

// 3. CRUD ImpactAnalysis (persistence git, cf. section Persistance)
async createImpactAnalysis(repoPath: string, dto: CreateImpactAnalysisDto): Promise<ImpactAnalysis>
async listImpactAnalyses(repoPath: string): Promise<ImpactAnalysis[]>   // méta seulement (id, label, baselines, dates) — pas les arbres complets, cf. D4
async getImpactAnalysis(repoPath: string, id: string): Promise<ImpactAnalysis>
async updateImpactItemStatus(repoPath: string, id: string, dto: UpdateImpactItemStatusDto): Promise<ImpactAnalysis>
async deleteImpactAnalysis(repoPath: string, id: string): Promise<void>   // hors scope UI (spec §Hors scope) mais méthode triviale à avoir pour les tests/nettoyage — pas exposée en IPC dans ce ticket
```

```typescript
interface ImpactSnapshot {
  requirements: Map<string, { title: string; objectTypeRef: string }>
  tests: Map<string, { title: string }>
  links: ObjectLink[]
}
```

#### `diffRequirementsBetweenRefs` — implémentation

1. `sync.diffBetween(repoPath, fromSha, toSha)` → `SyncFileStatus[]`, filtrer `path.startsWith('requirements/') && path.endsWith('.md')`
2. Pour chaque fichier filtré, `sync.diffFileBetween(repoPath, fromSha, toSha, path)` → `{oldContent, newContent}`
3. Parser le frontmatter YAML de chaque côté (réutiliser le parser existant de `RequirementsIndexService` — l'extraire en fonction exportée si actuellement privée, plutôt que dupliquer la regex/parsing frontmatter)
4. Classer : `oldContent === ''` → `added` ; `newContent === ''` → `removed` ; sinon `modified`, avec diff champ à champ entre les deux frontmatters parsés (`status`, `fields.*`, `statement` — comparaison JSON stringifiée par champ, pas un diff textuel du markdown brut)
5. Si le parsing frontmatter échoue d'un côté (fichier corrompu, format inattendu) : fallback `changedFields: [{ field: '(brut)', from: oldContent, to: newContent }]` plutôt que de faire échouer tout le calcul

#### `loadSnapshotAtRef` — implémentation (nouveau, cœur de la décision D1)

1. `git.walk({ fs, dir: repoPath, trees: [git.TREE({ ref: sha })], map })` — variante mono-arbre du
   `git.walk` déjà utilisé par `sync.diffBetween` (qui en passe deux) — collecte tous les chemins sous
   `requirements/**/*.md` et `tests/**/*.md`
2. Pour chaque chemin collecté, `git.readBlob({ fs, dir: repoPath, oid: sha, filepath })` + parsing
   frontmatter (même parser que `diffRequirementsBetweenRefs`) → alimente `snapshot.requirements` /
   `snapshot.tests` (id → title/objectTypeRef minimal, pas besoin du frontmatter complet)
3. `git.readBlob` sur `links/links.yaml` au même `sha`, parse YAML → `snapshot.links`
4. Résultat mis en cache le temps de la requête `createImpactAnalysis` (pas de cache inter-requêtes —
   une analyse n'est créée qu'une fois, pas de raison de garder le snapshot en mémoire après)

#### `buildImpactTrees` — implémentation

BFS bidirectionnel à partir de `reqId`, sur `snapshot.links`/`snapshot.requirements`/`snapshot.tests`
(même logique de traversée que `getImpactReport`, mais :
- **sans limite de profondeur** (pas de paramètre `depth`)
- **deux directions** : descendant = `link.targetId === current.id` → `link.sourceId` (comme aujourd'hui) ; ascendant = `link.sourceId === current.id` → `link.targetId` (nouveau, jamais fait aujourd'hui)
- **tests récupérés à chaque nœud requirement visité**, pas seulement à la racine (corrige la limitation actuelle de `getImpactReport` notée en Refs SPEC de `T46.md`)
- **garde anti-cycle** : un `Set<elementId>` global aux deux arbres — un élément déjà placé dans l'arbre descendant n'est pas dupliqué dans l'ascendant même s'il y est aussi atteignable (cf. spec point 2, "n'apparaît qu'une fois")
- Statuts initialisés à `impact_non_verifie` pour tout nœud (aucune notion de statut préexistant à ce stade — c'est `createImpactAnalysis` qui assemble le résultat initial, cf. D5 : pas de recalcul, donc pas de fusion avec un état antérieur)

### Endpoints IPC (`apps/desktop/src/main/ipc/index.ts`)

Suivent le pattern existant `traceability:*` :

```typescript
ipcMain.handle('traceability:diff-requirements', (_e, repoPath, fromSha, toSha) =>
  c.traceability.diffRequirementsBetweenRefs(repoPath, fromSha, toSha))
ipcMain.handle('impact-analysis:create', (_e, repoPath, dto: CreateImpactAnalysisDto) =>
  c.traceability.createImpactAnalysis(repoPath, dto))
ipcMain.handle('impact-analysis:list', (_e, repoPath) =>
  c.traceability.listImpactAnalyses(repoPath))
ipcMain.handle('impact-analysis:get', (_e, repoPath, id: string) =>
  c.traceability.getImpactAnalysis(repoPath, id))
ipcMain.handle('impact-analysis:update-status', (_e, repoPath, id: string, dto: UpdateImpactItemStatusDto) =>
  c.traceability.updateImpactItemStatus(repoPath, id, dto))
```

`container.ts` : ajouter `sync` comme 5e argument à `new TraceabilityService(reqIndex, testsIndex, git, workspaceTree, sync)`.

### Persistance

`impact-analyses/<id>.yaml`, un fichier par analyse — même pattern que `impact-acks/<reqId>/<ackId>.yaml`
(pas de fichier-index agrégé comme `.polenta/baselines.yaml` : le nombre d'analyses reste faible, et
`git.listFiles(repoPath, 'impact-analyses')` + lecture individuelle suffit pour `listImpactAnalyses`).
`id` généré `impact-${Date.now()}`, cohérent avec `ack-${Date.now()}` existant.

`listImpactAnalyses` lit et retourne les `ImpactAnalysis` complètes moins `changedRequirements` (méta
seulement) pour rester léger sur la liste du panneau latéral — la vue détail (`getImpactAnalysis`) charge
l'objet complet à l'ouverture. *(Alternative plus simple : toujours tout charger, accepter le coût —
à trancher en sprint 1 selon la taille réelle observée ; noté comme optimisation, pas un pré-requis.)*

### `packages/api-client`

`types.ts` : ajouter `impactAnalysis: { create, list, get, updateStatus }` + `traceability.diffRequirements` au bloc `traceability` existant.
`ipc-client.ts` : implémentation `invoke(...)` symétrique au pattern `traceability.*` déjà en place.

---

## Prérequis — baseliner n'importe quelle branche (`baseline.tsx`)

Modification de `readinessIssue()` (`apps/desktop/src/renderer/routes/baseline.tsx:48-54`) : retirer la
condition `status.branch !== integrationBranch` du blocage. Ne reste bloquant que
`staged.length + unstaged.length > 0`.

```typescript
function readinessIssue(r: RepoReadiness): string | null {
  if (r.loading) return null
  if (!r.status) return 'état illisible'
  if (r.status.staged.length + r.status.unstaged.length > 0) return 'modifications en attente'
  return null
}
```

`integrationBranch` reste chargé et affiché (utile pour vérifier visuellement qu'on baseline la bonne
branche — `RepoReadinessRow` peut afficher la branche courante à titre informatif à côté du statut "prêt"),
mais ne conditionne plus `readinessIssue`. `integrationBranchQueries` peut être conservé tel quel pour cet
affichage informatif, ou simplifié si l'affichage de la branche courante suffit sans comparaison — détail
d'implémentation sprint 1, sans impact sur l'API.

**Portée du changement** : ce correctif touche `baseline.tsx`, utilisé par **toute** création de baseline
dans l'application, pas seulement le flux T46 ("Créer une baseline sur l'état actuel…" déclenché depuis
`/impact-analysis`). C'est voulu (cf. D7) — et aligne le comportement sur ce que
`SPEC-FORKS-BRANCHES-BASELINES.md` §5.7 documentait déjà mais que le code (T79) n'appliquait pas.

---

## Frontend (`apps/desktop/src/renderer`)

### Route `/impact-analysis` (`routes/impact-analysis.tsx`)

Structure calquée sur `version-diff.tsx` (réutilise `useSelectedRepo`, `useWorkspaceStructure`), mais
**sélecteurs A/B spécifiques**, pas `GitRefCombobox` :
- Nouveau `BaselineCombobox` (variante simplifiée de `GitRefCombobox` : une seule liste, pas de groupes
  branches/tags/commits) alimenté par `api.baseline.list(repoPath)` — libellé "tag — date de création"
- En bas de la liste, une option "Créer une baseline sur l'état actuel…" qui ouvre la popup de création
  de baseline déjà existante (réutilisation du flux de `baseline.tsx`, pas une nouvelle popup) ; à la
  fermeture réussie, invalide la query `baseline.list` et sélectionne automatiquement la baseline
  fraîchement créée dans le sélecteur d'où l'action a été lancée
- Panneau latéral : soit l'écran de sélection A/B (si aucune analyse ouverte), soit — une fois une
  analyse créée ou rouverte — l'arbre des `changedRequirements`, chacun dépliable vers ses deux
  sous-arbres (`ImpactTreeView`, nouveau composant récursif)
- Liste des analyses existantes du repo (bandeau en haut du panneau, "Analyses en cours" — `useQuery`
  sur `impactAnalysis.list`), avec bouton "Nouvelle analyse"

### `ImpactTreeView` (nouveau, `components/impact/ImpactTreeView.tsx`)

Composant récursif affichant un `ImpactNode[]` : icône type (exigence/test), titre, badge de lien
(`linkType`), `<StatusSelect>` (les 8 valeurs, `<select>` simple — pas de contrainte de transition,
conforme à la décision "liste plate"), commentaire optionnel en tooltip/expand. Clic sur le titre →
navigation vers la vue existante de l'élément (édition/Système/Excel/Word, réutilise le routing déjà en
place pour ouvrir un élément par id).

### Zone principale

Header avec compteur ouverts/clos (point 6 de la spec) + bandeau "Analyse complète" si 0 ouvert. Bouton
"Générer une campagne" (actif si au moins un élément `impact_a_tester`/`modification_a_tester`) → collecte
ces `elementId`, sépare `test_case` (ajoutés directs) et `requirement` (passés à
`traceability.testPlan` existant), ouvre la popup de création de campagne déjà existante pré-remplie
(réutilisation de l'UI de génération de plan de test du module Traçabilité — pas de nouvelle popup).

### Point d'entrée

Ajout d'une entrée dans `VersionPanel.tsx` (à côté de "Comparer"/version-diff existant) — "Analyse
d'impact" → navigate `/impact-analysis`.

---

## Décisions techniques

| # | Décision | Alternative rejetée | Pourquoi |
|---|----------|---------------------|----------|
| D1 | Arbres d'impact calculés sur un instantané figé à la baseline B (`loadSnapshotAtRef` + `git.walk` mono-arbre), pas sur l'index vivant | Réutiliser l'index vivant (`RequirementsIndexService`/`TestsIndexService`, plus simple à coder) | Revirement suite au retour utilisateur : les deux bornes sont désormais toujours des baselines immuables (cf. D5) — il devient incohérent que l'arbre d'impact, lui, dépende d'un état mouvant. `loadSnapshotAtRef` reste d'un coût raisonnable : c'est le même `git.walk`/`readBlob` que `sync.diffBetween` déjà en place, juste sur un seul arbre au lieu de deux, plus un parsing frontmatter déjà nécessaire pour le diff |
| D2 | Nouvelles méthodes dans `TraceabilityService` existant | Nouveau `ImpactAnalysisService` dédié | Réutilise directement `reqIndex`/`testsIndex`/`git` déjà injectés et les méthodes `findLinks`/`findAllLinks` ; un split reste possible plus tard si le fichier devient ingérable, pas bloquant ici |
| D3 | `ImpactAnalysis` dans un fichier de types séparé (`impact-analysis.ts`) | Étendre `traceability.ts` | Entité persistée avec CRUD propre, distincte des vues calculées à la volée (`ImpactReport`) qui peuplent déjà ce fichier |
| D4 | `listImpactAnalyses` renvoie les métadonnées seulement, `getImpactAnalysis` charge le détail complet | Toujours tout charger | Évite de parser N fichiers potentiellement volumineux (arbres complets) juste pour peupler un bandeau de liste ; à reconsidérer si le nombre d'analyses par repo reste petit en pratique |
| D5 | Les deux bornes A/B sont exclusivement des baselines (`BaselineService.list`) ; pas de branche/commit libre, pas de "recalcul" — une analyse figée est un instantané, comparer un état plus récent se fait via une nouvelle baseline + une nouvelle analyse | `GitRefCombobox` générique (branche/tag/commit quelconque) + bouton "Recalculer" fusionnant l'existant avec un nouveau scan | Retour utilisateur explicite : un état non baselisé (ex. branche d'intégration courante) n'est ni immuable ni garanti retrouvable dans le temps — inacceptable pour un usage de maîtrise des risques/audit. Simplifie aussi le modèle : plus de fusion additive, plus de champ `stale` |
| D6 | Génération de campagne réutilise `generateTestPlan` existant tel quel | Écrire une nouvelle méthode de génération dédiée à l'analyse d'impact | `generateTestPlan` prend déjà une liste de `requirementIds` et gère déduplication + filtre `approved_only` — exactement le besoin du point 5 |
| D7 | Assouplir `readinessIssue()` de `baseline.tsx` pour tout le monde (retirer le blocage "branche d'intégration"), pas seulement pour le flux T46 | Contourner le verrou uniquement depuis `/impact-analysis` (nouveau paramètre/flag qui bypasse la vérification juste pour ce flux) | Retour utilisateur explicite : le besoin ("mesurer l'impact avant de livrer") est de baseliner une branche de travail, ce qui est un cas légitime en dehors de T46 aussi ; dupliquer la logique de validation pour un cas bypass-only aurait ajouté de la complexité sans bénéfice — et `SPEC-FORKS-BRANCHES-BASELINES.md` §5.7 documentait déjà ce comportement, le code (T79) était l'anomalie |

---

## Découpage en sprints

**Sprint 1 — Backend + lecture** : correctif `readinessIssue()` (D7, pré-requis pour pouvoir tester
tout le reste sur une branche de travail), types, `diffRequirementsBetweenRefs`, `loadSnapshotAtRef`,
`buildImpactTrees`, persistance CRUD (create/list/get), endpoints IPC + api-client, route
`/impact-analysis` en **lecture seule** (choix A/B via `BaselineCombobox`, flux "créer une baseline sur
l'état actuel" si besoin, liste des exigences changées, arbres dépliables avec statut affiché mais pas
encore éditable). Objectif : prouver que le calcul bidirectionnel figé sur un snapshot et le stockage
tiennent la route de bout en bout.

**Sprint 2 — Édition + campagne** : `updateImpactItemStatus` + IPC + UI (`StatusSelect` éditable,
commentaire), bandeau de complétude (point 6), bouton "Générer une campagne" (réutilisation
`generateTestPlan` + popup existante), point d'entrée depuis `VersionPanel`.

Pas de sprint 3 anticipé — mise à jour de `SPEC-TRACEABILITY.md` et `SPEC-FORKS-BRANCHES-BASELINES.md`
§5.6 faite en fin de sprint 2 (dernier sprint), conformément à `WORKFLOW.md`.
