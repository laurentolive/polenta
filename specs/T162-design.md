# T162 — Design technique

## Vue d'ensemble

Un seul booléen par vue — « titres de dossiers affichés » — qui :

1. se configure dans `FieldConfigModal` (⚙️), onglet Excel et onglet Word ;
2. se persiste dans `.{githubaccount}.pref`, dans le même objet que la config des colonnes ;
3. se propage en prop `foldersHidden` (ou `showFolders`) à `ExcelView` / `WordView` ;
4. modifie l'aplatissement des lignes et — côté Excel seulement — restreint le drag & drop.

Tient en **un sprint**.

---

## 1. Persistance — forme du payload

### État actuel

```ts
// packages/api-client/src/types.ts
pref: {
  getFieldVisibility(repoPath, username, typeKey):
    Promise<{ excel: string[]; word: string[]; edit: string[] } | null>
  setFieldVisibility(repoPath, username, typeKey,
    views: { excel: string[]; word: string[]; edit: string[] }): Promise<void>
}
```

`pref.handlers.ts` stocke `views` tel quel sous `fieldVisibility[typeKey]` et relit
`visibility[typeKey] ?? null`. `pref-store.util.ts` fait un simple JSON merge/write.

### Changement

Étendre le type `views` (get **et** set) avec deux booléens optionnels :

```ts
type FieldVisibilityPref = {
  excel: string[]
  word: string[]
  edit: string[]
  /** T162 — titres de dossiers dans la vue Tableau. Absent ⇒ true (affichés). */
  showFoldersExcel?: boolean
  /** T162 — titres de dossiers dans la vue Document. Absent ⇒ true (affichés). */
  showFoldersWord?: boolean
}
```

- `pref.handlers.ts` : élargir la signature du paramètre `views` du handler
  `pref:set-field-visibility` (il stocke déjà l'objet entier — aucune logique à ajouter).
  Le handler `get` renvoie déjà l'objet entier.
- `packages/api-client/src/types.ts` : remplacer le type inline par `FieldVisibilityPref`
  (exporté depuis `@polenta/api-client` ou redéfini localement — suivre le style du fichier,
  qui utilise des types inline ; un `type` nommé local est acceptable).
- `packages/api-client/src/ipc-client.ts` : passe-plat, seul le typage change (les deux
  méthodes transmettent leurs args tels quels).
- **Rétrocompat** : une pref écrite avant T162 n'a pas les clés `showFolders*` ⇒ `?? true`
  au point de lecture. Aucune migration de fichier, aucune réécriture au chargement.

### Points de lecture / écriture — `SystemView.tsx`

Nouveaux états, à côté de `visibleFieldsExcel/Word/Edit` (~ligne 573) :

```ts
const [showFoldersExcel, setShowFoldersExcel] = useState(true)
const [showFoldersWord, setShowFoldersWord] = useState(true)
```

Dans le `useEffect` de dérivation des prefs (~ligne 738, garde `isPrefsPlaceholder` incluse) :

```ts
setShowFoldersExcel(savedPrefs?.showFoldersExcel ?? true)
setShowFoldersWord(savedPrefs?.showFoldersWord ?? true)
```

`savePrefsMutation` (~ligne 979) : élargir le type `views` et **toujours** envoyer les 5
champs. Comme pour les colonnes, chaque handler `handleChange*` reconstruit le payload
complet à partir de l'état courant. Ajouter deux setters analogues :

```ts
const handleChangeShowFoldersExcel = useCallback((show: boolean) => {
  setShowFoldersExcel(show)
  savePrefsMutation.mutate({
    excel: visibleFieldsExcel, word: visibleFieldsWord, edit: visibleFieldsEdit,
    showFoldersExcel: show, showFoldersWord,
  })
}, [visibleFieldsExcel, visibleFieldsWord, visibleFieldsEdit, showFoldersWord, savePrefsMutation])
// idem handleChangeShowFoldersWord
```

⚠️ Les `handleChangeExcel` / `handleChangeWord` / `handleChangeEdit` existants doivent
**aussi** ajouter `showFoldersExcel` / `showFoldersWord` au payload, sinon un changement de
colonnes écrase les booléens à `undefined` sur disque. Idem `onColumnsReorder`
(= `handleChangeExcel`, déjà branché).

`onSuccess` de la mutation fait `qc.setQueryData(['pref-visibility', …], views)` — inclut
maintenant les booléens, cohérent.

---

## 2. `FieldConfigModal` (dans `SystemView.tsx`, ~ligne 74)

### Nouvelles props

```ts
showFoldersExcel: boolean
showFoldersWord: boolean
onChangeShowFoldersExcel: (v: boolean) => void
onChangeShowFoldersWord: (v: boolean) => void
```

### Rendu

Une case à cocher au-dessus de la liste des champs scrollable (après le bloc onglets,
~ligne 184), pilotée par l'onglet courant :

```tsx
const showFolders = tab === 'excel' ? showFoldersExcel : showFoldersWord
const onChangeShowFolders = tab === 'excel' ? onChangeShowFoldersExcel : onChangeShowFoldersWord

<label className="flex items-center gap-2 text-xs text-ink cursor-pointer hover:bg-hover px-1 py-0.5 rounded mb-2 pb-2 border-b border-edge">
  <input type="checkbox" checked={showFolders}
    onChange={e => onChangeShowFolders(e.target.checked)}
    className="h-3 w-3 accent-ink" />
  <span>{t('system.fieldConfig.showFolders')}</span>
</label>
```

(L'onglet « edit » n'existe pas dans ce composant — `ConfigTab = 'excel' | 'word'` — donc
pas de cas à gérer.)

### Bouton « Réinitialiser » (~ligne 257)

Aujourd'hui : `onClick={() => onChangeCurrent(defaultFields)}`. À étendre pour remettre
**aussi** le booléen de l'onglet courant à `true` :

```tsx
onClick={() => { onChangeCurrent(defaultFields); onChangeShowFolders(true) }}
```

### Câblage dans `SystemView` (~ligne 1191)

```tsx
<FieldConfigModal
  …
  showFoldersExcel={showFoldersExcel}
  showFoldersWord={showFoldersWord}
  onChangeShowFoldersExcel={handleChangeShowFoldersExcel}
  onChangeShowFoldersWord={handleChangeShowFoldersWord}
/>
```

Et passer aux vues (~ligne 1213 / 1246) : `foldersHidden={!showFoldersExcel}` /
`foldersHidden={!showFoldersWord}`.

> Choix de nommage : la prop des vues s'appelle **`foldersHidden`** (valeur « anormale »
> = `true`, défaut `false` ⇒ pas besoin de la passer partout ailleurs, ex. tests). Le pref
> et l'UI parlent en « afficher » (`showFolders*`), le composant en « masquer ». Un seul
> point d'inversion, au câblage.

