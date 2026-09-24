# T169 — Design technique : rendu richtext et édition dans la cellule (Vue Excel)

Ref. fonctionnelle : `specs/T169.md`. Travail dans le dossier principal (branche `main`, pas de
worktree — décision utilisateur).

## Découpage

**Un seul sprint.** Le périmètre tient dans 3 fichiers modifiés et 1 hook nouveau. Il n'y a pas
de changement IPC, de modèle de données ni d'i18n.

## Fichiers modifiés

| Fichier | Changement | Pourquoi |
|---|---|---|
| `renderer/lib/staticRichText.tsx` | Nouvelle prop `variant?: 'default' \| 'compact'` sur `StaticRichTextViewer` ; constante `VIEWER_CLASS_COMPACT`. | Typographie resserrée pour la cellule (text-xs, titres ramenés au corps du texte, marges verticales quasi nulles), afin que N lignes = ~N lignes de contenu. `default` inchangé (Vue Word, Recherche). |
| `renderer/components/system/useRenderWhenVisibleAtRest.ts` | **Nouveau** : `RenderGateProvider` + hook `useRenderWhenVisibleAtRest(ref)`. | Porte de rendu partagée : une cellule n'est rendue que si elle est visible **et** que le défilement est au repos. Voir §Porte de rendu. |
| `renderer/components/system/ExcelView.tsx` | (1) branche `richtext` de `InlineCell` réécrite (lecture mise en forme / édition en place) ; (2) `activeRichtextPopover` → `activeRichtextEdit` ; suppression du rendu de la popup ; (3) garde du `mousedown` extérieur ; (4) `draggable` / `select-none` neutralisés sur la ligne en édition ; (5) `RenderGateProvider` autour du `<table>`. | Cœur de la fonctionnalité. |

Aucun changement dans `RichTextField.tsx` : son mode « avec contexte » (toolbar partagée
`RichTextProvider`, garde `relatedTarget` au blur, `onSubmit` sur `Ctrl/Cmd+Entrée`, `autoFocus` →
curseur en fin) couvre déjà le besoin. `SystemView` fournit déjà le `RichTextProvider` et la
`RichTextToolbar`.

## Porte de rendu (`useRenderWhenVisibleAtRest`)

```ts
// Fourni une fois par ExcelView, autour du <table>.
export function RenderGateProvider(props: {
  rootRef: React.RefObject<HTMLElement>   // conteneur défilant (containerRef d'ExcelView)
  idleMs?: number                          // défaut 150
  children: React.ReactNode
}): JSX.Element

// Utilisé par chaque cellule richtext. Passe à true une seule fois, puis reste à true.
export function useRenderWhenVisibleAtRest(ref: React.RefObject<HTMLElement>): boolean
```

Fonctionnement (un seul observateur et un seul listener pour tout le tableau, pas un par
cellule) :

- **IntersectionObserver unique**, `root = rootRef.current`, `rootMargin: '0px'` (visible
  uniquement, décision utilisateur). Il tient à jour l'ensemble `intersecting` des éléments
  enregistrés actuellement à l'écran.
- **Listener `scroll` passif** sur `rootRef.current` : il passe `scrolling = true` et
  (ré)arme un timer de `idleMs`. À l'échéance, `scrolling = false` puis `flush()`.
- **`flush()`** : pour chaque élément de `intersecting` → appel de son callback `setRendered(true)`,
  `unobserve`, retrait du registre. Les appels `setState` sont regroupés par le batching
  automatique de React 18 : un seul re-rendu.
- **Callback de l'IO** : il met à jour `intersecting`, puis appelle `flush()` **seulement si
  `!scrolling`**. Cela couvre sans défilement l'ouverture de la vue, un changement de filtre,
  le dépliage d'un dossier, le redimensionnement et un changement de hauteur max. Pendant un
  défilement, l'IO continue de suivre les entrées et sorties, mais seules les cellules encore
  visibles au repos sont rendues. Les lignes seulement traversées ne le sont jamais.
- **Registre** : `Map<Element, () => void>`. Le hook enregistre dans un `useEffect([])` et se
  désinscrit au démontage. Une cellule démontée puis remontée (filtre, collapse) repart de
  `false` : elle n'a pas de cache hors composant, et le coût est seulement celui des cellules
  visibles.
- **Hors provider** (garde-fou) : le hook retourne `true`, soit un rendu immédiat.

**Alternative rejetée** : réutiliser la `rootMargin: 300px` de la Vue Word (préchargement).
L'utilisateur veut « juste les lignes visibles ». Pendant un défilement rapide, le
préchargement ferait de toute façon rendre des lignes seulement traversées.

**Alternative rejetée** : virtualisation du tableau (react-window). Elle serait incompatible à
court terme avec les colonnes figées `sticky`, le DnD de lignes, `useScrollToNode` (T164) et les
hauteurs de ligne variables. C'est un chantier à part entière.

