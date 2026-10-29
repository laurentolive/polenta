# GH198 — Design : objet change

Spec : `specs/GH198.md`. Trois sprints, sur `milestone-D`.

## 1. Types

- `schema.ts` : `ObjectCategory` += `'change'` (et la copie locale de `schema-refs.util.ts`).
- Nouveau `packages/types/src/change.ts` :
  ```ts
  export type ChangeImpactStatus = ImpactAnalysisStatus            // 8 valeurs de §4.6
  export interface ChangeToModify { id: string; state: 'planned' | 'modified' }
  export interface ChangeImpacted { id: string; status: ChangeImpactStatus; comment?: string; source: 'declared' | 'computed' }
  export interface Change {
    id; projectId; branchId; objectTypeRef; title; status; version; fields
    component: string; mode: 'request' | 'range'
    toModify: ChangeToModify[]; impacted: ChangeImpacted[]
    origin: { runs: string[]; decisions: { conformityId: string; objectId: string }[] }
    integratedIn: string | null; campaigns: string[]
    history?: ObjectHistory; createdAt?; createdBy?; updatedAt?; updatedBy?  // audit dérivé git
  }
  export interface ChangeSummary { … + repoPath }                    // liste du panneau
  export interface CreateChangeDto { objectTypeRef; title; component?; fields?; toModify?; impacted? }
  export interface UpdateChangeDto { title?; status?; fields?; component?; toModify?; impacted? }
  export interface ReopenedCandidate { id; title; category: 'requirement' | 'test'; status }
  export const DEFAULT_CHANGE_STATUSES  // ouvert, analyse, implemente, verifie, clos (terminal), rejete (terminal)
  ```
- `graph.ts` : `GraphObjectCategory` += `change`, `GraphChange`, `PolentaGraph.changes`.

## 2. Main (sprint 1)

`changes.service.ts` — `ChangesService(git, schema, requirementsIndex, testsIndex, workspaceTree, history?)` :
- `list(repoPath, workspaceDir?)` → `ChangeSummary[]` de tous les repos du workspace
  (`resolveWorkspaceRepoPaths`), `changes/*.yaml`.
- `get(repoPath, id)`, `create(repoPath, dto, workspaceDir?)` : type résolu (catégorie `change`),
  composant déduit / contrôlé (nœuds locaux du repo ; nœud submodule → repo du composant via
  `resolveComponentRepoPath`), ID préfixe + `nextCounterId`, statut initial, `persist`.
- `update(repoPath, id, dto)` : composant modifiable seulement au statut initial ; listes dédoublonnées ;
  `persist` (historique GH77 + `applyFieldsWrite` #195).
- `delete(repoPath, id)` : refus si `git.fileHistory` trouve un commit ; sinon `deleteWithTombstone`.
- `reopenedCandidates(repoPath, id)` : exigences et tests du repo du change déjà approuvés
  (`history.status` contient un statut `isApproval` du type, repli `version > 1`) et pas dans un
  statut d'approbation, hors `toModify`.
- Canaux `changes:list|get|create|update|delete|reopened-candidates` (desktop + web
  `channel-policy`), `api.changes.*`.
- Graphe : collection `changes` ; `polenta.d.ts` régénéré.
- MCP : `list_changes`, `get_change`, `create_change` (`mcp-server/tools/changes.tools.ts`).
- Suppression d'un type `change` (`schema-delete`) : ses changes suivent le plan comme les autres
  catégories.

## 3. Renderer

- Sprint 2 : barre d'activité « Changements » (`Panel` `changes`), panneau `ChangesPanel` (liste
  workspace par repo, filtres type / statut / repo / mes changes / masquer terminés, « Nouveau
  change ») ; routes `change.new` (formulaire, `?element=` pour pré-remplir) et `change.$changeId`
  (en-tête, statut, champs `DynamicField`, `ChangeToModifyList`, `ChangeImpactedList`, historique) ;
  éditeur de schéma : catégorie `change`, statuts par défaut ; couleurs de catégorie ;
  `NoTypeForCategory`.
- Sprint 3 : « Créer un change » dans `EditView` et pages de détail ; e2e ; revue ; SPEC.

## 4. Décisions

- Service et fichiers calqués sur les campagnes (même `persist`, historique, pierres tombales).
- Liste workspace côté main (un appel) plutôt que N appels du renderer.
- Le statut d'impact est une donnée saisie en L2 ; L3 ajoutera calcul et complétude sans changer le
  format.