---

## 3. `ExcelView.tsx`

### Prop

```ts
foldersHidden?: boolean   // défaut false
```

### Aplatissement (`flatten`, ~ligne 943)

```ts
function flatten(nodes, depth, parentCollapsed) {
  for (const n of nodes) {
    if (parentCollapsed) continue
    if (!(foldersHidden && n.kind === 'folder')) {
      rows.push({ kind: n.kind, node: n, depth })
    }
    if (n.kind === 'folder') {
      flatten(n.children, depth + 1, foldersHidden ? false : collapsedFolders.has(n.id))
    }
  }
}
```

- `foldersHidden` ⇒ aucune ligne `folder` poussée ; le collapse est ignoré (récursion
  toujours avec `parentCollapsed=false`) ⇒ **tous** les éléments sont listés.
- `depth` reste calculé mais n'est déjà passé qu'à `GroupRow` (les lignes d'item Excel ne
  sont pas indentées aujourd'hui) — rien à changer côté rendu d'item.

### `filteredRows` (~ligne 1341)

La branche `r.kind === 'folder'` devient morte quand `foldersHidden` (aucune ligne folder).
Aucun changement nécessaire ; laisser tel quel (fonctionne aussi si `foldersHidden` bascule
en cours de vie du composant).

### Rendu (~ligne 1535)

La branche `if (kind === 'folder')` → `GroupRow` devient morte quand `foldersHidden`.
Laisser tel quel.

### Drag & drop — restriction « même parent »

Quand `foldersHidden`, toutes les cibles de drop sont des items (aucune ligne folder), donc
`position: 'inside'` ne se déclenche jamais (`targetNode.kind === 'folder'` est faux). Reste
à empêcher les déplacements **inter-dossiers** :

- `handleRowDragOver` (~ligne 1038) : si `foldersHidden` et
  `treeFindParentId(root, draggingNodeId) !== treeFindParentId(root, nodeId)` →
  `setRowDropIndicator(null)` et `return` (pas de ligne indicatrice). Sinon, comportement
  actuel (before/after avec `parentId` de la cible — identique au parent de la source, donc
  le réinsert reste dans le même dossier).
- `handleRowDrop` (~ligne 1059) : garde défensive symétrique — si `foldersHidden` et parents
  différents, abandonner (`setDraggingNodeId(null); setRowDropIndicator(null); return`).
- `dndEnabled` (~ligne 1023) inchangé (`!!onRootChange && !filterLower && !activeColumnFilters`).

`draggingNodeId` est un état ; le comparer dans `handleRowDragOver` est fiable (il est posé
en `dragStart`). Utiliser `treeFindParentId` (déjà importé).

### `colCount` / autres

`colCount` (colSpan de l'état vide) inchangé. `visibleRowIds` (~ligne 1349) se réduit
naturellement aux items — OK.

---

## 4. `WordView.tsx`

### Prop

```ts
foldersHidden?: boolean   // défaut false
```

### `renderNodes` (~ligne 752)

```ts
if (node.kind === 'folder') {
  if (filterLower && !folderHasMatchingDescendant(node)) continue
  if (!foldersHidden) {
    // …push du <HeadingTag>… (inchangé)
  }
  const isCollapsed = foldersHidden ? false : collapsedFolders.has(node.id)
  if (!isCollapsed) result.push(...renderNodes(node.children, depth + 1))
  continue   // (ou restructurer le if/else existant)
}
```

- `foldersHidden` ⇒ pas de heading, collapse ignoré, on descend toujours dans les enfants.
- `depth` continue d'incrémenter (sans effet visible : `ItemCard` ne reçoit pas `depth`).
- Le préfixe de section sur les `ItemCard` vient de `sectionNumbers?.get(node.id)` (prop
  `section`), inchangé ⇒ **numérotation conservée** (critère d'acceptation 4).
- Filtre : `folderHasMatchingDescendant` garde le `continue` qui saute une branche sans
  résultat — utile même titres masqués (évite de parcourir pour rien), sans effet visible.

---

## 5. i18n

`apps/desktop/src/renderer/i18n/locales/fr.json` (~ligne 538, bloc `system.fieldConfig`) :

```json
"showFolders": "Afficher les titres des dossiers"
```

`en.json`, même clé :

```json
"showFolders": "Show folder headings"
```

---

## 6. Fichiers touchés — récapitulatif

| Fichier | Nature |
|---|---|
| `packages/api-client/src/types.ts` | type `FieldVisibilityPref` (get + set) |
| `packages/api-client/src/ipc-client.ts` | typage passe-plat |
| `apps/desktop/src/main/ipc/pref.handlers.ts` | élargir type param `views` |
| `apps/desktop/src/renderer/components/system/SystemView.tsx` | états, prefs, `FieldConfigModal` (props + case + reset), câblage vues |
| `apps/desktop/src/renderer/components/system/ExcelView.tsx` | prop `foldersHidden`, `flatten`, DnD « même parent » |
| `apps/desktop/src/renderer/components/system/WordView.tsx` | prop `foldersHidden`, `renderNodes` |
| `apps/desktop/src/renderer/i18n/locales/fr.json`, `en.json` | clé `system.fieldConfig.showFolders` |
| `specs/SPEC-SYSTEM-VIEW.md` | doc du réglage (dernier sprint) |

---

## 7. Alternatives rejetées

- **Toggle global `localStorage` (par vue, pas par type)** — écarté à la spec : incohérent
  avec la config des colonnes qui est déjà par type/vue/user au même endroit ; obligerait un
  second mécanisme de persistance.
- **Nouvelle clé de pref séparée (`folderVisibility`)** — plus de surface d'API et de points
  de synchro (deux objets à garder alignés au changement de type) pour zéro bénéfice ; les
  booléens vivent naturellement à côté des colonnes de la même vue.
- **Masquer aussi la numérotation de section** — écarté à la spec (réponse utilisateur) :
  la numérotation reste le seul repère de structure une fois les titres retirés.
- **Désactiver tout le DnD quand titres masqués** — écarté à la spec (réponse utilisateur) :
  le réordonnancement intra-dossier reste utile ; seul l'inter-dossiers « à l'aveugle » est
  retiré.
- **Bouton bascule dans la toolbar plutôt que dans ⚙️** — hors demande du ticket
  (« à rajouter sur la roue crantée »).

---

## 8. Découpage

**Sprint unique.** Ordre d'implémentation conseillé :

1. Type de pref + `pref.handlers.ts` + `api-client` (socle).
2. `SystemView` : états + dérivation + mutation + `FieldConfigModal` (case + reset) + i18n.
3. `ExcelView` : `flatten` + rendu (aplatissement visible en premier).
4. `ExcelView` : restriction DnD.
5. `WordView` : `renderNodes`.
6. Typecheck, `/code-review`, tests manuels (`specs/T162-tests.md`).
7. MAJ `SPEC-SYSTEM-VIEW.md` + `SPEC-INDEX.md` colonne MAJ.
