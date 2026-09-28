# T176 — Sprint 2 (dernier) : réactivité de la Vue Excel

Réf. : `specs/T176.md`, `specs/T176-design.md` §2.6, `specs/T176-tests.md` §4. Travail sur `main`.

## Fichiers modifiés

- `renderer/components/system/ExcelView.tsx` :
  - contexte `ExcelCellActionsContext` : actions de cellule **stables** (objet créé une fois, délègue via
    une ref à l'implémentation du dernier rendu) — `inlineEdit`, `rename`, `startRichtextEdit`,
    `commitRichtext`, `cancelRichtext`, `richtextEditorMouseDown`, `toggleMultiEnum`, `openLinkPopover`,
    `closeLinkPopover`, `toggleSteps` ;
  - `NameCell`, `InlineCell`, `LinkCell`, `StepsCell` enveloppées dans `memo` ; props primitives
    (`canRename`, `canEdit`, `repoPath`, `richtextEditing`, `needsRevalidation`, `typeName`) au lieu de
    closures / objets / JSX recréés à chaque rendu ; l'objet `richtext` de `RichtextCell` est construit dans
    `InlineCell` ;
  - styles des colonnes figées (`freezeStyles`) et définition enum de la colonne statut (`statusFieldDef`)
    mémoïsés ;
  - variables inutilisées `lt` / `cellLinks` du rendu des cellules de lien retirées.
- Specs : `SPEC-SYSTEM-VIEW.md §Vue Excel`, `SPEC-REQ-requirements.md §3.2a`, `SPEC-INDEX.md`.

## Mesures

Projet fixture de 300 exigences (10 dossiers), colonnes Section / Label / ID / Statut / Version / Note
(`text` 3 lignes) / Énoncé (richtext : paragraphe, liste, tableau) / Catégorie, hauteur max 10. Temps mesuré
dans l'app (build de production, driver Playwright) du déclenchement de l'évènement jusqu'à la frame
suivante (~1 frame incluse). Deux passes, valeurs par action :

| Mesure | Après sprint 1 | Après sprint 2 | Objectif spec |
|--------|----------------|----------------|---------------|
| P2 — clic sur une cellule d'une **autre ligne** | 57–62 ms | **18–23 ms** | < 50 ms ✅ |
| P1 — clic sur une autre cellule de la **même ligne** | 2–10 ms | 2–11 ms | < 50 ms ✅ |
| P3 — double-clic → éditeur texte focalisé (avec changement de ligne) | 67–71 ms | **25–29 ms** | < 100 ms ✅ |
| P4 — double-clic → éditeur richtext focalisé | 136–170 ms | **47–102 ms** | < 200 ms ✅ |
| P5 — Échap depuis l'éditeur richtext | 85–95 ms | **44–49 ms** | — |

Le gain de P1 (sélection de cellule sans re-rendu global) vient du store du sprint 1 ; P2–P5 viennent de la
mémoïsation : un changement de sélection de ligne ne re-rend plus que les `<tr>`. Pas besoin du dernier
recours du design (composant de ligne `ItemRow` mémoïsé).

## Divergences par rapport au design

Aucune. Le profiler React n'est pas disponible en build de production : les mesures sont des temps bout en
bout (évènement → frame suivante), ce qui est ce que perçoit l'utilisateur.

## Vérifications

- `tsc` : propre.
- `/code-review` : aucun bug.
- Non-régression fonctionnelle dans l'app (fixture T176) : double-clic texte multi-ligne (curseur 31/31),
  richtext (curseur dans « item deux » à 5), F2 texte (fin) puis modification + Ctrl+Entrée → titre écrit
  (fichier et arbre), `multi_enum` (popover 3 cases, fermé au clic extérieur), liens (popover ouvert puis
  refermé au 2d double-clic), **édition en masse** : 2 lignes (clic + Ctrl+clic), double-clic Statut sur la
  2e → sélection conservée, valeur écrite dans les 2 fichiers.
- Non vérifiés dans l'app : cellule étapes (type test), colonnes figées (styles mémoïsés — logique relue),
  chevron de dossier dans la cellule du nom.

## Mises à jour SPEC

- `SPEC-SYSTEM-VIEW.md §Vue Excel` — « Édition inline » réécrite (T176) : gestes (clic / double-clic / F2,
  toutes cellules, exceptions), éditeur texte iso-typographique multi-ligne et ses touches, curseur au point
  cliqué, réactivité (store + mémoïsation, mesures) ; entrée en édition richtext T169 : « second clic » →
  double-clic ou F2.
- `SPEC-REQ-requirements.md §3.2a` — prop `initialCaret` de `RichTextField`.
- `SPEC-INDEX.md` — lignes SPEC-SYSTEM-VIEW (§Configuration des champs / §Vue Excel…) et SPEC-REQ §3 :
  couverture + mots-clés, MAJ → T176.

## Tester manuellement

1. Sur un projet d'une centaine d'éléments ou plus, hauteur max 10 : cliquer d'une ligne à l'autre →
   sélection instantanée ; double-clic → éditeur immédiat, sans lag perceptible.
2. Reprendre les étapes de `T176-sprint1.md` (gestes, F2, touches, curseur, édition en masse).
3. Colonnes figées (Figer les volets) : sélection de lignes et édition inchangées, fonds opaques corrects au
   défilement horizontal.

## Correctif post-validation — curseur en fin de contenu richtext à partir de la 4e ligne

**Signalé** : en richtext, le curseur se plaçait en fin de contenu au lieu du point double-cliqué, sauf sur
les 3 premières lignes du tableau.

**Cause (probable, non reproduite en build de production)** : à l'entrée en édition, la cellule agrandie
faisait `scrollIntoView` ; si l'éditeur Tiptap devient disponible *après* ce défilement (ordre des effets non
garanti — ex. `StrictMode` en `pnpm dev`, qui détruit / recrée l'éditeur), `initialCaret` relit un point
sorti de l'écran → `posAtCoords` renvoie `null` → `focus('end')`. Les premières lignes n'ont pas besoin de
défiler, d'où le symptôme.

**Correctif** (`ExcelView.tsx`, `RichtextCell`) : pas de `scrollIntoView` au double-clic (seulement pour F2) —
la cellule s'agrandit vers le bas et le point cliqué reste en place ; `caretPointOnScreen` ramène le point dans
la zone visible du tableau avant `posAtCoords` s'il en est sorti. Vérifié en build de production (fixture
300 éléments avec richtext longs en lignes 4–5, copie du projet `PL/Product`) : curseur au bon caractère sur
toutes les lignes, plus de défilement au double-clic.

