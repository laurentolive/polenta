# GH299 — Sprint 1 : couleur du texte et surlignage dans les richtext

Sprint unique (`specs/GH299-design.md`).

## Fichiers

Nouveaux :
- `packages/types/src/richtext-colors.ts` — palette, regex de balise, `stripRichTextColorTags`, `splitRichTextColorTags`
- `apps/desktop/src/shared/richTextColorValues.ts` — teintes clair/sombre (source unique thème + Word)
- `apps/desktop/src/shared/richTextColors.ts` — plugin markdown-it (règle inline, appariement strict, rendu)
- `apps/desktop/src/renderer/tiptap/RichTextColorMarks.ts` — marques `HighlightColor` / `TextColor`
- `apps/desktop/src/renderer/components/RichTextColorButton.tsx` — bouton + menu de pastilles
- `apps/desktop/src/mcp-server/tools/richtext-colors-note.ts` — phrase des descriptions MCP
- Tests : `shared/richTextColors.gh299.test.ts`, `renderer/lib/richTextColors.gh299.test.ts`,
  `main/services/export/template/richtext-colors.gh299.test.ts`, `e2e-web/gh299-richtext-colors.spec.ts`

Modifiés : `field-validators.ts` (EARS), `index.ts` (types) ; `RichTextField`, `RichTextViewer`,
`RichTextToolbar`, `staticRichText`, `theme.config.ts` + `index.css` (tokens générés, classes `pl-c-*` /
`pl-hl-*` hors `@layer`), locales fr/en ; texte visible : `textFilter` (`VisibleTextRegExp`),
`searchQuery` (correspondance, remplacement), `wordDiff`, `exportColumns`, `ExcelView` (ligne repliée),
`ImpactTrees` (infobulle), `ElementPreviewPopup` (étapes), `ExecutionHistoryGrid`, `SearchResultsDoc`
(repli), `constellation`, `requirements-index.service` (MiniSearch), `interface-compliance.service`
(titre de ligne) ; exports : `template/markdown.ts`, `markdown-to-ooxml.ts` ; MCP : `update.tools`,
`bulk-import.tools`.

## Comportement

Conforme à `specs/GH299.md`. Points du design précisés en cours de sprint :

- **Marques à l'extérieur du gras** (priorité 101 > StarterKit) : en CommonMark, `**<span …>x</span>**y`
  n'est pas du gras — l'ordre inverse aurait perdu le gras au rechargement. Couvert par l'e2e E1.
- **Appariement strictement imbriqué** : des balises qui se chevauchent (saisies en Raw / MCP) restent
  en partie littérales, au lieu d'un HTML mal imbriqué que le navigateur réparerait autrement que
  l'éditeur et l'export Word.
- **Remplacement de la Vue Recherche** sur le texte visible, positions reportées dans la source,
  balises traversées conservées (après le texte de remplacement) : remplace exactement ce que la
  recherche a trouvé, ancres et `\b` compris.
- **Export Standard** : balises retirées des seules colonnes richtext (titre et champs texte intacts).
- Inventaire des affichages « texte brut » (subagent) : infobulle d'ImpactTrees, ligne repliée de la
  Vue Tableau, étapes du popup d'aperçu, grille d'historique d'exécution, repli de la Vue Recherche,
  constellation, index MiniSearch, titre de la matrice de conformité — balises retirées partout.

## Divergences par rapport au design

- Export Standard docx : balises retirées, couleurs non rendues (spec §5.4 précisée au design).
- Pas de test unitaire des marques Tiptap (aucun environnement DOM — jsdom/happy-dom — dans le projet) :
  l'aller-retour éditeur est couvert par l'e2e (E1 : couleur + gras + surlignage, enregistrement,
  rechargement, retrait).
- Revue de code : 10 constats ; corrigés 1–7 et 10. Non retenus : diff sans changement visible pour une
  couleur seule (accepté par la spec §5.2), sous-classe `RegExp` du filtre (choix documenté au design).

## Mises à jour SPEC

- `SPEC-REQ-requirements.md` §3.2 (ligne `richtext`) et nouvelle **§3.2h** (format, palette, liste
  blanche, ordre d'écriture, édition, texte visible, exports, MCP).
- `SPEC-INDEX.md` : ligne SPEC-REQ §3, mots-clés et MAJ → GH299.

## Vérifications

- `pnpm typecheck` : 0 erreur. Pas de tâche lint dans les paquets (`turbo lint` n'exécute rien).
- `pnpm test` (desktop) : 144 fichiers, 1562 tests verts (un timeout isolé de
  `sync.service.gh173` au premier passage, vert relancé seul — sans rapport).
- E2E web (niveau 2) : `gh299-richtext-colors` (3) + voisines `gh152`, `gh229-element-refs`,
  `gh178-diff-rendered`, `gh227`, `gh145`, `gh117` : 18/18.
- Suite e2e complète (niveau 3) : non lancée — après le « Validé ».

## Tester à la main

1. Ouvrir une exigence, sélectionner un mot de l'énoncé, bouton « A » souligné → Rouge ; bouton
   marqueur → Jaune ; gras ; enregistrer, rouvrir : tout est conservé. Mode Raw : balises visibles.
2. Thème sombre : les 11 couleurs restent lisibles (éditeur, Vue Document, cellule de la Vue Tableau).
3. Export gabarit Word (`{{@rich.statement}}`) ouvert dans Word : couleur et surlignage présents.
4. Desktop (Electron) : même comportement que le web.
