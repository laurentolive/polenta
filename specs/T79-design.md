# T79 — Design technique

## Fichiers à modifier / créer

| Fichier | Action |
|---|---|
| `apps/desktop/src/main/services/git.service.ts` | Ajout `getIntegrationBranch(repoPath: string): Promise<string>` — lit `config/project.yaml` du repo (`readYaml` déjà présent), fallback `'main'` si absent/erreur |
| `apps/desktop/src/main/services/action.service.ts` | `readIntegrationBranch` (privé) délègue à `this.gitService.getIntegrationBranch(repoPath)` au lieu de dupliquer la lecture YAML — dédup, comportement inchangé (`ActionService` reçoit déjà `GitService` en constructeur) |
| `apps/desktop/src/main/ipc/index.ts` | Nouveau handler `ipcMain.handle('baseline:get-integration-branch', (_e, repoPath) => c.git.getIntegrationBranch(repoPath))` — namespace `baseline:*` plutôt que `git:*` ou `workspace:*` : seul consommateur actuel est la validation de création de baseline (cf. décision technique 1) |
| `packages/api-client/src/types.ts` | `ApiClient.baseline` : ajout `getIntegrationBranch(repoPath: string): Promise<string>` |
| `packages/api-client/src/ipc-client.ts` | Wiring : `getIntegrationBranch: (p) => invoke('baseline:get-integration-branch', p)` |
| `apps/desktop/src/renderer/routes/baseline.tsx` | Réécriture partielle : résolution `workspaceDir`/`flatNodes` via `useWorkspaceStructure` (comme `VersionPanel`), nouvelle section "État des repos" avant le formulaire de création, construction de `dto.components` + `workspaceDir` dans `createMutation`, vérification d'unicité du tag étendue à tous les repos |

Aucun changement dans `apps/desktop/src/main/services/baseline.service.ts` ni dans le handler
`baseline:create` (`ipc/index.ts` lignes 327–355) : ils gèrent déjà correctement `workspaceDir` et
`dto.components` — le seul chaînon manquant est côté appelant (`baseline.tsx`).

## Nouveaux types / interfaces

Aucun nouveau type partagé. `CreateBaselineComponentDto` / `CreateBaselineDto` /
`BaselineComponentRecord` / `BaselineRecord` (déjà dans `packages/api-client/src/types.ts`)
suffisent tels quels.

`ApiClient.baseline` gagne une méthode :
```ts
baseline: {
  list(repoPath: string): Promise<BaselineRecord[]>
  get(repoPath: string, tag: string): Promise<BaselineRecord | null>
  create(repoPath: string, dto: CreateBaselineDto, workspaceDir?: string): Promise<BaselineRecord>
  getIntegrationBranch(repoPath: string): Promise<string>   // nouveau
}
```

## Décisions techniques

1. **Namespace `baseline:get-integration-branch` plutôt qu'un nouveau namespace `git:*` ou
   `workspace:*`.** La valeur est repoPath-scoped comme `sync:*`/`schema:*`, mais son seul
   consommateur aujourd'hui est la validation de création de baseline. Créer un namespace
   générique pour un unique appelant serait prématuré (YAGNI, même logique que la décision 4 du
   design T78 qui rejette l'anticipation d'un besoin futur) — si une future vue "Paramètres
   projet" a besoin d'afficher/éditer `integrationBranch`, elle pourra promouvoir ce channel à ce
   moment-là.

2. **`GitService.getIntegrationBranch` plutôt que dupliquer dans `BaselineService`.** La lecture
   de `config/project.yaml` → `integrationBranch` (fallback `'main'`) existe déjà dans
   `ActionService.readIntegrationBranch` (méthode privée, logique identique à ce dont T79 a
   besoin). Remonter cette logique dans `GitService` — déjà injecté dans `ActionService` et déjà
   propriétaire de tous les accès `readYaml`/`writeYaml` du repo — évite la duplication sans
   introduire de dépendance croisée nouvelle (`ActionService` a déjà `GitService` en
   constructeur). *Alternative rejetée* : ajouter la méthode directement dans `BaselineService` —
   rejetée, `BaselineService` ne connaît aujourd'hui que `.polenta/baselines.yaml` et n'a pas
   `GitService` en dépendance ; l'ajouter uniquement pour ce besoin duplique une lecture qui
   existe déjà ailleurs dans le container.

