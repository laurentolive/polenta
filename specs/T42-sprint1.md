# T42 — Sprint 1 : extensions, insertion, correctif collage, rendu

## Fichiers modifiés

- `apps/desktop/package.json` — ajout `@tiptap/extension-table`,
  `@tiptap/extension-table-row`, `@tiptap/extension-table-header`,
  `@tiptap/extension-table-cell` (`^2.4.0`).
- `apps/desktop/src/renderer/components/RichTextField.tsx` — extensions Table
  montées, classes CSS table, correctif `handlePaste`, bouton
  `TableInsertButton` dans la toolbar inline.
- `apps/desktop/src/renderer/components/RichTextViewer.tsx` — extensions
  Table montées (lecture des documents existants), classes CSS table.
- `apps/desktop/src/renderer/components/system/RichTextToolbar.tsx` — bouton
  `TableInsertButton` dans la toolbar contextuelle.
- `apps/desktop/src/renderer/components/TableInsertButton.tsx` *(nouveau)* —
  bouton partagé, sur le modèle de `DrawioInsertButton.tsx`.
- `apps/desktop/src/renderer/tiptap/TableSizePicker.tsx` *(nouveau)* — popover
  grille survolable (8×8 max) pour choisir la taille du tableau à insérer.
- `apps/desktop/src/renderer/tiptap/normalizeTableHtml.ts` *(nouveau)* — voir
  § Divergences ci-dessous, ce fichier n'était pas prévu dans le design initial.

## Comportement implémenté

- Bouton toolbar "Insérer un tableau" (icône `Table` de `lucide-react`) dans
  les deux points d'édition richtext. Grille survolable jusqu'à 8×8 ; le
  nombre survolé/cliqué est le nombre total de lignes/colonnes du tableau
  inséré (1ère ligne = en-tête), convention Word/Google Docs.
- `editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run()`
  à la validation.
- CSS table (bordures, fond de l'en-tête) ajoutée dans `RichTextField.tsx` et
  `RichTextViewer.tsx`, cohérente avec les tokens du design system
  (`border-edge`, `bg-hover`).
- Collage Excel : le HTML du presse-papiers est détecté (`<table` présent),
  normalisé puis inséré explicitement (voir divergence ci-dessous) au lieu de
  tomber dans l'ancienne branche qui convertissait systématiquement en image
  bitmap dès qu'un item `image/*` était présent sur le presse-papiers — c'était
  la cause racine du bug initial du ticket.

## Divergences par rapport au design

1. **`normalizeTableHtml.ts` non prévu au design, ajouté suite à la revue de
   code du sprint.** En vérifiant le comportement réel de `tiptap-markdown`
   (`node_modules/tiptap-markdown/src/extensions/nodes/table.js`,
   `isMarkdownSerializable`), la revue de code a mis en évidence un bug
   critique non anticipé en Design : un tableau dont la 1ère ligne n'est pas
   *entièrement* composée de cellules `tableHeader` (ce qui est systématiquement
   le cas du HTML exporté par Excel — uniquement des `<td>`, jamais de `<th>`),
   ou qui contient une fusion (`colspan`/`rowspan`), n'est **pas** sérialisé en
   Markdown GFM par `tiptap-markdown` — il est remplacé par le texte littéral
   `[table]`, silencieusement, au premier `onUpdate` suivant le collage. Le
   design initial supposait (à vérifier expérimentalement, cf. `T42-design.md`
   Décision 8) que laisser ProseMirror parser le HTML brut suffirait ; ce
   n'est pas le cas. Correctif : `normalizeTableHtml()` promeut la 1ère ligne
   du tableau collé en cellules d'en-tête et retire les attributs
   `colspan`/`rowspan` avant insertion via `editor.commands.insertContent()` —
   cohérent avec la Décision 1 de `T42.md` (pas de fusion supportée) et la
   Décision 2 (ligne d'en-tête systématique, déjà appliquée à l'insertion
   manuelle).
2. **Le garde `handlePaste` a été resserré pendant le développement** : la
   première version testait uniquement la présence de `text/html` dans le
   presse-papiers pour court-circuiter la conversion image ; corrigé pour ne
   déclencher que si ce HTML contient effectivement un `<table` — sinon le
   collage d'une image accompagnée de HTML sans tableau (ex. copie d'image
   depuis Word/une page web) aurait régressé (l'ancien comportement, qui
   convertit l'image en base64 via `FileReader`, fonctionnait déjà pour ce cas
   et devait être préservé).
