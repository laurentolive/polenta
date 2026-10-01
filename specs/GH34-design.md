# GH34 — Design : export Word/Excel basé sur un gabarit client

Spec : `specs/GH34.md` · Issue : #34

## 1. Vue d'ensemble

```
Renderer                                   Main
ExportButton ──(liste)── export-templates:list ──► ExportTemplateLibrary (lit app-settings.exportTemplatesDir)
   │  choix gabarit (défaut = schema.preferences.exportTemplates[kind:format])
   └─ export:save(repoPath, kind, format, payload, printParams, suggestedName, templateRelPath?)
                                              │
                                ExportService.run(...)
                                  ├─ templateRelPath absent → GENERATORS (inchangé, rendu « Standard »)
                                  └─ présent → TemplateExportService
                                       1. résout le fichier (bibliothèque + chemin relatif, anti `..`)
                                       2. construit les données (buildTemplateData : commun + kind)
                                       3. richtext → OOXML (markdown → WordprocessingML, images, draw.io)
                                       4. docxtemplater.render → post-traitement zip (médias, numérotation)
                                       5. écrit le buffer à la destination (rien d'écrit si erreur)
```

Le rendu « Standard » ne change pas d'une ligne : les générateurs existants ne sont pas touchés,
seule une branche est ajoutée dans `ExportService.run` (critère 11).

## 2. Choix techniques

### 2.1 Moteur Word : `docxtemplater` + `pizzip` (MIT)

