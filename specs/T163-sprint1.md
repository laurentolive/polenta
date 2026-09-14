# T163 — Sprint 1 (unique)

Réf. : `specs/T163.md`, `specs/T163-design.md`, `specs/T163-tests.md`.

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `apps/desktop/src/renderer/lib/staticDrawio.ts` | **Nouveau.** `computeDrawioLayout()` (fonction pure, géométrie crop/taille répliquée de `ResizableMediaFrame` mode non-éditable) + `renderStaticDrawio(placeholder, repoPath)` : lit les `data-drawio-*` du placeholder, `api.drawio.read` → `resolveDrawioTarget` → `loadDrawioViewer` → `GraphViewer.createViewerForElement`, construit `outer > inner > .mxgraph` + overlay transparent, mesure via `ResizeObserver` (content-box) et applique l'échelle/le décalage. Renvoie un teardown qui annule l'async en vol, coupe le `ResizeObserver` et démonte le graphe (`graph.destroy()`). |
| `apps/desktop/src/renderer/lib/staticRichText.tsx` | Fence `drawio` : émet `<span class="static-drawio" data-drawio-*>` (avec `min-width`/`min-height` = dims stockées pour réserver la place) enveloppant le badge `📐 label` de repli ; contenu non-JSON → `''` (comme avant). Nouvel `useEffect` : `IntersectionObserver` (root = conteneur défilant le plus proche, `rootMargin: 300px`) qui monte le viewer à la 1ʳᵉ intersection puis `unobserve` ; teardown complet (flag `disposed`, `io.disconnect()`, tous les teardowns de diagramme). |
| `apps/desktop/src/renderer/lib/drawioViewerLoader.ts` | **Ajout** `inlineDrawioViewerConfig(xml)` : valeur `data-mxgraph` partagée (la garde « jamais de clé `toolbar` » y est désormais documentée une seule fois). |
| `apps/desktop/src/renderer/tiptap/DrawioEmbedView.tsx` | Utilise `inlineDrawioViewerConfig(page.xml)` au lieu du JSON inline (comportement identique). |
| `apps/desktop/src/renderer/tiptap/mediaAttrs.ts` | **Ajout** `parseDrawioFencePayload(raw)` + type `DrawioFencePayload` : parsing partagé du contenu d'un bloc ```` ```drawio ````. |
| `apps/desktop/src/renderer/tiptap/DrawioEmbedExtension.ts` | `parse.setup` utilise `parseDrawioFencePayload` (supprime ~15 lignes de parsing dupliqué ; `width`/`height` désormais validés `> 0` finis — durcissement sans effet visible). |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | Section `system.richTextViewer` : `drawioNotFound`, `drawioInvalid` (`{{path}}`). |
| `specs/SPEC-REQ-requirements.md` | §3.2a : nouveau point « Rendu en lecture, Vue Word » (viewer paresseux, `IntersectionObserver`, une fois, taille/crop restitués, clic → édition). §3.2b : précision « la règle porte sur l'interaction d'édition, pas la présence du diagramme ». |
| `specs/SPEC-SYSTEM-VIEW.md` | §"Vue Word" : note sur `StaticRichTextViewer` + diagrammes paresseux. |
| `specs/SPEC-INDEX.md` | MAJ → `T163` pour `SPEC-REQ §3` et `SPEC-SYSTEM-VIEW §global` (+ mots-clés). |

## Comportement implémenté

- Vue Word en lecture : chaque bloc `drawio` d'un champ `richtext` affiche le vrai
  diagramme (moteur mxGraph vendoré), rendu quand il approche à 300 px du bord du
  conteneur défilant, une seule fois (pas de rechargement au focus fenêtre).
- Taille (`width`/`height`) et cadrage (`crop`) stockés restitués à l'identique de
  la Vue Édition (même formule que `ResizableMediaFrame`). La place est réservée
  sur le placeholder quand les dims sont connues → pas de saut du document au
  défilement pour ces diagrammes.
- Clic sur le diagramme : `pointer-events:none` sur le sous-arbre viewer +
  overlay transparent sans gestionnaire → le clic remonte au `onClick` du champ,
  qui passe en édition (le `DrawioEmbedView` interactif prend le relais).