3. **Le picker `TableSizePicker` compte les lignes en-tête incluse** (pas
   "lignes de données + en-tête ajoutée en plus" comme envisagé
   informellement) : plus simple, correspond à la sémantique native de la
   commande `insertTable` de `@tiptap/extension-table` et à la convention
   Word/Google Docs — évite un décalage entre le nombre affiché dans le
   picker et le nombre de lignes réellement insérées (relevé en revue de
   code). `specs/T42-tests.md` scénario 1 mis à jour en conséquence.
4. Simplification mineure : `TableSizePicker` n'expose pas de props
   `maxRows`/`maxCols` (8×8 fixe) — la généralité n'avait pas d'appelant réel
   (relevé en revue de code, YAGNI).

## Vérifications effectuées

- `tsc --noEmit` sur `apps/desktop` : aucune erreur.
- Pas de configuration ESLint dans le repo (aucune règle de lint à exécuter).
- Revue de code (`/code-review`, effort medium, 2 agents indépendants,
  angles correctness + cleanup/altitude) : le bug critique de sérialisation
  `[table]` a été trouvé par les deux agents indépendamment et corrigé (cf.
  divergence 1) ; le décalage du picker (divergence 3) et la généralité
  inutile (divergence 4) ont également été corrigés. Comportement vérifié
  directement dans les sources de `tiptap-markdown`/`@tiptap/extension-table`
  (`node_modules`), pas seulement par lecture du diff.
- **Pas de vérification interactive dans cette session** : aucun skill de
  lancement de l'app Electron n'existe dans ce repo, et monter un harnais
  Playwright/Electron de zéro (aucune dépendance Playwright présente)
  dépassait le périmètre de ce sprint. Comme pour `T75`, ce sprint attend une
  **validation manuelle humaine** avant d'être considéré comme testé de bout
  en bout (checklist ci-dessous).

## Comment tester manuellement

1. Ouvrir un champ richtext (ex. `statement` d'une exigence), cliquer
   l'icône tableau dans la toolbar, survoler puis cliquer une taille (ex. 3×3)
   → un tableau apparaît avec une ligne d'en-tête grisée.
2. Taper du texte dans plusieurs cellules (y compris en gras/italique).
   Changer de champ puis revenir → le contenu est conservé.
3. Passer en mode "Raw" (bouton toolbar) → vérifier que le Markdown affiché
   est du GFM standard (`| a | b |` + ligne `| --- | --- |`), **pas** la
   chaîne littérale `[table]`.
4. Sélectionner une plage dans Excel (avec au moins 2 lignes/2 colonnes),
   copier, coller dans un champ richtext vide → un tableau structuré apparaît
   avec le contenu des cellules Excel (pas une image). Repasser en mode Raw
   pour confirmer la sérialisation Markdown correcte (pas `[table]`).
5. Ouvrir le même document en lecture seule (ex. vue Word) → le tableau
   s'affiche formaté, sans toolbar ni interaction possible.
6. Coller une image seule (capture d'écran, sans tableau) → toujours convertie
   en image comme avant (pas de régression).

## Suite

Sprint 2 (menu contextuel clic droit : ajout/suppression ligne/colonne,
suppression du tableau) — voir `specs/T42-design.md` § Découpage en sprints.
