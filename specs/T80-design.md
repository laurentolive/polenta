# T80 — Design technique

## Fichiers à modifier / créer

| Fichier | Action |
|---|---|
| `apps/desktop/src/renderer/contexts/SelectedRepoContext.tsx` | **Nouveau** — état partagé "repo sélectionné" (`selectedRepoPath` + `selectRepo`), sur le modèle de `VersioningContext.tsx` |
| `apps/desktop/src/renderer/components/layout/AppLayout.tsx` | Monte `SelectedRepoProvider` aux côtés de `VersioningProvider` ; corrige `deducePanel()` pour reconnaître `/version-diff` comme panel `'version'` |
| `apps/desktop/src/renderer/components/sidebar/version/VersionRepoFolder.tsx` | Le clic sur la ligne appelle aussi `selectRepo(node.repoPath)` ; la mise en évidence visuelle se base sur `selectedRepoPath === node.repoPath` (contexte) au lieu de l'actuel `isRoot` statique |
| `apps/desktop/src/renderer/components/sidebar/VersionPanel.tsx` | L'icône "Comparer" ajoute `repoPath: selectedRepoPath` (contexte) aux search params de navigation vers `/version-diff` |
| `apps/desktop/src/renderer/routes/version-diff.tsx` | Consomme `useSelectedRepo()` pour piloter `resolveRefs`/`diffBetween`/`diffFileBetween` ; ajoute `repoPath` à `validateSearch` (amorçage initial uniquement) ; affiche le nom du repo ciblé ; réinitialise Objet A/B et fichier sélectionné au changement de repo |

Aucun changement côté main process / IPC — `api.sync.*` et `api.workspace.*` sont déjà
paramétrés par `repoPath`/`workspaceDir`.

## Correctif prérequis : `deducePanel()` doit reconnaître `/version-diff`

Aujourd'hui (`AppLayout.tsx`) :

```ts
function deducePanel(pathname: string): Panel {
  ...
  if (
    pathname.startsWith('/action/') ||
    pathname === '/graph' ||
    pathname === '/diff' ||
    pathname === '/versioning' ||
    pathname === '/baseline'
  ) {
    return 'version'
  }
  ...
  return 'project'  // ← /version-diff tombe ici, pas reconnu
}
```

`/version-diff` n'est pas listé : la sidebar retombe sur `'project'` (`ProjectPanel`)
quand on navigue vers la page Comparer, donc **`VersionPanel` (et son arbre) n'est
aujourd'hui pas affiché pendant que `/version-diff` est ouverte**. C'est un prérequis
strict du critère d'acceptation 7 de `T80.md` (suivi en direct : l'arbre doit rester
visible en sidebar pendant que la page Comparer est affichée) — sans ce correctif, le
contexte partagé existerait mais son effet ne serait jamais observable dans l'UI.
Corrigé dans le même sprint : ajout de `pathname === '/version-diff'` au groupe qui
retourne `'version'`.

## Nouveaux types / interfaces

```ts
// SelectedRepoContext.tsx
interface SelectedRepoContextValue {
  selectedRepoPath: string
  selectRepo: (repoPath: string) => void
}
```

Pas de nouveau type partagé dans `@polenta/types` — état purement renderer.

## Décisions techniques

1. **Le contexte ne porte que `repoPath`, pas de nom affichable.** Chaque consommateur
   résout le nom d'affichage depuis les données d'arbre qu'il a déjà sous la main :
   `VersionRepoFolder` a `node.name` localement ; `version-diff.tsx` résout le nom via
   `useWorkspaceStructure(workspaceDir, rootRepoPath).flatNodes.find(n => n.repoPath ===
   selectedRepoPath)?.name`. Évite de synchroniser deux sources de vérité (repoPath +
   name) et le besoin de transporter le nom dans l'URL ou dans le contexte.
   *Alternative rejetée* : stocker `{ repoPath, name }` dans le contexte, réglé par
   `selectRepo(repoPath, name)` — rejeté, `VersionRepoFolder` a toujours `node.name`
   sous la main au moment du clic donc ça marcherait pour ce cas, mais l'amorçage
   depuis l'URL (`repoPath` seul, pas de nom) devrait quand même résoudre le nom
   séparément — autant centraliser cette résolution dans `version-diff.tsx`.

2. **`rootRepoPath` calculé en interne dans `SelectedRepoProvider`**, via la même
   `queryKey: ['workspace', currentProjectId]` que `VersioningProvider`/`VersionPanel`
   — react-query déduplique, aucun appel réseau supplémentaire (même raisonnement que
   T78-design décision 1). `selectedRepoPath = selection ?? rootRepoPath` où
   `selection` est `null` tant que l'utilisateur n'a pas cliqué sur un repo dans
   l'arbre — retombe donc naturellement sur le root par défaut (critère 3).

