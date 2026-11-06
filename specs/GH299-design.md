# GH299 — Design : couleur du texte et surlignage dans les richtext

Spec : `specs/GH299.md`. **Un sprint.**

## 1. Principe

Une seule grammaire, `<span class="pl-c-<nom>">` / `<mark class="pl-hl-<nom>">` + fermeture, reconnue
par **un plugin markdown-it partagé** branché sur les trois parseurs Markdown de l'application
(éditeur TipTap via `tiptap-markdown`, `StaticRichTextViewer`, exports du main). `html: false`
reste partout : le plugin n'émet du HTML que pour ces formes exactes, appariées.

## 2. Modules

### 2.1 `packages/types/src/richtext-colors.ts` (nouveau, exporté par l'index)

Pur, sans dépendance — utilisé par le validateur EARS (même paquet), le renderer et le main.

```ts
export const RICHTEXT_TEXT_COLORS = ['red', 'orange', 'green', 'blue', 'purple', 'gray'] as const
export const RICHTEXT_HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink', 'orange'] as const
export type RichTextTextColor = typeof RICHTEXT_TEXT_COLORS[number]
export type RichTextHighlightColor = typeof RICHTEXT_HIGHLIGHT_COLORS[number]
export const textColorClass = (c) => `pl-c-${c}`, highlightClass = (c) => `pl-hl-${c}`
/** Balise ouvrante ou fermante reconnue ; `y` (sticky) pour le plugin, `g` pour le retrait. */
export function richTextColorTagRegExp(flags: string): RegExp
/** Texte « visible » : balises de couleur reconnues retirées, contenu gardé. */
export function stripRichTextColorTags(text: string): string
/** Découpe en segments texte / balise (remplacement de la Vue Recherche). */
export function splitRichTextColorTags(text: string): { text: string; tag: boolean }[]
```

La regex n'accepte que `span`↔`pl-c-<couleur de texte>` et `mark`↔`pl-hl-<couleur de surlignage>`,
attribut `class="…"` seul, guillemets doubles. Toute variante (autre classe, `style`, attribut
supplémentaire) ne correspond pas → texte littéral.

### 2.2 `apps/desktop/src/shared/richTextColors.ts` (nouveau)

- `RICHTEXT_COLOR_VALUES` : valeur RGB `{ light, dark }` de chaque couleur (texte et surlignage) —
  **source unique** : `theme.config.ts` en dérive les tokens `rt-c-<nom>` / `rt-hl-<nom>`
  (variables CSS générées par `theme:generate`), l'export Word en lit la valeur claire (hex).
