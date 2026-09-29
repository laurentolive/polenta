# Tickets archivés (implémentés)

> Depuis le 2026-09-29, les tickets sont des **issues GitHub** (`laurentolive/polenta`) —
> voir `WORKFLOW.md`. Les tickets encore ouverts dans `TICKETS.md` ont été migrés :
>
> | Ticket | Issue |
> |--------|-------|
> | T151 | #1 |
> | T153 | #2 |
> | T154 | #3 |
> | T171 | #4 |
> | T173 | #5 |
> | T174 | #6 |
> | T175 | #7 |
> | T177 | #8 |
> | T178 | #9 |
> | T179 | #10 |

---

### T162 — Évolution : afficher/masquer les titres de dossiers dans les vues Excel et Word (densité d'affichage)

**Statut** : Done — mergé sur master

**Description** : dans les vues Excel et Word de la Vue Système, les titres de dossiers
(lignes de groupe en Excel, sections H1–H6 en Word) étaient toujours affichés. Ajout d'une
case à cocher **« Afficher les titres des dossiers »** dans la roue crantée ⚙️
(`FieldConfigModal`), par onglet (Tableau / Document), cochée par défaut. Décochée : liste
plate, plus de lignes de groupe ni de sections `Hn`, collapse ignoré, numérotation de
section conservée sur les éléments. Persistée avec la config des colonnes
(`fieldVisibility["<nœud>::<type>"]` gagne `showFoldersExcel` / `showFoldersWord` ; pref
pré-T162 ⇒ affichés). « Réinitialiser » remet aussi la case cochée. En Excel, titres
masqués, le drag & drop de réordonnancement reste possible entre éléments de même dossier
parent uniquement. Doc : `SPEC-SYSTEM-VIEW` §Vue Excel / §Vue Word / §Configuration des
champs / §Persistance. Voir `specs/T162.md`, `specs/T162-design.md`, `specs/T162-sprint1.md`.

### T159 — Bug : modifs d'un champ richtext perdues en vue Édition (+ T161 : titre/desc d'une exigence créée depuis l'arbre)

**Statut** : Done — mergé sur master

**Description** : en vue Édition, un champ `richtext` n'avait aucun autosave (contrairement
aux vues Excel/Word) ; sa seule persistance était un *flush* à la navigation
(`handleBack` + cleanup de démontage T127), absent dès qu'`EditView` reste monté et que
seul `editingNodeId` change (double-clic sur un autre élément de l'arbre, navigation vers
un objet lié, bascule Exigences/Tests). Vecteur additionnel : un refetch de la query
`['object']` pendant l'édition (blur d'un autre champ, retour de focus fenêtre) écrasait
`localValuesRef` via l'effet `[objectData]`.

Volet **T161** absorbé (signalé sur `handstickProduct` / `VE22D`) : une exigence créée
depuis l'arbre de la Vue Système s'ouvrait vide — `title: "Sans titre"` et `fields: {}` —
faute de synchro titre ↔ nom d'arbre au renommage inline (course avec la création async de
`createItemObject`) et pour la même root cause richtext que T159.

Correctif : autosave debouncé du richtext, miroir `localValuesRef` propriété exclusive de
l'effet `[objectData]` (protégé des refetch), flush ciblé de l'objet sortant au changement
d'élément, `handleFlushEditValues` async avec retry sur échec, sérialisation des écritures
par fichier côté main (`withKeyLock` dans `RequirementsService`/`TestsService` — ferme
aussi la course latente pré-existante d'Excel/Word), synchro titre via
`ElementTree.onItemRenamed` / `SystemPanel.handleItemRenamed` + rattrapage dans
`createItemObject`. Voir `specs/T159.md`.

### T158 — Évolution : Ctrl+Entrée valide la saisie dans un champ richtext

**Statut** : Done — mergé sur master

**Description** : dans un champ `richtext` (`RichTextField.tsx`, éditeur TipTap),
`Ctrl/Cmd+Entrée` n'avait aucun effet métier — l'extension `HardBreak` de starter-kit
mappe `Mod-Enter` sur un saut de ligne et consomme l'évènement. Ajout d'une extension
TipTap `submitOnModEnter` (`priority: 1000`) + prop `RichTextField.onSubmit`, câblée sur
l'action primaire de chaque contexte d'édition richtext : popover Vue Tableau (ferme),
champ inline Vue Document (`commit`), `EditView` (flush), formulaires de création
(submit), pages détail req/test (« Enregistrer »), cellules `StepsTable`, édition des
champs de campagne, commentaires d'exécution. `Maj+Entrée` reste le saut de ligne ; sans
`onSubmit` le comportement TipTap par défaut est préservé (lecture seule incluse). Doc :
`SPEC-REQ` §3.2e. Voir `specs/T158.md`.

### T157 — Évolution : afficher l'adresse du repo GitHub sous le nom du projet

**Statut** : Done — mergé sur master

**Description** : dans le panneau latéral "Projet" (`ProjectPanel.tsx`), seul le nom
d'affichage du projet était visible. Ajout d'une ligne secondaire sous ce nom, affichant
l'URL du remote `origin` du repo root (adresse GitHub) quand un remote est configuré —
nouveau champ `ProjectInfo.remoteUrl`, lu dans `WorkspaceService.resolve()` via
`git.listRemotes` (même pattern que `sync.service.ts`/`workspace-tree.service.ts`).
Voir `specs/T157.md`.

### T156 — Bug : `.polenta/tree.cache.yaml` versionné par erreur, bloque les gardes "repo propre"

**Statut** : Done — mergé sur master

**Description** : découvert en testant T155 — `WorkspaceTreeService.writeCache()` écrit
`.polenta/tree.cache.yaml` (chemins absolus locaux, timestamp changeant à chaque écriture) sans
jamais garantir qu'un `.gitignore` l'exclut. `createNewProject`/`openProject`
(`workspace.service.ts`) ne protégeaient ce fichier que par accident dans un seul cas, jamais dans
le cas d'adoption d'un repo existant — d'où un repo qui apparaît "modifié" en permanence peu après
ouverture, bloquant le bouton Rafraîchir (T153) et l'auto-pull (T155). Correctif centralisé dans
`writeCache()` elle-même (garantit le `.gitignore` avant chaque écriture, quel que soit
l'appelant) + nettoyage du fichier déjà suivi dans ce repo (`apps/desktop/PL/.polenta/tree.cache.yaml`).
Voir `specs/T156.md`.

### T155 — Évolution : auto-pull périodique en tâche de fond

**Statut** : Done — mergé sur master

**Description** : suite à T153 (bouton "Rafraîchir") et T154 (sécurisation de "Publier") — un
utilisateur non git-initié ne devrait jamais avoir à connaître l'existence d'un pull. Ajout d'un
auto-pull en tâche de fond (`useAutoPull`, monté dans `AppLayout.tsx`), qui tourne toutes les
5 minutes tant qu'un projet est ouvert (indépendamment de l'onglet actif, pas de pull à l'ouverture
du projet elle-même). Utilise une nouvelle méthode `SyncService.pullFastForwardOnly` (jamais de
vrai merge — une opération silencieuse ne doit jamais pouvoir écrire de marqueurs de conflit).
Ignore tout repo avec des modifications en attente. Voir `specs/T155.md`.

### T152 — Bug : ECONNRESET au clone d'un repo distant derrière un proxy d'entreprise

**Statut** : Done — mergé sur master

**Description** : Sur un poste d'entreprise derrière un proxy, le login GitHub (Device
Flow) fonctionnait mais le clone d'un projet échouait avec `read ECONNRESET`. Root cause :
le commit `7701f1f` (« organization proxy support ») n'avait rendu proxy-aware que
`auth.service.ts`, pas le transport git (`isomorphic-git/http/node`, basé sur les modules
`http`/`https` natifs de Node, sans connaissance du proxy). Voir `specs/T152.md` pour le
détail et le correctif (`git-http.ts`).

### T150 — Bug : version non incrémentée au retour approved → draft

**Statut** : Done — mergé sur master

**Description** : Une fois qu'une exigence est passée en statut `approved`, si elle repasse
en `draft` (retrait d'approbation / nouvelle itération), son champ `version` doit s'incrémenter.
Ce n'était pas le cas via la colonne Statut de la vue Excel (chemin `transition()`),
contrairement au bouton dédié « Reopen draft » de la vue Word (chemin `openDraft()`).
Voir `specs/T150.md` pour le détail.

---

### T176 — Évolution : Vue Excel — édition au double-clic / F2, sans lag, sans changement de style, curseur au point cliqué

**Contexte** : il fallait deux clics séparés pour éditer une cellule (sélection puis édition), avec un lag
perceptible ; l'éditeur texte (`<input>` sur fond bleu) décalait le texte, plaçait le curseur en fin et
aplatissait les listes `- …` des champs `text` (retours à la ligne supprimés à l'enregistrement).

**Implémentation (2 sprints + 3 correctifs)** :

- **Gestes** — clic = sélection seulement ; double-clic ou **F2** = édition / liste / popover / dépliage de
  toute cellule éditable (texte, nom, richtext, enum, multi_enum, liens, étapes, nom de dossier)
  (`excelCellStore.ts`, `useCellGestures`).
- **Éditeur texte iso-typographique** (`ExcelTextEditor.tsx`) — `<textarea>` transparent, même position du
  texte qu'en lecture, multi-ligne pour `text` / `textarea` ; Entrée = ligne, Ctrl+Entrée = valider, Échap =
  annuler ; valider sans modification n'écrit rien.
- **Curseur au point cliqué** — texte : `rawOffsetAtPoint` (`excelCaret.ts`) ; richtext : prop `initialCaret`
  de `RichTextField` (`posAtCoords`).
- **Réactivité** — cellule sélectionnée hors état React (store), cellules `memo` + actions stables par
  contexte : 300 éléments, changement de ligne 60 → 20 ms, double-clic → éditeur texte 69 → 28 ms.
- **Correctifs** — curseur richtext hors écran après défilement ; `RichTextField` : deux effets gardés par un
  drapeau « premier passage » consommé par `StrictMode` (dev) appelaient `setContent` → curseur en fin de
  contenu et sauvegarde parasite (tous les champs richtext) ; fond blanc de l'éditeur richtext en cellule.
- Driver `run-desktop` : commande `dblclick-at` (double-clic réel à des coordonnées calculées).

Voir `specs/T176.md`, `specs/T176-design.md`, `specs/T176-sprint1.md`, `specs/T176-sprint2.md`.

---

### T170 — Évolution : hauteur max des lignes Vue Excel — « toutes les lignes » au bout du slider

**Contexte** : T168 limitait la hauteur des lignes de la Vue Excel à 20 lignes au maximum.

**Implémentation (1 sprint)** :

- **`RowMaxHeightButton.tsx`** — position supplémentaire `ROW_MAX_LINES_ALL` (= 21) au bout du
  slider, libellée « Toutes les lignes » / « All lines » (i18n `system.excelView.rowMaxLinesAll`).
- **`SystemView.tsx`** — plage persistée [1, 21] (clé `polenta:excelRowMaxLines`) ; passe
  `Infinity` à `ExcelView` en position 21.
- **`ExcelView.tsx`** — `useCellClamp` sans `line-clamp` et `RichtextClamp` sans `max-height` ni
  estompage quand `maxLines` est infini ; le reste suit le comportement N > 1.

Voir `specs/T170.md`.

---

### T172 — Évolution : revalidation (`needsRevalidation`) — marquage automatique des éléments impactés

**Contexte** : SPEC-REQ §5.3 prévoyait qu'une modification signale un impact sur ce qui est lié,
mais le code ne faisait que lire un flag `ObjectLink.needsRevalidation` que rien n'écrivait.
Recadré en phase Spec : le flag est porté par les **éléments** (exigences, tests), pas par les
liens ; pas de bouton « Revalider » (levée du flag → T173).

**Implémentation (1 sprint)** :

- **`RevalidationService.markImpactedBy`** (nouveau, point d'entrée réutilisé par T171) : quand
  un élément quitte un statut `isApproval` (`openDraft`, `transition`, `tests.update` avec
  statut), chaque élément à l'autre bout d'un de ses liens (sens/type indifférents, tous les
  repos du workspace) reçoit `needsRevalidation: true` dans son YAML. Exclus : l'élément
  lui-même, les éléments terminaux, readonly (nœud local ou repo monté sous un nœud readonly),
  orphelins. Statut, version et `links.yaml` inchangés ; déclenché hors du verrou de l'élément,
  au mieux.
- **Lecteurs** basculés sur le flag de l'élément : matrice (cellule/statut de couverture),
  maturité (critère 5), compliance d'interface, Query Builder (colonne sur exigences/tests),
  `revalidationItems`. Supprimés : `computeNeedsRevalidation`, IPC `interface:needs-revalidation`,
  `findLinksNeedingRevalidation`, `computeRevalidationReqIds`. `ObjectLink.needsRevalidation`
  déprécié.
- **UI** : `RevalidationFlag` (⚠ « Impact à vérifier ») à côté du statut dans Excel, Word et
  Édition ; invalidation élargie après une réouverture ou un changement de statut.

Voir `specs/T172.md`, `specs/T172-design.md`, `specs/T172-sprint1.md`.

---

### T169 — Évolution : rendu richtext et édition dans la cellule (Vue Excel)

**Contexte** : depuis T168 (hauteur max des lignes, 10 par défaut), une cellule `richtext`
affichait tout son Markdown **brut** (`**`, `#`, JSON des blocs ` ```drawio ` / ` ```image `),
et l'édition passait par une popup flottante décalée de la cellule.

**Implémentation (1 sprint)** :

- **`lib/staticRichText.tsx`** — prop `variant?: 'default' | 'compact'` sur
  `StaticRichTextViewer` ; constante exportée `VIEWER_CLASS_COMPACT` (text-xs, titres au corps du
  texte, sans marges verticales), partagée entre la lecture et l'édition.
- **`components/system/useRenderWhenVisibleAtRest.tsx`** (nouveau) — `RenderGateProvider` (un
  IntersectionObserver `rootMargin: 0` + un listener `scroll`, repos = 150 ms) et
  `useRenderWhenVisibleAtRest` : une cellule n'est rendue que si elle est visible **et** que le
  défilement est au repos, et les lignes seulement traversées ne le sont jamais.
- **`components/RichTextField.tsx`** — prop `variant="compact"` : typographie identique à la
  lecture, sans hauteur minimale ni bordure propre, marges de la cellule.
- **`components/system/ExcelView.tsx`** — `RichtextCell` + `RichtextClamp` : à N > 1, rendu mis
  en forme limité à N lignes (`max-height` + `mask-image` si débordement), texte brut tant que
  la cellule n'est pas visible au repos, et N = 1 inchangé. Popup supprimée : édition **dans la
  cellule** (toolbar partagée, hauteur = contenu, contour `ring-2`), sorties
  `Ctrl/Cmd+Entrée` / clic extérieur / `Échap` (restauration multi-sélection T149). Clic
  extérieur détecté par un drapeau `onMouseDown` React, qui couvre les menus par portail (menu
  de tableau, page draw.io). Ligne éditée : sans DnD ni `select-none`, clic droit réservé à
  l'éditeur, maintenue affichée malgré les filtres (retour `/code-review`).

**Vérification** : `tsc --noEmit` (apps/desktop) propre ; `/code-review` (1 défaut corrigé) ;
scénarios manuels validés par l'humain. Léger saut de défilement à la remontée lors du rendu,
jugé acceptable. Implémenté directement sur `main`, sans worktree (décision utilisateur). Doc :
`SPEC-SYSTEM-VIEW` §Vue Excel, `SPEC-REQ-requirements` §3.2a, `SPEC-INDEX` (MAJ → T169). Voir
`specs/T169.md`, `specs/T169-design.md`, `specs/T169-tests.md`, `specs/T169-sprint1.md`.

### T168 — Évolution : hauteur max des lignes dans la vue tableau (Excel)

**Contexte** : dans la Vue Excel, toutes les cellules étaient mono-ligne tronquées
(`truncate`) — un énoncé ou un richtext long (dont seule la première ligne était montrée)
n'était lisible qu'en ouvrant l'éditeur.

**Implémentation (1 sprint)** :

- **`components/system/RowMaxHeightButton.tsx`** (nouveau) — bouton de toolbar (icône SVG
  inline `RowHeightIcon`, style lucide : double flèche verticale + cadre) ouvrant une popup
  avec un slider 1–20 et la valeur « N ligne(s) » ; constantes `ROW_MAX_LINES_MIN` /
  `ROW_MAX_LINES_MAX` / `ROW_MAX_LINES_DEFAULT` (1 / 20 / 10).
- **`SystemView.tsx`** — état `excelRowMaxLines` persisté en `localStorage`
  (`polenta:excelRowMaxLines`, commun à tous les projets, défaut **10** — décision
  utilisateur, valeur hors plage ignorée) ; bouton visible en Vue Excel hors campagnes ;
  prop `rowMaxLines` passée à `ExcelView`.
- **`ExcelView.tsx`** — `RowMaxLinesContext` + hook `useCellClamp()` : `truncate` à 1, sinon
  `-webkit-line-clamp: N` + `white-space: pre-wrap` ; appliqué à `NameCell`, `InlineCell`
  (système, texte, enum, richtext, `multi_enum`) et aux cellules de lien ; `align-top` sur les
  lignes d'élément si N > 1 ; richtext : toutes les lignes non vides si N > 1.
- **i18n** FR/EN : `system.excelView.rowMaxHeight`, `rowMaxLines_one/_other`.

**Vérification** : `tsc --noEmit` (apps/desktop) propre ; validé par l'humain. Pas de runner de
tests dans `apps/desktop`. Implémenté directement sur `main`, sans worktree (aucun autre dev
en cours), spec rédigée a posteriori. Doc : `SPEC-SYSTEM-VIEW` §Toolbar, §Vue Excel,
§Persistance ; `SPEC-INDEX` (MAJ → T168). Voir `specs/T168.md`.

---

### T167 — Évolution : Vue Recherche — liste des résultats (style Vue Word) + édition inline dans la zone principale

**Contexte** : la Vue Recherche (`/search`) avait un panneau latéral fonctionnel mais une
zone principale vide depuis T107 — rien ne s'y passait au lancement d'une recherche.

**Implémentation (2 sprints)** :

- **`lib/searchQuery.ts`** — utilitaires purs extraits de `SearchPanel` (`buildRegex`,
  `findMatches`, `replaceInText`, types `SearchResult`/`SearchOpts`/…).
- **`contexts/SearchContext.tsx`** — `SearchProvider` monté dans `AppLayout`
  (`key={currentProjectId}`), état de recherche partagé entre `SearchPanel` (sidebar) et
  la route `/search` (`<Outlet/>`). `enabled: !!regex` conservé → aucun fetch au repos.
  `useSearch()` (throw) + `useOptionalSearch()` (repli si `/search` sans projet).
- **`SearchPanel`** — devient consommateur du contexte. Clic simple sur un résultat =
  **goto** (`setGoto`) au lieu de naviguer vers la page détail.
- **`components/search/SearchResultsDoc.tsx`** — zone principale : une carte **lecture
  seule** par élément (présentation Vue Word, tous types mélangés, **pas de vue Tableau**,
  pas de dossiers). Occurrences surlignées (`<mark>`) dans id/titre/champs texte et
  `richtext` (best effort). `useScrollToNode` + contour bleu pour le goto ; étapes de test
  en liste lecture seule (pas de `StepsTable`, qui monterait N éditeurs TipTap).
- **`lib/staticRichText.tsx`** — prop optionnelle `highlightRegex` + effet `TreeWalker`
  (`clearSearchHighlights` avant chaque passe, ignore `pre`/`code`/`.static-drawio`) ;
  inerte sans la prop → zéro impact Vue Word.
- **`components/search/SearchEditPane.tsx`** — double-clic sur une exigence / un test →
  **édition inline** via `EditView` (le même composant que le double-clic en Vue Système :
  autosave par champ, Liens, Étapes, badge couverture, `Ctrl+Entrée`, `Échap`/« Retour aux
  résultats »), **sans quitter `/search`** (état `editing` du contexte, pas de navigation
  routeur). Version allégée de `SystemView` : pas d'arbre (le champ « Nom » édite le
  `title`), pas d'undo/DnD/création/`backHistory` ; objet lié → nouvel onglet ; `readOnly`
  via `useVersioning().isReadonly`. Reseed des étapes uniquement au changement d'objet,
  flush des étapes non sauvegardées de l'objet sortant.
- **campagne** (pas d'endpoint `update` générique) : double-clic → navigation
  `/campaign/$id`.

**Vérification** : `pnpm -C apps/desktop typecheck` propre ; `electron-vite build` OK ;
`/code-review high` sur chaque sprint (4 + 3 findings corrigés — gardes `rawFields`,
`<mark>` qui s'empilaient, `useSearch` hors provider, id/titre non surlignés ; puis
perte d'édition d'étape au refetch, invalidations manquantes, code mort). Pas de runner
de tests dans `apps/desktop` — scénarios manuels dans `specs/T167-tests.md`. Doc :
`SPEC-ELECTRON-DESKTOP` §19.3 + §19.17 (nouvelle), `SPEC-SYSTEM-VIEW` §Goto, `SPEC-REQ`
§3.2a, `SPEC-INDEX` (MAJ → T167). Voir `specs/T167.md`, `specs/T167-design.md`,
`specs/T167-sprint1.md`, `specs/T167-sprint2.md`. Mergé sur `master` (`--no-ff`).

---

### T166 — Bug : Vues Word et Excel n'honorent pas le mode du filtre global (casse / mot entier / regex)

**Contexte** : découvert pendant T164. La barre de filtre du panneau latéral Vue Système porte
3 options (`FilterOptions` : `caseSensitive`, `wholeWord`, `regex`). L'arbre latéral
(`getMatchingIds`) les honorait via une `RegExp` maison (regex invalide → vide l'arbre). Les
Vues Word/Excel, elles, ignoraient totalement `filterOptions` — `SystemView` ne les transmettait
même pas — et filtraient en sous-chaîne littérale insensible à la casse. En mode **regex**, une
saisie type `SW.*01` matchait dans l'arbre mais `.includes('sw.*01')` échouait partout → la vue
document se vidait et le *goto* T164 devenait un no-op silencieux sur tous les résultats.

**Décision Spec** : périmètre de recherche **unifié** — l'arbre latéral, la Vue Tableau et la
Vue Document cherchent tous dans nom du nœud + `objectId` + **toutes les valeurs de champs**
(champs masqués inclus). Regex invalide n'exclut aucune ligne ni aucun nœud (comme le filtre
par colonne T51).

**Implémentation** : `WordView`/`ExcelView` — `buildFilterRegex(filter, filterOptions ??
NO_FILTER_OPTIONS)` pour le filtre global, chaque valeur testée séparément (pas de haystack
joint). `SystemView` passe désormais `filterOptions`. `getMatchingIds`/`treeVisibleNodes` —
passent à `buildFilterRegex` (regex invalide n'exclut plus rien) + nouveau param
`searchTextByObjectId: Map<string,string>`. `SystemPanel` construit cette map
(`Object.values(normalizeObject(obj)).join(' ')`) et charge les objets via un nouveau hook
partagé `renderer/hooks/useSystemObjects.ts` — query `['objects', repoPath, category, nodeId,
typeId]` extraite de `SystemView` (même `queryKey` ⇒ cache mutualisé, aucun fetch en double).
`NO_FILTER_OPTIONS` exporté de `lib/textFilter.ts`. `escapeRegex` local de `useTreeState`
supprimé (inutilisé).

**Vérification** : `pnpm -C apps/desktop typecheck` propre. `turbo lint` OK (`@polenta/desktop`
n'a pas de script lint). Pas de runner de tests dans `apps/desktop` — scénarios manuels dans
`specs/T166.md`. `SPEC-SYSTEM-VIEW.md` (§Filtre : nouveau paragraphe mode + périmètre ; §Goto :
suppression de la mention « divergence de filtre en mode regex ») et `SPEC-INDEX.md`
(§global → T166) mis à jour. Mergé sur `master` (`--no-ff`).

---

### T163 — Vue Word : diagrammes draw.io des richtext rendus en lecture (rendu paresseux)

**Contexte** : en Vue Word lecture, `StaticRichTextViewer` (rendu markdown-it sans éditeur
Tiptap, pour tenir tout le document d'un coup) remplaçait chaque bloc `drawio` d'un champ
`richtext` par une étiquette `📐 nom-de-fichier` — le diagramme n'apparaissait qu'en passant
le champ en édition. Choix de perf : un viewer canvas draw.io par champ × N éléments gelait
l'onglet (≈281 items × 3 champs sur PL/Product). C'était aussi une divergence non documentée
vs SPEC-REQ §3.2a. Objectif : rendre le diagramme en lecture **sans** régression de perf.

**Implémentation** : la *fence* `drawio` émet un placeholder `<span class="static-drawio">`
(dims stockées en `min-width`/`min-height` pour réserver la place, badge `📐` en repli ;
contenu non-JSON → bloc omis comme avant). Nouvel `useEffect` dans `StaticRichTextViewer` :
`IntersectionObserver` (root = conteneur défilant le plus proche, `rootMargin 300px`) qui
monte le vrai viewer mxGraph vendoré à l'approche du viewport, **une seule fois** par
occurrence (pas de re-rendu au scroll ni au focus fenêtre). Nouveau module
`renderer/lib/staticDrawio.ts` : `computeDrawioLayout` (fonction pure, géométrie crop/taille
répliquée de `ResizableMediaFrame` mode non-éditable) + `renderStaticDrawio` (rendu
impératif `outer > inner > .mxgraph` + overlay transparent ; mesure `ResizeObserver`
content-box ; teardown qui annule l'async, coupe l'observer et **démonte le graphe**
`graph.destroy()` — le `GraphViewer` vendoré n'a pas de `destroy()` et fuit un listener
`matchMedia`). `inner` reçoit une largeur explicite d'emblée pour forcer la création
synchrone du graphe (sinon `checkVisibleState` la diffère via un `MutationObserver` interne
→ orphelin possible). Clic sur le diagramme → `pointer-events:none` + overlay sans
gestionnaire → le clic remonte au champ qui passe en édition (le `DrawioEmbedView`
interactif prend le relais). Erreurs (`repoPath` absent, fichier introuvable, XML invalide,
échec chargement viewer) → repli badge ou message inline `system.richTextViewer.*`, jamais
de crash. Mutualisation : `inlineDrawioViewerConfig` (`drawioViewerLoader.ts`) et
`parseDrawioFencePayload` (`tiptap/mediaAttrs.ts`) partagés avec `DrawioEmbedView` /
`DrawioEmbedExtension`. MAJ SPEC-REQ §3.2a (nouveau point « Rendu en lecture, Vue Word ») +
§3.2b (interaction vs présence), SPEC-SYSTEM-VIEW §Vue Word, SPEC-INDEX.

**Décisions** : QO1 surlignage de cellule non implémenté en v1 (page contenante affichée) ;
QO2 léger étalement `requestAnimationFrame` avant chaque construction de viewer (pas de file
coordonnée) ; QO3 root = conteneur défilant (pas le viewport) ; QO4 un `IntersectionObserver`
par instance de `StaticRichTextViewer`.

**Limitation connue** : un diagramme **sans** `width`/`height`/`crop` stockés ne peut pas
réserver sa place → léger décalage du document quand il se rend au défilement (le composant
live a le même transitoire : 400×300 puis recalage). Pas de runner de test dans le repo →
validé par les scénarios manuels de `specs/T163-tests.md`.

### T164 — Clic simple sur un élément de l'arbre → *goto* dans la vue de droite

**Contexte** : dans la Vue Système (onglets Exigences / Tests), le clic simple sur un nœud de
l'arbre `ElementTree` n'avait aucune action (sélection locale seule) ; seul le double-clic
ouvrait la Vue Édition. Objectif : au clic simple, faire défiler la vue Word/Excel **déjà
affichée** jusqu'à l'élément et l'encadrer — sans changer de `viewMode`. Décisions validées :
contour persistant ; no-op en Vue Édition ; clic sur un dossier → *goto* sur son en-tête de
section / ligne de groupe ; multi-sélection → pas de *goto* ; dépôt d'un drag & drop → *goto*
sur le 1er nœud déplacé ; vues Recherche et Campagnes hors scope (déjà satisfaisantes).

**Implémentation** : nouvel état `gotoTarget { nodeId, seq }` dans `SystemViewContext`
(`requestGoto` / `clearGoto`, `gotoSeq` pour re-scroller sur cible identique), réinitialisé au
changement de composant/type. `ElementTree` gagne une prop `onGoto` appelée par `handleSelect`
(clic sans modificateur), `handleClickEmpty` (→ null) et la fin de `handleDrop`. `SystemPanel`
relaie via `handleGoto`, **no-op tant que `editingNodeId !== null`** (Vue Édition inerte, garde
à la source). `SystemView` passe `gotoNodeId` / `gotoSeq` à `WordView` / `ExcelView` et appelle
`clearGoto()` à l'entrée en Édition. Nouveau hook partagé
`renderer/hooks/useScrollToNode.ts` (`querySelector('[data-node-id]')` + `scrollIntoView`).
`WordView` : `data-node-id` + anneau `ring-2 ring-status-info-solid` sur `ItemCard` et les
en-têtes de dossier. `ExcelView` : `data-node-id` + `scroll-mt-8` (sous le `<thead>` sticky) +
`outline-2 outline-status-info-solid` sur la `<tr>` élément et la `<tr>` de `GroupRow`.

**Limitation connue** (→ **T166**) : `WordView` / `ExcelView` filtrent leur contenu par
sous-chaîne littérale alors que l'arbre honore `filterOptions` ; en mode **regex** actif, une
ligne visible dans l'arbre peut ne pas être rendue dans la vue → *goto* = no-op silencieux
(comportement déjà prévu par la spec). Divergence arbre/vues **préexistante**.

**Vérification** : `pnpm -C apps/desktop typecheck` propre (avant et après merge). `/code-review`
(medium) — 2 tours : 4 findings corrigés (fuite d'état *goto* au retour d'Édition, garde
manquante, occlusion `<thead>`, duplication de l'effet → hook), 1 finding documenté (limitation
regex). `routeTree.gen.ts` non modifié. Pas de runner de tests dans `apps/desktop` — scénarios
manuels dans `specs/T164-tests.md`. `SPEC-SYSTEM-VIEW.md` (§Sélection, §Drag & Drop, §Vue
document, §Vue Excel, §Vue Word) et `SPEC-INDEX.md` (§global → T164) mis à jour. Mergé sur
`master` (`--no-ff`).

---

### T149 — Vue Excel : édition en masse sur une sélection multiple de lignes

**Contexte** : décision validée avec l'utilisateur — propagation automatique dès qu'une édition
inline est commise sur une ligne faisant partie de la sélection (pas de raccourci type
Ctrl+Entrée ni de menu contextuel dédié), portée sur tous les champs édités inline (statut/enum,
texte simple, richtext, cases `multi_enum`) — pas seulement le statut.

**Implémentation** : `apps/desktop/src/renderer/components/system/ExcelView.tsx` — nouvelles
fonctions `applyInlineEditToSelection` (statut/enum/texte/richtext : même valeur écrasée sur tous
les objectId de la sélection) et `applyMultiEnumToggleToSelection` (cases à cocher : bascule
indépendamment la même valeur sur chaque ligne sélectionnée, sans écraser les autres valeurs déjà
cochées propres à chaque ligne — évite de perdre les tags d'un objet B en cochant/décochant un tag
sur l'objet A pendant que B est aussi sélectionné). Nouvelle map `nodeId <-> objectId` (les IDs de
sélection sont des nodeId d'arbre, distincts des objectId métier). Le popover richtext capture
désormais la valeur d'origine de CHAQUE objet affecté (`richtextOriginalValuesRef`, plus seulement
celle de l'objet édité) pour restaurer correctement chacun à l'annulation (Échap). Colonnes
`link::` explicitement hors scope (mécanisme dédié via `LinkCombobox`, pas de notion de "valeur" à
propager).

**Vérification** : `tsc --noEmit` propre sur `@polenta/desktop`. `specs/SPEC-SYSTEM-VIEW.md`
§Vue Excel mis à jour (sélection multiple + édition en masse). Non vérifié interactivement dans
l'app avant archivage.

---

### T148 — Retirer les dashboards pré-configurés "Couverture", "Avancement", "Maturité"

**Contexte** : dashboards livrés en T77 sprint 3, avec leurs 7 requêtes sauvegardées associées —
seul le dashboard "Status" doit rester seedé automatiquement au premier accès à l'onglet "Suivi".

**Implémentation** : `apps/desktop/src/main/services/dashboard-seed.service.ts`
(`SEED_QUERIES`/`SEED_DASHBOARDS` réduits aux 2 requêtes/1 dashboard "Status"),
`specs/SPEC-DASHBOARDS.md` §5.1 mis à jour. Le calcul sous-jacent (`coverageStatus`, `maturity*`
dans `query-engine.service.ts`/`maturity.util.ts`) non touché — toujours utilisé ailleurs (badges
Excel, etc.), seuls les 3 dashboards/7 requêtes pré-configurés disparaissent. Fixtures locales déjà
seedées avant ce correctif (`apps/desktop/PL/Product/dashboards/DASHBOARD-000{1,2,3}.yaml`,
`queries/QUERY-000{1..7}.yaml`) supprimées manuellement pour rester cohérentes (le marqueur
`.seeded.yaml` empêche un reseed, donc un nettoyage ponctuel était nécessaire).

**Vérification** : `tsc --noEmit` propre. Vérifié interactivement (build + Playwright `_electron`,
script `run-desktop`) : sur `apps/desktop/PL/Product` (déjà seedé avant le correctif), l'onglet
"Suivi" affiche désormais "Aucun dashboard" ; sur un projet neuf créé à la volée, le seed ne crée
bien que le dashboard "Status" avec ses 2 widgets.

---

### T147 — ActivityBar restait en slate-900 (sombre) en mode clair

**Contexte** : comportement volontairement figé lors de T116 (`specs/T116-design.md` §"2 familles
volontairement figées"), mais signalé par l'utilisateur comme un défaut visuel en mode clair.
Décision validée avec l'utilisateur : rendre l'ActivityBar adaptative au thème.

**Implémentation** : `apps/desktop/src/renderer/theme.config.ts` — les 6 tokens `activity-*`
reçoivent désormais des valeurs `light` distinctes (slate-100/200/600/900, réutilisant la palette
déjà tokenisée côté clair : `surface-hover`, `edge`, `ink`, `ink-2`, `ink-3`), le thème `dark`
garde ses valeurs T116 d'origine (slate-900/800/700/400) à l'identique. `index.css`/
`tailwind.theme.generated.js` régénérés via `pnpm theme:generate` (jamais édités à la main).

**Vérification** : `tsc --noEmit` propre. Vérifié interactivement (build + Playwright `_electron`,
script `run-desktop`) : capture en mode clair → ActivityBar en slate-100/slate-600, cohérente avec
le reste de l'UI ; capture en mode sombre → rendu identique pixel pour pixel à avant le correctif.

---

### T146 — Perf : freeze au chargement de l'onglet "Exigences" (~281 exigences)

**Contexte** : reproduit sur `apps/desktop/PL/Product` (281 exigences). Signalé comme apparu
"depuis le split Système → Exigences/Tests/Campagnes (T145)" ; vérifié non lié — reproduit à
l'identique en mettant de côté (`git stash`) les modifs T145 et en rebuild sur l'ancien code.

**Root cause** : `RichTextViewer` dans `WordView.tsx` (vue Document) montait un éditeur
Tiptap/ProseMirror complet (`useEditor`, même en lecture seule) pour CHAQUE champ richtext de
CHAQUE exigence affichée, sans virtualisation de la liste — pour `PRODUCT_REQ` (3 champs richtext)
× 281 exigences, ~840 éditeurs montés d'un coup au chargement de l'onglet. Mesuré via un script
Playwright sondant `performance.now()` toutes les 200ms pendant le rendu : ~0.5-1s de blocage du
thread renderer par sondage, avant et après T145 à l'identique.

**Implémentation** : nouveau `apps/desktop/src/renderer/lib/staticRichText.tsx`
(`StaticRichTextViewer`) — rend le markdown en HTML statique via `markdown-it` (déjà utilisé en
interne par `tiptap-markdown`, ajouté en dépendance directe du package desktop) au lieu
d'instancier un éditeur ; les blocs `image`/`drawio` (encodage markdown custom de
`ResizableImageExtension`/`DrawioEmbedExtension`) sont interceptés spécifiquement (image :
résolution asynchrone du chemin repo-relatif via `api.image.read`, une fois par image réelle ;
drawio : badge statique, pas de rendu canvas live). `RichTextField` (édition inline, un seul champ
actif à la fois) n'est pas touché.

**Vérification** : revérifié après correctif avec le même script de sondage : plus aucun blocage
détecté sur les mêmes 281 exigences ; édition inline testée manuellement (clic sur un champ
richtext → l'éditeur Tiptap s'ouvre normalement). `tsc --noEmit` propre.

---

### T143 — Bug : champ "description" invisible après mise à jour via MCP (non résolu à l'archivage)

**Symptôme** : lorsqu'une exigence est mise à jour via le serveur MCP, le rechargement dynamique
dans l'UI fonctionne (titre/statut/etc. se mettent à jour) mais le champ "description" n'apparaît
pas à l'écran.

**Piste explorée** : "description" n'est pas un champ système de `Requirement`
(`packages/types/src/requirement.ts`) — ce ne peut être qu'un champ custom `fields.description`
déclaré dans `objectTypes[].fields[]` du `schema.yaml` du type visé. Or le type concerné (ex.
`exigence-ve11b` dans `apps/desktop/PL/Product/.polenta/schema.yaml`) ne déclare que `statement`,
pas `description`. Le rendu (`apps/desktop/src/renderer/routes/req.$reqId.tsx`) itère sur
`typeDef.fields` (la liste déclarée au schéma), jamais sur les clés réellement présentes dans
`req.fields` — donc toute clé `fields.*` non déclarée est silencieusement absente de l'écran, sans
erreur. Côté MCP, `bulk_import_requirements` (`apps/desktop/src/mcp-server/tools/bulk-import.tools.ts`,
seul point d'écriture — pas de tool `update_requirement` dédié) n'a pas de validation qui empêche
d'écrire une clé `fields.*` non déclarée au schéma : la valeur est bien écrite/lue sur disque, juste
invisible dans l'UI.

**Statut à l'archivage** : root cause identifiée mais pas de correctif appliqué — décision à
prendre (schéma du type concerné doit-il déclarer `description` ? le MCP doit-il valider les clés
`fields` contre le schéma avant écriture ? l'UI doit-elle afficher en secours les clés `fields` non
couvertes par le schéma ?). À rouvrir si le comportement redevient prioritaire.

---

### T142 — Perf : indexation exigences/tests O(fichiers × commits) via `GitService.fileHistory()`

**Contexte** : `RequirementsIndexService`/`TestsIndexService` (déclenchée à l'ouverture d'un projet
et à chaque invalidation) appelait `GitService.fileHistory()` (créé/modifié le/par, T112) une fois
PAR FICHIER, et cette fonction (`isomorphic-git` `git.log({filepath})`) rejoue tout l'historique de
commits à chaque appel — coût O(fichiers × commits), qui empire avec la croissance normale du
projet.

**Implémentation** : nouvelle `GitService.fileHistoryMap(repoPath, prefix)` — un seul passage sur
l'historique, diff d'arbre scopé au préfixe contre le premier parent de chaque commit, coût
O(commits). Mesuré sur `specs/` de ce repo (280 fichiers, 536 commits) : ~300s → ~19s (~16×).

**Effet de bord découvert en vérifiant** : l'ancien `fileHistory()` par fichier a un bug sur les
commits de merge — il rapportait des `updatedAt` ne correspondant à aucun commit réel (vérifié
contre `git log` sur 5 fichiers) ; le nouveau code corrige ça au passage (158/280 fichiers de
`specs/` avaient une date fausse).

**Vérification** : `tsc --noEmit` propre. Non vérifié interactivement (pas d'affichage Electron
attachable au moment du correctif) — voir `specs/T142.md` §Comment tester.

---

### T141 — Perf : lenteur au démarrage de l'app (imports statiques lourds au boot)

**Root cause** : `ExportService`/`QueryEngineService`, construits dans `container.ts` dès le boot
(avant `app.whenReady()`), importaient statiquement `exceljs` (~380ms), `alasql` (~60ms) et `docx`
(~28ms) — payés à chaque lancement même sans export ni requête, y compris sur un repo quasi vide.

**Implémentation** : les 8 générateurs d'export (`export/*.xlsx.ts`/`*.docx.ts`) et `alasql` sont
désormais chargés via `import()` dynamique, différé au premier usage réel.

**Vérification** : `tsc --noEmit` et `electron-vite build` propres (build confirme les générateurs
sortis en chunks séparés, plus dans `out/main/index.js`). Non vérifié interactivement (pas
d'affichage Electron attachable au moment du correctif) — voir `specs/T141.md` §Comment tester.

---

### T140 — Nom de dossier affiché au lieu du `label` configuré du nœud `root`

**Symptôme** : dans la config du nœud `root`, le nom du repo (nom de dossier) était affiché
partout dans l'UI au lieu du `label` configuré dans `schema.yaml` — sidebar "Projet" (titre +
header), titre de fenêtre Electron, ligne de repo dans l'onglet Structure, panneau "Version"
(header repo + modales checkout/commit), titre d'onglet du graphe de versions.

**Implémentation** : `WorkspaceTreeNode.label` (nouveau champ, `packages/types/src/polenta-workspace.ts`)
et `ProjectInfo.label` (`packages/types/src/workspace.ts`) propagent désormais le `label` du
SystemNode `root` de chaque repo (lu depuis son propre `schema.yaml`) ; tous les affichages listés
font `label || name`.

**Vérification** : `tsc --noEmit` propre sur `@polenta/desktop`. Non vérifié interactivement (pas
d'affichage Electron attachable au moment du correctif) — à valider dans l'app avant merge.

---

### T139 — Bug : liens supprimés persistent dans la colonne `link::` en vue Excel (non résolu à l'archivage)

**Symptôme** : des liens supprimés (via l'édition d'un objet) continuent d'apparaître dans la vue
Excel, alors qu'ils n'apparaissent plus dans les champs de l'objet (vue Édition).

**Reproduction** : supprimer un lien sur un objet, vérifier qu'il a disparu en vue Édition, puis
regarder la colonne `link::` correspondante en vue Excel pour le même objet.

**Statut à l'archivage** : non investigué — à rouvrir si le comportement redevient prioritaire.

---

### T137 — Bug : bouton "actualiser" du modèle de données sans effet après modif schéma via MCP (non résolu à l'archivage)

**Symptôme** : dans l'onglet modèle de données, le bouton actualiser ne semble pas fonctionner —
un agent via le serveur MCP a modifié le schéma, mais l'UI ne s'est pas rafraîchie ; il a fallu
redémarrer l'app pour que les modifications apparaissent.

**Statut à l'archivage** : non investigué — à rouvrir si le comportement redevient prioritaire.

---

### T130 — Revue complète de la doc de format/architecture (CLAUDE.md + specs/)

**Contexte** : préparation de l'open-sourcing du projet. Un premier passage ad hoc avait déjà
corrigé 3 écarts confirmés (format de stockage, arbre `.polenta/trees/`, sens du lien de couverture
test↔exigence). Le ticket élargit à un audit complet de tous les `specs/SPEC-*.md` contre le code
réel (9 passes parallèles + 2 passes ciblées sur les 2 écarts lourds déjà repérés).

**Décision produit** : aucune correction de code dans le périmètre initial — la doc est alignée
systématiquement sur le comportement réel de l'app v1. Réécriture intégrale de
`SPEC-ELECTRON-DESKTOP.md` §20 (format `.polenta/schema.yaml`, modèle `SystemNode` réel, pas
`requirementTypes`/`.gitmodules`) et §22 (composants en repo séparé via `polenta-repo.yaml`/
workspace plat T69, pas de submodules Git) — plus obsolètes que ce que le ticket avait initialement
repéré. Renumérotation des sections dupliquées (§18-23). Une trentaine de corrections ponctuelles
sur les autres fichiers (`SPEC-TECH-stack.md`, `SPEC-MCP-SERVER.md`, `SPEC-PROJECT-MANAGEMENT.md`,
`SPEC-TESTS.md`, `SPEC-TEMPLATES.md`, `SPEC-REVIEWS.md`) et sur `SPEC-AUDIT.md` (document d'audit
préexistant non référencé dans `SPEC-INDEX.md` jusqu'ici, une entrée périmée retirée — bug déjà
corrigé par T63).

**Découvertes en cours de route** : l'application d'un template n'a aucun mécanisme applicatif du
tout (pas seulement un fichier au mauvais format) ; la création de projet ne contacte jamais de
remote GitHub/Gitea contrairement à ce que documentait `SPEC-PROJECT-MANAGEMENT.md` §9.

**Suite à la relecture humaine**, deux changements hors périmètre doc-only initial : template
`templates/electro-domestic-battery.yaml` supprimé (pas réécrit, faute de mécanisme d'application) ;
support Gitea retiré du code (`auth.service.ts`, listes de remotes suggérés dans
login/account/AccountMenu/AccountPanel) sur demande explicite — seule vraie modification de code de
ce ticket.

Détail complet : `specs/T130.md` (audit), `specs/T130-sprint1.md` (résumé + addendum).

---

### T138 — Badge de couverture de test dans les vues Word, Excel, Édition

**Contexte** : `coverageStatus` (calculé par exigence, `computeCoverage()`/`computeCoverageStatus()`
dans `traceability.service.ts`) n'était visible que de façon agrégée (dashboard "Couverture") ou
via une requête SQL brute dans le Query Builder — aucune des 3 vues de consultation/édition d'une
exigence (Excel/Word/Édition) ne l'affichait par exigence individuelle.

**Implémentation** : nouveau champ système `coverageStatus`, ajouté à la liste des champs système
du panneau ⚙️ "Configuration des champs visibles" (`SystemView.tsx`), proposé uniquement pour les
types de catégorie `requirement`. Désactivé par défaut dans Excel (colonne dédiée) et Word (badge
dans l'en-tête de carte, à côté du statut de cycle de vie) — activable via le panneau ⚙️, comme
n'importe quel autre champ. En Édition, affiché en permanence (hors du pipeline
`orderedFields`/`FieldRow`, champ non éditable) car l'onglet "Édition" du panneau ⚙️ n'existe pas
(écart pré-existant documenté dans `specs/SPEC-AUDIT.md`, non comblé par ce ticket). Nouveau
composant partagé `CoverageBadge.tsx` (icône + tooltip natif listant les tests liés et leur
statut). Réutilise l'endpoint `traceability:matrix` déjà enregistré côté backend mais jusque-là
jamais appelé depuis le renderer — aucune route IPC ajoutée, aucune logique de calcul dupliquée.

Auto-revue avant commit (`/code-review`, effort medium) : 2 corrections apportées — les 3
`onLinkChange` invalident désormais aussi `traceability-matrix` (le badge restait périmé après
ajout/retrait d'un lien test↔exigence dans la même vue) ; le fetch en vue Édition est restreint aux
exigences (`effectiveType?.category === 'requirement'`), évitant un recalcul de couverture inutile
à l'ouverture d'un cas de test.

Vérifié dans l'app buildée (Playwright + Electron), sur un projet de test dédié (schéma +
exigence + test + lien créés via les IPC handlers) : colonne "Couverture" en Excel après avoir coché
le champ dans le panneau ⚙️, badge dans l'en-tête de carte Word, badge toujours visible en Édition —
icône `covered` (test lié, jamais exécuté) correcte dans les 3 vues. `tsc --noEmit` sans erreur.
Détails dans `specs/T138.md`, `specs/T138-design.md`, `specs/T138-tests.md`, `specs/T138-sprint1.md`.

---

### T134 — Clic sur un lien : ouverture dans un nouvel onglet avec Ctrl+clic

**Contexte** : cliquer sur l'ID d'un objet lié (section Liens, vue Document/Word et combobox de
liens) navigue vers cet objet dans l'onglet courant (`navigateToObject`, `SystemView.tsx`). Il
n'existait aucun moyen d'ouvrir l'objet lié dans un nouvel onglet sans d'abord y naviguer puis
utiliser un mécanisme séparé.

**Implémentation** : `navigateToObject` accepte désormais un second paramètre optionnel
`opts?: { newTab?: boolean }`. Quand `newTab` est vrai, la navigation ne réutilise pas le chemin
existant (état local `viewMode`/`pendingNavObjectId` de `SystemView`, propre à l'onglet courant)
mais route via `openTab()` (`TabsContext.tsx`) vers la page autonome `/req/$id` ou `/test/$id` —
le même mécanisme déjà utilisé par la recherche globale (`SearchPanel.tsx`) — car un nouvel onglet
est un remontage de route qui n'a accès à aucun état local de l'onglet d'origine. Les gestionnaires
`onClick` des puces de lien (`WordView.tsx`, `LinkCombobox.tsx`) passent
`{ newTab: e.ctrlKey || e.metaKey }`. `EditView.tsx`/`ExcelView.tsx` ne font que propager le type
et le callback mis à jour, sans changement de comportement propre. Tooltip
`system.shared.clickToNavigate` (`fr.json`/`en.json`) mis à jour pour mentionner le raccourci.

Vérifié dans l'app buildée (Playwright + Electron) : clic simple sur une puce de lien → navigation
dans l'onglet courant (inchangé, bouton "Retour" apparaît, un seul onglet) ; Ctrl+clic → nouvel
onglet ouvert sur la page autonome de l'objet cible, onglet d'origine inchangé. `tsc --noEmit` sans
erreur.

---

### T135 — Drag & drop dans l'onglet Structure du modèle de données

**Contexte** : l'arbre de l'onglet Structure (`StructureTab.tsx`) n'avait que des boutons ↑/↓ pour
réordonner les types d'exigence/test/campagne et les composants/interfaces montés — aucun moyen de
réordonner un composant local, et aucun moyen de changer un élément de parent (composant, composant
local ou type) sans passer par la suppression/recréation.

**Implémentation** (3 sprints, cf. `specs/T135-design.md`) :
- **Sprint 1** — remplacement des boutons ↑/↓ par un glisser-déposer natif HTML5 (même pattern que
  `ReorderableSidebarSection.tsx`, T77), pour les trois types de lignes (éléments, composants
  montés, composants locaux — ces derniers gagnant leur premier réordonnancement). État de drag
  centralisé dans `StructureTab` plutôt que par ligne, pour anticiper les sprints suivants.
- **Sprint 2** — changement de parent par glisser-déposer pour les composants montés
  (`moveDependencyToParent`, réutilise `removeDependency`/`addDependency`) et les composants locaux
  (`moveSystemNode`/`isDescendant`, anti-cycle), avec préservation des rôles d'interface à travers
  le déplacement.
- **Sprint 3** — changement de parent pour les éléments (types), avec cascade côté main process
  (`schema:move-element` → `ElementMoveService`) réécrivant `objectTypeRef` sur les
  exigences/tests existants, et migration du fichier d'ordre d'affichage
  (`.polenta/trees/<nœud>/<type>.yaml`). Restreint aux nœuds du même repo — un déplacement
  cross-repo impliquerait de déplacer des fichiers entre deux repos Git, hors périmètre.

Trois revues de code (une par sprint) ont trouvé et corrigé plusieurs bugs réels avant validation :
un bug de fusion silencieuse au sprint 1 (deux tableaux de stockage distincts traités comme un seul
groupe de réordonnancement), une perte de données possible dans `moveSystemNode` et une
non-restauration de dépendance en cas d'échec au sprint 2, et — trouvé indépendamment par 3 angles
de revue au sprint 3 — l'absence de migration du fichier d'ordre d'affichage, absente du Design
initial.

Vérifié manuellement dans l'app réelle (build + driver Playwright `run-desktop`) à chaque sprint :
réordonnancement, nesting/promotion de composants locaux, anti-cycle, et cascade `objectTypeRef`
tous confirmés fonctionnels de bout en bout. Limitation préexistante documentée (non corrigée, hors
périmètre) : `req.new.tsx`/`test.new.tsx` peuvent écrire un `objectTypeRef` non qualifié que la
cascade ne peut alors pas retrouver — candidat pour un ticket séparé.

Détails dans `specs/T135.md`, `specs/T135-design.md`, `specs/T135-tests.md`,
`specs/T135-sprint1.md`, `specs/T135-sprint2.md`, `specs/T135-sprint3.md`.

---

### T133 — Le clic molette sur un onglet ne le fermait pas

**Contexte** : dans la barre d'onglets, le clic milieu (molette) sur un onglet devait le fermer,
comme dans un navigateur classique. Rien ne se produisait — seul le curseur d'autoscroll natif
apparaissait brièvement.

**Root cause** : `TabBar.tsx` ne gérait que `onClick` (activation) et le clic sur la croix de
fermeture (`stopPropagation` + `attemptCloseTab`) ; aucun handler n'écoutait le clic milieu
(`auxclick`, bouton 1).

**Correctif** : ajout de `onMouseDown` (bouton 1 → `preventDefault`, supprime l'autoscroll natif)
et `onAuxClick` (bouton 1 → `attemptCloseTab(tab.id)`) sur le bouton d'onglet — même point d'entrée
que la croix et Ctrl+W, donc la confirmation de fermeture pour un onglet "dirty" s'applique aussi
au clic molette. Correctif minimal, pas de changement de `TabsContext.tsx`. Détails dans
`specs/T133.md`.

---

### T136 — Vue Système : titre "Sans titre" périmé dans le dropdown d'ajout de lien

**Contexte** : dans la section Liens d'un objet, le dropdown de recherche pour ajouter un lien
affichait le bon ID pour un candidat renommé, mais un titre resté bloqué sur "Sans titre" (ou le
titre précédent le dernier renommage), alors que l'objet lui-même avait bien le titre à jour.

**Root cause (double cause)** : (1) le renommage d'un objet via l'arbre/Excel/Word
(`handleRenameNode`, `SystemView.tsx`) ne mettait à jour que `tree.yaml` — jamais le champ `title`
réel de l'objet (`Requirement.title`/`TestCase.title`), écrit une seule fois à la création (souvent
avec la valeur par défaut "Sans titre") ; (2) même le `title` corrigé, les requêtes React Query
globales `['requirements-all', repoPath]`/`['tests-all', repoPath]` (source de `candidateObjects`
dans `SystemView.tsx`) n'étaient invalidées nulle part après création/renommage, donc jamais
refetchées.

**Correctif** : `handleRenameNode` synchronise désormais `title` sur l'objet après renommage du
nœud d'arbre (chemin partagé par arbre inline, vue Excel et vue Word) ; un helper
`invalidateCandidateObjects()` invalide `requirements-all`/`tests-all` partout où un titre est créé
ou modifié (`SystemView.tsx` et `createItemObject` dans `SystemViewContext.tsx`). Correctif ciblé
sur la synchro et les invalidations manquantes, pas de refactoring du flux de sauvegarde existant.

Reproduit et vérifié corrigé dans l'app buildée (Playwright + Electron) : renommage d'un objet →
`requirements/SYS-0001.yaml` mis à jour, dropdown de recherche de lien reflète immédiatement le
nouveau titre. Détails complets dans `specs/T136.md`.

---

### T132 — popup édition composant : titre figé sur "Renommer `<nom du repo>`"

**Contexte** : la popup d'édition d'un composant (`NodeEditModal`, `StructureTab.tsx`) — qui permet
label, description, rôles exposés et interfaces implémentées, pas seulement un renommage — affichait
le titre "Renommer {{name}}" interpolé avec le nom du **repo** (`target.repoLabel`), pas celui du
composant réellement édité. Pour la racine du workspace, le titre affichait donc "Renommer Polenta"
quel que soit le composant en cours d'édition (bug annexe déjà repéré en marge de T131).

**Correctif** : clé i18n `schema.structureTab.renameTitle` (paramétrée) remplacée par
`editNodeTitle`, texte statique "Éditer le composant" / "Edit component" (`fr.json`/`en.json`),
`NodeEditModal` mis à jour en conséquence. Correctif ciblé sur le titre de la popup, pas de
renommage des clés voisines (`renameRepo`, `renameComponent`, libellés de menu distincts et
corrects tels quels). Détails complets dans `specs/T132.md`.

---

### T131 — Onglet Structure : collapse/uncollapse des composants locaux imbriqués

**Contexte** : dans l'onglet Structure (Modèle de données), les lignes de repo (`RepoRow`,
`StructureTab.tsx`) avaient déjà un chevron collapse/expand, mais les lignes de composant local
imbriqué (`LocalNodeRow`, T113/T123, profondeur illimitée via `SystemNode.children`) n'en avaient
aucun — tout leur contenu (éléments, sous-composants locaux, dépendances imbriquées) était toujours
rendu, rendant l'arbre très long dès que plusieurs niveaux de composants locaux étaient présents.

**Implémentation (sprint 1, unique)** : `LocalNodeRow` gagne le même mécanisme que `RepoRow` — état
`open` local (`useState`, défaut `true` à toute profondeur, contrairement au `depth < 2` de
`RepoRow`, pour ne masquer aucun contenu déjà visible sans action de l'utilisateur), chevron
`ChevronDown`/`ChevronRight`, clic sur la ligne pour basculer, `stopPropagation` ajouté sur le
crayon et sur `ConfirmDelete` (enveloppé d'un `<span className="shrink-0">` pour préserver son
comportement dans la ligne flex) pour ne pas déclencher le toggle. État non persisté, cohérent avec
`RepoRow` et `ElementTree` (Vue Système). Détails complets dans `specs/T131.md`,
`specs/T131-design.md`, `specs/T131-tests.md`, `specs/T131-sprint1.md`.

Vérifié dans l'app réelle (build + pilotage Playwright) : composant local → sous-composant local
imbriqué → élément, collapse/expand fonctionnel à tous les niveaux, aucune régression sur les
actions de la ligne (`+`, crayon, corbeille) ni sur `RepoRow`. `tsc --noEmit` sans erreur ; pas de
script de lint ni de tests automatisés couvrant ce fichier.

**Note annexe** (hors périmètre, non corrigée ici) : la modale d'édition d'un composant local
affiche toujours "Renommer `<nom du repo>`" au lieu du nom du composant édité (`NodeEditModal`
interpole `target.repoLabel`) — bug préexistant, probablement couvert par T132.

---

### T113 — Sous-composants locaux (même repo) comme pattern de premier ordre

**Contexte** : avant ce ticket, tout `SystemNode` non-root sans entrée correspondante dans
`polenta-repo.yaml` était traité comme une erreur "orpheline" héritée de T70 §4.5 (badge
"⚠ non associé à un repo" + bouton Supprimer forcé dans Structure) — aucun moyen de créer
intentionnellement un composant local (vivant dans le `schema.yaml` du repo courant, sans repo
git séparé) depuis l'UI, "+ Composant" ne proposant que l'ajout d'une dépendance/repo séparé.

**Implémentation (sprint 1, unique)** : case à cocher "Composant local" dans `AddDependencyModal`
(masque Repo/Branche, ne laisse que Nom), badge d'erreur retiré au profit d'un mini-header par
sous-composant local dans `StructureTab.tsx` (label, `+ élément`, renommer, supprimer),
`handleAddLocalComponent` ajoute directement un `SystemNode` à `schema.yaml` sans passer par
`polenta-repo.yaml`/git. Nouveau combobox "Sous-composant" dans `SystemPanel.tsx` (masqué si un
seul `SystemNode`) pour naviguer entre plusieurs sous-composants locaux d'un même repo dans la Vue
Système. Bug de préfixe d'ID trouvé et corrigé en testant ce combobox : `nextId()`/`nextTestId()`
résolvaient le préfixe par nom de type seul (à plat) plutôt que scopé par nœud, retombant
systématiquement sur le premier nœud du repo dès que deux sous-composants partageaient un nom de
type — corrigé via `findObjectTypeDef()` (`schema-lookup.util.ts`). Détails complets dans
`specs/T113.md`, `specs/T113-design.md`, `specs/T113-tests.md`, `specs/T113-sprint1.md`.

**Évolution ultérieure** : la distinction « composant » / « sous-composant local » introduite ici
s'est révélée sans raison fonctionnelle d'être — [[T123]] l'a fusionnée dans un modèle unique où
n'importe quel composant (local ou repo séparé) peut imbriquer d'autres composants et
exposer des rôles/interfaces ; [[T129]] a ensuite fusionné le combobox "Sous-composant" introduit
ici avec les combobox "Composant"/"Élément" en un seul combobox filtrable.

Vérifié dans l'app réelle (build + pilotage automatisé) : création d'un sous-composant local sans
badge d'erreur, combobox "Sous-composant" listant les bons nœuds, ID généré avec le bon préfixe
selon le sous-composant sélectionné. `tsc --noEmit` sans erreur.

---

### T129 — Vue Système : fusionner les comboboxes "Composant" et "Élément" en un seul combobox filtrable

**Évolution** (retour utilisateur, discuté en conversation) : sélectionner le contexte d'édition de
la Vue Système demandait deux actions séquentielles obligatoires — combobox Composant, puis
combobox Élément (`selectedTypeId` n'avait pas de valeur par défaut, donc choisir un composant sans
choisir ensuite un type ne menait à rien d'exploitable). Fusionnés en un seul combobox filtrable par
texte libre, une entrée = une paire (`SystemNode`, `ObjectTypeDefinition`).

**Décisions actées avant implémentation** : pas de chemin hiérarchique façon explorateur de fichiers
pour la partie inter-repo (le workspace autorise des dépendances diamant — `DiamondConflict`,
`polenta-workspace.ts` — donc un composant partagé entre repos n'a pas de chemin canonique unique ;
le chemin `›` de T123 reste utilisé, lui, pour l'imbrication locale, un arbre strict sans cette
ambiguïté). Groupement par repo conservé (identique à T120). Un `SystemNode` sans type configuré
n'a aucune entrée dans le combobox fusionné — invisible depuis la Vue Système, géré via l'onglet
Structure.

**Implémentation (sprint 1, unique)** : nouveau composant `ComponentTypeCombobox.tsx` (modelé sur
`BranchCombobox.tsx` — input double affichage/filtre + dropdown en portail `document.body` pour
échapper au panneau `overflow-hidden`), nouveau `componentTypeOptions` dans `SystemViewContext.tsx`
(fan-out de `componentOptions` × types de chaque nœud, réutilisant `findSystemNode`/
`flattenSystemNodes` de T123), remplace les deux `<select>` de `SystemPanel.tsx`.

**Revue de code (`/code-review --effort high`)** : 4 bugs confirmés et corrigés — (1) l'identité
d'entrée initialement prévue comme clé `` `${repo}::${node}::${type}` `` était collision-prone (noms
de repo/nœud sans restriction de caractères, même leçon que l'ancien combobox Composant avant T120)
→ repassée à une identité par position dans le tableau ; (2) cliquer dans le champ pendant la frappe
(ex. repositionner le curseur) effaçait la recherche en cours → le reset ne se fait plus que sur la
transition fermé→ouvert ; (3) l'état vide global était inatteignable (un `<input disabled>` ne peut
jamais ouvrir son dropdown) et le mauvais message était réutilisé pour "recherche sans résultat" →
placeholder dédié + `common.noResults` ; (4) la ligne surlignée au clavier ne défilait jamais dans
la vue → `scrollIntoView`. Deux points d'efficacité/duplication identifiés mais non corrigés
(porteraient sur un hook partagé ou d'autres composants, hors périmètre) — documentés dans
`specs/T129-sprint1.md` comme candidats à un ticket de suivi.

Vérifié dans l'app réelle (driver Playwright) : champ unique, ouverture au focus, filtrage substring
insensible à la casse, état "Aucun résultat", navigation clavier + Entrée chargeant le bon contexte,
clic pendant la frappe sans effacement de la recherche. `tsc --noEmit` sans erreur. Détails complets
dans `specs/T129.md`, `specs/T129-design.md`, `specs/T129-tests.md`, `specs/T129-sprint1.md`.

---

### T123 — Un composant local a les mêmes capacités qu'un composant en repo séparé (imbrication + interfaces)

**Évolution** (retour utilisateur direct sur le cadrage initial) : la distinction « composant » /
« sous-composant local » introduite par T113 n'a pas de raison fonctionnelle d'être — un composant
est un composant, qu'il vive dans le `schema.yaml` du repo courant (local) ou dans son propre repo
séparé (`polenta-repo.yaml`). Ce ticket fusionne l'ancien T124 (interfaces sur composant local,
retiré, absorbé ici) et livre deux axes : (1) un composant local peut imbriquer d'autres composants
locaux, profondeur non limitée ; (2) n'importe quel composant (root compris) peut exposer des
rôles et/ou implémenter des interfaces — capacité auparavant réservée aux repos séparés.

**Sprint 1 — fondation** : nouveau module partagé `packages/types/src/schema-tree.ts`
(`findSystemNode`/`mapSystemNode`/`flattenSystemNodes`, recherche/traversée récursive de
`SystemNode`, importable du process main comme du renderer). `SystemNode` gagne `children`
(imbrication) et `roles`/`implements` (déplacés depuis `ProjectSchema`, dépréciée). `addNode`/
`add_component` (MCP) acceptent un `parentName` optionnel. Migration additive (jamais destructive)
de `roles`/`implements` au premier chargement d'un `schema.yaml` legacy. **Bug critique trouvé en
vérification manuelle** (même classe que celui trouvé indépendamment par T126 sur la même ligne de
code, quelques jours plus tard) : `@polenta/types` jamais bundlé côté process main d'Electron —
corrigé dans `electron.vite.config.ts`.

**Sprint 2 — UI Structure** : `StructureTab.tsx` rendu récursif des composants locaux
(`LocalNodeRow`), action « + Composant local » sur chaque ligne, suppression en cascade avec
confirmation pluralisée mentionnant le nombre de sous-composants. `Selection`/`NodeEditTarget`
identifient un `SystemNode` par son nom plutôt que sa position de tableau (une position ne suffit
plus une fois l'imbrication possible). Vérifié dans l'app réelle : imbrication sur 3 niveaux,
`schema.yaml` conforme, suppression en cascade correcte.

**Sprint 3 — interfaces sur `SystemNode`** : `roles`/`implements` éditables depuis la même popup
pour n'importe quel composant (root ou local, imbriqué ou non) — nouveau composant partagé
`RolesImplementsFields.tsx` (`RolesExposedFields`/`ImplementedInterfacesFields`, extrait
d'`AddDependencyModal.tsx`). `SchemaService.save()` maintient un miroir automatique
`SystemNode.root` → niveau racine du fichier à chaque sauvegarde, pour que
`workspace-tree.service.ts`/`interface-compliance.service.ts` (lecteurs directs du fichier, sans
passer par `SchemaService`) restent corrects sans être migrés dans ce sprint. Combobox
« Composant » (Vue Système) libellé en chemin `Parent › Enfant` pour un composant imbriqué.
Vérifié dans l'app réelle : ajout d'un rôle sur un composant local → badge « Interface » →
`schema.yaml` conforme (écrit sur le node, pas au niveau fichier) ; popup de self-edit de `root`
strictement identique à celle d'un composant local.

**Sprint 4 (final) — matrice de conformité + SPEC** : `interface-compliance.service.ts` réécrit à
la granularité composant (`SystemNode`) au lieu de repo entier — `listAllComponents`/
`findApprovedReqsForNode`/`findLinksForNode` filtrent par `objectTypeRef` puisque
`RequirementsIndexService` n'a pas de notion de composant ; nom d'affichage qualifié
(`repo › ancêtres › node`) pour éviter toute collision entre deux repos différents. SPEC mises à
jour : `SPEC-TEMPLATES.md` §3/§3a-3b réécrites pour le modèle unifié, `SPEC-SYSTEM-VIEW.md`,
`SPEC-MCP-SERVER.md`, `SPEC-FORKS-BRANCHES-BASELINES.md`, `SPEC-REQ-requirements.md`,
`SPEC-INDEX.md`. Vérifié dans l'app réelle : création d'exigence bout en bout sur un composant
imbriqué à profondeur 2 (bon préfixe d'ID), combobox en chemin, page Conformité interfaces sans
régression.

**Limitations documentées, non résolues (hors scope)** : collision de nom possible entre deux
composants locaux interface de même nom dans deux repos différents (`ImplementsDeclaration
.interface` reste un nom simple, pas un chemin qualifié) ; le sourcing du champ `roles` d'une
exigence (`EditView`/`DynamicField`) reste limité au composant `root` — à traiter avec T126, qui
touche le même mécanisme ; `checkComponentCoverage` reste à la granularité repo (aucun appelant
actuel côté renderer).

**Fusion vers `master`** : la branche T123 a divergé de `master` pendant son développement — T126
(développé en parallèle, indépendamment) a touché les mêmes fichiers
(`interface-compliance.service.ts`, `electron.vite.config.ts`, `schema.ts`, plusieurs SPEC) avec
des correctifs se recoupant partiellement (le même bug de bundler `@polenta/types`, trouvé et
corrigé indépendamment de chaque côté). Conflits de merge résolus manuellement en conservant la
restructuration T123 (granularité composant) tout en réappliquant le correctif CSV/tableau T126
(`parseMultiEnumValue`) par-dessus. `pnpm typecheck` (desktop/web/api-client) : 0 erreur après
fusion.

---

### T126 — Compléter le support du type de champ `multi_enum` dans tous les écrans d'édition

**Évolution** : le type de champ `multi_enum` (« liste à choix multiple », T110) n'était rendu en
cases à cocher que dans `EditView.tsx` (Vue Système) — `DynamicField.tsx` (8 écrans détail/création
req/test/campagne) et l'édition inline de `WordView.tsx`/`ExcelView.tsx` retombaient sur un champ
texte libre éditant directement la chaîne CSV brute. La spécialisation du champ `roles` (options
sourcées depuis le catalogue de rôles du repo, `ProjectSchema.roles`) n'était disponible que dans
la Vue Système. Un bug latent de désérialisation (cast `as string[]` sur une valeur en réalité
stockée en chaîne CSV) affectait aussi la matrice de conformité interfaces.

**Ajout — sprint 1** : fonctions partagées `parseMultiEnumValue`/`serializeMultiEnumValue`
(`packages/types/src/schema.ts`) centralisant le format CSV. Nouveau composant partagé
`MultiEnumCheckboxes.tsx`, utilisé par `DynamicField.tsx` (nouveau) et `EditView.tsx` (migré, plus
de duplication de rendu). Catalogue de rôles câblé sur les 8 écrans détail/création (`schema` déjà
chargé partout — aucune requête réseau supplémentaire). Correctif du bug CSV/tableau dans
`interface-compliance.service.ts` (nouvelle méthode `rolesApplicable`, cast supprimé). **Bug
critique trouvé en vérification manuelle** (absent de `/code-review` et de `tsc`, qui ne peuvent
pas détecter une erreur de configuration du bundler) : `@polenta/types` n'était jamais bundlé côté
process `main` d'Electron (aliasé à sa source TS brute, tous les imports précédents étant
`import type`, effacés à la compilation) — le premier import de valeur réel
(`parseMultiEnumValue`) aurait fait planter l'app buildée au démarrage. Corrigé dans
`electron.vite.config.ts` (`externalizeDepsPlugin({ exclude: ['@polenta/types'] })`).

**Ajout — sprint 2 (final)** : nouveau composant partagé `MultiEnumPopover.tsx` — popover à cases à
cocher ancré sur la cellule/le champ cliqué, branché dans `ExcelView.tsx` (Vue Tableau) et
`WordView.tsx` (Vue Document, plomberie popover absente avant ce sprint). Règle du champ `roles`
extraite en `resolveMultiEnumOptions` (3e occurrence dupliquée). `specs/SPEC-REQ-requirements.md`
§3.2/§3.2d mis à jour.

**Revue de code (8 angles, par sprint)** : sprint 1 — 3 findings, 2 corrigés (garde défensive
`parseMultiEnumValue` contre une donnée déjà en tableau ; extraction `MultiEnumCheckboxes` pour
éliminer une duplication). Sprint 2 — 6 findings, 4 corrigés : deux bugs réels (Échap ne fermait
pas le popover ; re-cliquer sur la cellule/le champ déjà ouvert ne le refermait pas, faute de
l'attribut `data-multi-enum-popover` sur le déclencheur — présent dans le mauvais gabarit de
référence copié au départ) et deux réductions de duplication (`useProjectSchema` au lieu d'une
`useQuery` locale sans `staleTime` ; `resolveMultiEnumOptions` partagé).

**Vérification manuelle** (app réelle buildée, pilotage Playwright `_electron`, workspace jetable) :
sprint 1 a révélé le bug critique de bundler ci-dessus. Sprint 2 a confirmé le popover, le
catalogue de rôles, le toggle-fermeture, la fermeture par Échap et la persistance après redémarrage
complet de l'app dans les deux vues tabulaires.

---

### T128 — Bug : contenu de fin de richtext tronqué ~1s après édition d'une liste

**Reproduction rapportée** : dans la Vue Excel (`ExcelView.tsx`), ajouter une ligne dans
une liste richtext (ex. sortir de la liste en tapant Entrée deux fois, ce qui crée un
paragraphe vide en fin de document) : environ une seconde plus tard, le curseur saute en
fin de document et ce contenu de fin vient de disparaître.

**Root cause** : `autoSaveMutation.onSuccess` (`SystemView.tsx`) appelait
`qc.invalidateQueries(...)` sans l'attendre, puis effaçait immédiatement
`pendingEdits` (`clearPendingEditsFor`). Pendant la fenêtre entre les deux, `objects`
retombe brièvement sur la donnée serveur pré-sauvegarde (plus de `pendingEdits` pour la
masquer) — un changement de valeur que l'effet de resynchronisation externe de
`RichTextField.tsx` (voir T125, qui protège contre l'écho de sa propre édition mais pas
contre un changement réellement différent) traite comme légitime et réinjecte via
`setContent`. Un paragraphe vide en fin de document n'ayant aucune représentation
markdown (contrairement à un item de liste vide, qui survit grâce à son marqueur
explicite), il disparaît au passage — d'où le contenu tronqué et le saut de curseur.

**Correctif** : `apps/desktop/src/renderer/components/system/SystemView.tsx`,
`autoSaveMutation.onSuccess` — les deux `invalidateQueries` sont désormais attendus
(`await Promise.all([...])`) avant `clearPendingEditsFor`, fermant la fenêtre de course.

**Hors scope signalé** : le même motif (`invalidateQueries` non attendu suivi d'un clear
de pending state) existe aussi dans la mutation de transition de statut de
`SystemView.tsx` — non corrigé ici car le champ `status` n'est pas édité via
`RichTextField` (pas de perte de curseur/contenu observable de la même façon).

**Vérification** : reproduit de façon intermittente sur le code d'avant correctif (le
délai exact entre la dernière frappe et la vérification détermine si la fenêtre de
course est atteinte), jamais reproduit après correctif sur plusieurs essais avec le même
scénario/timing — validé en pilotant l'app réelle (build + Playwright `_electron`, driver
`run-desktop`), pas seulement par lecture de code. `npx tsc --noEmit` propre. Corrigé
directement sur `master` (pas de worktree dédié — ticket signalé en chat, corrigé dans la
continuité de la conversation). Détails dans `specs/T128.md`.

---

### T125 — Bug : curseur qui saute dans l'édition richtext de la Vue Excel (après collage)

**Reproduction rapportée** : dans la Vue Excel (`ExcelView.tsx`), coller du contenu
(Ctrl+V) dans le popover d'édition richtext d'une cellule faisait sauter le curseur à une
position inattendue peu après le collage.

**Root cause** : l'effet de resynchronisation externe de `RichTextField.tsx` (déclenché
sur changement de la prop `value`) comparait la valeur reçue à un `getMarkdown()`
recalculé à la volée. Or chaque frappe/collage fait redescendre ce même contenu comme
nouvelle prop `value` via `pendingEdits` (écho immédiat de l'édition, pas un changement
externe), et le round-trip parse→sérialisation de `tiptap-markdown` n'étant pas une
identité stricte, un collage y est particulièrement exposé (tableaux, ponctuation
échappée...). Le moindre mismatch déclenchait un `setContent(value, false)` inutile qui
réinitialise la sélection ProseMirror.

**Correctif** : `apps/desktop/src/renderer/components/RichTextField.tsx` — ajout d'un
`lastEmittedValueRef` qui retient le markdown que le champ vient lui-même d'émettre ;
l'effet de resynchronisation l'ignore désormais quand la prop entrante n'est que l'écho
de sa propre édition, et ne touche à la sélection que pour un changement réellement
externe.

**Vérification** : reproduit sur le code d'avant correctif (coller au milieu d'un
paragraphe puis taper un caractère → le caractère atterrit en bout de document) ; plus de
saut de curseur après correctif, même scénario — validé en pilotant l'app réelle (build +
Playwright `_electron`, driver `run-desktop`). `npx tsc --noEmit` propre. Corrigé
directement sur `master` (pas de worktree dédié — ticket signalé en chat, corrigé dans la
continuité de la conversation). Détails dans `specs/T125.md`.

---

### T127 — Bug : édition richtext perdue en naviguant vers Dashboard (ou tout autre panneau de l'ActivityBar)

**Reproduction rapportée** : dans la Vue d'édition (`EditView`), modifier un champ richtext
puis cliquer directement sur l'icône "Dashboard" de l'ActivityBar (sans passer par le
bouton "Retour") faisait disparaître la modification.

**Root cause** : deux mécanismes de persistance coexistent dans `EditView.tsx` — un
`onBlur` immédiat pour la plupart des types de champ, et un miroir local
(`localValuesRef`) flushé explicitement par `handleBack` (bouton "Retour") pour les
autres. Le champ `richtext` (`FieldControl`, cas `case 'richtext':`) ne câble aucun
`onBlur` — sa seule voie de persistance était ce flush explicite. Or la navigation via
l'ActivityBar (`ActivityBar.tsx` → `AppLayout.handleSelectPanel` → `navigate({...})`)
change directement de route et démonte `SystemView`/`EditView` sans jamais appeler
`onBack`/`handleBack` : le miroir local était perdu avec le composant, sans sauvegarde.

**Correctif** : `apps/desktop/src/renderer/components/system/EditView.tsx` — ajout d'un
effet de nettoyage qui s'exécute au démontage d'`EditView`, quelle qu'en soit la cause,
et rejoue le même `onFlushValues(localValuesRef.current)` que le bouton "Retour".
`onFlushValues` est lu depuis un ref pour que l'effet reste "mount-once" (le cleanup ne
doit s'exécuter qu'au vrai démontage, pas à chaque changement d'identité de la prop).
Effet de bord accepté : si "Retour" est cliqué juste avant démontage, le flush s'exécute
deux fois avec les mêmes valeurs — `handleFlushEditValues` ne réenvoie que si une
différence avec le serveur existe, donc au pire un PATCH redondant mais idempotent, pas
de perte ni corruption. Pas de flag "déjà flushé" ajouté pour éviter ça : un tel flag
devrait être réinitialisé à chaque nouvelle frappe/changement d'objet édité, ajoutant de
la complexité pour économiser un appel réseau rare et sans conséquence.

**Hors scope signalé** : le même défaut existe potentiellement pour la navigation vers un
objet lié via `LinksSection`/`navigateToObject` quand `viewMode` reste `'edit'`
(`handleGoBack` avec historique) — `EditView` n'est alors pas démonté, donc ce correctif
(basé sur le démontage) ne s'y applique pas. Non reproduit par l'utilisateur, non traité
ici (correctif minimal).

**Vérification** : `npx tsc --noEmit` propre sur `apps/desktop`. Validation UI bout-en-
bout via le driver Playwright (`run-desktop`) tentée mais non aboutie — la création d'un
objet persisté avec champ richtext dans un projet de test butait sur un flux de création
d'objet sans rapport avec ce bug (l'objet n'est créé côté serveur qu'au blur du champ
"title", absent d'EditView qui n'affiche que "Nom") ; correctif validé par lecture de
code et typecheck, avec scénario de test manuel documenté dans `specs/T127.md`. Corrigé
directement sur `master` (pas de worktree dédié — ticket signalé en chat, corrigé dans la
continuité de la conversation).

---

### T116 — Centralisation et uniformisation du thème (dark/clair)

**Évolution** : le thème clair/sombre reposait sur deux sources semi-dupliquées
éditées à la main (`index.css` + `tailwind.config.js`), sans token sémantique pour
erreur/succès/avertissement/lien — 69 fichiers `.tsx` sur 117 contournaient le système
de tokens avec des couleurs Tailwind brutes (`slate-`, `red-`, `blue-`, `green-`,
`white`, `black`...), avec des divergences visuelles incohérentes selon les fichiers
pour un même sentiment (ex. 4 systèmes de statuts métier réimplémentant chacun leur
propre palette de nuances).

**Ajout — sprint 1** : nouvelle architecture `apps/desktop/src/renderer/theme.config.ts`,
source unique des tokens de couleur (TypeScript, triplets RGB), remplaçant les deux
sources dupliquées précédentes. Script `scripts/generate-theme-css.ts`
(`pnpm --filter @polenta/desktop theme:generate`) régénère `index.css` et
`tailwind.theme.generated.js` à partir de ce fichier — jamais édités à la main. 5
sentiments × 5 variantes (`status-neutral/info/success/warning/danger`, chacun avec
`-bg`/`-border`/`-solid`/`-fg`), plus les familles figées `activity-*` (ActivityBar,
toujours sombre) et `print-*` (vues d'impression, toujours claires). Migration de
`ActivityBar.tsx` et des 8 routes `print.*.tsx`.

**Ajout — sprint 2** : migration des 4 systèmes de statuts métier (exigence, test,
campagne, exécution de test — 12 fichiers) vers les tokens `status-*`, avec
harmonisation des divergences repérées à l'audit (SKIP/BLOCKED unifiés sur
`status-warning`, statut `review` d'exigence unifié sur ambre partout).

**Ajout — sprint 3** : migration des blocs message (erreur/succès/avertissement),
états actifs interactifs (toggle, onglet, lien, focus) et champs de formulaire — 29
fichiers (routes, modales, panneaux `sidebar/version/*`, composants de formulaire).
Couleurs catégorielles hors sentiment (violet = sous-composant/interface) réutilisent
la palette `chart-series-1..8` existante (T77) plutôt que de nouveaux tokens dédiés.

**Ajout — sprint 4 (final)** : migration du reste (interaction/navigation, widgets
dashboard, tiptap/rich text, sidebar/layout, diff/impact, export) — 37 fichiers.
Nouveau token `overlay` (noir fixe, opacité au point d'usage) pour les trames de fond
de modale, seule famille de couleur figée non anticipée en design mais nécessaire pour
satisfaire le critère de conformité à la lettre. Constante partagée
`lib/objectCategoryColors.ts` extraite pour la correspondance catégorie → couleur
catégorielle (exigence/test/campagne), dupliquée entre `StructureTab.tsx` et
`SearchPanel.tsx` avec des couleurs jusque-là divergentes entre les deux écrans.
Nouvelle référence `specs/SPEC-THEMING.md` (architecture, tokens, procédure d'ajout,
grep de conformité). Grep de conformité final (critère d'acceptation 2 de `T116.md`) :
0 résultat sur `apps/desktop/src/renderer/**/*.tsx`.

**Revue de code (5 angles, par sprint)** : 7 problèmes confirmés et corrigés au total
(hors trivialités) — dont deux régressions d'opacité clair/sombre en sprint 4
(surlignage de lignes dans le graphe git et les vues de diff, perdues lors de la
substitution mécanique de classes `dark:` distinctes vers un token unique) et une
bordure de champ invalide trop peu visible (sprint 3, `border-status-danger-border`
pâle utilisée seule sans fond, corrigée en `border-status-danger`).

---

### T48 — Restreindre l'ajout de tests à une campagne aux tests approuvés

**Évolution** : le panneau "Ajouter des tests" d'une campagne proposait tous les cas de
test du projet, quel que soit leur statut — y compris des tests encore en `draft` ou en
`review`, jamais relus.

**Correctif** : `availableTests` (panneau "+ Ajouter des tests") est filtré sur le statut
"approuvé" du test avant tout autre critère. Le nom du statut d'approbation est résolu
depuis `statuses[].isApproval` du type de test concerné (`schema.yaml`), pas depuis le
littéral `'approved'` — un projet nommant différemment son statut d'approbation (ex.
`valide`) reste couvert, repli sur `'approved'` seulement si le type n'a pas de statut
`isApproval` déclaré. Même logique déjà utilisée côté critères de maturité
(`maturity.util.ts`, `isApprovedStatus()`). Message d'état vide du panneau mis à jour en
conséquence ("Aucun test approuvé disponible…" au lieu de "Tous les tests sont déjà dans
la campagne", qui ne couvrait pas le cas "aucun test approuvé du tout"). Filtrage réalisé
côté UI uniquement (sélection empêchée à la source) — pas de contrôle ajouté côté service
(`CampaignsService.addTests`/`duplicateTest`), jugé hors du périmètre minimal de ce ticket.

**Fichiers modifiés** : `apps/desktop/src/renderer/routes/campaign.$campaignId.tsx`.

Corrigé directement sur `master` (ticket jugé simple, autorisation explicite de
l'utilisateur — pas de passage par le workflow Spec/Design/Dev). `pnpm typecheck` propre.

---

### T103 — Ajout groupé de tests dans une campagne : tests perdus, puis ajout/retrait bloqués

**Bug** : dans le panneau "Ajouter des tests" d'une campagne, sélectionner plusieurs tests
d'un coup (mélange de tests nouveaux et de tests déjà présents avec paramètres) faisait
parfois disparaître silencieusement certains des tests sélectionnés. Passé un certain
point, ajouter ou retirer un test dans une campagne ne semblait plus rien faire.

**Root cause** : toutes les mutations de `CampaignsService` (`addTests`, `duplicateTest`,
`removeEntries`, `updateRun`, `updateRunParams`, `close`, `update`) lisent puis réécrivent
`campaigns/{id}.yaml` en entier, sans verrou. Le panneau d'ajout groupé (T97 sprint 2)
déclenche plusieurs de ces mutations **en parallèle** via `Promise.all()` dès qu'il y a un
mélange nouveaux/dupliqués — la dernière écriture à se terminer écrase silencieusement le
résultat des autres (lost update classique). Confirmé par un test de charge hors UI : 12
ajouts concurrents sur la même campagne → 1 seul survivait avant correctif, 11 perdus.

En cours de diagnostic, le fichier `campaigns/CAMP-0001.yaml` du projet démo s'est retrouvé
réellement corrompu sur disque (octets tronqués en fin de fichier) — signature exacte d'une
collision d'écriture non sérialisée, probablement produite par une reproduction manuelle du
bug en parallèle du diagnostic. Réparé après validation.

**Correctif** : file d'attente en mémoire par campagne dans `CampaignsService`
(`writeQueues: Map<string, Promise<unknown>>` + `enqueue()`) — toutes les mutations
ciblant la même campagne sont désormais sérialisées, chaque lecture ne démarrant qu'après
la fin de l'écriture précédente. Aucun changement UI/IPC nécessaire. Après correctif : 12
ajouts concurrents → 12/12 systématiquement, plus d'état bloqué.

**Fichiers modifiés** : `apps/desktop/src/main/services/campaigns.service.ts`.

Vérifié par test de charge direct sur le service (avant/après comparés) et interactivement
dans l'app (ajout groupé de 4 tests en une fois → tous présents). `pnpm typecheck` propre.
Voir `specs/T103.md`.

---

### T99 — Impossible de supprimer un test d'une campagne

**Bug** : aucune fonctionnalité de retrait d'un test d'une campagne n'existait — seul
l'ajout (`addTests`) était implémenté, de bout en bout (service, IPC, client API, UI).

**Correctif** : nouvelle méthode `CampaignsService.removeEntries(repoPath, campaignId,
entryIds)` — retire les entrées `runs` ciblées par `entryId` (pas `testCaseId`, pour ne
retirer que l'instance ciblée et laisser intactes les autres instances d'un même test
paramétré, cf. T97 sprint 2), et une seule occurrence du `testCaseId` correspondant dans
`testCaseIds` par entrée retirée. Bouton (icône corbeille) ajouté sur chaque ligne de test
dans `campaign.$campaignId.tsx`, visible tant que la campagne est active.

**Merge** : développement chevauchant le merge de la branche `T97` dans `master`, qui a
introduit `entryId` en cours de route — le correctif a été conçu directement sur ce modèle
plutôt que sur `testCaseId` seul.

**Fichiers modifiés** : `apps/desktop/src/main/services/campaigns.service.ts`,
`apps/desktop/src/main/ipc/index.ts`, `packages/api-client/src/{types.ts,ipc-client.ts}`,
`apps/desktop/src/renderer/routes/campaign.$campaignId.tsx`.

Vérifié interactivement dans le projet démo (retrait d'une instance parmi plusieurs d'un
test paramétré dupliqué → les autres instances restent intactes, confirmé dans le YAML
persisté). `pnpm typecheck` propre. Voir `specs/T99.md`.

---

### T97 — Paramètres de test `{label}` et substitution en campagne

**Description fonctionnelle**

Un cas de test peut désormais être **paramétré** : une sous-chaîne `{label}` dans
`preconditions`, `postconditions` ou `action`/`expectedResult` d'une étape référence un
paramètre — pas de liste déclarée séparément, la référence `{label}` est elle-même la
déclaration (détection automatique par scan). Lors de l'ajout d'un test paramétré à une
campagne (nouvelle ou existante), l'utilisateur doit renseigner une valeur par paramètre
détecté ; ces valeurs sont substituées dans le texte affiché à l'exécution du test et à la
relecture d'un run terminé, cohérentes entre les deux pages.

**Sprint 2** (retour utilisateur après le sprint 1) : un test **avec au moins un
paramètre** peut être inclus plusieurs fois dans la même campagne (ex. `{voltage}` testé à
12V et 24V), chaque instance ayant ses propres valeurs, son propre statut d'exécution, sa
propre navigation — via une action "Dupliquer" sur une instance déjà présente, ou en
sélectionnant à nouveau le test dans le panneau groupé "+ Ajouter des tests" (qui continue
à afficher un test déjà inclus tant qu'il a des paramètres, avec une mention "déjà
présent"). Un test sans paramètre reste limité à une seule inclusion. La liste des tests
d'une campagne affiche les valeurs de paramètres de chaque instance directement, sans clic
supplémentaire.

**Correctif** : introduit `CampaignTestRun.entryId`, identifiant unique par inclusion du
test dans la campagne (`testCaseId` n'est plus une clé unique dans `runs[]`). Nouvelle
méthode `CampaignsService.duplicateTest()` (n'effectue pas de déduplication, contrairement
à `addTests()`). Compatibilité ascendante assurée par un backfill déterministe en mémoire
de `entryId` pour les campagnes créées avant ce sprint (`ensureEntryIds()`, trouvé et
corrigé en revue de code — sans lui, toute campagne existante devenait inutilisable).
Unifie au passage le rendu de la page d'exécution sur `RichTextViewer` (comme la page de
relecture) au lieu d'un `dangerouslySetInnerHTML` brut — le contenu richtext est du
Markdown, pas du HTML, un échappement manuel y produisait un double-échappement et une
incohérence de rendu entre exécution et relecture.

**Fichiers modifiés** : `packages/types/src/campaign.ts`, `apps/desktop/src/main/services/campaigns.service.ts`,
`apps/desktop/src/main/ipc/index.ts`, `packages/api-client/src/{types.ts,ipc-client.ts}`,
`apps/desktop/src/renderer/lib/testParams.ts` (nouveau), `apps/desktop/src/renderer/components/TestParamFields.tsx`
(nouveau), `apps/desktop/src/renderer/routes/campaign.$campaignId.tsx`, `campaign.new.tsx`,
`campaign.$campaignId.execute.$testId.tsx`, `campaign.$campaignId.run.$testId.tsx`,
`apps/desktop/src/renderer/components/system/CampaignListView.tsx`.

**Merge** : fusionné dans `master` en même temps que du travail concurrent sur T99
(bouton "Retirer un test") — conflits sur `apps/desktop/src/main/ipc/index.ts`,
`packages/api-client/src/{types.ts,ipc-client.ts}`, `specs/SPEC-INDEX.md`,
`specs/SPEC-TESTS.md`, résolus en conservant les deux fonctionnalités. `campaigns.service.ts`
et `campaign.$campaignId.tsx` se sont auto-fusionnés sans conflit.

Non testé interactivement (pas d'Electron attachable dans cette session) — `pnpm
typecheck` propre. Revue de code menée aux deux sprints (`/code-review high`), tous les
findings confirmés corrigés avant commit. Voir `specs/T97.md`, `specs/T97-design.md`,
`specs/T97-tests.md`, `specs/T97-sprint1.md`, `specs/T97-sprint2.md`.

---

### T98 — Connexion GitHub simplifiée (OAuth Device Flow)

**Description fonctionnelle**

Le formulaire de connexion (`/login`) n'acceptait qu'un Personal Access Token collé manuellement —
trop technique pour un utilisateur non-initié qui ne connaît que son login/mot de passe GitHub
habituel (GitHub a désactivé l'auth Git/API par mot de passe brut depuis 2021, un champ
login/mot de passe générique ne pouvait donc pas fonctionner contre github.com).

Ajout d'un second mode de connexion, **en plus** du PAT (les deux à égalité, aucun retrait) :
le GitHub OAuth Device Flow, celui utilisé par `gh auth login`/VS Code/Docker CLI — l'utilisateur
clique « Se connecter avec GitHub », un code s'affiche, le navigateur système s'ouvre automatiquement
sur `github.com/login/device`, il se connecte normalement (login/mot de passe + 2FA) et valide ;
Polenta récupère le token par polling, sans jamais demander/afficher de PAT. Limité à `github.com` —
GitLab/Gitea/self-hosted restent sur le formulaire PAT existant.

**Implémentation** : `AuthService.startDeviceFlow`/`pollDeviceFlow`, 2 canaux IPC, polling renderer
auto-planifié (`setTimeout` + compteur de génération — pas de recouvrement de requêtes, annulation
propre), `client_id` d'une OAuth App GitHub dédiée embarqué en constante dans `auth.service.ts`
(non secret par nature, le Device Flow n'en a pas besoin).

**Bugs trouvés et corrigés en cours de route** (voir `specs/T98-sprint1.md` pour le détail) :
perte du scheme/port lors de la résolution d'identité pour les remotes self-hosted, absence de
garde `host === github.com` côté `pollDeviceFlow`, recouvrement de requêtes de polling, annulation
ne bloquant pas une réponse déjà en vol, double-clic déclenchant deux flows concurrents — plus,
après premier test réel : `client_id` placeholder jamais remplacé (404 GitHub), et un bug
préexistant (indépendant de ce ticket) de dossier `userData` incohérent entre `pnpm dev` et le
build packagé, qui donnait l'impression de devoir se reconnecter à chaque lancement (voir entrée
« Correctif mineur » ci-dessous).

**Nouvelle spec** : `specs/SPEC-ACCOUNTS-AUTH.md` (aucune section n'existait jusqu'ici pour le
système de compte/authentification git — `auth.service.ts`/`login.tsx` datent des sprints
fondateurs, avant `SPEC-INDEX.md`). Entrée ajoutée à `SPEC-INDEX.md`.

Détails complets : `specs/T98.md` (spec), `specs/T98-design.md` (conception),
`specs/T98-tests.md` (scénarios), `specs/T98-sprint1.md` (sprint + divergences).

---

### Correctif mineur — dossier `userData` incohérent entre `pnpm dev` et build packagé

**Bug** : `electron-builder.yml` définit `productName: Polenta`, mais en mode dev
(`electron-vite dev`) Electron ne l'applique pas et retombe sur le `"name"` de
`apps/desktop/package.json` (`@polenta/desktop`). Conséquence : deux dossiers `userData`
distincts selon le mode de lancement (`%APPDATA%\Polenta\` vs `%APPDATA%\@polenta\desktop\`),
chacun avec son propre `auth.json`/`workspace.json` — un compte connecté dans un mode est invisible
dans l'autre, donnant l'impression de devoir se reconnecter à chaque fois. Découvert en testant
T98 (OAuth Device Flow), mais affecte toute connexion (PAT compris) et tout mode de lancement.

**Correctif** : `app.setName('Polenta')` ajouté en tout début de `apps/desktop/src/main/index.ts`
(avant tout accès à `app.getPath`), pour que dev et packagé pointent vers le même dossier
`userData`, cohérent avec `productName` d'`electron-builder.yml`.

---

### T66 — Design : fusion TestCampaign / CampaignRun — alignement spec sur le code

**Description fonctionnelle**

Ticket de design : `SPEC-TESTS.md` §4 distinguait initialement deux entités séparées —
`TestCampaign` (plan) et `CampaignRun` (une exécution, avec `environment`, `productVersion`,
`status`, `assignedTo`, ID `CRUN-XXXX`, répertoire `campaign-runs/`) — permettant plusieurs
exécutions d'une même campagne. Le code (`packages/types/src/campaign.ts`,
`campaigns.service.ts`) n'a jamais implémenté cette séparation : une seule entité `TestCampaign`
porte à la fois le plan (`testCaseIds`) et le suivi d'exécution (`runs: CampaignTestRun[]`, un
statut par test). Pas d'IDs `CRUN-*`, pas de répertoire `campaign-runs/`, pas de champs
`environment`/`productVersion`/`assignedTo`. Divergence déjà relevée dans `specs/SPEC-AUDIT.md` §4.1.

**Décision** : aligner la spec sur le modèle implémenté plutôt que d'ajouter la séparation.
Conséquence assumée : pas de notion de ré-exécution multi-environnement d'une même campagne —
relancer dans un autre contexte (banc HW différent, nouvelle version produit) se fait en créant une
nouvelle campagne, pas un nouveau "run" de la campagne existante.

**Mise à jour spec** : `SPEC-TESTS.md` §1 (schéma d'ensemble), §4.1 (TestCampaign fusionné,
statut `planned`/`in_progress` auto-transitionné/`completed`/`abandoned` manuel), §4.2 (renommé
`CampaignTestRun` — statut par test), §4.3 (dashboard par campagne), §5 (stockage : suppression du
répertoire `campaign-runs/`), §6 (index mémoire : suppression de `campaignRuns: Map`).
`SPEC-TRACEABILITY.md` (§3, §4.3), `SPEC-TECH-stack.md` (§4.4 : suppression du compteur `CRUN`),
`SPEC-INDEX.md` (mots-clés et colonne MAJ) mis à jour en cohérence.

Voir `specs/SPEC-AUDIT.md` §4.1 pour le détail de la divergence d'origine.

---

### T65 — Copie d'élément crée un `objectId` fantôme sans objet backend

**Description fonctionnelle**

Bug : `treeDeepCopyWithNewIds` (`useTreeState.ts`) générait un nouvel `objectId` local
(timestamp) pour chaque nœud `item` copié dans l'arbre, sans jamais créer l'objet correspondant
côté backend (`api.requirements.create` / `api.tests.create` non appelés). Après un coller, les
nœuds affichés pointaient vers des `objectId` inexistants côté serveur — ouverture/édition
échouait silencieusement ou chargeait des données vides. Affectait trois points d'entrée :
`ElementTree.tsx` (`paste()`, `handleBgContextAction()`) et `ExcelView.tsx` (`paste()`).

**Correctif** : `createItemObject` (`SystemViewContext.tsx`) accepte un `sourceObjectId?` optionnel
— si fourni, récupère l'objet source (`api.requirements.get`/`api.tests.get`) et copie
`title`/`fields`/`steps` dans le DTO de création (fallback objet vide si la source a été supprimée
entre-temps) ; sinon comportement inchangé. `ElementTree.tsx` gagne `collectItemNodes` et
`notifyPastedItems`, appelés après coller pour déclencher la création backend de chaque item copié
(sauf en cas de couper, qui déplace sans dupliquer). Même logique ajoutée à `ExcelView.tsx` via une
nouvelle prop `onItemNodeAdded`, câblée par `SystemView.tsx`.

**Fichiers modifiés** : `SystemViewContext.tsx`, `ElementTree.tsx`, `ExcelView.tsx`, `SystemView.tsx`.

Voir `specs/T65.md`.

---

### T64 — Normalisation enum statuts CampaignRun

**Description fonctionnelle**

Bug : incohérence entre le code et `SPEC-TESTS.md` sur les enums de statut des campagnes de test.
`CampaignStatus` utilisait `'in-progress'` (tiret) au lieu de `'in_progress'` (underscore) défini
par la spec ; `TestRunStatus` (statut par test dans une campagne) utilisait des valeurs minuscules
`passed/failed/blocked/skipped` au lieu de `PASS/FAIL/BLOCKED/INCOMPLETE`, convention MAJUSCULES
déjà utilisée par `TestRun.result`/`StepResult.result`.

**Correctif** : convention spec appliquée partout — `packages/types/src/campaign.ts`
(`CampaignStatus`, `TestRunStatus`), `packages/types/src/schema.ts` (commentaire),
`campaigns.service.ts` (auto-transition dans `updateRun()`), routes `campaign.$campaignId.tsx` et
`campaign.$campaignId.execute.$testId.tsx` (`mapResultToStatus()`), `CampaignListView.tsx`,
`SystemPanel.tsx`. `CellStatus` (`pass`/`fail`/`blocked`/`not_run`, matrice de traçabilité) n'est pas
concerné — type interne distinct.

**Fichiers modifiés** : `packages/types/src/campaign.ts`, `packages/types/src/schema.ts`,
`apps/desktop/src/main/services/campaigns.service.ts`, `campaign.$campaignId.tsx`,
`campaign.$campaignId.execute.$testId.tsx`, `CampaignListView.tsx`, `SystemPanel.tsx`.

Voir `specs/T64.md`.

---

### T63 — Correction ordre `covered`/`validated` dans `computeCoverageStatus`

**Description fonctionnelle**

Bug : `computeCoverageStatus` (`apps/api/src/modules/traceability/traceability.service.ts`)
retournait `validated` dès qu'au moins un `TestCase` lié avait un run `pass`, sans tenir compte des
autres `TestCase` liés jamais exécutés (`not_run`). La spec (`SPEC-TRACEABILITY.md` §2.2) définit
pourtant la priorité `needs_revalidation > failing > covered > validated > not_covered` — `covered`
doit primer sur `validated` tant qu'un test lié n'a pas encore de run.

**Correctif** : condition `cells.some(c => c.status === 'pass') → validated` remplacée par
`cells.some(c => c.status === 'not_run') → covered`, `validated` devenant le fallback (tous les
tests liés ont un run PASS, une fois `needs_revalidation`/`failing` éliminés). Découverte en cours
de route (T77 sprint 3) : la copie desktop de cette fonction (`apps/desktop/src/main/services/
traceability.service.ts`) n'avait jamais reçu le correctif appliqué côté `apps/api` — corrigée à
cette occasion, avec impact observable direct sur la Matrice de traçabilité existante pour toute
exigence partiellement exécutée.

**Fichiers modifiés** : `apps/api/src/modules/traceability/traceability.service.ts`,
`apps/desktop/src/main/services/traceability.service.ts` (T77 sprint 3).

Voir `specs/T63.md`.

---

### T43 — Export Word / Excel / PDF (cahiers, rapports, dashboard, requêtes, analyse d'impact)

**Description fonctionnelle**

Export xlsx/docx/pdf du cahier d'exigences, cahier de test, cahier/rapport de campagne d'essai,
résultats de requête, analyse d'impact et dashboard — bouton "Exporter" dans `ViewHeader.actions`
de chaque vue concernée, popover de choix de format, dialogue natif "Enregistrer sous" avec nom par
défaut `composant-élément-{baseline|commit}.{docx|xlsx|pdf}` (ou `dashboard-{name}`,
`request-{name}`, `impactAnalysis-{baselineOld}-{baselineNew}`).

Infrastructure partagée construite en sprint 1 et réutilisée sans changement structurel jusqu'au
sprint 3 : un seul canal IPC (`export:save`), `ExportService` en table de dispatch `kind:format` →
générateur, `<ExportButton>` commun, mécanisme pdf via route imprimable (`/print/<kind>`) chargée
dans une `BrowserWindow` cachée + `webContents.printToPDF`. Découverte notable en sprint 1 :
`requirements.tsx`/`tests.tsx` (cibles initiales de la spec) étaient des routes mortes, retargetées
sur `SystemView.tsx` après validation utilisateur.

**Correctif post-validation** : un export réel a révélé que les colonnes xlsx/docx ne
correspondaient pas à la configuration `visibleFieldsExcel`/`visibleFieldsWord` réellement affichée
à l'écran (colonnes manquantes, colonne "Type" non configurée présente). Nouvelle fonction
partagée `buildExportRows` (`exportColumns.ts`) devenue seule source de vérité pour la résolution
colonnes/lignes, utilisée à la fois par l'export en direct et par les routes `/print/*`. Une revue
de code a ensuite trouvé et corrigé une duplication Section/Statut/Version dans le corps docx/pdf
(déjà affichés en en-tête compact, comme `WordView.ItemCard`).

**Amélioration post-validation** : boutons "Ouvrir le dossier"/"Ouvrir le fichier" sur la popup de
confirmation d'export (`shell.showItemInFolder`/`shell.openPath`).

**Fichiers modifiés** : voir `specs/T43-sprint1.md`, `T43-sprint2.md`, `T43-sprint3.md` (§ Fichiers
modifiés/créés de chaque sprint, + sections post-validation du sprint 3 pour le correctif colonnes
et les boutons popup).

Voir `specs/T43.md`, `specs/T43-design.md`, `specs/T43-tests.md`, `specs/T43-sprint1.md`,
`specs/T43-sprint2.md`, `specs/T43-sprint3.md`.

---

### T93 — Query Builder : types des composants submodule invisibles

**Description fonctionnelle**

Bug : le sélecteur "Type d'objet" du Query Builder (page `/query`, aussi utilisé pour les
requêtes des widgets Dashboard) ne listait que les types définis dans le `schema.yaml` du repo
**root** — les types déclarés par les composants submodule n'apparaissaient jamais, alors que le
moteur de requête agrège déjà les exigences/tests de tous les composants du workspace. Root cause :
`getQueryableTypes` (`QueryBuilder.tsx`) et `resolveTableInfo` (`query-engine.service.ts`) étaient
alimentés par le schéma du seul repo root, au lieu de réutiliser `schemasByRepoPath`
(`useWorkspaceStructure`), déjà utilisé correctement par `StructureTab`/`SystemViewContext`.

**Correctif** : `BuilderConfig` gagne un champ optionnel `component` (mount name du composant
propriétaire du type sélectionné) — nécessaire car `objectTypeRef` seul n'est pas unique entre
composants (chaque composant nomme son nœud local `root`). Le picker liste désormais les types de
tous les composants, qualifiés par leur mount name ; `resolveTableInfo`/`buildSql` résolvent le
schéma et filtrent (`AND [component] = ...`) contre le composant réellement propriétaire du type
sélectionné. Comportement du repo root et des projets mono-repo strictement inchangé.

**Fichiers modifiés** : `packages/types/src/dashboard.ts`, `QueryBuilder.tsx`, `query.tsx`,
`query-engine.service.ts`, IPC (`queries:builder-to-sql`, `ipc-client.ts`, `types.ts`).

Voir `specs/T93.md`.

---

### T88 — Arbre d'historique (Version) ignore le repo sélectionné

**Description fonctionnelle**

Bug : l'arbre d'historique (`/graph`, icône Historique du panneau Version) affichait toujours le
repo racine du workspace au lieu du repo sélectionné dans l'arbre du panneau latéral —
`graph.tsx` résolvait `repoPath` via `api.workspace.resolve` (racine) au lieu de lire
`SelectedRepoContext` (T80), déjà utilisé par `/version-diff`.

**Correctif** : `graph.tsx` suit désormais `useSelectedRepo()` (racine par défaut si rien n'est
sélectionné explicitement), titre de page affichant le nom du repo sélectionné. Les trois
mutations de checkout de cette page (bouton ⎇ sur une ligne de commit, menu contextuel
branche/commit) sont branchées sur `propagatePinToDependents` (T82, même mécanique que
`useBranchCheckout`) — nécessaire dès lors que la page peut afficher un repo composant dont
d'autres repos dépendent, ce qui n'était pas un risque tant que la racine était forcée.

**Fichiers modifiés** : `apps/desktop/src/renderer/routes/graph.tsx` (seul fichier modifié).

Voir `specs/T88.md`.

---

### T76 — Stockage des images richtext par fichier (au lieu de base64)

**Description fonctionnelle**

Remplace le stockage des images embarquées dans les champs richtext (base64 inline via
`ResizableImage`, introduit en T75) par des liens vers fichiers copiés dans `images/` du repo
courant, sur le modèle de `DrawioEmbed` — évite le bloat git et permet de traiter une image comme
un fichier référencé (ouverture, remplacement) plutôt qu'un blob inline. Coller une image ou
utiliser le bouton d'insertion écrit désormais le fichier sur disque (`api.image.writePaste`/
`pickFile`) et stocke un chemin relatif ; le contenu déjà stocké en base64 avant ce ticket continue
de s'afficher sans migration, tout comme une image référencée par URL externe. Le bloc fencé
`` ```image `` (schéma JSON de T75) garde son format exact, seule la sémantique de `src` change.

**Fichiers modifiés** : nouveau namespace `api.image` (`pickFile`/`read`/`writePaste`,
`api-client`), handlers IPC `image:*`, `ResizableImageExtension.ts`/`ResizableImageView.tsx`
réécrits, nouveau `ImageInsertButton.tsx` (mirroir de `DrawioInsertButton`), `RichTextField.tsx`
(paste handler), `RichTextToolbar.tsx`, `RichTextViewer.tsx`/`WordView.tsx` (`repoPath` transmis à
`ResizableImage.configure`, manquant avant correctif de revue). `SPEC-REQ-requirements.md` §3.2/
§3.2b et `SPEC-ELECTRON-DESKTOP.md` §21.4–21.5 mis à jour.

Voir `specs/T76.md`, `specs/T76-design.md`, `specs/T76-tests.md`, `specs/T76-sprint1.md`.

---

### T75 — Redimensionnement et rognage des images/diagrammes richtext

**Description fonctionnelle**

Images et diagrammes draw.io insérés dans un champ richtext deviennent redimensionnables (poignées
aux coins, ratio conservé) et rognables (overlay de sélection + Valider/Annuler), avec un menu
contextuel clic droit commun aux deux types (Redimensionner, Rogner, Remplacer le fichier,
Supprimer — plus Ouvrir dans draw.io/Changer de page pour un bloc drawio). Le rognage image est
stocké en fractions `[0,1]` de la taille native (survit à un remplacement de fichier par une image
de dimensions différentes) ; le rognage drawio en unités du modèle mxGraph, sans jamais modifier le
fichier `.drawio` référencé. `RichTextViewer` (lecture seule) affiche taille/rognage sans aucune
interaction, piloté par le flag `editor.isEditable` existant. Sprints 1+2 du design codés en une
seule passe à la demande utilisateur.

**Fichiers modifiés/créés** : nouveaux `mediaAttrs.ts`, `ResizableImageExtension.ts`/
`ResizableImageView.tsx`, `ResizableMediaFrame.tsx` (partagé), `NodeContextMenu.tsx`,
`DrawioPagePicker.tsx` (extrait de `DrawioInsertButton`) ; `DrawioEmbedExtension.ts`/
`DrawioEmbedView.tsx` étendus (attributs `width`/`height`/`crop`) ; `RichTextField.tsx`,
`RichTextViewer.tsx`, `WordView.tsx`, `DrawioInsertButton.tsx` migrés.

Voir `specs/T75.md`, `specs/T75-design.md`, `specs/T75-tests.md`, `specs/T75-sprint1.md`.

---

### T70 — Refonte Modèle de données : onglet Structure (3 sprints)

**Description fonctionnelle**

Remplace les anciens onglets Composants + Éléments par un onglet Structure unique affichant
l'arbre de la structure du projet (repos composant/interface du workspace, en lecture/édition).
Depuis cet arbre : ajout d'un composant ou d'une interface (clone réel via `polenta-repo.yaml`,
déclaration `implements`), ajout d'éléments (exigence/test/campagne) sous n'importe quel repo via
une popup reprenant les champs de l'ancien onglet Éléments ; cliquer sur un élément rouvre cette
popup. Sprint 1 : arbre lecture/édition, popup, réordonnancement, édition du label racine. Sprint
2 : ajout composants/interfaces (clone réel), création d'éléments, atomicité de l'écriture du
manifeste. Sprint 3 : retrait de `/workspace` (remplacé par une page de redirection vers l'onglet
Structure, pour ne pas casser les anciens liens/favoris — CA-6 exigeait explicitement une
redirection, pas un 404), matrice de conformité interfaces déplacée dans l'onglet Structure. Suite
à un retour utilisateur post-sprint 3, ajout dans la foulée d'un bouton de suppression pour les
nœuds locaux orphelins (oublié du design initial).

**Fichiers modifiés** (sprint 3, cumulés aux sprints précédents) : `routes/workspace.tsx` (réécrit
en redirection), `routes/compliance.tsx`, `components/schema/StructureTab.tsx`.

Voir `specs/T70.md`, `specs/T70-design.md`, `specs/T70-tests.md`, `specs/T70-sprint1.md`,
`specs/T70-sprint2.md`, `specs/T70-sprint3.md`.

---

### T46 — Analyse d'impact entre deux baselines : édition des statuts et génération de campagne (2 sprints)

**Description fonctionnelle**

Analyse d'impact sur diff entre deux baselines/branches/commits : liste des exigences modifiées et,
pour chaque dépendance, les éléments liés dont l'impact doit être vérifié, sous forme d'arbre
affiché dans le panneau latéral (chaque élément cliquable ouvre sa fiche comme dans les autres
vues système/Excel/Word/édition). Sprint 2 (dernier) : statut éditable par élément impacté (8
valeurs + commentaire persistés immédiatement), bandeau de complétude, génération de campagne de
test à partir des éléments en statut "à tester" (résolution des TestCases approuvés couvrants,
préremplissage de `/campaign/new`). **Testé interactivement en conditions réelles** (app buildée,
projet de test, deux baselines réelles) — bout en bout fonctionnel confirmé.

**Bug corrigé hors périmètre T46, révélé par ce ticket** : `SystemViewContext.tsx` redirigeait
vers `/product` pour toute route "système" sans paramètre `repo`, y compris `/req/$reqId`,
`/test/$testId`, `/campaign/new` (qui utilisent `repoPath`/`component`, jamais `repo`) — cliquer
sur un élément impacté ou "Créer la campagne" retombait donc sur la vue Système vide. Corrigé par
un garde-fou sur `pathname`.

**Fichiers modifiés** : `routes/impact-analysis.tsx`, `routes/campaign.new.tsx`,
`contexts/SystemViewContext.tsx`, `sidebar/SystemPanel.tsx`, `system/CampaignListView.tsx`.
`SPEC-TRACEABILITY.md` §4.4/§4.6 et `SPEC-FORKS-BRANCHES-BASELINES.md` §5.2/§5.6/§5.7 mis à jour.

Voir `specs/T46.md`, `specs/T46-design.md`, `specs/T46-tests.md`, `specs/T46-sprint1.md`,
`specs/T46-sprint2.md`.

---

### T42 — Support des tableaux dans richtext (2 sprints)

**Description fonctionnelle**

Insertion manuelle de tableaux via bouton toolbar (choix lignes/colonnes) avec édition du texte
dans les cellules, menu contextuel clic droit (ajouter/supprimer ligne/colonne, supprimer le
tableau — pas de fusion de cellules), et collage d'un tableau Excel créant un vrai tableau plutôt
qu'une image. Sprint 2 (dernier) : menu contextuel d'édition ligne/colonne. Trois correctifs
post-validation manuelle sur le collage Excel : l'extension `Markdown` de tiptap-markdown
surcharge `insertContent`/`setContent` et repasse tout contenu (y compris du HTML) dans le parseur
Markdown, rendant les balises `<table>` littérales — après plusieurs itérations (parseSlice
ProseMirror direct, puis un harnais Electron headless monté à la main pour isoler la cause exacte),
le correctif définitif abandonne le reparsing HTML : extraction du texte des cellules par simple
traversée DOM (`extractTableRows.ts`), tableau vide inséré via la commande standard `insertTable`,
puis remplissage cellule par cellule (`fillPastedTable.ts`).

**Fichiers modifiés** : `RichTextField.tsx` (menu contextuel), nouveaux `tableMenuItems.ts`,
`extractTableRows.ts`, `fillPastedTable.ts` (remplace `normalizeTableHtml.ts`, supprimé).
`SPEC-REQ-requirements.md` §3.2c (nouvelle) et `SPEC-TECH-stack.md` §2 mis à jour.

Voir `specs/T42.md`, `specs/T42-design.md`, `specs/T42-tests.md`, `specs/T42-sprint1.md`,
`specs/T42-sprint2.md`.

---

### T96 — Page Préférences dédiée dans le panneau latéral

**Description fonctionnelle**

Suite à T94 (case dans un onglet de `/schema`) puis T95 (case inline dans le panneau latéral),
nouvelle correction d'emplacement : `autoPropagatePin` vit maintenant sur sa **propre page**
`/preferences`, chargeable depuis un nouvel item du panneau latéral Projet, au même niveau que
« Modèle de données ». La page suit le même squelette que l'éditeur de schéma (`ViewHeader`, dirty
state, Enregistrer/Annuler, raccourcis Échap/Entrée) mais sans onglets — un seul formulaire,
structuré pour accueillir d'autres préférences à venir sans refonte. `ProjectPanel.tsx` redevient
un panneau de simples liens (retrait de la case inline et de la mutation ajoutées en T95).

**Note technique** : `routeTree.gen.ts` (généré par `@tanstack/router-vite-plugin`) n'a pas pu être
régénéré automatiquement dans cet environnement — `electron-vite build` échoue sur un bug de
résolution de chemin du plugin (double `src/renderer/src/renderer/routes`, sans rapport avec ce
ticket). L'entrée `/preferences` a été ajoutée à la main en suivant exactement le motif mécanique
des routes existantes ; `npm run typecheck` valide la cohérence. À régénérer proprement au premier
`pnpm dev` sur une machine où le bug ne se reproduit pas.

**Fichiers modifiés** : `apps/desktop/.../routes/preferences.tsx` (nouveau),
`apps/desktop/.../sidebar/ProjectPanel.tsx`, `apps/desktop/.../routeTree.gen.ts`.

Voir `specs/T96.md`, `specs/T96-sprint1.md`.

---

### T95 — Correction d'emplacement : autoPropagatePin dans le panneau latéral

**Description fonctionnelle**

Correction suite retour utilisateur sur T94 : la case à cocher `autoPropagatePin` avait été placée
dans un onglet Préférences de la page Modèle de données (`/schema`) ; elle doit se trouver dans le
**panneau latéral Projet**, sous le lien « Modèle de données ». Retiré l'onglet Préférences de
`schema.tsx` (le champ `preferences` du schéma y est désormais passé tel quel via un nouveau
paramètre de `editableToSchema`, sur le même principe que `nodes` — possédé ailleurs, jamais écrasé
par un save de cette page). Ajouté la case dans `ProjectPanel.tsx`, sous le lien « Modèle de
données », avec sauvegarde immédiate au clic (pas de flux brouillon+Enregistrer — cohérent avec un
réglage rapide de panneau latéral plutôt qu'un champ d'éditeur de schéma).

**Fichiers modifiés** : `apps/desktop/.../routes/schema.tsx`, `apps/desktop/.../sidebar/ProjectPanel.tsx`.
Aucun changement côté `packages/types/src/schema.ts` ni `schema.service.ts` (déjà corrects depuis T94).

Voir `specs/T95.md`.

---

### T94 — Préférence projet : propagation automatique du pin

**Description fonctionnelle**

`ProjectSchema` gagne un champ racine optionnel `preferences` (`preferences.autoPropagatePin`,
booléen, défaut `false`), indépendant du modèle métier (`nodes`/`objectTypes`/`linkTypes`) — options
d'outil au niveau du projet. Un nouvel onglet **Préférences** apparaît dans la page Modèle de données
(`/schema`), à côté de Structure/Liens/Interfaces, avec une case à cocher « Propager automatiquement
le pin des sous-repos vers le repo parent lors d'un commit reçu sur le sous-repo », suivant le même
flux draft + Enregistrer/Annuler que l'onglet Liens. Un schéma existant sans `preferences` continue
de charger normalement (case décochée par défaut).

Décidé le 2026-07-14 (cf. CLAUDE.md « Modèle de données ») pour trancher un point resté ouvert lors de
la conception de la refonte Version multi-repo : la granularité de l'option est **globale au projet**,
pas par lien parent/enfant.

**Hors scope** (volontairement) : la logique effective de propagation du pin au commit — déclenchement,
écriture dans `polenta-repo.yaml` du parent, etc. — dépend de la refonte Version multi-repo (arbre
sidebar par repo, workflow Publier) qui n'est pas encore codée. Ce ticket ne livre que le
champ de schéma et son point d'édition UI.

**Fichiers modifiés** : `packages/types/src/schema.ts` (`ProjectPreferences`), `apps/desktop/.../routes/schema.tsx`
(onglet Préférences), `CLAUDE.md`, `specs/SPEC-TEMPLATES.md` §2, `specs/SPEC-INDEX.md`.
`schema.service.ts` inchangé — le round-trip YAML transporte `preferences` sans traitement spécial.

Voir `specs/T94.md`, `specs/T94-sprint1.md`.

---

### T87 — Édition directe sur la branche d'intégration, retrait de "Faire une modification" / "Annuler"

**Description fonctionnelle**

L'édition d'exigences/tests est désormais possible directement sur la branche d'intégration
checkoutée (`int-*`) — seul un detached HEAD (baseline ou commit checkouté sans branche) reste
bloquant. `ModificationControl` n'affiche plus que le bouton **"Publier"** (retrait de "Faire une
modification" et "Annuler" + du badge Lecture/Édition) ; son comportement se résout au clic à partir
de la branche courante du repo concerné vs sa branche d'intégration configurée, évalué
indépendamment par repo dans un workspace multi-repo : sur l'intégration → crée une branche `dev-*`
éphémère, commit, merge, checkout retour, suppression de la branche, puis push ; sur une branche
`dev-*`/libre (usage avancé git) → commit direct dessus, merge, push, sans checkout ni suppression
(l'utilisateur qui l'a créée en reste responsable) ; sur une autre branche `int-*` que celle
configurée → publication bloquée (édition non affectée). Le discard de modifications en attente
reste possible mais uniquement via le panneau Version, délibérément moins accessible qu'un bouton
"Annuler" pour limiter les pertes de travail accidentelles.

**Bugs trouvés et corrigés pendant le sprint (`/code-review high`, 8 angles, 10 findings)**

- **Risque de perte de données dans `SyncService.createBranch`** : `git.branch({ checkout: true })`
  d'isomorphic-git réécrit les fichiers du répertoire de travail par défaut — créer une branche à la
  position courante (le cas nominal, désormais routinier) avec des modifications non commitées
  risquait de les écraser silencieusement. Corrigé avec `git.branch({ checkout: false })` +
  `git.checkout({ ref, noCheckout: true })`, qui déplace `HEAD` sans toucher un seul fichier —
  bénéficie à tous les appelants, pas seulement "Publier".
- **`IntegrationBranchSelector.tsx`** (hors diff initial) checkoutait une branche `int-*` sans
  aucune garde de modifications en attente — invariant qui tenait tant que `int-*` était
  nécessairement propre, cassé par ce ticket. Corrigé (garde `isDirty` + confirmation + affichage
  des erreurs de checkout). **Devenu sans objet lors du merge vers master** : un chantier concurrent
  ("optimize branch display in version view") a supprimé ce composant entre-temps, la sélection de
  branche root passant désormais uniquement par `RepoBranchSelector.tsx`, qui porte déjà la même
  garde `isDirty` pour tous les repos — vérifié avant de fusionner, la suppression du fichier a été
  acceptée sans réintroduire le risque.
- **Branches `dev-*` orphelines après un conflit puis republication** : le nettoyage (checkout
  retour + suppression) était décidé à partir de `branch === integrationBranch`, recalculé à chaque
  clic — après un conflit (laissant l'utilisateur sur la branche éphémère), republier prenait
  silencieusement le chemin "avancé" et ne nettoyait plus jamais rien. Corrigé par un suivi de la
  branche éphémère abandonnée, scopé au repo, reconnu comme telle à la republication.
- Popup "Publier" pouvant rester ouverte avec un titre périmé si la branche change sous elle
  (changement externe concurrent) ; push devenu fire-and-forget après le merge plutôt qu'attendu
  dans la mutation (le bandeau d'échec de push ne bloque plus l'état "Publication…" le temps d'un
  aller-retour réseau, et ne s'efface plus prématurément).

**Décisions techniques notables**

- Portée de "Publier" élargie à toute branche non-`int-*` (pas seulement `dev-*`) — cohérent avec
  l'objectif "l'utilisateur n'a pas à se soucier du concept de branche", y compris pour une branche
  créée manuellement par un profil avancé.
- Push automatique (`sync:push-branch`, déjà exposé) ajouté après un merge réussi — sans lui, un
  utilisateur qui ne touche jamais au panneau Version n'aurait aucun moyen de partager son travail.
  Échec non bloquant : le merge local n'est jamais annulé.
- Conflit de merge modélisé comme une erreur typée (`PublishConflictError`) plutôt qu'un résultat en
  union parallèle à l'état d'erreur affiché — évite un renommage de champ dupliqué entre deux types.

**Validation manuelle interactive** (Electron réel, `run-desktop`) : golden path (édition sur
`int-*` → Publier → merge/checkout/suppression confirmés via `git log`/`git branch`), mode bloqué
sur une branche `int-*` non configurée, échec de push non bloquant avec bandeau persistant, garde de
checkout sur branche dirty (popup de confirmation, fichier intact). Non testé : résolution de
conflit (T87-07).

**Sprint :** 1 (unique). `tsc --noEmit` propre. `/code-review high` : 10 findings retenus, 8
corrigés, 2 différés (duplication de motifs UI, orchestration entièrement côté composant React —
notés comme suivi futur). `specs/SPEC-FORKS-BRANCHES-BASELINES.md` (§2.1–2.3 réécrites, §4.3
marquée caduque) et `specs/SPEC-INDEX.md` mis à jour. Voir `specs/T87.md`, `specs/T87-design.md`,
`specs/T87-tests.md`, `specs/T87-sprint1.md`.

---

### T84 — Résolution de conflit au "Publier" : liste des fichiers en conflit + lien contextualisé

**Description fonctionnelle**

En cas d'échec du merge automatique de "Publier" (T83), la notification affichée par
`ModificationControl` liste désormais les chemins réels des fichiers en conflit, en plus du message
générique existant ("quelqu'un a modifié les mêmes informations"). Le bouton "Résolution manuelle
(Version)" navigue vers `/version-diff` — scopé au repo réellement concerné (root ou composant,
selon celui sur lequel "Publier" a échoué) et pré-rempli avec le diff entre la branche `dev-*` et la
branche d'intégration — au lieu de `/graph`, qui était câblé en dur sur le repo root et affichait
donc le mauvais repo dès qu'un conflit survenait sur un composant. Le merge manuel de la vue Version
(`graph.tsx`, branches arbitraires) bénéficie du même correctif côté service, sans modification de
ce fichier. Pas de mergetool champ par champ (hors périmètre explicite du ticket).

**Bug préexistant trouvé et corrigé pendant le sprint**

La détection de conflit héritée de T83 (`err.message.includes('MergeConflictError')`) ne
fonctionnait en réalité **jamais** — le message réel de `MergeConflictError` d'isomorphic-git
("Automatic merge failed with one or more merge conflicts in the following files: …") ne contient
pas cette sous-chaîne. Le `catch` tombait donc toujours dans `throw err` : un conflit de merge
remontait comme une erreur non gérée, pas comme l'échec binaire `{ success: false, conflicts }`
documenté depuis T83. Jamais détecté car jamais exercé interactivement (pas de session Electron
disponible ni en T83 ni en T84). Trouvé par reproduction empirique d'un vrai conflit isomorphic-git
dans un dépôt temporaire (script isolé, cf. `specs/T84-sprint1.md`), corrigé en basculant la
détection sur `err instanceof git.Errors.MergeConflictError` (classe typée exportée par
isomorphic-git, donne un accès typé à `.data.filepaths` sans cast).

**Décisions techniques notables**

- `YamlConflict` (interface `base`/`ours`/`theirs`/`conflictingFields`, jamais peuplée, sans
  consommateur au-delà de `.filePath`) supprimée de `sync.service.ts` plutôt que peuplée avec des
  valeurs factices — `MergeResult.conflicts` simplifié en `string[]`, déjà le type attendu côté
  `packages/api-client`.
- Handlers IPC `sync:merge`/`sync:merge-into` simplifiés en passthrough direct — le mapping manuel
  `YamlConflict[] → string[]` devenait un no-op une fois le service aligné.
- Lien de résolution manuelle vers `/version-diff` plutôt que `/graph` : `/graph` n'a pas de
  paramètre de repo (câblé sur `project.localPath`), `/version-diff` accepte déjà
  `repoPath`/`ref1`/`ref2` et les résout par nom via `SelectedRepoContext` + `sync.resolveRefs` —
  aucune route ni endpoint nouveau nécessaire.

**Sprint :** 1 (unique). `tsc --noEmit` propre sur `@polenta/desktop`/`@polenta/api-client`.
`/code-review high` : 8 angles couverts, zéro finding retenu après vérification. Non testé
interactivement (pas d'Electron attachable dans cette session) — le correctif de détection a été
validé par reproduction isolée d'un vrai conflit de merge isomorphic-git, pas par un test dans
l'app complète ; validé manuellement par l'utilisateur sur cette base. Voir `specs/T84.md`,
`specs/T84-design.md`, `specs/T84-tests.md`, `specs/T84-sprint1.md`.

---

### T86 — Retrait Tableau de bord/Droits, branche d'intégration + sélecteur de branche dans l'arbre Structure

**Description fonctionnelle**

Le panneau latéral Projet n'affiche plus que "Modèle de données" — les entrées "Tableau de bord"
(route `/project/$id`) et "Droits" (stub désactivé, jamais implémenté) sont retirées. `/schema`
devient la page d'atterrissage par défaut d'un projet (redémarrage à froid, ouverture/clone/création,
lien "Récents", icône ActivityBar). Le sélecteur affiché sur l'ancien "Tableau de bord" sous le
libellé "Baseline" était en réalité le sélecteur de branche d'intégration (`int-*`, utilisé par
"Publier") — déplacé et renommé "Branche d'intégration" sous la ligne du repo root dans l'onglet
Structure du Modèle de données. Chaque repo de l'arbre (root et composants) gagne en plus un
sélecteur de branche inline à droite de son nom, avec checkout/création réels — un raccourci vers le
même pin que la modale "Modifier" existante, verrouillé en lecture seule (badge, pas de dropdown)
tant que la branche courante est `dev-*` : le changement de branche pendant une modification en cours
passe exclusivement par "Publier"/"Annuler" (T83), jamais par ce sélecteur.

**Décisions techniques notables** :

- Nouveau hook `useBranchCheckout` extrait de la logique jusque-là inline dans `VersionRepoFolder`
  (T78) — partagé par `VersionRepoFolder`, le nouveau `RepoBranchSelector` et
  `IntegrationBranchSelector`, pour ne pas dupliquer la mécanique branches/tags/checkout/create/delete
  entre le panneau Version (outil "avancé", sans restriction) et le nouveau sélecteur de l'arbre
  Structure (restreint par le garde `dev-*`).
- `/schema` résout désormais `repoPath` depuis `useVersioning()` (déjà monté par `AppLayout` dès
  qu'un projet est ouvert) quand le search param est absent — évite une deuxième résolution
  `projectId → repoPath` indépendante pour les points d'entrée qui ne connaissent que l'id encodé.
- Découverte en design, hors périmètre initial anticipé : `/project/$id` n'était pas qu'un lien de
  sidebar mais la destination d'atterrissage par défaut après ouverture de projet et la cible de
  plusieurs boutons "Retour" (`req.$reqId`, `req.new`, `test.$testId`, `test.new`) — tous
  ré-aiguillés vers `/schema`.

**Sprints :** 1 (unique). `tsc --noEmit` et `pnpm build` propres sur `@polenta/desktop`.
`/code-review high` en 8 angles, 9 findings corrigés — dont trois régressions réelles repérées avant
merge : la suppression de `SyncBar` aurait supprimé la seule UI de push de l'app (bouton "Pousser"
restauré dans `VersionRepoFolder`, avec le badge "↑N commit(s) à pousser") ; le checkout inline
n'invalidait pas la query dont dépend le pin affiché ailleurs dans l'arbre (désynchronisation avec la
modale "Modifier") ; `IntegrationBranchSelector`, déplacé verbatim au premier passage, réimplémentait
son propre checkout et contournait ainsi le garde `dev-*` — refactoré pour consommer
`useBranchCheckout` comme le reste. **Testé interactivement** (Electron lancé via le driver Playwright
du worktree) : création d'un projet, sidebar/atterrissage/widgets confirmés visuellement, bouton
"Pousser" confirmé fonctionnel après un commit. Voir `specs/T86.md`, `specs/T86-design.md`,
`specs/T86-tests.md`, `specs/T86-sprint1.md`.

---

### T82 — Le checkout/commit d'un composant propage le pin en cascade dans les `polenta-repo.yaml` amont

**Description fonctionnelle**

Dans le panneau Version (T78), checkouter un composant/interface sur une branche, un tag,
ou (nouveau) un commit (SHA — champ ajouté dans `BranchCombobox`) propose, en modification
en attente (jamais committée automatiquement), la réf checkoutée comme `pin` dans le
`polenta-repo.yaml` de chaque repo du workspace qui déclare ce composant comme dépendance
— pas seulement son parent direct, une dépendance partagée (ex. interface requise par
plusieurs composants) est mise à jour partout où elle est référencée. Committer un repo
qui est lui-même déclaré comme dépendance ailleurs dans le workspace propage de la même
façon le nouveau SHA vers ses propres repos amont — et ainsi de suite : la "cascade" vers
les grands-parents n'est pas un algorithme récursif dédié, elle émerge du fait que le même
mécanisme se redéclenche naturellement à chaque commit. "Publier" (T83) propage le SHA du
commit de **merge** (pas le commit intermédiaire sur la branche `dev-*`, supprimée juste
après). Chaque niveau de la cascade reste une modification en attente indépendante,
jamais un commit silencieux.

**Décisions techniques notables** :

- Nouvelle fonction `propagatePinToDependents()` (`workspaceActions.ts`) réutilisant
  intégralement `addDependency()` déjà livré par T70 (lecture, écriture, rebuild de
  l'arbre, rollback automatique sur diamond-conflict) — pas de nouveau service main-process.
- Recherche des dépendants par balayage de `flatNodes` + lecture de chaque
  `polenta-repo.yaml`, pas via `WorkspaceTreeNode.children` : la construction de l'arbre
  (dédup par un `visited` global) n'attache chaque nœud qu'à un seul parent visuel, même
  si plusieurs repos le déclarent réellement comme dépendance.
- Boucle de propagation volontairement séquentielle (documentée) : chaque
  `addDependency()` réécrit le même `.polenta/tree.cache.yaml` partagé par tout le
  workspace — la paralléliser romprait ce fichier.
- Volontairement **non** câblé sur `createBranch`/`createBranchAt` : le flux "Faire une
  modification" (T83) crée une branche `dev-*` à chaque déclenchement, y proposer un pin
  serait du bruit systématique.
- Trois points de checkout/commit pré-existants (`SyncBar`, la vue Historique `graph.tsx`,
  `IntBranchSelector` dans la vue Projet) restent non câblés : tous scopés au repo root
  aujourd'hui, qui n'est jamais déclaré comme dépendance nulle part — no-op garanti,
  documenté en commentaire à chaque site plutôt que câblé pour rien.
- Corrige au passage un bug de typage pré-existant : `api.sync.commit()` était typé
  `Promise<string>` alors que l'IPC renvoie `{sha, message, timestamp}`.

**Sprint unique.** `tsc --noEmit` propre sur `@polenta/desktop`/`@polenta/api-client`.
`/code-review high` (8 angles en parallèle) : bug critique trouvé indépendamment par 2
angles — l'avertissement de conflit/échec après un commit était rendu à l'intérieur de la
modale de commit, qui se ferme de façon synchrone avant que la propagation asynchrone ne
résolve, le rendant **invisible** en pratique — corrigé en déplaçant son rendu vers une
zone toujours montée. Autres correctifs : deux mutations de checkout (branche/tag vs
commit) fusionnées en une seule pour éliminer un message d'erreur périmé de l'une visible
après le succès de l'autre ; propagation désormais `await`ée dans chaque `onSuccess`
(évite une course entre deux propagations concurrentes sur le cache d'arbre partagé) ;
avertissement de "Publier" réinitialisé au changement de repo concerné ; duplication de
JSX factorisée (`PinPropagationWarning`, `FooterAction`). Non testé interactivement (pas
d'Electron attachable dans les sessions concernées) — validé manuellement par
l'utilisateur sur la base des revues de code et des scénarios de `specs/T82-tests.md`.
Point ouvert noté pour un futur ticket : le câblage manuel à chaque site d'appel n'a pas
de garde-fou structurel empêchant un futur point d'entrée d'oublier la propagation (des
fonctions wrapper remplaçant les appels directs à `api.sync.*` y remédieraient, mais
changeraient la convention d'appel dans toute l'app — hors périmètre de ce ticket). Voir
`specs/T82.md`, `specs/T82-design.md`, `specs/T82-tests.md`, `specs/T82-sprint1.md`.

---

### T83 — Workflow simplifié de modification ("faire une modification" / "Publier" / "Annuler")

**Description fonctionnelle**

Un élément persistant reflète l'état git du repo concerné (root par défaut, repo composant si
`?repo=` est présent) : bouton unique "Faire une modification" quand la branche courante est la
branche d'intégration configurée du repo, ou paire "Publier"/"Annuler" + indicateur "Édition" sur
une branche `dev-*`. Cliquer "Faire une modification" ouvre une popup ne demandant qu'un titre,
crée et checkout `dev-<slug-du-titre>` depuis la branche d'intégration. "Publier" stage, committe
(message = titre) et merge automatiquement dans la branche d'intégration, puis checkout de
l'intégration et suppression de la branche `dev-*` locale — sans review obligatoire. "Annuler"
(confirmation requise) rejette les modifications en attente et revient sur l'intégration. La vue
Projet permet de désigner, parmi les branches `int-*` existantes, laquelle est la branche
d'intégration configurée du repo (persistée dans `config/project.yaml`).

Le flux "Action" préexistant (`ActionService`, branches `user/<login>/ACT-XXXX`, review obligatoire
avant merge) est retiré entièrement (sprint 2) : il n'était atteignable depuis aucune navigation de
l'UI et faisait doublon avec ce workflow simplifié.

**Décisions techniques notables** :

- Réutilise les primitives déjà existantes de `SyncService` (`createBranch`, `stageAll`, `commit`,
  `mergeInto` — ce dernier déjà exposé en IPC mais jamais consommé par un flux automatisé avant ce
  ticket) ; pas de `BranchService`/`MergeService` séparé, contrairement à ce que décrivait encore
  `SPEC-FORKS-BRANCHES-BASELINES.md` (corrigé).
- Lecture de la branche d'intégration configurée via `GitService.getIntegrationBranch` (déjà livré
  par T79) ; T83 ajoute l'écriture (`setIntegrationBranch`, fusion non-destructive dans
  `config/project.yaml`).
- `useModificationMode` (nouveau hook) résout le "repo concerné" indépendamment de
  `SystemViewContext` — ce provider n'est monté que pour le panel Système, alors que l'élément de
  chrome doit être visible partout ; duplique volontairement la petite résolution d'URL plutôt que
  de dépendre d'un provider conditionnel.
- Condition du mode "Vue" resserrée en revue de code : `branche === intégration && branche
  commence par 'int-'` (pas seulement l'égalité) — sinon un repo dont l'intégration n'a jamais été
  configurée (repli `'main'`) afficherait "Lecture" sur une branche en réalité librement éditable.
- `SyncService.discardAll` (nouveau) réutilisé pour corriger au passage un bug préexistant du
  bouton "Tout annuler" du panneau Version, qui ne traitait que les fichiers non stagés malgré son
  libellé.
- Détection de conflit au "Publier" volontairement binaire (succès/échec) — la résolution champ par
  champ reste hors périmètre, réservée à T84.

**Sprints :** 2. `tsc --noEmit` propre sur `@polenta/desktop`/`@polenta/api-client`/`@polenta/types`
aux deux sprints. `/code-review` : sprint 1 en 8 angles, 12 findings corrigés dont un bug destructif
(confirmation "Annuler" non gardée par le mode — pouvait agir sur une branche différente de celle
pour laquelle elle avait été ouverte si le mode changeait pendant que la popup était affichée) ;
sprint 2 (suppression du flux Action) en revue ciblée, a trouvé et corrigé des mentions vivantes du
flux Action oubliées dans `SPEC.md`/`SPEC-REVIEWS.md`/`SPEC-TECH-stack.md` (hors périmètre initial
du design) et une incohérence de type (`CreateReviewDto.actionId` rendu optionnel). Non testé
interactivement (pas d'Electron attachable dans les sessions concernées) — validé manuellement par
l'utilisateur sur la base des revues de code et des scénarios de `specs/T83-tests.md`. Voir
`specs/T83.md`, `specs/T83-design.md`, `specs/T83-tests.md`, `specs/T83-sprint1.md`,
`specs/T83-sprint2.md`.

---

### T80 — La page de diff suit le repo sélectionné dans l'arbre Version

**Description fonctionnelle**

`version-diff.tsx` (page "Comparer deux versions") ne connaissait que le repo root du
workspace. T80 introduit une sélection réelle dans l'arbre multi-repo du panneau
Version (T78) — jusque-là purement un état d'ouverture/fermeture, sans notion de
sélection — et en fait une troisième dimension de comparaison sur `/version-diff`, aux
côtés des deux refs comparées. Sélectionner un repo dans l'arbre = même clic que celui
qui bascule aujourd'hui l'ouverture/fermeture d'un dossier (pas de nouvel élément UI).
Le repo sélectionné est un état partagé entre le panneau Version et `/version-diff` :
si la page est déjà affichée quand l'utilisateur change de sélection dans l'arbre
(toujours visible en sidebar), elle se met à jour en direct — nouvelles refs listées,
Objet A/Objet B et fichier sélectionné réinitialisés (une branche/tag/commit d'un repo
n'a aucune raison d'exister dans un autre). Amorçage possible depuis un paramètre d'URL
`repoPath` pour les liens directs ; en son absence, retombée sur le root. Nom du repo
ciblé affiché sur la page (auparavant implicite, toujours le root).

**Décisions techniques notables** :

- Nouveau contexte `SelectedRepoContext` (`selectedRepoPath`, `rootRepoPath`,
  `selectRepo`), monté dans `AppLayout.tsx` sur le modèle de `VersioningProvider` —
  consomme `useVersioning().repoPath` pour le root plutôt que de dupliquer sa requête
  de résolution de workspace.
- Correctif prérequis découvert en phase Design : `deducePanel()` (`AppLayout.tsx`) ne
  reconnaissait pas `/version-diff` comme panel `'version'` — la sidebar basculait sur
  le panel Projet en quittant l'arbre Version pour la page Comparer, rendant le suivi
  en direct invisible. Inclus dans le même sprint (prérequis strict du critère
  d'acceptation "suivi en direct", pas une extension de périmètre).
- Reset de la sélection au changement de projet via `key={currentProjectId}` sur
  `SelectedRepoProvider` (remount = état frais) plutôt qu'un effet de reset dédié.
- Bug critique trouvé en revue de code (`/code-review high`, convergence indépendante
  de 3 angles sur 8) : le repo sélectionné persistant sur toute la session (pas
  seulement le temps d'une navigation), la résolution `ref1`/`ref2` → SHA pouvait
  s'exécuter contre un repo différent de celui visé si ses refs étaient déjà "chaudes"
  dans le cache react-query (l'utilisateur l'ayant consulté plus tôt ailleurs dans
  l'app) — avant que l'effet d'amorçage n'ait corrigé `repoPath`, avec un verrou
  (`initializedRef`) empêchant ensuite toute nouvelle tentative. Corrigé en gatant la
  résolution sha1/sha2 sur l'achèvement de l'amorçage du repo cible.

**Sprint :** 1 sprint (unique). `tsc --noEmit` propre. `/code-review high` (8 angles) :
bug critique ci-dessus corrigé, plus simplifications sans risque (requêtes `workspace`
dupliquées supprimées, provider unifié dans `AppLayout`, fallback d'affichage du nom de
repo corrigé). Testé interactivement (driver Electron/Playwright) sur fixture mono-repo :
sélection/mise en évidence du root, panneau Version resté visible sur `/version-diff`
(validation directe du correctif `deducePanel`), nom du repo affiché, refs scopées,
liste de fichiers correcte après sélection de deux refs. Scénario multi-repo (suivi en
direct proprement dit, avec un deuxième repo réel) non testé faute de fixture
multi-composant disponible dans la session — validé manuellement par l'utilisateur sur
la base de la revue de code, du test mono-repo et des scénarios de `specs/T80-tests.md`.
Voir `specs/T80.md`, `specs/T80-design.md`, `specs/T80-tests.md`, `specs/T80-sprint1.md`.

---

### T79 — Baseline multi-composant

**Description fonctionnelle**

Une baseline devient un groupe de tags git, un par repo du workspace (root + composants +
interfaces), ancrée sur le repo root. Avant de créer une baseline, la page affiche l'état de
chaque repo (`useWorkspaceStructure`) : branche courante vs branche d'intégration configurée
(`config/project.yaml` → `integrationBranch`), présence de modifications en attente. Condition
bloquante et non contournable (contrairement aux autres avertissements de création de baseline) :
tant qu'un repo est en défaut, la création est désactivée et le repo est listé avec sa raison. Une
fois tous les repos prêts, un tag de même nom est posé sur chaque repo à sa propre HEAD ; la
baseline créée liste dans ses `components` uniquement ceux effectivement tagués avec succès. La
vérification d'unicité du tag (déjà existante pour le root) couvre désormais tous les repos du
workspace.

**Décisions techniques notables** :

- Nouvel endpoint `baseline:get-integration-branch`, backé par `GitService.getIntegrationBranch`
  (nouveau, factorisé depuis un code dupliqué dans `ActionService.readIntegrationBranch`) — namespace
  `baseline:*` plutôt qu'un namespace générique (`git:*`/`workspace:*`), décision YAGNI assumée : seul
  consommateur actuel, à généraliser si un futur ticket (T83 ?) en a besoin.
- Le chaînon de tag multi-repo était déjà à moitié câblé côté main process depuis T69 sprint 3
  (`baseline:create` savait déjà taguer tous les repos du workspace et accepter `dto.components`) —
  jamais alimenté côté UI (`baseline.tsx` envoyait toujours `components: []`, jamais `workspaceDir`).
  T79 ferme ce chaînon plutôt que de réinventer le mécanisme.
- Le type `BaselineComponentSnapshot` (`packages/types/src/baseline.ts`) cité dans le ticket d'origine
  est mort (jamais importé nulle part) — le type réellement câblé est `BaselineComponentRecord`
  (`name`/`tag` uniquement), documenté dans `SPEC-FORKS-BRANCHES-BASELINES.md` §5.3.
- `baseline:create` réécrit pour itérer `dto.components` (ce que l'UI a validé comme prêt) plutôt que
  tous les nœuds d'un `workspaceTree.readCache` séparé et potentiellement périmé, et pour ne renvoyer
  dans `record.components` que les composants effectivement tagués avec succès (bug trouvé en revue :
  l'ancien code renvoyait toujours la liste complète demandée, rendant tout avertissement de tag
  partiel impossible à déclencher).

**Sprint :** 1 sprint (unique). `tsc --noEmit` propre sur `apps/desktop`/`packages/api-client` (seul
échec de typecheck du monorepo, `apps/api`, est pré-existant sur `master`, sans rapport). `/code-review
high` (8 angles) : 3 angles indépendants ont convergé sur le même bug (avertissement de tag partiel
mort) ; corrigé, avec 2 autres corrections (fenêtre de course sur le chargement des tags avant
activation du bouton, conflit de dépendances affichant un chargement infini au lieu d'un message).
Non testé interactivement (pas d'Electron attachable dans cette session) — validé manuellement par
l'utilisateur sur la base de la revue de code et des scénarios de `specs/T79-tests.md`. Voir
`specs/T79.md`, `specs/T79-design.md`, `specs/T79-tests.md`, `specs/T79-sprint1.md`.

---

### T77 — Dashboards personnalisables par requêtes façon SQL

**Description fonctionnelle**

Nouvel onglet "Suivi" dans l'`ActivityBar` : dashboards personnalisables construits à partir de
requêtes sur les champs des exigences/tests, façon SQL. Deux modes de requête (builder guidé par
`schema.yaml`, ou SQL avancé en lecture seule) exécutés via **AlaSQL** sur un dataset reconstruit à
chaque exécution depuis l'index en mémoire déjà existant (repo courant + composants submodules
agrégés) — pas de SQLite ni de base applicative persistée, cohérent avec `CONTEXT.md` D1 et
`SPEC.md` §5. Les requêtes se sauvegardent (privé en préférence locale, ou partagé en YAML
versionné dans `queries/`), avec un historique auto-purgé des entrées devenues invalides. Un
dashboard est une collection de widgets (barres/camembert/courbe/tuile KPI/table, rendus via
`recharts`, jamais contraints par la forme du résultat — aperçu live à la configuration) ; règles
de scope en cascade (widget partagé ⇒ requête partagée ⇒ dashboard partageable), promotion libre
avec remap automatique des références, rétrogradation/suppression bloquées si des dépendants
visibles existent. Le dataset expose aussi `coverageStatus` et 5 critères de maturité (schema-driven,
basés sur `CLAUDE.md` § Règles de cohérence), utilisés par 3 dashboards partagés pré-configurés
(Couverture / Avancement / Maturité) créés automatiquement au premier accès si `dashboards/` est
vide, jamais recréés après suppression volontaire. L'ancien "Tableau de bord" de la page Projet
(StatCards, répartitions, récemment modifiées) est retiré sans reprise.

**Décisions techniques notables** :

- AlaSQL plutôt que SQLite en mémoire : lit directement les tableaux JS déjà produits par les
  services d'index existants, sans étape de matérialisation ni dépendance native supplémentaire —
  et évite de rouvrir la décision D1 (`CONTEXT.md`) qui interdit nommément SQLite.
- Un widget n'a pas de scope propre : toujours embarqué dans le YAML de son dashboard parent, son
  scope effectif est celui du dashboard.
- Limite assumée (documentée, pas un bug) : la détection de dépendants avant suppression/
  rétrogradation d'une requête partagée ne voit pas les dashboards privés d'un *autre* utilisateur
  (fichier `.pref` non partagé, invisible depuis la session courante).
- Outillage transverse créé en cours de route et committé séparément (hors périmètre ticket, sur
  `master` directement) : skill `apps/desktop/.claude/skills/run-desktop/` — driver Playwright pour
  piloter l'app Electron réelle (clics, formulaires, captures d'écran), réutilisable par tout futur
  ticket touchant l'UI desktop.

**Découvertes en cours de route (au-delà du périmètre initial)** :

- Bug T63 (`covered`/`validated` inversés dans `computeCoverageStatus`) jamais appliqué à la copie
  `apps/desktop` — seule `apps/api` avait été corrigée à l'époque. Corrigé au sprint 3 : **change le
  comportement observable de la Matrice de traçabilité existante**, pas seulement des nouveaux
  dashboards, pour toute exigence dont les tests liés sont partiellement exécutés.
- Un bug d'agrégation de couverture par repo (au lieu du périmètre workspace complet, contrairement
  à `getMatrix()`) a été introduit puis corrigé dans ce même sprint avant merge.
- Plusieurs bugs de garde-fous trouvés en `/code-review high` à chaque sprint (SQL généré par le
  builder non passé par le garde-fou lecture-seule, `SELECT ... INTO` non bloqué — écrit réellement
  un fichier via AlaSQL —, opérateurs "contient"/"dans" cassés, contournement du garde-fou de scope
  via un appel IPC direct sur `addWidget`, crash sur `objectTypeRef` manquant, race condition sur le
  seed des dashboards par défaut) — détail complet dans `specs/T77-sprint1.md` à `T77-sprint3.md`.

**Sprints :** 3 sprints. Voir `specs/T77.md`, `specs/T77-design.md`, `specs/T77-tests.md`,
`specs/T77-sprint1.md`, `specs/T77-sprint2.md`, `specs/T77-sprint3.md` pour le détail complet.
SPEC mises à jour : `SPEC.md` §2.7 (nouveau), `specs/SPEC-DASHBOARDS.md` (nouveau), `SPEC-TECH-stack.md`,
`SPEC-TRACEABILITY.md`, `SPEC-INDEX.md`.

**Vérification** : `/code-review high` à chaque sprint (findings réels corrigés, pas seulement du
style) + sessions interactives réelles de l'app Electron via le skill `run-desktop` (captures
d'écran) pour les 3 sprints. Aucun test automatisé (`vitest`/`jest`) n'existe dans ce monorepo.
**Non testé manuellement par l'utilisateur avant merge** (mergé sur demande explicite, validation
manuelle prévue après coup) — en particulier le changement de comportement de la Matrice de
traçabilité (bug T63) et le taux de maturité sur un vrai jeu d'exigences saisies dans l'UI.

---

### T78 — Arbre multi-repo pour le panneau latéral Version

**Description fonctionnelle**

Remplace `VersionPanel.tsx` (qui n'opérait que sur le repo root) par un arbre listant tous les
repos du workspace (root + composants + interfaces, même source que `useWorkspaceStructure`
utilisée par l'onglet Structure) : un dossier ouvrable/fermable par repo. Dossier fermé : nom du
repo, badge "dirty" (point ambre) si des modifications sont en attente, vignette checkout
(branche/tag/commit courant) — visible sans avoir besoin d'ouvrir le dossier. Dossier ouvert :
Checkout (combobox branches/tags), Stagés, Modifications, scopés uniquement à ce repo, avec les
mêmes actions qu'avant (stage/unstage/discard/commit/checkout/créer-supprimer branche). Tous les
dossiers sont ouverts par défaut, le root est mis en évidence. Bouton "Publier" (placeholder
T30-E, désactivé) supprimé — reviendra avec une vraie logique via T83.

**Décisions techniques notables** :

- `BranchCombobox` extrait à l'identique dans `version/BranchCombobox.tsx`. Nouveau composant
  récursif `version/VersionRepoFolder.tsx` : une instance par repo de l'arbre, chacune avec ses
  propres queries/mutations `api.sync.*` scopées par `repoPath` (pas d'état centralisé) — même
  principe que `RepoRow` dans `StructureTab.tsx`.
- La query `sync:status` (badge dirty) tourne en continu dès que le composant est monté, pas
  seulement quand le dossier est ouvert ; `sync:branches`/`sync:tags` restent gatées par `open`
  (seulement utiles à la combobox visible dans le dossier ouvert).
- `VersioningContext` (root uniquement, lock icon du header) n'est pas touché — `VersionRepoFolder`
  déclenche juste un `refetch()` explicite dessus après un checkout/création/suppression de
  branche sur le root, pour ne pas perdre le rafraîchissement immédiat qu'avait l'ancien code.
- `isRoot` du nœud de premier niveau est toujours `true` (l'arbre renvoyé par
  `useWorkspaceStructure` n'a jamais plus d'un nœud racine) plutôt que comparé par `repoPath`,
  qui aurait été racial tant que la résolution du root n'est pas terminée.
- Conflit de dépendances diamant (`conflicts` de `useWorkspaceStructure`) affiché comme message
  renvoyant vers l'onglet Structure, plutôt que de dupliquer la modale de résolution dans le
  panneau Version.

**Sprint :** 1 sprint (unique). `npx tsc --noEmit` propre. `/code-review high` (8 angles) : 4
findings corrigés (garde `enabled` manquante sur `sync:status`, `isRoot` racial, conflit diamant
silencieux, `refetch()` VersioningContext perdu) ; 4 autres pistes (duplication du header de
dossier avec `RepoRow`, duplication Stagés/Modifications, polling séquentiel de `discardAll`,
polling branches/tags pour tous les dossiers ouverts par défaut) laissées telles quelles —
décisions de design déjà validées ou comportements préexistants hors périmètre. Testé
interactivement via le skill `run-desktop` (Playwright `_electron`) sur un projet mono-repo réel :
arbre, badge dirty visible dossier fermé, stage/commit bout-en-bout, bouton "Publier" absent. Cas
multi-repo (composant/interface) non testé interactivement (pas de remote git clonable dans le
bac à sable de la session) — couvert par code review + typecheck uniquement. Validé manuellement
par l'utilisateur. Voir `specs/T78.md`, `specs/T78-design.md`, `specs/T78-tests.md`,
`specs/T78-sprint1.md`.

---

### T81 — Renommage nomenclature de branches `prj-*`/`tck-*` → `int-*`/`dev-*`

**Description fonctionnelle**

Renommage mécanique du préfixe de nomenclature de branches introduit par T30 : `prj-*`
(branches d'intégration, lecture seule) devient `int-*` ; `tck-*` (branches de développement)
devient `dev-*`. Objectif : lever l'ambiguïté avec la notion de **ticket** du workflow de
développement de Polenta lui-même (`TICKETS.md`/`WORKFLOW.md`, tickets `T{N}`), qui n'a aucun
rapport avec les branches `tck-*` d'un projet Polenta.

Fichiers touchés : `packages/api-client/src/types.ts` (`BranchInfo.type`),
`apps/desktop/src/main/services/sync.service.ts` (`listBranches()`),
`apps/desktop/src/renderer/contexts/VersioningContext.tsx` (`isReadonly`),
`apps/desktop/src/renderer/routes/project.$id.tsx` (`PrjBranchSelector` → `IntBranchSelector`),
`apps/desktop/src/renderer/components/sidebar/VersionPanel.tsx` (badge de branche).

**Sprint :** 1 sprint (unique). Renommage complet, aucun consommateur de `BranchInfo`/
`listBranches` oublié (vérifié par grep exhaustif). Typecheck propre sur les paquets touchés
(une erreur préexistante sur `apps/api` non liée à ce ticket, confirmée présente avant le
changement). `/code-review medium` : 0 finding. Vérifié avec l'utilisateur : aucune branche
réelle `prj-*`/`tck-*` en usage à ce jour, aucun script de migration nécessaire. Validé
manuellement par l'utilisateur. Voir `specs/T81.md`, `specs/T81-sprint1.md`.

---

### T59 — Vue diff dédiée (page `/version-diff`)

**Description fonctionnelle**

Nouvelle page dédiée pour comparer deux objets versionnés (branche, tag ou commit) : panel
latéral avec deux comboboxes de sélection + liste des fichiers modifiés, zone principale
affichant le diff du fichier sélectionné. Les actions "Diff vs HEAD" et "Diff vs branche…" du
menu contextuel de `graph.tsx` naviguent désormais vers cette page (avec `sha1`/`sha2`/`ref2`
pré-remplis) au lieu d'afficher un panneau inline dans la table des commits.

**Décisions techniques notables** :

- Le panel diff inline précédemment ajouté dans `CommitFilesRow` (`graph.tsx`, sprint 1) a été
  entièrement retiré au sprint 2 au profit de la navigation vers `/version-diff` — `diffShas`,
  `diffTarget`, `handleDiff`, `onDiff` supprimés.
- Tous les paramètres de recherche (`ref1`, `ref2`, `sha1`, `sha2`) sont passés explicitement
  dans l'URL (même `undefined`) car TanStack Router exige que tous les champs du
  `validateSearch` soient présents.
- Le clic sur un fichier dans le panneau expand/collapse d'un commit continue de naviguer vers
  `/diff` (diff du fichier dans ce commit vs son parent) — distinct de `/version-diff`.

**Sprints :** 2 sprints. Sprint 1 : nouvelle route `/version-diff` (panel + comboboxes + liste
fichiers). Sprint 2 : migration des actions diff du menu contextuel de `graph.tsx` vers cette
page, suppression du panel inline devenu redondant. `npx tsc --noEmit` propre. Validé
manuellement par l'utilisateur. Voir `specs/T59.md`, `specs/T59-design.md`, `specs/T59-tests.md`,
`specs/T59-sprint2.md`.

---

### T57 — Menu contextuel (clic droit) dans l'arbre de versions

**Description fonctionnelle**

Ajout d'un menu contextuel clic droit dans `graph.tsx` sur les badges de branche, les badges de
tag et les lignes de commit, avec 3 menus distincts :
- **Branche** : Checkout, Merger → courant, Rebaser, Pousser, Supprimer locale/remote (avec
  confirmation), Diff vs HEAD, Diff vs branche…
- **Tag** : Checkout, Créer branche depuis ce tag, Supprimer (confirmation), Diff vs HEAD, Diff
  vs branche…
- **Commit** : Checkout (HEAD détaché), Créer branche, Créer tag, Rebaser, Diff vs HEAD, Diff vs
  branche…

Les actions destructives (suppression) exigent un second clic de confirmation (le premier passe
l'item en "Confirmer ?"). Les prompts de saisie (nom de branche/tag) s'affichent inline dans le
menu. Sprint 1 a aussi ajouté les services git et handlers IPC nécessaires côté main process.

**Décisions techniques notables** :

- Menu rendu via `createPortal` dans `document.body`, positionné au curseur, avec recentrage
  automatique s'il déborde en bas/droite (`useLayoutEffect`).
- Distinction tag/branche via une query dédiée `sync:tags` (`Set<string>` des refs qui sont des
  tags) plutôt qu'une convention de nommage.
- `commitSha?` ajouté à `createTag` (types.ts/ipc-client.ts) en sprint 2 — paramètre oublié au
  sprint 1, sans quoi "Créer tag" depuis un commit non-HEAD taguait toujours HEAD.

**Sprints :** 2 sprints. `specs/T57-sprint1.md`/`T57-sprint2.md` détaillent les fichiers modifiés.
Le panneau diff inline introduit dans ce ticket a ensuite été remplacé par la page dédiée dans
[[T59]]. Validé manuellement par l'utilisateur. Voir `specs/T57.md`, `specs/T57-design.md`,
`specs/T57-tests.md`, `specs/T57-sprint1.md`, `specs/T57-sprint2.md`.

---

### T56 — Nom d'élément perdu après navigation

**Bug** : renommer un élément (ou tout autre changement d'arbre) depuis le panel latéral
(`SystemPanel.tsx`) ne persistait qu'en état React local (`setRoot`) sans appeler
`api.tree.save(...)` — au retour sur la vue après navigation, `SystemViewContext` re-fetchait
l'arbre depuis le backend qui n'avait jamais reçu le changement, et le renommage était perdu. Le
même chemin dans `SystemView.tsx` (`handleRenameNode`, `handleRootChangeDnd`) appelait déjà
`api.tree.save` — seul le panel latéral l'omettait.

**Correctif** : `handleRootChange` dans `SystemPanel.tsx` appelle désormais `api.tree.save`
immédiatement après `setRoot` (en passant `newRoot` explicitement, `root` n'étant pas encore à
jour au moment de l'appel asynchrone), puis invalide la query `['tree', ...]`.

Validé manuellement par l'utilisateur. Voir `specs/T56.md`.

---

### T55 — Drag & drop fait disparaître des items dans l'arbre

**Bug** : dans `ElementTree.tsx`, glisser un dossier sur lui-même ou dans un de ses
sous-dossiers faisait disparaître le dossier et tout son contenu. `handleDrop` ne gardait que le
cas `position='before'`/`'after'` (cible = source) ; le cas `position='inside'` (cible = source
ou descendant de la source) n'était pas couvert : `treeRemoveMany` supprimait le nœud source, puis
`treeInsert` tentait d'insérer dans un `parentId` qui n'existait plus et échouait silencieusement.

**Correctif** : nouvelle fonction `treeIsAncestorOrSelf` (`useTreeState.ts`) + garde
supplémentaire dans `handleDrop` qui annule le drop (no-op) si la cible est le nœud glissé
lui-même ou un de ses descendants.

Fichiers modifiés : `useTreeState.ts`, `ElementTree.tsx`. Validé manuellement par l'utilisateur.
Voir `specs/T55.md`.

---

### T54 — Retour depuis édition restaure la mauvaise vue (Word/Excel)

**Bug** : `handleEditBack` dans `SystemView.tsx` restaurait toujours la vue `'excel'` après un
clic sur "Retour" dans `EditView`, même si l'utilisateur venait de la vue Word — rien ne mémorisait
la vue active avant l'entrée en mode édition.

**Correctif** : ajout d'un `prevViewModeRef` (ref React, pas un état — la valeur n'est lue qu'une
fois au clic et ne doit pas déclencher de re-render), mis à jour à chaque fois que `viewMode`
prend une valeur non-edit (`'excel'`/`'word'`), y compris à la restauration depuis
`localStorage`. `handleEditBack` restaure `prevViewModeRef.current` au lieu de la valeur codée en
dur.

Fichier modifié : `SystemView.tsx`. Validé manuellement par l'utilisateur. Voir `specs/T54.md`.

---

### T53 — Suppression de fichier ne peut pas être stagée (vue Version)

**Bug** : `sync.service.ts` appelait systématiquement `git.add()` (isomorphic-git) pour stager un
fichier. `git.add()` lit le fichier depuis le disque — pour un fichier supprimé (statut `D`), il
n'existe plus et l'appel lève `ENOENT`, faisant échouer silencieusement le staging côté renderer.
`stageAll()` avait le même trou : `git.add({ filepath: '.' })` ne retire pas du disque les
entrées d'index des fichiers supprimés.

**Correctif** : `stage()` détecte l'absence du fichier sur disque (`fsP.access`) et appelle
`git.remove()` (qui retire l'entrée d'index sans toucher au disque) au lieu de `git.add()`.
`stageAll()` parcourt d'abord `git.statusMatrix` pour appeler `git.remove()` sur toute entrée
`head=1, workdir=0` avant le `git.add({ filepath: '.' })` classique.

Fichier modifié : `sync.service.ts`. Validé manuellement par l'utilisateur. Voir `specs/T53.md`.

---

### T38 — Changement de statut impossible dans les vues Excel/Word/Test

**Bug** : dans `SystemView.tsx`, `autoSaveMutation` (`handleAutoInlineEdit`) traitait le champ
`status` uniquement pour `cat === 'requirement'` (via `api.requirements.transition`) ; pour
`cat === 'test'`, la fonction retournait sans rien envoyer au backend, avec un commentaire
"tests: no direct status transition API" — inexact, `TestsService.update()` et l'IPC
`tests:update` supportaient déjà le champ `status`. Le bug touchait les vues Excel, Word et Test
(toutes passent par `handleAutoInlineEdit`) ; les exigences n'étaient pas affectées.

**Correctif** : ajout de la branche `cat === 'test'` dans `autoSaveMutation`, appelant
`api.tests.update(repoPath, objectId, { status: value })`.

Fichier modifié : `SystemView.tsx`. Validé manuellement par l'utilisateur. Voir `specs/T38.md`.

---

### T52 — Restaurer la sélection composant/élément de la vue Système

**Description fonctionnelle**

La vue Système pilotait déjà repo/composant/type via l'URL, mais rien ne survivait à un
aller-retour vers un autre panneau (`AppLayout.handleSelectPanel('system')` remettait ces params
à `undefined` à chaque clic, et `SystemViewProvider` était démonté entre-temps) ni à un
redémarrage de l'app (rien n'était écrit sur disque) : le retour sur la vue Système retombait
systématiquement sur le composant racine et le premier élément.

La dernière sélection valide (repo + composant + type) est désormais persistée dans
`localStorage` (`polenta:lastSelection:${projectId}`, propre à chaque projet) et relue dans
l'effet de défaut de `SystemViewContext` quand la vue est atteinte avec une URL totalement vide
(retour d'un autre panneau, redémarrage, ancien lien pré-T72). Un lien qui précise déjà un `repo`
explicite (même sans `node`) garde son comportement de défaut d'origine — la restauration ne
s'applique qu'à l'entrée totalement vide. Fallback silencieux au comportement par défaut si le
composant ou le type sauvegardé n'existe plus dans le schéma courant.

**Décisions techniques notables** :

- Persistance côté renderer uniquement (`localStorage`), sur le modèle de
  `polenta:viewMode:${repoPath}` déjà en place — pas de fichier `.pref` partagé, c'est un confort
  de navigation individuel.
- Restauration gardée par `allSchemasLoaded` (déjà exposé par `useWorkspaceStructure`, jusque-là
  inutilisé) : `schemasByRepoPath` est peuplé par une requête indépendante par repo du workspace ;
  décider avant que tous les schémas soient chargés pouvait traiter à tort une sélection
  sauvegardée comme invalide et l'écraser définitivement (bug trouvé en `/code-review`, corrigé
  avant clôture du sprint).
- Effet d'écriture gardé sur les paramètres d'URL bruts (pas seulement les valeurs résolues avec
  fallback) pour éviter une double écriture au montage qui persistait la valeur par défaut
  transitoire avant que la navigation de restauration n'ait mis à jour l'URL.

**Hors scope, documenté pour un ticket séparé** : `SystemViewProvider` est aussi monté sur les
routes historiques `/req/$reqId`, `/test/$testId`, `/campaign/$campaignId` (sans paramètre `repo`
dans leur URL), déjà systématiquement redirigées vers `/product` avant ce ticket — probable
reliquat de l'ancienne organisation en onglets Exigences/Tests/Campagne, déjà notée comme
dépréciée dans `SPEC-SYSTEM-VIEW.md`. T52 change seulement la destination de cette redirection
préexistante sans l'introduire ni la corriger.

**Sprints :** 1 sprint. Seul fichier de code modifié : `SystemViewContext.tsx`. `/code-review`
(effort high, 8 angles + vérification croisée) : 3 bugs de correction confirmés et corrigés (voir
ci-dessus), 1 problème pré-existant hors scope identifié et documenté, 1 duplication mineure de
pattern `localStorage` laissée telle quelle (cohérente avec l'absence de convention existante dans
le code). `pnpm typecheck` propre. Aucune suite de tests automatisés dans ce projet. Validé
manuellement par l'utilisateur.

---

### T50 — Champs personnalisés (richtext inclus) pour les campagnes de test

**Description fonctionnelle**

Le ticket signalait un manque de richtext dans la vue d'exécution des tests, la
description de campagne et les étapes de test. Investigation : les commentaires
d'exécution (`StepResult.comment`, `TestRun.notes`) et les étapes de définition
(`action`/`expectedResult`) étaient déjà en richtext. Seul `TestCampaign.description`
restait un champ système en texte brut.

Décision validée avec l'utilisateur : au lieu de rendre `description` richtext
directement, ce champ codé en dur est supprimé. La catégorie `campaign` gagne le
même mécanisme générique de champs personnalisés (`fields{}` + `objectTypeRef`)
que `requirement`/`test` — déjà prévu dans le modèle de schéma (`ObjectCategory`
incluait déjà `'campaign'`, l'éditeur de schéma proposait déjà cette catégorie)
mais jamais câblé côté `TestCampaign`. Un projet qui veut une description de
campagne l'ajoute désormais comme champ personnalisé (`richtext` ou autre) via
`schema.yaml`, exactement comme pour les exigences et les tests.

Nouveau endpoint `campaigns:update` (merge des `fields`, mirroring
`tests.service.ts`). `campaign.new.tsx` affiche un sélecteur de type + les champs
personnalisés du type (`DynamicField`, richtext inclus) à la place de l'ancien
textarea "Description". `campaign.$campaignId.tsx` affiche ces champs en lecture
(`RichTextViewer` pour le richtext) avec un mode édition inline.

**Décisions techniques notables** :

- **Zod non ajouté** : un `campaign.schema.ts` était prévu en design par cohérence
  avec `test.schema.ts`, mais aucun consommateur n'existe (`apps/api` n'a pas de
  module campaigns) — non créé pour éviter du code mort.
- **Pas de migration** des anciennes valeurs `description` : aucune donnée de
  production affectée à ce jour.
- **Hors scope** : `TestStep.notes` (définition, aucun éditeur existant) et
  `preconditions`/`postconditions` du `TestCase` (textarea brut malgré leur
  typage richtext) — incohérences pré-existantes non traitées par ce ticket.

**Sprints :** 1 sprint. 3 usages résiduels de `campaign.description` non anticipés
en design (`SearchPanel.tsx`, `SystemPanel.tsx`, `CampaignListView.tsx` — recherche,
filtre panneau latéral, aperçu liste) révélés par le typecheck et corrigés dans le
même sprint. `/code-review` (effort medium) : aucun bug confirmé. `pnpm typecheck`
propre sur les packages touchés (une erreur préexistante et non liée dans
`apps/api`, déjà présente sur `master`). Validé manuellement par l'utilisateur.

---

### T47 — Ajouter draw.io dans richtext (affichage et édition)

**Description fonctionnelle**

Un champ `richtext` peut désormais référencer un ou plusieurs diagrammes draw.io
insérés depuis la toolbar de l'éditeur ("Insérer un diagramme draw.io"),
positionnés librement dans le texte. Stockage en **référence** à un fichier
`.drawio` existant du repo (jamais de XML embarqué inline), avec une ancre
optionnelle vers une page ou une cellule précise — cohérent avec la décision D4
de `CONTEXT.md`. Sérialisation Markdown en bloc fenced dédié, contenu JSON
(`{"path":...,"nodeId":...}`) plutôt qu'un séparateur `#` (qui aurait cassé le
round-trip pour un chemin contenant lui-même un `#`).

Affichage rendu via le **viewer officiel draw.io vendoré** (`viewer.min.js`,
moteur mxGraph réel, `jgraph/drawio`, licence Apache-2.0), chargé localement —
pas d'éditeur draw.io intégré, pas d'iframe `embed.diagrams.net`, aucune
requête réseau (chemins réseau par défaut du script neutralisés au chargement).
Double-clic sur le diagramme rendu ouvre le fichier dans l'application draw.io
externe du poste ; l'aperçu se rafraîchit automatiquement au retour de focus
sur la fenêtre. Fichier introuvable ou XML invalide → état d'erreur explicite
inline, jamais de crash de l'éditeur.

Corrige au passage un bug pré-existant sans rapport direct mais partageant le
même mécanisme : le bouton "Ouvrir dans Draw.io" du champ de type `drawio`
autonome était cassé depuis toujours (appelait un `window.electronAPI`
inexistant) — réutilise désormais le canal IPC `drawio.openExternal` créé pour
ce ticket.

**Décisions techniques notables** :

- **Rendu (revu après merge)** : le sprint 1 avait d'abord écarté le viewer
  officiel draw.io au profit d'un rendu SVG maison (`drawioRender.ts`), par
  prudence vis-à-vis du vendoring d'un binaire tiers non audité. Une fois testé
  en conditions réelles, ce rendu maison s'est avéré insuffisant (connecteurs
  mal routés — lignes centre-à-centre sans respect des points de connexion ni
  du routage orthogonal réel). Sur demande explicite de fidélité identique à
  draw.io, retour au plan initial : `viewer.min.js` vendoré dans
  `public/vendor/`, intégré via l'API interne `GraphViewer.createViewerForElement`
  (confirmée par inspection du bundle minifié, non documentée publiquement).
  Le surlignage de cellule (`nodeId` ancré sur une cellule) utilise directement
  les coordonnées écran du graphe du viewer (`graph.getView().getState(cell)`)
  plutôt qu'un calcul de géométrie maison.
- **Bug d'insertion post-merge** : le sélecteur de fichier natif fait perdre le
  focus fenêtre, déclenchant un `blur` DOM avec `relatedTarget: null` sur le
  champ richtext actif. Trois emplacements distincts du code (dont un dans
  `WordView.tsx`, non couvert par le premier correctif) traitaient ce blur
  comme "l'utilisateur a cliqué ailleurs" et fermaient/démontaient le champ en
  cours d'édition, perdant l'état du flux d'insertion en cours. Corrigé en ne
  déclenchant plus ces fermetures que sur un `relatedTarget` réel.

**Sprints :** 2 sprints planifiés (sprint 1 : node TipTap `drawioEmbed`, IPC
`drawio.read`/`drawio.openExternal`, fix du bouton cassé ; sprint 2 : UI
d'insertion — sélection fichier restreinte au repo courant y compris
cross-drive Windows, choix de page si le fichier en contient plusieurs) +
un round de corrections post-merge en conditions réelles (bug d'insertion
ci-dessus, puis remplacement du rendu par le viewer officiel — voir
`specs/T47-sprint3.md`). `/code-review` (agents indépendants) lancé sur les
sprints 1 et 2 : 4 bugs réels trouvés et corrigés avant commit (boucle
infinie possible sur une chaîne de parents cycliques dans l'ancien rendu
maison, corruption du round-trip Markdown par le séparateur `#`, course sur
des réponses async tardives dans le NodeView, absence de garde anti-double-clic
sur le bouton d'insertion). Vérifié par `pnpm typecheck` et `pnpm build`
(bundling) à chaque étape ; le bug d'insertion et le rendu final ont été
confirmés par test manuel de l'utilisateur dans l'app réelle (seule
vérification en conditions réelles possible depuis cet environnement
d'implémentation, sans Electron/affichage attachable).

---

### T74 — Éditer / retirer un composant ou une interface dans l'arbre Structure

**Description fonctionnelle**

Chaque repo non-racine de l'onglet Structure gagne deux actions, à côté du crayon existant qui
renomme déjà le `SystemNode` local : "Modifier la dépendance" (branche/pin, rôles pour une
interface, et renommage du mount avec mise à jour en cascade de tous les `implements[].interface`
du workspace qui pointent vers l'ancien nom — y compris chez des composants qui ne sont pas le
parent direct de l'interface renommée) et "Retirer" (retrait de `polenta-repo.yaml`, avec case à
cocher optionnelle "supprimer aussi le dossier local", et nettoyage automatique de la déclaration
`implements` correspondante côté parent pour une interface retirée).

**Bug de sécurité pré-existant trouvé et corrigé** (T69/T70, pas introduit par ce ticket mais
rendu déclenchable en usage normal par lui) : `WorkspaceTreeService.buildTree()` clonait
par-dessus un repo déjà cloné dès que son pin n'était pas résolvable localement — or
`isomorphic-git`'s `clone()` réinitialise `.git` avant même la tentative réseau, donc éditer la
branche d'une dépendance existante vers un nom invalide détruisait son historique git. Corrigé via
un nouveau `SyncService.fetch()` + `WorkspaceTreeService.hasGitDir()` : un repo déjà cloné n'est
plus jamais recloné, seulement `fetch()` puis `checkout()`.

**Sprints :** 2 sprints — sprint 1 (édition branche/rôles + retrait, réutilise `addDependency()`
existante) et sprint 2 (renommage de mount avec cascade, nouveau canal IPC de renommage physique
de répertoire). Vérifié en conditions réelles (app buildée et pilotée via Playwright `_electron`,
aucun harnais de test existant pour ce projet) contre le workspace de démonstration à 6 repos
`polenta-prj2` : édition de branche (succès et échec), édition de rôles, retrait avec/sans
suppression disque, et renommage avec cascade confirmée sur deux composants qui ne sont pas le
parent direct de l'interface renommée.

---

### T73 — Bug : combobox Composant affiche "Produit" plusieurs fois

**Root cause & correctif**

Le combobox Composant introduit par T72 affichait le label du `SystemNode` local d'un repo à la
place du mount name dès qu'un label était présent, au lieu de le compléter. Plusieurs repos du
workspace `polenta-prj2` partagent le même label générique "Produit" (label réel de `HMI` jamais
renommé, et label par défaut de `DEFAULT_SCHEMA` pour `BMS` qui n'a pas de `schema.yaml`),
rendant le combobox inutilisable pour les distinguer — contredisant au passage ce que
`SPEC-SYSTEM-VIEW.md` documentait déjà pour ce même ticket T72. Corrigé en conservant toujours le
mount name, suffixé du label local uniquement s'il diffère (`HMI — Produit`, `comp-controller —
Contrôleur (maître bus UART)`…).

**Sprints :** correctif d'une ligne, vérifié en conditions réelles (app buildée + pilotée via
Playwright `_electron`) contre le même workspace de démonstration à 6 repos que T72.

---

### T72 — Vue système multi-repo

**Description fonctionnelle**

Le combobox Composant de la vue Système liste désormais tous les repos du workspace (racine +
dépendances récursives, composants et interfaces confondus, à plat — même liste que l'onglet
Structure), au lieu des seuls `SystemNode` locaux du repo racine. Sélectionner un repo recharge
schéma/arbre/index requirements-tests/liens sur son propre `repoPath` — création/édition d'un
élément s'effectue bien dans le repo sélectionné. Nouveau paramètre d'URL `repo`, rétro-compatible
(absent → repo racine par défaut). Un repo dont le pin (`polenta-repo.yaml`) résout vers un
tag/SHA (HEAD détaché) passe en lecture seule (bandeau explicite), via `api.sync.status` — déjà
utilisé par `VersioningContext` pour le même besoin sur le repo racine. La résolution du titre
d'un objet cible d'un lien cross-repo (affiché en ID brut) reste hors périmètre.

**Sprints :** 1 sprint — entièrement construit sur des primitives déjà existantes
(`useWorkspaceStructure` de T70, `api.sync.status` déjà utilisé par `VersioningContext`) : aucun
nouveau canal IPC, aucun nouveau type partagé. Un bug de course (écriture de `repo=''` dans l'URL
si `useWorkspaceStructure` résout après le schéma du repo racine) a été détecté et corrigé en
auto-review avant commit. Vérifié manuellement en conditions réelles (app buildée + pilotée via
Playwright `_electron`) contre un workspace de démonstration à 6 repos.

---

### T71 — Version d'interface implémentée dérivée du pin git

**Description fonctionnelle**

La "version implémentée" d'une interface par un composant n'est plus une chaîne semver déclarée à la main (`ImplementsDeclaration.version` dans `schema.yaml` → `implements:`), mais dérivée du pin git (SHA/tag/branche) réellement épinglé pour le mount de l'interface dans l'arbre du workspace courant (`WorkspaceTreeNode.pin`). Supprime le risque de divergence entre une version déclarée à la main et l'état git réel. Le formulaire "+ Interface" et l'onglet Interfaces n'ont plus de champ de saisie libre ; la version affichée est résolue à la volée (tronquée à 8 caractères, états "chargement…"/"non résolu"). Les composants implémentant des versions différentes de la même interface (legacy vs récent) continuent de passer par le mécanisme existant de diamond-conflict + `MountOverride` — aucune nouvelle logique de compatibilité introduite.

**Sprints :** 1 sprint — retrait du champ `version` des types partagés, ajustement des formulaires (`AddDependencyModal.tsx`, `InterfacesTab` dans `schema.tsx`), résolution du pin via `useWorkspaceStructure` (nouveau champ `flatNodes` exposé).

---

### T69 — Refonte architecture workspace & composants interface

**Description fonctionnelle**

Remplacement des git submodules par un workspace plat géré par Polenta. Tous les repos sont clonés au même niveau dans un répertoire de travail. Chaque repo déclare ses dépendances directes dans `polenta-repo.yaml`. Polenta reconstruit l'arbre complet par parsing récursif DFS avec détection de cycles et de diamond deps. Introduction des composants interface versionnés avec rôles (producer/consumer, master/slave, etc.) et matrice de conformité.

**Sprints :** 4 sprints — marqueur workspace + UI, parsing récursif + diamond, migration services core, interfaces versionnées + matrice de conformité.

---

### T57 — Compte de campagnes cliquable dans le panel latéral

**Description fonctionnelle**

Dans le panel latéral système, quand le type sélectionné est de catégorie `campaign`, la barre d'en-tête affiche un texte "N campagnes" non-interactif. T57 le transforme en bouton cliquable qui navigue vers la vue liste complète des campagnes (`CampaignListView`).

**Comportement attendu**

- Le texte "N campagnes" (ou "X/N campagnes" si un filtre est actif) devient un bouton
- Cliquer navigue vers `/components` avec `component`, `type` et `projectId` pour afficher la `CampaignListView` dans la zone principale
- Utile notamment quand l'utilisateur est sur la page détail d'une campagne (`/campaign/$campaignId`) et veut revenir à la liste

**Design technique**

| Fichier | Changement |
|---------|------------|
| `apps/desktop/src/renderer/components/sidebar/SystemPanel.tsx` | Dans `CampaignNavList`, remplacer le `<span>` du compteur par un `<button>` qui navigue vers `/components` |

**Scénarios de test**

- [ ] Panel latéral avec campagnes : le texte "N campagnes" a un style cliquable (curseur pointer, hover visible)
- [ ] Clic sur le count depuis la page détail d'une campagne → retour à la liste des campagnes
- [ ] Clic depuis la vue liste (déjà sur `/components`) → re-navigation sans effet visible
- [ ] Filtre actif "X/N campagnes" → clic fonctionne aussi

**Implémenté** — branch T41

**Fichiers modifiés :**
- `apps/desktop/src/renderer/components/sidebar/SystemPanel.tsx` — `CampaignNavList` : `<span>` compteur → `<button>` qui navigue vers `/components`

---

### T40 — Vue d'exécution de test en page complète

**Description fonctionnelle**

La vue d'exécution de test est actuellement une modal superposée (`ExecuteModal`, `fixed inset-0 z-50 max-w-3xl`). T40 la remplace par une page dédiée à pleine largeur, offrant plus d'espace pour les commentaires par étape et le commentaire global.

**Comportement attendu**

- Cliquer "Exécuter" sur un test navigue vers `/campaign/$campaignId/execute/$testId` (au lieu d'ouvrir une modal)
- La page affiche le même contenu que l'ancienne modal : préconditions, tableau des étapes avec status/commentaire par étape, postconditions, commentaire global, résultat global
- Les champs richtext (commentaires) bénéficient de toute la largeur de la page — pas de contrainte `max-w-3xl`
- Bouton "Annuler" → retour à `/campaign/$campaignId` avec les mêmes search params
- Bouton "Soumettre le résultat" → même mutation qu'avant, redirige vers `/campaign/$campaignId` après succès
- La `RichTextToolbar` apparaît dans le header de la page quand un champ richtext est en focus (même pattern que SystemView)

**Hors scope**

- Sauvegarde automatique de l'état en cours (si l'utilisateur navigue ailleurs, les données sont perdues — même qu'avant)
- Modification du comportement de soumission

**Design technique**

Sprint unique — 1 nouveau fichier, 1 fichier modifié :

| Fichier | Changement |
|---------|------------|
| `apps/desktop/src/renderer/routes/campaign.$campaignId.execute.$testId.tsx` | **Nouveau** — page d'exécution pleine largeur (contenu extrait de `ExecuteModal`) |
| `apps/desktop/src/renderer/routes/campaign.$campaignId.tsx` | Remplacer `setExecutingTestId` + `<ExecuteModal>` par navigation vers la nouvelle route ; supprimer le composant `ExecuteModal` |

Search params passés à la nouvelle route : `repoPath`, `projectId`, `component`, `level` (identiques à la route parente).

**Scénarios de test**

- [ ] Cliquer "Exécuter" sur un test → navigue vers la page d'exécution (plus de modal)
- [ ] Page d'exécution : ID et titre du test visibles en en-tête
- [ ] Page d'exécution : tableau des étapes avec status et commentaire par étape
- [ ] Cliquer dans un commentaire d'étape → toolbar richtext apparaît dans le header
- [ ] Commentaire global disponible avec espace suffisant
- [ ] Résultat global auto-calculé depuis les étapes, avec option de surcharge manuelle
- [ ] Bouton Annuler → retour à la page campagne
- [ ] Soumettre → run créé, retour à la page campagne

**Implémenté** — branch T40

**Fichiers modifiés :**
- `apps/desktop/src/renderer/routes/campaign.$campaignId.execute.$testId.tsx` — **nouveau** : page pleine largeur d'exécution de test (extraction de `ExecuteModal`)
- `apps/desktop/src/renderer/routes/campaign.$campaignId.tsx` — bouton "Exécuter" navigue vers la page dédiée ; `ExecuteModal` supprimé
- `apps/desktop/src/renderer/routeTree.gen.ts` — enregistrement de la nouvelle route + correction de la route T41 (`run/$testId`) absente de `rootRouteChildren`

---

### T41 — Consultation en lecture seule des tests d'une campagne

**Description fonctionnelle**

Dans la vue détail d'une campagne, les tests doivent être consultables en lecture seule :
- **Campagne close** (`completed` / `abandoned`) : chaque ligne de test est cliquable → navigue vers une page de consultation dédiée
- **Campagne active** (`planned` / `in-progress`) : si le test a déjà été exécuté (`runId` présent dans `CampaignTestRun`), un bouton **Voir** apparaît à côté du bouton **Exécuter**

**Comportement attendu — page de consultation** (`/campaign/$campaignId/run/$testId`)

La page affiche deux sections :

1. **Définition du test** (lecture seule)
   - ID, titre, statut
   - Préconditions (si présentes)
   - Tableau des étapes : colonnes # / Action / Résultat attendu (contenu richtext rendu en HTML)
   - Postconditions (si présentes)

2. **Résultats du run** (si le test a été exécuté dans cette campagne)
   - Pour chaque étape : résultat (Pass / Fail / Blocked / Skip / Non exécuté) + commentaire
   - Résultat global + notes générales
   - Date d'exécution + auteur
   - Si le test n'a pas été exécuté : bandeau "Non exécuté" à la place des résultats

**Navigation**
- Bouton **Retour** → revient à la page campagne (`/campaign/$campaignId`)
- URL paramétrique avec les mêmes search params que les autres routes (`repoPath`, `projectId`, etc.)

**Hors scope**
- Historique de tous les runs (on affiche uniquement le run lié à cette campagne)
- Ré-exécution depuis cette vue
- Export du rapport de test (ticket T43)

**Design technique**

Sprint unique — 1 nouveau fichier, 1 fichier modifié :

| Fichier | Changement |
|---------|------------|
| `apps/desktop/src/renderer/routes/campaign.$campaignId.run.$testId.tsx` | **Nouveau** — page de consultation lecture seule |
| `apps/desktop/src/renderer/routes/campaign.$campaignId.tsx` | Rendre les lignes de tests cliquables (campagne close) + bouton **Voir** (campagne active avec run existant) |

Chargement des données dans la page de consultation :
1. `api.campaigns.get(repoPath, campaignId)` → trouver `CampaignTestRun` pour `testId` → obtenir `runId`
2. `api.tests.get(repoPath, testId)` → définition du test
3. Si `runId` : `api.tests.runs(repoPath, testId)` → filtrer le bon run par `runId`

**Scénarios de test**

- [ ] Campagne close : les lignes de test ont un style cliquable (curseur pointer, hover visible)
- [ ] Campagne close : cliquer sur un test → navigue vers `/campaign/$campaignId/run/$testId`
- [ ] Page consultation : titre et ID visibles en en-tête
- [ ] Page consultation : définition du test en lecture seule (aucun champ éditable)
- [ ] Page consultation : étapes affichées dans un tableau (colonnes # / Action / Résultat attendu)
- [ ] Page consultation : contenu richtext des étapes rendu en HTML (gras, listes, etc.)
- [ ] Page consultation : résultats du run affichés par étape (badge résultat + commentaire)
- [ ] Page consultation : résultat global visible avec date et auteur d'exécution
- [ ] Page consultation : test non exécuté → bandeau "Non exécuté", définition visible
- [ ] Page consultation : bouton Retour → revient à la page campagne
- [ ] Campagne active : test avec run existant → bouton **Voir** visible à côté de **Exécuter**
- [ ] Campagne active : test sans run → bouton **Voir** absent
- [ ] Campagne active : clic sur **Voir** → même page de consultation

**Implémenté** — branch T41

**Fichiers modifiés :**
- `apps/desktop/src/renderer/routes/campaign.$campaignId.run.$testId.tsx` — **nouveau** — page de consultation lecture seule (définition + résultats du run)
- `apps/desktop/src/renderer/routes/campaign.$campaignId.tsx` — lignes de tests cliquables pour campagnes closes + bouton **Voir** pour campagnes actives avec run existant
- `apps/desktop/src/renderer/routeTree.gen.ts` — enregistrement de la nouvelle route

---

### T36 — Ajout de tests à une campagne existante

**Description fonctionnelle**

La vue de création de campagne (`/campaign/new`) permet de sélectionner des tests. Mais une fois la campagne créée, la vue détail (`/campaign/$campaignId`) n'offre aucun moyen d'ajouter de nouveaux tests. T36 ajoute :
1. Un bouton "Ajouter des tests" dans la vue détail campagne (visible uniquement si la campagne est active `planned` ou `in-progress`)
2. Une liste des tests disponibles non encore dans la campagne, avec sélection par cases à cocher
3. Les tests existants dans la campagne deviennent des liens cliquables qui naviguent vers `/test/$testId`

**Comportement attendu**

- Bouton "+ Ajouter des tests" visible en bas de la liste des tests (campagne active uniquement)
- Clic → affiche une section de sélection avec les tests disponibles (non déjà inclus), filtrables
- Cases à cocher + bouton "Ajouter (N)" pour confirmer
- Les tests ajoutés apparaissent immédiatement dans la liste avec status `pending`
- Chaque test dans la liste est un lien cliquable → navigue vers `/test/$testId`
- Campagne close/abandonnée : bouton masqué, tests non cliquables (mode lecture seule)

**Hors scope**
- Retrait de tests d'une campagne (fonctionnalité future)
- Ajout depuis la vue SystemView / ExcelView

**Design technique**

| Fichier | Changement |
|---------|------------|
| `apps/desktop/src/main/services/campaigns.service.ts` | Nouvelle méthode `addTests(repoPath, campaignId, testCaseIds)` |
| `apps/desktop/src/main/ipc/index.ts` | Handler `campaigns:add-tests` |
| `packages/api-client/src/types.ts` + `ipc-client.ts` | Exposer la nouvelle méthode |
| `apps/desktop/src/renderer/routes/campaign.$campaignId.tsx` | Bouton "Ajouter des tests" + section de sélection + liens cliquables |

**Scénarios de test**

- [ ] Vue campagne active → bouton "+ Ajouter des tests" visible
- [ ] Clic bouton → affiche les tests non inclus avec cases à cocher
- [ ] Sélectionner des tests + "Ajouter" → tests apparaissent dans la liste avec status `pending`
- [ ] Tests déjà inclus dans la campagne n'apparaissent pas dans la sélection
- [ ] Cliquer sur un test dans la liste → navigue vers `/test/$testId`
- [ ] Campagne complétée/abandonnée → bouton masqué, tests affichés sans lien (lecture seule)
- [ ] Campagne vide → bouton visible, peut ajouter des tests

**Implémenté** — branch T36

**Fichiers modifiés :**
- `apps/desktop/src/main/services/campaigns.service.ts` — méthode `addTests` (garde statut + dédup contre `testCaseIds` ET `runs`)
- `apps/desktop/src/main/ipc/index.ts` — handler `campaigns:add-tests`
- `packages/api-client/src/types.ts` + `ipc-client.ts` — exposition `addTests`
- `apps/desktop/src/renderer/routes/campaign.$campaignId.tsx` — liens cliquables + section "Ajouter des tests"
- `apps/desktop/src/renderer/components/system/CampaignListView.tsx` — nouveau composant liste de campagnes
- `apps/desktop/src/renderer/components/system/SystemView.tsx` — intégration `CampaignListView` quand `category === 'campaign'`

---

### T33 — Détail commit dans l'arbre de versions

**Description fonctionnelle**

Dans la vue `/graph` (arbre de versions), cliquer sur une ligne de commit ouvre un panneau inline sous cette ligne affichant la liste des fichiers modifiés dans ce commit. Chaque fichier est un lien qui navigue vers la vue diff pour ce fichier à ce commit précis. La vue diff dispose d'un bouton "← Retour" qui revient au graph avec le commit toujours sélectionné (panneau rouvert).

**Comportement attendu — vue graph**

- Clic sur une ligne commit → expand d'une sous-ligne avec la liste des fichiers (marker A/M/D + chemin)
- Second clic sur le même commit → collapse
- Clic sur un autre commit → ferme le précédent, ouvre le nouveau
- La liste des fichiers est chargée à la demande (lazy, avec état "Chargement…")
- Chaque fichier est cliquable → navigue vers `/diff?projectId=...&filepath=...&commitSha=...`
- Le SHA sélectionné est persisté dans l'URL de `/graph` (`?sha=...`) pour permettre le retour depuis diff

**Comportement attendu — vue diff**

- Accepte un param `commitSha` (optionnel) en plus de `filepath` et `projectId`
- Si `commitSha` présent : affiche le diff du fichier entre le parent du commit et le commit (contenu historique — pas le workdir)
- Si `commitSha` absent : comportement actuel inchangé (diff HEAD vs workdir)
- Bouton "← Retour" : si `commitSha` présent, navigue vers `/graph?projectId=...&sha=...` (pas `history.back`)
- Le header indique le SHA court + le fichier pour contextualiser

**Hors scope**

- Navigation multi-parents (commits de merge) — on compare toujours au premier parent
- Diff en side-by-side (reste unified)
- Recherche dans le diff

**Design technique**

Sprint unique — 4 fichiers modifiés, 0 nouveau fichier :

| Fichier | Changement |
|---------|------------|
| `sync.service.ts` | Ajouter `commitFiles(repoPath, sha)` et `commitDiff(repoPath, sha, filepath)` |
| `ipc/index.ts` | Handlers `sync:commit-files` et `sync:commit-diff` |
| `packages/api-client/src/types.ts` + `ipc-client.ts` | Exposer les deux nouvelles méthodes côté renderer |
| `routes/graph.tsx` | État `selectedSha` + expand row + chargement fichiers + navigation vers diff |
| `routes/diff.tsx` | Param `commitSha` + appel `commitDiff` + bouton retour graph |

**Scénarios de test**

- [ ] Cliquer sur un commit → sous-ligne s'ouvre, liste de fichiers avec marqueurs A/M/D
- [ ] Second clic → sous-ligne se ferme (toggle)
- [ ] Clic sur un autre commit → le précédent se ferme, le nouveau s'ouvre
- [ ] Commit initial (pas de parent) → les fichiers sont listés en "A"
- [ ] Cliquer sur un fichier dans la liste → navigue vers `/diff` avec le commit
- [ ] Vue diff avec commitSha → affiche le diff historique (pas workdir)
- [ ] Vue diff avec commitSha → bouton Retour revient à `/graph` avec le commit toujours sélectionné
- [ ] Vue diff sans commitSha → comportement actuel inchangé (diff HEAD vs workdir)
- [ ] Rechargement de la page graph avec `?sha=` → le commit est sélectionné automatiquement

**Implémenté** — branch T33

**Fichiers modifiés :**
- `apps/desktop/src/main/services/sync.service.ts` — `commitFiles` + `commitDiff`
- `apps/desktop/src/main/ipc/index.ts` — handlers `sync:commit-files` + `sync:commit-diff`
- `packages/api-client/src/types.ts` + `index.ts` + `ipc-client.ts` — exposition des nouvelles méthodes
- `apps/desktop/src/renderer/routes/graph.tsx` — expand inline commit + liste fichiers + navigation
- `apps/desktop/src/renderer/routes/diff.tsx` — param `commitSha` + commit diff historique + retour graph
- `apps/desktop/src/renderer/components/layout/AppLayout.tsx` + `sidebar/VersionPanel.tsx` — `sha: undefined` / `commitSha: undefined` pour compatibilité TypeScript router

---

### T33-C — Éditeur de schéma avec gestion des composants

**Implémenté** — branch T33

**Fichiers modifiés :**
- `apps/desktop/src/main/services/schema.service.ts` — sync submodules (clone/remove/gitmodules) + cache invalidation
- `apps/desktop/src/renderer/routes/schema.tsx` — onglets Composants / Éléments / Liens, BranchInput avec autocomplétion GitHub API
- `apps/desktop/src/main/container.ts` — injection AuthService dans SchemaService

---

### T33-D — Corrections TypeScript renderer + types Campaign

**Root causes**

1. **`SystemViewContext.tsx`** — `navigateWith` utilisait `(prev) => ({ ...prev, ... })` pour construire les params URL, ce qui retournait un type trop large (propriétés optionnelles au lieu de requises). TanStack Router rejette ce pattern avec ses types stricts.

2. **`campaign.$campaignId.tsx`** — bouton Retour naviguait vers `/components` et `/product` sans passer tous les champs requis (`type`, `node`).

3. **`packages/types/src/campaign.ts`** — `TestCampaign` et `CreateCampaignDto` ne déclaraient pas `component` et `level`, que `CampaignsService` utilisait déjà depuis le début (filtrage + création).

**Correctifs appliqués**

- `SystemViewContext.tsx` : remplacer le spread `(prev) => ({ ...prev, ... })` par des objets littéraux complets avec tous les champs requis par la route cible
- `campaign.$campaignId.tsx` : ajouter `type: undefined` pour `/components` et `node: undefined, type: undefined` pour `/product`
- `packages/types/src/campaign.ts` : ajouter `component?: string` et `level?: string` dans `TestCampaign` et `CreateCampaignDto`

**Résultat** : zéro erreur TypeScript dans `src/renderer/` — les erreurs restantes sont pré-existantes (services legacy + absence de types Electron dans le contexte typecheck)

**Fichiers modifiés :**
- `apps/desktop/src/renderer/contexts/SystemViewContext.tsx` — navigate params explicites
- `apps/desktop/src/renderer/routes/campaign.$campaignId.tsx` — navigate params complets
- `packages/types/src/campaign.ts` — `component` + `level` dans TestCampaign + CreateCampaignDto

---

### T21 — Persistance de la dernière vue affichée par projet

**Description fonctionnelle**

Quand l'utilisateur bascule entre la vue Tableau (excel) et la vue Document (word), cette préférence doit être mémorisée par projet et restaurée au prochain retour dans la vue système. Actuellement, `viewMode` est un `useState('excel')` local qui réinitialise toujours en vue Tableau.

**Comportement attendu**

- Passage en vue Document → mémorisé pour ce projet
- Retour dans la vue système (re-navigation, rechargement) → vue Document s'affiche directement
- La préférence est par projet (clé `polenta:viewMode:{repoPath}` en localStorage)
- Le mode `edit` n'est jamais persisté (retour en excel ou word selon la dernière valeur mémorisée)

**Hors scope**

- Persistance du nœud en cours d'édition (edit mode)
- Persistance de la position de scroll

**Design technique**

Sprint unique — 1 fichier modifié : `apps/desktop/src/renderer/components/system/SystemView.tsx`

Deux `useEffect` dans `SystemView` :
1. **Lecture** — quand `repoPath` devient disponible (async), lit `localStorage.getItem('polenta:viewMode:{repoPath}')` et initialise `viewMode` si valeur valide (`excel` | `word`). Protégé par un `useRef` pour n'exécuter qu'une fois par projet.
2. **Écriture** — quand `viewMode` change et vaut `excel` ou `word`, écrit en localStorage.

Pattern identique à `ThemeContext.tsx` (clé `polenta:theme`) et `AppLayout.tsx` (sidebar width).

**Scénarios de test**

- [ ] Basculer en vue Document → fermer/rouvrir l'app → vue Document s'affiche
- [ ] Basculer en vue Tableau → fermer/rouvrir → vue Tableau s'affiche
- [ ] Ouvrir l'éditeur (edit mode) → fermer/rouvrir → retour en dernière vue tableau/document (pas edit)
- [ ] Deux projets différents → chacun retient sa propre préférence

**Implémenté**

---

### T23 — WYSIWYG pour les champs richtext (toutes les vues)

**Description fonctionnelle**

Tous les champs de type `richtext` doivent s'afficher en mode WYSIWYG (rendu TipTap formaté) dans toutes les vues (EditView, WordView, ExcelView), avec possibilité de basculer vers le texte brut markdown. La barre d'outils de formatage apparaît **dans le header de la vue active** uniquement lorsqu'un champ richtext est en focus — elle disparaît quand le focus quitte le champ.

TipTap est déjà installé (`@tiptap/react`, `@tiptap/starter-kit`, `tiptap-markdown`, extensions image/link). `RichTextField.tsx` est déjà fonctionnel mais n'est pas encore utilisé dans EditView (qui utilise un `<textarea>` brut) et absent de Word/Excel.

**Comportement attendu — EditView**

- Le cas `richtext` dans `FieldControl` remplace le `<textarea>` actuel par `<RichTextField>`
- Quand un champ richtext est focusé : la toolbar TipTap apparaît dans le header d'EditView (à gauche du bouton ⚙), avec les boutons B / I / S / code / H2 / H3 / listes / blockquote / codeblock / image / Raw
- Quand le champ perd le focus : le header retrouve son état normal (toolbar masquée)
- Le bouton **Raw** dans la toolbar bascule en `<textarea>` markdown brut ; re-toggler repasse en WYSIWYG en re-parsant le markdown

**Comportement attendu — WordView**

- Un champ `richtext` affiche son contenu rendu en HTML (via TipTap `EditorContent` en mode `editable: false`) quand l'objet n'est pas en édition
- Un clic sur la zone richtext active l'édition WYSIWYG inline (même pattern que les autres champs de WordView)
- La toolbar apparaît dans le header de WordView lors de l'édition
- Sauvegarde sur blur (comportement identique aux autres champs inline)

**Comportement attendu — ExcelView**

- La cellule `richtext` affiche la première ligne du contenu en texte brut, tronquée, + une icône ¶ indiquant du contenu formaté
- Cliquer sur la cellule ouvre un popover (style popover link existant) avec l'éditeur WYSIWYG complet
- La toolbar apparaît dans le header d'ExcelView quand le popover richtext est ouvert
- Sauvegarde sur fermeture du popover

**Images**

- Base64 inline (déjà implémenté dans `RichTextField`) — pas de changement
- Insertion via bouton image dans la toolbar ou coller depuis le presse-papiers

**Hors scope**

- DrawIO (ticket séparé)
- Stockage des images en fichiers sur disque
- Éditeur de schema (DynamicField reste inchangé — il utilise déjà RichTextField correctement)

**Critères d'acceptance**

- [ ] EditView : un champ `statement` (richtext) affiche TipTap, pas un textarea brut
- [ ] La toolbar apparaît dans le header d'EditView quand le champ richtext est focusé
- [ ] La toolbar disparaît quand le focus quitte le champ richtext
- [ ] Bouton Raw : bascule en textarea markdown ; retour WYSIWYG re-parse le markdown
- [ ] Images : coller une image depuis le presse-papiers l'insère dans l'éditeur
- [ ] WordView : contenu richtext rendu en HTML inline (read-only)
- [ ] WordView : clic sur la zone richtext → édition WYSIWYG + toolbar dans header
- [ ] ExcelView : cellule richtext → première ligne tronquée + icône ¶
- [ ] ExcelView : clic cellule → popover avec éditeur WYSIWYG complet

**Implémenté** — branch T23, 6 commits

**Design technique**

*Architecture générale — RichTextContext*

Un contexte React `RichTextContext` (fichier `contexts/RichTextContext.tsx`) est placé au niveau de `SystemView`. Il expose :

```typescript
interface RichTextContextValue {
  activeEditor: Editor | null   // instance TipTap active (null si raw ou hors focus)
  isRaw: boolean                // mode texte brut actif
  isActive: boolean             // un champ richtext est focusé (true même en raw)
  toggleRaw: () => void
  activate: (editor: Editor) => void
  deactivate: () => void
}
```

Comportement du contexte :
- `activate(editor)` : déclenché quand le conteneur div d'un `RichTextField` reçoit le focus → stocke l'éditeur, `isActive = true`
- `deactivate()` : déclenché quand le focus quitte le conteneur div → `isActive = false`, `isRaw = false` (reset)
- `toggleRaw()` : bascule `isRaw` ; en raw mode, `activeEditor` reste référencé pour le resync au retour WYSIWYG

*`RichTextField.tsx` (modifié)*

- Détecte la présence du contexte via `useRichText()` (retourne `null` si pas de provider)
- **Avec contexte** : supprime la toolbar inline ; utilise `onFocus` / `onBlur` du conteneur `<div>` pour appeler `activate` / `deactivate`
- **Sans contexte** (DynamicField dans schema editor) : conserve la toolbar inline (comportement actuel)
- En raw mode (`context.isRaw === true`) : rend un `<textarea autoFocus>` à la place de `<EditorContent>` ; à la resync WYSIWYG, appelle `editor.commands.setContent(rawValue)`
- Focus/blur sur le conteneur div (pas sur TipTap directement) pour éviter le déclenchement intempestif lors du switch raw/WYSIWYG

*`RichTextToolbar.tsx` (nouveau)*

Composant stateless qui reçoit `{ editor, isRaw, isActive, toggleRaw, onInsertImage }` en props.
Rendu conditionnel : `if (!isActive) return null`
Buttons : B / I / S / code inline | H2 / H3 | • / 1. / « / ``` | 🖼 | Raw
En mode raw : tous les boutons de formatage sont `disabled`, seul Raw est actif (highlighted).

*`SystemView.tsx` (modifié)*

- Enveloppe le rendu dans `<RichTextProvider>`
- Insère `<RichTextToolbar />` dans le header compact (entre le `<span flex-1>` du titre et les boutons ↩ ↪) — rendu conditionnel via `isActive`

*`EditView.tsx` (modifié)*

- Cas `richtext` dans `FieldControl` : remplace le `<textarea>` par `<RichTextField value={...} onChange={...} />`
- `RichTextField` utilise le contexte fourni par `SystemView` (il est rendu dans le content area de SystemView)

*`WordView.tsx` (modifié)*

- Nouveau composant `RichTextInlineField` (variante d'`InlineField` pour richtext) :
  - Mode lecture : `<RichTextViewer value={...} />` — TipTap read-only (`editable: false`)
  - Mode édition (après clic) : `<RichTextField value={...} onChange={...} />` ; save on blur
- `RichTextViewer` = `useEditor({ editable: false, content: value, extensions: [StarterKit, Markdown, Image] })` + `<EditorContent>` avec mêmes classes CSS que `RichTextField`

*`ExcelView.tsx` (modifié)*

- Cellule richtext (dans `InlineCell`) : affiche la première ligne en texte brut + `¶` si contenu multi-lignes
- Clic → ouvre `activeRichtextPopover` (même mécanisme que `activeLinkPopover`)
- Popover contient `<RichTextField>` plein format ; sauvegarde sur fermeture (onBlur ou bouton ✕)

*Nouveaux fichiers*

| Fichier | Rôle |
|---|---|
| `contexts/RichTextContext.tsx` | Provider + hook `useRichText` |
| `components/system/RichTextToolbar.tsx` | Toolbar de formatage (stateless) |

*Fichiers modifiés*

| Fichier | Changement |
|---|---|
| `components/RichTextField.tsx` | Context-aware, raw mode, pas de toolbar inline si provider présent |
| `components/system/SystemView.tsx` | Wrap dans provider, `<RichTextToolbar>` dans header |
| `components/system/EditView.tsx` | `richtext` case → `<RichTextField>` |
| `components/system/WordView.tsx` | `RichTextInlineField` + `RichTextViewer` |
| `components/system/ExcelView.tsx` | Cellule richtext preview + popover éditeur |

**Découpage en sprints**

- **Sprint 1** — Infrastructure : `RichTextContext.tsx`, `RichTextToolbar.tsx`, `RichTextField.tsx` refactoré
- **Sprint 2** — EditView + SystemView : header toolbar, `richtext` case corrigé
- **Sprint 3** — WordView + ExcelView : viewer read-only, inline edit, cellule preview + popover

---

### T29 — Refactoring générique de la gestion des liens

**Description fonctionnelle**

La gestion des liens (`ObjectLink`) est dupliquée dans quatre vues (ExcelView, WordView, EditView, SystemView). Chaque correctif de lien (T26, T27, T28) a dû être appliqué dans plusieurs fichiers séparément, sans garantie de cohérence. En particulier, `SystemView.tsx` a une variante de la logique de filtrage qui ne gère pas le format `::` des références qualifiées — une incohérence silencieuse.

**Duplications identifiées**

| Logique | Où | Copies |
|---|---|---|
| `matchesRefs(objectTypeRef, refs, category)` | ExcelView:58, WordView:54, EditView:246 | 3 copies identiques |
| `filterCandidatesByRefs(candidates, refs)` | ExcelView:63, WordView:59, EditView:251 | 3 copies identiques |
| Extraction `peerId` depuis un lien | ExcelView:1123+1140, WordView:565+581, EditView:314+323 | 6 occurrences |
| Calcul du label directionnel du type de lien | ExcelView:`getColumnLabel`:553, SystemView:98 | 2 variantes **incohérentes** |
| `relevantLinkTypes` (filter + direction) | WordView:277, SystemView:101 | 2 copies |

**Bug silencieux dans SystemView.tsx:98-100**

```typescript
// ACTUEL — ne gère pas le format "node::typeId"
const matchesRef = (refs: string[]) =>
  (category != null && refs.includes(category)) ||
  (objectTypeRef != null && refs.includes(objectTypeRef))

// CORRECT (ExcelView/WordView/EditView)
function matchesRefs(objectTypeRef, refs, category) {
  if (!refs || refs.length === 0) return true
  return refs.some(r => r.includes('::') ? r === objectTypeRef : r === category)
}
```

Dans un projet avec des références qualifiées (`motor-control::requirement`), la modal "Champs visibles" de SystemView peut afficher ou masquer des types de liens incorrectement.

**Solution proposée — fichier `linkUtils.ts`**

Créer `apps/desktop/src/renderer/components/system/linkUtils.ts` avec les fonctions centralisées suivantes :

```typescript
// Teste si un type (objectTypeRef ou category) matche une liste de refs
export function matchesRefs(objectTypeRef: string, refs: string[] | undefined, category: string | undefined): boolean

// Filtre des candidats par compatibilité avec une liste de refs
export function filterCandidatesByRefs(candidates: Candidate[], refs: string[] | undefined): Candidate[]

// Retourne le label directionnel d'un type de lien vu depuis un objet
export function getLinkTypeLabel(lt: LinkTypeDefinition, objectTypeRef: string, category: string | undefined): string

// Retourne les types de lien pertinents pour un type d'objet donné
export function getRelevantLinkTypes(linkTypes: LinkTypeDefinition[], objectTypeRef: string, category: string | undefined): Array<{ lt: LinkTypeDefinition; canBeSource: boolean; canBeTarget: boolean }>

// Retourne le peerId d'un lien vu depuis un objectId (source ou cible)
export function getPeerId(link: ObjectLink, objectId: string): string
```

Et remplacer toutes les copies dans ExcelView, WordView, EditView, SystemView par des imports de ce fichier.

**Comportement attendu après refactoring**

- Aucun changement fonctionnel visible (refactoring pur)
- SystemView utilise la même logique que les autres vues (bug corrigé)
- Un seul endroit à modifier si la logique de filtrage évolue
- TypeScript compile sans erreur nouvelle

**Hors scope**
- Changement de comportement UI
- Refonte du format `::out` / `::in` de WordView (interne, bien contenu)
- Tests automatisés (le projet n'en dispose pas)

**Design technique**

Sprint unique — 1 nouveau fichier, 4 fichiers modifiés (ExcelView, WordView, EditView, SystemView).

**Scénarios de test**

- [ ] La modal "Champs visibles" affiche les mêmes types de liens qu'avant pour un schéma simple (`category` only)
- [ ] La modal affiche correctement les liens pour un schéma avec références qualifiées (`node::type`)
- [ ] ExcelView : les colonnes `link::` affichent les bons labels directionnels (inchangé)
- [ ] WordView : les popovers de liens fonctionnent (inchangé)
- [ ] EditView : la section Liens affiche les bons labels et comboboxes (inchangé)
- [ ] Ajout et suppression de liens dans les 3 vues : fonctionnel (inchangé)

**Implémenté**

**Fixes additionnels intégrés :**
- Bug ExcelView : `getLinkTypeLabel` utilisait `typeDef?.objectTypeRef` (inexistant sur `ObjectTypeDefinition`) → dérivation depuis `objects[0].objectTypeRef` à la place → label directionnel correct
- `isLinkTypeValid` ajoutée dans `linkUtils.ts` : un type de lien sans `sourceRefs` ET `targetRefs` est marqué invalide (⚠ dans FieldConfigModal, masqué dans Excel/Word/EditView)

---

### T28 — Label de direction manquant sur les liens dans EditView

**Root cause**

Dans `LinksSection` (`EditView.tsx`), les deux `<LinkCombobox>` (direction source→cible et cible→source) étaient rendus sans le prop `label`, alors que `LinkCombobox` supporte `label?: string` (affiché ligne 64 de `LinkCombobox.tsx`).

**Correctif**

Ajout des labels directionnels dans `EditView.tsx` :
```tsx
// direction source → cible
<LinkCombobox label={lt.labelSourceToTarget} ... />

// direction cible → source
<LinkCombobox label={lt.labelTargetToSource} ... />
```

**Fichier modifié**
- `apps/desktop/src/renderer/components/system/EditView.tsx` — props `label` ajoutés aux deux `LinkCombobox` de `LinksSection`

**Scénarios de test**
- [ ] EditView sur un requirement avec lien `implementation` (bidirectionnel) → affiche "est implémenté par" + combobox ET "implémente" + combobox
- [ ] EditView sur un requirement avec lien `verification` (req→test) → affiche "est vérifié par" + combobox uniquement
- [ ] EditView sur un test avec lien `verification` → affiche "vérifie" + combobox uniquement
- [ ] Ajout/suppression de liens : fonctionnalité inchangée

**Implémenté** — branch T29

---

### T27 — Interface d'édition des liens incohérente dans les vues Excel et Word

**Description fonctionnelle**

Dans la Vue Excel, cliquer sur une cellule `link::` ouvre un popover avec des `LinkCombobox`. Ces comboboxes n'ont pas de label — l'utilisateur ne sait pas quelle direction chaque combobox représente.

Concrètement (vue depuis un objet de type `requirement`) :
- `link::implementation` (req→req, bidirectionnel) → 2 comboboxes **sans label** → impossible de distinguer "est implémenté par" de "implémente"
- `link::verification` (req→test, unidirectionnel) → 1 combobox **sans label** → l'ambiguïté est moindre mais l'interface semble différente

Le résultat : deux types de liens semblent utiliser des interfaces d'édition différentes alors qu'ils devraient être identiques.

**Comportement attendu**

Chaque `LinkCombobox` doit être précédé de son label directionnel :
- Direction source → cible : `lt.labelSourceToTarget` (ex. "est implémenté par", "est vérifié par")
- Direction cible → source : `lt.labelTargetToSource` (ex. "implémente", "vérifie")

L'interface doit être identique pour tous les types de liens, quel que soit le nombre de directions disponibles.

**Root cause**

Le prop `label?: string` de `LinkCombobox` existe (rendu à la ligne 64 de LinkCombobox.tsx) mais n'est jamais passé dans les popovers des vues Excel et Word.

**Correctif**

Passer le label directionnel au `LinkCombobox` dans deux fichiers :

```tsx
// direction source → cible
<LinkCombobox label={lt.labelSourceToTarget} ... />

// direction cible → source
<LinkCombobox label={lt.labelTargetToSource} ... />
```

**Fichiers modifiés**
- `apps/desktop/src/renderer/components/system/ExcelView.tsx` — labels dans le popover link (canBeSource + canBeTarget)
- `apps/desktop/src/renderer/components/system/WordView.tsx` — labels dans le popover directionnel (::out / ::in)

*(T28 traite le même problème dans EditView)*

**Scénarios de test**
- [ ] Vue Excel, colonne `link::implementation` sur un requirement → popover affiche "est implémenté par" (combobox) + "implémente" (combobox)
- [ ] Vue Excel, colonne `link::verification` sur un requirement → popover affiche "est vérifié par" (combobox) uniquement
- [ ] Vue Excel, colonne `link::verification` sur un test → popover affiche "vérifie" (combobox) uniquement
- [ ] Vue Word, clic sur la ligne "est implémenté par" → popover affiche label "est implémenté par" + combobox
- [ ] Vue Word, clic sur la ligne "est vérifié par" → popover affiche label "est vérifié par" + combobox
- [ ] Aucune régression sur l'ajout/suppression de liens (fonctionnalité inchangée)

**Implémenté** — branch T29

---

### T25 — DevTools sur demande (F12)

**Description fonctionnelle**

En mode développement, les Chrome DevTools s'ouvrent automatiquement au démarrage de l'application. Il faut supprimer cette ouverture automatique et permettre à l'utilisateur de les ouvrir/fermer à la demande via la touche F12.

**Comportement attendu**
- Au démarrage de l'app (dev ou prod) : DevTools fermées par défaut
- Appui sur F12 → toggle DevTools (ouvre si fermées, ferme si ouvertes)
- Comportement identique en mode dev (`ELECTRON_RENDERER_URL` défini) et en mode prod

**Hors scope**
- Entrée de menu pour les DevTools
- Persistance de l'état DevTools entre sessions

**Design technique**

Fichier : `apps/desktop/src/main/index.ts`

1. Supprimer `win.webContents.openDevTools()` (ligne 21)
2. Ajouter handler `before-input-event` sur `win.webContents` pour capturer F12 et appeler `win.webContents.toggleDevTools()`

**Scénarios de test**
- [ ] Au lancement : aucune fenêtre DevTools visible
- [ ] Appui F12 → DevTools s'ouvrent
- [ ] Appui F12 à nouveau → DevTools se ferment
- [ ] Comportement identique en mode dev et prod

**Implémenté**

---

### T26 — Liens "est vérifié par" non proposés dans les champs visibles

**Description fonctionnelle**

Dans la modal "Champs visibles" (⚙), les types de liens définis dans le schéma ne sont pas toujours proposés. En particulier, le lien "est vérifié par" (vérification requirement → test) n'apparaît pas dans la liste des champs disponibles lorsque `sourceRefs` est vide (non contraint) et `targetRefs: [test]`. Le même bug masque également ce lien dans la vue Word pour les exigences.

**Comportement attendu**
- Tous les liens où le type courant peut être SOURCE ou CIBLE sont proposés dans la modal
- Si `sourceRefs` est vide → tout type peut être source → le lien est proposé pour tous
- Si `targetRefs` est vide → tout type peut être cible → le lien est proposé pour tous
- Le label affiché reflète la direction : `labelSourceToTarget` si le type est source, `labelTargetToSource` si le type est cible
- La colonne ExcelView affiche le bon label direction dans son en-tête

**Root causes (2 bugs identifiés)**

**Bug 1 — Filtre incorrect pour `sourceRefs` vide** (`SystemView.tsx` FieldConfigModal + `WordView.tsx`)

Quand `sourceRefs` est absent/vide (non contraint) et `targetRefs: ['test']`, un type `requirement` était exclu car :
- `hasSourceRefs = false`
- L'ancienne logique testait `if (!hasSourceRefs && !hasTargetRefs)` → n'early-returnait pas
- Puis `if (hasSourceRefs && matches(sourceRefs))` → false car hasSourceRefs=false
- Puis `if (hasTargetRefs && matches(['test']))` → false car 'requirement' ∉ ['test']
- → `return false` ← exclusion incorrecte

**Bug 2 — Section Liens du picker invisible pour les schémas avec beaucoup de champs** (`SystemView.tsx`)

La section "Liens" étant rendue après les champs sys+custom sans hauteur max sur le conteneur, elle pouvait tomber hors de la zone visible (pas de scroll). De plus, aucun séparateur visuel ne distinguait les liens des champs ordinaires.

**Bug 3 — Crash `schemaToEditable` pour les schémas sans `linkTypes`** (`schema.tsx`)

`schema.linkTypes.map(...)` crashait si `linkTypes` était absent du YAML (schéma créé avant T4), laissant l'éditeur de schéma en état "Chargement…" indéfini.

**Correctifs**

1. Filtre — remplacer la logique par :
```typescript
const matchesAsSource = !hasSourceRefs || matchesRef(lt.sourceRefs!)
const matchesAsTarget = !hasTargetRefs || matchesRef(lt.targetRefs!)
return matchesAsSource || matchesAsTarget
```

2. FieldConfigModal — conteneur `overflow-y-auto max-h-80` + séparateur "Liens" + état vide "Aucun type de lien pour ce type"

3. `schemaToEditable` — `(schema.linkTypes ?? []).map(...)`

**Fichiers modifiés**
- `apps/desktop/src/renderer/components/system/SystemView.tsx` — filtre + label directionnel + scroll + séparateur Liens
- `apps/desktop/src/renderer/components/system/WordView.tsx` — filtre relevantLinkTypes
- `apps/desktop/src/renderer/components/system/ExcelView.tsx` — label directionnel dans getColumnLabel
- `apps/desktop/src/renderer/routes/schema.tsx` — crash fix schemaToEditable

**Scénarios de test**
- [ ] Schéma avec lien `sourceRefs: [], targetRefs: [test]` → la modal champs visibles propose le lien pour un type requirement
- [ ] Schéma avec lien `sourceRefs: [requirement], targetRefs: [test]` → la modal propose le lien pour requirement ET pour test
- [ ] Depuis requirement : le lien apparaît avec le label `labelSourceToTarget` ("est vérifié par")
- [ ] Depuis test : le lien apparaît avec le label `labelTargetToSource` ("vérifie")
- [ ] En-tête de colonne ExcelView : même logique de label directionnel
- [ ] Vue Word : les liens pertinents s'affichent pour les exigences produits
- [ ] Si schéma sans types de liens → message "Aucun type de lien pour ce type" visible dans le picker
- [ ] Ouverture de l'éditeur de schéma sur un vieux schéma YAML sans `linkTypes` → pas de crash, affichage normal

**Implémenté** — branch T26

---

### T20 — Ouverture immédiate du dropdown enum dans la vue Word

**Description fonctionnelle**

Dans la vue Word (`InlineField`), cliquer sur un champ de type `enum` (ex. `status`) passe en mode édition mais n'ouvre pas le `<select>` automatiquement — l'utilisateur doit cliquer une seconde fois. Dans la vue Excel, le dropdown s'ouvre dès le premier clic grâce à `el.showPicker?.()`.

**Comportement attendu**
- Premier clic sur un champ enum → dropdown ouvert immédiatement
- Sélection d'une valeur → sauvegarde + fermeture (inchangé)
- Escape → annulation (inchangé)

**Root cause**

`InlineField` dans WordView ne passe pas de `ref` au `<select>` pour appeler `showPicker()` à l'initialisation.

**Correctif**

Fichier : `apps/desktop/src/renderer/components/system/WordView.tsx`

Ajouter `ref={el => { if (el) el.showPicker?.() }}` sur le `<select>` du `InlineField` (même pattern qu'ExcelView ligne ~159).

**Scénarios de test**
- [ ] Clic sur le champ `status` → dropdown s'ouvre immédiatement
- [ ] Sélectionner une valeur → valeur sauvegardée, retour à l'affichage
- [ ] Appuyer Escape → annulation, retour à la valeur précédente
- [ ] Champs texte non-enum → comportement inchangé

**Implémenté**

---

### T19 — Collapse/expand des dossiers dans la vue Word

**Description fonctionnelle**

Dans la vue Word, les dossiers sont rendus comme des titres (`h1`–`h6`). Il n'est pas possible de replier un dossier pour masquer son contenu. Il faut ajouter un bouton chevron cliquable sur chaque titre de dossier pour toggler l'affichage de ses enfants.

**Comportement attendu**
- Chaque titre de dossier affiche un chevron à gauche (▶ replié / ▼ déplié)
- Clic sur le chevron → bascule collapse/expand du dossier
- État initial : tous les dossiers dépliés
- Un dossier replié masque tous ses enfants (items et sous-dossiers)
- Clic sur le nom du dossier : ouvre l'édition inline (inchangé, ne trigger pas le collapse)

**Hors scope**
- Persistance de l'état collapse entre sessions

**Design technique**

Fichier modifié : `apps/desktop/src/renderer/components/system/WordView.tsx`

Changements :
1. Import `ChevronRight`, `ChevronDown` depuis `lucide-react`
2. Ajouter `useState<Set<string>>` pour `collapsedFolders` dans `WordView`
3. Ajouter `toggleFolder(id)` callback
4. Dans `renderNodes`, pour chaque nœud `folder` :
   - Ajouter un bouton chevron cliquable à gauche du titre
   - Si `collapsedFolders.has(node.id)` → ne pas rendre les enfants

**Scénarios de test (manuels)**
- [ ] Un dossier affiche un chevron ▼ par défaut
- [ ] Clic sur le chevron → les enfants disparaissent, le chevron devient ▶
- [ ] Re-clic → les enfants réapparaissent
- [ ] Un dossier imbriqué peut être replié indépendamment
- [ ] Clic sur le nom du dossier → édition inline (pas de toggle)

**Implémenté**

---

### T18 — Contour bleu au survol pour toutes les cellules éditables dans ExcelView

**Description fonctionnelle**

Dans la vue Excel, le survol d'une cellule lien éditable (`link::`) affiche déjà un contour bleu (`ring-1 ring-inset ring-blue-400`) sans modifier la couleur de fond — effet subtil et élégant. Il faut appliquer ce même comportement à toutes les cellules éditables :
- les cellules de valeur (`InlineCell` en mode non-système, quand `onEdit` est fourni)
- les cellules de nom de nœud (`NameCell` quand `onRename` est fourni)

**Comportement attendu**
- Survol d'une cellule éditable → contour bleu `ring-1 ring-inset ring-blue-400`, fond inchangé
- Survol d'une cellule non-éditable (système, lecture seule) → aucun effet (comportement actuel conservé)
- Cellule en cours d'édition (input actif) → comportement existant inchangé

**Hors scope**
- Cellules de dossier (GroupRow) — non éditables inline
- Cellule bouton "éditer" (icône crayon)

**Design technique**

Fichiers modifiés : `apps/desktop/src/renderer/components/system/ExcelView.tsx`

Changements :
1. `InlineCell` ligne ~192 : remplacer `hover:bg-edge` par `hover:ring-1 hover:ring-inset hover:ring-blue-400`
2. `NameCell` ligne ~115 : remplacer `hover:bg-edge` par `hover:ring-1 hover:ring-inset hover:ring-blue-400` (dans la branche `onRename ? ... : ''`)

**Scénarios de test (manuels)**
- [ ] Survoler une cellule champ éditable (`statement`, `priority`, etc.) → contour bleu visible, fond inchangé
- [ ] Survoler une cellule `name` de nœud éditable → contour bleu visible, fond inchangé
- [ ] Survoler une cellule lien `link::` → comportement identique (pas de régression)
- [ ] Survoler une cellule système (`id`, `section`, `createdAt`) → aucun effet de survol
- [ ] Cliquer sur une cellule éditable → entrée en mode édition (pas de régression)

**Implémenté**
- `NameCell` : `hover:bg-edge` → `hover:ring-1 hover:ring-inset hover:ring-blue-400`
- `InlineCell` (mode éditable) : `hover:bg-edge` → `hover:ring-1 hover:ring-inset hover:ring-blue-400`

---

## Done
T37 navigation vers les elements lies (clic simple + retour)
T29 refactoring générique de la gestion des liens (linkUtils.ts) + bug silencieux SystemView + label ExcelView + isLinkTypeValid
T27 bug labels directionnels manquants dans les popovers Excel et Word
T28 bug label de direction manquant sur les liens dans EditView
T25 evo developpeur tool est affiché par defaut, l'affiche sur demande (F12)
T26 bug liens "est vérifié par" non proposés dans champs visibles + crash schemaToEditable + overflow modal
T18 — Contour bleu au survol pour toutes les cellules éditables dans ExcelView
T17 — Hiérarchie des couleurs dans la vue Excel
T4  evo champs directionnels sur les liens (labelSourceToTarget / labelTargetToSource) + colonnes link:: dans ExcelView + section Liens dans EditView et WordView
T10 bug bouton "Enregistrer" supprimé de la toolbar (toutes les mutations auto-sauvegardent déjà ; Ctrl+S reste disponible après undo/redo)
T15 evo copie/coller/delete  dans la vue excel comme dans le tree du panel systeme
T14 evo selection dans la vue excel comme dans le tree du panel systeme
T13 bug dans la vue excel, le N° des dossiers n'est pas tronqué et déborde sur la colonne suivante
T9  Ajout fonction drag & drop de ligne et de colonne dans la vue excel.
T17 dans la vue excel deplace la fleche pour colapser un dossier dans la colonne du bouton edit
T17 evo dans l'excel colorer toute la ligne des dossiers comme le header
T11 vue excel si la largeur du tableau est inférieur a la fenete maximiser la largeur de la derniere colonne pour que le tableau fit sa zone d'affichage.
T12 dans la vue excel, ne pas indenté en fonction du niveau de profondeur dans l'arbe
T16 survol dans la vue excel higlith le ligne courant, si la cellule survolée est editable hightlight un niveau de plus.

### T32 — Bug : section "Stagés" affiche les mêmes fichiers que "Modifications"

**Description**

Dans le VersionPanel, la section "Stagés" affiche les mêmes fichiers que "Modifications", même quand aucun fichier n'est stagé. La section "Modifications" est correcte.

**Root cause**

Dans `sync.service.ts`, la fonction `status()` construit la liste `staged` avec la condition `if (stage !== 1)`. Cette condition capture incorrectement les fichiers non-trackés dont la valeur isomorphic-git est `[HEAD=0, WORKDIR=2, STAGE=0]` : `stage=0 !== 1` est vrai, et `head === 0` pousse le fichier dans `staged` avec marker 'A'. Or `STAGE=0` signifie que le fichier n'est PAS dans l'index git.

Ces mêmes fichiers non-trackés sont aussi correctement ajoutés à `unstaged` par la condition ligne 93 (`head === 0 && workdir === 2 && stage === 0`), d'où le double affichage.

**Correctif**

Ajouter `&& !(head === 0 && stage === 0)` à la condition staged pour exclure les fichiers non-trackés :

```typescript
// Staged: explicitly indexed (exclude untracked files where head=0 and stage=0)
if (stage !== 1 && !(head === 0 && stage === 0)) {
```

**Fichier modifié**
- `apps/desktop/src/main/services/sync.service.ts` — condition staged ligne ~86

**Scénarios de test**
- [ ] Fichier non-tracké (nouveau) → apparaît dans "Modifications" uniquement, pas dans "Stagés"
- [ ] `git add fichier` → le fichier passe de "Modifications" à "Stagés"
- [ ] Fichier modifié non stagé → "Modifications" uniquement
- [ ] Fichier modifié stagé → "Stagés" uniquement
- [ ] Fichier modifié stagé avec diff workdir supplémentaire → apparaît dans les deux (cas normal)

---

### T31 — Tableau d'étapes richtext dans la vue test + indication schéma

**Description fonctionnelle**

La vue d'édition d'un cas de test (`/test/new` et `/test/:testId`) affiche actuellement les étapes sous forme de cartes empilées avec de simples `<textarea>`. T31 remplace ce rendu par un **tableau structuré** où chaque ligne est une étape, et les champs Action et Résultat attendu utilisent l'éditeur riche TipTap (déjà en place pour les exigences). Le champ Notes (présent dans `TestStep` mais jamais affiché) devient disponible.

Par ailleurs, l'éditeur de schéma doit indiquer clairement qu'un type `category: test` active automatiquement l'UI étapes — l'utilisateur qui crée un type test dans le schéma comprend ce qu'il obtient.

**Hors scope**

- Vue d'exécution (TestRun / StepResult) — ticket futur
- Drag-drop pour réordonner les étapes (ticket futur)
- Persistance de l'état d'expansion Notes par étape

**Comportement attendu — vue étapes**

Le tableau d'étapes remplace les cartes dans `test.new.tsx` et `test.$testId.tsx` :

| Colonne | Contenu |
|---------|---------|
| # | Numéro auto (1, 2, 3…), lecture seule |
| Action | Éditeur TipTap (gras, italique, listes, images OneDrive) — obligatoire |
| Résultat attendu | Éditeur TipTap — obligatoire |
| Notes | Éditeur TipTap, accordéon ▶/▼ (masqué par défaut, développable par étape) — optionnel |
| ✕ | Bouton supprimer l'étape (désactivé si une seule étape) |

La toolbar TipTap apparaît dans le header de la page lorsqu'un champ richtext de l'étape est en focus — même pattern que T23 (exigences).

Bouton `+ Ajouter une étape` en bas du tableau.

Validation inchangée : action et résultat attendu non vides pour sauvegarder.

**Comportement attendu — éditeur de schéma**

Dans l'`ObjectTypeCard` du schéma (`schema.tsx`), pour les types `category: test`, afficher une note informative sous le nom du type :

> "Ce type utilise l'UI étapes (tableau Action / Résultat attendu). Les champs configurables ci-dessous s'ajoutent aux étapes."

Cette note est en lecture seule, non éditable.

**Design technique**

Sprint unique — 3 fichiers modifiés + 1 nouveau composant :

| Fichier | Rôle |
|---------|------|
| `apps/desktop/src/renderer/components/system/StepsTable.tsx` | **Nouveau** — composant tableau réutilisable, props : `steps`, `onChange`, `disabled` |
| `apps/desktop/src/renderer/routes/test.new.tsx` | Remplacer les cartes par `<StepsTable>` |
| `apps/desktop/src/renderer/routes/test.$testId.tsx` | Remplacer les cartes par `<StepsTable>` |
| `apps/desktop/src/renderer/routes/schema.tsx` | Ajouter la note dans `ObjectTypeCard` pour `category: test` |

`StepsTable` réutilise `RichTextField` (déjà installé, `@tiptap/react` + `tiptap-markdown`) pour chaque cellule richtext.

**Interface du composant StepsTable**

```typescript
interface StepDraft {
  action: string        // HTML
  expectedResult: string // HTML
  notes: string | null  // HTML
}

interface StepsTableProps {
  steps: StepDraft[]
  onChange: (steps: StepDraft[]) => void
  disabled?: boolean
}
```

**Scénarios de test**

- [ ] Vue `/test/new` : les étapes s'affichent en tableau (colonnes # / Action / Résultat attendu / ✕)
- [ ] Cliquer dans la cellule Action → toolbar TipTap apparaît dans le header, formatage fonctionne (gras, liste)
- [ ] Cliquer dans Résultat attendu → même toolbar TipTap
- [ ] Accordéon Notes : par défaut masqué (▶) ; clic → développé (▼) avec éditeur TipTap
- [ ] Sauvegarder une étape avec contenu richtext → le HTML est persisté et rechargé correctement
- [ ] Supprimer une étape → le tableau se met à jour, numéros recalculés
- [ ] Une seule étape → bouton ✕ désactivé
- [ ] `+ Ajouter une étape` → nouvelle ligne vide ajoutée en bas
- [ ] Validation : tentative de sauvegarde avec Action ou Résultat attendu vide → message d'erreur, pas de sauvegarde
- [ ] Vue `/test/:testId` : même comportement, données existantes rechargées en richtext
- [ ] Éditeur de schéma, type `category: test` → note "Ce type utilise l'UI étapes…" visible sous le nom
- [ ] Éditeur de schéma, type `category: requirement` → aucune note affichée

---

### T30 — Gestion de configuration : branches, submodules et vue versioning

**Description fonctionnelle**

Le projet s'appuie sur un repo git. Les sous-composants réutilisables entre produits sont des repos git indépendants montés en submodules. Un même repo composant peut être monté plusieurs fois à des versions différentes (ex : deux versions de pack batterie `VE10A` et `VE12A`).

**Modèle de branches**

Deux types de branches coexistent :
- `prj-*` — branches projet (intégration). Lecture seule : aucune modification directe permise, uniquement par merge depuis une branche ticket. Toute l'UI passe en mode readonly quand une branche `prj-*` est en checkout.
- `tck-*` — branches ticket (modification). Éditables. Créées au niveau du produit à l'ouverture d'un ticket.

**Modèle de branches sur les composants**

Chaque composant déclare ses propres branches d'intégration (ex : `VE10A`, `VE12A`). Ces branches sont déclarées dans le `schema.yaml` du produit (nœud composant). Quand un ticket modifie un composant, une branche `VE10A-tck-XXX` est créée **à la demande** (au premier commit dans ce composant), pas automatiquement.

Le repo produit déclare dans `schema.yaml` quelles branches d'intégration il utilise pour chaque composant :
```yaml
nodes:
  - name: battery-pack-ve10a
    url: git@github.com:org/battery-pack.git
    integrationBranch: VE10A
  - name: battery-pack-ve12a
    url: git@github.com:org/battery-pack.git
    integrationBranch: VE12A
```

**Règles de gestion**

- Chaque repo (produit + composants) a ses propres commits indépendants
- Quand un commit est effectué dans un composant, le pointeur submodule du parent est mis à jour automatiquement — mais le commit parent reste une action explicite de l'utilisateur
- Les merges (tck → prj, ou VE10A-tck-XXX → VE10A) sont des actions manuelles depuis la vue versioning
- En cas de conflit sur une branche d'intégration partagée entre plusieurs produits, c'est le dernier à merger qui arbitre depuis la vue versioning
- Auth via GitHub token (pas de SSH spécifique à gérer dans l'UI)

---

**T30-A — Branches produit : sélecteur projet + panel version** *(fondation)*

Deux points d'entrée distincts pour les deux types de branches. Le modèle `Action` disparaît — remplacé par la notion de branche git.

**Vue Projet (`/project/$id`) — sélecteur `prj-*`**

En haut du tableau de bord projet, un sélecteur de branche baseline :
- Affiche la branche `prj-*` active (ex. `prj-v1`)
- Dropdown : liste les branches `prj-*` existantes + "Créer une baseline…" inline
- Checkout → bascule sur la branche sélectionnée → déclenche le mode readonly global

**VersionPanel (sidebar) — sélecteur `tck-*` + workflow**

Remplace la section "Modification courante" par :
```
Modifier   [tck-045 ▾]          ← label + sélecteur branche dev
                                  dropdown : branches tck-* existantes
                                           + "Créer une branche…"

Stagés (3)            [Committer]  ← inchangé
• requirements/SW-001.yaml

Modifications (2)        [+] [↩]  ← inchangé
• requirements/SW-002.yaml

[Publier →]                        ← désactivé, placeholder T30-E
```

**Modèle `Action` supprimé :**
- Retirer de `VersionPanel` : `currentAction`, `review`, mutations submit/merge/abandon
- Les routes `/action/new` et `/action/$actionId` ne sont plus accessibles depuis la navigation (routes conservées mais non exposées)

**`/versioning` — placeholder vide pour T30-E**
- Page simple "Versioning — bientôt disponible" (futur : tags, diff, analyse d'impact)

**Readonly global :**
- `VersioningContext` (déjà créé) : `isReadonly = branch.startsWith('prj-')`
- `SystemViewContext` consomme `useVersioning().isReadonly` (déjà implémenté)

**Fichiers modifiés :**

| Fichier | Changement |
|---------|------------|
| `sidebar/VersionPanel.tsx` | Supprimer section Action, ajouter sélecteur tck-*, ajouter bouton Publier (disabled) |
| `routes/project.$id.tsx` | Ajouter sélecteur prj-* en haut du dashboard |
| `routes/versioning.tsx` | Remplacer par placeholder simple |

**Fichiers déjà implémentés (session précédente) :**
- `sync.service.ts` — `listBranches`, `createBranch`, `checkoutBranch`
- `ipc/index.ts` — handlers `sync:branches`, `sync:create-branch`, `sync:checkout-branch`
- `api-client` — `BranchInfo`, 3 méthodes dans `ApiClient.sync`
- `contexts/VersioningContext.tsx` — `VersioningProvider` + `useVersioning()`
- `AppLayout.tsx` — `VersioningProvider` monté globalement, `deducePanel` + navigation

**Scénarios de test :**
- [ ] Vue Projet : sélecteur baseline `prj-*` visible en haut du dashboard
- [ ] Créer une baseline `prj-v1` → checkout automatique, badge "Lecture seule" visible
- [ ] Sélectionner `prj-v1` → toute l'UI (ExcelView, WordView, EditView) passe en lecture seule
- [ ] VersionPanel : section "Modifier" affiche le sélecteur `tck-*`
- [ ] Sélectionner une branche `tck-045` existante → checkout, UI redevient éditable
- [ ] Créer `tck-001` via le sélecteur → checkout automatique, staged/unstaged disponibles
- [ ] Committer depuis VersionPanel sur branche `tck-*` → fonctionne (inchangé)
- [ ] Bouton "Publier" visible mais désactivé dans VersionPanel
- [ ] `/versioning` accessible, affiche un message placeholder

---

**T30-B — Commit UI (produit seul)**

Dans la vue Versioning, section de commit pour le repo produit.

Fonctionnalités :
- Liste des fichiers modifiés (`git status`) avec cases à cocher
- Champ message de commit
- Bouton commit (désactivé si branche `prj-*` active)
- Retour visuel après commit (liste vidée, confirmation)

Scénarios de test :
- [ ] Modifier une exigence → le fichier apparaît dans la liste des modifications
- [ ] Sélectionner le fichier, saisir un message, committer → commit créé sur la branche `tck-*` active
- [ ] Sur une branche `prj-*` → le bouton commit est désactivé
- [ ] Après commit → la liste des fichiers modifiés est vide

---

**T30-C — Data model : gestion des composants** *(indépendant de A/B)*

Tab "Composants" dans l'éditeur de schéma (`schema.yaml`). Permet de déclarer les nœuds composants avec leurs branches d'intégration.

Fonctionnalités :
- Liste des nœuds composants existants dans `schema.yaml`
- Modifier la branche d'integration du composant, l'utilisateur sasie la branche en text libre et proposer une lister par completetion ou match des branches disponibles
- Suppression d'un nœud composant
- Sauvegarde dans `schema.yaml` (déclenche la mise à jour des submodules git)

Scénarios de test :
- [ ] Le tab "Composants" est visible dans l'éditeur de schéma
- [ ] Saisir l'URL d'un repo GitHub → les branches sont chargées depuis l'API GitHub
- [ ] Sélectionner une branche d'intégration et sauvegarder → le nœud apparaît dans `schema.yaml`
- [ ] Le même repo peut être ajouté deux fois avec deux branches d'intégration différentes (ex : `VE10A` et `VE12A`)
- [ ] Supprimer un nœud composant → retiré de `schema.yaml`

---

**T30-D — Multi-repo : extension aux composants** *(dépend T30-A + T30-C)*

Extension du checkout et du commit UI aux repos composants.

Fonctionnalités :
- La vue Versioning affiche l'état de chaque composant (branche active, modifications en cours)
- Création de la branche `VE10A-tck-XXX` sur le composant à la demande (au premier commit dans ce composant depuis un ticket)
- Checkout multi-repo : switcher de branche ticket au niveau produit synchronise les composants sur leur branche ticket correspondante (si elle existe) ou sur leur branche d'intégration
- Commit dans un composant → le pointeur submodule dans le parent est mis à jour automatiquement ; un commit parent explicite reste nécessaire

Scénarios de test :
- [ ] La vue Versioning liste les composants avec leur branche active et leurs fichiers modifiés
- [ ] Premier commit dans `battery-pack-ve10a` depuis `tck-045` → la branche `VE10A-tck-045` est créée sur le repo composant
- [ ] Checkout `tck-045` au niveau produit → les composants basculent sur leurs branches ticket si elles existent
- [ ] Après commit dans le composant → le pointeur submodule dans le produit est mis à jour (visible dans git status produit)
- [ ] Committer le pointeur mis à jour depuis l'UI produit → commit produit créé

---

**T30-E — Merges et publication** *(dépend T30-D)*

Actions de merge depuis la vue Versioning pour publier les modifications vers les branches d'intégration.

Fonctionnalités :
- Merge `tck-XXX` → `prj-*` (repo produit)
- Merge `VE10A-tck-XXX` → `VE10A` (repo composant)
- Détection et signalement des conflits (pas de résolution automatique — l'utilisateur doit résoudre manuellement)
- Affichage du résultat de chaque merge (succès / conflit)

Scénarios de test :
- [ ] Merger `tck-045` → `prj-v1` depuis la vue Versioning → merge effectué, branche `prj-v1` à jour
- [ ] Merger `VE10A-tck-045` → `VE10A` sur le composant → merge effectué
- [ ] En cas de conflit → message d'erreur explicite, aucun merge partiel appliqué
- [ ] Après merge sur le composant → mettre à jour le pointeur submodule produit (T30-D) et committer

### T39 — Commentaires en rich text dans la vue d'exécution de test

**Description fonctionnelle**

Dans la vue d'exécution de test (`ExecuteModal` dans `/campaign/$campaignId`), les deux zones de commentaire sont actuellement de simples `<textarea>`. T39 les remplace par l'éditeur rich text TipTap déjà utilisé dans le reste de l'application.

**Zones concernées**

1. **Commentaire par étape** — champ `comment` de `StepExecState`, affiché sous chaque étape dans la modal d'exécution
2. **Commentaire global** — champ `notes` de `ExecuteTestCaseDto`, affiché en bas de la modal avant le résultat global

**Comportement attendu**

- Les deux zones de commentaire affichent un éditeur TipTap (gras, italique, listes, etc.)
- La toolbar de formatage apparaît dans le **header de la modal** lorsqu'un champ rich text est en focus — pattern identique à `test.$testId.tsx` et `SystemView`
- La toolbar disparaît quand aucun champ n'est focusé
- La valeur stockée reste du markdown (format inchangé côté service)
- Les commentaires vides restent optionnels (comportement inchangé)

**Hors scope**

- Commentaires en lecture seule sur les runs déjà soumis
- Modification du format de stockage (reste markdown string)

**Design technique**

| Fichier | Changement |
|---------|------------|
| `apps/desktop/src/renderer/routes/campaign.$campaignId.tsx` | Import `RichTextField`, `RichTextProvider`, `RichTextToolbar` ; envelopper `ExecuteModal` dans `<RichTextProvider>` ; ajouter `<RichTextToolbar />` dans le header modal ; remplacer les deux `<textarea>` par `<RichTextField>` |

**Scénarios de test**

- [ ] Ouvrir la modal d'exécution → commentaire par étape affiche un éditeur TipTap (pas un textarea)
- [ ] Cliquer dans le commentaire d'une étape → toolbar apparaît dans le header de la modal
- [ ] Utiliser gras/italique/liste dans le commentaire d'étape → formatage appliqué
- [ ] Cliquer dans le commentaire global → toolbar apparaît dans le header de la modal
- [ ] Soumettre l'exécution → `comment` et `notes` transmis en markdown (comportement inchangé)
- [ ] Commentaires laissés vides → soumission fonctionne (comportement inchangé)

---

### T34 — Type champ `tableau` dans le modèle de données (discard)

**Description fonctionnelle**

Ajouter un nouveau type de champ `tableau` dans l'éditeur de schéma. L'utilisateur définit les colonnes du tableau (nom + type), avec une colonne de numéro de ligne générée automatiquement. Le tableau est stocké comme valeur JSON dans les champs de l'objet et s'affiche comme une mini-grille éditable dans les vues EditView et WordView.

**Comportement attendu — éditeur de schéma**

- Dans la définition d'un type d'objet, le type `tableau` est disponible pour un champ
- Quand `type: tableau` est sélectionné, une section "Colonnes" apparaît sous la définition du champ
- L'utilisateur peut ajouter/supprimer/réordonner des colonnes
- Chaque colonne a : `name` (slug), `label` (affiché), `type` parmi text | richtext | enum | number | boolean | date
- Pour `enum` : liste de valeurs configurables (réutilise l'UI existante)
- La colonne `#` (numéro de ligne) est implicite — elle n'est pas dans la définition mais toujours affichée en première colonne

**Comportement attendu — vue édition (EditView / WordView)**

- Le champ `tableau` s'affiche comme une grille avec en-têtes de colonnes
- Chaque ligne est éditable inline (cellules cliquables, même pattern que ExcelView)
- Bouton `+ Ajouter une ligne` en bas du tableau
- Bouton `✕` par ligne pour supprimer
- La valeur est stockée en JSON : `[{"col1": "val1", "col2": "val2"}, ...]`
- Colonne `#` auto-incrémentée à l'affichage (non stockée)

**Hors scope**

- Colonnes de type `tableau` imbriquées (pas de tableaux dans des tableaux)
- Tri / filtrage des lignes dans l'édition
- Export CSV de la valeur
- Colonnes de type `richtext` dans un tableau (complexité TipTap multi-instances — à évaluer)

**Design technique**

| Fichier | Changement |
|---------|------------|
| `packages/types/src/schema.ts` | Ajouter `tableau` à `SchemaFieldType`, ajouter interface `TableColumn` et champ `columns?: TableColumn[]` dans `SchemaField` |
| `packages/zod-schemas/` | Valider la nouvelle structure |
| `renderer/components/system/EditView.tsx` | Nouveau case `tableau` dans `FieldControl` → composant `TableField` |
| `renderer/components/TableField.tsx` | Nouveau composant mini-grille éditable |
| `renderer/routes/schema.tsx` | Dans l'UI de définition d'un champ, afficher la section colonnes quand `type === 'tableau'` |

**Scénarios de test**

- [ ] Créer un type avec un champ `tableau` (2 colonnes text) — s'affiche dans le schéma
- [ ] Ouvrir l'EditView d'un objet avec ce type — tableau avec en-têtes visible
- [ ] Ajouter une ligne → valeur JSON mise à jour
- [ ] Supprimer une ligne → numérotation recalculée
- [ ] Sauvegarde → données persistées dans le YAML

---

### T35 — Vue exécution des étapes de test

**Description fonctionnelle**

Sur la table d'étapes existante (Action + Résultat attendu), ajouter les colonnes d'exécution Status et Notes dans la vue d'exécution d'un test. Les Notes servent à **justifier le résultat de chaque étape** (ex : "écran non affiché car batterie < 5%"). Ces colonnes sont absentes de la vue définition.

**Correction T31** : l'accordéon "Notes" actuellement dans la vue définition (`StepsTable`) doit être supprimé — les notes n'ont pas de sens à la définition. Le champ `TestStep.notes` est déprécié en conséquence ; les justifications vivent dans `TestRun.stepResults[].notes`.

**Comportement attendu — vue définition (corrigée)**

- Colonnes visibles : `#` | `Action` | `Résultat attendu`
- Pas d'accordéon Notes — supprimé de T31
- Status et Notes : masqués

**Comportement attendu — vue exécution (nouvelle)**

- La table affiche les mêmes lignes que la définition
- Colonnes supplémentaires : `Status` (enum : Pass / Fail / Blocked / N/A) + `Notes` (text libre, justification du résultat)
- Action et Résultat attendu en lecture seule (issus de la définition)
- L'utilisateur renseigne Status + Notes pour chaque étape
- La soumission crée un `TestRun` avec `stepResults[].result` et `stepResults[].notes` peuplés
- Résultat global automatique : Pass si tous Pass ; Fail si au moins 1 Fail ; Blocked sinon

**Hors scope**

- Réexécution partielle (reprendre à l'étape N)
- Pièces jointes par étape
- Historique des exécutions dans la même vue (déjà accessible via la liste des runs)

**Design technique**

| Fichier | Changement |
|---------|------------|
| `components/StepsTable.tsx` | Prop `mode: 'definition' | 'execution'` — en mode execution affiche colonnes Status + Commentaires, masque Notes |
| `routes/test.$testId.tsx` | Ajouter onglet / bouton "Exécuter" qui ouvre la vue exécution |
| `renderer/components/ExecuteTestView.tsx` | Nouveau composant — charge la définition, affiche StepsTable en mode execution, soumet `ExecuteTestCaseDto` |
| `main/services/tests.service.ts` | `execute()` existe déjà — vérifier DTO compatible |

**Scénarios de test**

- [ ] Ouvrir un test → cliquer "Exécuter" → vue exécution s'ouvre
- [ ] Remplir Status Pass sur toutes les étapes → résultat global = Pass
- [ ] Au moins 1 Fail → résultat global = Fail
- [ ] Soumettre → `TestRun` créé dans `test-runs/PRD_TST-XXXX/`
- [ ] Revenir à la liste → compteur d'exécutions mis à jour

---

### T44 — Spec stabilisée

**Objectif** : Permettre de créer des baselines (snapshots tagués) sur le repo principal + ses submodules, et les consulter depuis le panel latéral.

#### 1. Bouton "Baseline" dans VersionPanel

- Icône `Tag` dans le header du panel version, à côté du bouton History.
- Clic → navigation vers `/baseline?projectId=...`

#### 2. Tags dans le combobox Checkout

- Le `BranchCombobox` liste également les tags git (depuis `sync:tags`).
- Les tags sont visuellement distincts des branches (badge `tag` à droite).
- Checkout d'un tag → `git checkout <tag>` → detached HEAD.
- Désactivé si des fichiers sont stagés ou modifiés (même comportement que le checkout de branche).
- Détached HEAD → mode lecture seule dans l'UI (le `VersioningContext` retourne `isReadonly: true` quand `branch === ''` ou HEAD détaché).

#### 3. Page Baseline (`/baseline`)

**Mode création** (pas de param `name`) :

- Section **Repo principal** :
  - Champ texte "Tag à créer" pré-rempli avec l'auto-incrémentation du dernier tag (e.g. dernier `v1.2.0` → propose `v1.3.0`). Si aucun tag → propose `v1.0.0`.
  - Si le HEAD actuel porte déjà un tag : le montrer, permettre d'en créer un nouveau quand même.
- Section **Submodules** (lus depuis `schema.yaml`) :
  - Pour chaque submodule :
    - Nom du submodule
    - Combobox de ses tags existants (dernier sélectionné par défaut)
    - Si aucun tag → affichage d'un champ "Créer un tag" + message d'avertissement
  - Si au moins un submodule n'a pas de tag sélectionné (ni créé) → bouton "Créer la baseline" désactivé + banner d'erreur.
- Bouton **"Créer la baseline"** :
  1. Crée le tag git sur le HEAD du repo principal.
  2. Si un submodule n'avait pas de tag, crée le tag sur ce submodule.
  3. Écrit l'entrée dans `.polenta/baselines.yaml`.
  4. Affiche confirmation + propose de consulter la baseline créée.

**Mode consultation** (param `name=<tag>`) :

- Affiche le récapitulatif de la baseline : tag principal + tag de chaque composant.

#### 4. Combobox Baseline dans VersionPanel

- Nouvelle section "Baseline" sous la section "Checkout".
- `BaselineCombobox` : liste les baselines depuis `.polenta/baselines.yaml`.
- Sélectionner une baseline → navigation vers `/baseline?projectId=...&name=<tag>`.

#### Stockage `.polenta/baselines.yaml`

```yaml
baselines:
  - tag: v1.0.0
    createdAt: 2024-01-15T10:30:00Z
    components:
      - name: motor-control
        tag: v2.1.0
      - name: bms
        tag: v3.0.0
```

#### Backend — Nouveaux IPC

| Canal | Arguments | Retour |
|---|---|---|
| `sync:create-tag` | repoPath, tagName | void |
| `sync:submodule-tags` | repoPath | `{ name, tags: string[] }[]` |
| `baseline:create` | repoPath, dto | `BaselineRecord` |
| `baseline:list` | repoPath | `BaselineRecord[]` |

#### Critères d'acceptation

- [ ] Bouton baseline (icône Tag) visible dans le header du VersionPanel
- [ ] Les tags git apparaissent dans le combobox Checkout avec un badge "tag"
- [ ] Checkout d'un tag met le repo en detached HEAD + lecture seule
- [ ] Page baseline : affiche le repo principal + chaque submodule avec leurs tags
- [ ] Si un submodule n'a aucun tag → erreur bloquante dans l'UI
- [ ] Création de baseline : tag git créé + entrée dans `.polenta/baselines.yaml`
- [ ] Le combobox Baseline dans VersionPanel liste les baselines
- [ ] Cliquer sur une baseline navigue vers la page de consultation

#### Hors scope

- Checkout simultané de tous les repos d'une baseline
- Suppression de baseline
- Diff de baseline (T45)

---

### T85 — Réglage projet : propagation automatique ou manuelle du pin après "Publier"

**Description fonctionnelle**

T82 propage déjà systématiquement, en cascade, la mise à jour du `pin` d'un repo publié vers
ses parents dans l'arbre (toujours comme modification en attente, jamais un commit
automatique). T85 ajoute un réglage global au workspace, `pinPropagationMode: 'auto' |
'manual'`, stocké dans le `config/project.yaml` du repo **root** — granularité tranchée avec
l'utilisateur (globale, pas par lien de dépendance parent/enfant) avant rédaction de la spec.
Exposé via un nouveau contrôle dans l'onglet Structure du Modèle de données, sur la ligne
root, à côté du sélecteur de branche d'intégration (la "vue Projet" mentionnée dans le ticket
original a été retirée en T86 — le réglage suit la réalité actuelle du panneau Projet).

Le réglage gate strictement le point d'appel "Publier" (`ModificationControl.tsx`) — les
checkouts/commits manuels du panneau Version avancé (`VersionRepoFolder.tsx`,
`useBranchCheckout`) restent automatiques dans les deux modes, hors scope explicite du
ticket. En mode `manual`, aucune écriture n'a lieu automatiquement après "Publier" ; l'onglet
Structure affiche à la place un indicateur "Mise à jour disponible" pour toute dépendance
dont le `pin` déclaré diverge du tip actuel de la branche d'intégration de son repo
(comparaison en lecture seule, `usePinFreshness`), avec une action d'application explicite —
qui produit, comme en mode `auto`, une simple modification en attente, jamais un commit
silencieux.

**Bugs trouvés et corrigés en revue de code**

1. La détection de fraîcheur échouait silencieusement pour un composant cloné/checkouté sur
   son pin (SHA détaché, cas courant d'après `WorkspaceTreeService.buildWorkspaceTree`) — sans
   branche locale portant le nom de la branche d'intégration, seule la ref distante
   (`origin/<branche>`) existe. Sans repli sur cette ref, `isStale` restait toujours `false`
   pour le cas d'usage principal de la fonctionnalité. Corrigé par un repli explicite.
2. Race pendant le chargement initial du réglage : `pinPropagationMode` vaut `undefined` tant
   que la query n'a pas résolu, et la condition de gating traitait cet état comme `'auto'` — un
   clic rapide sur "Publier" pouvait déclencher une écriture réelle malgré un workspace
   configuré en `'manual'`. Corrigé en désactivant le bouton "Publier" tant que le réglage
   n'est pas chargé.
3. L'application manuelle d'une mise à jour ne traitait que le statut `'diamond-conflict'` de
   `WorkspaceOpenResult`, laissant `'parse-error'`/`'not-a-workspace'` retomber
   silencieusement dans l'état "Mise à jour disponible" par défaut sans indiquer l'échec réel.
   Corrigé en alignant le traitement sur celui de `propagatePinToDependents` (tout statut
   non-`'ok'` hors diamond-conflict est un échec affiché).

**Décisions techniques notables**

- Requête de fraîcheur keyée par `repoPath` seul (pas par `(repoPath, pin)`) : une dépendance
  en diamant (même repo, pins différents selon le parent) partage un seul fetch réseau au lieu
  d'un par parent ; la comparaison de fraîcheur elle-même est dérivée localement (`useMemo`).
- Regex de classification SHA dédiée (`FULL_SHA_RE`, 40 caractères exacts) plutôt que la
  réutilisation du motif tolérant les SHA abrégés de `BranchCombobox.tsx` (7-40 caractères) —
  ce dernier valide une saisie utilisateur libre, pas la classification d'un `pin` déjà
  résolu, qui d'après `T82.md` est toujours soit un nom de branche/tag, soit un SHA **complet**.
- Finding de revue explicitement rejeté : déplacer la garde à l'intérieur de
  `propagatePinToDependents` lui-même (au lieu du seul point d'appel "Publier") aurait aussi
  gaté les checkouts/commits manuels du panneau Version avancé — contraire au scope explicite
  du ticket. Le "point ouvert" documenté dans `T82-sprint1.md` (pas de garde-fou structurel
  multi-callsite) reste donc ouvert pour un futur ticket.

**Sprint :** 1 (unique). `pnpm typecheck` propre sur `@polenta/types`/`@polenta/api-client`/
`@polenta/desktop`. `/code-review high` : 8 angles couverts, 3 bugs + nettoyage (types,
regex, dédoublonnage de requêtes) corrigés. `SPEC-TECH-stack.md` §4.5.1 et
`SPEC-FORKS-BRANCHES-BASELINES.md` §2.3 mis à jour, `SPEC-INDEX.md` MAJ → T85. Non testé
interactivement (pas d'Electron attachable dans cette session) — validé manuellement par
l'utilisateur sur cette base. Voir `specs/T85.md`, `specs/T85-design.md`, `specs/T85-tests.md`,
`specs/T85-sprint1.md`.

---

### T88 — L'arbre d'historique (Version) suit le repo sélectionné dans le panneau latéral

**Root cause**

`GraphPage` (`apps/desktop/src/renderer/routes/graph.tsx`, route `/graph`, ouverte depuis
l'icône Historique du panneau Version) résolvait son `repoPath` via `api.workspace.resolve`,
c'est-à-dire toujours la racine du workspace — indépendamment du repo effectivement sélectionné
dans l'arbre du panneau latéral. Le panneau Version dispose pourtant déjà d'un mécanisme de
sélection partagé, `SelectedRepoContext` (T80) : cliquer sur un repo dans `VersionRepoFolder`
appelle `selectRepo(repoPath)`, et `/version-diff` lit déjà ce contexte pour suivre la sélection
en direct. `graph.tsx` n'avait simplement jamais été branché dessus — un commentaire explicite
dans le code l'anticipait, et pointait un second problème latent : les actions de checkout de
cette page (bouton ⎇ sur une ligne de commit, menu contextuel — checkout branche/commit)
appelaient directement `api.sync.checkoutBranch`/`checkoutCommit` sans propager le nouveau pin
aux repos dépendants (`propagatePinToDependents`, T82). Tant que `repoPath` était forcément la
racine — que rien ne dépend — ce n'était pas un bug ; une fois la page branchée sur le repo
sélectionné, un checkout depuis cette vue sur un repo composant aurait laissé les pins des repos
dépendants incohérents, exactement le problème que T82 avait corrigé ailleurs.

**Correctif appliqué**

`apps/desktop/src/renderer/routes/graph.tsx` :
- `repoPath` suit désormais `useSelectedRepo()` (`SelectedRepoContext`, T80) au lieu de
  `api.workspace.resolve` — racine par défaut tant qu'aucun repo n'est sélectionné explicitement,
  comportement inchangé dans ce cas.
- `useWorkspaceStructure(workspaceDir, rootRepoPath)` résout `flatNodes` et le nœud du repo
  sélectionné (`{ name, url }`), nécessaires à la propagation de pin.
- Le titre de la page affiche le nom du repo sélectionné (`Arbre de versions — <nom>`) pour
  lever toute ambiguïté sur ce qui est affiché.
- `propagatePinToDependents` (T82) branché sur les trois mutations de checkout de la page (bouton
  ⎇ de la ligne de commit, `checkoutBranchMut`/`checkoutCommitMut` du menu contextuel) — même
  mécanique que `useBranchCheckout`, avec `PinPropagationWarning` affiché sous l'en-tête en cas de
  conflit/échec. No-op silencieux quand le repo sélectionné est la racine. Les autres actions du
  menu contextuel (merge, rebase, push, delete, création de branche/tag) restent hors périmètre,
  comme dans `useBranchCheckout` (`createBranch` n'y est pas non plus branché).

Aucun autre fichier modifié. `pnpm typecheck` (apps/desktop) : 0 erreur. Non testé
interactivement (pas d'Electron attachable dans cette session) — validé manuellement par
l'utilisateur sur cette base. Voir `specs/T88.md`.

---

### T89 — Compteur "à pousser" du panneau Version faussé en l'absence de remote

**Root cause**

Repéré en creusant une confusion de lecture de l'utilisateur (badge "↑2"/"↑1" lu comme "12"/"11" à
l'écran). Dans `SyncService.status` (`apps/desktop/src/main/services/sync.service.ts`), le calcul de
`ahead` tombe dans le `catch` dès que `refs/remotes/origin/<branche>` est introuvable, et faisait
alors `ahead = localCommits.length` — c'est-à-dire la longueur totale de l'historique local de la
branche, sans distinguer deux cas pourtant très différents : (1) un remote `origin` existe mais
cette branche n'a simplement jamais été poussée (les commits locaux sont réellement "à pousser"), et
(2) aucun remote n'est configuré du tout (repo `git init` jamais lié à un remote), auquel cas il n'y
a nulle part où pousser — le badge affichait pourtant tout l'historique comme s'il fallait le
pousser. Reproduit sur les repos de démo `polenta-demo` (`aspirateur-demo`, `motor-control`,
`battery-bms`, tous `git init` sans remote) : `git status` clean, aucun remote, et pourtant un badge
"à pousser" non nul.

**Correctif appliqué**

`sync.service.ts` : dans le bloc `catch`, un appel à `getRemoteUrl(repoPath, 'origin')` (helper déjà
présent, utilisé par ailleurs par `push`/`pull`) détermine si un remote `origin` est réellement
configuré. Si non → `ahead = 0` (rien à pousser nulle part). Si oui → comportement inchangé,
`ahead = localCommits.length` (branche jamais poussée, tout son historique doit effectivement l'être).

**Sprint :** correctif direct, hors pipeline Spec/Design/Dev (bug ponctuel d'une ligne de logique,
pas de fichiers `specs/T89*.md`). Vérifié par reproduction empirique de l'appel isomorphic-git réel
sur les trois repos `polenta-demo` (avant : `ahead` = longueur de l'historique local ; après :
`ahead = 0` sur les trois, remote absent partout). Validé manuellement par l'utilisateur dans l'app.

---

### T90 — Vue Word : champs dupliqués titre/corps, `version` absent et labels FR/EN mélangés dans "Champs visibles"

**Root cause**

Trois bugs dans `ItemCard` (`WordView.tsx`) et `FieldConfigModal` (`SystemView.tsx`, panneau partagé
Tableau/Document) : (1) `section`/`id`/`status`/`version` sont déjà affichés dans l'en-tête de la
carte, mais le corps ne filtrait que `name` avant affichage — doublon avec le titre quand ces champs
sont cochés, d'où l'impression que cocher/décocher n'a aucun effet ; (2) `version` était absent de
`systemFields`/`systemFieldLabels`, donc impossible à cocher ; (3) le libellé affiché retombait sur le
nom technique brut du champ pour les champs custom (`systemFieldLabels[f] ?? f`, sans lookup vers
`typeDef.fields[].label`), alors que les champs système ont un libellé français codé en dur — mélange
FR/EN.

**Correctif appliqué**

`WordView.tsx` : le corps de la carte exclut désormais aussi `section`/`id`/`status`/`version`, en plus
de `name`. `SystemView.tsx` : `version` ajouté à `systemFields`/`systemFieldLabels` ;
le libellé d'un champ custom retombe sur `typeDef.fields[].label` avant le nom technique brut ; et,
suite à un retour de test manuel, la liste de l'onglet **Document** masque entièrement
`section`/`name`/`id`/`status`/`version` (ils n'ont d'effet que dans l'onglet **Tableau**, où ce sont
de vraies colonnes).

**Sprint :** correctif direct (bug UI ponctuel), deux itérations suite aux retours de test manuel de
l'utilisateur. Voir `specs/T90.md`. Non testé interactivement dans cette session (pas d'Electron
attachable) — validé manuellement par l'utilisateur dans l'app avant merge.

---

### T91 — Vue Excel : décocher/recocher un champ dans "Champs visibles" le renvoie en dernière position

**Root cause**

`toggle()` dans `FieldConfigModal` (`SystemView.tsx`) ajoutait systématiquement un champ recoché en
fin de tableau (`[...currentFields, f]`), sans respecter sa position d'origine. `ExcelView.tsx`
désactive volontairement le glisser-déposer de réordonnancement pour la colonne `section`
(`draggable={... col !== 'section'}`, épinglée en première position par design) : une fois éjectée en
fin de liste par ce bug, aucun moyen ne permettait de l'y remettre.

**Correctif appliqué**

`SystemView.tsx` : `toggle()` recalcule l'ordre du tableau résultant selon l'ordre canonique de la
liste affichée dans le panneau (champs système/custom, puis étapes, puis types de lien) au lieu
d'ajouter en fin de tableau. Un champ recoché revient donc à sa place naturelle (`section` redevient
la première colonne) ; le glisser-déposer manuel des autres colonnes reste inchangé, indépendant de
`toggle()`.

**Sprint :** correctif direct (bug UI ponctuel), découvert lors du test manuel de T90. Voir
`specs/T91.md`. Non testé interactivement dans cette session (pas d'Electron attachable) — validé
manuellement par l'utilisateur dans l'app avant merge.

---

### T92 — Uniformisation des barres de titre (vues + panneaux latéraux) et bouton Publier systématique

**Description fonctionnelle**

Nouveau composant partagé `ViewHeader` (`components/layout/ViewHeader.tsx`) repris de la
seule barre de titre déjà cohérente du code (`EditView.tsx`) : `text-sm font-semibold`,
conteneur `px-4 py-2.5 border-b border-edge`, slots `back`/`title`/`subtitle`/`actions` +
un slot toujours réservé pour le bouton **Publier**. Utilisé par les ~19 vues principales
de l'application (Système, Exigences, Tests, Suivi, Requêtes, Schéma, Version, Baselines,
détail/création d'exigence/test/campagne, exécution/résultat de test, Conformité, Diff,
Compte) — remplace des tailles de titre hétérogènes (`text-2xl` à `text-xs` selon la vue,
parfois pas de conteneur du tout).

`ModificationControl` ("Publier") n'est plus monté globalement en `position: fixed` par
`AppLayout` (où il flottait par-dessus le contenu, quelle que soit la vue affichée) : il
est rendu par `ViewHeader` dans le flux normal de la barre de titre de chaque vue, une
instance par vue (remontée à chaque changement de vue — état transitoire réinitialisé,
cache react-query réutilisé, pas de flash de chargement). Ses popups (saisie du titre de
publication, erreur/conflit) sont passées d'un overlay plein écran centré (`fixed inset-0
bg-black/50`) à un popover ancré sous le bouton (`absolute right-0 top-full`, capture de
clic sans assombrissement — pattern déjà utilisé par `FieldConfigModal`), avec fermeture
au clavier (Échap) ajoutée sur le popup d'erreur qui n'en avait aucune avant.

Panneaux latéraux : généralisation de la classe `.section-label` déjà utilisée à 80 % —
en-tête manquant ajouté à `SystemPanel` ("Système") et `DashboardPanel` ("Suivi"), padding
uniformisé (`px-4 py-3 border-b border-edge`) sur `SearchPanel`.

Marge globale retirée : `AppLayout.tsx` appliquait `px-8 py-6` sur `<main>`, insérant
toutes les vues dans cette marge — seule la vue Système y échappait via un hack `-mx-8
-my-6` jamais généralisé. La marge de `main` est supprimée ; toutes les vues sont
désormais bord-à-bord comme Système (le contenu sous `ViewHeader` garde sa largeur de
lecture `max-w-*` mais avec son propre padding, indépendant de `main`).

Sous-titres dupliqués fusionnés dans le titre principal, sur retour utilisateur : la vue
d'Édition (Système) avait son propre bandeau (retour + type + id) faisant doublon avec
`ViewHeader` — supprimé, le bouton retour et l'id sont désormais dans `ViewHeader` (le
bouton retour appelle `EditView.triggerBack()` via `forwardRef`/`useImperativeHandle`,
préservant le flush des valeurs saisies avant navigation). Sur l'Arbre de versions, le
sous-titre (nom de branche) est intégré directement dans le titre.

**Décisions techniques notables** :

- Un `ModificationControl` par `ViewHeader` plutôt qu'un singleton global repositionné —
  évite la complexité d'un système de ref/portail pour un gain nul (cache react-query déjà
  gratuit au remontage).
- `version-diff.tsx` volontairement non migrée vers `ViewHeader` : pas de titre de vue
  "premier niveau" dans cette route (layout à deux colonnes, panneau `w-64` "Comparer" déjà
  conforme à la convention panneau latéral).
- `z-index` du nouveau popover Publier aligné sur le `z-50` déjà utilisé par
  `DiamondConflictModal`/`FieldConfigModal`, sans refonte de la pile de `z-index` existante
  (explicitement hors scope).

**Sprints :** 3 sprints + 2 correctifs post-vérification (marge globale, sous-titres
dupliqués). Voir `specs/T92.md`, `specs/T92-design.md`, `specs/T92-tests.md`,
`specs/T92-sprint1.md`, `specs/T92-sprint2.md`, `specs/T92-sprint3.md` (contient aussi le
détail des 2 correctifs) pour le détail complet. SPEC mise à jour :
`SPEC-ELECTRON-DESKTOP.md` §19.13 (nouveau), `SPEC-INDEX.md`.

**Vérification** : `tsc --noEmit -p tsconfig.json` (0 erreur) après chaque sprint et
correctif. Revue de code manuelle à chaque étape (2 bugs trouvés et corrigés avant
validation : largeur du popover Publier réduite à celle du bouton au lieu de 448px ;
duplication de JSX dans `campaign.$campaignId.tsx`). Pas de script `lint` sur
`@polenta/desktop`, aucun test automatisé (`vitest`/`jest`) n'existe dans ce monorepo.
**Validé manuellement par l'utilisateur dans l'app** avant merge, y compris après les 2
correctifs post-vérification.

---

### T102 — Priorité d'écran au démarrage : login → chargement de projet → dashboard

**Évolution** : au lancement de l'app, la route `/` devait respecter un ordre de priorité
strict — écran de connexion si aucun compte, sinon page de chargement de projet si aucun
projet n'était chargé, sinon la page Suivi/Dashboard du dernier projet. Les deux premiers
cas étaient déjà corrects ; le troisième atterrissait par erreur sur `/schema` (page de
modèle de données) au lieu de `/dashboard`.

**Correctif** : `apps/desktop/src/renderer/routes/index.tsx` — la navigation déclenchée
par `getLastOpened()` au démarrage cible désormais `/dashboard?projectId=…` (avec
`dashboardId: undefined`, requis par le validateur de recherche de la route). `/schema`
reste la page d'atterrissage pour toute navigation *explicite* vers un projet (clic sur
"Récents", création, clone) — comportement issu de T86, non modifié. Le choix automatique
du premier dashboard affiché quand `dashboardId` est absent reste hors scope (→ T109).

SPEC mise à jour : `SPEC-ELECTRON-DESKTOP.md` §16.1/§16.3 (diagramme et table du flux de
démarrage, qui référençaient encore l'ancienne route `/project/$id` retirée depuis T86),
`SPEC-INDEX.md` (nouvelle ligne pour §16, jusqu'ici absente de l'index).

**Sprints :** 1 sprint (pas de phase Design distincte — correctif d'une ligne, périmètre
validé directement en spec). Voir `specs/T102.md`, `specs/T102-sprint1.md`.

**Vérification** : `tsc --noEmit -p tsconfig.json` (0 erreur). `/code-review` (effort
medium) : aucun problème relevé. Pas de script `lint` sur `@polenta/desktop`, aucun test
automatisé n'existe dans ce monorepo. **Validé manuellement par l'utilisateur** avant
merge.

---

### T106 — AGENTS.md généré à la création d'un projet Polenta

**Évolution** : les utilisateurs finaux de Polenta n'ont accès qu'à l'exécutable, pas au
code source de l'outil ni à ses specs internes — aucune documentation embarquée n'aidait
une IA (Claude Code, Cursor, Codex, Copilot, Gemini CLI…) à faire du "system engineering
assisté par IA" sur leurs propres exigences/tests une fois un projet créé.

**Correctif/ajout** : `WorkspaceService.createNewProject()`
(`apps/desktop/src/main/services/workspace.service.ts`) écrit désormais un `AGENTS.md` à
la racine de tout nouveau projet, commité dans le commit initial `init: create project`
au même titre que `.gitignore`. Contenu (constante `AGENTS_MD_TEMPLATE`, nouveau fichier
`apps/desktop/src/main/services/agents-md.template.ts`) volontairement générique et
indépendant de tout domaine métier : format des objets (frontmatter YAML + Markdown),
`.polenta/schema.yaml` comme source de vérité du modèle (types, champs, statuts,
validateurs), invariants (`tree.yaml` généré, IDs jamais réutilisés, `needsRevalidation`),
et les 4 usages visés par le ticket — review d'exigence, review de test, construction
d'indicateurs (moteur de requête SQL en lecture seule des dashboards), vérification des
liens de traçabilité (statuts de couverture). Nom `AGENTS.md` retenu plutôt que le
`READ.md`/`README.md` du ticket : convention cross-outils pour les instructions
destinées à un agent IA, alors que `README.md` reste orienté lecture humaine. Le fichier
ne cite aucun outil IA en particulier.

**Hors scope** : pas de sélection de template à la création (`createNewProject` ne prend
que `containerDir`/`name`, cf. `SPEC-TEMPLATES.md` non implémenté) — contenu fixe, pas
généré depuis un template YAML ; pas d'ajout dans `createFromClone` (repo déjà existant,
pas de forçage) ; pas de migration rétroactive des projets déjà créés.

**Sprints :** 1 sprint (pas de phase Design distincte — décisions de nommage et
d'emplacement validées directement avec l'utilisateur en amont de la spec). Voir
`specs/T106.md`, `specs/T106-sprint1.md`.

**Vérification** : `pnpm --filter @polenta/desktop run typecheck` (0 erreur).
`/code-review` (effort medium, revue manuelle du diff vu sa taille) : aucun problème
relevé. Pas de script `lint` ni de test automatisé sur `@polenta/desktop`. **Validé par
l'utilisateur** avant merge.

---

### T101 — Barre d'onglets façon Firefox

**Évolution** : l'application n'avait qu'une seule vue à la fois (modèle single-Outlet) —
naviguer vers une nouvelle exigence/vue remplaçait toujours la précédente, sans moyen d'en
garder plusieurs ouvertes ni d'y revenir sans perdre sa position.

**Ajout — sprint 1** : nouvelle barre d'onglets (`TabsContext`/`TabBar`/`TabListMenu`,
`apps/desktop/src/renderer/contexts/TabsContext.tsx`) au-dessus d'ActivityBar/Sidebar/main
frame. Un onglet = une URL complète (pathname + search params) ; changer d'onglet
`navigate()` vers cette URL, ActivityBar/Sidebar suivent automatiquement (dérivés de l'URL,
inchangé depuis T92). Bouton "+"/Ctrl+T (nouvel onglet sur la page d'accueil), croix/Ctrl+W
(fermer), menu déroulant filtrable listant les onglets ouverts + "Récemment fermés" (10
entrées, en mémoire). Dernier onglet d'une fenêtre jamais fermé : son contenu retombe sur
la page d'accueil. Scope par fenêtre Electron, pas de persistance disque. `CmdOrCtrl+W`
réaffecté (`apps/desktop/src/main/menu.ts`) : l'ancien accélérateur "Fermer le projet" est
retiré au profit de la fermeture d'onglet, l'action reste accessible sans raccourci dédié.

**Ajout — sprint 2** : dirty-state et confirmation de fermeture. `useRegisterTabDirty`
(pastille orange sur l'onglet) câblé sur les flags `isDirty`/`hasChanges`/`editingFields`
déjà calculés par `schema.tsx`, `req.$reqId.tsx`, `test.$testId.tsx` et
`campaign.$campaignId.tsx` — aucune nouvelle donnée, un seul appel par vue. Ctrl+W/croix
sur un onglet dirty ouvrent `ConfirmCloseTabModal` ("Fermer sans enregistrer ?", Escape
pour annuler) au lieu de fermer directement ; filet de sécurité générique (blur du champ
focus avant d'évaluer, pour les vues en autosave-au-blur sans draft explicite).

**Correctifs post-vérification** (2, trouvés en testant l'app réelle sur profils
fraîchement créés — aucun des deux n'était détectable par la seule lecture du code) :
- Deux tentatives de correction d'une race théorique sur `activeTabId` (pin de l'id
  d'onglet via une `ref` au montage) ont chacune introduit une régression plus grave que le
  problème visé — la première cassait le dirty-tracking dès que deux onglets partagent la
  même URL (cas courant : "+" ouvre toujours sur la même route par défaut) ; la seconde
  (reset d'onglets sur la toute première ouverture de projet d'une session) avait le même
  symptôme par une cause différente. Les deux ont été revertées vers la lecture live
  d'`activeTabId` — la race qu'elles visaient à corriger est nettement plus étroite
  qu'estimé (aucune route de l'app n'utilise de `loader` TanStack Router).
- Bug signalé par l'utilisateur après validation manuelle : "plusieurs onglets ouverts,
  clic sur Comparer dans Version, il n'en reste plus qu'un". Root cause identifiée et
  vérifiée **préexistante sur `master`** (reproduite dans un worktree jetable sur le commit
  de base, avant tout changement T101) : `RootLayout` se démonte/remonte entièrement sur
  certaines navigations (dont "Comparer deux versions") — un défaut TanStack Router
  probablement lié au protocole `file://`, déjà pressenti ailleurs dans le repo (quirk
  documenté dans `apps/desktop/.claude/skills/run-desktop`). Invisible avant ce ticket
  faute d'état à perdre dans ce sous-arbre. Correctif dans le périmètre T101 (pas la cause
  routeur sous-jacente, laissée ouverte) : `tabs`/`activeTabId`/`recentlyClosed` mis en
  cache hors état React (variable de module), réhydratés à chaque remontage —
  `dirtyTabIds` volontairement non mis en cache, la vue concernée étant elle-même
  réellement démontée par ce remount, son brouillon en mémoire est réellement perdu.

**Retour utilisateur additionnel** : titres d'onglet trop génériques (ex. "Produit" quel
que soit ce qui est réellement affiché). `useSetTabTitle` étendu à `product.tsx`/
`components.tsx` (ex. "Produit — Exigences fonctionnelles", via `useSystemView()` déjà
consommé par la vue), `dashboard.tsx`, `query.tsx` (requêtes sauvegardées uniquement),
`graph.tsx` (repo sélectionné), `compliance.tsx` (interface sélectionnée). "Recherche" ne
navigue jamais le main frame (panneau latéral seul) — l'onglet ne change donc pas de nom,
comportement volontaire documenté plutôt que changé.

**Hors scope** : cause profonde du remount routeur sur certaines navigations (pas
seulement "Comparer" — probablement toute navigation dans le même cas) ; persistance des
onglets entre deux lancements de l'app ; réorganisation par glisser-déposer ; épinglage
d'onglets.

**Sprints :** 2 sprints + 2 correctifs post-vérification (bug utilisateur "Comparer" +
titres d'onglet). Voir `specs/T101.md`, `specs/T101-design.md`, `specs/T101-tests.md`,
`specs/T101-sprint1.md`, `specs/T101-sprint2.md` (contient le détail des correctifs) pour
le détail complet. SPEC mise à jour : `SPEC-ELECTRON-DESKTOP.md` §19.1/§19.3 (nouveau),
`SPEC-INDEX.md`.

**Vérification** : `tsc --noEmit -p tsconfig.json` (0 erreur) après chaque sprint et
correctif. `/code-review high` (8 angles) à chaque sprint, findings corrigés avant tout
test (détail dans `T101-sprint1.md`/`T101-sprint2.md`). Testé interactivement de bout en
bout sur profils fraîchement créés (build + Electron piloté via Playwright, captures
d'écran) après chaque sprint et correctif — c'est ce test interactif, pas la revue de
code, qui a débusqué les 2 régressions de correctifs listées ci-dessus. Pas de script
`lint` ni de test automatisé sur `@polenta/desktop`. **Validé manuellement par
l'utilisateur dans l'app**, y compris après les correctifs post-vérification, avant merge.

---

### T107 — Vue Recherche : page vide dédiée au lieu de laisser la page précédente affichée

**Bug** : cliquer sur l'icône Recherche de la barre d'activité laissait la page
précédente (dashboard, exigence, requêtes…) affichée dans la zone de contenu
principale, derrière le panneau de recherche. Comportement en réalité volontaire
depuis T101 ("'Recherche' ne navigue jamais le main frame") — revenu sur cette
décision suite au retour utilisateur : la vue Recherche doit avoir sa propre page
de contenu principal, vide par défaut avec un message d'invitation.

**Root cause** : `SIDEBAR_ONLY_PANELS` dans `AppLayout.tsx` incluait `'search'` au
même titre que `'account'` — cliquer sur Recherche ne faisait que basculer un
overlay de sidebar (`sidebarOverride`) sans jamais appeler `navigate()`. Confirmé
en reproduisant en direct (app pilotée via CDP/Playwright) sur trois vues
différentes avec du contenu réel : le contenu principal restait strictement
inchangé, y compris à 0 ms de délai (pas de flash transitoire).

**Correctif** : nouvelle route `apps/desktop/src/renderer/routes/search.tsx`
(état vide, icône + message d'invitation) ; `AppLayout.tsx` — retrait de
`'search'` de `SIDEBAR_ONLY_PANELS` (seul `'account'` y reste), `deducePanel()`
reconnaît `/search`, nouveau `case 'search'` dans `handleSelectPanel()` qui
navigue vers `/search?projectId=…`, symétrique aux autres panneaux. Le panneau
de recherche lui-même (`SearchPanel.tsx`, query/filtres/remplacement/résultats)
est inchangé, toujours dans la sidebar.

**Bug de config annexe découvert et corrigé** (bloquant pour tester le
correctif) : `electron.vite.config.ts` déclarait `routesDirectory`/
`generatedRouteTree` déjà relatifs à `root: './src/renderer'` en les préfixant
une seconde fois par `./src/renderer/…` — la régénération automatique de
`routeTree.gen.ts` en mode `dev` échouait silencieusement depuis un moment
(`ENOENT` dès le tout premier lancement, avant toute modification liée à T107).
Corrigé en passant les deux chemins en relatif à `root` (`'./routes'` /
`'./routeTree.gen.ts'`).

**Fichiers modifiés** : `apps/desktop/src/renderer/routes/search.tsx` (nouveau),
`apps/desktop/src/renderer/components/layout/AppLayout.tsx`,
`apps/desktop/electron.vite.config.ts`,
`apps/desktop/src/renderer/routeTree.gen.ts` (généré).

**Vérification** : `pnpm --filter @polenta/desktop typecheck` propre. Testé
interactivement (app en `dev`, pilotée via CDP/Playwright, captures d'écran) :
dashboard avec widgets → Recherche → page vide dédiée avec message d'invitation,
plus aucun résidu de la page précédente ; round-trip Système → Suivi → Version →
Projet → Recherche sans erreur. Voir `specs/T107.md`. **Validé par l'utilisateur,
mergé sur `master`.**

---

### T108 — Nettoyer la redondance sidebar / page d'ouverture de projet

**Évolution** : sur la page d'ouverture de projet (`/` sans projet ouvert), la sidebar
(panneau Projet) et la page principale affichaient toutes les deux les mêmes actions —
3 boutons "Ouvrir un projet existant" / "Ouvrir depuis un repo existant" / "Créer un
nouveau projet" dans la sidebar (qui ne faisaient que renvoyer vers la page, sans
formulaire propre), et une liste "Récents" en double, une fois dans la sidebar, une
fois sur la page.

**Correctif** : `ProjectPanel.tsx` (`NoProjectPanel`) — retrait des 3 boutons, ne garde
que le header "Projet" + la liste "Récents". `routes/index.tsx` (`HomePage`) — retrait
du bloc "Récents" (colonne gauche) et de l'état associé ; layout systématiquement en
colonne unique centrée pour les 3 formulaires restants. Le seul point d'entrée vers un
projet récent reste désormais la sidebar.

**Bug de merge découvert et corrigé après le merge sur `master`** : T105 (mergé
séparément, après la coupe de la branche T108) avait ajouté un garde-fou `cancelled` au
`useEffect` de `HomePage` tout en gardant un appel à `setRecents(...)` — état que T108
avait supprimé sur sa propre branche. Le merge des deux branches a combiné les deux
modifications sans conflit textuel détecté, laissant un appel à un setter inexistant :
`ReferenceError` silencieux dans `init()`, `ready` jamais mis à `true`, page bloquée sur
"Chargement…" en permanence. Corrigé en retirant l'appel mort ; le garde-fou `cancelled`
de T105 est conservé intact. `tsc --noEmit` aurait immédiatement détecté le problème —
non relancé entre le merge et le retour utilisateur.

**Fichiers modifiés** : `apps/desktop/src/renderer/components/sidebar/ProjectPanel.tsx`,
`apps/desktop/src/renderer/routes/index.tsx`. SPEC mise à jour :
`SPEC-ELECTRON-DESKTOP.md` §16.5, `SPEC-INDEX.md`.

**Vérification** : `tsc --noEmit -p tsconfig.json` propre (avant et après le correctif
post-merge). `/code-review medium` sur le diff du sprint : aucun finding. Testé
interactivement (build + Electron piloté via Playwright, worktree dédié) : sidebar
confirmée sans les 3 boutons, navigation depuis un projet récent toujours fonctionnelle.
Glitch routeur pré-existant et indépendant ("Not Found" au tout premier rendu sur `/`)
identifié pendant le test, reproduit à l'identique sur le code d'avant-sprint — non lié à
ce ticket, non corrigé. **Validé par l'utilisateur après le correctif post-merge, mergé
sur `master`.**

---

### T112 — Supprimer createdAt/createdBy/updatedAt/updatedBy des YAML, dériver de git

**Évolution** : les fichiers YAML `requirements/*.yaml` et `tests/*.yaml` stockaient en
dur `createdAt`/`createdBy`/`updatedAt`/`updatedBy`, redondants avec l'historique git
(chaque fichier est déjà versionné) et source d'une classe de bugs entière (n'importe
quelle écriture accidentelle pollue ces champs et le diff git), constat fait en creusant
T104.

**Correctif** : ces 4 champs ne sont plus jamais écrits dans le YAML — `create()` les met
à `null` (fichier neuf, aucun commit), `update`/`openDraft`/`transition` les laissent
transiter tels quels sans les fixer à la main. Nouvelle méthode `git.service.ts
fileHistory(repoPath, filePath)` dérivant créé/modifié le/par du `git log` filtré sur le
chemin du fichier (`null` si aucun commit). `requirements-index.service.ts` et
`tests-index.service.ts` (`build()`) appellent `fileHistory()` pour chaque fichier lu et
écrasent sans condition les 4 champs sur l'objet en mémoire — seul point d'appel de
`fileHistory()` du ticket. Nouveau helper partagé `audit-fields.util.ts`
(`omitAuditFields()`) pour omettre les 4 champs juste avant chaque `git.writeYaml` (7
sites d'écriture). `packages/types` : les 4 champs élargis de `string` à `string | null`
sur `Requirement`/`TestCase`.

**Corrigé au passage** : `TestsService.findOne()` et `update()` contournaient l'index
(lecture YAML brute via `git.readYaml`) au lieu de passer par `testsIndex.findById()`,
comme `RequirementsService` le faisait déjà — une fois les 4 champs absents du YAML, ce
bypass les aurait renvoyés `undefined` au lieu des vraies valeurs en cache, perte de
données silencieuse à chaque édition d'un test.

**Découverte en cours de sprint** : `RepoWatcherService.watch()` n'était appelé nulle
part dans l'app — service câblé dans le conteneur DI mais jamais démarré (vrai aussi
pour le watcher principal existant, pas seulement le nouveau). `WorkspaceService
.openWorkspace()` démarre désormais le watcher pour chaque repo du workspace à
l'ouverture (`watch()` idempotent). Un second watcher chokidar, scopé à `.git/HEAD` +
`.git/refs/**` (pas tout `.git`), invalide les index `requirements`/`tests` sans
condition sur tout changement de ref (commit/merge/rebase/checkout ne touchant aucun
fichier du working tree, donc invisible au watcher principal) — sans quoi les timestamps
dérivés de git restaient figés après ce type d'opération.

**Fichiers modifiés** : `packages/types/src/requirement.ts`, `packages/types/src/test.ts`,
`apps/desktop/src/main/services/git.service.ts`,
`apps/desktop/src/main/services/audit-fields.util.ts` (nouveau),
`apps/desktop/src/main/services/requirements.service.ts`,
`apps/desktop/src/main/services/tests.service.ts`,
`apps/desktop/src/main/services/requirements-index.service.ts`,
`apps/desktop/src/main/services/tests-index.service.ts`,
`apps/desktop/src/main/services/repo-watcher.service.ts`,
`apps/desktop/src/main/services/workspace.service.ts`,
`apps/desktop/src/main/container.ts`.

**Vérification** : `pnpm typecheck` propre sur `@polenta/desktop` et `@polenta/api-client`.
Testé via `run-desktop` (build + driver Playwright) sur un projet de démo, par appels IPC
directs (`requirements:create`/`get`/`update`, `sync:stage-all`/`commit`) pour isoler
chaque étape du cycle non-commité → commit → édition non commitée → commit, dans une
session app continue (sans redémarrage), confirmant le rafraîchissement en direct via le
watcher. **Validé par l'utilisateur, mergé sur `master`.**

---

### T105 — Fermer le projet (croix du panneau Projet) demandait plusieurs clics

**Bug** : dans le panneau latéral Projet, cliquer sur la croix ✕ « Fermer le
projet » ne fermait pas de façon fiable — l'application revenait sur le projet
(atterrissage systématique sur `/dashboard`, quelle que soit la page de départ),
et il fallait recliquer plusieurs fois (jusqu'à ~4) avant que la fermeture ne
"tienne".

**Root cause (round 1)** : `HomePage` (`routes/index.tsx`) remonte à chaque
passage sur `/`, y compris celui déclenché délibérément par la fermeture. Son
effet `init()` enchaîne deux appels IPC asynchrones (`hasAnyAccount()` puis
`getLastOpened()`) sans garde contre le fait que le composant ait, entre-temps,
déjà servi à naviguer ailleurs — une résolution tardive après démontage pouvait
déclencher son propre `navigate({ to: '/dashboard', ... })`, écrasant la
navigation voulue. Confirmé en reproduisant en direct : la création d'un nouveau
projet atterrissait parfois sur `/dashboard` au lieu du `/schema` attendu, pour
cette même raison.

**Root cause (round 2, après retour utilisateur — le round 1 ne suffisait pas
en usage réel `pnpm dev`)** : le garde `cancelled` du round 1 protège contre une
résolution tardive *après* démontage, mais pas contre une lecture disque à temps
mais pas encore cohérente avec l'écriture `clearLastOpened()` qui vient de se
produire juste avant — deux appels IPC/disque séparés (fermeture ⇒ écriture ;
`HomePage` ⇒ relecture), sans garantie que le second observe l'effet du
premier. Sous clics répétés (l'utilisateur recliquant précisément parce que la
fermeture ne se voit pas), chaque tentative relance toute la chaîne depuis le
début, ce qui rend la fenêtre de course plus facile à toucher.

**Correctif** :
- Round 1, `apps/desktop/src/renderer/routes/index.tsx` : drapeau `cancelled`
  local dans l'effet `init()` de `HomePage`, vérifié après chaque `await` —
  abandonne la suite (dont le `navigate()` vers `/dashboard`) si l'effet est
  devenu obsolète.
- Round 2, nouveau module `apps/desktop/src/renderer/lib/projectCloseSignal.ts` :
  signal **en mémoire** (pas sur disque), `markProjectJustClosed()` /
  `consumeProjectJustClosed()`. La croix `ProjectPanel.handleClose` et les deux
  handlers `menu:open-workspace`/`menu:close-project` de `useMenuEvents.ts`
  appellent `markProjectJustClosed()` avant même `clearLastOpened()`.
  `HomePage.init()` consomme ce signal avant d'aller lire `getLastOpened()` sur
  disque ; si présent, affiche directement la page d'accueil sans interroger le
  disque — fermeture volontaire rendue déterministe, indépendante de tout aléa
  de timing disque/IPC.

**Découverte annexe (hors périmètre, non traitée ici)** : en testant le
correctif, un cold boot sans projet ouvert reste bloqué sur un écran
« Not Found » de façon largement reproductible, sans aucune échappatoire
cliquable — T108 a déplacé les 3 formulaires Ouvrir/Cloner/Créer hors de la
sidebar vers la page `/` elle-même, précisément la page coincée sur
« Not Found » au premier chargement (mismatch d'historique initial documenté
dans `main.tsx`, jusque-là contournable via un bouton resté dans la sidebar
avant T108). À traiter dans un ticket séparé.

**Fichiers modifiés** : `apps/desktop/src/renderer/routes/index.tsx`,
`apps/desktop/src/renderer/lib/projectCloseSignal.ts` (nouveau),
`apps/desktop/src/renderer/components/sidebar/ProjectPanel.tsx`,
`apps/desktop/src/renderer/hooks/useMenuEvents.ts`.

**Vérification** : `pnpm --filter @polenta/desktop typecheck` propre. Reproduit
et corrigé en direct (build desktop pilotée via Playwright/CDP,
`.claude/skills/run-desktop`) dans une build `--mode development` (React
StrictMode actif) et une build production : cold boot atterrissant directement
sur `/dashboard?projectId=…` (via `lastOpenedDir` persistant), puis clics
répétés et immédiats sur la croix « Fermer le projet » — fermeture stable dès
le premier clic. Voir `specs/T105.md`. **Validé par l'utilisateur, mergé sur
`master`.**

---

### T114 — Cold boot sans projet ouvert bloqué sur "Not Found", sans échappatoire

**Bug** : au démarrage de l'app sans projet ouvert, la page d'accueil affichait
parfois "Not Found" à la place des formulaires Ouvrir/Cloner/Créer, sans aucun
moyen de s'en sortir en cliquant. Découvert en testant [[T105]] (fermeture de
projet) : la séquence de test (cold boot → créer un projet) tombait dessus de
façon largement reproductible.

**Root cause** : TanStack Router, sur l'URL `file://.../index.html` d'entrée
de l'app, calcule parfois son tout premier match contre ce chemin brut du
fichier (pas contre `/`) — un mismatch d'historique déjà documenté
(`apps/desktop/.claude/skills/run-desktop/SKILL.md`, Gotchas : "Cold boot
sometimes shows a stray Not Found… one real client-side navigate() call fixes
it"). Avant T108, ce quirk était bénin : la sidebar gardait sa propre copie des
boutons Ouvrir/Cloner/Créer, un vrai clic dessus "corrigeait" le mismatch en
passant. T108 ("Nettoyer la redondance sidebar / page d'ouverture de projet")
a retiré ces boutons de la sidebar pour ne les garder que sur la page `/`
elle-même — précisément la page bloquée sur "Not Found" au premier chargement.
Plus aucun élément cliquable ne permettait de s'en sortir (les autres icônes de
la barre d'activité pouvant naviguer ailleurs — Suivi, Système, Recherche,
Version — sont toutes `requiresProject: true`, donc désactivées sans projet).

**Correctif** : `apps/desktop/src/renderer/main.tsx` — le cas `__print`
(fenêtre PDF cachée) forçait déjà un `router.navigate()` explicite avant le
premier montage pour contourner ce même quirk (commentaire T43 existant). Ajout
d'un `await router.navigate({ to: '/', replace: true })` symétrique dans la
branche normale (fenêtre visible) de `boot()`, avant `createRoot(...).render(
...)`. Sûr pour toute fenêtre normale : `main/index.ts` (`createAppWindow`) ne
charge jamais que `ELECTRON_RENDERER_URL` (dev) ou `index.html` (prod) sans
chemin particulier — aucune fenêtre normale n'a jamais eu de raison d'atterrir
ailleurs que sur `/` au boot.

**Fichiers modifiés** : `apps/desktop/src/renderer/main.tsx`.

**Vérification** : `pnpm --filter @polenta/desktop typecheck` propre. Testé en
direct (build desktop pilotée via Playwright/CDP, `.claude/skills/run-desktop`) :
5 lancements consécutifs à froid sur un profil neuf, tous atterrissant
correctement sur la page d'accueil (jamais "Not Found") ; round-trip complet
cold boot → créer un projet → fermer le projet, sans jamais passer par un état
bloqué. Voir `specs/T114.md`. **Validé par l'utilisateur, mergé sur `master`.**

---

### T109 — Suivi/Dashboard : afficher le premier dashboard par défaut

**Évolution** : sur `/dashboard?projectId=…` sans `dashboardId` (démarrage sur
le dernier projet connu, ou dashboard actif supprimé), la page affichait un
message d'invite ("Sélectionnez un dashboard… ou créez-en un") au lieu
d'ouvrir un dashboard existant, alors qu'un choix par défaut raisonnable (le
premier de la liste, tel qu'affiché dans le panneau latéral) existait déjà.

**Correctif** : `dashboard.tsx` redirige (`replace: true`) vers le premier
dashboard dans l'ordre du panneau latéral (`orderItems(dashboards,
dashboardsOrder)`, helper déjà partagé avec `DashboardGrid`) dès qu'au moins un
dashboard existe ; le message d'invite ne reste que si le projet n'en a
réellement aucun. Le rendu ne l'affiche jamais avant d'être certain que la
liste est vide (garde contre le flash : une requête React Query désactivée
rapporte `isLoading: false`, pas `true`, tant que `repoPath` n'est pas encore
connu).

**Corrigé au passage (trouvé par `/code-review` avant merge)** :
`DashboardPanel.tsx` — supprimer le dashboard actif pouvait rediriger vers l'id
qu'on venait de supprimer, `invalidateQueries` seul ne faisant que planifier un
refetch asynchrone pendant que `dashboard.tsx` lisait déjà l'ancien cache pour
calculer sa redirection. Corrigé par une mise à jour synchrone du cache
(`qc.setQueryData`, filtrant l'id supprimé) avant l'invalidation, même pattern
que celui déjà utilisé pour le changement de scope privé/partagé.

**Extension demandée en validant le sprint** : l'icône "Suivi" de la barre
d'activité (`AppLayout.tsx`) navigait inconditionnellement vers `/query` (vue
Requêtes vide) au clic, quel que soit ce qui était affiché avant — sortir du
panneau Suivi puis y revenir affichait la vue Requêtes vide dans le contenu
principal alors que le panneau latéral restait sur l'onglet Dashboards. Ajout
de `lastDashboardRoute` (même mécanisme que le `lastVersionRoute` déjà
existant pour le panneau Version) : le clic restaure désormais la dernière
sous-vue quittée (dashboard ou requête précis), et bascule vers `/dashboard`
(bénéficiant du redirect ci-dessus) plutôt que `/query` quand aucune sous-vue
n'est encore connue.

**Fichiers modifiés** : `apps/desktop/src/renderer/routes/dashboard.tsx`,
`apps/desktop/src/renderer/components/sidebar/DashboardPanel.tsx`,
`apps/desktop/src/renderer/components/layout/AppLayout.tsx`.

**Vérification** : `pnpm --filter @polenta/desktop typecheck` propre.
`/code-review` (medium, 8 angles) avant merge. Testé en direct (build desktop
pilotée via Playwright/CDP, `.claude/skills/run-desktop`) sur des projets
fixture à plusieurs dashboards/requêtes : démarrage → ouverture directe du
premier dashboard ; suppression du dashboard actif avec d'autres restants →
bascule sur le nouveau premier (pas l'id supprimé) ; suppression de tous les
dashboards → retour au message d'invite, sans boucle ; sélection d'un
dashboard non-premier (ou d'une requête), navigation vers un autre panneau
puis retour sur Suivi → même dashboard/requête restauré. Voir `specs/T109.md`,
`specs/T109-design.md`, `specs/T109-tests.md`, `specs/T109-sprint1.md`.
**Validé par l'utilisateur, mergé sur `master`.**

---

### T51 — Filtre par colonne dans la vue Excel

**Évolution** : la vue Excel n'avait qu'un filtre global (barre au-dessus de l'arbre,
options casse/mot entier/regex) qui masque une ligne si **une** colonne quelconque
contient le texte recherché — impossible de cibler la valeur d'une colonne précise.

**Cadrage** : premier passage prévoyait une ligne de filtres permanente sous les
en-têtes ; retour humain ("pas encombrer l'affichage") a fait remplacer ça par une
icône discrète par en-tête de colonne (toutes sauf "Étapes"), ouvrant un popover au
clic avec un champ texte et les 3 mêmes options que la recherche générale (casse
sensible, mot entier, expression régulière) — même moteur de correspondance, juste
borné à une colonne au lieu de "au moins une colonne".

**Ajout** : `ExcelView.tsx` — état local `columnFilters` (texte + options par
colonne, non persisté), icône + popover ancré sous l'en-tête, combinaison en ET
entre colonnes et avec le filtre global. `getCellText` extrait comme point de
vérité unique pour la valeur affichée d'une colonne (largeur auto, filtre global,
filtre par colonne — auparavant dupliqué). `buildFilterRegex`/`FilterOptions`
(`lib/textFilter.ts`, nouveau) et `FilterOptionsToggle.tsx` (nouveau) extraits pour
dédupliquer deux copies identiques préexistantes de `buildCampaignFilterRe`
(`SystemPanel.tsx`, `CampaignListView.tsx`) et les 3 boutons casse/mot entier/regex
— réutilisés tels quels par le nouveau popover.

**Correctifs post-revue de code** (`/code-review medium`, 8 angles, avant tout
test) : popover orphelin si sa colonne est masquée pendant qu'il est ouvert ; icône
affichée "active" pour une regex invalide qui ne filtrait plus rien (silencieux) ;
bug de précédence mot-entier+regex dans `buildFilterRegex` (`\b${pattern}\b` sans
groupe non-capturant, cassait sur une alternation de tête — hérité des 2 copies
supprimées, corrigé pour les 3 consommateurs) ; réexport mort de `FilterOptions` ;
régression cosmétique d'espacement entre les boutons de `FilterOptionsToggle`.

**Correctif post-revue utilisateur** (trouvé en testant l'app réelle, après
présentation du sprint) : un `early return` remplaçait tout le rendu de la vue
Excel — y compris l'en-tête et ses icônes de filtre — dès qu'un filtre ne
retournait aucune ligne, rendant impossible de le modifier ou de l'effacer une
fois à zéro résultat. Corrigé : l'en-tête (et le popover ouvert) restent toujours
montés, seul le corps du tableau affiche une ligne "Aucun élément" à la place des
lignes filtrées.

**Divergence vs design initial** : le design ne prévoyait qu'une purge des filtres
sur colonne masquée. Un second `useEffect` (reset complet sur changement de
composant/type) a été ajouté car la purge seule ne suffit pas quand deux types
partagent un nom de colonne (ex. `status` présent à la fois sur une exigence et un
cas de test) — la colonne existe toujours dans les deux cas, rien n'est purgé.

**Hors scope** : AutoFiltre façon Excel (liste de valeurs distinctes à cocher) —
écarté au cadrage ; filtre par colonne dans la vue Document (reste au filtre
global seul) ; debounce/mémoïsation du filtre par colonne à grande échelle
(plusieurs centaines de lignes) — signalé comme point ouvert, pas de régression
mesurée sur ce projet de démonstration ; unification de `buildFilterRegex` avec
`getMatchingIds` (filtre de l'arbre, sémantique différente sur regex invalide,
volontairement laissée telle quelle pour ne pas changer ce comportement hors
périmètre).

**Vérification** : `tsc --noEmit -p tsconfig.json` (0 erreur) après chaque étape.
`/code-review medium` (8 angles) après l'implémentation initiale, 5 correctifs
appliqués et re-vérifiés. Testé interactivement de bout en bout (build de
production + Electron piloté via Playwright, captures d'écran) sur un projet de
démonstration avec exigences aux statuts/priorités variés : filtre simple,
combinaison ET (colonnes entre elles et avec le filtre global), mot entier, regex
invalide, Échap/clic-extérieur, icône active/inactive, état vide, reset au
changement de type (y compris collision de nom de colonne), absence en vue
Document. SPEC mise à jour : `SPEC-SYSTEM-VIEW.md` (nouvelle section "Filtre par
colonne"), `SPEC-INDEX.md`. Voir `specs/T51.md`, `specs/T51-design.md`,
`specs/T51-tests.md`, `specs/T51-sprint1.md`. **Validé par l'utilisateur, mergé
sur `master`.**

---

### T49 — Test ajouté à une campagne copié (snapshot), pas une référence

**Évolution** : `CampaignTestRun` ne stockait qu'un `testCaseId` — toute lecture (liste,
exécution, relecture d'un run, exports plan/rapport xlsx/docx/pdf) résolvait cet id
contre l'état **live** du test. Modifier, repasser en `draft` ou même supprimer un test
après son ajout changeait silencieusement ce qu'affichait une campagne — y compris une
campagne **fermée** (`completed`/`abandoned`), qui n'était donc pas un enregistrement
réellement figé.

**Correctif** : `CampaignTestRun` gagne un champ `testSnapshot?: TestCase` — copie
complète de l'objet (pas une sélection de champs), prise une fois au moment de
l'inclusion (`create()`, `addTests()`, `duplicateTest()`, `campaigns.service.ts`, qui
prend désormais une dépendance à `TestsService` pour la résoudre). Toute lecture
ultérieure utilise `testSnapshot` en priorité, avec repli sur résolution live
uniquement pour les entrées créées avant ce ticket (**pas de migration rétroactive**,
décision de cadrage explicite — pas de backfill comme celui d'`entryId`/T97 sprint 2).
Le gating "test approuvé" du panneau d'ajout reste basé sur l'état live, inchangé.
`resolveCampaignTests()` (résolution par `testCaseId` unique, incompatible avec les
instances multiples d'un même test paramétré, T97 sprint 2) remplacée par
`resolveCampaignRuns()`, indexée par `run` — corrige au passage un bug latent où
l'export d'un test inclus plusieurs fois attribuait le statut de la première instance
à toutes (`campaign.runs.find(r => r.testCaseId === t.id)`), effet de bord nécessaire
du nouveau modèle par instance, pas un correctif recherché pour lui-même.

**Correctifs post-revue de code** (`/code-review high`, 8 angles) : `snapshotsFor()`
tolère désormais un id non résolu (test supprimé entre l'affichage du panneau et
l'appel) au lieu de faire échouer tout l'ajout groupé — avant ce correctif, un seul id
périmé aurait bloqué même les tests valides du même lot, une régression par rapport au
comportement pré-T49 (jamais bloquant) ; le panneau "Dupliquer" une instance paramétrée
utilisait le snapshot figé de l'entrée cliquée pour ses champs de paramètres, alors que
`duplicateTest()` capture en réalité l'état *live* du test pour la nouvelle instance —
corrigé (`liveTc`/`hasLiveParams` distincts du `tc` snapshot-first utilisé pour
l'affichage et "Modifier les paramètres") ; la résolution "snapshot sinon live",
dupliquée trois fois (liste de campagne, page d'exécution, page de relecture),
centralisée dans `resolveRunTest()` (`lib/campaignTests.ts`) et le hook
`useResolvedCampaignTest()` (nouveau, `hooks/`).

**Hors scope** : pas de bouton de resynchronisation volontaire du snapshot depuis la
source ; pas d'indicateur visuel "le test source a changé depuis l'ajout" ; pas de
changement du gating d'ajout (seuls les tests approuvés proposés, basé sur l'état
live) ; pas de correction de l'incohérence préexistante où `campaign.new.tsx` (création)
n'applique aucun filtre d'approbation contrairement au panneau d'ajout d'une campagne
existante.

**Vérification** : `tsc --noEmit` (`@polenta/desktop`, `@polenta/types`, 0 erreur).
`/code-review high` (8 angles) après l'implémentation initiale, 3 correctifs appliqués
et re-vérifiés (typecheck relancé, propre). **Non testé interactivement dans
l'application** (pas de session Electron pilotée pour ce ticket) — validation reposant
sur la relecture du diff, le typecheck et la revue de code multi-angles ; les scénarios
de `specs/T49-tests.md` restent à rejouer manuellement si un doute apparaît en usage
réel. SPEC mise à jour : `SPEC-TESTS.md` (§4.1, §4.2 — nouvelle sous-section "Snapshot à
l'inclusion", §4.4), `SPEC-INDEX.md`. Voir `specs/T49.md`, `specs/T49-design.md`,
`specs/T49-tests.md`, `specs/T49-sprint1.md`. **Validé par l'utilisateur, mergé sur
`master`.**

---

### T118 — Collision d'ID sur les objets à compteur (campagnes, exigences, tests)

**Bug** : `nextCampaignId()` (`campaigns.service.ts`), `nextId()` (`requirements.service.ts`)
et `nextTestId()` (`tests.service.ts`) faisaient chacun un read-modify-write indépendant sur
`config/counters.yaml`, sans verrou (`create()` n'était pas sérialisé, contrairement à
`update()`/`addTests()` dans `campaigns.service.ts` qui passent par `enqueue()` par ID
d'objet) — deux créations proches dans le temps pouvaient lire la même valeur de compteur,
produire le même ID, et la seconde écriture écrasait silencieusement la première (perte de
données, sans erreur visible). De plus le compteur n'était jamais recalé sur l'état réel du
dossier : des fichiers écrits hors de ce chemin (seed, édition manuelle) laissaient le
compteur en retard, prêt à régénérer un ID déjà pris.

**Repro confirmée** dans `C:\Dev\polenta-demo\aspirateur-demo` : `config/counters.yaml`
resté à `CAMP: 1` alors que `campaigns/CAMP-0001.yaml` à `CAMP-0004.yaml` existaient déjà
(seed jamais passée par le compteur) — une création via l'UI avait déjà régénéré `CAMP-0001`
et écrasé le seed correspondant (commit `4d1d753 test update` dans l'historique de ce repo
produit). Rejoué à l'identique : la création successive de 3 campagnes n'a produit que 2
fichiers propres, la 3e absorbée dans `CAMP-0001` existant.

**Correctif** : nouveau helper partagé `apps/desktop/src/main/services/id-counter.util.ts`
— `nextCounterId(git, repoPath, prefix, dir)` — qui sérialise chaque lecture+écriture de
`counters.yaml` par `repoPath` via une file de promesses en mémoire (même pattern que
`CampaignsService.enqueue`), et recale le compteur à chaque calcul :
`max(compteur stocké, plus grand <PREFIX>-NNNN présent dans dir) + 1`, de sorte qu'un
compteur en retard s'auto-corrige au lieu de collisionner avec un fichier déjà présent.
`campaigns.service.ts`, `requirements.service.ts` et `tests.service.ts` délèguent désormais
à ce helper au lieu de dupliquer chacun leur propre logique read-modify-write.

**Hors scope** : `saved-queries.service.ts`/`dashboards.service.ts` (compteurs
`QUERY`/`DASHBOARD`) n'ont pas été touchés — pas vérifiés comme partageant le pattern
défaillant. Les données de `C:\Dev\polenta-demo\aspirateur-demo` restent polluées par les
collisions passées (nettoyage à traiter à part, repo produit séparé, pas ce repo outil).

**Vérification** : `pnpm typecheck` (`apps/desktop`) — 0 erreur, y compris après résolution
des conflits de merge avec T113 (imports de `schema-lookup.util` et `id-counter.util`
coexistant dans `requirements.service.ts`/`tests.service.ts`). Script de sanity manuel
reconstituant l'état réel de `polenta-demo` (compteur `CAMP: 1`, fichiers jusqu'à
`CAMP-0004`) puis 3 créations concurrentes → `CAMP-0005`, `CAMP-0006`, `CAMP-0007`, tous
uniques. Pas d'infra de test unitaire existante sur ces services. Voir `specs/T118.md`.
**Validé par l'utilisateur, mergé sur `master`.**

---

### T117 — "Exécuter" un test dans une campagne ne fait rien visuellement

**Bug** : dans une campagne d'essai active, cliquer "Exécuter" à côté d'un test (ex.
TEST-0001 dans CAMP-0001) ne faisait rien visuellement — l'URL avançait bien vers
`/campaign/$campaignId/execute/$testId` (routeur TanStack Router confirmé côté
`location.href`) mais l'écran restait figé sur la liste de la campagne, sans erreur JS.

**Root cause** : `campaign.$campaignId.execute.$testId.tsx` et
`campaign.$campaignId.run.$testId.tsx` suivaient la convention de nommage plat de TanStack
Router, qui les enregistrait automatiquement comme **routes enfants** de
`campaign.$campaignId.tsx` (`getParentRoute: () => CampaignCampaignIdRoute`). Or
`CampaignDetailPage` (le composant de cette route) ne rend jamais de `<Outlet />` — c'est
une page complète autonome, pas un layout. Une route enfant ne s'affiche que via
l'`<Outlet />` de son parent : en son absence, naviguer vers l'enfant avançait le routeur
sans que rien de nouveau ne se monte. `ExecuteTestPage`/`TestRunViewPage` rendent chacun
leur propre page plein écran — clairement conçus comme des remplacements totaux, pas du
contenu imbriqué dans la liste de la campagne. La "cause probable" citée dans le ticket
initial (quirk de remount du root route component, `TabsContext.tsx`) était un phénomène
réel mais sans lien avec ce bug — la preuve étant que le corriger n'a nécessité aucun
changement dans ce fichier.

**Correctif** : renommage des deux fichiers de route avec le suffixe d'échappement `_` que
TanStack Router reconnaît pour sortir un fichier de l'imbrication automatique sous le
parent dont le préfixe de nom correspond (`campaign.$campaignId_.execute.$testId.tsx`,
`campaign.$campaignId_.run.$testId.tsx`) — même motif que toutes les autres pages de détail
de l'app (`req.$reqId`, `test.$testId`…). `routeTree.gen.ts` régénéré en conséquence : les
deux routes ont désormais `getParentRoute: () => rootRouteImport`. `path`/`fullPath`
runtime inchangés (le suffixe `_` est un signal de build, absent de l'URL) — aucun
changement de code applicatif nécessaire.

**Vérification** : `pnpm typecheck`/`pnpm build` (`apps/desktop`) propres. Testé
interactivement via le driver Playwright de `run-desktop` contre
`C:\Dev\polenta-demo\aspirateur-demo`, campagne CAMP-0001 : "Exécuter" ouvre désormais la
page d'exécution (préconditions, étapes, soumission), soumettre un résultat retourne à la
liste avec le statut à jour, "Voir" (même bug sur la route sœur) affiche également la
relecture du run. Voir `specs/T117.md`.
**Validé par l'utilisateur, mergé sur `master`.**

---

### T119 — Espace supprimé automatiquement en édition richtext (vues Excel/Word)

**Bug** : dans le popover d'édition richtext (`RichTextField`, TipTap) ouvert depuis
`ExcelView`/`WordView`, ajouter un espace entre deux mots était quasi impossible — le
caractère disparaissait juste après avoir été tapé.

**Root cause identifiée (course sur l'auto-save)** : `handleAutoInlineEdit`
(`SystemView.tsx`) sauvegardait à chaque frappe sans debounce (`onUpdate` de TipTap
appelle `onChange` à chaque caractère). Une réponse de save plus ancienne pouvait arriver
après une frappe plus récente ; son `onSuccess` effaçait alors sans condition le
`pendingEdit` correspondant (`clearPendingEditsFor`), laissant la valeur serveur stale
retomber dans `RichTextField`, où l'effet de resynchronisation externe (`value` externe
≠ contenu vivant de l'éditeur) réinitialisait l'éditeur — perdant le caractère tout juste
tapé.

**Correctif appliqué** (2 volets) :
1. `handleAutoInlineEdit` : debounce de 800 ms par `objectId:field` (même pattern que
   `handleWordViewStepsChange`), réduit la fréquence des allers-retours réseau.
2. `clearPendingEditsFor` (`SystemViewContext.tsx`) : accepte un `expectedValue` optionnel
   — ne supprime le pending edit que s'il est encore égal à la valeur qui vient d'être
   sauvegardée, sinon le laisse en place pour son propre cycle de save (ferme la fenêtre
   de course au lieu de seulement la réduire).

**Reproduction manuelle en environnement de dev** (typing lent touche par touche, typing
rapide en rafale, insertion en milieu de mot, en début et en fin de champ) : espace
préservé dans tous les cas après les deux correctifs — confirmé également par
l'utilisateur en re-testant depuis le worktree `T119` après le second correctif.
Voir `specs/T119.md`.
**Validé par l'utilisateur, mergé sur `master`.**

---

### T120 — Fusion des comboboxes Composant/Sous-composant dans la Vue Système

**Évolution** : T113 avait introduit un second combobox "Sous-composant" dans la Vue Système,
en cascade sous le combobox "Composant" (T72), pour choisir entre les `SystemNode` locaux d'un
repo. Ce niveau de navigation supplémentaire perturbait l'utilisateur — un sous-composant local
(même repo git) et un composant en repo séparé sont conceptuellement du même ordre ("un
composant du système") mais seul le second obtenait une entrée directe dans "Composant".

**Correctif** : les deux comboboxes fusionnés en un seul "Composant"
(`SystemViewContext.tsx`/`SystemPanel.tsx`) : `componentOptions` liste à plat une entrée par
`SystemNode` de chaque repo du workspace (root + sous-composants locaux), avec un séparateur
visuel (`<optgroup>`) uniquement quand un repo a plusieurs `SystemNode` **et** que le workspace a
plusieurs repos — un repo unique ou un repo à un seul `SystemNode` rend exactement comme avant ce
ticket. Dans l'onglet Structure, un sous-composant local reçoit désormais une icône dédiée
(`Component`, lucide-react) et le même poids visuel qu'une ligne de repo (`StructureTab.tsx`),
tout en restant imbriqué sous son repo conteneur (contrainte de stockage réelle).

**Divergences trouvées en revue de code** (`/code-review`, 8 agents, convergentes sur plusieurs
angles) : la sélection était initialement pilotée par une clé de chaîne composite
`${repoName}::${nodeId}`, parsée par `split('::')` — un nom de repo ou de sous-composant
contenant déjà ce séparateur tronquait silencieusement la sélection. Corrigé en sélectionnant par
**index de position** dans `componentOptions` plutôt que par clé sérialisée, éliminant la classe
de bug entière. La revue a aussi détecté qu'en mono-repo avec plusieurs sous-composants locaux
(cas principal de T113), le regroupement affichait `<optgroup label="root">` — fuite du nom de
montage synthétique interne, régression par rapport à l'ancien combobox "Sous-composant" qui
n'affichait aucun en-tête dans ce cas. Corrigé : le regroupement ne s'active que lorsque le
workspace comporte plusieurs repos.

**Fichiers modifiés** : `apps/desktop/src/renderer/contexts/SystemViewContext.tsx`,
`apps/desktop/src/renderer/components/sidebar/SystemPanel.tsx`,
`apps/desktop/src/renderer/components/schema/StructureTab.tsx`, `specs/SPEC-SYSTEM-VIEW.md`,
`specs/SPEC-INDEX.md`.

**Hors scope** (traité comme ticket séparé T123, à la demande de l'utilisateur après ce sprint) :
imbrication de composants locaux entre eux — nécessite un changement du modèle de données
(`SystemNode`), explicitement exclu du périmètre de ce ticket.

**Vérification** : `pnpm typecheck` (`apps/desktop`) — 0 erreur, y compris après merge sur
`master`. Testé manuellement dans l'app réelle (projet créé à la volée, build + pilotage
automatisé) : ajout de deux sous-composants locaux, parité visuelle confirmée dans Structure ;
Vue Système en mono-repo à 3 `SystemNode` — combobox plat sans `<optgroup>`, sélection et URL
correctes, combobox Élément bien scopé par sous-composant sélectionné. Le regroupement
`<optgroup>` pour un repo à plusieurs sous-composants locaux **dans un workspace à plusieurs
repos** n'a été vérifié que par lecture de code (pas de submodule git de test monté). Voir
`specs/T120.md`, `specs/T120-design.md`, `specs/T120-sprint1.md`.
**Mergé sur `master`.**

---

### T110 — Source unique du catalogue de rôles, suppression de l'onglet Interfaces

**Évolution** : le mot « rôle » apparaissait à trois endroits sans lien structurel entre eux —
catalogue d'un repo interface (`schema.roles`, édité uniquement depuis l'ancien onglet Interfaces
de `/schema`), rôles joués par un composant implémenteur (`schema.implements[].roles`, texte
libre, déjà dupliqué dans l'onglet Interfaces **et** dans la popup d'édition de dépendance de
Structure), et le champ `roles` d'une exigence (`multi_enum` avec des `values:` codées en dur,
sans lien avec le catalogue). Rien n'empêchait une faute de frappe entre les trois.

**Correctif** : catalogue de rôles devenu source unique, saisi dans une nouvelle section de la
popup d'édition de **tout** nœud dépendance de l'onglet Structure (« Rôles exposés par ce repo »,
`schema.roles`) — pas seulement les nœuds déjà marqués interface, pour qu'un repo puisse le
devenir (`AddDependencyModal.tsx`/`StructureTab.tsx`, sprint 1). Les rôles joués par le parent
deviennent une sélection par cases à cocher parmi ce catalogue (au lieu de texte libre), avec
préservation explicite de tout rôle hérité hors catalogue (badge « hors catalogue », retrait
requis explicitement, jamais purgé silencieusement). Nouvelle section « Interfaces implémentées »
dans la même popup, reprenant l'ancienne section « Implémentations » de l'onglet Interfaces —
résolution en direct du catalogue de l'interface ciblée par nom de montage, cases à cocher si
résolu, texte libre sinon (sprint 2). Le champ `roles` d'une exigence (`multi_enum` nommé
exactement `roles`) source désormais ses options depuis le catalogue du repo courant, avec repli
sur `field.values` si le catalogue est vide — aucune migration de projet existant requise (sprint
3). L'onglet « Interfaces » de `/schema` est supprimé une fois les trois sprints livrés ;
`ProjectSchema.roles`/`.implements` restent inchangés dans le modèle de données.

**Bugs trouvés et corrigés en cours de sprint** (aucun présent dans le design initial) :
1. Le retrait explicite du dernier rôle hérité hors catalogue ne se persistait pas quand le
   catalogue devenait vide — la condition d'écriture côté parent se basait uniquement sur les
   valeurs finales (`/code-review`).
2. `roles: []` était ajouté sans condition au schema.yaml de tout composant édité, même sans
   rapport avec les rôles — contraire à la convention déjà en place ailleurs dans ce fichier
   (`/code-review`).
3. Donner un premier rôle au catalogue d'une interface, sans cocher aucune case « Rôles joués »,
   créait quand même une entrée `implements` vide côté parent — condition issue du design
   lui-même (`catalogRoles.length > 0` comme déclencheur, sans rapport avec les rôles réellement
   joués). **Trouvé uniquement par vérification manuelle dans l'app réelle**, absent des deux
   revues de code précédentes.

**Point non traité, jugé hors scope** : contrairement à la section « Rôles joués » (sprint 1), la
section « Interfaces implémentées » (sprint 2) n'affiche pas séparément un rôle hérité qui ne
correspond à aucune entrée du catalogue résolu — aucune perte de données (le rôle reste dans
`implements[].roles`, jamais réécrit que par ajout/retrait explicite d'un rôle coché), mais
invisible et non gérable depuis cette section tant que le catalogue est non vide. Absent du design
sprint 2 (garde-fou uniquement spécifié pour le sprint 1) ; à traiter dans un futur ticket si un
projet réel le rencontre.

**Fichiers modifiés** : `apps/desktop/src/renderer/components/schema/AddDependencyModal.tsx`,
`apps/desktop/src/renderer/components/schema/StructureTab.tsx`,
`apps/desktop/src/renderer/components/system/EditView.tsx`,
`apps/desktop/src/renderer/routes/schema.tsx`, `specs/SPEC-TEMPLATES.md`,
`specs/SPEC-REQ-requirements.md`, `specs/SPEC-INDEX.md`.

**Vérification** : `pnpm --filter @polenta/desktop typecheck` — 0 erreur à chaque sprint. Testé
manuellement dans l'app réelle (build + pilotage automatisé Playwright `_electron`) à chaque
sprint sur des workspaces jetables dédiés — catalogue de rôles, rôles joués (cases à cocher +
retrait hors catalogue), interfaces implémentées (résolution catalogue/pin en direct), champ
`roles` d'exigence (catalogue + repli sur `values:` codées en dur), disparition de l'onglet
Interfaces. Voir `specs/T110.md`, `specs/T110-design.md`, `specs/T110-tests.md`,
`specs/T110-sprint1.md`, `specs/T110-sprint2.md`, `specs/T110-sprint3.md`.

---

### T122 — Serveur MCP pour agents IA : imports massifs + modification du modèle de données

**Évolution** : donner aux agents IA externes (Claude Code, Cursor, Codex, Copilot,
Gemini CLI…) une interface programmatique sur un projet Polenta, en couche fine
au-dessus du noyau de services partagé (`main/services/*`, sans duplication) —
jusqu'ici un agent devait lire/écrire les YAML à la main, réimplémentant lui-même la
génération d'ID, la résolution d'`objectTypeRef`, la validation des champs requis, et
s'exposant sans le savoir au bug de collision d'ID (T118) sur un import rapproché.

**Réalisé (4 sprints)** :
- **Sprint 1** : squelette du serveur MCP stdio (`apps/desktop/src/mcp-server/`),
  point d'entrée exécutable (`--repo`/`--workspace`, repli env vars), DI headless
  réutilisant exactement les classes de `main/container.ts` (sans
  `RepoWatcherService` ni les services hors périmètre), 4 tools de lecture
  (`get_schema`, `list_requirements`, `list_tests`, `list_campaigns`, résultats
  plafonnés à 200 objets avec `truncated`/`total`).
- **Sprint 2** : 3 tools d'import massif (`bulk_import_requirements`/`_tests`/
  `_campaigns`) avec `dryRun` obligatoire par défaut (aperçu des IDs prévisionnels +
  erreurs, sans écriture) et écriture réelle en série best-effort en `dryRun: false`
  (jamais `Promise.all` — l'ordre conditionne les IDs T118) ; validation par entrée
  (`objectTypeRef` résolu, nœud pas `readonly`, champs requis, syntaxe EARS si
  `validator: EARS`) ; nouveau `peekNextCounterId` (lecture seule) dans
  `id-counter.util.ts`. Bug critique trouvé et corrigé en revue : le refus `readonly`
  ne s'appliquait pas quand le type résolu était `'unresolvable'` (forme normale d'un
  nœud submodule non inliné) — corrigé avant tout commit.
- **Sprint 3** : 5 tools de mutation ciblée du schéma (`add_component`,
  `add_object_type`, `add_field`, `add_status`, `add_link_type`), nouvelles méthodes
  `SchemaService` (`get → valide → copie immuable → save`, jamais d'écriture si un
  invariant est violé — nom déjà pris, `prefix` unique projet-wide règle 10 CLAUDE.md,
  nœud `readonly`), erreurs structurées (`SchemaValidationError` → `isError: true`,
  jamais une exception de protocole). Sérialisation par `repoPath`
  (`withMutationQueue`, même classe de bug/remède que T118) ajoutée en revue.
- **Sprint 4** : `AGENTS.md` (mentionne désormais le serveur MCP) et `.mcp.json`
  générés à la création d'un projet (committés par le commit initial) ; **périmètre
  étendu en cours de ticket** (absorbe T121) : vérification/régénération automatique
  des deux fichiers à **chaque ouverture** d'un projet existant, basée sur un
  marqueur de version embarqué (absent/périmé → régénéré intégralement ; à jour →
  aucune écriture, mtime/hash inchangés) — pas un merge de contenu, une régénération
  réelle écrase les notes ajoutées par l'utilisateur. Packaging : bundle esbuild
  autonome (`electron` alias-é vers un shim jamais réellement invoqué, `keytar`
  externalisé), copié hors `app.asar` via `extraResources`, lancé en build packagé via
  le binaire Electron en mode `ELECTRON_RUN_AS_NODE` (pas de dépendance à un Node.js
  système). Nouveau `specs/SPEC-MCP-SERVER.md` documentant le point d'entrée, les 12
  tools (contrats entrée/sortie), le packaging et le mécanisme de génération.

**Garde-fous respectés** (vérifiés manuellement à chaque sprint) : aucun tool ne
committe/push automatiquement ; les nœuds `readonly: true` sont refusés en écriture
(import massif et mutation de schéma) ; dry-run obligatoire par défaut sur l'import
massif.

**Hors scope** (assumé, documenté dans `specs/T122.md`/`SPEC-MCP-SERVER.md` §7) :
CLI et résurrection de `apps/api` ; enforcement en dur des règles de cohérence
`CLAUDE.md` au-delà de la validation EARS des champs `validator: EARS` ; suppression/
modification en masse ; création de composant en repo séparé (submodule) via MCP ;
éditeur de conflit 3-way pour la régénération d'`AGENTS.md`/`.mcp.json` ; build
`electron-builder` complet (installeur réel) non exécuté dans cet environnement.

**Limitations connues documentées** (non bloquantes, cf. `SPEC-MCP-SERVER.md` §7) :
mode mono-repo par défaut (un `objectTypeRef` vers un vrai composant submodule
retombe silencieusement sur le repo produit sans `--workspace`) ; scan d'unicité de
`prefix` (`add_object_type`) limité au repo courant, pas workspace-wide ; `readonly`
non vérifié dans les services `create()` eux-mêmes (garde ajoutée uniquement côté
validation MCP) ; repli silencieux de `SchemaService.readFromDisk()` sur
`DEFAULT_SCHEMA` en cas de YAML illisible, désormais exploité par des écritures
autonomes.

**Vérification** : `pnpm typecheck` propre à chaque sprint (0 erreur). Revue de code
inline (skill `code-review`) à chaque sprint, tous les points relevés corrigés ou
documentés explicitement. Vérification manuelle bout-en-bout à chaque sprint via un
vrai client MCP (`@modelcontextprotocol/sdk`) et/ou l'app desktop réelle pilotée
(skill `run-desktop`), toujours sur des copies jetables de
`C:\Dev\polenta-demo\aspirateur-demo` (jamais l'original) — création/import massif/
mutation de schéma/génération et régénération d'`AGENTS.md`/`.mcp.json` tous exercés
avec succès, y compris la connexion d'un vrai client à la commande exacte générée
dans `.mcp.json`. T121 retiré de `TICKETS.md` (absorbé par ce ticket). Voir
`specs/T122.md`, `specs/T122-design.md`, `specs/T122-tests.md`,
`specs/T122-sprint1.md`, `specs/T122-sprint2.md`, `specs/T122-sprint3.md`,
`specs/T122-sprint4.md`, `specs/SPEC-MCP-SERVER.md`.
**Validé par l'utilisateur, mergé sur `master`.**

---

### T115 — Uniformisation du style des boutons (bouton "Publier" comme référence)

**Évolution** : les boutons de l'app desktop avaient des styles hétérogènes (bordures,
couleurs, tailles) accumulés au fil des tickets, sans profil commun — contrairement au
bouton "Publier" qui servait de référence implicite sans être formalisé.

**Correctif** : 6 profils de classes CSS dans `index.css` — `.btn-primary`/`.btn-secondary`/
`.btn-danger`, chacun décliné en taille standard et compacte (`-sm`), plus `.btn-icon` et
`.btn-close` pour les boutons icône seule et de fermeture de modale. "Publier" reste
`.btn-primary-sm`, avec `shadow` comme seul override toléré dans toute l'app (vérifié par
grep). Sprint 1 : migration d'environ 50 sites vers les 6 profils colorés. Sprint 2 :
`.btn-icon`/`.btn-close` (VersionPanel ×4, TestsPanel, RequirementsPanel,
ReorderableSidebarSection, 2 modales d'édition) et remplacement de 3 liens-action
hardcodés en bleu (`text-blue-600`) par le token de thème `text-prim`.

**Hors scope** (acté en Design, non traité) : éléments de menu déroulant/contextuel à
action discrète et lignes de sélection de combobox/liste (~25-30 sites hétérogènes) — à
considérer comme ticket de suivi séparé si souhaité. Deux boutons icône à état conditionnel
(`baseline.tsx:121`, `VersionImpactSelector.tsx:247` — couleur au survol pilotée par
`group-hover`/`isActive`) volontairement non migrés vers `.btn-icon` (pas de simples
variantes de couleur statique).

**Fichiers modifiés** : `apps/desktop/src/renderer/index.css` et ~60 sites de `className`
à travers composants/routes (voir `specs/T115-sprint1.md`/`T115-sprint2.md` pour la liste
complète) ; `specs/SPEC-ELECTRON-DESKTOP.md` (nouvelle §19.14 Système de classes de
boutons), `specs/SPEC-INDEX.md`.

**Vérification** : `pnpm typecheck` (`apps/desktop`) — 0 erreur à chaque sprint et après
merge sur `master`. Aucune modification de logique métier (diff limité à `index.css` et
aux `className`). Testé manuellement dans l'app réelle (projet créé à la volée, build +
pilotage automatisé) après merge : bouton "Publier" confirmé seul à porter `shadow` parmi
tous les `.btn-primary-sm` (comparaison directe avec "Ajouter un widget" au DOM), les 4
boutons `.btn-icon` du panneau Version rendus identiques. Vérification complète des 20
scénarios de `specs/T115-tests.md` par grep + revue de code à chaque sprint (cf.
`T115-sprint1.md`/`T115-sprint2.md`) ; sous-ensemble golden path re-testé visuellement
après merge (schéma de test minimal, pas d'exigences/tests/campagnes montés). Voir
`specs/T115.md`, `specs/T115-design.md`, `specs/T115-tests.md`, `specs/T115-sprint1.md`,
`specs/T115-sprint2.md`.
**Validé par l'utilisateur, mergé sur `master`.**

---

### T111 — Internationalisation (i18n) de l'interface Polenta

**Évolution** : ajouter la gestion des langues de l'UI de l'outil (menus, boutons,
libellés, messages) — pas le contenu métier (`statement`, `rationale`, texte des
exigences/tests, hors périmètre). Jusqu'ici l'interface était entièrement en français
codé en dur dans le JSX, sans bibliothèque i18n ni fichier de traduction. Réglage par
poste (comme le thème clair/sombre, `ThemeContext.tsx`), sans dépendance compte/projet.

**Réalisé (4 sprints, ~150 fichiers renderer couverts)** :
- **Sprint 1** : infrastructure `react-i18next`/`i18next`
  (`i18n/{index.ts,useLocale.ts,locales/{fr,en}.json}`), sélecteur de langue dans
  `AccountPanel.tsx` (bascule immédiate, pas de rechargement de fenêtre), persistance
  `localStorage:polenta:locale`, défaut français. Coquille applicative (layout, tab bar,
  comptes, préférences, accueil) migrée — 107 clés. `contexts/TabsContext.tsx` (titres
  d'onglets par défaut) ajouté au périmètre en cours de sprint, trouvé en revue : sans ce
  correctif tout nouvel onglet ouvert en anglais affichait un titre français.
- **Sprint 2** : panneaux latéraux (Projet, Dashboard, Exigences, Recherche, Système,
  Tests, Version) et popups d'édition Structure/Modèle de données — 378 clés au total.
  Deux bugs de pluralisation à la main (`!== 1 ? 's' : ''`) trouvés et corrigés en
  `_one`/`_other` i18next.
- **Sprint 3** : Vue Système complète (Excel/Document/Édition, exigences/tests/
  campagnes, exécution de test) — 535 clés au total. Bug de shadowing de la variable `t`
  (boucle `.map(t => ...)` masquant le `t` de traduction) trouvé par `pnpm typecheck`
  (`TS2349`) ; récidive de l'anti-pattern de pluralisation corrigée une deuxième fois.
- **Sprint 4 (final)** : Dashboards/widgets, éditeur de requêtes, export, analyse
  d'impact, baselines, arbre de versions (`/graph`, menu contextuel complet), diff, et
  les 7 routes `print.*.tsx` (rendu des exports PDF) — 782 clés au total. Bug d'espace de
  nommage trouvé en revue (14 sites référençant `dashboard.*` au lieu de
  `dashboardPage.*`, aucune erreur `tsc` puisque ce sont de simples chaînes) ;
  récidive de l'anti-pattern de pluralisation une troisième fois (7 clés, dont une
  combinant deux quantités indépendantes en une seule clé — scindée en deux) ; deux vues
  imprimables affichaient des valeurs d'énumération brutes (`node.status`,
  `req.changeType`, table `TEST_RUN_STATUS_LABELS` codée en dur) au lieu des tables de
  clés déjà utilisées par les vues interactives équivalentes ; centralisation du mapping
  locale→tag `Intl` (`toIntlLocale()`) après duplication du même ternaire dans 3
  fichiers, trouvée indépendamment par deux angles de revue. `specs/SPEC-I18N.md` créé
  (architecture, convention des clés, périmètre traduit/non traduit, contrôle de
  non-régression) et `SPEC-INDEX.md` mis à jour.

**Convention établie et tenue sur les 4 sprints** : config module-scope (tableaux/objets
hors composant React) stocke des clés de traduction jamais des littéraux résolus ;
pluriels toujours via `_one`/`_other` (jamais de ternaire fait main) ; `<Trans>` +
composant custom pour préserver du style inline (`<strong>`/`<code>`) sur une valeur
interpolée ; statuts de schéma projet (`schema.yaml`) et contenu métier saisi par
l'utilisateur jamais traduits (donnée, pas UI) — à distinguer des énums TS fixes
(`TestRunStatus`, `ImpactAnalysisStatus`, `RequirementChangeType`) qui sont de l'UI
Polenta et doivent l'être. Menu natif Electron non touché (hors scope du ticket).

**Vérification** : `pnpm typecheck` propre après chaque sprint. Script de contrôle de
parité des clés `fr.json`/`en.json` exécuté après chaque lot de fichiers et en
validation finale de chaque sprint (782/782 à l'issue du sprint 4, aucune divergence) ;
script de résolution vérifiant que chaque `t()`/`i18nKey` référencé dans le code
correspond à une clé réellement présente dans le dictionnaire. `/code-review` (8 angles)
exécuté sur le diff complet de chaque sprint, tous les findings CONFIRMED corrigés avant
commit ; findings PLAUSIBLE documentés et explicitement non actionnés quand l'action
aurait changé silencieusement du texte visible préexistant ou relevait d'un
refactoring hors périmètre d'une extraction de chaînes pure. Non testé interactivement
dans l'environnement de développement (pas d'affichage Electron attachable) — vérification
statique uniquement à chaque sprint, en attente de validation manuelle humaine bout-en-
bout (bascule FR/EN sur l'app réelle) avant merge. Voir `specs/T111.md`,
`specs/T111-design.md`, `specs/T111-tests.md`, `specs/T111-sprint1.md`,
`specs/T111-sprint2.md`, `specs/T111-sprint3.md`, `specs/T111-sprint4.md`,
`specs/SPEC-I18N.md`. **Implémentation complète sur la branche `T111` — en attente de
revue et de merge vers `master` par l'utilisateur.**

---