| Option | Décision |
|--------|----------|
| **docxtemplater (cœur MIT) + parseur `docxtemplater/expressions.js` (angular-expressions)** | **Retenu.** Boucles, conditions, balises brutes `{@…}` (insertion d'OOXML) dans le cœur gratuit. Le parseur d'expressions évalue uniquement sur le scope de données (pas d'accès à `process`, `require`, globals) → critère 10. Messages d'erreur structurés (`MultiError`, `xtag`, `explanation`) → critère 8. |
| docx-templates | Rejeté : les balises sont du **JavaScript évalué** (`vm`, non sûr contre un gabarit hostile) ; richtext seulement via `altChunk` HTML (converti par Word à l'ouverture, mal supporté ailleurs, styles du gabarit mal appliqués). |
| Modules payants docxtemplater (image, HTML) | Rejetés : coût de licence. Les images et le richtext sont produits par notre propre conversion (§2.3) injectée via balise brute + post-traitement zip. |
| Fusion de documents générés par la lib `docx` | Rejeté : collisions d'IDs (relations, numérotation, styles) à résoudre de toute façon, sans bénéfice. |

- Dépendances : `docxtemplater`, `pizzip`, `angular-expressions` (≥ 1.4, versions antérieures à 1.1.2 vulnérables), `image-size` (dimensions des images). À mettre en `dependencies` (le main externalise ses deps, `externalizeDepsPlugin`) et à charger en `import()` dynamique comme les générateurs existants (T141).
- **Délimiteurs `{{ }}`** au lieu de `{ }` : moins de collision avec du texte client contenant des accolades, et pas de confusion visuelle avec les références de paramètres Polenta `{nom}`.
- `nullGetter` → `''` (critère 9) ; `paragraphLoop: true` (une boucle seule sur son paragraphe ne laisse pas de paragraphe vide) ; `linebreaks: true` (les `\n` des champs texte deviennent des sauts de ligne).
- Filtres d'expression enregistrés (liste blanche) : `upper`, `lower`, `date:'format'`, `default:'x'`, `join:', '`.

### 2.2 Syntaxe des balises (référence utilisateur)

| Balise | Effet |
|--------|-------|
| `{{project.label}}` | valeur texte |
| `{{#items}} … {{/items}}` | boucle (ligne de tableau répétée si la boucle est dans une ligne) |
| `{{#isFolder}} … {{/isFolder}}`, `{{^isFolder}} … {{/isFolder}}` | condition / condition inverse |
| `{{#status == "approved"}} … {{/}}` | condition par expression |
| `{{@rich.statement}}` | champ richtext **mis en forme** ; doit être seul dans son paragraphe (remplace le paragraphe) |
| `{{statement}}` | même champ en **texte simple** (Markdown retiré) |
| `{{export.date \| date:'dd/MM/yyyy'}}` | filtre |

### 2.3 Richtext → OOXML (`export/template/markdown-to-ooxml.ts`)

Conversion maison : `markdown-it` (déjà en dépendance, mêmes options que `staticRichText.tsx` :
`html: false`, tables et barré activés) → tokens → XML WordprocessingML. Elle s'exécute dans le main
et produit, pour chaque champ, une chaîne de `<w:p>`/`<w:tbl>` injectée par `{{@rich.x}}`.

| Markdown | OOXML |
|----------|-------|
| titres `#…######` | `w:pStyle` = styleId du style intégré `heading N` du gabarit |
| paragraphe | `w:p` sans style (style Normal du gabarit) |
| `**` `*` `~~` `` ` `` | `w:b`, `w:i`, `w:strike`, run en police mono (style de caractère `HTML Code` s'il existe, sinon `w:rFonts` Consolas) |
| listes `-` / `1.` imbriquées | `w:numPr` (`ilvl` = profondeur) ; style `List Paragraph` |
| `- [ ]` / `- [x]` | puce remplacée par `☐` / `☒` en tête de run |
| tableau GFM | `w:tbl`, style `Table Grid` s'il existe sinon bordures simples, 1re ligne en en-tête (`w:tblHeader`, gras) |
| image (fence `image` ou `![](…)`) | `w:drawing` inline, `r:embed` → média ajouté au zip (§2.4) |
| fence `drawio` | image PNG issue du snapshot (§2.5) ; sinon paragraphe `[Diagramme : path#nodeId]` |
| `[[SW-0042]]` | texte `SW-0042` |
| lien `[t](url)` | texte `t` (lien hypertexte hors scope v1) |

**Résolution des styles** : lecture de `word/styles.xml` du gabarit, recherche par **nom canonique**
(`w:name w:val="heading 1"`, `"List Paragraph"`, `"Table Grid"`) → `w:styleId`. Indispensable car
l'ID varie selon la langue de Word (`Titre1` en français). Style absent → pas de `pStyle` (Word
applique Normal, spec §2.5).

**Texte simple** (`{{statement}}`) : rendu texte des tokens markdown-it (Markdown retiré, listes
préfixées `•`/`1.`, tableaux en lignes séparées par tabulations, images/diagrammes omis).

### 2.4 Post-traitement du zip (`export/template/docx-package.ts`)

Après `doc.render()`, sur le `PizZip` résultant :

- **Médias** : écriture `word/media/polenta-<n>.<ext>`, ajout des `Relationship` dans
  `word/_rels/document.xml.rels` (rIds `rIdPolenta<n>`, préfixe sans collision possible avec ceux du
  gabarit), ajout des `Default Extension` manquantes (`png`, `jpeg`, `gif`) dans
  `[Content_Types].xml`. Les rIds sont alloués pendant la conversion (§2.3) via un `MediaRegistry`
  partagé, puis matérialisés ici. Les richtext ne sont insérés que dans le corps
  (`document.xml`), pas dans les en-têtes/pieds.
- **Numérotation** : ajout dans `word/numbering.xml` (créé avec sa relation et son content type
  s'il n'existe pas) de deux `w:abstractNum` Polenta (puces, décimale, 9 niveaux) et d'un `w:num`
  **par liste numérotée** (avec `w:lvlOverride/w:startOverride` pour que chaque liste reparte
  à 1). IDs `abstractNumId`/`numId` alloués au-delà du max présent dans le gabarit.
- Images : formats PNG/JPEG/GIF. SVG → rasterisé via le snapshot (§2.5) si simple, sinon
  paragraphe de repli. Taille : taille native ou `width` du fence, ramenée à la largeur utile de
  la section (`w:pgSz` − marges du `w:sectPr` final du gabarit), ratio conservé.
- Images distantes (`http(s)`) : `net.fetch` avec timeout 10 s, 10 Mo max ; échec → repli.

### 2.5 Diagrammes draw.io → PNG (`export/template/drawio-snapshot.ts`)

Le rendu draw.io n'existe que dans un navigateur (viewer mxGraph vendoré, `staticDrawio.ts`). On
réutilise le mécanisme de `pdf.util.ts` :

- Une fenêtre `BrowserWindow` cachée en **rendu offscreen** (`webPreferences.offscreen: true`) est
  ouverte une fois par export, sur une nouvelle route `/print/drawio-snapshot`.
- Le main lui envoie la liste des diagrammes (`path`, `nodeId`, `width`, `height`, `crop`) ; la
  route les rend l'un après l'autre avec la même géométrie que `renderStaticDrawio`
  (`computeDrawioLayout`), signale le rectangle, le main fait `webContents.capturePage(rect)` →
  PNG (facteur d'échelle 2 pour la netteté).
- Dédoublonnage par `path#nodeId#crop#size`, timeout par diagramme (10 s) et global ; échec →
  paragraphe de repli, l'export continue (spec §2.7).
- **Risque** : `capturePage` sur fenêtre offscreen à valider en début de sprint 3 (spike d'une
  heure). Repli si KO : rasterisation côté route par `canvas` avec `mxClient.NO_FO = true`
  (libellés en SVG natif, pas de `foreignObject` qui taint le canvas).

### 2.6 Données des gabarits (`export/template/template-data.ts`)

Construites dans le main à partir du `payload` (déjà filtré/configuré par la vue) et d'un contexte :

```ts
interface TemplateCommonData {
  project: { label: string; component: string }           // label du nœud root du schéma, componentLabel
  export: { date: string; datetime: string; user: string; kind: ExportKind; templateName: string }
  git: { branch: string; commit: string; tag: string }    // tag = '' si HEAD non tagué
}
```

- `git.*` : `GitService.currentBranch`, `headSha` (court, 7 car.), nouvelle méthode
  `GitService.tagsAtHead(repoPath)` (isomorphic-git `listTags` + `resolveRef`, premier tag trié).
- `export.user` : même identité que celle utilisée pour les commits de ce repo (résolveur GH29) —
  le Dev réutilise la fonction existante, pas de nouvelle source.
- Dates : format `fr-FR` par défaut ; le filtre `date` permet un autre format.

**requirements / tests** — le payload actuel (`columns`/`rows` en `Record<string,string>`) ne
porte ni les dossiers, ni le type des champs, ni le détail des étapes. Extension **optionnelle**
de `RequirementsExportPayload`/`TestsExportPayload` (ignorée par les générateurs standard) :

```ts
interface TemplateOutlineEntry {
  kind: 'folder' | 'item'
  level: number                    // profondeur dans l'arbre, 1 = racine
  section: string
  name: string
  values: Record<string, string>   // mêmes clés/valeurs que rows (paramètres déjà substitués)
  steps?: { order: number; action: string; expectedResult: string; notes: string }[]
}
// payload.outline?: TemplateOutlineEntry[]
// payload.columns[i].type?: SchemaFieldType   // 'richtext' → conversion §2.3
```

Produit par une nouvelle fonction `buildExportOutline` dans `renderer/lib/exportColumns.ts`
(même parcours d'arbre, même filtre que `buildExportRows` ; les dossiers sont inclus s'ils
contiennent au moins un élément retenu par le filtre), appelée seulement quand un gabarit est
choisi : `getPayload(format, { templated })`.

Modèle exposé au gabarit :

```
items[]: { isFolder, level, section, name, id, title, status, version,
           <champ>… (texte simple), rich.<champ> (OOXML, champs richtext uniquement),
           columns[]: { key, label, value, rich?, isRich },
           steps[]: { order, action, expectedResult, notes } (tests) }
count: nombre d'éléments (hors dossiers)
```

**campaign-plan / campaign-report** — payload inchangé (`campaign`, `entries` portent déjà tout) :
`campaign { id, title, status, …fields }`, `entries[] { id, title, status, requirementId,
run { status, statusLabel, comment, steps[] { order, action, expectedResult, status, actual } },
rich.<champ> }`, `summary { total, pass, fail, blocked, incomplete, pending }`.

**dashboard** — `dashboard { title }`, `widgets[] { title, type, columns[], rows[][] }`
(tableau directement bouclable : `{{#rows}}{{#.}}{{.}}{{/.}}{{/rows}}` documenté).

### 2.7 Bibliothèque et préférences

- `AppSettings.exportTemplatesDir?: string` (`packages/types`), lu/écrit par `AppSettingsService`
  (validation : chaîne, sinon absent).
- `ExportTemplateLibrary` (main) :
  - `list(format): { relPath, name }[]` — parcours récursif, `.docx` ou `.xlsx`, exclusion `~$*`,
    fichiers/dossiers commençant par `.`, profondeur max 5 ; dossier absent/illisible → `[]` +
    `status: 'missing'`.
  - `resolve(relPath): string` — `path.resolve(dir, relPath)` doit rester sous `dir` (sinon erreur),
    le fichier doit exister.
- IPC : `export-templates:list(format)` → `{ dirConfigured: boolean; dirExists: boolean; templates }` ;
  `app:set-settings` existant pour le dossier ; `dialog:choose-directory` réutilisé s'il existe,
  sinon ajout d'un handler.
- `ProjectPreferences.exportTemplates?: Partial<Record<`${ExportKind}:${'docx'|'xlsx'}`, string>>`
  dans `schema.yaml`, lu/écrit par le chemin existant (`schema:save`) — aucune migration.

### 2.8 UI

- **Préférences application** (`AccountPanel.tsx`, à côté de `autoCheckUpdates`) : « Bibliothèque
  de gabarits d'export » — chemin, bouton Choisir…, bouton Vider.
- **Préférences projet** (`routes/preferences.tsx`, même `EditorState` que `autoPropagatePin`) :
  section « Gabarits d'export », un `<select>` par `kind:format` supporté (« Standard » + gabarits
  du bon format ; une valeur enregistrée mais introuvable reste affichée, marquée indisponible).
- **ExportButton** : nouvelle prop `templateKey` implicite (`kind`) ; pour les formats supportant
  les gabarits, au-dessus des boutons de format, un `<select>` « Gabarit » chargé à l'ouverture
  du popover (`export-templates:list` + `schema.preferences.exportTemplates`). Défaut introuvable →
  option `⚠ <chemin> (introuvable)` désactivée, « Standard » sélectionné, message court + lien
  vers les préférences si aucune bibliothèque n'est configurée. Le gabarit choisi est passé à
  `export:save` (nouveau paramètre optionnel `templateRelPath`).
- Libellés dans les fichiers i18n existants (fr/en).

### 2.9 Erreurs

`TemplateExportService` encapsule tout rendu dans un `try` et ne fait `writeFile` qu'après
génération complète du buffer. Erreurs docxtemplater (`MultiError`) → message :
`Gabarit « ACME/cahier.docx » invalide : balise « {{#items}} » non fermée (+2 autres erreurs)`
(au plus 3 erreurs détaillées). Fichier illisible / zip invalide / verrouillé (`EBUSY`) → message
dédié. Remonte par le canal existant (`{ status: 'error', message }`).

## 3. Fichiers

| Fichier | Modification |
|---------|--------------|
| `packages/types/src/export.ts` | `TemplateOutlineEntry`, `outline?`, `columns[].type?`, `ExportTemplateInfo`, `ExportTemplateListResult` |
| `packages/types/src/schema.ts` | `ProjectPreferences.exportTemplates` |
| `packages/types/src/…` (AppSettings) | `exportTemplatesDir?` |
| `apps/desktop/package.json` | `docxtemplater`, `pizzip`, `angular-expressions`, `image-size` |
| `main/services/app-settings.service.ts` | lecture/validation `exportTemplatesDir` |
| `main/services/export-template-library.ts` | **nouveau** — liste/résolution |
| `main/services/export.service.ts` | `run(…, { repoPath, templateRelPath })` → branche gabarit (réintroduit `repoPath`, cf. commentaire T43) |
| `main/services/export/template/template-export.service.ts` | **nouveau** — orchestration |
| `main/services/export/template/template-data.ts` | **nouveau** — modèles de données par kind |
| `main/services/export/template/markdown-to-ooxml.ts` | **nouveau** — §2.3 |
| `main/services/export/template/docx-package.ts` | **nouveau** — styles, médias, numérotation (§2.4) |
| `main/services/export/template/drawio-snapshot.ts` | **nouveau** — §2.5 |
| `main/services/export/template/xlsx-template.ts` | **nouveau** (sprint 4) |
| `main/services/git.service.ts` | `tagsAtHead` |
| `main/ipc/index.ts`, `preload/index.ts` | `export-templates:list`, paramètre `templateRelPath` de `export:save`, choix de dossier |
| `renderer/components/export/ExportButton.tsx` | sélecteur de gabarit, `getPayload(format, { templated })` |
| `renderer/lib/exportColumns.ts` | `buildExportOutline`, type des colonnes |
| `renderer/components/system/SystemView.tsx` | payload `outline` quand gabarit |
| `renderer/routes/preferences.tsx` | section gabarits d'export |
| `renderer/components/sidebar/AccountPanel.tsx` | dossier de bibliothèque |
| `renderer/routes/print.drawio-snapshot.tsx` | **nouveau** (sprint 3) |
| `apps/desktop/resources/export-templates/*.docx` | **nouveau** — gabarits d'exemple (sprint 3), copiés via `extraResources` |
| `docs/export-templates.md` (ou section d'aide existante) | **nouveau** — référence des balises |
| `scripts/check-gh34.ts` | **nouveau** — vérifications automatiques (cf. GH34-tests.md) |

## 4. Alternatives rejetées (résumé)

- Gabarits HTML + conversion → rendu non fidèle à une charte Word.
- Stocker les gabarits dans chaque projet → décidé en spec (partage entre projets).
- Envoyer les PNG draw.io depuis le renderer dans le payload → la rasterisation canvas échoue sur
  les libellés HTML (`foreignObject` taint) et alourdit l'IPC ; le snapshot côté main réutilise le
  modèle éprouvé de l'export PDF.
- Excel via `exceljs` (lecture du gabarit puis réécriture) → **à confirmer au sprint 4** : exceljs
  perd graphiques, tableaux croisés et certaines formes du classeur client. Préférence pour
  `xlsx-template` (MIT, travaille directement sur le XML, conserve le reste du classeur, syntaxe
  `${table:items.id}` pour la ligne répétée) ; spike en début de sprint 4 sur un classeur réel du
  client avant de figer.

## 5. Découpage en sprints

| Sprint | Périmètre | Livrable testable |
|--------|-----------|-------------------|
| **1 — Socle** | Préférence bibliothèque (app) + préférence projet + sélecteur ExportButton + IPC ; `ExportTemplateLibrary` ; `TemplateExportService` avec docxtemplater, données communes + requirements/tests (`outline`, dossiers, étapes) ; richtext en **texte simple** seulement ; gestion d'erreurs ; script de vérification | Export exigences/tests depuis un gabarit client (page de garde, en-têtes, boucles, cartouche) — critères 1–4, 6, 8–11 |
| **2 — Richtext** | `markdown-to-ooxml` + `docx-package` : styles du gabarit, listes/numérotation, tableaux, cases à cocher, images repo/URL ; balise `{{@rich.x}}` | Critère 7 (hors draw.io) |
| **3 — Diagrammes, campagnes, dashboard, livrables** | Snapshot draw.io ; modèles campaign-plan/report et dashboard ; gabarits d'exemple + référence des balises ; mise à jour des SPEC | Critères 5, 7 (draw.io), 12 — fin de la phase Word |
| **4 — Excel** | Spike moteur, puis gabarits xlsx pour requirements/tests/campaign-plan/query-result/impact-analysis | Critère 13 |

Chaque sprint est livrable seul ; la phase 1 (Word) est complète à la fin du sprint 3.
