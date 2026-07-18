# T75 — Sprint unique : redimensionnement, rognage et menu contextuel

Réf. `specs/T75.md`, `specs/T75-design.md`, `specs/T75-tests.md`.

Les deux sprints prévus en design (resize+menu de base, puis crop) ont été
implémentés dans une seule passe, à la demande de l'utilisateur.

## Comportement implémenté

- Images et diagrammes draw.io insérés dans un richtext (`RichTextField`)
  affichent des poignées de redimensionnement (coins, ratio conservé) une fois
  sélectionnés.
- Menu contextuel (clic droit) : **Redimensionner**, **Rogner**, **Remplacer
  le fichier**, **Supprimer** communs aux deux types ; **Ouvrir dans draw.io**
  et **Changer de page/node-id** en plus pour un bloc drawio.
- Rognage : overlay de sélection avec poignées + boutons Valider/Annuler.
  Image → fractions `[0,1]` de la taille native (survit à un remplacement de
  fichier par une image de dimensions différentes). Drawio → fenêtre
  pan/zoom en unités du modèle mxGraph ; le fichier `.drawio` référencé n'est
  jamais modifié.
- `RichTextViewer` (lecture seule) affiche la taille/le rognage stockés sans
  aucune interaction (poignées/menu masqués) — même extension/NodeView, piloté
  par le flag `editor.isEditable` déjà existant, pas de branche de code
  séparée.
- Sérialisation Markdown image : `![alt](src)` standard tant qu'aucune
  métadonnée n'est définie (compatibilité ascendante totale) ; bloc fenced
  `` ```image `` dès qu'un attribut est défini — même principe que le bloc
  `` ```drawio `` de T47, dont le payload JSON est étendu avec les mêmes clés
  `width`/`height`/`crop`.
- Undo/redo : `updateAttributes()` dispatch une transaction ProseMirror
  standard, couverte nativement par l'historique de `StarterKit`.

## Fichiers modifiés / créés

- `apps/desktop/src/renderer/tiptap/mediaAttrs.ts` (nouveau) — `parseCropAttr`
  partagé entre les deux extensions.
- `apps/desktop/src/renderer/tiptap/ResizableImageExtension.ts` (nouveau) —
  étend `@tiptap/extension-image` (même nom de node `image`, `setImage` et le
  paste handler existants inchangés).
- `apps/desktop/src/renderer/tiptap/ResizableImageView.tsx` (nouveau).
- `apps/desktop/src/renderer/tiptap/ResizableMediaFrame.tsx` (nouveau) —
  composant partagé (poignées, overlay de rognage, menu contextuel) utilisé
  par les deux NodeViews.
