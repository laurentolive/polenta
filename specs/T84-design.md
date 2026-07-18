# T84 — Design technique

## Fichiers à modifier

| Fichier | Action |
|---|---|
| `apps/desktop/src/main/services/sync.service.ts` | `merge()` (L487-512) et `mergeInto()` (L514-533) : dans le bloc `catch`, extraire les chemins de fichiers réellement en conflit depuis l'erreur isomorphic-git au lieu de renvoyer `conflicts: []`. `MergeResult` simplifié : `conflicts: string[]` au lieu de `conflicts: YamlConflict[]` (cf. décision technique 1). Suppression de l'interface `YamlConflict` (dead type, jamais peuplé, cf. décision technique 1). |
| `apps/desktop/src/main/ipc/index.ts` | Handlers `sync:merge` (L180-185) et `sync:merge-into` (L186-190) : suppression du mapping `result.conflicts.map(c => c.filePath)`, devenu un no-op maintenant que `conflicts` est déjà `string[]` côté service — passthrough direct de `result`. |
| `apps/desktop/src/renderer/components/layout/ModificationControl.tsx` | Popup "Publication impossible" (L257-278) : affiche la liste des chemins de `publishError` (nouvel état, cf. ci-dessous) sous le message générique. Le bouton "Résolution manuelle (Version)" navigue vers `/version-diff` avec `repoPath`/`ref1`/`ref2` du repo concerné, au lieu de `/graph` sans contexte. |
| `apps/desktop/src/renderer/routes/graph.tsx` | **Aucun changement.** Le merge manuel (`mergeMut`/`mergeIntoMut`, L321-345) affiche déjà `` `Conflits de merge : ${result.conflicts.join(', ')}` `` — une fois `sync.service.ts` corrigé, ce message montre la vraie liste sans modification de ce fichier. Vérifié manuellement (scénario 4 de `T84-tests.md`), pas juste supposé. |
| `packages/api-client/src/types.ts` | **Aucun changement.** `MergeResult` y est déjà typé `{ success: false; conflicts: string[] }` (L201-203, avec un commentaire l'anticipant explicitement : "the renderer has no use for the full YAML diff objects") — le contrat de fil est déjà correct, seul le service main-process ne le respectait pas en pratique. |
| `specs/SPEC-TECH-stack.md` §6 | Dernier sprint : remplacer la "vision cible T84" (résolution champ par champ) par le comportement réellement livré (liste de fichiers + lien contextualisé, pas de résolution assistée). |
| `specs/SPEC-FORKS-BRANCHES-BASELINES.md` §2.4 | Dernier sprint : même correction — l'exemple d'UI champ par champ ("Conflit sur SW-0042…") requalifié comme hors périmètre, pas "vision cible T84". |

## Détail des changements

### 1. `SyncService.merge`/`mergeInto` — extraction des fichiers en conflit

isomorphic-git lève `MergeConflictError` avec `err.data = { filepaths, bothModified, deleteByUs,
deleteByTheirs }` (`node_modules/isomorphic-git/index.js:3745-3757`) — `filepaths` est déjà l'union
de toutes les catégories (signature du constructeur : `(filepaths, bothModified, deleteByUs,
deleteByTheirs)`). Le catch actuel jette cette donnée :

```ts
// avant
} catch (err: unknown) {
  if (err instanceof Error && err.message.includes('MergeConflictError')) {
    return { success: false, conflicts: [] }
  }
  throw err
}
```

```ts
// après
} catch (err: unknown) {
  if (err instanceof Error && err.message.includes('MergeConflictError')) {
    const filepaths = (err as { data?: { filepaths?: string[] } }).data?.filepaths ?? []
    return { success: false, conflicts: filepaths }
  }
  throw err
}
```

Même correctif dans `merge()` et `mergeInto()` (deux blocs catch identiques aujourd'hui).

### 2. `ModificationControl` — liste de fichiers + deep-link

`publishError` (actuellement `string | null`) devient une petite structure portant le message et la
liste de fichiers :

```ts
const [publishError, setPublishError] = useState<{ message: string; files: string[] } | null>(null)
```

```ts
onSuccess: async (result) => {
  if (result.success) { /* inchangé */ }
  else {
    setPublishError({
      message: 'Quelqu’un a modifié les mêmes informations — résolution manuelle nécessaire.',
      files: result.conflicts,
    })
  }
}
```

Rendu (remplace le paragraphe unique L260) :
```tsx
<p className="text-xs text-ink-2 mb-2">{publishError.message}</p>
{publishError.files.length > 0 && (
  <ul className="text-xs font-mono text-ink-2 mb-4 list-disc list-inside">
    {publishError.files.map(f => <li key={f}>{f}</li>)}
  </ul>
)}
```

Le bouton "Résolution manuelle (Version)" (L265-276) navigue vers `/version-diff` au lieu de
`/graph` :
```ts
navigate({
  to: '/version-diff',
  search: { projectId: currentProjectId ?? '', repoPath, ref1: branch, sha1: undefined, ref2: integrationBranch, sha2: undefined },
})
```
`repoPath`, `branch`, `integrationBranch` sont déjà destructurés de `useModificationMode()` en tête
de composant (L41) — aucune résolution nouvelle. `version-diff.tsx` résout déjà `repoPath`/`ref1`/
`ref2` par nom via `SelectedRepoContext.selectRepo()` + `sync.resolveRefs()`
(`version-diff.tsx:249-257,292-319`), exactement le même mécanisme que `VersionPanel.tsx:64` pour
le bouton diff existant — pas de nouvelle route, pas de nouveau paramètre d'URL à définir.

## Nouveaux types / interfaces

Aucun nouveau type partagé. `MergeResult` (main process, `sync.service.ts`) s'aligne sur celui déjà
déclaré dans `packages/api-client/src/types.ts` :
```ts
export type MergeResult =
  | { success: true; sha: string }
  | { success: false; conflicts: string[] }
```
`YamlConflict` est supprimé de `sync.service.ts` (cf. décision technique 1).

## Décisions techniques

1. **`YamlConflict` (base/ours/theirs/conflictingFields) supprimé plutôt que peuplé avec des
   valeurs vides.** Le handler IPC ne consommait déjà que `.filePath`
   (`result.conflicts.map(c => c.filePath)`) et le type api-client n'exposait déjà que `string[]`
   au renderer, avec un commentaire explicite anticipant cette simplification. Peupler
   `YamlConflict` avec des `base: {}, ours: {}, theirs: {}, conflictingFields: []` factices pour
   satisfaire le type existant serait trompeur (laisse croire qu'une donnée existe alors qu'elle
   est vide) pour un type que rien ne lit. *Alternative rejetée* : garder `YamlConflict[]` et ne
   peupler que `filePath` — rejetée, ajoute un type mort (3 champs jamais renseignés) sans bénéfice
   ; si un futur ticket construit la résolution champ par champ (hors périmètre ici), il
   réintroduira un type avec de vraies données à ce moment-là.
2. **Détection de conflit : `err.message.includes('MergeConflictError')` conservée telle quelle**,
   pas de bascule vers `err instanceof git.Errors.MergeConflictError`. Le check actuel fonctionne
   déjà (T83 l'utilise pour retourner `success: false`) — seule l'extraction de `err.data.filepaths`
   est ajoutée, en accédant à `.data` via un cast optionnel plutôt qu'en changeant le mécanisme de
   détection existant, pour limiter le diff à ce que ce ticket doit réellement changer. Si
   `err.data` s'avère absent en pratique (à vérifier au sprint, cf. `T84-tests.md`), `filepaths` a
   un repli sûr à `[]` (comportement actuel inchangé dans ce cas, pas de régression possible).
3. **`graph.tsx` non modifié.** Son message d'erreur (`Conflits de merge :
   ${result.conflicts.join(', ')}`) consomme déjà `MergeResult.conflicts` tel que typé côté
   api-client — la correction du service suffit à le rendre correct. Vérifié manuellement plutôt que
   supposé (scénario dédié dans `T84-tests.md`), pour ne pas livrer une hypothèse non testée comme
   "corrigée".
4. **Deep-link vers `/version-diff`, pas vers `/graph`.** `/graph` résout `repoPath` en dur sur
   `project.localPath` (root) — aucun paramètre d'URL pour cibler un repo composant
   (`graph.tsx:743`, `validateSearch` sans champ `repo`/`repoPath`). `/version-diff` accepte déjà
   `repoPath`/`ref1`/`ref2` et les résout via `SelectedRepoContext` + `sync.resolveRefs` — c'est la
   vue qui supporte déjà le cas multi-repo dont `ModificationControl` a besoin (un conflit peut
   survenir sur un repo composant ouvert via `?repo=`, pas seulement le root). *Alternative
   rejetée* : ajouter un paramètre `repo` à `/graph` — rejetée, `/graph` est un graphe de commits
   pas un diff, il n'apporte rien de plus que `/version-diff` pour ce cas d'usage (comparer deux
   branches) et étendre son contrat de recherche pour un seul appelant serait disproportionné.
5. **Pas de nouvel état pour retenir "quel repo/branches étaient en conflit" séparément.** Au moment
   où l'utilisateur clique "Résolution manuelle", `repoPath`/`branch`/`integrationBranch` de
   `useModificationMode()` reflètent encore l'état du conflit (aucun checkout n'a lieu en cas
   d'échec de "Publier", cf. décision technique 4 de `T83-design.md`) — pas de risque de
   désynchronisation à gérer, l'effet existant qui ferme les dialogs transitoires au changement de
   `mode` (`ModificationControl.tsx:60-69`) couvre déjà le cas où l'utilisateur checkoute
   manuellement une autre branche pendant que la popup d'échec est affichée.

## Sprint

**Un seul sprint.** Correction ciblée d'un service existant (extraction d'une donnée déjà présente
sur l'erreur, pas de nouvelle primitive git), une popup déjà existante enrichie d'une liste, un
changement de route de navigation vers une vue déjà capable de résoudre repo/branches par nom.
Aucun nouveau composant, aucun nouvel endpoint IPC, aucun nouveau type partagé — taille comparable à
T80 (1 sprint, extension mécanique d'un flux déjà en place) plutôt qu'à T83 (introduction de chrome
global + endpoints nouveaux).