## Correctif 2 — curseur en fin de contenu, aléatoire, en `pnpm dev` (cause réelle)

**Signalé** : toujours en fin de contenu « aléatoirement », ex. `B-1-004-01-M` (handstickProduct).

**Reproduction** : impossible en build de production (clics réels Playwright : 60/60) ; reproduit avec le runtime
React de **développement** (`StrictMode` actif, comme `pnpm dev`) : 33/60 échecs, dont `B-1-004-01-M`.

**Cause** (trace des transactions ProseMirror) : deux effets de `RichTextField` se gardaient de leur premier
passage par un drapeau « déjà monté » (`isInitialSyncRef`, `isMountedRef`). En dev, `StrictMode` exécute
deux fois les effets de montage : le passage simulé consommait le drapeau, le second appelait
`setContent` — la conversion Markdown initiale n'étant pas toujours identité (`<`, listes, échappements…),
le Markdown de l'éditeur ≠ `value` / `rawValue` — ce qui replaçait le curseur en fin de contenu (et pouvait
déclencher une sauvegarde parasite). « Aléatoire » : ne touche que les contenus dont l'aller-retour Markdown
n'est pas identique.

**Correctif** (`RichTextField.tsx`) : les deux effets ne réagissent plus qu'à un **changement réel** de leur
entrée (`syncedValueRef` : dernière `value` vue ; `wasRawRef` : dernier état Raw vu), plus à un drapeau de
premier passage. Concerne tous les champs richtext (Vue Excel, Édition, popups), pas seulement T176.

**Vérifié** (runtime dev, clics réels, copie de handstickProduct) : 60/60 curseurs au bon caractère, dont
`B-1-004-01-M` ; aucun fichier d'exigence modifié après 60 ouvertures / annulations. `tsc` propre.
Outil de test : commande `dblclick-at <expr>` ajoutée au driver `run-desktop` (double-clic réel aux
coordonnées renvoyées par une expression évaluée dans la page).

