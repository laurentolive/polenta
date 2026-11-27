# GH463 — Design

Spec validée : `specs/GH463.md` (décisions : bouton en tête ; élément inséré en tête de liste ; filtre
effacé pour révéler le nouvel élément).

## Flux après changement

1. Clic sur « + Nouvel élément » (en tête de l'arbre, collé en haut) → menu Élément / Dossier / Coller,
   comme aujourd'hui.
2. « Élément » → `ElementTree.createItem(null, null, 'item', top = true)` : nœud inséré en tête
   (`treeInsertAtBeginning`), sélectionné dans l'arbre, titre en édition 50 ms après, puis
   `onItemNodeAdded(id, undefined, { reveal: true })`.
3. `SystemViewContext.createItemObject(id, undefined, { reveal: true })` :
   - dès l'appel, avant l'API : `setFilter('')` (filtre global effacé ; la barre de filtre est contrôlée
     par le contexte) et `setFiltersResetSeq(n + 1)` (signal pour les filtres de colonne du Tableau). Fait
     tout de suite, pour que le nœud et son titre en édition (ouvert 50 ms après l'insertion) soient visibles ;
   - l'objet est créé, son `objectId` posé sur le nœud (`setRoot`), puis `requestGoto(id, objectId)` :
     `item` dans l'URL (REPLACE) et cible `gotoNodeId`/`gotoSeq`.
4. Vue de droite : `ExcelView` sélectionne (l.1409) et défile (l.1972) ; `WordView` reçoit la même cible.

## Fichiers touchés

| Fichier | Changement |
|---|---|
| `components/system/ElementTree.tsx` | Bouton déplacé de la fin (l.1063) vers la tête du conteneur, `sticky top-0` sur fond `bg-surface` (comme la barre de filtre). `addMenu.top`, `openAddMenuNear(…, top)`, `createItem(…, top)`, type de `onItemNodeAdded` avec `options?`. |
| `contexts/SystemViewContext.tsx` | `createItemObject(nodeId, src?, options?)` ; `requestGoto(nodeId, knownObjectId?)` ; état `filtersResetSeq` exposé ; types. |
| `components/system/SystemView.tsx` | Passe `filtersResetSeq` à `ExcelView`. |
| `components/system/ExcelView.tsx` | Prop `filtersResetSeq` ; effet qui appelle `colFilters.clear()` quand la valeur change, avec une ref de la dernière valeur vue (pas d'effacement au montage). Type de `onItemNodeAdded`. |
| `components/grid/useColumnFilters.ts` | `clear()` : remet les filtres de colonne à `{}` (mode local et contrôlé). |

`hooks/useTreeState.ts` : inchangé (`treeInsertAtBeginning` existe, l.104).

## Points de vigilance

- **`rootRef` périmé** (`SystemViewContext.tsx:622-623`, mis à jour par `useEffect`) : juste après
  `setRoot`, `requestGoto(nodeId)` lirait `objectId` undefined et ne ferait rien. D'où `knownObjectId`.
- **Périmètre `reveal`** : seul le bouton du haut passe `reveal: true`. Clic droit sur zone vide,
  « + » d'interstice, coller : inchangés (pas de sélection, filtre conservé).
- **Dossier depuis le menu du haut** : placé en tête lui aussi (même menu, même bouton). Pas de sélection
  (un dossier n'a pas d'objet).
- **Filtres de colonne et montage** : `ExcelView` est remonté à chaque changement de vue. Sans la ref de
  la dernière valeur vue, l'effet remettrait les filtres à zéro au montage.
- **Focus du titre** : la sélection et le défilement ne doivent pas déplacer le focus du champ de titre
  de l'arbre (`renamingId` inchangé). À tester, pas à supposer.
- **Appel de `requestGoto` avant `await api.tree.save`** : la sélection apparaît dès que l'objet existe.
  L'effet `urlItem` (l.836-846) retrouve la même cible (`appliedGotoRef`), sans second défilement.

## Hors périmètre

- Libellés du bouton et des autres points d'entrée.
- Gestion d'erreur de création (échec silencieux inchangé).
