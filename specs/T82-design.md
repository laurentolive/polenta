# T82 — Design

## Vue d'ensemble

Un seul mécanisme partagé (`propagatePinToDependents`, nouvelle fonction dans
`workspaceActions.ts`) répond aux deux déclencheurs de la spec : il retrouve, parmi tous
les repos du workspace (`flatNodes`), ceux dont le `polenta-repo.yaml` déclare une
dépendance `{ name, url }` correspondant au repo concerné, et réécrit leur `pin` — en
réutilisant `addDependency()` (déjà capable de "corriger le pin d'une entrée existante",
rebuild + rollback sur diamond-conflict, T70). Ce mécanisme est appelé à quatre points
d'entrée existants (checkout branche/tag, nouveau checkout par commit, commit dans
`VersionRepoFolder`, "Publier" dans `ModificationControl`) — aucune vraie récursion n'est
codée : la cascade vers les grands-parents émerge du fait que committer un repo mis à jour
par ce mécanisme redéclenche le même hook.

## Fichiers à modifier

### Nouveau

- **`apps/desktop/src/renderer/lib/workspaceActions.ts`** — ajoute :
  - `PinPropagationOutcome` (type) et `propagatePinToDependents()` (fonction), voir
    §Nouvelles interfaces.

### Modifiés

- **`packages/api-client/src/types.ts`** — corrige `sync.commit(repoPath, message):
  Promise<string>` en `Promise<{ sha: string }>` : la forme déclarée est fausse
  aujourd'hui (l'IPC handler `sync:commit` renvoie directement ce que
  `SyncService.commit()` renvoie côté main, soit `CommitResult = { sha, message,
  timestamp }`, jamais une simple chaîne — cf. `apps/desktop/src/main/ipc/index.ts:132`
  et `sync.service.ts:169`). Cette correction est nécessaire pour lire `.sha` en toute
  sécurité côté renderer ; seul `sha` est consommé, pas besoin d'exposer `message`/
  `timestamp` au renderer.

- **`apps/desktop/src/renderer/components/sidebar/VersionPanel.tsx`** — destructure
  `workspaceDir` (déjà une variable locale, `decodeProjectId(projectId)`) et `flatNodes`
  (déjà renvoyé par `useWorkspaceStructure`, non utilisé actuellement dans ce fichier) et
  les passe en nouvelles props à `VersionRepoFolder`.

