# T42 — Design technique

## Analyse du code existant

- Deux points d'édition richtext montent chacun leur propre `useEditor`
  avec une liste d'`extensions` quasi identique : `RichTextField.tsx`
  (lignes 34-42) et `RichTextViewer.tsx` (lignes 16-23, lecture seule).
  Aucune extension table n'est montée aujourd'hui — `@tiptap/extension-table`
  et associés sont absents de `package.json` et de `node_modules`.
- Deux toolbars dupliquent le même pattern de bouton
  (`RichTextField.tsx` lignes 177-240, `RichTextToolbar.tsx` lignes 27-100) :
  `onMouseDown` + `preventDefault` + `editor.chain().focus().<cmd>().run()`,
  classe `btn(active, disabled?)`, séparateurs `<span className="w-px h-4
  bg-edge mx-1" />`. Le bouton d'insertion drawio (`DrawioInsertButton.tsx`)
  est déjà partagé entre les deux toolbars et gère lui-même sa popover — c'est
  le pattern à reproduire pour un bouton d'insertion de tableau.
- Le menu contextuel générique `NodeContextMenu.tsx` (portail, fermeture sur
  clic extérieur/`Échap`, items `{id, label, danger?, disabled?, onSelect}`)
  est aujourd'hui uniquement déclenché par `ResizableMediaFrame.tsx` via un
  `onContextMenu` React posé sur le wrapper DOM d'une NodeView custom (image,
  drawio). Un tableau standard (`@tiptap/extension-table`) n'a pas de NodeView
  React par cellule : il faut donc un point d'accroche différent, au niveau
  éditeur plutôt qu'au niveau nœud.
- **Cause racine du bug de collage Excel** (périmètre initial du ticket) :
  `handlePaste` dans `RichTextField.tsx` (lignes 49-69) itère
  `event.clipboardData.items` et, dès qu'il trouve un item `image/*`, fait
  `preventDefault()` et insère une image bitmap — puis retourne `true`,
  court-circuitant tout le reste. Or une plage Excel copiée place
  généralement **plusieurs** representations sur le presse-papiers : au
  minimum `text/html` (un vrai `<table>`) et souvent aussi une image bitmap
  de prévisualisation (`image/png`). Le code actuel tombe systématiquement
  sur la branche image en premier, sans jamais laisser sa chance au HTML —
  c'est la cause du "ça colle une image au lieu d'un tableau". Ce n'est pas
  spécifique à Excel : coller n'importe quel contenu riche accompagné d'une
  image (ex. capture copiée depuis Word) subit le même court-circuit
  aujourd'hui.
- Le stockage est du Markdown via `tiptap-markdown` (`Markdown.configure({
  html: false, transformPastedText: true })`). Le bundle `tiptap-markdown`
  (`node_modules/tiptap-markdown/dist/tiptap-markdown.es.js`) contient déjà un
  nœud `Table$1` avec sérialiseur Markdown GFM standard (`| a | b |` +
  séparateur), **actif seulement si les extensions
  `@tiptap/extension-table(+row/cell/header)` sont enregistrées** (l'extension
  interne détecte leur présence). Le sérialiseur refuse explicitement toute
  cellule avec `colspan`/`rowspan`/plusieurs enfants (cf. ligne 553-556 du
  bundle) — cohérent avec la Décision 1 de `T42.md` (pas de fusion) : on reste
  strictement dans le cas supporté nativement, aucun code de sérialisation
  custom à écrire.
- Côté parsing (chargement d'un document existant, ou du Markdown brut en mode
  Raw), `markdown-it` (dépendance de `tiptap-markdown`) **n'a pas** de règle de
  bloc pour les tables GFM en standard (vérifié : aucun fichier table dans
  `node_modules/markdown-it/lib`). Il faut un plugin ; `tiptap-markdown` ne
  l'installe pas d'office. À valider en sprint 1 : soit une plugin markdown-it
  compatible GFM (ex. table simple, sans dépendance lourde) est nécessaire,
  soit `tiptap-markdown` l'active automatiquement en présence des extensions
  Table (comportement à vérifier expérimentalement — la doc du package n'est
  pas explicite). Si aucun plugin actif : le Markdown GFM tapé/collé en mode
  Raw ne serait pas reparsé en tableau structuré au retour du mode Raw — accepté
  comme limite si un plugin léger n'est pas trouvé rapidement (voir Cas limites).