## Rendu lecture d'une cellule richtext (`InlineCell`, `fieldDef.type === 'richtext'`)

```
maxLines === 1               → inchangé (1re ligne + ¶, classe truncate)
maxLines > 1, !rendered      → texte brut T168 (clamp.wrap(nonEmptyLines.join('\n')))
maxLines > 1, rendered       → <RichtextClamp maxLines>
                                  <StaticRichTextViewer value repoPath variant="compact" />
                               </RichtextClamp>
éditée (isEditing)           → éditeur en place (§Édition)
```

- `rendered = useRenderWhenVisibleAtRest(tdRef)`, calculé seulement quand `maxLines > 1`. À 1,
  la cellule ne s'enregistre pas.
- `InlineCell` n'a pas `repoPath` aujourd'hui : il est ajouté en prop, puisque ExcelView l'a déjà
  pour `StepsPanel` et la popup.
- **`RichtextClamp`** (petit composant local à ExcelView) :
  - `div` avec `maxHeight: ${maxLines}rem` (`text-xs` = line-height 1rem) et `overflow: hidden`.
  - `ResizeObserver` sur le contenu : `overflowing = scrollHeight > clientHeight + 1`.
  - Si `overflowing`, application de
    `maskImage: 'linear-gradient(to bottom, #000 calc(100% - 1rem), transparent)'` (et
    `WebkitMaskImage`). Le masque ne dépend pas de la couleur de fond : il marche en ligne
    sélectionnée, au survol, dans une cellule figée et dans les deux thèmes, contrairement à un
    dégradé vers une couleur de fond.
  - Le ResizeObserver capte aussi le chargement asynchrone des images et diagrammes draw.io, qui
    modifie la hauteur.
- `max-w-xs` est retiré de la cellule richtext : `table-layout: fixed` gouverne déjà la largeur,
  et la classe ne faisait qu'accompagner `truncate`.
- Stabilité du défilement (« la première ligne ne saute pas ») : le **scroll anchoring natif de
  Chromium** (`overflow-anchor: auto`, défaut) suffit. Les cellules rendues sont à l'écran et
  l'ancre est un élément visible. Aucun code, mais un scénario de test dédié (voir tests S7).
  Si le test échoue : sauvegarde et restauration de `scrollTop` relatif à la 1re ligne visible
  autour du `flush()`.

## Édition en place

### État (ExcelView)

```ts
// remplace activeRichtextPopover
const [activeRichtextEdit, setActiveRichtextEdit] =
  useState<{ nodeId: string; objectId: string; field: string } | null>(null)
```

- Identité par `nodeId + field` (et non `objectId`) : c'est la ligne qui s'agrandit.
- `richtextOriginalValuesRef` (T149) est **conservé tel quel**. Il est rempli au démarrage de
  l'édition avec la même logique qu'aujourd'hui (objet édité + pairs de multi-sélection).
- `onRichtextEdit(objectId, field, rect)` → `onRichtextEdit(nodeId, objectId, field)`. Le `rect`
  ne sert plus. Démarrer une édition alors qu'une autre est active remplace simplement l'état :
  l'ancienne valeur est déjà persistée par `onChange` et vaut validation.
- `InlineCell` reçoit `isRichtextEditing: boolean`, `richtextEditValue: string` (valeur live
  `getFieldValue(objectMap.get(objectId), field)`, comme la popup), `onRichtextChange(v)`,
  `onRichtextCommit()` et `onRichtextCancel()`.

### Rendu dans la cellule

```tsx
<td ref={tdRef} data-richtext-cell-editor
    className="border border-edge p-0 align-top cursor-auto select-text …stickyBg"
    onMouseDown={() => { insideEditorMouseDownRef.current = true }}
    onClick={e => e.stopPropagation()}   // ni reselect de cellule, ni re-toggle
    onKeyDown={Escape → onRichtextCancel ; Ctrl+Enter → onRichtextCommit (garde-fou hors Tiptap)}>
  <RichTextField value={richtextEditValue} onChange={onRichtextChange}
                 repoPath={repoPath} autoFocus onSubmit={onRichtextCommit} />
</td>
```

- **Hauteur auto** : pas de `max-height` ni d'overflow sur la cellule. `RichTextField` (mode
  contexte) n'impose aucune hauteur à `EditorContent`, donc le `<td>` et la ligne suivent le
  contenu. Seul le mode Raw (`textarea` `resize-y min-h-[80px]`) garde son propre comportement,
  ce qui est acceptable.
- **Largeur** : inchangée (`table-layout: fixed`), sans minimum (décision utilisateur).
- **Défilement à l'entrée** : `useEffect` au passage en édition →
  `tdRef.current.scrollIntoView({ block: 'nearest' })`. Le suivi du curseur pendant la frappe
  est natif (ProseMirror `scrollIntoView` sur le conteneur défilant).
- **Multi-sélection** : `onRichtextChange = v => applyInlineEditToSelection(objectId, field, v)`,
  à l'identique de la popup.

