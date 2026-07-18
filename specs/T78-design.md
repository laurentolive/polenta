# T78 — Design technique

## Fichiers à modifier / créer

| Fichier | Action |
|---|---|
| `apps/desktop/src/renderer/components/sidebar/VersionPanel.tsx` | Réécrit : devient l'orchestrateur (header inchangé + arbre `useWorkspaceStructure`), délègue le contenu par repo à `VersionRepoFolder` |
| `apps/desktop/src/renderer/components/sidebar/version/BranchCombobox.tsx` | **Nouveau** — extraction sans changement de logique du `BranchCombobox` actuellement défini dans `VersionPanel.tsx` (lignes 16–259), pour être importé par `VersionRepoFolder` sans dupliquer ~250 lignes |
| `apps/desktop/src/renderer/components/sidebar/version/VersionRepoFolder.tsx` | **Nouveau** — composant récursif dossier de repo : ligne fermée (nom, vignette checkout, badge dirty), contenu ouvert (Checkout/Stagés/Modifications + modales), rendu récursif de `node.children` |
| `apps/desktop/src/renderer/components/layout/Sidebar.tsx` | Inchangé — `VersionPanel` garde exactement les mêmes props (`currentProjectId`, `projectId`) |
| `apps/desktop/src/renderer/contexts/VersioningContext.tsx` | Inchangé — reste scopé root uniquement (Lock icon header, gardes d'édition ailleurs dans l'app) |

Aucun changement côté main process / IPC : tous les endpoints `api.sync.*` utilisés sont déjà paramétrés par `repoPath` (cf. [types.ts](../packages/api-client/src/types.ts) §`sync`).

## Résolution de `workspaceDir`

