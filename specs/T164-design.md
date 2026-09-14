# T164 — Design technique

## Principe

Un nouvel état partagé **`gotoNodeId`** dans `SystemViewContext`, posé par `ElementTree` au
clic simple / au drop, consommé par `WordView` et `ExcelView` qui :
1. `scrollIntoView` la ligne / carte / en-tête portant `data-node-id={gotoNodeId}` ;
2. lui appliquent une classe de **contour persistant** (distincte de la surbrillance de
   sélection existante).

Aucune API backend, aucun changement de route, aucun changement de `viewMode`.

Réutilise la mécanique déjà présente ailleurs (`containerRef.current.querySelectorAll(...)`
dans `StaticRichTextViewer` / `ExcelView`) : un `useEffect` + `querySelector` + `scrollIntoView`.

---

## 1. `SystemViewContext` — état `gotoNodeId` + `requestGoto`

`apps/desktop/src/renderer/contexts/SystemViewContext.tsx`

Ajouts à `SystemViewState` :

```ts
/** Nœud d'arbre (item ou folder) sur lequel la vue document doit se positionner
 *  (scroll + contour persistant). null = aucun. Posé au clic simple / au drop dans
 *  l'arbre ; remis à null au clic dans le vide de l'arbre, au changement de
 *  composant/type, et à l'entrée en Vue Édition. */
gotoNodeId: string | null
/** Compteur incrémenté à chaque requestGoto — permet à la vue de re-scroller même
 *  quand la cible est identique à la précédente (re-clic, re-drop du même nœud). */
gotoSeq: number
requestGoto: (nodeId: string) => void
clearGoto: () => void
```

Implémentation dans le provider :

```ts
const [goto, setGoto] = useState<{ nodeId: string | null; seq: number }>({ nodeId: null, seq: 0 })
const requestGoto = useCallback((nodeId: string) => setGoto(g => ({ nodeId, seq: g.seq + 1 })), [])
const clearGoto   = useCallback(() => setGoto(g => (g.nodeId === null ? g : { nodeId: null, seq: g.seq + 1 })), [])
```

Réinitialisation sur changement de contexte — dans l'effet `useEffect(..., [treeData])`
existant (celui qui gère `resetRoot` sur `isKeyChange`), ajouter dans la branche
`if (isKeyChange)` :

```ts
if (isKeyChange) {
  resetRoot(treeData.root ?? [])
  setGoto({ nodeId: null, seq: 0 })
}
```

> **Alternative rejetée** : garder l'état `goto` local à `SystemView` (à côté de `viewMode`).
> Impossible sans lever un callback jusqu'à `ElementTree`, qui est monté par `SystemPanel`
> (sibling de `SystemView` sous le même provider) — le contexte est déjà le canal
> `SystemPanel ⇄ SystemView`, on s'y greffe.

---

## 2. `SystemView` — relais vers Word/Excel, garde `viewMode`

`apps/desktop/src/renderer/components/system/SystemView.tsx`

- Récupère `gotoNodeId`, `gotoSeq`, `clearGoto` du contexte (déjà `const { … } = useSystemView()`).
- **No-op en Édition** : l'effet existant `useEffect(() => { if (editingNodeId !== null) setViewMode('edit') }, [editingNodeId])` — y ajouter `clearGoto()`. Ainsi, entrer en Édition
  (double-clic, icône, `navigateToObject`) efface toute cible *goto* → au retour en Word/Excel
  on repart de zéro (spec CU8).
