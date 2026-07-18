# T47 — Design technique

Réf. `specs/T47.md`.

## Vue d'ensemble

Trois blocs de travail, tous nécessaires pour livrer la fonctionnalité de bout en
bout :

1. **IPC** — nouvelles méthodes pour picker un fichier `.drawio`, lire son contenu,
   et l'ouvrir dans l'app externe (remplace le mécanisme cassé `electronAPI`).
2. **Extension TipTap `DrawioEmbed`** — nouveau node atom, rendu local (SVG),
   sérialisation Markdown dédiée, node view avec ouverture externe + resync.
3. **UI d'insertion** — bouton dans les deux variantes de toolbar richtext + flux
   de sélection fichier/page.

## 1. IPC (`packages/api-client`, main process)

Nouveau namespace `drawio` dans `packages/api-client/src/types.ts` (à côté de
`dialog`, `sync`, etc.) :

```ts
drawio: {
  pickFile(): Promise<string | null>                       // chemin absolu choisi par l'utilisateur, filtré *.drawio
  read(repoPath: string, relativePath: string): Promise<string | null>   // contenu XML brut, null si fichier absent
  openExternal(repoPath: string, relativePath: string): Promise<void>    // shell.openPath(absolu) — best effort, pas d'erreur si aucune app associée
}
```

- `pickFile()` suit le pattern existant de `dialog.pickFolder` (dialogue natif,
  pas de scope repo — le composant appelant relativise ensuite le chemin absolu
  retourné par rapport au `repoPath` courant, avec une fonction utilitaire
  `path.relative` côté renderer).
- `read()` : le main process lit le fichier en texte brut (UTF-8) et le retourne
  tel quel. Aucun parsing XML côté main — le parsing (extraction des pages
  `<diagram>`, résolution du node-id) se fait côté renderer avec `DOMParser`
  natif du navigateur (pas de nouvelle dépendance).
- `openExternal()` : implémentation `shell.openPath(path.resolve(repoPath, relativePath))`
  côté main process (Electron `shell`, déjà disponible, pas de nouvelle dépendance).
  C'est ce même appel qui remplace `window.electronAPI.openExternal` dans
  `EditView.tsx` (`case 'drawio'`).
- Pas de `stat`/`watch` dédié : le rafraîchissement se fait par re-lecture complète
  du fichier au retour de focus fenêtre (cf. §3), le coût d'une relecture d'un XML
  de diagramme est négligeable — pas besoin d'optimiser prématurément avec un
  mécanisme de détection de changement séparé.

## 2. Extension TipTap `DrawioEmbed`

Nouveau fichier `apps/desktop/src/renderer/tiptap/DrawioEmbedExtension.ts`
(à côté de la config actuelle des extensions dans `RichTextField.tsx`/`RichTextViewer.tsx`) :

- Node atom (`group: 'block'`, `atom: true`), attributs :
  - `path: string` — chemin relatif au repo courant (ex. `diagrams/foo.drawio`)
  - `nodeId?: string` — ancre optionnelle (id d'une page ou d'une cellule mxGraph)
- NodeView React (`DrawioEmbedView.tsx`) :
  - Lit le fichier via `api.drawio.read(repoPath, path)` au montage
  - Parse le XML avec `DOMParser`, extrait la liste des `<diagram>` (pages) du
    `<mxfile>` racine
  - Sélectionne la page à afficher : si `nodeId` correspond à un id de `<diagram>`,
    cette page ; sinon si `nodeId` correspond à une cellule (`mxCell id=...`)
    trouvée dans une page, cette page-là avec la cellule visuellement mise en
    surbrillance (contour coloré superposé, calculé depuis la géométrie `mxCell`) ;
    sinon la première page du fichier.
  - Rendu SVG local via la librairie vendée `drawio viewer` (cf. ci-dessous) —
    pas d'iframe réseau.
  - États : chargement, erreur ("diagramme introuvable : {path}" /
    "diagramme invalide : {path}"), rendu normal.
  - Double-clic → `api.drawio.openExternal(repoPath, path)`.
  - `useEffect` sur l'event `window focus` : re-exécute la lecture + rendu (même
    logique qu'au montage) pour absorber une édition externe pendant que la
    fenêtre Polenta n'avait pas le focus.

### Rendu local du XML mxGraph → SVG

Décision technique : vendorer le bundle open-source **draw.io "viewer"**
(`viewer-static.min.js`, distribué dans le dépôt officiel `jgraph/drawio`, licence
Apache-2.0), qui transforme du XML mxGraph en SVG **entièrement côté client, sans
aucun appel réseau** une fois le script chargé — c'est le mécanisme officiel conçu
pour l'embarquement de diagrammes statiques (utilisé par ex. pour intégrer des
diagrammes dans des pages wiki/blog hors ligne). Le fichier est copié comme asset
statique de l'app desktop (`apps/desktop/src/renderer/assets/drawio-viewer-static.min.js`
ou équivalent) et chargé une fois au démarrage de l'app (pas de CDN, pas de
`<script src="https://...">`).

