# T169 — Sprint 1 (unique) : rendu richtext et édition dans la cellule (Vue Excel)

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `apps/desktop/src/renderer/lib/staticRichText.tsx` | Prop `variant?: 'default' \| 'compact'` sur `StaticRichTextViewer` + constante `VIEWER_CLASS_COMPACT` (text-xs, titres au corps du texte, sans marges verticales, images bornées). |
| `apps/desktop/src/renderer/components/system/useRenderWhenVisibleAtRest.tsx` | **Nouveau** : `RenderGateProvider` (un IntersectionObserver `rootMargin: 0` + un listener `scroll` passif, repos = 150 ms) et `useRenderWhenVisibleAtRest(ref, enabled)`. |
| `apps/desktop/src/renderer/components/system/ExcelView.tsx` | Nouveau composant `RichtextCell` (lecture mise en forme / édition en place) + `RichtextClamp` (`max-height` N rem + `mask-image` si débordement, `ResizeObserver`). `InlineCell` délègue au richtext via la prop `richtext` (qui remplace `onRichtextEdit`). État `activeRichtextPopover` → `activeRichtextEdit {nodeId, objectId, field}`. Popup richtext supprimée. Clic extérieur détecté par un drapeau `onMouseDown` React, qui couvre les menus de l'éditeur rendus par portail. Ligne en édition : pas de DnD ni de `select-none`, clic droit réservé à l'éditeur, maintenue affichée malgré les filtres. Fin d'édition si la ligne disparaît des `rows` (collapse, suppression). `<table>` enveloppé dans `RenderGateProvider`. |
| `specs/SPEC-SYSTEM-VIEW.md`, `specs/SPEC-REQ-requirements.md`, `specs/SPEC-INDEX.md` | Mises à jour SPEC (voir ci-dessous). |

## Comportement implémenté

- Hauteur max N > 1 : cellule richtext rendue mise en forme, limitée à N lignes, bas estompé si
  le contenu est coupé. Le rendu n'est construit que pour les cellules visibles et une fois le
  défilement au repos. Avant cela, la cellule affiche le texte brut T168.
- N = 1 : rendu inchangé (1re ligne + `¶`).
- Champ richtext en lecture seule (sans `onInlineEdit`) : également rendu mis en forme, sans
  entrée en édition. Auparavant, il était affiché en texte brut grisé.
- Second clic sur une cellule sélectionnée → éditeur Tiptap dans la cellule (toolbar partagée,
  curseur en fin, `scrollIntoView({block:'nearest'})`). La hauteur suit le contenu. Sorties
  d'édition : `Ctrl/Cmd+Entrée`, clic extérieur ou `Échap` (restauration multi-sélection).

## Retours de test humain (itération 1)

- S7 : léger saut à la remontée au moment du rendu, **jugé acceptable** par l'utilisateur
  (pas de repli `scrollTop` implémenté). E7, E9 et L3 : OK.
- **Taille du texte différente en édition** : l'éditeur était en `text-sm` avec des titres
  agrandis, un `min-h-[80px]` et un cadre `px-3 py-2`, contre `text-xs` en lecture. Correctif :
  prop `variant?: 'default' | 'compact'` sur `RichTextField`. `compact` réutilise
  `VIEWER_CLASS_COMPACT` (désormais exportée de `staticRichText.tsx`, constante unique pour la
  lecture et l'édition), sans hauteur minimale ni bordure propre, avec les marges de la cellule
  (`px-2 py-1`) et une textarea Raw en `text-xs`. Le cadre d'édition devient le contour
  `ring-2` de la cellule. Le texte ne bouge plus entre lecture et édition.
  Fichier ajouté : `apps/desktop/src/renderer/components/RichTextField.tsx`.

## Divergences par rapport au design

- **Filtres pendant l'édition** : le design prévoyait de fermer l'édition quand la ligne éditée
  disparaît des lignes filtrées. La revue de code a montré que la frappe elle-même peut faire
  sortir la ligne d'un filtre, ce qui fermait l'éditeur en pleine saisie. La ligne éditée est
  donc **maintenue affichée** malgré les filtres. L'édition ne se ferme plus que si la ligne
  disparaît vraiment (collapse, suppression, changement de type). `T169.md` §3 et le test L8
  sont mis à jour en conséquence (ajout de L8b).
- Le hook est un `.tsx` (il exporte le provider JSX), et non un `.ts`.
- Le clic droit dans la cellule en édition ne remonte plus au menu contextuel de ligne. Ce
  point n'était pas explicitement prévu : sinon, le menu de tableau de l'éditeur et le menu de
  ligne s'ouvraient ensemble.

## Vérifications

- `tsc --noEmit -p apps/desktop/tsconfig.json` : 0 erreur.
- ESLint : pas de configuration dans le projet (ESLint 9 sans `eslint.config.js`), donc non
  exécuté.
- `/code-review` (medium) : 1 défaut trouvé (fermeture de l'éditeur par un filtre en cours de
  frappe), corrigé. Aucun autre problème.
- Aucun test automatique côté renderer. **Les scénarios de `T169-tests.md` restent à dérouler
  manuellement** (`pnpm --filter desktop dev`). Priorité : S6/S7 (performance et saut à la fin
  du défilement), E7/E9 (dialogue natif et menu de tableau), L3 (sélection de texte sans drag).

## Mises à jour SPEC

- `SPEC-SYSTEM-VIEW.md` §Vue Excel : puce T168 allégée (plus de « richtext en texte brut ») +
  puces **Rendu richtext mis en forme (T169)** et **Édition richtext dans la cellule (T169)**.
- `SPEC-REQ-requirements.md` §3.2a : prop `variant` de `StaticRichTextViewer`.
- `SPEC-INDEX.md` : lignes `SPEC-SYSTEM-VIEW` §Vue Excel et `SPEC-REQ` §3 → MAJ `T169`, avec
  mots-clés ajoutés.

## Comment tester manuellement

1. `pnpm --filter desktop dev`, ouvrir `PL/Product`, Vue Système, Exigences, Vue Excel, hauteur
   max 10.
2. Vérifier le rendu mis en forme des énoncés et l'estompage sur les contenus longs.
3. Tirer la barre de défilement de haut en bas puis relâcher : le rendu n'apparaît qu'à l'arrêt,
   sans saut.
4. Cliquer deux fois sur une cellule richtext : éditeur dans la cellule. Taper plusieurs lignes,
   utiliser la toolbar, puis `Ctrl+Entrée`, `Échap` et un clic extérieur.
5. Dérouler la liste complète de `specs/T169-tests.md`.
