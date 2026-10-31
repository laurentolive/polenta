# GH199 — Design : analyse d'impact dans le change

## 1. Types (`packages/types/src/change.ts`)

```ts
export interface ChangeRange { from: { ref: string; sha: string }; to: { ref: string; sha: string } }

/** Racine de l'analyse : élément de départ et ses deux arbres (§4.6, `ImpactNode`). */
export interface ChangeAnalysisRoot {
  elementId: string; elementType: 'requirement' | 'test_case'; title: string
  descendantTree: ImpactNode[]; ascendantTree: ImpactNode[]
}
/** Ligne de la liste des impactés : déclarée ou calculée, statut unique par élément (Q1). */
export interface ChangeImpactRow {
  id: string; elementType: 'requirement' | 'test_case' | null; title: string | null
  status: ChangeImpactStatus; comment?: string; source: 'declared' | 'computed'
  /** Calculée et atteinte par l'analyse courante (false : « n'est plus atteint »). */
  reached: boolean
}
export interface ChangeAnalysis {
  computedAt: string; frozen: boolean
  /** Bornes / snapshot : `{ kind: 'workdir' }` ou `{ kind: 'ref', sha }`. */
  snapshot: { kind: 'workdir' } | { kind: 'ref'; sha: string }
  roots: ChangeAnalysisRoot[]
  rows: ChangeImpactRow[]
  campaigns: { id: string; title: string; status: string; testIds: string[] }[]
}
// Change += range?: ChangeRange ; analysis?: ChangeAnalysis (instantané figé, `frozen: true`)
// CreateChangeDto += mode?: 'request' | 'range' ; range?: { from: string; to: string }  (tag ou SHA)
```

Statut d'un nœud d'arbre : celui de la ligne de l'élément (les `ImpactNode.status/comment` sont
remplis depuis les lignes au calcul).

## 2. Main

- `TraceabilityService` : `loadSnapshotAtRef`, `loadWorkingTreeSnapshot`,
  `buildImpactTreesFromSnapshot` deviennent publics (`ImpactSnapshot` exporté) ; nouveau
  `diffElementsBetweenRefs(repoPath, from, to)` (exigences + tests, `diffElementFields`), utilisé
  par le change `range`. Retirés : `createImpactAnalysis`, `list/get/updateImpactItemStatus/
  deleteImpactAnalysis`, `getImpactReport`, `acknowledgeImpact` (+ helpers propres).
  Ajout : `listLegacyAcks(repoPath, elementId)` (lecture `impact-acks/<id>/*.yaml`, Q8).