3. **Réinitialisation au changement de projet.** `SelectedRepoProvider` remet
   `selection` à `null` (retombe sur le nouveau root) quand `currentProjectId` change
   — même règle que T78 pour l'état d'ouverture des dossiers : pas de persistance
   cross-projet ni cross-session (`localStorage` non utilisé).

4. **Portée de montage : dès qu'un projet est ouvert**, comme `VersioningProvider` —
   pas seulement quand le panel `'version'` est actif. Nécessaire : la sélection doit
   survivre si l'utilisateur bascule sur un autre panel (ex. Projet) après avoir
   sélectionné un composant, puis revient sur Version ou navigue directement vers
   `/version-diff` — la sélection ne doit pas se perdre pour autant.

5. **Réinitialisation des refs au changement de repo, sans écraser l'amorçage
   initial depuis l'URL.** Deux effets distincts dans `version-diff.tsx` :

   - Un effet d'amorçage (une fois), qui applique `search.repoPath` au contexte s'il
     diffère du repo courant, *avant* que le suivi de changement ne s'arme :
     ```ts
     const seededRepoRef = useRef(false)
     useEffect(() => {
       if (seededRepoRef.current) return
       if (!selectedRepoPath) return // root pas encore résolu
       if (repoPath && repoPath !== selectedRepoPath) {
         selectRepo(repoPath)
         return // attend le prochain rendu avec le contexte à jour
       }
       seededRepoRef.current = true
     }, [selectedRepoPath, repoPath])
     ```
   - Un effet de suivi, actif seulement après amorçage, qui réinitialise
     sha1/sha2/selectedFile dès que `selectedRepoPath` change *par rapport à sa valeur
     précédemment observée* :
     ```ts
     const prevRepoRef = useRef<string | null>(null)
     useEffect(() => {
       if (!seededRepoRef.current) return
       if (prevRepoRef.current === null) { prevRepoRef.current = selectedRepoPath; return }
       if (prevRepoRef.current !== selectedRepoPath) {
         prevRepoRef.current = selectedRepoPath
         setSha1(undefined); setSha2(undefined); setSelectedFile(null)
       }
     }, [selectedRepoPath])
     ```
   Sans cette séparation, la première résolution asynchrone du root
   (`'' → rootRepoPath`) ou l'amorçage depuis l'URL déclencherait une réinitialisation
   non désirée des refs qu'on vient tout juste de seeder depuis `ref1`/`sha1`/`ref2`/
   `sha2`.

6. **`repoPath` d'URL : amorçage uniquement, jamais réécrit.** Même traitement que
   `ref1`/`sha1`/`ref2`/`sha2` aujourd'hui : consulté une fois au montage pour
   initialiser le contexte partagé, jamais resynchronisé vers l'URL quand la sélection
   change en direct depuis l'arbre. Cohérent avec le fait que sha1/sha2 eux-mêmes ne
   sont jamais reportés dans l'URL aujourd'hui — pas de nouvelle divergence de
   comportement introduite.

7. **Repo sélectionné non résolvable** (supprimé du workspace, `repoPath` d'URL
   invalide) : pas de garde spécifique au-delà de l'existant — `sync.resolveRefs`
   renverra une liste vide, les combobox afficheront "Aucun résultat", le nom résolu
   depuis `flatNodes` sera `undefined` (affichage d'un fallback plutôt que de planter,
   ex. le `repoPath` brut tronqué). Cohérent avec T78-design décision 9.

8. **Mise en évidence dans l'arbre.** `VersionRepoFolder` reçoit `selectedRepoPath` et
   `selectRepo` via `useSelectedRepo()` (pas de prop-drilling supplémentaire depuis
   `VersionPanel`, cohérent avec le fait que chaque `VersionRepoFolder` est déjà
   autonome pour ses propres queries/mutations). La classe de mise en évidence
   actuelle (`text-blue-500 dark:text-blue-400`, appliquée via `isRoot`) est appliquée
   via `node.repoPath === selectedRepoPath` à la place. `isRoot` reste utilisé tel
   quel pour son unique autre usage (`if (isRoot) refetchVersioning()` dans
   `invalidateBranchState`), sans lien avec la sélection.

## Sprint

Tient en **un seul sprint**. Les deux moitiés de la fonctionnalité (sélection dans
l'arbre, et page Comparer qui la consomme) ne forment un livrable cohérent qu'ensemble
— livrer l'une sans l'autre ne serait pas testable ni utile. Périmètre comparable à
T78 (un contexte de plus, quatre fichiers existants touchés, un correctif d'une ligne
dans `deducePanel`), pas de nouvelle capacité métier au-delà de ce que la spec décrit.