## Fichiers à modifier

| Fichier | Changement |
|---|---|
| `apps/desktop/package.json` | Ajout `@tiptap/extension-table`, `@tiptap/extension-table-row`, `@tiptap/extension-table-cell`, `@tiptap/extension-table-header` en version `^2.4.0` (alignée sur les autres `@tiptap/*`) |
| `apps/desktop/src/renderer/components/RichTextField.tsx` | Ajout des 4 extensions Table dans `extensions:[...]` ; ajout classes CSS table dans `attributes.class` ; correctif `handlePaste` (ne plus court-circuiter sur `image/*` si `text/html` présent) ; ajout du bouton toolbar d'insertion tableau ; ajout du point d'accroche menu contextuel tableau (`handleDOMEvents.contextmenu` + état React + rendu `NodeContextMenu`) |
| `apps/desktop/src/renderer/components/RichTextViewer.tsx` | Ajout des 4 extensions Table (lecture des documents existants) ; mêmes classes CSS table ; **aucune** interaction (pas de toolbar, pas de menu contextuel — cohérent avec T75) |
| `apps/desktop/src/renderer/components/system/RichTextToolbar.tsx` | Ajout du même bouton toolbar d'insertion tableau (mode contexte partagé), désactivé en mode Raw comme les autres boutons |
| `apps/desktop/src/renderer/components/TableInsertButton.tsx` *(nouveau)* | Bouton partagé + popover grille de sélection lignes/colonnes, sur le modèle de `DrawioInsertButton.tsx` |
| `apps/desktop/src/renderer/tiptap/TableSizePicker.tsx` *(nouveau)* | Popover de sélection visuelle (grille survolable, style Word/Google Docs), sur le modèle de `DrawioPagePicker.tsx` |
| `apps/desktop/src/renderer/tiptap/tableMenuItems.ts` *(nouveau)* | Fonction pure `buildTableMenuItems(editor): NodeContextMenuEntry[]` — construit les items du menu contextuel tableau à partir des commandes `editor.can()/.chain()` natives de `@tiptap/extension-table`, réutilisée par `RichTextField.tsx` (et par `RichTextToolbar.tsx`/mode contexte si le menu contextuel doit aussi s'y déclencher — à confirmer sprint 2, cf. Cas limites) |

## Nouvelles interfaces / types

Aucun nouveau type de données persistant : le tableau est un nœud ProseMirror
standard (`table`/`tableRow`/`tableHeader`/`tableCell`), sérialisé en Markdown
GFM natif par `tiptap-markdown` — pas d'attribut custom, pas de bloc fenced
JSON (contrairement à `image`/`drawioEmbed` en T75).

```ts
// TableSizePicker.tsx
interface TableSizePickerProps {
  top: number
  left: number
  maxRows?: number   // défaut 8
  maxCols?: number   // défaut 8
  onPick: (rows: number, cols: number) => void
  onClose: () => void
}
```

```ts
// tableMenuItems.ts
function buildTableMenuItems(editor: Editor): NodeContextMenuEntry[]
```

## Décisions techniques

1. **Grille visuelle survolable** (façon Word/Google Docs, 8×8 max, clic pour
   valider) plutôt que deux champs numériques — interaction plus rapide et
   déjà un pattern reconnu, coût d'implémentation comparable à un formulaire.
   Alternative rejetée : deux `<input type="number">` + bouton "Insérer" —
   plus verbeux pour le cas courant (petit tableau), gardé en secours mental
   si la grille s'avère peu ergonomique en sprint 1, mais pas retenu au
   départ.
2. **Insertion** : `editor.chain().focus().insertTable({ rows, cols,
   withHeaderRow: true }).run()` — commande native de
   `@tiptap/extension-table`, ligne d'en-tête systématique (cohérent avec
   `T42.md` point 3).
