# T76 — Design technique

Réf. `specs/T76.md`.

## Vue d'ensemble

Trois blocs de travail :

1. **IPC** : trois nouvelles méthodes sous un nouveau namespace `image`
   (`packages/api-client`), mirroir exact du namespace `drawio` déjà en place
   (`pickFile`, `read`) plus une méthode dédiée au collage presse-papiers
   (pas d'équivalent côté drawio, qui n'a pas de flux de collage).
2. **`ResizableImageView`** (rendu du node `image`) : passage d'un rendu
   `<img src={data URI stocké}>` à un rendu qui distingue trois formes de
   `src` (data URI historique, URL http(s), chemin relatif de repo) et lit ce
   dernier cas via IPC — même principe que `DrawioEmbedView` qui lit le XML
   via `api.drawio.read` plutôt que de le stocker inline.
3. **Insertion / collage / remplacement** dans `RichTextField.tsx` et
   `RichTextToolbar.tsx` : remplace l'encodage base64 par un appel IPC qui
   copie le fichier dans `images/` et renvoie un chemin relatif. Extraction
   d'un composant partagé `ImageInsertButton` (mirroir de
   `DrawioInsertButton`) pour ne pas dupliquer cette logique dans les deux
   toolbars qui l'ont aujourd'hui chacune en local.

Aucun changement de schéma d'attributs sur le node `image` (`ResizableImageExtension.ts`
reste inchangé) : `src` continue d'être une simple chaîne, sa sémantique
(data URI / URL / chemin repo) se détermine par préfixe au moment du rendu,
pas par un nouvel attribut. Le bloc Markdown ```` ```image ```` (T75) garde
son schéma JSON exact (`src`/`width`/`height`/`crop`).

## 1. IPC — namespace `image`

### Contrat (`packages/api-client/src/types.ts`)

```ts
image: {
  /**
   * Sélection d'un fichier image via dialogue natif. `status: 'ok'` donne un
   * chemin RELATIF à repoPath. Si le fichier choisi est hors du repo, il est
   * copié dans `images/` (nom dédupliqué si collision) — `copied: true`.
   * Mirroir exact de `drawio.pickFile`.
   */
  pickFile(repoPath: string): Promise<
    | { status: 'ok'; path: string; copied: boolean }
    | { status: 'canceled' }
    | { status: 'error'; message: string }
  >
  /** Octets du fichier référencé, ou null si introuvable. Jamais stocké — uniquement pour construire un data URI de rendu en mémoire. */
  read(repoPath: string, relativePath: string): Promise<{ mimeType: string; base64: string } | null>
  /**
   * Écrit les octets d'une image collée (presse-papiers, pas de fichier
   * source) dans `images/` sous un nom généré, nom dédupliqué si collision.
   */
  writePaste(repoPath: string, mimeType: string, base64: string): Promise<
    | { status: 'ok'; path: string }
    | { status: 'error'; message: string }
  >
}
```

`dialog.pickImageFile` (existant) est conservé tel quel — supprimé de tous
les call sites richtext (remplacés par `image.pickFile`/`image.writePaste`),
mais le contrat n'est retiré nulle part : aucun autre call site ne l'utilise
actuellement (vérifié), donc pas de risque de régression à le laisser, et pas
de raison de le retirer explicitement (pas de nettoyage hors périmètre de ce
ticket).

### Handlers (`apps/desktop/src/main/ipc/index.ts`)

```ts
ipcMain.handle('image:pick-file', async (_e, repoPath: string) => {
  const result = await dialog.showOpenDialog({
    title: 'Insérer une image',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'] }],
  })
  if (result.canceled || !result.filePaths[0]) return { status: 'canceled' as const }
  const picked = result.filePaths[0]
  const rel = path.relative(repoPath, picked)
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
    return { status: 'ok' as const, path: rel.split(path.sep).join('/'), copied: false }
  }
  try {
    const imagesDir = path.join(repoPath, 'images')
    await fsP.mkdir(imagesDir, { recursive: true })
    const destName = await findAvailableFileName(imagesDir, path.basename(picked))
    await fsP.copyFile(picked, path.join(imagesDir, destName))
    return { status: 'ok' as const, path: `images/${destName}`, copied: true }
  } catch {
    return { status: 'error' as const, message: 'Impossible de copier le fichier dans le repo.' }
  }
})

ipcMain.handle('image:read', async (_e, repoPath: string, relativePath: string) => {
  const ext = path.extname(relativePath).toLowerCase().replace('.', '')
  const mimeType = IMAGE_MIME_MAP[ext] ?? 'image/png'
  try {
    const data = await fsP.readFile(path.join(repoPath, relativePath), { encoding: 'base64' })
    return { mimeType, base64: data }
  } catch {
    return null
  }
})