- Passe aux deux vues, uniquement hors Édition (ceinture + bretelles) :

  ```tsx
  <ExcelView … gotoNodeId={viewMode === 'edit' ? null : gotoNodeId} gotoSeq={gotoSeq} />
  <WordView  … gotoNodeId={viewMode === 'edit' ? null : gotoNodeId} gotoSeq={gotoSeq} />
  ```

  (`viewMode === 'edit'` n'arrive jamais ici puisque ces blocs sont sous
  `viewMode === 'excel' | 'word'` — la garde est défensive et documente l'intention.)

- `CampaignListView` : **non concerné** (hors scope T164).

---

## 3. `ElementTree` — déclenchement du *goto*

`apps/desktop/src/renderer/components/system/ElementTree.tsx`

Nouvelle prop :

```ts
onGoto?: (nodeId: string | null) => void
```

Câblage :

| Endroit | Modif |
|---|---|
| `handleSelect` | Dans la **branche clic simple sans modificateur** uniquement (après `onSelect([nodeId])`, juste avant le `return` implicite) → `onGoto?.(nodeId)`. Les branches `e.shiftKey` et `e.ctrlKey/metaKey` `return` avant → pas de *goto* en multi-sélection (spec CU4). Vaut pour un `item` comme pour un `folder` (spec CU5). |
| `handleClickEmpty` | Après `onSelect([])` → `onGoto?.(null)`. |
| `handleDrop` | À la toute fin (après `onRootChange(newRoot)`, avant `setDraggingIds([])`) → `onGoto?.(ids[0] ?? null)` — `ids` est déjà dans l'ordre de l'arbre ; le 1er nœud déplacé (item ou folder) sert de cible (spec CU6). Ne rien faire dans les branches no-op (drop sur soi-même, drop invalide) — elles `return` déjà avant. |

`handleKeyDown` (flèches ↑/↓) : **inchangé** — pas de `onGoto` (spec : hors scope clavier).

> **Note** : `handleSelect` est un `useCallback` — ajouter `onGoto` à ses deps.

---

## 4. `SystemPanel` — passe-plat

`apps/desktop/src/renderer/components/sidebar/SystemPanel.tsx`

- Récupère `requestGoto`, `clearGoto` du contexte.
- `<ElementTree … onGoto={(id) => (id ? requestGoto(id) : clearGoto())} />`.
- `CampaignNavList` : inchangé.

---

## 5. `WordView` — `data-node-id`, contour, scroll

`apps/desktop/src/renderer/components/system/WordView.tsx`

### Props

```ts
gotoNodeId?: string | null
gotoSeq?: number
```

### Conteneur scrollable + effet

Le `<div className="flex-1 overflow-auto">` (racine du `return`, ~L833) reçoit un
`containerRef` (nouveau `useRef<HTMLDivElement>(null)`).

```ts
useEffect(() => {
  if (!gotoNodeId || !containerRef.current) return
  const el = containerRef.current.querySelector<HTMLElement>(
    `[data-node-id="${CSS.escape(gotoNodeId)}"]`,
  )
  el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}, [gotoNodeId, gotoSeq])
```

### `data-node-id` + classe de contour

- **En-tête de dossier** (`<HeadingTag key={node.id} …>` ~L772) : ajouter
  `data-node-id={node.id}` et, si `gotoNodeId === node.id`, la classe de contour.
- **`ItemCard`** : nouvelle prop `isGotoTarget?: boolean` ; sur son `<div>` racine (~L433)
  ajouter `data-node-id={node.id}` et la classe de contour conditionnée par `isGotoTarget`.
  Le `renderNodes(...)` (closure dans `WordView`) passe `isGotoTarget={gotoNodeId === node.id}`.
  → `renderNodes` doit voir `gotoNodeId` : soit le lire directement (closure OK puisque
  `renderNodes` est défini dans le corps de `WordView`), soit l'ajouter en paramètre. Closure
  suffit.

### Classe de contour

Token proposé : `ring-2 ring-inset ring-status-info-solid` (Word : carte `ItemCard` a déjà
`border border-edge rounded` → un `ring` intérieur ne casse pas le layout). À valider visuellement.
Distinct de la sélection Excel (`bg-status-info-bg`, fond plein).

---

## 6. `ExcelView` — `data-node-id`, contour, scroll

`apps/desktop/src/renderer/components/system/ExcelView.tsx`

### Props

```ts
gotoNodeId?: string | null
gotoSeq?: number
```

### Effet de scroll

`containerRef` existe déjà (`<div ref={containerRef} className="flex-1 overflow-auto …">` L1386).

```ts
useEffect(() => {
  if (!gotoNodeId || !containerRef.current) return
  containerRef.current
    .querySelector<HTMLElement>(`[data-node-id="${CSS.escape(gotoNodeId)}"]`)
    ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}, [gotoNodeId, gotoSeq])
```

### `data-node-id` + contour

- **Ligne élément** (`<tr>` ~L1579) : `data-node-id={node.id}` ; classe conditionnelle
  `gotoNodeId === node.id` → contour. La `<tr>` a déjà un slot classe (`[...].filter(Boolean)`).
  Attention : `dropInside` y met déjà `outline outline-1 outline-status-info` — le *goto*
  utilise un style plus marqué, p. ex. `outline outline-2 outline-offset-[-2px]
  outline-status-info-solid`, pour rester lisible même sur une ligne sélectionnée (`bg-status-info-bg`).
- **Ligne de groupe / dossier** (`GroupRow`) : nouvelle prop `isGotoTarget?: boolean` ;
  ajouter `data-node-id={node.id}` sur son `<tr>` (~L547) et la classe de contour si
  `isGotoTarget`. L'appelant (~L1537) passe `isGotoTarget={gotoNodeId === node.id}`.

### Piège `scrollIntoView` + colonnes figées

Les cellules figées (`position: sticky`) n'empêchent pas `scrollIntoView` de fonctionner sur
la `<tr>` (le scroll vertical n'est pas concerné par le sticky horizontal). RAS.

---

## Récap fichiers modifiés

| Fichier | Nature |
|---|---|
| `contexts/SystemViewContext.tsx` | + `gotoNodeId`/`gotoSeq`/`requestGoto`/`clearGoto` dans state & value ; reset sur `isKeyChange` |
| `components/system/SystemView.tsx` | consomme le contexte ; `clearGoto()` à l'entrée en Édition ; passe `gotoNodeId`/`gotoSeq` à Word/Excel |
| `components/system/ElementTree.tsx` | + prop `onGoto` ; appels dans `handleSelect` (clic simple), `handleClickEmpty`, `handleDrop` |
| `components/sidebar/SystemPanel.tsx` | passe `onGoto` à `ElementTree` |
| `components/system/WordView.tsx` | + props `gotoNodeId`/`gotoSeq` ; `containerRef` ; effet scroll ; `data-node-id` + contour sur `ItemCard` (+ prop `isGotoTarget`) et en-têtes de dossier |
| `components/system/ExcelView.tsx` | + props `gotoNodeId`/`gotoSeq` ; effet scroll ; `data-node-id` + contour sur `<tr>` élément et `GroupRow` (+ prop `isGotoTarget`) |

Aucun nouveau fichier. Aucun changement de type partagé (`@polenta/types`). Aucun IPC.

---

## Nouvelles interfaces / types

Uniquement les 4 champs ajoutés à `SystemViewState` (§1) et les props `onGoto` /
`gotoNodeId` / `gotoSeq` / `isGotoTarget` locales aux composants concernés.

---

## Décisions techniques & alternatives rejetées

1. **Contexte plutôt qu'état local `SystemView`** — cf. §1, le canal `SystemPanel ⇄ SystemView`
   passe déjà par le contexte.
2. **`gotoSeq` (compteur)** plutôt qu'un simple `string | null` : sans lui, re-cliquer /
   re-droper le même nœud ne re-scrollerait pas (dépendance d'effet inchangée). Le contour
   (rendu, pas effet) ne dépend que de `gotoNodeId`.
3. **`querySelector([data-node-id])` + `scrollIntoView`** plutôt qu'une `Map<id, ref>` : moins
   invasif (pas de `forwardRef` sur `ItemCard`/`GroupRow` mémoïsés), aligné sur le pattern
   déjà utilisé dans le fichier pour les images / popovers.
4. **Pas de dépliage auto** d'un dossier replié pour atteindre un `item` enfoui (spec) —
   `querySelector` renvoie `null`, effet no-op, aucun risque.
5. **No-op Édition géré à deux niveaux** : `clearGoto()` à l'entrée en Édition **et** garde
   `viewMode === 'edit' ? null : …` au passage de prop. Le premier suffit fonctionnellement ;
   le second documente et protège d'un futur refactor.
6. **Navigation clavier non câblée** : maintenir le *goto* sur chaque ↑/↓ provoquerait des
   scrolls en rafale pendant une navigation au clavier. Hors scope (spec).
7. **`navigateToObject` (T37) inchangé** : il bascule en Édition et pose `pendingNavObjectId` ;
   `clearGoto()` à l'entrée en Édition suffit à éviter toute interaction parasite.

---

## Découpage en sprints

**Un seul sprint.** Le changement est transverse mais mécanique, sans dépendance ordonnée :
le contexte + le câblage `ElementTree`/`SystemPanel` d'abord, puis les deux vues. ~6 fichiers,
pas de migration de données, pas d'IPC, typecheck seul comme garde-fou automatique.

---

## Refs SPEC

- `SPEC-SYSTEM-VIEW.md` §« Arbre › Sélection », §« Arbre › Drag & Drop », §« Vue document »,
  §« Vue Excel », §« Vue Word » — à mettre à jour en fin de sprint (le *goto* nuance le
  « la sélection dans l'arbre n'a aucun impact »).