- `apps/desktop/src/renderer/tiptap/NodeContextMenu.tsx` (nouveau).
- `apps/desktop/src/renderer/tiptap/DrawioPagePicker.tsx` (nouveau, extrait de
  `DrawioInsertButton.tsx` — réutilisé par `DrawioEmbedView.tsx` pour "Changer
  de page/node-id" et "Remplacer le fichier").
- `apps/desktop/src/renderer/tiptap/DrawioEmbedExtension.ts` — attributs
  `width`/`height`/`crop` + sérialisation étendue.
- `apps/desktop/src/renderer/tiptap/DrawioEmbedView.tsx` — intégration
  `ResizableMediaFrame`, mesure de la taille réelle du diagramme rendu (voir
  divergence ci-dessous), actions de menu.
- `apps/desktop/src/renderer/components/RichTextField.tsx`,
  `RichTextViewer.tsx` — `Image.configure(...)` → `ResizableImage.configure(...)`.
- `apps/desktop/src/renderer/components/system/WordView.tsx` — idem (troisième
  instance d'éditeur richtext en lecture seule, propre à la vue Word, repérée
  en revue de code — sans cette migration, un document contenant une image
  redimensionnée se serait affiché comme un bloc de code brut dans cette vue).
- `apps/desktop/src/renderer/components/DrawioInsertButton.tsx` — utilise
  `DrawioPagePicker` au lieu de sa popover inline dupliquée.

## Divergences par rapport au design

- **Crop image en fractions `[0,1]`**, pas en pixels absolus comme dans une
  première implémentation corrigée en revue de code — nécessaire pour que
  "Remplacer le fichier" avec une image de dimensions différentes réapplique
  un cadrage cohérent plutôt qu'un rectangle qui déborde des nouvelles bornes.
  C'est ce que `specs/T75-design.md` §1 prescrivait déjà ; la première passe
  d'implémentation en avait dévié, corrigé avant ce commit.
- **Résolution du "risque technique" drawio** (mise à l'échelle du cadre par
  rapport à la taille réelle rendue par le viewer) : plutôt que de répliquer
  la formule interne du viewer (`getGraphBounds() + 2×border + 1`, non
  garantie stable dans un bundle tiers minifié), la taille de référence est
  mesurée directement sur le DOM (`containerRef.current.offsetWidth/Height`)
  une fois le diagramme rendu et visible. Insensible à tout détail
  d'implémentation interne du viewer ou à une transformation CSS ancêtre —
  plus robuste que l'approche initialement envisagée en design.
- **Mode rognage plein-format borné** (`MAX_CROP_PREVIEW`) : le design prévoyait
  d'afficher le contenu complet à l'échelle d'affichage courante ; ajout d'un
  plafond (480px) pour éviter qu'un contenu très grand actuellement affiché en
  très réduit ne fasse déborder l'aperçu de rognage très largement du
  document (repéré en revue de code).

## Revue de code effectuée

`/code-review` (8 angles) a été exécuté sur le diff avant ce commit. Bugs
identifiés et corrigés :
- Ordre de clamp incorrect dans le calcul du rectangle de rognage (le cadre
  pouvait dépasser les bornes en tirant vers le haut/la gauche).
- Ancrage incorrect des poignées de redimensionnement nord/ouest (le bloc
  grossissait à l'opposé de la poignée tirée au lieu de suivre le curseur).
- Régression de mise à l'échelle du diagramme drawio (taille réelle rendue
  ≠ taille utilisée pour le calcul d'échelle) — cf. divergence ci-dessus.
- Fond blanc et perte du padding appliqués même aux états de chargement/erreur
  (régression visuelle en dark mode) — restreint au canvas du diagramme
  uniquement (le padding n'a pas été restauré : il aurait réintroduit un
  décalage entre la taille mesurée et la taille visuellement rognée/affichée,
  compromis délibéré).
- Attribut `title` de l'image non transmis au NodeView (perte de l'info-bulle).
- Taille native de l'image non réinitialisée après "Remplacer le fichier"
  (l'ancienne image restait utilisée pour l'échelle/le rognage).
- Troisième éditeur richtext (`WordView.tsx`) non migré vers `ResizableImage`.
- Duplication de `parseCrop`/échappement d'attribut entre les deux extensions
  → mutualisés dans `mediaAttrs.ts` et réutilisation de `escapeXml` existant.
- Re-render React à chaque `pointermove` pendant le rognage (contrairement au
  redimensionnement) → alignement sur le même pattern imperatif
  (mutation DOM directe pendant le drag, commit React au relâchement).

## Vérifications effectuées

- `pnpm typecheck` (`@polenta/desktop`, `@polenta/api-client`, `@polenta/web`) :
  0 erreur. (`@polenta/api` a une erreur préexistante sans rapport avec ce
  ticket, présente aussi sur `master`.)
- `pnpm build` (`@polenta/desktop`) : build renderer/main/preload réussi,
  1906 modules transformés (6 de plus que sur `master`, correspondant
  exactement aux nouveaux fichiers).
- Lancement de l'app Electron construite : non concluant dans cet
  environnement (`electron.app` revient `undefined` à l'exécution — pas
  d'affichage/runtime Electron attachable dans cette session, même limitation
  déjà documentée dans `specs/T47-sprint3.md`). Pas de vérification
  interactive réelle (glisser une poignée, ouvrir le menu contextuel,
  confirmer un rognage) possible dans cette session.

## Non vérifié / limitations connues

- Alignement pixel-perfect du cadre de rognage drawio avec le rendu visuel
  réel du viewer : la mesure DOM (`offsetWidth`/`offsetHeight`) donne la
  bonne taille globale, mais une divergence de centrage interne du viewer
  (translate non nul dans certains modes de rendu) resterait à corriger si
  observée en usage réel — dégrade proprement (rognage simplement imprécis,
  pas de crash) si c'est le cas.
- Aucun test manuel réel des interactions de glisser-déposer (redimensionner,
  rogner, menu contextuel) — seule vérification possible dans cette session :
  typecheck + build. À confirmer par test manuel de l'utilisateur dans l'app
  réelle avant de considérer le ticket "done".

## Comment tester manuellement

1. Ouvrir un champ richtext en édition, insérer une image et un diagramme
   draw.io existant.
2. Cliquer sur chacun pour faire apparaître les poignées ; glisser un coin →
   la taille change en conservant le ratio.
3. Sauvegarder, fermer/rouvrir l'objet → la taille est conservée à
   l'identique.
4. Clic droit sur chacun → menu contextuel ; tester "Rogner" (ajuster le
   cadre, Valider) puis vérifier que seule la zone sélectionnée s'affiche.
5. Sur le bloc drawio : "Ouvrir dans draw.io" doit ouvrir le fichier externe ;
   modifier le fichier, revenir sur Polenta → le rendu se met à jour ;
   vérifier que le fichier `.drawio` sur disque n'a pas été modifié par le
   rognage.
6. "Remplacer le fichier" sur chacun, avec un fichier de dimensions
   différentes → position/taille conservées, rognage réappliqué de façon
   cohérente (image) ou réinitialisé (drawio si changement de page).
7. Ouvrir le même champ en lecture seule (ex. vue Excel non éditée, ou vue
   Word) → taille/rognage affichés, aucune poignée ni menu au clic droit.
