# T42 — Sprint 2 : menu contextuel d'édition (dernier sprint)

## Correctif post-sprint (validation manuelle)

Remonté par test manuel humain : le collage Excel insérait le HTML brut en
texte littéral (les balises `<table>...</table>` visibles dans le contenu)
au lieu de créer un tableau.

**Root cause** : le correctif de collage du sprint 1 appelait
`editor.chain().focus().insertContent(normalizeTableHtml(html)).run()`.
Or l'extension `Markdown` (`tiptap-markdown`) **surcharge** les commandes
`insertContent`/`insertContentAt`/`setContent` de TipTap pour repasser
systématiquement leur contenu dans `editor.storage.markdown.parser.parse()`
— c'est-à-dire les traiter comme du **Markdown**, jamais comme du HTML,
quel que soit l'appelant. Avec `Markdown.configure({ html: false })`
(config de `RichTextField.tsx`), des balises `<table>` ainsi repassées dans
le parseur markdown-it sont traitées comme du texte littéral (aucune règle
HTML active) au lieu d'être reconnues comme un tableau.

**Correctif** : construire le slice ProseMirror directement depuis le HTML
via `DOMParser.fromSchema(view.state.schema).parseSlice(...)` (import
`DOMParser as ProseMirrorDOMParser` depuis `@tiptap/pm/model`) et l'insérer
par `view.dispatch(...)`, en contournant entièrement la couche de commandes
TipTap (donc la surcharge de l'extension Markdown). Même niveau
d'implémentation que la conversion image du même `handlePaste`, qui
manipulait déjà `view`/`state` directement plutôt que `editor.commands`.

Ce point n'avait pas été détecté par la revue de code du sprint 1 : les
deux agents de revue avaient vérifié la sérialisation (`table.js` de
tiptap-markdown) mais pas le chemin de désérialisation/insertion
(`core.js`, override de `insertContentAt`) — leçon pour une prochaine revue
similaire : vérifier les deux sens (parse ET serialize) quand une
extension tierce intercepte des commandes génériques de l'éditeur.

**Deuxième correctif** (même remontée manuelle, immédiatement après le
premier) : le collage Excel ne collait alors plus rien du tout. Cause
probable : `parseSlice(dom, { preserveWhitespace: true })` sans `context`
(position résolue d'insertion) — le seul autre appel de ce type dans le
code base (`tiptap-markdown`, collage de texte markdown) passe toujours un
`context`. Corrigé en passant `context: view.state.selection.$from`.
Ajout en complément d'un `try/catch` autour du parsing custom : en cas
d'échec (HTML Excel réel plus complexe qu'anticipé — styles, espaces de
noms Office, structure imprévue), le code se replie sur le collage HTML par
défaut de ProseMirror plutôt que de ne rien coller (dégradé mais jamais
silencieusement vide).

**Toujours non vérifié interactivement** dans cette session — ces deux
correctifs sont basés sur la lecture des sources TipTap/ProseMirror/
tiptap-markdown et le retour manuel humain, pas sur un test direct par
l'agent.

**Troisième correctif (définitif)** : le retour manuel suivant ("ça fait une
image ?") a montré que le filet de sécurité (`catch`) du deuxième correctif
était systématiquement déclenché — `parseSlice(dom, {preserveWhitespace:
true, context: $from})` levait une exception (`Cannot read properties of
null (reading 'type')` dans `Fitter.findFittable`), le code retombait donc
dans la boucle de conversion image plus bas, sans jamais y retourner
explicitement.

Un harnais de test isolé (agent Electron headless monté à la main avec
esbuild, en dehors du build normal — aucun skill de lancement de l'app
n'existe dans ce repo, et `ELECTRON_RUN_AS_NODE=1` empêchait de lancer
Electron normalement dans cette session ; contournable en désactivant cette
variable pour la commande) a permis de reproduire et d'isoler la cause
exacte : `parseSlice(dom)` sans `context` cohérent calcule un
`openStart`/`openEnd` égal à la profondeur de la structure du tableau (4 :
table > row > cell > paragraph), ce qui fait fusionner le contenu voisin du
point d'insertion dans la dernière cellule du tableau au lieu de l'insérer
proprement à côté — et peut faire planter `replaceSelection` selon le
contenu voisin exact.

Le même harnais a un temps fait suspecter un bug plus profond (un texte
existant ailleurs dans le document semblait corrompu en HTML échappé dès
qu'un tableau était inséré, y compris via le bouton `TableInsertButton` du
sprint 1) — après investigation, ce n'était **pas un bug réel** : le test
passait par erreur du HTML (`'<p>...</p>'`) comme contenu markdown initial
d'un éditeur avec l'extension `Markdown` active, qui réinterprète tout
contenu passé à `setContent`/`insertContent` comme du Markdown (même
confusion que le premier correctif) — avec du markdown valide en entrée, le
comportement est correct nativement, `Markdown.configure({html: false})`
n'a pas eu besoin d'être modifié et le reste une question de sécurité non
posée pour rien.

Correctif définitif retenu : ne plus reparser le HTML collé dans le document
du tout. À la place, `extractTableRows.ts` extrait le texte des cellules
(simple traversée DOM, sans ProseMirror), `padTableRows` complète les lignes
raccourcies par une fusion Excel (colspan/rowspan, non supportée cf. T42.md
décision 1) plutôt que de décaler le contenu des lignes suivantes, un
tableau vide de la bonne taille est inséré via la commande standard
`insertTable` (déjà utilisée par `TableInsertButton`, ligne d'en-tête
systématique), puis `fillPastedTable.ts` remplit chaque cellule via
`tr.insertText` en partant de la dernière cellule vers la première (évite
tout recalcul de position). `normalizeTableHtml.ts` est supprimé, remplacé
par `extractTableRows.ts`. Validé dans le harnais isolé : contenu existant
préservé (y compris formatage gras), fusion Excel dégradée proprement,
sérialisation Markdown GFM correcte.

## Fichiers modifiés

- `apps/desktop/package.json` — ajout `@tiptap/pm` (`^2.4.0`, dépendance
  explicite requise pour importer `TextSelection` depuis `@tiptap/pm/state` ;
  déjà présente transitivement mais pnpm ne l'expose pas dans
  `apps/desktop/node_modules` sans déclaration directe).
- `apps/desktop/src/renderer/components/RichTextField.tsx` — point d'accroche
  `handleDOMEvents.contextmenu`, état `tableMenu`, rendu du menu dans les deux
  branches de retour, fermeture automatique du menu sur changement de
  sélection ou passage en lecture seule (voir divergences).
- `apps/desktop/src/renderer/tiptap/tableMenuItems.ts` *(nouveau)* —
  `buildTableMenuItems(editor)`.
- `apps/desktop/src/renderer/tiptap/extractTableRows.ts` *(nouveau, remplace
  `normalizeTableHtml.ts` supprimé)* — extraction texte des cellules du HTML
  collé + complétion des lignes raccourcies par une fusion.
- `apps/desktop/src/renderer/tiptap/fillPastedTable.ts` *(nouveau)* —
  remplissage d'un tableau vide juste inséré, cellule par cellule.
- `specs/SPEC-REQ-requirements.md` §3.2c *(nouvelle sous-section)* —
  documentation du support des tableaux dans richtext.
- `specs/SPEC-TECH-stack.md` §2 — mention des 4 extensions table dans la
  ligne "Éditeur RICHTEXT".
- `specs/SPEC-INDEX.md` — colonne `MAJ` mise à jour (`T75` → `T42`) pour les
  deux sections ci-dessus.

## Comportement implémenté

- Clic droit sur une cellule (`td`/`th`) en édition ouvre `NodeContextMenu`
  (composant générique déjà existant, réutilisé tel quel) avec : Ajouter une
  ligne au-dessus/en dessous, Supprimer la ligne, Ajouter une colonne à
  gauche/droite, Supprimer la colonne, Supprimer le tableau.
- Chaque item lit `editor.can().<commande>()` — désactivé automatiquement par
  `@tiptap/extension-table` quand l'action produirait un tableau invalide
  (dernière ligne/colonne).
- Position cliquée résolue via `view.posAtDOM(cell, 0)` (voir divergence 1) et
  sélection ProseMirror positionnée explicitement avant ouverture du menu.
- Menu absent de `RichTextViewer.tsx` (lecture seule), cohérent avec `T42.md`
  décision 5.

## Divergences par rapport au design

1. **`posAtDOM(cell, 0)` plutôt que `posAtCoords({left, top})`** (design
   initial). La revue de code a relevé que `posAtCoords` (résolution par
   coordonnées écran) et le hit-test DOM (`target.closest('td, th')`) sont
   deux résolutions indépendantes : si `posAtCoords` échouait à résoudre une
   coordonnée (cas limite près d'un bord de cellule), le code n'avait aucun
   fallback et gardait la sélection précédente, avec un risque qu'une action
   du menu s'applique à une autre cellule (voire un autre tableau) que celle
   réellement cliquée. `posAtDOM(cell, 0)` élimine ce risque : il est ancré
   directement sur l'élément DOM déjà confirmé par le hit-test, pas sur des
   coordonnées écran indépendantes.
2. **Fermeture automatique du menu sur changement de sélection** (non prévu
   au design). Relevé en revue de code : rien n'empêchait l'utilisateur de
   naviguer au clavier (ex. `Tab`, raccourci natif de
   `@tiptap/extension-table` qui déplace la sélection vers la cellule
   suivante) pendant que le menu était ouvert — les items recalculés au
   re-render suivant auraient alors agi sur une cellule différente de celle
   visuellement pointée par le menu, sans feedback. Ajout d'un abonnement à
   `editor.on('selectionUpdate', ...)` (actif uniquement pendant que le menu
   est ouvert) qui referme le menu dès que la sélection change pour une autre
   raison que son ouverture.
3. **Fermeture automatique du menu quand le champ devient non-éditable**
   (non prévu au design). Relevé en revue de code : le garde `!view.editable`
   ne protégeait que l'ouverture du menu — rien n'empêchait techniquement une
   action du menu de s'exécuter si `disabled` passait à `true` pendant que le
   menu était déjà ouvert (le pipeline de commandes TipTap n'est pas bloqué
   par `editable: false`). Ajout de `setTableMenu(null)` dans l'effet qui
   applique `editor.setEditable(!disabled)`.

## Vérifications effectuées

- `tsc --noEmit` sur `apps/desktop` : aucune erreur.
- Revue de code (`/code-review`, effort medium, 1 agent, angle correctness) :
  3 candidats retenus et corrigés (divergences 1-3 ci-dessus) ; 3 autres
  candidats vérifiés et écartés (non-bugs, confirmés par lecture directe des
  sources `@tiptap/core`/`@tiptap/react`).
- **Pas de vérification interactive via l'app complète dans cette session**
  (aucun skill de lancement Electron disponible dans ce repo) — en revanche,
  le correctif définitif du collage Excel (§ Troisième correctif) a été
  validé dans un harnais Electron headless isolé monté à la main (bundle
  esbuild des vrais fichiers `extractTableRows.ts`/`fillPastedTable.ts`,
  exécuté dans une fenêtre Electron cachée) : contenu existant du document
  préservé, fusion de cellules Excel dégradée sans décalage, sérialisation
  Markdown GFM correcte. Ce sprint attend malgré tout une **validation
  manuelle humaine** dans l'app réelle (menu contextuel, undo/redo, rendu
  visuel — non couverts par ce harnais).

## Mises à jour SPEC effectuées

- `SPEC-REQ-requirements.md` §3.2c (nouvelle sous-section) : comportement des
  tableaux dans richtext (insertion, menu contextuel, collage Excel,
  contrainte de sérialisation Markdown qui impose l'absence de fusion et la
  promotion systématique de la 1ère ligne en en-tête).
- `SPEC-TECH-stack.md` §2 : mention des extensions table dans la ligne
  "Éditeur RICHTEXT".
- `SPEC-INDEX.md` : colonne `MAJ` → `T42` pour ces deux sections.

## Comment tester manuellement

En plus de la checklist du sprint 1 (`T42-sprint1.md`) :

1. Clic droit sur une cellule d'un tableau existant (≥ 2 lignes, ≥ 2
   colonnes) → menu contextuel avec les 7 actions (3 lignes, 3 colonnes,
   1 suppression tableau).
2. "Ajouter une ligne en dessous" sur une ligne intermédiaire → la nouvelle
   ligne apparaît juste après, pas à la fin du tableau.
3. Réduire un tableau à sa dernière ligne/colonne → "Supprimer la
   ligne"/"Supprimer la colonne" apparaît désactivée.
4. Ouvrir le menu, appuyer sur `Tab` (déplace la sélection vers la cellule
   suivante) → le menu se ferme automatiquement au lieu de rester affiché sur
   l'ancienne position.
5. "Supprimer le tableau" retire le tableau entier ; `Ctrl+Z` restaure tout
   (insertion, édition, suppression) via l'historique standard de l'éditeur.
6. Fermeture par clic extérieur et par `Échap` — les deux fonctionnent.

## Statut

Sprints 1 et 2 codés — périmètre complet du design (`T42-design.md`). Ticket
en attente de validation manuelle humaine avant archivage et proposition de
merge vers `main` (cf. `WORKFLOW.md` phase Dev, dernier sprint).