3. **Résolution des repos en défaut : `useQueries` sur `flatNodes`, même pattern que
   `useWorkspaceStructure.schemaQueries`.** Pour chaque nœud (root inclus), deux requêtes
   parallèles :
   - `['sync:status', node.repoPath]` → `api.sync.status(node.repoPath)` (déjà utilisé par
     `VersionRepoFolder`, react-query dédup le cache donc pas de double appel si le panneau
     Version est ouvert en parallèle)
   - `['baseline:integration-branch', node.repoPath]` → `api.baseline.getIntegrationBranch(node.repoPath)`

   Un repo est en défaut si `status.branch !== integrationBranch` ou
   `staged.length + unstaged.length > 0`. Pas de polling (`refetchInterval`) sur ces deux
   requêtes côté page Baseline — contrairement au panneau Version qui reste ouvert en continu,
   cette page est consultée ponctuellement pour créer une baseline ; un bouton "Rafraîchir"
   explicite (invalidation des deux query keys) suffit, cohérent avec le fait que la page
   n'affiche cet état que le temps d'une création.

4. **Vérification d'unicité du tag sur tout le workspace : `useQueries` sur
   `['sync:tags', node.repoPath]` pour chaque nœud.** Remplace l'actuel
   `useQuery(['sync:tags', repoPath])` scopé au root uniquement. `mainTagValid` devient
   `!flatNodes.some(n => (tagsByRepoPath.get(n.repoPath) ?? []).includes(mainTag.trim()))` en plus
   de la vérification existante contre `baselines` (liste des baselines déjà enregistrées, qui
   reste scopée au root — c'est le seul repo qui stocke `.polenta/baselines.yaml`).

5. **`dto.components` construit à la volée dans `createMutation`, pas dans un state séparé.**
   `flatNodes.filter(n => n.repoPath !== repoPath).map(n => ({ name: n.name, tag: mainTag.trim(),
   createTag: true }))` — même tag pour tous les repos (cohérent avec le comportement déjà
   implémenté côté handler `baseline:create`, qui tague chaque nœud avec `dto.tag`, pas avec
   `dto.components[i].tag` : le nom de tag est donc nécessairement uniforme sur tout le workspace,
   ce n'est pas une option ouverte par ce ticket). *Alternative rejetée* : permettre un tag
   différent par composant — rejetée, le handler main process ne le supporte pas aujourd'hui
   (utilise systématiquement `dto.tag` pour créer chaque tag git) et le ticket ne demande pas de
   changer ce comportement ; le champ `tag` de `CreateBaselineComponentDto` sert uniquement à
   peupler `BaselineRecord.components[i].tag` pour l'affichage, pas à piloter la création.

6. **Nouvelle section "État des repos" au-dessus du formulaire existant**, dans la colonne
   gauche de `baseline.tsx` (avant le bloc "Tag repo principal"). Une ligne par `flatNodes`
   (nom, branche courante, branche d'intégration attendue, badge ✓/✗ modifications en attente) —
   reprend le vocabulaire déjà utilisé dans `VersionRepoFolder` (badge ambre = modifications en
   attente) pour la cohérence visuelle avec le panneau Version. Repos en défaut mis en évidence
   (texte rouge/ambre + raison courte : "sur `feature/x`, attendu `integration`" ou
   "modifications en attente"). Le bouton "Créer la baseline" est désactivé si la liste des repos
   en défaut est non vide, en plus des conditions déjà existantes (`mainTagValid`).

7. **Cas mono-repo inchangé.** Quand `flatNodes` ne contient que le root (pas de workspace multi-
   repo), la section "État des repos" affiche une seule ligne — comportement strictement
   équivalent à aujourd'hui, `dto.components` reste `[]` (le `.filter(n => n.repoPath !==
   repoPath)` ne retient rien).

8. **Pas de nouveau composant fichier pour la ligne de statut repo.** `RepoReadinessRow` reste une
   fonction locale dans `baseline.tsx`, à côté de `BaselineItem` déjà défini dans ce fichier —
   cohérent avec l'organisation actuelle du fichier (petit composant self-contained, pas de
   réutilisation prévue ailleurs).

9. **Message post-création si un composant a échoué à être tagué** (cas rare : race condition
   entre la validation et la création réelle, ou permission/lock git). Le handler
   `baseline:create` avale déjà l'erreur par composant (log + continue, cf. `ipc/index.ts`
   lignes 341–344) — comportement conservé tel quel (ne pas faire échouer toute la création pour
   un seul composant). Après succès, si `record.components.length` est inférieur au nombre de
   nœuds hors-root attendus, un message d'avertissement non bloquant s'affiche ("N composant(s)
   n'ont pas pu être tagués — vérifier les logs"). Pas de retry automatique dans ce sprint.

## Sprint

Tient en **un seul sprint**. Le périmètre reste une extension mécanique de patterns déjà en place
(`useWorkspaceStructure`, `useQueries` pour agréger un statut par repo — déjà utilisé dans ce même
hook — et un handler main process déjà correctement écrit pour T69 sprint 3 mais jamais alimenté).
Le seul ajout de logique métier réellement nouveau est le calcul "repo en défaut" (comparaison
branche courante / attendue + dirty) et son affichage bloquant — taille comparable à T78 (sprint
unique validé pour une réécriture de section similaire de `baseline.tsx`/panneau Version
consommant `useWorkspaceStructure`).