- Ancre `nodeId` : page ou page-contenant-la-cellule affichée (surlignage de
  cellule **non implémenté** en v1 — QO1).
- Erreurs : `repoPath` absent → badge `📐 label` ; fichier introuvable / XML
  invalide / échec chargement viewer → message inline discret
  (`system.richTextViewer.drawioNotFound` / `drawioInvalid`). Jamais de crash ni
  d'`unhandledrejection`.
- Hors périmètre inchangés : `RichTextViewer` (routes campagne), Vue Tableau
  (aperçu 1 ligne), Vue Édition.

## Divergences / compléments par rapport au design

Issus des tours de `/code-review` (5 tours, findings corrigés) :

1. **QO2 revisité** : un léger étalement (`requestAnimationFrame` avant chaque
   `createViewerForElement`) a été ajouté — pas la file coordonnée écartée par
   QO2, juste une politesse d'ordonnancement quand plusieurs diagrammes entrent
   ensemble dans le viewport.
2. **`root` de l'IntersectionObserver** : finalement le conteneur défilant le
   plus proche (détecté générique­ment via `overflow-y`), pas le viewport (QO3) —
   sinon la marge de préchargement est inefficace quand le défilement a lieu dans
   une sous-`div` `overflow-auto` (cas de la Vue Word).
3. **Fuite viewer** : le `GraphViewer` vendoré n'a pas de `destroy()` et
   s'enregistre auprès d'un `MediaQueryList` sans jamais se retirer. Le teardown
   appelle `graph.destroy()` (libère le graphe mxGraph, sa vue, ses handlers) et
   nulle `viewer.graph` — traitement plus complet que `DrawioEmbedView` (qui ne
   fait rien de tel). `inner` reçoit une largeur explicite dès le départ pour que
   `GraphViewer.checkVisibleState` crée le graphe **synchrone­ment** (sinon le
   graphe naît via un `MutationObserver` interne, potentiellement après le
   teardown → orphelin).
4. **Pas de cache de lecture** : un cache module-level `api.drawio.read` avait été
   ajouté puis retiré — il générait plus de surface de cycle de vie (rétention,
   contamination d'erreur transitoire, résolution groupée) que le coût qu'il
   évitait (quelques ms de lecture fichier, étalés sur le défilement).
5. **Fichiers hors des 2 prévus** : `drawioViewerLoader.ts`, `DrawioEmbedView.tsx`,
   `mediaAttrs.ts`, `DrawioEmbedExtension.ts` — tous pour **mutualiser** (config
   viewer, parsing du payload) au lieu de tripler le code. Changements mécaniques,
   couverts par le typecheck.

Limite mineure connue : un diagramme **sans** `width`/`height`/`crop` (taille
auto) ne peut pas réserver sa place → léger décalage du document quand il se rend
au défilement (le composant live a le même comportement transitoire : 400×300
puis recalage).

## Vérifications

- `pnpm --filter @polenta/desktop typecheck` : **OK** (0 erreur).
- `turbo typecheck` (monorepo) : **OK** (4/4).
- Lint : aucun runner configuré dans le repo (`turbo lint` ne cible que les
  `packages/*`, aucun n'a de règle draw.io) — non applicable.
- Tests automatiques : aucun runner (ni vitest ni jest) dans le repo — validation
  par les scénarios manuels de `T163-tests.md`.

## Comment tester manuellement

Voir `specs/T163-tests.md`. En résumé :
1. Projet avec repo + un type d'objet à champ `richtext` visible en Vue Word +
   des `.drawio` dans `diagrams/`.
2. Insérer des blocs draw.io variés dans des descriptions (simple, avec
   `nodeId` page, redimensionné, rogné, fichier inexistant, champ multi-contenu).
3. Vue Word : scroller — les diagrammes se rendent à l'approche du bord, à la
   bonne taille/cadrage ; cliquer dessus → passe en édition.
4. Sur PL/Product (~280 items) : ouvrir l'onglet Document, vérifier l'absence de
   gel et que seuls les diagrammes visibles déclenchent `api.drawio.read`
   (DevTools).
5. Fichier `.drawio` supprimé → message d'erreur inline, pas de crash.
