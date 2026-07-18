# T76 — Sprint 1 (dernier sprint)

Réf. `specs/T76.md`, `specs/T76-design.md`, `specs/T76-tests.md`.

## Fichiers modifiés

- `packages/api-client/src/types.ts` — nouveau namespace `image` (`pickFile`,
  `read`, `writePaste`), mirroir de `drawio`.
- `packages/api-client/src/ipc-client.ts` — implémentation client des trois
  méthodes.
- `apps/desktop/src/main/ipc/index.ts` — handlers `image:pick-file`,
  `image:read`, `image:write-paste` ; constantes `IMAGE_MIME_BY_EXT`/
  `IMAGE_EXT_BY_MIME` factorisées (réutilisées aussi par `dialog:pick-image-file`,
  inchangé sinon).
- `apps/desktop/src/renderer/tiptap/ResizableImageExtension.ts` — nouvel
  `addOptions()` (`ResizableImageOptions extends ImageOptions`) portant
  `repoPath`, sur le modèle de `DrawioEmbedOptions`.
- `apps/desktop/src/renderer/tiptap/ResizableImageView.tsx` — réécrit : `src`
  résolu en trois cas (`data:` / `http(s)://` / chemin relatif via
  `api.image.read`), état de chargement/erreur inline, `handleReplace` bascule
  sur `api.image.pickFile` avec message d'erreur inline en cas d'échec.
- `apps/desktop/src/renderer/components/ImageInsertButton.tsx` **(nouveau)** —
  bouton partagé "Insérer une image", mirroir de `DrawioInsertButton.tsx`
  (garde `pending`/message d'erreur ou d'info, sans le sélecteur de page).
- `apps/desktop/src/renderer/components/RichTextField.tsx` — paste handler
  réécrit (écrit sur disque via `api.image.writePaste` au lieu d'encoder en
  base64) ; toolbar remplace son bouton "Insérer une image" local par
  `ImageInsertButton` ; `ResizableImage.configure` reçoit `repoPath`.
- `apps/desktop/src/renderer/components/system/RichTextToolbar.tsx` — idem
  (bouton local remplacé par `ImageInsertButton`).
- `apps/desktop/src/renderer/components/RichTextViewer.tsx`,
  `apps/desktop/src/renderer/components/system/WordView.tsx` — `repoPath`
  transmis à `ResizableImage.configure` (manquant avant ce sprint, repéré en
  revue de code : sans ça les images T76 s'affichaient en erreur "contexte
  repo indisponible" dans ces deux vues lecture seule).
- `specs/SPEC-REQ-requirements.md` §3.2, §3.2b — mis à jour (cf. § Mises à
  jour SPEC).
- `specs/SPEC-ELECTRON-DESKTOP.md` §21.4–21.5 — mis à jour (repéré en revue de
  code : ce fichier décrivait encore l'ancien flux base64 ; pas dans les Refs
  SPEC initiales de `T76.md` mais la dérive était directement liée au
  comportement changé par ce ticket).
- `specs/SPEC-INDEX.md` — colonne `MAJ` de la ligne `SPEC-REQ-requirements.md §3`
  mise à `T76`.

## Comportement implémenté

Conforme à `specs/T76.md` : coller une image ou utiliser le bouton d'insertion
copie désormais le fichier dans `images/` du repo courant (référence directe
si le fichier y est déjà) et stocke un chemin relatif dans le document, au
lieu d'un data URI base64. Le bloc ```` ```image ```` (T75) garde son schéma
JSON exact — seule la sémantique de `src` change. Le contenu déjà stocké en
base64 avant ce ticket continue de s'afficher sans conversion (Décision 2 de
`T76.md`), tout comme une image référencée par URL externe.

## Divergences par rapport au design

Aucune divergence de fond. Trois ajustements identifiés en revue de code
(`/code-review high`, 8 angles) et corrigés avant commit, non anticipés dans
`specs/T76-design.md` :

