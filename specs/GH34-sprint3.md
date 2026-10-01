# GH34 — Sprint 3 : diagrammes, campagnes, dashboard, exemples, SPEC

Spec : `specs/GH34.md` · Design : `specs/GH34-design.md` §2.5–2.6, §5 · Tests : `specs/GH34-tests.md` (S3.x)

Fin de la phase 1 (Word). La phase 2 (Excel) reste au sprint 4.

## Comportement implémenté

- **Diagrammes draw.io en image** : dans un `{{@rich…}}`, chaque bloc draw.io est rendu en PNG
  (×2) tel qu'affiché dans la Vue Word (même page/ancre, taille, rognage), sans le cadre de la
  vue. Rendu en une seule passe avant la conversion, dans une fenêtre cachée (rendu offscreen) sur
  la route `/print/drawio-snapshot`, capture par `capturePage`. Un même diagramme référencé N fois
  = une image. Échec (fichier absent, XML invalide, délai) → `[Diagramme : chemin#nœud]` ; délai
  global proportionnel au nombre de diagrammes, captures déjà faites conservées. Bloc non JSON →
  omis (comme à l'écran).
- **Cahier et rapport de campagne** par gabarit : `campaign` (statut + libellé, référence,
  composant, champs), `entries` (test figé, exigence de l'instance, résultat + libellé, date,
  auteur, pré/postconditions, notes d'exécution), `steps` avec **résultat et commentaire par
  étape** (lus dans l'exécution `runId`), `summary` par résultat ; versions mises en forme via
  `rich.*`.
- **Dashboard** par gabarit : `widgets` dans l'ordre d'affichage, `{{@table}}` (tableau Word du
  résultat), `columns`/`rows.cells`, `hasData`, `rowCount`.
- **`statusLabel`** des exigences/tests : libellé du statut défini dans le schéma (« Approuvé »).
- **Gabarits d'exemple** (`resources/export-templates/`, générés par
  `scripts/build-export-templates.ts`) : Cahier des exigences, Cahier de tests, Cahier de
  campagne, Rapport de campagne, Dashboard — page de garde avec cartouche (projet, composant,
  révision/tag, branche, date, auteur), en-tête et pied de page (révision, « Page X / Y »), titres
  hiérarchiques de dossiers, contenu riche, tableaux d'étapes/résultats. **Référence des balises**
  (`Référence des balises.html`). Bouton **« Installer les exemples »** (panneau Compte) : copie
  dans `<bibliothèque>/Exemples Polenta/`, sans écraser l'existant. Packagés via `extraResources`.
- Sélecteur de gabarit actif pour `campaign-plan`, `campaign-report`, `dashboard` (docx).

## Fichiers modifiés

| Fichier | |
|---------|-|
| `main/services/export/template/drawio-ref.ts` | **nouveau** — référence, clé, collecte des blocs drawio d'un payload |
| `main/services/export/template/drawio-snapshot.ts` | **nouveau** — fenêtre offscreen + capture |
| `main/services/export/template/template-data-campaign.ts` | **nouveau** — données campagne / dashboard |
| `main/services/export/template/markdown-to-ooxml.ts` | images de diagrammes, `tableXml`/`textTableXml` partagés |
| `main/services/export/template/template-data.ts` | `statusLabel`, `defineRich` exporté |
| `main/services/export/template/template-export.service.ts` | nouveaux kinds, `TestsService` (résultats d'étapes), capture injectée, `{{@table}}` |
| `main/services/export-template-library.ts` | `installExamples` |
| `main/container.ts`, `main/ipc/index.ts` | câblage, `export-templates:install-examples` |
| `renderer/routes/print.drawio-snapshot.tsx` | **nouveau** — route de capture |
| `renderer/lib/staticDrawio.ts` | callback `onDone` de fin de rendu |
| `renderer/lib/exportTemplates.ts` | kinds campagne/dashboard |
| `renderer/lib/exportColumns.ts`, `components/system/SystemView.tsx` | `statusLabel` dans `outline` |
| `renderer/components/sidebar/AccountPanel.tsx`, `i18n/locales/{fr,en}.json` | « Installer les exemples » |
| `packages/types/src/export.ts`, `packages/api-client/src/*` | `statusLabel`, `installExampleTemplates`, `drawioSnapshotReady` |
| `apps/desktop/electron-builder.yml` | `extraResources` export-templates |
| `apps/desktop/resources/export-templates/*` | **nouveaux** — 5 gabarits + référence HTML |
| `apps/desktop/scripts/build-export-templates.ts` | **nouveau** — générateur des exemples |
| `apps/desktop/scripts/check-gh34.ts` | scénarios S3 (82 contrôles au total) |
| `apps/desktop/scripts/e2e-gh34-drawio.mjs` | **nouveau** — e2e dans l'app buildée / packagée |

## Divergences par rapport au design

- **Chemins de la fenêtre de capture** résolus depuis `app.getAppPath()` (et non `__dirname` comme
  `pdf.util.ts`) : le module vit dans un chunk chargé à la demande (`out/main/chunks/`) — trouvé
  par l'e2e (`ERR_FILE_NOT_FOUND`).
- **Échec du rendu draw.io non bloquant** : l'export continue avec les replis texte (le design
  ne le précisait que par diagramme).
- **`{{@table}}` pour le dashboard** : le design prévoyait une boucle `rows`/`cells` ; une boucle
  sur les *colonnes* d'un tableau Word n'existant pas dans docxtemplater (module payant), Polenta
  construit le tableau. `columns`/`rows.cells` restent exposés.
- **`statusLabel`** et **résultats par étape** (lecture de l'exécution `runId`) : ajouts.
- **Référence des balises en HTML** (et non `.docx`) : un `.docx` dans la bibliothèque serait
  proposé comme gabarit.
- **Mise à jour des SPEC dès ce sprint** (fin de la phase Word, comme prévu au design) ; le
  sprint 4 complétera §19.15a pour Excel.

## Vérifications

- `pnpm typecheck` : aucune nouvelle erreur (seule `git.service.ts(78)`, préexistante) ; `pnpm build` OK.
- `scripts/check-gh34.ts` : **82 PASS, 0 FAIL** (S1, S2, S3.1–S3.7 avec rendu draw.io simulé).
- **Word 16** (COM) : documents S3 (exigences avec 40 diagrammes, tests, campagne, rapport,
  dashboard) ouverts **sans réparation** ; pages rendues et contrôlées visuellement (page de garde,
  cartouche, en-têtes/pieds, synthèse, tableaux).
- **E2E app buildée** (`scripts/e2e-gh34-drawio.mjs`) : installation des exemples, liste,
  export avec **vraie capture draw.io** (page ciblée par l'ancre, taille de l'éditeur, repli du
  fichier absent) — images vérifiées visuellement.
- **S3.9 — app packagée** (`electron-builder --dir`, `E2E_EXE=dist/win-unpacked/Polenta.exe`) :
  mêmes résultats (ressources `export-templates` présentes, chunks bundlés OK). L'installeur NSIS
  lui-même n'a pas été exécuté (même contenu `app.asar`/`resources`).
- **UI** (pilote Playwright `run-desktop`, projet de démo LL800) : popover Exporter du dashboard
  avec liste « Gabarit Word » et exemples installés ; export via l'interface avec
  `Exemples Polenta/Dashboard.docx` → document valide (Word), données réelles.
- `/code-review` : 1 problème (délai global jetant les captures faites) — corrigé.

## Mises à jour SPEC

| Section | Modification |
|---------|--------------|
| `SPEC-TECH-stack.md` §2 | ligne « Export Word par gabarit client » (docxtemplater, pizzip, angular-expressions, bundling, conversion richtext maison) ; usage de `docx` pour les exemples |
| `SPEC-TECH-stack.md` §9 | `app-settings.json` (`exportTemplatesDir`) ; gabarits d'exemple en `extraResources` |
| `SPEC-TEMPLATES.md` §2 | `preferences.exportTemplates` dans le format de `schema.yaml` |
| `SPEC-ELECTRON-DESKTOP.md` §19.15 (+ nouveau §19.15a) | sélecteur de gabarit du popover ; section complète « Export à partir d'un gabarit client » (bibliothèque, défaut projet, moteur, contenu riche, draw.io, vérification) |
| `SPEC-INDEX.md` | MAJ → GH34 et mots-clés pour ces 4 lignes |

## Test manuel

1. Panneau Compte › Préférences › Gabarits d'export › Choisir… un dossier, puis **Installer les
   exemples** → `Exemples Polenta/` contient 5 gabarits + `Référence des balises.html`.
2. Préférences du projet : choisir `Exemples Polenta/Cahier des exigences.docx` pour le cahier
   d'exigences → Enregistrer.
3. Vue exigences d'un composant avec diagrammes draw.io dans un énoncé → Exporter → Word : page de
   garde, en-têtes/pieds, dossiers en titres, énoncés mis en forme, **diagrammes en image**.
4. Campagne exécutée → Exporter (rapport) avec `Rapport de campagne.docx` : synthèse, résultats,
   résultat et commentaire par étape.
5. Dashboard → Exporter avec `Dashboard.docx` : un tableau par widget.
6. Ouvrir `Référence des balises.html` ; modifier un gabarit d'exemple (logo, couleurs) et
   réexporter.
