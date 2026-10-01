# GH34 — Sprint 2 : richtext mis en forme dans le Word

Spec : `specs/GH34.md` §2.5 · Design : `specs/GH34-design.md` §2.3–2.4 · Tests : `specs/GH34-tests.md` (S2.x)

## Comportement implémenté

- **Balise `{{@rich.<champ>}}`** (seule dans son paragraphe) : le champ richtext est inséré mis en
  forme. Disponible aussi dans les boucles : `{{#columns}}{{@rich}}{{/columns}}` (une colonne non
  richtext y donne ses paragraphes de texte) et `{{#steps}}{{@rich.action}}`, `{{@rich.expectedResult}}`,
  `{{@rich.notes}}{{/steps}}`. Les balises texte simple `{{champ}}` du sprint 1 sont inchangées.
- **Conversion Markdown → WordprocessingML** (markdown-it, mêmes options que l'écran) :
  - titres → style intégré `heading N` du gabarit, retrouvé **par nom** (`Titre1` en Word
    français, `Heading1` en anglais) ; sans style dans le gabarit : gras ;
  - gras / italique / barré (imbrication respectée), code inline (style `HTML Code` sinon Consolas) ;
  - listes à puces et numérotées imbriquées (numérotation ajoutée au gabarit, chaque liste repart à
    son numéro de départ, y compris quand un même champ est inséré deux fois), style
    `List Paragraph` ; cases à cocher `☐`/`☒` à la place de la puce ;
  - tableaux GFM (style `Table Grid` s'il existe, sinon bordures simples ; ligne d'en-tête répétée et
    en gras ; largeur = largeur utile de la page) ;
  - citations (style `Quote`, sinon retrait + italique), blocs de code (Consolas), ligne horizontale ;
  - images : bloc ```` ```image ```` (taille et rognage de l'éditeur) et `![]()`, fichiers du repo,
    `data:` et `http(s)` (10 s, 10 Mo) ; PNG/JPEG/GIF ; ramenées à la largeur utile ; une seule
    copie par source ; introuvable / format non pris en charge → `[Image : …]` ;
  - draw.io → `[Diagramme : chemin#nœud]` (rendu image au sprint 3) ;
  - `[[ID]]` → `ID`, lien → son texte ; retours à la ligne conservés.
- **Paquet** : médias + relations + content types, définitions de numérotation (partie créée si le
  gabarit n'en a pas, ordre du schéma respecté, y compris `w:numIdMacAtCleanup`), espaces de noms
  des dessins garantis à la racine, cellules de tableau toujours terminées par un paragraphe
  (champ vide ou finissant par un tableau dans une cellule), IDs de dessins renumérotés (uniques).
- **Performance** : gabarit sans aucune balise `{{@…}}` → aucune conversion ni chargement
  d'image. 500 exigences riches : ~0,7 s.

## Fichiers modifiés

| Fichier | |
|---------|-|
| `main/services/export/template/markdown.ts` | **nouveau** — markdown-it partagé, `[[ID]]` |
| `main/services/export/template/markdown-to-ooxml.ts` | **nouveau** — conversion, `RichFragment` |
| `main/services/export/template/docx-package.ts` | **nouveau** — styles, largeur utile, médias, numérotation, finalisation |
| `main/services/export/template/image-source.ts` | **nouveau** — chargement + dimensions PNG/JPEG/GIF (sans dépendance) |
| `main/services/export/template/docx-template.ts` | `prepare(pkg)` avant rendu, `finalize` après ; libellé d'erreur `raw_tag_outerxml_invalid` |
| `main/services/export/template/template-data.ts` | `rich.*` sur éléments, colonnes et étapes (propriétés calculées) |
| `main/services/export/template/template-export.service.ts` | convertisseur par export, désactivé sans `{{@…}}` |
| `main/services/export/template/markdown-to-text.ts` | utilise `markdown.ts` |
| `apps/desktop/scripts/check-gh34.ts` | vérifications sprint 2 (53 au total), option `--keep` |

## Divergences par rapport au design

- **`RichFragment` au lieu d'une chaîne** : la valeur `rich.x` est recalculée à chaque occurrence
  de balise (propriété calculée — docxtemplater relit la valeur à chaque balise) pour attribuer des
  numérotations de listes neuves à chaque insertion ; sinon un champ inséré deux fois produisait
  une liste continuant sa numérotation (« 3. 4. ») à la seconde insertion.
- **`rich` étendu aux colonnes (y compris non richtext) et aux étapes de test** — non prévu
  explicitement au design, utile pour un gabarit générique (`{{#columns}}`) et pour les cahiers de
  tests.
- **Rognage d'image** : stocké en **fractions** de la taille naturelle par l'éditeur
  (`ResizableImageView`) — le design le supposait implicitement en pixels.
- **SVG / WebP** : non rasterisés (repli `[Image : …]`) ; à revoir avec le snapshot du sprint 3 si
  nécessaire.
- **Retours à la ligne simples** (softbreak) rendus en saut de ligne Word, comme le texte simple du
  sprint 1 (énoncés EARS sur plusieurs lignes), alors que l'écran les affiche en espace.

## Vérifications

- `pnpm typecheck` : aucune nouvelle erreur (seule `git.service.ts(78)`, préexistante).
- `pnpm build` : OK ; aucun `require` de module externe dans les chunks de l'export par gabarit.
- `scripts/check-gh34.ts` : **53 PASS, 0 FAIL** (S1.x + S2.1–S2.12 + Word Mac + gabarit sans `{{@…}}`).
- **Word 16 (automation COM)** : les documents générés (riche, gabarit « français » sans
  `numbering.xml`, variante Mac, 500 exigences, gabarit simple) s'ouvrent **sans réparation** ;
  numérotation calculée par Word conforme (chaque liste repart à 1) ; contrôle visuel d'une page.
- `/code-review` : 4 problèmes, tous corrigés (rognage en fractions, conversion inutile sans
  `{{@…}}`, marques imbriquées, ordre `w:num`/`w:numIdMacAtCleanup`), chacun couvert par une
  vérification ajoutée.

## Mises à jour SPEC

Aucune (sprint non final).

## Test manuel

1. Dans le gabarit du sprint 1, remplacer `{{statement}}` par un paragraphe contenant seulement
   `{{@rich.statement}}`.
2. Exporter un cahier d'exigences dont un énoncé contient titre, listes (puces, numérotée,
   imbriquée, cases à cocher), tableau, image du repo (redimensionnée / rognée dans l'éditeur).
3. Ouvrir dans Word : pas de message de réparation ; titres et tableaux aux styles du gabarit ;
   chaque liste numérotée repart à 1 ; image à la taille et au rognage de l'éditeur.
4. Mettre `{{@rich.statement}}` dans une cellule de tableau du gabarit → contenu dans la cellule,
   document valide.
5. Mettre `Énoncé : {{@rich.statement}}` (texte + balise) → message « doit être seule dans son
   paragraphe ».
6. Cahier de tests : `{{#steps}}{{order}}.` + paragraphe `{{@rich.action}}` + `{{/steps}}`.
