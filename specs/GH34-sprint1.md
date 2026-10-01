# GH34 — Sprint 1 : socle de l'export par gabarit client

Spec : `specs/GH34.md` · Design : `specs/GH34-design.md` · Tests : `specs/GH34-tests.md`

## Comportement implémenté

- **Bibliothèque de gabarits** (préférence application, `app-settings.json` → `exportTemplatesDir`) :
  réglée dans le panneau Compte › Préférences (Choisir… / Vider). Parcours récursif (5 niveaux),
  `~$*` et fichiers/dossiers cachés exclus, gabarit identifié par son chemin relatif `/`.
- **Gabarit par défaut du projet** : `schema.yaml` → `preferences.exportTemplates`
  (`requirements:docx`, `tests:docx`), réglé dans la page Préférences du projet. Choisir
  « Standard » retire la clé ; une valeur enregistrée mais absente de la bibliothèque reste affichée
  « ⚠ … (introuvable) ».
- **Popover Exporter** (vues exigences et tests) : liste « Gabarit Word » (Standard + gabarits),
  défaut du projet présélectionné ; défaut introuvable → Standard présélectionné + message ;
  bibliothèque absente/non configurée → message. Le bouton Word est désactivé tant que la liste
  n'est pas chargée ; un échec de lecture de la liste vaut « bibliothèque introuvable ».
- **Moteur** : docxtemplater (MIT) + parseur angular-expressions, délimiteurs `{{ }}`,
  `paragraphLoop`, `linebreaks`, donnée absente → vide, filtres en liste blanche (`upper`, `lower`,
  `default`, `join`, `date`). Erreurs de gabarit traduites (boucle non fermée, balise non fermée…)
  avec nom du gabarit et balise ; aucun fichier écrit en cas d'erreur (destination existante
  préservée) ; fichier corrompu, verrouillé, introuvable ou hors bibliothèque → message dédié.
- **Données** : communes (`project.label/component`, `export.date/datetime/iso/user/kind/templateName`,
  `git.branch/commit/tag`) ; `items` dans l'ordre de l'arbre avec dossiers (`isFolder`, `isItem`,
  `level`, `section`, `name`), champs par nom, `columns[]`, `steps[]` (tests) ; `count`.
  Richtext et étapes en **texte simple** (Markdown retiré, listes `•`/`1.`/`☐`/`☒`, tableaux en
  tabulations, images/diagrammes omis, `[[ID]]` → `ID`). Paramètres substitués comme à l'écran.
- Rendu « Standard » inchangé (les générateurs existants ne sont pas touchés).

## Fichiers modifiés

| Fichier | |
|---------|-|
| `packages/types/src/{app,export,schema}.ts` | `exportTemplatesDir`, `ExportColumn.type`, `TemplateOutlineEntry`, `outline?`, `TemplateExportFormat`, `ExportTemplateKey`, `ExportTemplateListResult`, `ProjectPreferences.exportTemplates` |
| `packages/api-client/src/{types,ipc-client}.ts` | `export.save(…, templateRelPath?)`, `export.listTemplates(format)` |
| `apps/desktop/package.json`, `pnpm-lock.yaml` | `docxtemplater`, `pizzip`, `angular-expressions` |
| `apps/desktop/electron.vite.config.ts` | docxtemplater, pizzip, angular-expressions, markdown-it bundlés (deps transitives non hissées par pnpm) |
| `main/services/app-settings.service.ts` | lecture/écriture `exportTemplatesDir` |
| `main/services/export-template-library.ts` | **nouveau** — liste / résolution sécurisée |
| `main/services/export/template/*` | **nouveaux** — `template-export.service`, `template-data`, `markdown-to-text`, `docx-template` |
| `main/services/export.service.ts` | branche gabarit (`options.repoPath/templateRelPath`) |
| `main/services/git.service.ts` | `tagsAtHead` |
| `main/container.ts`, `main/ipc/index.ts` | câblage, `export-templates:list`, paramètre `templateRelPath` |
| `renderer/components/export/ExportButton.tsx` | sélecteur de gabarit, `getPayload(format, { templated })` |
| `renderer/lib/exportColumns.ts` | `buildExportOutline`, type des colonnes, factorisation filtre/ligne |
| `renderer/lib/exportTemplates.ts` | **nouveau** — kinds/formats acceptant un gabarit |
| `renderer/components/system/SystemView.tsx` | payload commun exigences/tests + `outline` |
| `renderer/routes/preferences.tsx`, `components/sidebar/AccountPanel.tsx`, `i18n/locales/{fr,en}.json` | préférences |
| `apps/desktop/scripts/check-gh34.ts` | **nouveau** — 23 vérifications automatiques |