- **`apps/desktop/src/renderer/components/sidebar/version/VersionRepoFolder.tsx`** :
  - Nouvelles props `workspaceDir: string` et `flatNodes: WorkspaceTreeNode[]`, propagées
    telles quelles aux instances enfants (`node.children.map(...)`) — valeur identique à
    toutes les profondeurs, pas de calcul par nœud.
  - `checkoutMutation` (checkout branche/tag existant) : `onSuccess` appelle
    `propagatePinToDependents(workspaceDir, flatNodes, { name: node.name, url: node.url
    }, name)` (où `name` est la réf checkoutée, déjà l'argument de la mutation) en plus
    de `invalidateBranchState()`.
  - Nouvelle mutation `checkoutCommitMutation` : `mutationFn: (sha) =>
    api.sync.checkoutCommit(repoPath, sha)`, même `onSuccess` (invalidation +
    `propagatePinToDependents(..., sha)`), passée à `BranchCombobox` comme nouvelle prop
    `onCheckoutCommit`. Réutilise `checkoutConfirm`/`handleCheckout` pour la garde de
    modifications en attente (même style que le checkout de branche/tag — le champ SHA
    passe par la même fonction `handleCheckout`, qui route déjà vers la confirmation si
    `staged`/`unstaged` ne sont pas vides).
  - `commitMutation` : `mutationFn` renvoie désormais `res.sha` (après correction du type
    ci-dessus) ; `onSuccess` appelle en plus `propagatePinToDependents(workspaceDir,
    flatNodes, { name: node.name, url: node.url }, sha)`.
  - Nouvel état local `pinWarning: string | null` (ou une petite liste), affiché sous les
    sections concernées quand `PinPropagationOutcome.conflicted` ou `.failed` est non
    vide — texte distinct des erreurs `checkoutMutation.isError`/`commitMutation.isError`
    existantes (cf. spec, CA 11-12).

- **`apps/desktop/src/renderer/components/sidebar/version/BranchCombobox.tsx`** :
  - Nouvelle prop `onCheckoutCommit: (sha: string) => void`.
  - Nouvel item fixe dans le pied de la liste déroulante, à côté de "Nouvelle branche…" :
    "Checkout un commit…" → révèle un petit champ texte (mono, placeholder `sha…`) avec
    validation de forme minimale (regex `/^[0-9a-f]{7,40}$/i`, même règle que
    `WorkspaceTreeService.repoExistsAtPin`) avant d'activer le bouton de validation — pas
    de résolution réseau préalable, un SHA invalide ou inexistant échoue simplement au
    checkout (`api.sync.checkoutCommit` rejette), affiché via l'erreur existante du
    combobox appelant. Miroir du bloc `showCreate`/`newName` déjà présent pour la
    création de branche (même style, `useState` local, `Escape`/Entrée).

- **`apps/desktop/src/renderer/components/layout/ModificationControl.tsx`** :
  - `publishMutation` a déjà accès à `useModificationMode()` qui expose `flatNodes`
    (indirectement — voir note ci-dessous, à exposer en plus dans le retour du hook) et
    peut obtenir `workspaceDir` via `project?.workspaceDir` (déjà résolu en interne par
    `useModificationMode`, mais pas renvoyé aujourd'hui — à ajouter à
    `ModificationModeState`).
  - `onSuccess` : si `result.success`, en plus de la suite existante (checkout
    intégration, suppression de la branche `dev-*`), appelle
    `propagatePinToDependents(workspaceDir, flatNodes, { name: <mount name du repo
    concerné>, url: <url> }, result.sha)` — utilise le SHA du **merge**
    (`MergeResult.sha`), pas celui du commit intermédiaire sur `dev-*` (qui disparaît
    avec la branche supprimée juste après). Le "mount name"/"url" du repo concerné ne
    sont pas retrouvés en cherchant "un parent" mais en cherchant l'entrée de
    `flatNodes` dont `repoPath === repoPath` courant (le nœud se décrit lui-même).
  - Nouvel état `pinWarning` similaire à `VersionRepoFolder`, affiché dans le bandeau si
    la propagation échoue partiellement.

- **`apps/desktop/src/renderer/hooks/useModificationMode.ts`** — expose en plus
  `workspaceDir` et `flatNodes` dans `ModificationModeState` (déjà calculés en interne
  via `project?.workspaceDir` et `useWorkspaceStructure`, juste pas renvoyés
  aujourd'hui).

### Explicitement non modifiés

- **`SyncBar.tsx`** (`project.$id.tsx`) — toujours root-only en pratique aujourd'hui ;
  root n'a jamais de repo dépendant (personne ne le déclare comme dépendance), donc
  brancher `propagatePinToDependents` ici serait un no-op garanti nécessitant du
  plumbing (workspaceDir/flatNodes) inutile tant que ce composant reste scopé au root. À
  ajouter si `SyncBar` est un jour pointé sur un repo non-root.
- **`graph.tsx`** — root-only également (voir spec, §Hors scope) ; le nouveau checkout
  par commit d'un composant vit dans `BranchCombobox`, pas ici.
- **`api.sync.createBranch`/`createBranchAt`** — jamais câblés sur
  `propagatePinToDependents` (cf. spec, §Note technique : éviter le bruit du flux "Faire
  une modification" de T83).
- **`WorkspaceTreeService`, `addDependency()`, `DiamondConflictModal`** — réutilisés sans
  modification.

## Nouvelles interfaces

```ts
// workspaceActions.ts

/** Result of propagating a pin update to every dependent repo found in the workspace. */
export interface PinPropagationOutcome {
  /** Dependent repo names whose pin was successfully written (pending, uncommitted). */
  updated: string[]
  /** Dependent repo names where the write was rolled back due to a diamond-conflict. */
  conflicted: string[]
  /** Dependent repo names where the manifest write itself failed, with the error. */
  failed: { name: string; error: string }[]
}

/**
 * Finds every repo in `flatNodes` whose polenta-repo.yaml declares `target` (by name+url)
 * as a dependency, and rewrites its pin to `newPin` via addDependency() — reusing its
 * existing "correct an existing entry" path, its rebuild, and its diamond-conflict
 * rollback. Never touches `target`'s own repo. Best-effort per dependent: one failure
 * doesn't stop the others (mirrors renameDependency's cascade).
 */
export async function propagatePinToDependents(
  workspaceDir: string,
  flatNodes: WorkspaceTreeNode[],
  target: { name: string; url: string },
  newPin: string,
): Promise<PinPropagationOutcome>
```

Implémentation (esquisse) :

```ts
export async function propagatePinToDependents(
  workspaceDir: string, flatNodes: WorkspaceTreeNode[],
  target: { name: string; url: string }, newPin: string,
): Promise<PinPropagationOutcome> {
  const outcome: PinPropagationOutcome = { updated: [], conflicted: [], failed: [] }
  for (const node of flatNodes) {
    if (node.name === target.name) continue
    try {
      const manifest = await api.polentaRepo.get(node.repoPath).then((m): PolentaRepoManifest => m ?? {})
      const dep = (manifest.dependencies ?? []).find(d => d.name === target.name && d.url === target.url)
      if (!dep || dep.pin === newPin) continue
      const result = await addDependency(workspaceDir, node.repoPath, { ...dep, pin: newPin })
      if (result.status === 'diamond-conflict') outcome.conflicted.push(node.name)
      else if (result.status === 'ok') outcome.updated.push(node.name)
      // parse-error/cycle on an unrelated rebuild edge case: surfaced as failed, not silently dropped
      else outcome.failed.push({ name: node.name, error: `Statut inattendu : ${result.status}` })
    } catch (err) {
      outcome.failed.push({ name: node.name, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return outcome
}
```

## Décisions techniques et alternatives rejetées

1. **Un seul mécanisme de recherche pour les deux déclencheurs**, au lieu de faire porter
   le parent direct par les props de récursion de `VersionRepoFolder` (option
   initialement envisagée dans la première version de la spec). Rejetée : elle traite
   mal le cas d'une dépendance partagée (checkout d'une interface référencée par deux
   composants — seul le parent visuel aurait été mis à jour) et duplique une logique de
   recherche déjà nécessaire pour la cascade. Le balayage `flatNodes` + lecture manifeste
   est légèrement plus coûteux (quelques lectures fichier de plus par checkout/commit)
   mais les workspaces sont plafonnés à une dizaine de repos (cf. mémoire projet) — coût
   négligeable, pas de cache nécessaire.

2. **Pas de vraie récursion codée.** Alternative rejetée : après avoir écrit le pin d'un
   dépendant, tenter immédiatement de "committer" ce dépendant pour continuer la cascade
   automatiquement plus haut. Rejetée explicitement par la spec (« aucun stage ni commit
   automatique, à quelque niveau que ce soit ») — chaque niveau reste une action
   utilisateur distincte, le mécanisme se contente d'être appelé au bon endroit à chaque
   fois qu'un commit se produit réellement.

3. **`createBranch` volontairement exclu.** Alternative rejetée : câbler
   `propagatePinToDependents` sur toute mutation qui change la réf courante, y compris la
   création de branche. Rejetée : T83 crée une branche `dev-*` à chaque "Faire une
   modification", ce qui aurait proposé un pin vers cette branche éphémère à chaque
   déclenchement — bruit systématique, contraire à l'esprit "modification en attente
   pertinente" de la spec.

4. **SHA du merge, pas du commit intermédiaire, pour "Publier".** `ModificationControl`
   committe sur `dev-*` puis merge dans la branche d'intégration : proposer le SHA du
   commit intermédiaire serait pointer vers un commit qui n'est plus atteignable par
   aucune branche une fois `dev-*` supprimée (juste après, dans le même flux) — un pin
   orphelin. `MergeResult.sha` (déjà renvoyé par `mergeInto`) est le seul SHA
   durablement valide.

5. **`SyncBar`/`graph.tsx` non modifiés**, cf. §Fichiers "Explicitement non modifiés" —
   pas de plumbing pour un cas garanti no-op aujourd'hui (root-only).

6. **Best-effort par dépendant, jamais bloquant.** Aligné sur le précédent de
   `renameDependency` (T74 sprint 2) : un échec d'écriture sur un dépendant ne doit pas
   empêcher la mise à jour des autres.

## Sprints

**Un seul sprint.** Le périmètre est contenu : une fonction pure nouvelle
(`propagatePinToDependents`, ~25 lignes, entièrement réutilisée sur `addDependency`
existant), un correctif de type (`sync.commit`), un ajout d'UI limité (champ SHA dans un
combobox existant) et du branchement (`onSuccess`) à quatre points d'entrée déjà
existants. Aucune nouvelle vue, aucun nouveau service main-process, aucune migration de
données.