`VersionPanel` ne reçoit aujourd'hui que `currentProjectId`/`projectId` (identiques). Comme
`schema.tsx` ([schema.tsx:362](../apps/desktop/src/renderer/routes/schema.tsx#L362)), on
calcule `workspaceDir = decodeProjectId(projectId)` directement dans `VersionPanel`, sans
changer sa signature ni celle de `Sidebar`. Le `repoPath` du root continue de venir de
`api.workspace.resolve(workspaceDir).localPath` (identique à l'existant), utilisé comme
fallback repo unique par `useWorkspaceStructure` en mode non-workspace et pour repérer
quel nœud de l'arbre est "le root" (mise en évidence par défaut).

```
const { data: project } = useQuery({
  queryKey: ['workspace', currentProjectId],
  queryFn: () => api.workspace.resolve(decodeProjectId(currentProjectId)),
})
const repoPath = project?.localPath ?? ''
const workspaceDir = decodeProjectId(projectId)
const { tree, isLoading, error } = useWorkspaceStructure(workspaceDir, repoPath)
```

## Nouveaux types / interfaces

Aucun nouveau type partagé requis. `VersionRepoFolder` prend en props un
`node: WorkspaceTreeNode` (type existant, [polenta-workspace.ts](../packages/types/src/polenta-workspace.ts))
et `isRoot: boolean` (comparaison `node.repoPath === repoPath` faite une fois dans
`VersionPanel`, passée en descendant plutôt que recalculée à chaque nœud).

```ts
// VersionRepoFolder.tsx
interface Props {
  node: WorkspaceTreeNode
  depth: number
  isRoot: boolean
  projectId: string   // pour la navigation /diff existante (filepath diff)
}
```

## Décisions techniques

1. **Un composant récursif par nœud, entièrement autonome.** `VersionRepoFolder` porte son
   propre `useState(open)`, ses propres queries (`sync:status`, `sync:branches`,
   `sync:tags`, toutes clées par `node.repoPath`) et ses propres mutations
   (checkout/stage/unstage/discard/commit/createBranch/deleteBranch), copiées de
   `VersionPanel` actuel. *Alternative rejetée* : état centralisé dans `VersionPanel` sous
   forme de `Record<repoPath, ...>` — rejetée, complexifie sans bénéfice puisque
   react-query dédup déjà le cache par `queryKey` (donc pas de requêtes dupliquées même
   avec un composant par repo), et chaque ligne est fonctionnellement indépendante — même
   principe que `RepoRow` dans `StructureTab.tsx` qui gère déjà son propre `open` local.

2. **Le badge dirty tourne indépendamment de l'état ouvert/fermé.** La query
   `sync:status` est montée dès que `VersionRepoFolder` est rendu (donc pour tous les
   nœuds de l'arbre dès l'affichage du panneau), pas seulement quand `open === true` —
   seul l'affichage détaillé (listes Stagés/Modifications) est conditionné par `open`.
   Nécessaire pour le critère d'acceptation « badge dirty visible sans ouvrir le dossier ».

3. **Polling** : `refetchInterval: 3000` conservé à l'identique (comportement actuel de
   `VersioningContext`/`VersionPanel`), répliqué par repo. Un workspace typique compte peu
   de repos (root + quelques composants/interfaces) — pas de mutualisation/regroupement
   des requêtes de statut en un seul appel batché : hors scope T78, à revisiter seulement
   si un workspace à fort nombre de composants pose un problème réel de perf.

4. **Mise en évidence du root, pas de "sélection" au sens état partagé.** Le nœud dont
   `node.repoPath === repoPath` (root résolu) reçoit une classe visuelle de mise en
   évidence (fond légèrement teinté, à trancher en revue visuelle — reprend le style déjà
   utilisé pour l'état "current" dans `BranchCombobox`, ex. `text-blue-500`/fond `bg-hover`).
   Aucun contexte React ni state levé dans un `Context` n'est introduit pour cette sélection
   : T78 n'a aucune action qui en dépend en dehors de l'affichage. *Alternative rejetée* :
   créer dès maintenant un contexte "repo sélectionné" partagé pour anticiper T80 (qui
   devra faire suivre `version-diff.tsx` au repo sélectionné) — rejeté (YAGNI), T80 est un
   ticket séparé qui spécifiera lui-même l'interaction et le mécanisme de state dont il a
   besoin.

5. **`BranchCombobox` extrait à l'identique.** Copié tel quel dans son propre fichier
   (`version/BranchCombobox.tsx`), sans changement de logique ni de props — seul son
   import change côté appelant.

6. **Modales locales, pas de portail global partagé.** Modale de commit, confirmation de
   checkout avec modifications en attente, confirmation de discard (fichier / tout) sont
   rendues dans le sous-arbre JSX de chaque `VersionRepoFolder` ouvert, avec leur state
   local (`useState`) — garantit qu'ouvrir une modale sur un repo n'affecte pas un autre
   dossier ouvert en parallèle (critère d'acceptation 4).

7. **Suppression du bouton "Publier".** Simple retrait du bloc JSX correspondant
   (placeholder désactivé `T30-E`, lignes 584–595 de l'actuel `VersionPanel.tsx`) — décidé
   en phase Spec, sera réintroduit avec une vraie logique par T83.

8. **Header inchangé.** Titre "Version", icônes Baselines/Historique/Comparer (navigation),
   `Lock` (readonly) restent au niveau racine de `VersionPanel.tsx`, non scopés par repo —
   ces écrans (`/baseline`, `/graph`, `/version-diff`) ne deviennent multi-repo qu'avec T79/
   T80, hors scope ici.

9. **Repos non résolvables** (query `sync:status` en erreur — ex. composant déclaré dans
   `polenta-repo.yaml` mais dossier absent sur disque) : `VersionRepoFolder` affiche la
   vignette checkout comme vide (`—`) et aucun badge dirty plutôt que de propager l'erreur
   — cohérent avec le comportement actuel de `VersionPanel` qui ne gère pas explicitement
   les erreurs de `sync.status` (`syncStatus` reste `undefined`, les listes retombent sur
   `[]`).

## Sprint

Tient en **un seul sprint**. La feature reste mécanique : dupliquer par repo une logique
déjà entièrement écrite et testée manuellement (stage/unstage/discard/commit/checkout/
créer-supprimer branche), l'orchestrer via un hook déjà existant (`useWorkspaceStructure`),
et retirer un bouton placeholder. Pas de nouvelle capacité métier introduite. Taille
comparable à T42/T76 (sprint unique validé pour un périmètre similaire de réécriture de
composant sidebar).
