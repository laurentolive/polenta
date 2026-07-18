# T75 — Design technique

Réf. `specs/T75.md`.

## Vue d'ensemble

Quatre blocs de travail :

1. **Attributs de dimension/crop** sur les deux nodes TipTap concernés — `image`
   (actuellement l'extension standard `@tiptap/extension-image`, sans attribut de
   taille) et `drawioEmbed` (`T47`, attributs `path`/`nodeId` seulement).
2. **`ResizableMediaFrame`** — composant NodeView générique partagé (poignées de
   redimensionnement, overlay de rognage, déclenchement du menu contextuel),
   utilisé par les deux NodeViews (image et drawio) pour éviter de dupliquer deux
   fois la même mécanique d'interaction.
3. **`NodeContextMenu`** — petit composant de menu contextuel générique, dédié au
   richtext.
4. **Sérialisation Markdown** des nouveaux attributs, avec compatibilité
   ascendante des documents déjà stockés (images `![alt](src)` sans métadonnées).

## 1. Attributs sur les nodes

### Node `image`

Remplace l'usage direct de `@tiptap/extension-image` par une extension locale
qui l'étend :

```ts
// apps/desktop/src/renderer/tiptap/ResizableImageExtension.ts
export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: null },   // px affichés, null = taille native (comportement actuel inchangé)
      height: { default: null },  // px affichés
      crop: { default: null },    // { x, y, width, height } en fraction [0,1] de l'image native, null = pas de rognage
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView)
  },
})
```

Le nom du node reste `image` (extension, pas un nouveau type) : les usages
existants continuent de fonctionner sans changement — `editor.chain().focus().setImage({ src })`
(commande native de l'extension `Image`, réutilisée telle quelle par
`handleInsertImage`) et `state.schema.nodes['image']?.create({ src })` (paste
handler de `RichTextField.tsx`).

Crop en **fractions [0,1] de la taille native** de l'image (pas des pixels
absolus) : robuste si le fichier est remplacé (action "Remplacer le fichier",
cf. spec point 10) par une image de dimensions différentes — le même rognage
relatif reste appliqué, cohérent avec l'intention de l'utilisateur au moment du
rognage plutôt qu'une position pixel qui perdrait son sens.

### Node `drawioEmbed`

Ajout de deux attributs dans `DrawioEmbedExtension.ts` :

```ts
width: { default: null }   // px affichés du conteneur, null = taille auto actuelle
height: { default: null }  // px affichés
crop: { default: null }    // { x, y, width, height } en unités du modèle mxGraph (coordonnées diagramme, pas fraction)
```

Le crop drawio n'est **pas** exprimé en fraction : un diagramme n'a pas de
"taille native" universelle comme une image bitmap. Les coordonnées sont dans
l'espace du modèle mxGraph (mêmes unités que `graph.getGraphBounds()` /
`getView().getState(cell)`, déjà utilisées pour le surlignage de cellule
existant dans `DrawioEmbedView.tsx`).

