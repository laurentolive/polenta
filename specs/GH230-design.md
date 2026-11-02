# GH230 — Design : conserver l'élément affiché au changement de type de vue

Un seul sprint.

## Fichiers

| Fichier | Modification |
|---------|--------------|
| `routes/product.tsx`, `routes/components.tsx` | paramètre de recherche optionnel `top` (objectId d'ancrage) |
| `contexts/SystemViewContext.tsx` | `urlTop` ; `navigateWith` porte `top` (gardé par une résolution automatique, abandonné par toute nouvelle page / tout goto) ; `anchorNodeId` dérivé de l'URL ; `switchView(mode, current)` remplace l'usage de `showView` par les boutons de mode |
| `components/system/viewAnchor.ts` (nouveau) | `firstVisibleNode(scroller, accept)`, `selectedRowNode(scope)`, `scrollCandidates(root, nodeId)` |
| `hooks/useScrollToNode.ts` | options `{ root, block, behavior, ready }` : repli sur le nœud rendu le plus proche quand `root` est fourni |
| `components/system/ExcelView.tsx` | prop `anchorNodeId` ; lignes sélectionnées marquées `data-selected` ; zone de défilement `data-view-scroll` ; défilement goto / ancrage après le rendu complet des lignes |
| `components/system/WordView.tsx` | prop `anchorNodeId` ; `data-view-scroll` ; goto avec repli |
| `components/system/SystemView.tsx` | boutons de mode → `switchView` avec la ligne sélectionnée et le premier élément affiché lus dans le DOM de la vue courante |

## Décisions

**Élément de référence lu dans le DOM.** La vue courante est seule à savoir ce qui est à l'écran
(défilement, replis, titres de dossiers) et quelle ligne du Tableau est sélectionnée (état local de
`ExcelView`). Plutôt que de remonter cet état par des callbacks à chaque défilement, `SystemView`
le lit au clic : `[data-view-scroll]` (zone de défilement), `[data-node-id]` (lignes / cartes /
titres, déjà posés par T164), `[data-selected]` (lignes sélectionnées). Rejeté : rendre la sélection
du Tableau contrôlée par `SystemView` (réinitialisation par type à gérer, rendu de la grille).

**Premier affiché** : premier `[data-node-id]` dans l'ordre du DOM dont le milieu est sous le haut
de la zone de défilement, décalé de son `scroll-margin-top` (les lignes du Tableau portent
`scroll-mt-8` pour l'en-tête figé), et au-dessus du bas ; limité aux nœuds portant un objet.

**Ancrage `top` dans l'URL** (objectId, stable ; les id des nœuds non classés sont régénérés à la
lecture de l'arbre). `anchorNodeId` est dérivé pendant le rendu (`treeFindByObjectId`) quand
`view ≠ edit`, sans `item`, arbre prêt : la vue montée par la bascule ou par Précédent le reçoit
dès son premier rendu. Défilement `block: 'start'`, instantané, sans contour.

**Précédent ramène à la position** : la page quittée (sans `item`) est d'abord précisée en
REPLACE avec `top`, puis la nouvelle page est poussée par un effet qui attend que l'URL porte ce
`top`. Les deux navigations dans la même tâche feraient perdre le REPLACE : `TabsProvider`
regroupe un PUSH et les navigations qui le précèdent avant le rendu en une seule entrée.

**Référence sélectionnée** : priorité ligne sélectionnée du Tableau > cible goto > élément édité
(depuis l'Édition). Objet → `item` dans l'URL (goto existant, contour) ; dossier → cible goto
locale (`setGotoTarget`), pas d'`item`.

**Repli** (`scrollCandidates`) : `[nœud, ancêtres du plus proche au plus haut, descendants,
nœuds suivants dans l'ordre de l'arbre, nœuds précédents en sens inverse]` ; le premier présent dans
le DOM est retenu. Couvre sans connaître l'état de la vue : dossier replié (ancêtre rendu le plus
proche = dossier replié), titres de dossiers masqués (descendant), élément filtré ou absent (voisin).
Appliqué aussi au goto du clic dans l'arbre (T164 : no-op → défilement vers le dossier replié).

**Rendu progressif du Tableau** : le défilement (goto et ancrage) attend `renderAllRows`, sinon
le repli retiendrait une des premières lignes rendues ; le rendu complet est forcé dès qu'une cible
existe.

Bouton du mode déjà actif : sans effet (plus de nouvelle page identique).
