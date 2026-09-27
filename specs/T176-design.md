# T176 — Design : Vue Excel — double-clic / F2, éditeur iso-typographique, curseur au point cliqué, réactivité

Réf. : `specs/T176.md`. Travail sur `main`. **Deux sprints** (§6).

## 1. État actuel (constats code)

- `ExcelView.tsx` (~2 200 lignes) : les lignes d'éléments sont rendues **en ligne** dans le `map` de
  `ExcelView` (pas de composant de ligne) ; cellules `NameCell`, `InlineCell` (texte / enum / multi_enum),
  `RichtextCell` ; cellules liens et étapes écrites directement dans le `map`.
- Sélection de cellule : état `selectedCell` **dans `ExcelView`** → chaque sélection re-rend tout le tableau.
  Aucune cellule n'est mémoïsée et leurs props sont des closures recréées à chaque rendu.
- Clic sur une cellule : remonte à la ligne (`handleRowSelect`, qui appelle `effectiveOnSelect([id])` même si
  la sélection ne change pas → nouveau tableau → re-rendu complet) puis, si la cellule est déjà sélectionnée,
  ouvre l'éditeur (état local `editing` ; pour le richtext, état `activeRichtextEdit` de `ExcelView`).
- Éditeur texte / nom : `<input>` mono-ligne, fond `bg-status-info-bg`, `td` passé en `px-0 py-0` → le texte
  bouge, les `\n` sont supprimés par l'`<input>`.
- Richtext : `RichTextField variant="compact"` déjà iso-typographique ; `autoFocus` → `focus('end')`.
- `ParamRefText` : une référence affiche la **valeur résolue** (longueur ≠ `{nom}`) ; double-clic = ouverture
  du paramètre (`stopPropagation`). `StaticRichTextViewer` : idem pour `[data-param-ref]`.
- Le rendu statique d'un diagramme draw.io (`staticDrawio.ts`) n'a **aucun** geste double-clic.
- Clavier : `handleKeyDown` du conteneur (copier/couper/coller/suppr/Échap), ignoré quand le focus est dans
  un champ de saisie.
- Electron 31 (Chromium 126) : `field-sizing: content` ✓, `document.caretRangeFromPoint` ✓,
  `caretPositionFromPoint` ✗ (Chromium 128).

## 2. Architecture

### 2.1 Store de cellule — `components/system/excelCellStore.ts` (nouveau)