**Réinitialisation du crop au changement de page/node-id** (action "Changer de
page/node-id", spec point 11) : un rognage défini pour une page n'a pas de sens
garanti sur une autre page (bornes différentes) → `crop` repassé à `null` par
cette action ; `width`/`height` (taille d'affichage) restent inchangés.

## 2. `ResizableMediaFrame` (composant partagé)

Nouveau fichier `apps/desktop/src/renderer/tiptap/ResizableMediaFrame.tsx`,
utilisé par `ResizableImageView.tsx` (nouveau) et `DrawioEmbedView.tsx` (mis à
jour). Props principales :

```ts
interface ResizableMediaFrameProps {
  width: number | null
  height: number | null
  naturalAspectRatio: number | null   // largeur/hauteur native, pour le ratio de redimensionnement ; null = pas de contrainte connue
  selected: boolean                   // NodeViewProps.selected — affiche les poignées
  editable: boolean                   // = editor.isEditable — masque poignées + menu contextuel en lecture seule
  onResize: (width: number, height: number) => void
  crop: { x: number; y: number; width: number; height: number } | null
  cropBounds: { width: number; height: number }   // bornes valides du crop (taille native image, ou bounding box diagramme)
  onCropChange: (crop: ResizableMediaFrameProps['crop']) => void
  menuItems: ContextMenuItem[]        // items spécifiques au type (drawio ajoute "Ouvrir dans draw.io", "Changer de page")
  children: React.ReactNode           // le rendu visuel réel (<img> ou le conteneur mxgraph)
}
```

Responsabilités :

- **Poignées de redimensionnement** (coins uniquement) affichées quand
  `selected && editable`. Glissement d'un coin : nouvelle taille calculée en
  conservant `naturalAspectRatio` (décision spec point 3 — ratio par défaut,
  pas de variante libre dans cette évolution). Taille plancher : **40px** de
  côté minimum (cas limite spec), le glissement est clampé à ce minimum.
  Relâchement de la poignée → `onResize(w, h)`.
- **Mode rognage** : état local `cropping: boolean` (activé par l'action
  "Rogner" du menu contextuel, jamais par un état stocké dans le document — la
  session de rognage est une interaction UI éphémère). Pendant `cropping`,
  affiche un cadre semi-transparent ajustable par poignées par-dessus le
  rendu actuel, initialisé sur le `crop` existant ou sur la totalité de
  `cropBounds` si absent. Deux boutons **Valider**/**Annuler** en pied de
  cadre. Valider → `onCropChange(rect)` puis sort du mode ; Annuler → sort du
  mode sans appel.
  - Le rectangle de sélection est toujours clampé à l'intérieur de
    `cropBounds` — un crop hors bornes ou de largeur/hauteur nulle ne peut pas
    être validé (cas limite spec : "jamais un crop vide silencieusement
    accepté").
- **Menu contextuel** : `onContextMenu` sur le conteneur (uniquement si
  `editable`) sélectionne le node ProseMirror (pour cohérence visuelle avec un
  clic simple) et ouvre `NodeContextMenu` positionné au curseur avec
  `menuItems` fournis par l'appelant.
- **Rendu du crop** sur `children` : le composant applique un conteneur
  `overflow: hidden` de taille `width × height`, et positionne son contenu via
  un décalage/mise à l'échelle calculés à partir de `crop`/`cropBounds` (même
  principe qu'un cropper d'image classique : `scale = width / crop.width`,
  translation `-crop.x * scale, -crop.y * scale`). Ce même mécanisme générique
  s'applique aussi bien à un `<img>` qu'au conteneur mxgraph du viewer draw.io
  — c'est la raison de mutualiser ce composant plutôt que de dupliquer le
  calcul dans les deux NodeViews.

**Intégration undo/redo** : `onResize`/`onCropChange` appellent
`updateAttributes()` (fourni par `ReactNodeViewRenderer`, propagé aux NodeViews
via `NodeViewProps`), qui dispatch une transaction ProseMirror standard — déjà
couverte par l'historique de `StarterKit` sans mécanisme supplémentaire.
Répond directement au cas limite "Undo/redo standard" de la spec.

## 3. `NodeContextMenu` (composant générique)

Nouveau fichier `apps/desktop/src/renderer/tiptap/NodeContextMenu.tsx` — menu
positionné en `fixed`, fermeture sur `mousedown` extérieur ou `Échap`, liste
d'items avec séparateurs optionnels et variante `danger` (pour "Supprimer").

Reprend le **pattern visuel et d'implémentation** du `ContextMenu` déjà présent
dans `ElementTree.tsx` (mêmes classes Tailwind, même mécanisme de fermeture) —
mais **sans en faire une extraction partagée** : `ElementTree.tsx` est hors
périmètre de ce ticket (règle du workflow : ne modifier que les fichiers liés
au ticket en cours), et les deux menus n'ont pas le même type d'item
(`ContextMenuItem` du tree porte des concepts propres à l'arbre). Une petite
duplication ciblée (~30 lignes) est préférée à un refactor cross-feature non
demandé. Si un troisième besoin de menu contextuel apparaît plus tard, ce sera
le bon moment pour extraire un composant commun — pas avant.

Items communs (fournis par `ResizableImageView` et `DrawioEmbedView`) :
**Redimensionner** (sélectionne le node + force `selected` visuel si besoin),
**Rogner** (active le mode crop du frame), **Remplacer le fichier**,
**Supprimer** (`danger: true`, appelle `deleteNode()` du NodeView).

Items ajoutés uniquement par `DrawioEmbedView` : **Ouvrir dans draw.io**
(réutilise `handleDoubleClick` existant), **Changer de page/node-id** (réutilise
le composant de sélection de page déjà écrit pour `DrawioInsertButton.tsx` —
à extraire en petit composant partagé `DrawioPagePicker.tsx` puisque cette
fois la logique est réellement dupliquée à l'identique entre insertion et
édition post-insertion).

**État d'erreur drawio** (`not-found`/`invalid`, cf. `T47`) : "Rogner" est
désactivé dans le menu (rien à cadrer sur un rendu qui ne s'affiche pas) —
"Remplacer le fichier" et "Supprimer" restent actifs (cas limite spec).

## 4. Sérialisation Markdown

### Image

Décision : **conserver la syntaxe Markdown standard `![alt](src)` tant
qu'aucune métadonnée n'est définie** (`width`, `height`, `crop` tous `null` —
c'est-à-dire toute image existante ou toute image insérée puis jamais
redimensionnée/rognée). Dès qu'un de ces attributs est non-null, sérialiser en
**bloc fenced dédié**, sur le même principe que `drawioEmbed` (`T47`) :

````
```image
{"src":"data:image/png;base64,...","width":320,"height":180,"crop":{"x":0.1,"y":0,"width":0.8,"height":1}}
```
````

Raisons de ce choix plutôt qu'un unique format toujours-fenced :

- **Compatibilité ascendante** : tout document déjà stocké avec des images en
  syntaxe standard continue de parser exactement comme avant (pas de migration
  de données nécessaire).
- **Diff minimal** : une image jamais redimensionnée ne change pas de
  représentation dans le Markdown stocké, aligné avec la philosophie du projet
  (pas de churn Git non justifié par un changement réel de contenu).
- `Markdown.configure({ html: false, ... })` (config actuelle de
  `RichTextField`/`RichTextViewer`) exclut l'option HTML inline (`<img
  width=...>`) comme alternative : le pipeline actuel ne préserve pas le HTML
  brut, la fenced-block JSON est le mécanisme déjà validé et fonctionnel dans
  la codebase (`T47`).

Parsing : plugin markdown-it installé sur le node (même mécanisme que
`DrawioEmbed.addStorage().markdown.parse.setup`), reconnaît `info === 'image'`,
parse le JSON, retombe sur un `<img>` HTML minimal sans attributs si le JSON
est invalide (comportement dégradé cohérent avec le fallback drawio existant).
Le parsing standard markdown-it de `![alt](src)` (image inline classique)
reste actif en parallèle sans changement — les deux chemins de parsing
coexistent, chacun produisant un node `image` (avec ou sans attributs de
taille/crop).

### Drawio

Extension du payload JSON déjà sérialisé (`{"path":...,"nodeId":...}`) avec
`width`, `height`, `crop` en clés optionnelles (absentes = comportement actuel
inchangé). Round-trip géré par la même paire serialize/parse déjà en place
dans `DrawioEmbedExtension.ts` — pas de nouveau mécanisme, extension du même
objet JSON.

## 5. Lecture seule (`RichTextViewer.tsx`)

`RichTextViewer.tsx` utilise déjà `editable: false`. Les deux NodeViews lisent
`editor.isEditable` (disponible sur `NodeViewProps.editor`, sans prop
supplémentaire à faire transiter) pour peupler `ResizableMediaFrame.editable` —
en lecture seule, ni poignées, ni menu contextuel, ni mode crop ne sont
rendus, mais `width`/`height`/`crop` stockés sont appliqués normalement au
rendu (le viewer affiche l'image/diagramme à la taille et au cadrage définis en
édition — seule l'interactivité est coupée). Répond proprement à la Décision 5
de la spec sans branche de code séparée entre les deux composants : même
extension, même NodeView, un seul flag dérivé du mode existant de l'éditeur.

## Risque technique à valider en sprint 2

Le calcul du rectangle de rognage drawio en coordonnées du modèle mxGraph à
partir d'un glissement en pixels écran dépend de l'échelle de rendu courante
du viewer officiel (`viewer.graph.getView().scale`/`translate`, déjà utilisés
pour le surlignage de cellule existant — même famille d'API interne non
documentée officiellement, cf. `T47-sprint3.md`). Point à valider concrètement
en sprint 2, pas un blocage de design : en cas de divergence d'API, le
surlignage de cellule existant restant déjà "best-effort" (`try/catch`) sert de
précédent pour un repli identique sur le crop drawio si nécessaire (crop
désactivé proprement plutôt qu'un calcul faux).

## Découpage en sprints

**Sprint 1 — Redimensionnement + menu contextuel de base (image et drawio)**
- Attributs `width`/`height` sur `image` (nouvelle extension `ResizableImage`)
  et `drawioEmbed`
- `ResizableMediaFrame` : poignées de redimensionnement + intégration menu
  contextuel (sans le mode crop, désactivé/masqué ce sprint)
- `NodeContextMenu` (générique) avec items communs **Redimensionner**,
  **Remplacer le fichier**, **Supprimer** ; item drawio **Ouvrir dans draw.io**
  (déplace la logique du double-clic existant dans le menu, double-clic
  conservé en plus)
- Sérialisation Markdown : bloc fenced `image` (avec `width`/`height`
  uniquement, `crop` non géré ce sprint) + extension du payload `drawio`
  existant avec `width`/`height`
- Câblage `editable`/lecture seule dans les deux NodeViews

**Sprint 2 — Rognage (crop) + action "Changer de page/node-id"**
- Mode crop dans `ResizableMediaFrame` (overlay, poignées, Valider/Annuler,
  clamp aux bornes)
- Résolution du rectangle de crop en coordonnées mxGraph pour drawio (cf.
  risque technique ci-dessus)
- Item menu **Rogner** (communs), **Changer de page/node-id** (drawio,
  extraction de `DrawioPagePicker.tsx` partagé avec `DrawioInsertButton.tsx`)
- Réinitialisation du crop au changement de page/node-id
- Extension du payload JSON (image et drawio) avec `crop`
- Vérification bout-en-bout des critères d'acceptation de `specs/T75.md`
- Mise à jour SPEC (`SPEC-REQ-requirements.md` §3, `SPEC-TECH-stack.md` §2)

## Fichiers impactés (résumé)

- `apps/desktop/src/renderer/tiptap/ResizableImageExtension.ts` (nouveau)
- `apps/desktop/src/renderer/tiptap/ResizableImageView.tsx` (nouveau, NodeView)
- `apps/desktop/src/renderer/tiptap/ResizableMediaFrame.tsx` (nouveau, partagé)
- `apps/desktop/src/renderer/tiptap/NodeContextMenu.tsx` (nouveau, générique)
- `apps/desktop/src/renderer/tiptap/DrawioPagePicker.tsx` (nouveau en sprint 2,
  extrait de `DrawioInsertButton.tsx`)
- `apps/desktop/src/renderer/tiptap/DrawioEmbedExtension.ts` — attributs
  `width`/`height`/`crop`, sérialisation étendue
- `apps/desktop/src/renderer/tiptap/DrawioEmbedView.tsx` — intégration
  `ResizableMediaFrame`, menu contextuel, résolution crop mxGraph
- `apps/desktop/src/renderer/components/RichTextField.tsx` — remplace
  `Image.configure(...)` par `ResizableImage.configure(...)`
- `apps/desktop/src/renderer/components/RichTextViewer.tsx` — idem (même
  extension, `editable: false` déjà en place)
- `apps/desktop/src/renderer/components/DrawioInsertButton.tsx` — extraction
  de `DrawioPagePicker.tsx` (sprint 2)