- `markdownRichTextColors(md: MarkdownIt)` :
  - règle inline `pl_color` avant `html_inline` : au `<`, teste la regex sticky ; jeton
    `pl_color_open` (`meta: { tag, cls }`) ou `pl_color_close` (`meta: { tag }`), `markup` = la
    balise brute. Ne voit jamais l'intérieur d'un code inline ni d'un bloc de code ; un `&lt;span…`
    (texte littéral tapé en mode riche, que `tiptap-markdown` échappe à l'écriture) est une entité,
    pas un `<` → reste littéral ;
  - règle core `pl_color_pair` après `inline` (avant `text_join`) : appariement par pile, par bloc
    inline et par balise ; ouvrante sans fermante ou fermante orpheline → jeton `text` de contenu
    `markup` (fusionné ensuite par `text_join`) ;
  - rendu : `<span class="pl-c-red">` / `</span>` (classe issue de la liste blanche, jamais du source).
  - Idempotent (`WeakSet` des instances déjà équipées) : `tiptap-markdown` rappelle `setup` à
    chaque `parse`.

### 2.3 Éditeur — `renderer/tiptap/RichTextColorMarks.ts` (nouveau)

Deux marques TipTap, déclarées **surlignage puis couleur** (rang du schéma → `<mark>` extérieur,
`<span>` intérieur, ordre stable à la sérialisation) :

| Marque | DOM | Attribut | Commandes |
|---|---|---|---|
| `highlightColor` | `<mark class="pl-hl-x">` | `color` | `setHighlightColor(c)`, `unsetHighlightColor()` |
| `textColor` | `<span class="pl-c-x">` | `color` | `setTextColor(c)`, `unsetTextColor()` |

- `parseHTML` : `mark` / `span` dont la classe est **exactement** une classe de la palette
  (`getAttrs` renvoie `false` sinon) → le collage Word/web (`style="color:…"`) ne crée aucune marque ;
  le collage interne (HTML produit par `renderHTML`) les conserve.
- `addStorage().markdown.serialize` : `open`/`close` renvoient les balises (sans passer par
  `HTMLMark`, inopérant en `html: false`) ; `parse.setup(md)` → `markdownRichTextColors(md)`.
- Une seule couleur par marque (exclusion par défaut d'une marque sur elle-même) : choisir une
  couleur remplace la précédente.

### 2.4 Barres d'outils — `renderer/components/RichTextColorButton.tsx` (nouveau)

Bouton + popover en portail, sur le modèle `TableInsertButton` / `TableSizePicker` (`onMouseDown`
+ `preventDefault` pour garder la sélection, voile de fermeture, `stopPropagation`). Prop `kind:
'text' | 'highlight'`. Icônes lucide `Baseline` / `Highlighter`, soulignées de la couleur active.
Pastilles (titre = libellé traduit), case « Aucune » ; la couleur active est marquée. Intégré
dans `RichTextToolbar` (désactivé en Raw) et dans la barre inline de `RichTextField` (absente en
lecture seule), après le bloc B/I/S/code.

### 2.5 Rendu

- `RichTextField` : ajout des deux marques aux extensions.
- `staticRichText.tsx` : `markdownRichTextColors(md)` dans `getMarkdownIt()`.
- `index.css` (hors bloc généré) : `.pl-c-<x> { color: rgb(var(--rt-c-<x>)) }`,
  `.pl-hl-<x> { background-color: rgb(var(--rt-hl-<x>)); color: inherit; border-radius: 2px }`
  (`color: inherit` : neutralise le noir par défaut de `<mark>` en thème sombre).
  Le surlignage de recherche (`mark[data-search-hl]`) est distinct (attribut), inchangé.

### 2.6 Texte nu

| Endroit | Changement |
|---|---|
| `packages/types/src/field-validators.ts` `stripMarkdownForEars` | `stripRichTextColorTags` d'abord |
| `renderer/lib/textFilter.ts` `buildFilterRegex` | renvoie un `VisibleTextRegExp` (sous-classe de `RegExp` dont `test` porte sur `stripRichTextColorTags(s)`) : les ~12 appelants (arbre, Vues Tableau/Document, campagnes, sélecteurs) restent inchangés |
| `renderer/lib/searchQuery.ts` `findMatches` | correspondance et extrait sur le texte sans balises |
| `renderer/lib/searchQuery.ts` `replaceInText` | remplacement dans les seuls segments texte (`splitRichTextColorTags`) : une balise n'est jamais modifiée |
| `main/.../template/markdown.ts` `parseMarkdown` | plugin branché → `markdownToPlainText` (gabarit `{{x}}`, xlsx d'exécution) ignore les jetons `pl_color_*` (déjà le cas des jetons inconnus) |
| `renderer/lib/exportColumns.ts` `buildExportRows` (export Standard docx/xlsx, impression) | valeurs passées par `stripRichTextColorTags` — l'export Standard écrit déjà le Markdown brut, sans mise en forme ; l'*outline* du gabarit garde la source |
| Autres affichages texte brut (inventaire de sprint) | même retrait au point d'affichage |

### 2.7 Export Word gabarit — `markdown-to-ooxml.ts`

`RunMarks` + `color?: string`, `highlight?: string` (pile pour l'imbrication) ; `pl_color_open` /
`close` dans `runs()`. `run()` : `<w:color w:val="DC2626"/>` après `strike`, `<w:shd w:val="clear"
w:color="auto" w:fill="FEF08A"/>` en fin de `rPr` (ordre du schéma OOXML).

### 2.8 MCP

Description du paramètre `fields` des outils d'écriture d'exigence / de test : une phrase sur la
palette et la forme exacte des balises.

## 3. Décisions et alternatives rejetées

- **`@tiptap/extension-color` / `-highlight`** : stockent un `style="color:#…"` / `data-color`,
  contraire à D1 (classes nommées) et à `html: false`. Rejeté.
- **`html: true` + assainissement** : ouvrirait tout le HTML inline au parseur ; liste blanche plus
  sûre et plus simple. Rejeté.
- **Retrait des balises à chaque appelant du filtre** : 12 sites à tenir ; `VisibleTextRegExp`
  centralise la règle « on filtre le texte visible ». Retenu.
- **Couleurs dans l'export Standard docx** : il écrit aujourd'hui le Markdown brut, sans gras ni
  liste ; y rendre la seule couleur serait incohérent. Couleurs rendues par le gabarit
  (`{{@rich.x}}`), balises retirées dans l'export Standard. **Écart à la spec §5.4** (qui citait
  l'export Standard) — spec corrigée.

## 4. Fichiers

Nouveaux : `packages/types/src/richtext-colors.ts` (+ test), `src/shared/richTextColors.ts`
(+ test), `src/renderer/tiptap/RichTextColorMarks.ts` (+ test), `src/renderer/components/RichTextColorButton.tsx`,
`e2e-web/gh299-richtext-colors.spec.ts`.

Modifiés : `packages/types/src/index.ts`, `field-validators.ts`, `renderer/theme.config.ts` (+ `index.css`
généré, `tailwind.theme.generated.js`), `renderer/index.css`, `RichTextField.tsx`,
`system/RichTextToolbar.tsx`, `lib/staticRichText.tsx`, `lib/textFilter.ts`, `lib/searchQuery.ts`,
`lib/exportColumns.ts`, `main/.../template/markdown.ts`, `markdown-to-ooxml.ts`, locales fr/en,
outils MCP d'écriture, specs (`SPEC-REQ` §3.2h nouvelle, `SPEC-INDEX`).