ipcMain.handle('image:write-paste', async (_e, repoPath: string, mimeType: string, base64: string) => {
  try {
    const ext = IMAGE_EXT_BY_MIME[mimeType] ?? 'png'
    const imagesDir = path.join(repoPath, 'images')
    await fsP.mkdir(imagesDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const destName = await findAvailableFileName(imagesDir, `image-${stamp}.${ext}`)
    await fsP.writeFile(path.join(imagesDir, destName), Buffer.from(base64, 'base64'))
    return { status: 'ok' as const, path: `images/${destName}` }
  } catch {
    return { status: 'error' as const, message: "Impossible d'écrire l'image collée dans le repo." }
  }
})
```

`IMAGE_MIME_MAP` / `IMAGE_EXT_BY_MIME` : extrait du mapping déjà écrit en
dur dans le handler `dialog:pick-image-file` existant (png/jpg/jpeg/gif/
svg/webp), factorisé en deux constantes module-level (une direction, puis
son inverse) pour être réutilisé par les trois handlers image sans dupliquer
le littéral. `findAvailableFileName` (déjà défini dans ce fichier pour
drawio) est réutilisé tel quel — aucune modification requise, il ne connaît
pas la notion de type de fichier.

`ipc-client.ts` : trois lignes ajoutées sous un nouveau bloc `image: { ... }`,
même forme que le bloc `drawio` existant.

## 2. Rendu — `ResizableImageView.tsx`

Trois formes possibles de `src`, distinguées par préfixe, résolues au rendu
uniquement (aucun changement de ce qui est stocké dans le document) :

| Préfixe | Origine | Rendu |
|---|---|---|
| `data:` | Image collée/insérée **avant T76** (contenu existant, non migré) | `<img src={src}>` direct, inchangé — zéro régression sur le contenu déjà stocké |
| `http://` / `https://` | Image référencée par URL externe (`![alt](https://...)`, cas déjà couvert par la description `richtext` de `SPEC-REQ-requirements.md` §3.2 : "images via URL") | `<img src={src}>` direct, aucun appel IPC |
| tout le reste | Chemin relatif de repo, nouvelle insertion T76 | résolu via `api.image.read(repoPath, src)`, cf. ci-dessous |

```ts
type LoadState = { status: 'literal' } | { status: 'loading' } | { status: 'no-repo' } | { status: 'not-found' } | { status: 'ok'; dataUri: string }
```

Pour le cas "chemin relatif" : un `useEffect` déclenché sur `[repoPath, src]`
appelle `api.image.read(repoPath, src)`, construit `data:${mimeType};base64,${base64}`
en mémoire (jamais réécrit dans `updateAttributes` — le document garde le
chemin comme source de vérité) et l'utilise comme `src` du `<img>` rendu.
Sans `repoPath` → état `no-repo` ; lecture retournant `null` → état
`not-found`, affiché en ligne (`Image introuvable : {src}`) — même
présentation que `DrawioEmbedView` pour son état `not-found`, cohérent avec
le critère d'acceptation "état d'erreur explicite, sans crash".

`onLoad` (mesure de la taille native pour le ratio de redimensionnement et
les bornes de rognage, cf. `T75`) s'accroche à la même balise `<img>` quel
que soit le cas — aucun changement sur ce mécanisme.

### Remplacement de fichier (`handleReplace`)

```ts
const handleReplace = async () => {
  if (!repoPath) return
  const picked = await api.image.pickFile(repoPath)
  if (picked.status !== 'ok') return
  updateAttributes({ src: picked.path })
}
```

Remplace l'appel `api.dialog.pickImageFile()` + construction manuelle du data
URI. `repoPath` lu depuis `extension.options` (`ResizableImageOptions`,
nouveau, même pattern que `DrawioEmbedOptions`) plutôt que passé en prop —
`ResizableImageView` est un NodeView TipTap, il n'a pas de props React
classiques, seulement `node`/`extension`/`updateAttributes`/etc.

`ResizableImageExtension.ts` gagne un `addOptions()` :

```ts
export interface ResizableImageOptions { repoPath?: string }
// ...
addOptions() {
  return { repoPath: undefined }
},
```

Et `RichTextField.tsx` passe `ResizableImage.configure({ inline: false, allowBase64: true, repoPath })`
(déjà fait pour `DrawioEmbed.configure({ repoPath })` à la ligne voisine —
`repoPath` est déjà une prop de `RichTextField`, aucun nouveau plomberie de
prop nécessaire à travers l'arbre de composants).

Sans `repoPath` disponible (contexte repo indisponible), l'action "Remplacer
le fichier" est un no-op — cohérent avec le comportement déjà existant du
bouton `DrawioInsertButton` (désactivé/no-op sans `repoPath`).

## 3. Insertion et collage

### Nouveau composant partagé `ImageInsertButton.tsx`

`RichTextField.tsx` (`handleInsertImage`) et `RichTextToolbar.tsx`
(`handleInsertImage`) contiennent aujourd'hui chacun la même logique locale
(`api.dialog.pickImageFile()` → construction base64 → `setImage`). Comme
`DrawioInsertButton` l'a déjà fait pour éviter cette duplication côté
diagrammes, ce ticket extrait un composant `ImageInsertButton` (même
répertoire que `DrawioInsertButton.tsx`) :

```tsx
interface Props { editor: Editor | null | undefined; repoPath?: string; disabled?: boolean; className?: string }

export function ImageInsertButton({ editor, repoPath, disabled, className }: Props) {
  const handleClick = async () => {
    if (!repoPath || !editor) return
    const picked = await api.image.pickFile(repoPath)
    if (picked.status !== 'ok') return
    editor.chain().focus().setImage({ src: picked.path }).run()
  }
  return (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); void handleClick() }}
      disabled={disabled || !repoPath}
      title={repoPath ? 'Insérer une image (fichier)' : 'Insérer une image (contexte repo indisponible)'}
      className={className}
    ><ImagePlus size={13} /></button>
  )
}
```

Simplifié par rapport à `DrawioInsertButton` : pas de sélecteur de
page/node-id (une image n'a pas de pages), donc pas de popover `pagePicker`
ni de gestion de message d'erreur flottant — juste le bouton. `RichTextField.tsx`
et `RichTextToolbar.tsx` remplacent leur `handleInsertImage` local par
`<ImageInsertButton editor={editor} repoPath={repoPath} className={btn(false)} />`
à la place du `<button onClick={handleInsertImage}>` existant.

### Collage presse-papiers (`RichTextField.tsx`, `handlePaste`)

```ts
if (item.type.startsWith('image/')) {
  event.preventDefault()
  const blob = item.getAsFile()
  if (!blob || !repoPath) return true   // pas de contexte repo : collage ignoré, cohérent avec drawio
  const reader = new FileReader()
  reader.onload = async () => {
    const dataUrl = reader.result as string
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    const result = await api.image.writePaste(repoPath, blob.type, base64)
    if (result.status !== 'ok') return
    const { state } = view
    const node = state.schema.nodes['image']?.create({ src: result.path })
    if (node) view.dispatch(state.tr.replaceSelectionWith(node))
  }
  reader.readAsDataURL(blob)
  return true
}
```

`FileReader.readAsDataURL` reste le moyen le plus simple d'obtenir une chaîne
base64 à partir du `Blob` du presse-papiers côté renderer (pas d'accès
`fs` direct dans ce processus) ; seule la destination change : au lieu
d'insérer ce data URI dans le document, il est envoyé une fois par IPC pour
être écrit sur disque, et c'est le **chemin renvoyé** qui est inséré dans le
document. Sans `repoPath`, le collage est absorbé (`preventDefault` déjà
appelé pour éviter le comportement navigateur par défaut, qui n'insère rien
d'utile dans un contenteditable de toute façon) sans effet — mêmes règles que
pour l'insertion via bouton.

## 4. Alternative rejetée : protocole `file://` / custom scheme

Servir les fichiers `images/` via un protocole Electron custom
(`protocol.registerFileProtocol`, ex. `polenta-image://...`) directement en
`src` d'`<img>` aurait évité l'aller-retour base64 par IPC. Rejeté : aucun
protocole custom n'existe aujourd'hui dans ce codebase, et `T47` a déjà
établi le pattern "lire le contenu par IPC, construire le rendu en mémoire"
pour les diagrammes (`api.drawio.read` retourne le XML, jamais un chemin
consommé directement par le DOM) — rester cohérent avec ce précédent plutôt
que d'introduire un deuxième mécanisme de résolution de fichier pour le même
genre de besoin.

## 5. Découpage en sprints

Un seul sprint : le périmètre est contenu (3 handlers IPC mirroir de
l'existant, un composant extrait, une vue réécrite, un paste handler modifié)
et réutilise entièrement la mécanique de redimensionnement/rognage/menu
contextuel déjà livrée par `T75` (aucune modification de
`ResizableMediaFrame`, `NodeContextMenu`, ni des attributs `width`/`height`/`crop`).

## Refs SPEC

Cf. `specs/T76.md` §Refs SPEC (inchangé, mise à jour effective en sprint final).
