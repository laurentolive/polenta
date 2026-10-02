# GH38 — Design technique

## 1. Vue d'ensemble

Refonte purement renderer : aucun nouveau canal IPC, aucun nouveau type dans `@polenta/types`.
Le flux unitaire existant de `ModificationControl.publishMutation` (T87/T154) est extrait tel quel
dans un module, puis appelé en boucle par un orchestrateur multi-repo.

```
clic "Publier" (popup) ─► planPublish()  : statuts live + intégrations + candidats + contrôles
                         ├─ bloqué ?      → PublishBlockedError (rien touché)
                         ├─ fetch(candidats) échoue → PublishNetworkError (rien touché)
                         └─ pour chaque repo, post-ordre (enfants → racine) :
                              status live : rien à publier ? → suivant
                              publishRepo()                    (flux T87/T154 inchangé)
                              propagatePinToDependents()       (T82 — pin écrit dans le parent)
                              push best-effort (non attendu)
```

## 2. Nouveau module `renderer/lib/publishWorkspace.ts`

Fonctions pures (testables sans IPC) :

- `publishOrder(roots: WorkspaceTreeNode[]): WorkspaceTreeNode[]` — post-ordre DFS sur l'arbre
  logique, dédupliqué par `repoPath` (diamant : le nœud partagé est émis à sa première rencontre,
  donc avant chacun de ses parents). Racine en dernier.
- `ancestorRepoPaths(roots, repoPaths: Set<string>): Set<string>` — fermeture transitive des
  parents (carte enfant → parents construite depuis l'arbre logique, gère le diamant).
- `isBlockedBranch(branch, integrationBranch): boolean` — `branch === ''` (HEAD détaché) ou
  `int-*` différente de l'intégration configurée. Même règle que `useModificationMode.mode`.
- `slugify(title)` — déplacé depuis `ModificationControl.tsx`.

Fonctions avec IPC :

- `publishRepo({ repoPath, url, branch, integrationBranch, title, continuingEphemeral,
  onEphemeralCreated })` → `{ sha }` — corps actuel de `publishMutation.mutationFn` **sans le
  fetch** (fait en amont pour tous les candidats). Lève `PublishConflictError(conflicts,
  workBranch, repo)`.
- `publishWorkspace({ workspaceDir, flatNodes, roots, title, ephemeral, onEphemeralChange })` →
  `PublishWorkspaceResult { published: PublishedRepo[], pinOutcome: PinPropagationOutcome }` :
  1. statuts live (`api.sync.status`) + intégration (`api.baseline.getIntegrationBranch`) de
     chaque nœud ; « à publier » = `staged+unstaged > 0` ou reprise d'éphémère
     (`ephemeral.repoPath === repoPath && ephemeral.branch === branch`) ;
  2. candidats = à publier ∪ ancêtres ; aucun → retour vide ;
  3. candidats bloqués → `PublishBlockedError([{ name, branch }])` ;
  4. `api.sync.fetch(repoPath, url)` séquentiel sur chaque candidat ; échec →
     `PublishNetworkError(detail, repoName)` ;
  5. boucle `publishOrder` restreinte aux candidats : re-lecture du statut **live** (le pin
     propagé par un enfant a pu rendre un parent sale), saut si rien à publier, sinon
     `publishRepo` puis `propagatePinToDependents` (outcomes fusionnés).
  6. en fin de publication (succès ou échec) : `reattachPublished` remet sur leur branche
     d'intégration les repos publiés laissés en HEAD détaché par les `rebuildTree` de la
     propagation de pin (cas diamant — découvert en vérification, voir `GH38.md`).
  Une erreur dans la boucle est ré-emballée dans `PublishRepoError(cause, repo, published)` pour
  que l'UI connaisse le repo en échec et les repos déjà publiés.

Les classes d'erreur (`PublishConflictError`, `PublishNetworkError`, `PublishBlockedError`,
`PublishRepoError`) sont déplacées / créées dans ce module.

## 3. `useModificationMode`

Ajoute au retour :
- `tree: WorkspaceTreeNode[]` (déjà fourni par `useWorkspaceStructure`) ;
- `pendingRepos: { name, label, repoPath, count }[]` — `useQueries` sur `['sync:status',
  repoPath]` pour chaque `flatNodes` (même clé/fn que la requête existante → dédupliquée par
  react-query), `refetchInterval: 3000`, filtrée sur `count > 0` ;
- `totalPendingCount` — somme, utilisée pour activer le bouton.

`pendingChangesCount` (repo concerné) est conservé tel quel ; le bouton utilise désormais
`totalPendingCount`.

## 4. `ModificationControl`

- `mutationFn` → `publishWorkspace(...)` ; `pushPublished` pousse chaque repo publié (erreurs
  agrégées, préfixées `nom : …`) — appelé sur succès **et** sur `PublishRepoError` (repos publiés
  avant l'échec) ; `setPinWarning(result.pinOutcome)`.
- `publishError` : nouveau `kind: 'blocked'` (liste `nom (branche)`) ; `conflict` porte
  `repoPath`, `repoName`, `integrationBranch`, `published: string[]` — « Résolution manuelle »
  navigue sur `repoPath` du repo en échec (plus le repo concerné) ; `network` nomme le repo.
- `ephemeralBranch` reste un singleton `{ repoPath, branch }` : la publication s'arrête au premier
  échec, un seul repo peut donc être laissé sur sa branche éphémère.
- Popup titre : liste `pendingRepos` (libellé + nombre de fichiers) + note sur les parents.
  `popupOpenedFor` capture aussi la signature des repos en attente (`repoPath:count` triés) ;
  un changement → `isStalePopup`.
- Après une erreur, `refetch()` + invalidation de `['sync:status']` (tous repos) pour que
  l'état éphémère soit reconnu au prochain essai.

## 5. i18n (fr/en)

Nouvelles clés `layout.modificationControl.*` : `reposToPublish`, `parentsNote`,
`blockedRepos`, `networkErrorRepo`, `failedOnRepo`, `alreadyPublished`, `repoFiles`.

## 6. Spécs de référence à mettre à jour

- `SPEC-FORKS-BRANCHES-BASELINES.md` §2.1 — note « Publication multi-repo (GH38) ».
- `SPEC-ELECTRON-DESKTOP.md` §19.15 — le bouton s'active sur l'ensemble du workspace.
- `SPEC-INDEX.md` — mots-clés `multi-repo`, `GH38` sur la ligne §1–2.

## 7. Découpage

Un seul sprint (renderer uniquement, ~3 fichiers + i18n + spécs).