### Sortie d'édition

| Déclencheur | Implémentation |
|---|---|
| `Ctrl/Cmd+Entrée` | `onSubmit` de `RichTextField` (Tiptap consomme la touche) → `setActiveRichtextEdit(null)`. |
| Clic extérieur | `mousedown` sur `document` (existant, adapté) : on ferme si `!insideEditorMouseDownRef.current && !target.closest('[data-richtext-toolbar]')`, puis `insideEditorMouseDownRef.current = false`. |
| Dialogue natif (sélecteur de fichier) | Aucun `mousedown` émis → l'édition reste ouverte. Le blur de `RichTextField` garde déjà le contexte actif (`relatedTarget` null). |
| `Échap` | `onKeyDown` du `<td>` : restaure chaque entrée de `richtextOriginalValuesRef` via `onInlineEdit`, puis ferme. Tiptap ne consomme pas `Échap` (la popup actuelle en dépend déjà). |

**Pourquoi `insideEditorMouseDownRef` plutôt que `target.closest(...)`** : les menus de
`RichTextField` sont rendus par **portail** (`NodeContextMenu` pour les tableaux,
`DrawioPagePicker`). Leur DOM est hors du `<td>`, mais les évènements React y remontent
jusqu'au `<td>` par l'arbre React. React 18 écoute sur la racine, avant le listener `document`
en phase bubble. Le drapeau posé par `onMouseDown` du `<td>` est donc lu par le handler
document du même évènement. Cela corrige au passage un défaut latent de la popup actuelle : un
clic dans le menu contextuel de tableau la fermait.

### Interactions avec la ligne

- La `<tr>` de la ligne en édition (`activeRichtextEdit?.nodeId === node.id`) reçoit
  `draggable={false}` et ne reçoit pas `select-none` : la sélection de texte à la souris ne
  lance pas de drag de ligne. La cellule elle-même force `select-text`.
- Les raccourcis du tableau (`handleKeyDown`) ignorent déjà les cibles `isContentEditable`,
  sans changement.
- Le clic dans l'éditeur : `stopPropagation` au niveau du `<td>`, donc pas de
  `handleRowSelect` ni de reset de sélection. La sélection multiple T149 reste intacte pendant
  l'édition.
- **Colonnes figées** : le `<td>` en édition garde `freezeStyle` / `stickyBg`. Avec
  `border-separate` (T151), chaque cellule suit la hauteur de sa ligne, donc la partie figée et
  la partie défilante restent alignées.
- **Changement de contexte** : si l'objet ou le nœud édité disparaît des lignes (filtre, collapse,
  suppression, changement de type), un `useEffect` remet `activeRichtextEdit` à `null`. La
  valeur est déjà persistée.

### Suppressions

- JSX de la popup richtext (`{activeRichtextPopover && …}`, ~l.1904-1952) et attribut
  `data-richtext-popover`.
- Calcul de position `top/left/width` pour le richtext.

## Décisions et alternatives rejetées

| Sujet | Retenu | Rejeté |
|---|---|---|
| Déclencheur du rendu | 1 IO + 1 listener scroll partagés (provider) | 1 IO par cellule : ~N×3 observateurs ; la logique « au repos » serait dupliquée. |
| Troncature | `max-height` + `mask-image` conditionnel | `-webkit-line-clamp` (inopérant sur HTML en blocs) ; dégradé vers une couleur de fond (dépend de la sélection, du survol, du figé et du thème). |
| Éditeur | `RichTextField` existant en mode contexte | Nouvelle variante compacte de l'éditeur : hors besoin, la typographie d'édition (`text-sm`) est acceptée. |
| Détection du clic extérieur | Drapeau `onMouseDown` React (couvre les portails) | `closest('[data-…]')` sur chaque portail : fragile, et il faudrait marquer chaque menu. |
| Préchargement | Aucun (`rootMargin: 0`) | 300 px comme la Vue Word. |

## Risques

- **Coût du premier rendu** d'un écran plein (~20-30 lignes × 3 richtext) : markdown-it est
  synchrone mais rapide (quelques ms par champ). Les diagrammes draw.io restent paresseux (T163).
  À mesurer sur PL/Product (tests S6).
- **Scroll anchoring** : si l'ancre choisie par Chromium est la ligne en cours de rendu, un saut
  est possible. Le repli est décrit ci-dessus.

## Mises à jour SPEC prévues (dernier sprint)

- `SPEC-SYSTEM-VIEW.md` §Vue Excel : rendu mis en forme des cellules richtext (N > 1, porte
  « visible + repos », `mask-image`), édition en place (fin de la popup), sorties d'édition.
- `SPEC-REQ-requirements.md` §3.2a : prop `variant="compact"` de `StaticRichTextViewer`.
- `SPEC-INDEX.md` : MAJ `T169` sur ces deux lignes, mots-clés `édition en place`, `cellule`,
  `repos`, `scroll idle`, `mask-image`, `RenderGate`.
