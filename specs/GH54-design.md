# GH54 — Design : gabarits d'export ajoutables depuis le client web

Spec : `specs/GH54.md`. Décisions validées : D1 (bibliothèque personnelle), D2 (`docx`, `xlsx`), D3 (remplacement
sur confirmation), D4 (suppression avec avertissement), D5 (archive ZIP avec la partie principale), D6 (racine à
plat), D7 (limite existante de 20 Mo). D8 (nom attendu d'un gabarit absent) : **hors ticket**, selon la
recommandation écrite dans la spec.

## 1. Service : `ExportTemplateLibrary` (`main/services/export-template-library.ts`)

Le dossier de la bibliothèque reste `appSettings.exportTemplatesDir`, qui est `userData/export-templates` sur le
web (`user-pool.ts`). Deux méthodes s'ajoutent, sur le modèle de `resolve` (confinement).

### 1.1 `importFile(format, srcPath, fileName, replace)`

Ordre des contrôles :

1. dossier configuré (sinon `refused` : « Aucune bibliothèque de gabarits n'est configurée ») ;
2. nom : `path.basename(fileName) === fileName` (pas de séparateur ni `..`), pas de préfixe `.` ou `~$`,
   extension `.docx` (ou `.xlsx`) insensible à la casse ; sinon `refused` ;
3. contenu : lecture de `srcPath`, `new PizZip(buffer)` ; échec → `refused` « n'est pas un document Word/Excel
   valide » ; partie principale absente (`word/document.xml` pour `docx`, `xl/workbook.xml` pour `xlsx`) →
   `refused` ; rien n'est écrit dans les deux cas ;
4. cible `dossier/fileName` : si elle existe et `replace` est faux → `exists` (`relPath` renvoyé, rien écrit) ;
5. écriture atomique : fichier temporaire dans le dossier, puis `rename` (le remplacement est écrit en un seul
   geste, un export en cours ne voit jamais un fichier tronqué).

Retour : `{status: 'ok' | 'exists', relPath}` ou `{status: 'refused', message}`. `relPath` = `fileName` (racine, D6).

### 1.2 `deleteFile(relPath)`

`resolve(relPath)` (confinement existant : refuse `..`, absolu, hors bibliothèque, inexistant), puis `unlink`.
Retour : `{status: 'ok'}` ou `{status: 'refused', message}`. La vérification « référencé par la préférence du
projet » est faite côté client (le client a le schéma du projet ouvert, D4) ; le service ne lit pas le schéma.

Dans les deux méthodes, toute erreur d'écriture ou de lecture devient un `refused` au message générique, sans
fuite de chemin absolu (le message est affiché tel quel).

## 2. Canaux (web uniquement)

Dans `web-server/web-handlers.ts`, à côté de `web:drawio-import` :

- `web:export-template-import(format, uploadId, replace)` : `uploaded(uploadId)` → `importFile` →
  `uploads.remove(uploadId)` dans un `finally` (le fichier envoyé n'est jamais gardé).
- `web:export-template-delete(relPath)` → `deleteFile`.

`app.ts` : `docx` est ajouté à la liste des extensions acceptées par `POST /upload` (`UPLOAD_EXTENSIONS`,
jusqu'ici images, `drawio` et `xlsx`). Oubli de la conception, relevé à l'e2e (415). Le contenu n'est contrôlé
que par le canal qui le lit (ZIP et partie principale, §1.1).

`channel-policy.ts` : les deux entrées dans `WEB_ONLY_CHANNELS`. Pas d'argument de dépôt (`ROOT_ARGS`) : la
bibliothèque est celle de l'utilisateur, pas celle d'un repo. Les canaux desktop (`export-templates:*`) ne
changent pas.

## 3. Client

- `packages/api-client` : `export.importTemplate(format, replace)` → `invoke('export-templates:import', …)` ;
  `export.deleteTemplate(relPath)` → `invoke('web:export-template-delete', relPath)`. Types
  `TemplateImportResult` = `ok | exists | refused | canceled` (exportés depuis `index.ts`).
- `web/bridge.ts` : adaptateur `export-templates:import` (comme `dialog:pick-drawio-file`) : sélecteur de
  fichier (`.docx` ou `.xlsx` selon `format`), envoi (`upload`), puis `rpc('web:export-template-import', …)`.
  Annulation du sélecteur → `{status: 'canceled'}`.
- `platform.ts` : `capabilities.webTemplateLibrary = isWeb`. Desktop : aucune action ajouter/supprimer.
- `routes/preferences.tsx` : sous la section « gabarit par défaut », un bloc `TemplateLibraryWeb`
  (nouveau composant `components/export/TemplateLibraryWeb.tsx`), rendu seulement si
  `capabilities.webTemplateLibrary`. Par format : bouton « Ajouter un gabarit », liste des gabarits avec
  « Remplacer » et « Supprimer ».
  - Ajouter : `importTemplate(format, false)`. `exists` → dialogue « Remplacer le gabarit X ? » →
    `importTemplate(format, true)`. `refused` → message, rien n'est modifié. `canceled` → rien.
  - Supprimer : dialogue avec le nom ; si `schema.preferences.exportTemplates[templateKey(kind, format)]`
    vaut ce `relPath` (pour un `kind` qui accepte ce format, voir `TEMPLATE_FORMATS_BY_KIND`), le dialogue
    l'indique (D4). `deleteTemplate(relPath)` ensuite.
  - Après chaque action réussie : `queryClient.invalidateQueries({ queryKey: ['export-templates'] })`. Le popover
    d'export relit déjà la liste à chaque ouverture (`staleTime: 0`), donc il n'y a pas d'autre rafraîchissement.

## 4. Cas limites

| Cas | Traitement |
|---|---|
| Fichier envoyé vide | ZIP invalide → `refused` |
| Deux envois simultanés du même nom | le second voit `exists` (ou `replace`) selon le moment ; le `rename` est atomique |
| Gabarit supprimé alors qu'un export est en cours | l'export lit le fichier au début ; échec de lecture → message d'export existant |
| Préférence projet pointant sur un gabarit supprimé | l'export retombe sur « Standard » (comportement existant, pas de changement) |
| Nom avec espaces ou accents | accepté tel quel (le relPath est affiché et utilisé tel quel) |

## 5. Risques

- Pas de contrôle de contenu au-delà de la présence de la partie principale (D5) : un gabarit mal formé
  échoue à l'export, pas à l'envoi. Accepté.
- Sur Windows, les noms ne différencient pas la casse : `Modele.docx` et `modele.docx` désignent le même
  fichier ; l'envoi du second donne `exists`. Comportement attendu, à mentionner dans l'aide.