## Divergences par rapport au design

- **Filtre `date`** : appliqué sur `export.iso` (`{{export.iso | date:"yyyy-MM-dd"}}`) et non sur
  `export.date`, qui est déjà une chaîne formatée `fr-FR` (non re-datable). À refléter dans la
  référence des balises (sprint 3).
- **Préférence application** placée dans le panneau Compte › Préférences (`AccountPanel`), là où
  vit déjà la seule autre préférence app-level (`autoCheckUpdates`) — conforme au design.
- **Packaging** : ajout non prévu au design — exclusion de l'externalisation dans
  `electron.vite.config.ts` (trouvé en revue de code : l'app installée aurait échoué sur
  `@xmldom/xmldom` / `entities`). Vérifié sur le build : aucun `require` externe dans les chunks
  de l'export par gabarit, markdown-it et docxtemplater uniquement dans des chunks chargés au
  premier export (démarrage inchangé, T141).

## Vérifications

- `pnpm typecheck` : aucune nouvelle erreur (seule l'erreur préexistante
  `git.service.ts(78)` Dirent, présente sur main).
- `pnpm build` : OK.
- `pnpm --filter @polenta/desktop exec tsx scripts/check-gh34.ts` : **23 PASS, 0 FAIL**
  (S1.2, S1.5–S1.8, S1.11–S1.23 [auto]).
- `/code-review` : 4 problèmes trouvés, tous corrigés (bundling ×2, présélection pendant le
  chargement, état « modifié » après retour à Standard).
- Pas de lint : aucune configuration ESLint pour `apps/desktop`.
- **Non testé** : l'app packagée (installeur NSIS) — S3.9 au sprint 3.

## Mises à jour SPEC

Aucune (sprint non final ; mises à jour au sprint 3, fin de la phase Word).

## Test manuel

1. Créer un dossier `C:\gabarits\ACME\` contenant un `cahier.docx` Word avec par ex. :
   - page de garde : `{{project.label}} — {{project.component}}`, `Révision {{git.commit}} ({{git.branch}}) {{git.tag}}`, `Édité le {{export.date}} par {{export.user}}`
   - corps : `{{#items}}` / `{{#isFolder}}{{section}} {{name}}{{/isFolder}}` (en style Titre) /
     `{{#isItem}}{{id}} — {{name}}` / `{{statement}}{{/isItem}}` / `{{/items}}`
   - un tableau dont la 2e ligne contient `{{#items}}{{#isItem}}{{id}}` | `{{status}}{{/isItem}}{{/items}}`
2. Panneau Compte › Préférences › Gabarits d'export › Choisir… → `C:\gabarits`.
3. Préférences du projet → Cahier d'exigences (docx) → `ACME/cahier.docx` → Enregistrer
   (vérifier `preferences.exportTemplates` dans `.polenta/schema.yaml`).
4. Vue exigences → Exporter : gabarit présélectionné → Word → ouvrir : en-têtes/pieds/logo du
   gabarit conservés, données remplies, dossiers à leur place.
5. Choisir « Standard » → rendu identique à avant.
6. Renommer `cahier.docx` → Exporter : « ⚠ ACME/cahier.docx (introuvable) », Standard présélectionné.
7. Gabarit avec `{{#items}}` sans fermeture → message d'erreur nommant le gabarit et « items »,
   aucun fichier créé.
8. Vue tests avec un gabarit `{{#items}}{{id}}{{#steps}}{{order}}. {{action}} → {{expectedResult}}{{/steps}}{{/items}}`.