- `change-analysis.util.ts` (pur) : `computeChangeAnalysis(change, snapshot, campaigns, component)`
  → `ChangeAnalysis` : racines (listes, sinon exigences du composant), arbres, lignes (déclarées
  d'abord, puis calculées dédupliquées, puis persistées non atteintes `reached: false`), statuts
  reportés sur les nœuds, campagnes non closes contenant un test racine ou atteint.
  `pruneImpacted(impacted)` : garde les déclarées et les calculées avec statut ≠ défaut ou commentaire.
- `ChangesService` :
  - `analysis(repoPath, id)` : instantané si `analysis.frozen`, sinon snapshot (`range` → ref
    `to`, sinon disque du repo) + `computeChangeAnalysis` ;
  - `create` mode `range` : bornes résolues (`sync.resolveTag` puis SHA), diff → `toModify`
    `modified` ; `mode: range`, `range` écrits ;
  - `update` : `impacted` passé par `pruneImpacted` ; passage dans un statut terminal → analyse
    calculée et écrite (`analysis`, `frozen: true`) ; sortie d'un statut terminal → `analysis`
    retiré.
  - dépendances ajoutées : `traceability`, `campaigns`.
- IPC : `changes:analysis` (lecture) ; `changes:elements-for` (changes non terminaux du repo
  listant un élément, pour « Analyser l'impact ») ; `traceability:legacy-acks`. Retirés :
  `traceability:impact`, `traceability:acknowledge`, `impact-analysis:create|list|get|update-status|delete`
  (reste `impact-analysis:local`). Canaux d'écriture du graphe et politique web mis à jour.
- MCP `get_change` : `{ change, analysis }`. Graphe : `GraphChange.range`, `analysis`.
- `type-rename.util` / `schema-delete` : `impact-analyses` retiré des dossiers suivis.

## 3. Renderer

- `components/impact/ImpactTrees.tsx` : extrait de `routes/impact-analysis.tsx` (`ImpactTreeView`,
  `ImpactTreeNodeRow`, `ImpactNodeStatusEditor`, contexte de levée du flag, popups d'édition).
- Page d'un change : `ChangeAnalysisSection` (en-tête mode / bornes / calculée-figée / complétude /
  Rafraîchir / Exporter ; racines dépliables ; campagnes en cours). `ImpactedList` alimentée par
  `analysis.rows` (badges « calculé », « n'est plus atteint », filtre « ouverts seulement ») ;
  changer un statut → `update({ impacted })` avec la ligne (`pruneImpacted` côté main).
  Hook `useChangeAnalysis` (clé `['change-analysis', repoPath, id]`, invalidée par
  `useLiveFileSync` sur `requirements|tests|links|changes`).
- Nouveau change : bascule **Demande / Sur l'existant** ; bornes : sélecteur (baselines du repo +
  50 derniers commits `sync:log`) ou SHA saisi.
- `CreateChangeButton` → « Analyser l'impact » : changes non terminaux listant l'élément → menu
  « Ouvrir … / Créer un change », sinon création.
- Panneau Changements : bouton Constellation dans l'en-tête ; entrées « Impact à vérifier (N) »
  (`/changes/revalidation`) et « Modifications locales (M) » (`/changes/local`) en tête. Routes
  nouvelles réutilisant `RevalidationList` et le rendu local (`LocalImpactView`, extrait).
- Retirés : `routes/impact-analysis.tsx`, `ImpactPanel`, `VersionImpactSelector`,
  `ImpactAnalysisContext` (si plus utilisé), panneau `impact` (AppLayout, ActivityBar, Sidebar,
  TabsContext). `deducePanel` : `/constellation`, `/changes/*` → `changes`.
- Export : `kind: 'change-analysis'` (xlsx / docx / pdf), même mise en forme que l'export
  d'analyse §4.6 (racines puis arbres), `print.impact-analysis` adapté au change.
- Historique d'un élément : « Acquittements d'impact (anciens) » si `traceability:legacy-acks`
  renvoie des entrées.

## 4. Sprints

- S1 : types, `change-analysis.util` + tests, `ChangesService` (analyse, range, prune, figé),
  traceability (publics, diff éléments, retraits, legacy acks), IPC / api / MCP / graphe, tests.
- S2 : extraction `ImpactTrees`, section Analyse de la page, liste impactés, nouveau change
  `range`, « Analyser l'impact ».
- S3 : intégration panneau (revalidation, local, constellation), retrait de la vue Analyse
  d'impact, export, acks anciens, e2e (ports 8897–8899), revue, SPEC.

## 5. Avenant §8bis — backlog et assignation (sprint 4)

### Types (`packages/types/src/change.ts`)

- `ChangeSummary` : `open` (statut non terminal) et `toModifyIds` (assignation, « aussi dans … »).
- `BacklogItem { id, title, category, status, objectTypeRef, needsRevalidation }` ;
  `ComponentBacklog { repoPath, component, label, items }`.
- `ApprovalCheck { needsAssignment, component, openChanges: ChangeSummary[] }`.
- `isToProcess(typeDef, status)` : ni `isApproval` ni `isTerminal` (statut inconnu : à traiter).

### Main (`ChangesService`)

- `backlog(repoPath, workspaceDir?)` : pour chaque repo du workspace, exigences et tests lus sur
  disque, à traiter, absents de `toModify` des changes ouverts du repo ; regroupés par composant
  (nœud de `objectTypeRef` s'il est local, sinon le seul composant local du repo). Calculé à
  chaque appel, rien n'est écrit.
- `assign(repoPath, changeId, elementIds)` : ajoute en `planned` (sans doublon) ; refusé si le
  change est terminal.
- `move(repoPath, fromId, toId, elementIds)` : retire de `fromId`, ajoute à `toId` en gardant
  l'état (`planned` / `modified`).
- `approvalCheck(repoPath, { id, objectTypeRef, category }, toStatus)` : `needsAssignment` si
  `toStatus` est `isApproval`, le statut courant ne l'est pas et l'élément n'est dans aucun change
  ouvert du repo ; renvoie les changes ouverts du repo et le composant de l'élément.
- IPC / web : `changes:backlog`, `changes:assign`, `changes:move`, `changes:approval-check`
  (assign / move en écriture) ; api-client.

### Renderer

- `AssignToChangeDialog` (`components/changes/`) : changes ouverts du repo (moins le change
  source), « Nouveau change » (titre + type de change du schéma, composant donné), et en mode
  approbation « Approuver sans change ». Sert à l'approbation, au backlog (« Assigner à… ») et à
  « Déplacer vers… ».
- `ApprovalGateContext` (provider dans `AppLayout`) : `gate(repoPath, element, toStatus)` →
  `Promise<boolean>` ; appelle `changes:approval-check`, ouvre le dialogue si besoin. Branché sur
  les quatre écritures de statut de l'interface : `SystemView` (tableau, document, édition),
  `SearchEditPane`, page exigence (`req.$reqId`), page test (`test.$testId`). Refus → le statut
  n'est pas écrit (la vue relit le fichier).
- Backlog : hook `useBacklog(projectId)`, entrées « Backlog (N) » du panneau Changements (une par
  composant non vide, libellé du composant s'il y en a plusieurs), route `/changes/backlog`
  (`repoPath`, `component`) : tableau, filtre, sélection, « Assigner à… ».
- `ToModifyList` : cases à cocher, « Déplacer vers… », mention « aussi dans NC-… ».
- `ImpactedList` : badge « à traiter » et « Passer en à modifier » (retire de `impacted`, ajoute à
  `toModify` en une écriture).
- Invalidation : `changes`, `change`, `changes-backlog` après assign / move / approbation ;
  `useLiveFileSync` invalide `changes-backlog` sur `requirements/`, `tests/`, `changes/`.

### Alternatives rejetées

- Backlog stocké comme un change (`changes/BACKLOG.yaml`) : double source de vérité avec les
  statuts des éléments, écritures à chaque création d'exigence (Q15).
- Contrôle d'approbation dans le main (`requirements:transition`) : bloquerait le MCP et
  supposerait le moteur de transitions de #206 ; ici un dialogue côté interface suffit.
