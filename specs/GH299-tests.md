# GH299 — Scénarios de test

## Unitaires (vitest)

### `richtext-colors` (packages/types)
- `stripRichTextColorTags` : retire span/mark de la palette, garde le contenu ; laisse
  `<span style=…>`, `<span class="pl-c-fuchsia">`, `<mark class="pl-c-red">` (croisement), `<script>`.
- `splitRichTextColorTags` : segments alternés, concaténation = source.
- `isEarsCompliant('<span class="pl-c-red">WHEN</span> x THE s SHALL y')` → vrai ; via `validateFieldValue`.

### Plugin markdown-it (`shared/richTextColors`)
- Rendu nominal span, mark, imbriqués, dans `**gras**`, puce, titre, cellule de tableau, autour de `[[SYS-0001]]`.
- Littéral : classe inconnue, `style`, attribut en plus, ouvrante sans fermante, fermante orpheline,
  balise dans un code inline et un bloc de code, `&lt;span class="pl-c-red"&gt;` → aucun HTML émis, texte échappé.
- Idempotence : brancher deux fois ne double pas le rendu.

### Marques TipTap (`RichTextColorMarks`, jsdom, éditeur réel avec `tiptap-markdown`)
- Aller-retour : `markdown → éditeur → getMarkdown()` identique pour : couleur seule, surlignage
  seul, les deux, + gras, en liste, en tableau.
- `setTextColor('red')` sur une sélection → `<span class="pl-c-red">…</span>` ; `unsetTextColor` → source d'origine.
- Remplacement : `red` puis `blue` → une seule balise `pl-c-blue`.
- HTML collé `<span style="color:red">x</span>` → aucune marque.
- Texte littéral `<span class="pl-c-red">` tapé en mode riche → sérialisé échappé, relu littéral.

### Filtre et recherche
- `buildFilterRegex('pl-hl')` ne valide pas `'<mark class="pl-hl-yellow">a</mark>'` ; `'a'` le valide ;
  mot coupé par une balise (`6<span …>0</span>`) trouvé par `60`.
- `findMatches` : extrait sans balises. `replaceInText('span', …)` laisse les balises intactes.

### Exports
- `markdownToPlainText` : balises retirées.
- `markdown-to-ooxml` : `w:color`/`w:shd` aux bonnes valeurs, ordre `rPr` (b, i, strike, color, shd).
- `buildExportRows` : valeurs sans balises ; `buildExportOutline` : source conservée.

## E2E web (`e2e-web/gh299-richtext-colors.spec.ts`)
1. Exigence : sélectionner un mot de l'énoncé, menu « Couleur du texte » → Rouge : le mot a la classe
   `pl-c-red` ; enregistrer, recharger → toujours rouge ; mode Raw → balise visible.
2. Surlignage Jaune sur le même mot puis « Aucun surlignage » : balise `mark` retirée.
3. Vue Document : rendu coloré (classe présente dans `StaticRichTextViewer`).
4. Filtre global `pl-hl` : aucun résultat ; filtre sur le mot : trouvé.
5. Raw `<span style="color:red">x</span>` → affiché littéral en Vue Document.
6. Boutons désactivés en Raw.

## Manuel
- Lisibilité des 11 couleurs en thème clair et sombre (éditeur, Vue Document, cellule Vue Excel).
- Export gabarit Word ouvert dans Word : couleurs et surlignages présents.
- Desktop (Electron) : même comportement que le web.