Petit store externe (pas d'état React dans `ExcelView`), fourni par un contexte :

```ts
export type CaretRequest =
  | { kind: 'point'; dx: number; dy: number }   // coordonnées relatives au <td> au moment du double-clic
  | { kind: 'end' }                            // F2

export interface ExcelCellStore {
  getSelected(): { nodeId: string; col: string } | null
  select(cell: { nodeId: string; col: string } | null): void
  subscribe(listener: () => void): () => void
  /** Registre des cellules éditables : une cellule montée s'y inscrit, ExcelView l'appelle (F2). */
  registerEditor(nodeId: string, col: string, open: (caret: CaretRequest) => void): () => void
  requestEdit(nodeId: string, col: string, caret: CaretRequest): boolean  // false si non éditable
}
export function useIsCellSelected(nodeId: string, col: string): boolean   // useSyncExternalStore + sélecteur booléen
export function useCellEditor(nodeId: string, col: string, open: ((c: CaretRequest) => void) | undefined): void
```

- Sélectionner une cellule ne re-rend que la cellule quittée et la cellule sélectionnée (le booléen de
  `useIsCellSelected` ne change que pour elles).
- `ExcelView` : `selectedCell` / `isCellSelected` / `selectCell` remplacés par le store ; ses usages
  (Échap, reset quand la colonne disparaît, clic dans le vide) passent par `store.select(null)`.
- `open` est tenu à jour via une ref (pas de ré-inscription à chaque rendu).

### 2.2 Gestes — toutes les cellules éditables

Chaque cellule éditable :
- `onClick` : `store.select({nodeId, col})` seulement (la remontée à la ligne est inchangée). **Plus
  d'ouverture au 2d clic.**
- `onMouseDown` : `if (e.detail > 1) e.preventDefault()` — pas de sélection de mot native au double-clic.
- `onDoubleClick` : `store.select(...)` puis `open({ kind: 'point', dx, dy })` avec
  `dx = e.clientX - td.left`, `dy = e.clientY - td.top`. Ignoré si la cible est dans `[data-param-ref]`
  (le gestionnaire du paramètre a déjà `stopPropagation`) ou dans `a` (lien).
- `useCellEditor(nodeId, col, open)` pour F2.

Cellules liens et étapes (aujourd'hui JSX en ligne dans le `map`) : **extraites** en `LinkCell` et `StepsCell`
(même rendu, même logique de popover / dépliage) pour pouvoir utiliser les hooks du store. `open` des
popovers (enum, multi_enum, liens) calcule son `rect` depuis la ref du `<td>`.

Ligne de groupe (dossier) : le double-clic sur la cellule du nom renomme (`stopPropagation` pour ne pas
déclencher le `onDoubleClick={onToggle}` du `<tr>`) ; le repli/dépli reste au chevron, à la cellule d'action
et à la cellule de section. **Changement de geste** : aujourd'hui un double-clic n'importe où sur une ligne de
dossier sans colonne `section` la replie — désormais il renomme (si renommage possible).

`handleRowSelect` : ne rappelle pas `effectiveOnSelect` quand la sélection résultante est identique (clic
sans modificateur sur la seule ligne déjà sélectionnée) → le 2d clic d'un double-clic ne re-rend plus rien.

### 2.3 F2 — `ExcelView.handleKeyDown`

```ts
} else if (e.key === 'F2') {
  const cell = cellStore.getSelected()
  if (cell && cellStore.requestEdit(cell.nodeId, cell.col, { kind: 'end' })) e.preventDefault()
}
```
Garde existante conservée : ignoré si le focus est dans un `input`/`textarea`/`select`/`contenteditable`.

### 2.4 Éditeur texte iso-typographique — `components/system/ExcelTextEditor.tsx` (nouveau)

Remplace les `<input>` de `InlineCell` (types texte), `NameCell` et `FolderNameText`.

```tsx
<ExcelTextEditor
  initialValue={value}
  multiline                 // false pour nom d'élément / de dossier
  caret={caretRequest}      // placé une fois au montage
  onCommit={(v) => …}       // Ctrl/Cmd+Entrée, perte de focus (clic extérieur) ; + Entrée si !multiline
  onCancel={() => …}        // Échap
/>
```
- `<textarea>` : `block w-full p-0 m-0 border-0 bg-transparent outline-none resize-none overflow-hidden`,
  police / taille / interligne **hérités** du `<td>` (`font: inherit; line-height: inherit; color: inherit`),
  `white-space: pre-wrap; overflow-wrap: anywhere` (= lecture, `useCellClamp`), `field-sizing: content`
  (hauteur = contenu, sans script).
- Le `<td>` en édition garde **exactement** ses classes de lecture (`px-2 py-1 text-xs text-ink`, largeur,
  fond de ligne / `stickyBg`) + `ring-2 ring-inset ring-status-info` ; seules différences : pas de clamp de
  hauteur ni `truncate` (cellule agrandie au contenu, comme le richtext T169).
- Entrée : retour à la ligne (multi-ligne) / valider (mono-ligne) ; Ctrl/Cmd+Entrée : valider ; Échap :
  annuler ; `blur` : valider. Valider sans modification → pas d'appel `onEdit` (plus d'aplatissement).
- Enum / statut : `<select>` inchangé (liste native), ouvert par `open`.

### 2.5 Curseur au point cliqué — `components/system/excelCaret.ts` (nouveau)

```ts
/** Offset dans la valeur brute correspondant au point (x, y) dans le rendu lecture `container`. */
export function rawOffsetAtPoint(container: HTMLElement, x: number, y: number, rawLength: number): number
```
- `document.caretRangeFromPoint(x, y)` → `(node, offset)` ; si hors de `container` ou null → fin du texte si
  le point est sous / à droite du texte, sinon 0.
- Parcours `TreeWalker` des nœuds texte de `container` en comptant les longueurs ; un nœud dans
  `[data-param-ref]` compte pour la longueur de la **référence brute** (`data-param-raw`, ajouté par
  `ParamRefText`) ; un point à l'intérieur d'une référence se cale avant / après selon la moitié la plus proche.
- Cellule vide (« — ») → 0.

Déroulé (texte / nom) : au double-clic, la cellule calcule l'offset **sur le rendu lecture encore monté**
(avant de passer en édition) puis monte l'éditeur avec `caret = { offset }` ; `ExcelTextEditor` fait
`focus()` + `setSelectionRange(offset, offset)` dans un `useLayoutEffect` (pas de flash du curseur en fin).
F2 → `offset = value.length`.

Écart inévitable : une référence `{nom}` affiche sa valeur en lecture et `{nom}` en édition (T171) — le texte
autour d'une référence peut donc se décaler à l'entrée en édition ; le curseur reste au bon caractère.

Richtext : `RichTextField` gagne une prop
```ts
/** T176 — position initiale du curseur : 'end' (défaut actuel) ou une fonction évaluée une fois l'éditeur
 *  monté, qui renvoie des coordonnées client (le <td> a pu défiler entre-temps). */
initialCaret?: 'end' | (() => { left: number; top: number } | null)
```
Au montage : `editor.view.posAtCoords(coords)` → `editor.commands.focus(pos)` ; `null` / hors contenu →
`focus('end')`. `RichtextCell` passe `() => ({ left: td.left + dx, top: td.top + dy })` lu **après** son
`scrollIntoView`. Le rendu lecture compact et l'éditeur compact partagent la typographie (T169) : la position
correspond. À hauteur max 1 (lecture = 1re ligne brute + `¶`), le point tombe dans la 1re ligne de l'éditeur —
« au plus proche » (spec §2.3).

Draw.io : le rendu statique n'ayant pas de geste double-clic (constat §1), un double-clic sur un diagramme dans
une cellule en lecture **entre en édition** (curseur près du diagramme) ; dans l'éditeur, le geste du nœud
draw.io s'applique. Écart assumé avec spec U14 (partie draw.io) — à corriger dans `T176.md`.

### 2.6 Réactivité (sprint 2)

Après le store (sprint 1, déjà un gain : sélection de cellule sans re-rendu global, 2d clic sans effet) :

1. **Mesure** (React Profiler + Performance, projet de référence §2.5 spec) : sélection d'une autre ligne,
   entrée / sortie d'édition texte et richtext. Consigner les chiffres dans `T176-sprint2.md`.
2. **Callbacks stables** : `ExcelCellActionsContext` fournissant des fonctions **stables** (pattern « ref sur
   la dernière valeur ») — `inlineEdit(objectId, field, value)`, `startRichtextEdit(nodeId, objectId, field)`,
   `commitRichtext()`, `cancelRichtext(field)`, `openMultiEnum(...)`, `openLinkPopover(...)`,
   `toggleSteps(nodeId)`, `rename(nodeId, name)`. Les cellules reçoivent des props primitives (`nodeId`, `col`,
   `objectId`, `value`, `fieldDef`, `stickyBg`, `isEditing`…) au lieu de closures.
3. **`React.memo`** sur `NameCell`, `InlineCell`, `RichtextCell`, `LinkCell`, `StepsCell` → un changement de
   sélection de ligne ne re-rend que les `<tr>` et les cellules dont une prop change (fond figé des 2 lignes
   concernées).
4. **Richtext** : `activeRichtextEdit` reste dans `ExcelView` (la ligne en dépend : DnD, `select-none`) ; avec
   les cellules mémoïsées, entrer / sortir d'édition ne re-rend que les cellules de la ligne concernée.
5. Si les objectifs ne sont toujours pas tenus : extraire un composant `ItemRow` mémoïsé (dernier recours,
   pas prévu par défaut).

## 3. Fichiers

| Fichier | Sprint | Changement |
|---------|--------|-----------|
| `renderer/components/system/excelCellStore.ts` | 1 | **Nouveau** — store sélection + registre d'éditeurs, hooks |
| `renderer/components/system/excelCaret.ts` | 1 | **Nouveau** — `rawOffsetAtPoint` |
| `renderer/components/system/ExcelTextEditor.tsx` | 1 | **Nouveau** — `<textarea>` iso-typographique |
| `renderer/components/system/ExcelView.tsx` | 1, 2 | Store, gestes, F2, `LinkCell` / `StepsCell` extraites, éditeurs remplacés, `handleRowSelect` no-op ; sprint 2 : actions stables + `React.memo` |
| `renderer/components/RichTextField.tsx` | 1 | Prop `initialCaret` |
| `renderer/components/parameters/ParamRefText.tsx` | 1 | `data-param-raw={ref.raw}` sur la référence |
| `renderer/i18n/locales/fr.json`, `en.json` | 1 | Nouvelle clé `system.excelView.doubleClickToEdit` (« Double-cliquer ou F2 pour modifier ») — `system.shared.clickToEdit` reste pour la Vue Word |

`WordView.tsx` n'est pas modifié (hors scope).

## 4. Décisions et alternatives rejetées

| Décision | Alternative rejetée | Raison |
|----------|--------------------|--------|
| Store externe + `useSyncExternalStore` pour la cellule sélectionnée | État React dans `ExcelView` | Re-rendu global à chaque sélection (cause du lag) |
| Registre d'éditeurs pour F2 | Événement `dblclick` synthétique sur le `<td>` | Pas de moyen propre de demander « curseur en fin » ; couplage au DOM |
| `<textarea>` + `field-sizing: content` | `contenteditable` ; auto-resize en JS | Valeur texte brute, sélection native simple ; supporté par Chromium 126 sans script |
| Offset calculé sur le rendu lecture avant démontage | Calcul sur le `<textarea>` après montage | Un `<textarea>` n'expose pas de « caret from point » ; le rendu lecture le permet et gère les références de paramètres |
| `caretRangeFromPoint` | `caretPositionFromPoint` | Non disponible avant Chromium 128 (Electron 31 = 126) |
| `posAtCoords` Tiptap au montage (coordonnées relues après `scrollIntoView`) | Coordonnées client figées au double-clic | La cellule peut défiler entre le clic et le montage |
| Performance en sprint 2 (mesure puis mémoïsation) | Tout en un sprint | Refactor des props de cellules conséquent ; le sprint 1 livre déjà le gain du store et reste testable seul |
| Pas de composant `ItemRow` par défaut | Extraire la ligne entière | Refactor lourd ; mémoïser les cellules devrait suffire — à décider sur mesure |

## 5. Impacts

- Gestes : 2d clic sur une cellule sélectionnée n'édite plus ; double-clic sur une ligne de dossier sans
  colonne `section` renomme au lieu de replier.
- Édition en masse T149 inchangée (les éditeurs appellent toujours `applyInlineEditToSelection`).
- `ParamRefText` : attribut en plus, rendu inchangé (utilisé aussi en Vue Word / Édition).
- `RichTextField` : prop optionnelle, défaut inchangé (`'end'`).
- Mise à jour SPEC (dernier sprint) : `SPEC-SYSTEM-VIEW.md §Vue Excel` (gestes, F2, éditeur texte multi-ligne
  iso-typographique, curseur, touches), `SPEC-REQ-requirements.md §3` si la prop `initialCaret` y est
  documentée avec `variant="compact"`.

## 6. Découpage

**Sprint 1 — gestes, F2, éditeurs, curseur** : `excelCellStore`, `excelCaret`, `ExcelTextEditor`, `LinkCell` /
`StepsCell` extraites, double-clic sur toutes les cellules, F2, `handleRowSelect` no-op, `initialCaret`,
`data-param-raw`, i18n. Tests T176-tests §1–§3.

**Sprint 2 — réactivité** : mesure, actions stables, `React.memo`, re-mesure ; objectifs §2.5 spec. Tests
T176-tests §4. Mise à jour SPEC + SPEC-INDEX.
