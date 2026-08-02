# T135-design — Drag & drop dans l'arbre Structure

Lit `specs/T135.md`. Découpe la feature en 3 sprints (justification en fin de document) et détaille
les fichiers/interfaces touchés par sprint.

## Découverte clé (change le risque estimé dans T135.md)

`RequirementsService`/`TestsService` résolvent le repo physique d'un élément via
`SchemaService.resolveComponentRepoPath(repoPath, objectTypeRef, workspaceDir)`
(`schema.service.ts:375`) : ça ne renvoie un repo **différent** que si `nodeName` (partie avant
`::`) correspond au nom d'un **repo mounté** dans l'arbre workspace (`WorkspaceTreeNode`, construit
par `WorkspaceTreeService` — root + dépendances `polenta-repo.yaml`). Pour un **composant local**
(`SystemNode` pur, sans repo propre), cette recherche échoue toujours (les composants locaux ne
sont jamais des `WorkspaceTreeNode`) et l'appelant retombe sur `?? repoPath` — le repo déjà connu
du contexte UI, qui est toujours celui qui héberge physiquement le `schema.yaml` du composant
local, à n'importe quelle profondeur.

**Conséquence** : déplacer un `ElementLeaf` d'un nœud vers un autre nœud **du même repo** (root vers
un composant local, ou entre deux composants locaux du même repo, à n'importe quelle profondeur)
ne bouge **aucun fichier physique** — seule la définition dans `schema.yaml` change de nœud, et
chaque `requirements/<ID>.yaml`/`tests/<ID>.yaml` existant garde son emplacement, juste son champ
`objectTypeRef` (une chaîne) doit être réécrit. Déplacer un `ElementLeaf` vers un nœud qui **est**
un repo mounté différent (le "root" d'un `RepoRow`) impliquerait en revanche de déplacer les
fichiers eux-mêmes entre deux repos Git distincts — nettement plus lourd.

Ça réduit le risque du point 8/9 de T135.md pour le cas majoritaire (même repo), et isole
précisément le cas réellement complexe (cross-repo) plutôt que de le supposer partout.

## Découpage en 3 sprints

### Sprint 1 — Drag & drop de réordonnancement (remplace les boutons ↑/↓), même parent uniquement

Périmètre : `ElementLeaf`, `RepoRow`, `LocalNodeRow` — glisser-déposer pour changer l'ordre parmi
les frères actuels, sans jamais changer de parent. Couvre entièrement la décision "remplacement,
pas ajout" de T135.md, et donne à `LocalNodeRow` sa première capacité de réordonnancement
(aujourd'hui inexistante). Aucun risque de fichier cassé — le parent ne change jamais.

**État de drag partagé.** `ReorderableSidebarSection.tsx` garde `draggingId`/`dropTarget` en
`useState` local car il n'y a qu'une seule liste plate. L'arbre Structure a plusieurs listes
imbriquées à toute profondeur — l'état de drag (id/kind de l'élément traîné, cible de survol
courante) doit vivre dans `StructureTab` (au même niveau que `selection`/`editingNode`, etc.) et
être transmis à chaque ligne via `StructureTreeHandlers`, pas en `useState` local à chaque ligne.

```ts
// Nouveau dans StructureTreeHandlers
interface DragState {
  kind: 'element' | 'component' | 'local'
  repoPath: string       // repo qui héberge la définition traînée
  nodeName: string       // nœud parent actuel (element) — ignoré pour component/local
  key: string            // identité stable : typeIndex pour element, node.name pour component/local
}
dragging: DragState | null
dropTarget: { key: string; position: 'before' | 'after' } | null
onDragStart: (state: DragState) => void
onDragOverRow: (key: string, position: 'before' | 'after') => void
onDropRow: () => void   // lit `dragging`/`dropTarget` déjà en state, pas de paramètres
onDragEnd: () => void
```

**Fichiers/fonctions :**

- `packages/types/src/schema-tree.ts` — nouvelle fonction générique
  `moveArrayIndex<T>(arr: T[], from: number, to: number): T[]` (insertion à une position
  arbitraire, pas juste un swap adjacent comme `moveUp`/`moveDown` actuels) — remplace
  `withObjectTypesReordered` (qui ne fait que ±1) par une variante basée sur un index cible.
- `apps/desktop/src/renderer/components/schema/StructureTab.tsx` :
  - `ElementLeaf` : retire les boutons ↑/↓ et `canMoveUp`/`canMoveDown`/`onMoveUp`/`onMoveDown` ;
    ajoute `draggable`, `onDragStart`, `onDragOver`, `onDrop`, `onDragEnd`, indicateur avant/après
    (repris de `ReorderableSidebarSection`).
  - `RepoRow` : retire les boutons ↑/↓ (`siblingIndex`/`siblingCount` restent, utilisés pour
    l'indicateur de position pendant le drag) ; ajoute les mêmes handlers de drag sur la ligne
    d'en-tête (hors les autres boutons d'action, `stopPropagation` déjà en place pour eux).
  - `LocalNodeRow` : ajoute `draggable` + handlers de drag sur sa ligne d'en-tête (nouveau —
    n'avait ni boutons ni drag avant ce ticket).
  - `handleMoveElement`/`handleMoveComponent` remplacés par `handleReorderElement`/
    `handleReorderComponent`/`handleReorderLocalComponent` (nouveau, pour `LocalNodeRow`), chacun
    appelé depuis un unique `onDropRow` générique qui dispatche selon `dragging.kind`.
- `apps/desktop/src/renderer/lib/workspaceActions.ts` — `moveDependency` (swap adjacent) remplacé
  par `reorderDependency(workspaceDir, parentRepoPath, name, toIndex)` (insertion à une position
  arbitraire dans `manifest.dependencies[]`).
- `apps/desktop/src/renderer/i18n/locales/{en,fr}.json` — retrait de
  `schema.structureTab.moveUp`/`moveDown` si plus référencées ailleurs (vérifier
  `objectTypeEditor.tsx`, qui a son propre usage de `moveUp`/`moveDown` pour les champs/statuts
  d'un type — **ne pas toucher**, hors périmètre de ce ticket).

### Sprint 2 — Changement de parent pour `RepoRow` et `LocalNodeRow`

Périmètre : glisser un composant/interface monté ou un composant local vers un autre nœud
"dossier" de l'arbre. Pas de risque sur `objectTypeRef` — déplacer un `RepoRow`/`LocalNodeRow` ne
renomme jamais le nœud déplacé, donc les `objectTypeRef` de ses propres éléments (et de tout son
sous-arbre) restent valides tels quels. Reste uniquement une restructuration de
`schema.yaml`/`polenta-repo.yaml`.

- **`LocalNodeRow` → nouveau parent (composant local, ou promotion/rétrogradation au niveau
  racine)** : nouvelle fonction dans `schema-tree.ts` :
  ```ts
  export function isDescendant(nodes: SystemNode[], ancestorName: string, candidateName: string): boolean
  export function moveSystemNode(
    nodes: SystemNode[], name: string, toParentName: string | null, toIndex: number,
  ): SystemNode[]
  ```
  `moveSystemNode` retire le nœud `name` (avec tout son sous-arbre `children`) de sa position
  actuelle et le réinsère dans `children[]` de `toParentName` (ou au niveau racine si `null`) à
  `toIndex`. Rejette (no-op) si `toParentName === name` ou `isDescendant(nodes, name,
  toParentName)` — anti-cycle (point 15 de T135.md). `StructureTab.handleMoveLocalComponentToParent`
  appelle cette fonction puis `saveSchema`, comme les autres mutations de schéma de ce fichier.
- **`RepoRow` → nouveau parent** : réutilise `removeDependency` (sans supprimer le dossier
  physique — nouveau paramètre ou variante `deleteLocalFolder: false` déjà supporté) suivi de
  `addDependency` sur le nouveau parent, avec `localParent` posé si la cible est un composant
  local (même valeur que ce que "+ Composant" depuis une `LocalNodeRow` pose déjà). **Point
  d'attention** : `removeDependency` nettoie aussi `schema.implements` du parent SOURCE si le
  dépendance déplacée était déclarée comme interface implémentée — `addDependency` seul ne
  recrée pas cette déclaration sur le nouveau parent. `moveDependencyToParent` (nouvelle fonction
  dans `workspaceActions.ts`) doit lire `implements` du parent source *avant* `removeDependency`,
  et le réécrire sur le nouveau parent après `addDependency` si un rôle existait — sans quoi un
  déplacement fait perdre silencieusement le rôle d'interface joué. Exécution séquentielle (pas
  `Promise.all`) — les deux appels font chacun leur propre `rebuildTree`, qui écrit le même
  fichier de cache workspace (cf. l'avertissement déjà présent sur
  `propagatePinToDependents`).
- UI : `RepoRow`/`LocalNodeRow` deviennent des cibles de dépôt valides (survol prolongé de leur
  ligne d'en-tête, pas seulement avant/après une ligne frère) quand l'élément traîné est lui-même
  un `RepoRow`/`LocalNodeRow`. Highlight visuel distinct du trait avant/après (ex. anneau/fond sur
  toute la ligne) pour signaler "devient parent" plutôt que "devient frère".

### Sprint 3 — Changement de parent pour `ElementLeaf`, cascade `objectTypeRef`

Périmètre : glisser un type (exigence/test/campagne) vers un autre nœud, **restreint aux nœuds du
même repo** (cf. découverte clé ci-dessus) — dropper un `ElementLeaf` sur le `root` d'un `RepoRow`
d'un **autre** repo n'est **pas offert comme cible valide** dans ce ticket (aucune surbrillance de
zone de dépôt) : ça impliquerait de déplacer les fichiers `requirements/`/`tests/` eux-mêmes entre
deux repos Git distincts, hors périmètre — ticket séparé si demandé.

- **Mutation schéma** : nouvelle fonction (schema-tree.ts ou directement dans `StructureTab.tsx`,
  à trancher en Dev) déplaçant un `ObjectTypeDefinition` de `objectTypes[]` d'un nœud vers celui
  d'un autre, dans le **même** `ProjectSchema` (même repo).
- **Cascade `objectTypeRef`** : nouvelle orchestration côté main process (pas dans le renderer —
  doit rester atomique avec l'écriture du schéma) :
  - `RequirementsService` : ajouter une méthode dédiée `retargetObjectTypeRef(repoPath, oldRef,
    newRef)` (pas via `UpdateRequirementSchema`, qui n'expose pas `objectTypeRef` aujourd'hui — à
    dessein : un déplacement d'arbre n'est pas une édition normale d'exigence, cf. Décision ci-
    dessous). Parcourt `RequirementsIndexService.findAll` filtré sur `objectTypeRef === oldRef`,
    réécrit chaque fichier, `index.upsert`.
  - `TestsService` : `UpdateTestCaseSchema`/`update()` acceptent déjà `objectTypeRef`
    (`tests.service.ts:71`) — la cascade peut réutiliser `update()` tel quel, pas de nouvelle
    méthode nécessaire ici (asymétrie notée, pas à corriger dans ce ticket).
  - Best-effort par fichier (log + continue), même philosophie que la cascade `implements[]` de
    `renameDependency` — un fichier illisible/corrompu ne doit pas bloquer les autres.
  - Nouveau point d'entrée IPC (ex. `schema.moveElementToNode`) orchestrant, dans l'ordre :
    lecture schéma → retrait du type de l'ancien nœud → ajout au nouveau nœud → sauvegarde schéma
    → cascade `requirements`/`tests`. Exposé dans `apps/desktop/src/main/container.ts` (et
    potentiellement `mcp-server/container.ts` si les tools MCP doivent aussi exposer ce
    déplacement — **à trancher en Dev**, T135.md ne le demande pas explicitement côté MCP).
- UI : seuls les nœuds du **même repo** que l'élément traîné s'illuminent comme cible de dépôt
  valide ; les `RepoRow` d'autres repos (et leurs composants locaux) restent visuellement neutres
  pendant ce drag précis.

## Décisions

1. **`retargetObjectTypeRef` en méthode dédiée, pas via le DTO d'update public.** Exposer
   `objectTypeRef` dans `UpdateRequirementSchema` permettrait à n'importe quel appelant (UI
   normale, tool MCP) de réassigner arbitrairement une exigence à un type sans rapport — un
   déplacement d'arbre est un événement système déclenché uniquement par ce drag, pas une édition
   de champ ordinaire. Asymétrie avec `TestsService` (qui l'expose déjà) notée mais pas corrigée —
   changer `TestsService` rétroactivement est hors périmètre de ce ticket.
2. **Drop cross-repo pour `ElementLeaf` non offert, pas juste "déconseillé".** Le distinguo
   "même repo (léger) / autre repo (lourd)" trouvé pendant ce Design n'était pas visible depuis
   T135.md — retenu comme restriction dure du Sprint 3 plutôt que comme option supplémentaire à
   développer, pour ne pas rouvrir le périmètre déjà large de ce ticket. Cross-repo reste une
   piste pour un ticket séparé si demandé explicitement.
3. **État de drag centralisé dans `StructureTab`**, pas répliqué par ligne comme
   `ReorderableSidebarSection` — nécessaire dès qu'un dépôt peut cibler une branche différente de
   l'arbre (Sprints 2-3), pas seulement les sprint 1 (réordonnancement local aurait pu se
   contenter d'un état par sous-liste, mais autant poser la bonne architecture dès le sprint 1
   pour ne pas la refaire au sprint 2).
4. **`RepoRow`/`LocalNodeRow` : pas de nouvelle vérification de collision de nom** — déjà garanti
   unique sur tout l'arbre (workspace + local), un déplacement ne renomme rien (cf. T135.md points
   12/16).

## Impacts / fichiers touchés (récapitulatif)

| Sprint | Fichiers principaux |
|---|---|
| 1 | `StructureTab.tsx`, `schema-tree.ts` (`moveArrayIndex`), `workspaceActions.ts` (`reorderDependency`), locales |
| 2 | `StructureTab.tsx`, `schema-tree.ts` (`moveSystemNode`, `isDescendant`), `workspaceActions.ts` (`moveDependencyToParent`) |
| 3 | `StructureTab.tsx`, `schema-tree.ts` ou nouvelle fonction schema, `requirements.service.ts` (`retargetObjectTypeRef`), `tests.service.ts` (réutilise `update`), `container.ts`, éventuellement `mcp-server/container.ts` |

## Alternatives rejetées

- **Librairie de drag & drop externe** (dnd-kit, react-beautiful-dnd) — le codebase a déjà un
  pattern natif HTML5 fonctionnel (`ReorderableSidebarSection.tsx`, T77) ; l'arbre Structure ajoute
  la dimension "changement de parent" mais pas de besoin d'accessibilité/perf qui justifierait une
  dépendance supplémentaire.
- **Un seul sprint pour tout le périmètre** — rejeté : le risque (cascade `objectTypeRef`,
  cross-repo, anti-cycle, perte silencieuse de rôle d'interface) est concentré dans des sous-
  parties distinctes et indépendantes (réordonnancement pur vs. changement de parent composant vs.
  changement de parent élément) ; découper permet de valider/merger le Sprint 1 (déjà une vraie
  amélioration, faible risque) sans attendre que le Sprint 3 (le plus complexe) soit terminé.