## Correctif 3 — fond blanc de la cellule richtext en édition

**Signalé** : en édition, le fond de la cellule richtext passait au blanc (pavé blanc quand le contenu est
moins haut que la cellule).

**Cause / correctif** (`RichTextField.tsx`) : en variante `compact`, le conteneur de l'éditeur (et la zone
Raw) avait un fond opaque `bg-surface`. Fond transparent en `compact` : la cellule garde le fond de sa ligne
(sélection, survol, colonne figée) comme en lecture ; variante `default` inchangée. Vérifié dans l'app
(ligne sélectionnée, richtext d'une ligne dans une cellule haute de 9 lignes : aucun élément opaque entre
l'éditeur et la ligne).

## Correctif 4 — ouverture de la Vue Excel : délai et glitches

**Signalé** : la vue tableau s'affiche avec un gros délai et deux glitches.

**Mesure** (build de production, driver Playwright, handstickProduct / PH2 Exigence : 180 éléments, 27 colonnes
visibles, hauteur max 10 ; échantillonnage à chaque frame du clic jusqu'à stabilisation) — avant :

| t (ms) | Affiché |
|--------|---------|
| 320 | colonnes par défaut `section/name/id/status`, cellules vides (**glitch 1**) |
| 431 | colonnes « fallback » + données |
| 838 | vraies colonnes (prefs) — tableau entièrement différent (**glitch 2**) |
| 932 | richtext : texte brut → mis en forme |

Profil CPU : `useTranslation()` dans chaque cellule (~4 800) ≈ 170 ms ; lecture de `clientWidth` au montage
(reflow synchrone du tableau entier) puis `setContainerWidth` → second rendu complet ; 3 rendus complets
intermédiaires. IPC négligeable (< 10 ms).

**Correctifs** :
- `SystemView.tsx` : vues Tableau / Document rendues seulement quand `viewReady` (prefs du type appliquées,
  `rootKey` = type courant, objets chargés, liens / couverture si affichés) — sinon `ViewLoading` (zone vide,
  libellé après 400 ms). Requête des prefs lancée après résolution de l'identité (plus de double application
  `local` puis vrai login).
- `SystemViewContext.tsx` : `rootKey` — clé nœud|type de l'arbre chargé dans `root`.
- `ExcelView.tsx` : libellés des cellules via `ExcelCellLabelsContext` ; plus de `containerWidth` (CSS
  `min-width: 100%`, dernière colonne en largeur auto) ; rendu progressif (50 lignes, puis le reste en
  `startTransition` après la première peinture, d'emblée complet si une cible goto est posée) ; estompage
  richtext posé en effet de layout.
- `useRenderWhenVisibleAtRest.tsx` : une cellule visible au montage est rendue avant la première peinture
  (`isVisibleNow`, repli sur la fenêtre tant que la ref du conteneur n'est pas attachée).

**Après** : un seul état affiché, le final, à ~350 ms (lignes hors écran complétées à ~650 ms, sans changement
visible) ; changement de type Exigences → Tests : ancien tableau → ~20 ms de zone vide → nouveau tableau final.
CPU de l'ouverture : ~1 220 ms → ~760 ms (mesuré avant ajout du rendu progressif). Dernière colonne : remplit
toujours la largeur (vérifié sur PH2 / Test, 6 colonnes). `tsc` propre.

### Complément — rendu richtext en tâche de fond

Demande : rendre d'abord le visible, puis le reste en tâche de fond. `RenderGateProvider`
(`useRenderWhenVisibleAtRest.tsx`) : après le rendu du visible, lots de `backgroundBatch` (12) cellules
pendant les temps morts (`requestIdleCallback`), triées par distance à la zone visible (en dessous d'abord,
puis au-dessus), rendues en `startTransition` ; annulé à chaque `scroll`, relancé à l'arrêt du défilement
(`flush`) et à chaque nouvelle inscription (lignes du rendu progressif, dépliage). Mesuré (handstickProduct,
604 cellules richtext) : tout rendu ~2,7 s après l'ouverture, aucune tâche longue > 50 ms pendant le fond ;
défilement au milieu du tableau → cellules déjà mises en forme, ligne de tête inchangée après 1,5 s
(pas de saut). Non vérifié : défilement pendant le rendu de fond (logique d'annulation relue).