Alternative rejetée : librairie npm `mxgraph` (binding JS brut du moteur mxGraph)
— beaucoup plus lourde à intégrer (API bas niveau, nécessite de reconstruire toute
la logique de layout/style que le viewer officiel fait déjà), pour un gain nul
puisque seul un rendu en lecture est nécessaire (pas d'édition intégrée, cf. spec).

Point à valider en sprint 1 : la licence Apache-2.0 du bundle `viewer-static.min.js`
est compatible avec la vendorisation dans ce dépôt (à vérifier concrètement au
moment de l'implémentation, pas un blocage de design).

### Sérialisation Markdown

`tiptap-markdown` permet d'enregistrer un parseur/sérialiseur custom par node.
Syntaxe retenue : **bloc de code fenced avec info-string dédiée**, pas la syntaxe
image Markdown (pour éviter toute ambiguïté avec le node `Image` déjà sérialisé en
`![alt](src)`, et parce qu'un bloc fenced est trivialement diffable/lisible) :

````
```drawio
{"path":"diagrams/foo.drawio","nodeId":"node-PWR-001"}
```
````

ou sans ancre :

````
```drawio
{"path":"diagrams/foo.drawio"}
```
````

Contenu du bloc sérialisé en **JSON** plutôt qu'un séparateur `path#nodeId` :
`path` est un chemin de fichier et peut légitimement contenir lui-même un `#`
(ex. `diagrams/rev#2.drawio`), ce qui rendrait un séparateur `#` ambigu à la
reparse (round-trip cassé — détecté en revue de sprint 1, corrigé avant commit).

- Parsing : plugin markdown-it enregistré sur le node `DrawioEmbed`, reconnaît les
  fenced code blocks avec `info === 'drawio'`, parse le contenu comme JSON
  `{path, nodeId?}`. Contenu non-JSON (édition manuelle du Markdown) : traité
  comme un chemin brut sans ancre plutôt que de faire échouer le parsing.
- Sérialisation : inverse exacte, garantissant un round-trip stable (insertion →
  save → reload → même Markdown).

## 3. UI d'insertion

- `RichTextToolbar.tsx` (mode avec `RichTextContext`) et le toolbar inline de
  `RichTextField.tsx` (mode sans contexte) reçoivent chacun un nouveau bouton
  "Insérer un diagramme draw.io" (même position que le bouton image existant).
- Handler `handleInsertDrawio` :
  1. `api.drawio.pickFile()` → chemin absolu ou `null` (annulation)
  2. Relativisation par rapport au `repoPath` du composant courant (le `repoPath`
     est déjà disponible dans le contexte des vues qui utilisent `RichTextField`/
     `RichTextToolbar` — même source que celle utilisée par les appels `sync.*`
     existants)
  3. `api.drawio.read(repoPath, relativePath)` pour lister les pages (parsing
     `DOMParser` côté renderer, réutilise la même logique que `DrawioEmbedView`)
  4. Si une seule page : insertion directe (`editor.chain().focus().insertContent({...})`)
     avec `nodeId` = id de cette page (ou absent si le fichier n'a qu'un seul
     `<diagram>` sans ambiguïté)
  5. Si plusieurs pages : petite popover/liste de choix (nom de chaque `<diagram>`)
     avant insertion — composant minimal réutilisable, pas de nouvelle librairie
     de modale (réutilise le pattern de popover déjà présent dans le code, ex.
     `AddDependencyModal.tsx` pour le style).

## 4. Fix du champ `drawio` autonome (`EditView.tsx`)

Remplace :
```ts
const api = (window as unknown as Record<string, unknown>).electronAPI as ...
api?.openExternal?.(`file://${localVal}`)
```
par :
```ts
void api.drawio.openExternal(repoPath, localVal)
```
Nécessite que `repoPath` soit disponible dans `EditView.tsx` à cet endroit (à
vérifier en sprint 1 — probablement déjà présent puisque `EditView` opère dans le
contexte d'un repo donné pour lire/écrire l'objet édité).

## Découpage en sprints

**Sprint 1 — Affichage + fix du bug connexe**
- Namespace IPC `drawio` (pickFile, read, openExternal) + implémentation main process
- Vendoring du bundle viewer draw.io + intégration de base
- Extension TipTap `DrawioEmbed` (node + parsing/sérialisation Markdown + NodeView
  avec rendu SVG, états erreur, double-clic ouverture externe, resync au focus)
- Câblage dans `RichTextField.tsx` et `RichTextViewer.tsx` (le node est reconnu et
  rendu — pas encore d'UI pour l'insérer depuis la toolbar, testable en insérant
  manuellement le Markdown de test dans un champ richtext existant)
- Fix du bouton "Ouvrir dans Draw.io" de `EditView.tsx` (`case 'drawio'`)

**Sprint 2 — Insertion (UI complète)**
- Bouton "Insérer un diagramme draw.io" dans `RichTextToolbar.tsx` et le toolbar
  inline de `RichTextField.tsx`
- Flux de sélection fichier + choix de page si le fichier a plusieurs `<diagram>`
- Vérification bout-en-bout des critères d'acceptation de `specs/T47.md`
- Mise à jour SPEC (`SPEC-REQ-requirements.md` §3, `SPEC-TECH-stack.md` §2)

## Fichiers impactés (résumé)

- `packages/api-client/src/types.ts` — namespace `drawio`
- `apps/desktop/src/main/*` — handlers IPC `drawio.pickFile` / `read` / `openExternal`
  (fichier exact à identifier en sprint 1, suivre le pattern des handlers `dialog.*` existants)
- `apps/desktop/src/renderer/tiptap/DrawioEmbedExtension.ts` (nouveau)
- `apps/desktop/src/renderer/tiptap/DrawioEmbedView.tsx` (nouveau, NodeView React)
- `apps/desktop/src/renderer/assets/` — bundle viewer draw.io vendé (nouveau)
- `apps/desktop/src/renderer/components/RichTextField.tsx` — extensions éditeur + toolbar inline
- `apps/desktop/src/renderer/components/RichTextViewer.tsx` — extensions éditeur
- `apps/desktop/src/renderer/components/system/RichTextToolbar.tsx` — bouton insertion
- `apps/desktop/src/renderer/components/system/EditView.tsx` — fix `case 'drawio'`
