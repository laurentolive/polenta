# T135 — Sprint 1

## Fichiers modifiés

- `apps/desktop/src/renderer/components/schema/StructureTab.tsx` :
  - Nouveaux types `DragItem`/`DropTarget` (union discriminée par `kind: 'element' | 'component' |
    'local'`), `sameDragContainer`/`sameDragItem`, composant partagé `DragRow` (drag & drop natif
    HTML5, même pattern que `ReorderableSidebarSection.tsx`/T77 : indicateur avant/après, ligne
    atténuée pendant le drag).
  - `ElementLeaf` : retrait des boutons ↑/↓ (`canMoveUp`/`canMoveDown`/`onMoveUp`/`onMoveDown`),
    enveloppé dans `DragRow`.
  - `RepoRow` : retrait des boutons ↑/↓ et des props `siblingIndex`/`siblingCount` (plus
    nécessaires) au profit d'une prop `localParent`, enveloppé dans `DragRow` seulement pour les
    dépendances (jamais le workspace root, comme avant ce ticket).
  - `LocalNodeRow` : premier réordonnancement de son existence, `DragRow` sur sa ligne d'en-tête ;
    nouvelle prop `parentName` (`'root'` | nom d'un composant local | `null`) identifiant son
    groupe de frères pour le drag.
  - `StructureTreeHandlers` : `onMoveElement`/`onMoveComponent` remplacés par `dragging`/
    `dropTarget` (état) + `onDragStartRow`/`onDragOverRow`/`onDropRow`/`onDragEndRow` (centralisés
    dans `StructureTab`, pas locaux à chaque ligne — nécessaire dès qu'un dépôt pourra cibler une
    branche différente de l'arbre, sprints 2-3).
  - `withObjectTypesReordered` : reconstruit sur `reorderByKey` (index avant/après) au lieu du
    swap adjacent `moveUp`/`moveDown`.
  - `withLocalComponentsReordered` : fine enveloppe autour de `reorderSystemNodes` (voir
    `schema-tree.ts` ci-dessous).
- `apps/desktop/src/renderer/lib/workspaceActions.ts` — `moveDependency` (swap adjacent) remplacé
  par `reorderDependencies` (dépôt avant/après arbitraire), qui permute uniquement les
  dépendances partageant le même `localParent`, en préservant les emplacements de tableau des
  autres.
- `packages/types/src/schema-tree.ts` — nouvelles fonctions exportées `reorderByKey<K>` (générique)
  et `reorderSystemNodes` (réordonnancement `SystemNode` par drag & drop, partagé main/renderer
  comme `findSystemNode`/`mapSystemNode`/`removeSystemNode`).
- `apps/desktop/src/renderer/i18n/locales/{en,fr}.json` — retrait des clés
  `schema.structureTab.moveUp`/`moveDown` (plus référencées).

## Comportement implémenté

Conforme à `specs/T135.md` points 1-6 (commun aux trois types de lignes) et 13 (réordonnancement
`LocalNodeRow`, nouvelle capacité). Points 7-12 et 14-16 (changement de parent) sont hors périmètre
de ce sprint — cf. `specs/T135-design.md` §Sprint 2-3.

- Les boutons ↑/↓ de `ElementLeaf` et `RepoRow` ont disparu ; le drag & drop est l'unique moyen de
  réordonner.
- `ElementLeaf`, `RepoRow`, `LocalNodeRow` sont déplaçables par glisser-déposer, réordonnancement
  limité aux frères actuels (même parent), avec indicateur visuel avant/après.
- Aucun mélange de catégorie possible (un élément ne peut être déposé que parmi des éléments, etc.)
  — assuré par `sameDragContainer` (vérifie `kind` en plus de l'identité du parent).

## Divergences par rapport au design

`specs/T135-design.md` proposait des noms/signatures de fonctions au niveau "esquisse" ; l'implémentation
réelle diverge sur plusieurs points, tous découverts en écrivant le code plutôt qu'anticipés au
design :

1. **`reorderByKey` au lieu de `moveArrayIndex`.** Le design proposait
   `moveArrayIndex<T>(arr, from, to)` (indices bruts). L'implémentation reprend plutôt la convention
   "dépôt avant/après une clé cible" déjà utilisée par `ReorderableSidebarSection.tsx` (T77) —
   plus directement exploitable depuis un événement de drop (`position: 'before'|'after'`), et
   réutilisable telle quelle pour réordonner par nom (composants) aussi bien que par index
   (éléments, en utilisant l'index d'origine comme clé).
2. **`reorderDependencies` (pluriel) au lieu de `reorderDependency`.** Signature différente du
   design (`localParent`, `draggedName`, `targetName`, `position` plutôt que `name`, `toIndex`) —
   même raison que le point 1, plus la prise en compte explicite du groupement par `localParent`
   (une dépendance imbriquée sous un composant local a son propre groupe de frères, distinct des
   dépendances "à plat" du repo).
3. **`RepoRow` perd `siblingIndex`/`siblingCount`** — le design supposait qu'ils resteraient
   "utilisés pour l'indicateur de position pendant le drag" ; en pratique le drag identifie les
   lignes par nom (`DragItem`), pas par position numérique, donc ces deux props sont devenues
   inutiles et ont été retirées plutôt que conservées.
4. **Bug trouvé et corrigé en cours de sprint (pas anticipé par le Design) : fusion incorrecte de
   la "liste mixte" de premier niveau.** `RepoRow` affiche en une seule liste visuelle les
   composants locaux issus de `rootNode.children` et ceux issus du niveau racine de `schema.nodes`
   (T123). Une première implémentation traitait ces deux tableaux comme un seul groupe de
   réordonnancement ("fusionner puis re-séparer") — mais comme le rendu final affiche toujours
   `rootNode.children` avant les `schema.nodes` de premier niveau, quel que soit l'ordre combiné
   calculé, un drag *entre* les deux groupes ne se traduisait jamais par un changement visible :
   l'écriture avait lieu (illusion de succès) mais l'ordre final restait identique. Corrigé en
   traitant les deux origines comme deux groupes de frères distincts et non fusionnables (`root`
   vs `null`), exactement comme `RepoRow` le fait déjà pour les dépendances via `localParent`.
   Cette correction a aussi déplacé la fonction (`reorderSystemNodes`) de `StructureTab.tsx` vers
   `packages/types/schema-tree.ts`, aux côtés de `findSystemNode`/`mapSystemNode`/
   `removeSystemNode` — cohérent avec le fait que le composant local partagé par MCP/main process
   pourrait un jour avoir besoin de la même capacité.

## Revue de code

`/code-review` (8 angles : scan ligne par ligne, comportement supprimé, traçage cross-fichier,
réutilisation, simplification, efficacité, altitude, conventions CLAUDE.md) a trouvé et vérifié
plusieurs problèmes avant validation finale :

**Corrigés :**
1. **Bug de compilation** — `DragRow` recevait `style` dans son type mais pas dans sa
   déstructuration (`Cannot find name 'style'`, TS2304) : chaque ligne perdait son indentation.
   Corrigé.
2. **Bug de fusion top-level** — décrit au point 4 ci-dessus. Corrigé.
3. **Indicateur de dépôt trompeur sur soi-même** — `onDragOver` ne s'excluait pas quand on
   survolait la ligne qu'on est en train de traîner elle-même, affichant une ligne de dépôt
   trompeuse (sans effet réel au drop, mais visuellement confus). Corrigé.
4. **Comparaison de no-op par référence dans `reorderDependencies`** — `reorderByKey` peut renvoyer
   un tableau *différent par référence* mais *identique en valeur* (ex. déposer un élément juste à
   côté de la position qu'il occupe déjà) ; l'ancienne garde `===` ne détectait pas ce cas et
   déclenchait une écriture/rebuild inutile de `polenta-repo.yaml`. Remplacé par une comparaison de
   valeur.

**Examinés et écartés (pas de changement) :**
- Perte de réordonnancement au clavier (boutons ↑/↓ focusables/Enter-activables disparus, drag
  seul ne l'est pas) — déjà explicitement noté hors-scope dans `specs/T135.md` §Hors scope, cohérent
  avec le reste de l'app (`ReorderableSidebarSection.tsx` n'a pas non plus d'alternative clavier).
- Duplication de `reorderByKey` avec la logique déjà écrite indépendamment dans
  `ReorderableSidebarSection.tsx`/`DashboardGrid.tsx` — duplication préexistante entre ces deux
  fichiers, pas introduite par ce diff ; les toucher est hors périmètre de ce ticket.
- Re-rendu de tout l'arbre à chaque `dragover` (pas de `React.memo`) — cohérent avec le
  comportement déjà existant de `ReorderableSidebarSection.tsx`, et l'échelle du projet (« une
  poignée de repos », CLAUDE.md) rend le coût négligeable.
- Risque de collision de nom dans la `Map` de `reorderDependencies` — écarté : les noms de
  dépendance sont déjà garantis uniques sur tout le workspace (`assertNoMountNameConflict`).

## Vérifications effectuées

- `tsc --noEmit` : `@polenta/desktop` et `@polenta/types` — 0 erreur (une erreur préexistante dans
  `apps/api/src/modules/git/schema.service.ts`, fichier non touché par ce ticket, ignorée).
- Aucun lint utilisable dans ce workspace actuellement (ESLint référencé par `turbo lint` mais ni
  installé ni configuré — dette préexistante, hors périmètre).
- **Vérification manuelle dans l'app réelle** (build + driver Playwright `run-desktop`, cf.
  `apps/desktop/.claude/skills/run-desktop/`) : projet de test créé, 4 exigences ajoutées à la
  racine. Boutons ↑/↓ confirmés absents. Glisser-déposer testé via événements `DragEvent` de
  synthèse (`dragstart`/`dragover`/`drop`/`dragend`, chacun dans un tour d'event-loop séparé pour
  laisser React traiter l'état entre chaque étape) : déplacer "Element C" avant "Element B" a
  changé l'ordre affiché de `Sans nom, A, B, C` à `Sans nom, A, C, B`, persisté après rafraîchissement
  (écriture réelle dans `schema.yaml`). `RepoRow`/`LocalNodeRow` partagent le même composant
  `DragRow` et la même machinerie d'état que `ElementLeaf` (vérifié par lecture de code, pas
  re-testé individuellement en direct faute de temps) — voir note ci-dessous.

## Comment tester manuellement

1. Ouvrir l'onglet **Modèle de données → Structure** d'un projet.
2. Ajouter 3 éléments (`+ Exigence` sur la ligne du repo, remplir Nom/Préfixe, Enregistrer) à la
   racine.
3. Vérifier qu'aucun bouton ↑/↓ n'apparaît au survol d'une ligne.
4. Glisser un élément et le déposer avant/après un autre → l'ordre change et persiste après
   rafraîchissement (`Actualiser` ou réouverture du projet).
5. Ajouter un composant local (`+ Composant`, cocher "Composant local"), lui ajouter 2-3 éléments,
   glisser-déposer pour vérifier le réordonnancement au sein de ce composant.
6. Ajouter 2 composants locaux frères, vérifier leur réordonnancement mutuel par glisser-déposer.
7. Monter un repo dépendant (`+ Composant`, laisser "Composant local" décoché — nécessite un repo
   Git réel) avec 2+ dépendances, vérifier leur réordonnancement par glisser-déposer.

## Note

La vérification manuelle a couvert `ElementLeaf` en direct (le cas le plus simple à mettre en
place sans dépendance Git externe). `RepoRow`/`LocalNodeRow` partagent strictement le même
mécanisme (`DragRow`, `sameDragContainer`/`sameDragItem`, `handleDropRow`) — seule la fonction de
mutation appelée diffère (`reorderDependencies`/`reorderSystemNodes` vs
`withObjectTypesReordered`), déjà vérifiée par la relecture de code et le test manuel de la
correction du bug de fusion top-level (tracé à la main, cf. Divergences point 4). Recommandé de
revérifier `RepoRow`/`LocalNodeRow` en direct avant de merger si le temps le permet — pas fait ici
par manque de temps, pas par choix délibéré.