3. **Menu contextuel au niveau éditeur, pas au niveau nœud** : contrairement à
   `ResizableMediaFrame.tsx` (NodeView React avec `onContextMenu` local), les
   nœuds table standard n'ont pas de wrapper React par cellule. Le point
   d'accroche est `editorProps.handleDOMEvents.contextmenu` dans
   `RichTextField.tsx` (même niveau que `handlePaste` existant) :
   - détecte si `event.target` est dans un `td`/`th` (`.closest('td, th')`) ;
   - si oui, `event.preventDefault()`, résout la position exacte du clic via
     `view.posAtCoords({left, top})` et positionne explicitement la sélection
     ProseMirror à cet endroit (`TextSelection.near(doc.resolve(pos))`) avant
     d'ouvrir le menu — nécessaire pour que les commandes `can()`/`chain()`
     (ajout/suppression ligne/colonne) s'appliquent à la cellule réellement
     cliquée, sans dépendre du placement natif du caret par le navigateur au
     clic droit (comportement non garanti identique entre Chromium/Electron
     et les autres moteurs) ;
   - ouvre `NodeContextMenu` avec les items de `buildTableMenuItems(editor)`.
4. **États disabled du menu** : chaque item lit `editor.can().<commande>()`
   (ex. `editor.can().deleteRow()`) plutôt qu'une logique maison de comptage
   de lignes/colonnes — `@tiptap/extension-table` refuse déjà nativement de
   supprimer la dernière ligne/colonne d'un tableau via ces commandes
   (`can()` retourne `false` dans ce cas), évitant de dupliquer cette règle.
5. **Correctif `handlePaste`** : ajout d'une vérification `text/html` avant la
   boucle sur les items image :
   ```ts
   const hasHtml = event.clipboardData?.types.includes('text/html')
   if (hasHtml) return false // laisse ProseMirror parser le HTML via parseDOM (tables, formatage riche, etc.)
   ```
   Correctif minimal, cohérent avec la cause racine identifiée ci-dessus.
   N'affecte que le cas où du HTML est présent — le collage d'une image seule
   (screenshot sans HTML associé) garde son comportement actuel.
6. **CSS table** : ajout de classes Tailwind arbitraires cohérentes avec le
   reste de `attributes.class` (déjà un long chapelet `[&_xxx]:...`), pas de
   nouveau fichier CSS. Bordures fines sur `td`/`th`, fond légèrement
   distinct pour `th` (cohérent avec le design system — tokens `bg-hover`/
   `border-edge` déjà utilisés ailleurs), `border-collapse` sur `table`.
7. **Portée du menu contextuel** : sprint 2 ne l'ajoute que dans
   `RichTextField.tsx` (les deux modes, avec/sans `RichTextContext`, partagent
   déjà le même `editorProps`). Pas dans `RichTextViewer.tsx` (lecture seule,
   cohérent avec `T42.md` Décision 5).
8. **Parsing Markdown GFM des tables** (mode Raw / chargement) : à valider
   expérimentalement en sprint 1 — si `tiptap-markdown` ne parse pas les
   tables GFM sans plugin `markdown-it` additionnel, évaluer l'ajout d'un
   plugin léger (ex. `markdown-it-multimd-table` en mode GFM simple, ou
   équivalent) uniquement si nécessaire. Ne pas ajouter de dépendance si le
   round-trip fonctionne déjà nativement (à vérifier avant de coder).

## Découpage en sprints

### Sprint 1 — Extensions, insertion, correctif collage, rendu

- Ajout des 4 extensions Table dans `package.json`, `RichTextField.tsx`,
  `RichTextViewer.tsx`.
- Classes CSS table dans les deux composants.
- Correctif `handlePaste` (priorité HTML sur image).
- `TableSizePicker.tsx` + `TableInsertButton.tsx`, câblé dans
  `RichTextField.tsx` et `RichTextToolbar.tsx`.
- Vérification expérimentale du round-trip Markdown (sérialisation ET
  parsing) — ajout d'un plugin markdown-it si besoin (Décision 8).
- Vérification manuelle : coller un tableau Excel produit un vrai tableau.

### Sprint 2 — Menu contextuel d'édition

- `tableMenuItems.ts` (`buildTableMenuItems`).
- Point d'accroche `handleDOMEvents.contextmenu` + résolution de position
  dans `RichTextField.tsx`.
- Tests manuels de toutes les actions (ajout/suppression ligne/colonne,
  suppression du tableau) et de leurs états désactivés en bordure de
  tableau (1 seule ligne/colonne restante).

## Refs SPEC consultées

- `SPEC-REQ-requirements.md` §3.2 (types de champs, richtext) — sera mise à
  jour en sprint 2 (dernier sprint) avec la nouvelle sous-section tableaux.
- `SPEC-TECH-stack.md` §2 (stack technique, TipTap) — sera mise à jour avec
  les 4 nouvelles extensions.