1. **`RichTextViewer.tsx` et `system/WordView.tsx` ne passaient pas `repoPath`
   à `ResizableImage.configure`** — un oubli de plomberie (le design l'avait
   correctement spécifié en théorie mais l'implémentation initiale l'a raté
   sur ces deux call sites). Sans ce correctif, une image T76 s'affichait en
   erreur permanente dans ces deux vues en lecture seule alors que `repoPath`
   y était pourtant disponible.
2. **`ImageInsertButton` et `ResizableImageView.handleReplace` ignoraient
   silencieusement `status: 'error'`** (échec de copie — disque plein,
   permissions) et l'info `copied: true`, contrairement à `DrawioInsertButton`
   dont ils sont censés être le mirroir. Corrigé : `ImageInsertButton` reprend
   le mécanisme de message flottant + garde `pending` (double-clic) de
   `DrawioInsertButton` ; `handleReplace` affiche désormais un message
   d'erreur inline (mirroir du `pickerError` de `DrawioEmbedView`).
3. **Paste handler sans garde de péremption** : l'écriture disque
   (`api.image.writePaste`) est asynchrone ; si l'éditeur est démonté pendant
   ce délai (ex. popover fermée en plein collage), dispatcher sur la vue
   ProseMirror détruite pouvait lever une exception. Ajout d'une vérification
   `view.isDestroyed` avant `dispatch`.

Deux pistes de nettoyage identifiées en revue mais **non appliquées**
(hors périmètre, cohérentes avec les instructions de ne pas refactorer
au-delà du nécessaire) :
- `image:pick-file` duplique la logique de `dialog:pick-drawio-file`
  (vérification chemin relatif + copie dédupliquée) plutôt que de la
  généraliser en helper partagé — le même choix avait déjà été fait pour
  `drawio` sans être refactoré depuis, cohérence avec l'existant.
- `dialog:pick-image-file` (IPC) n'a plus aucun appelant richtext mais reste
  déclaré — décision explicite de `T76-design.md` (hors périmètre de
  nettoyage).

## Mises à jour SPEC

- `SPEC-REQ-requirements.md` §3.2 : la ligne `richtext` du tableau des types
  de champ ne dit plus "images via URL" mais "images référencées par fichier
  du repo ou par URL externe".
- `SPEC-REQ-requirements.md` §3.2b : titre étendu ("stockage image T76"),
  nouveau bullet "Stockage image (T76)" documentant `images/`, l'absence de
  migration du contenu base64 pré-T76, et le comportement URL externe ;
  bullet "Sérialisation Markdown image" précisé (trois formes possibles de
  `src`) ; bullet "Menu contextuel" complété (comportement de "Remplacer le
  fichier" en cas d'échec).
- `SPEC-ELECTRON-DESKTOP.md` §21.4 : paragraphes "Image par collage" et
  "Image par fichier" réécrits pour décrire le flux fichier T76 (au lieu du
  flux base64 devenu obsolète) ; §21.5 remplacé (`dialog:pick-image-file` →
  table des trois channels `image:*`).
- `SPEC-INDEX.md` : `MAJ` de `SPEC-REQ-requirements.md §3` → `T76`.

## Comment tester manuellement

Electron non attachable en session agent — validation manuelle humaine requise
avant archivage (cohérent avec `T42`/`T75`). Scénarios détaillés dans
`specs/T76-tests.md` ; golden path minimal :

1. Ouvrir un repo, éditer un champ richtext, coller une image (capture d'écran)
   → vérifier qu'un fichier apparaît dans `images/` du repo et que le
   Markdown stocké référence ce chemin (pas de `data:`).
2. Recharger le document → l'image s'affiche toujours correctement.
3. Menu contextuel → "Remplacer le fichier" avec un fichier externe → nouveau
   fichier copié dans `images/`, position/dimensions/crop conservés.
4. Ouvrir la même exigence en vue Word/Excel (lecture seule) → l'image
   s'affiche (vérifie le correctif `repoPath` de `RichTextViewer`/`WordView`).
