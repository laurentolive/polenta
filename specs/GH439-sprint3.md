# GH439 — Sprint 3 : export global de la page d'une version

Spec : `specs/GH439.md` § 5 · design : `specs/GH439-design.md` § 8 · scénarios : `specs/GH439-tests.md` T1–T10, X1–X13.

## Fichiers

| Fichier | Changement |
|---|---|
| `packages/types/src/export.ts` | `ExportKind` += `'version'` ; `TablesExportPayload { sheets: TableExportPayload[] }` |
| `main/services/export/table.xlsx.ts` | `exportTablesXlsx` / `buildTablesWorkbook` : une feuille par table, noms rendus valides et uniques (≤ 31 caractères, sans casse) ; `addTableSheet` extrait de l'export d'une grille |
| `main/services/export.service.ts` | générateur `'version:xlsx'` |
| `main/host/print-renderer.ts` | `PdfLayout` += `landscape`, `pageNumbers` ; `PDF_LAYOUT_BY_KIND.version` (A4 paysage, échelle 1, marges 10 mm) ; `PRINT_ROUTE_BY_KIND.version` ; options communes Electron / Playwright (`headerTemplate` vide, pied « page n / N ») |
| `renderer/components/export/ExportButton.tsx` | prop `choices` (cases à cocher, sélection mémorisée par poste sous forme de clés **décochées**, formats désactivés sans sélection) ; `getPayload` / `getPrintParams` reçoivent `selected` ; `getPrintParams` peut être asynchrone |
| `renderer/components/versions/versionSectionTables.ts` (nouveau) | `buildVersionSectionTables` **pure** (sections, colonnes visibles dans l'ordre, toutes les lignes) ; `availableVersionSections` ; `toTablesExportPayload` |
| `renderer/components/versions/versionExportData.ts` (nouveau) | `loadVersionSectionTables` : lit page, analyse, exigences et préférences de colonnes — **le même chemin** pour Excel et PDF |
| `renderer/components/versions/useVersionExport.ts`, `VersionExportButton.tsx` (nouveaux) | sections proposées, nom de fichier, données Excel, paramètres du PDF |
| `renderer/routes/print.version.tsx` (nouveau), `routeTree.gen.ts` | route imprimable : un titre et un tableau statique par section, `thead` répété, lignes jamais coupées ; langue de l'utilisateur appliquée avant la lecture |
| `renderer/routes/version.$versionId.tsx` | bouton **Exporter** en tête des actions de la barre de titre |
| `VersionChangesTable`, `VersionTestsSection`, `VersionAnalysisSection` | `noExport` (l'export est celui de la page) |
| `components/export/exportFilenames.ts`, `i18n/locales/{fr,en}.json` | `versionExportBaseName` ; `versions.export.*` |
| `e2e-web/gh439-version-export.spec.ts` (nouveau), `gh389-versions.spec.ts`, `gh433-export-popover.spec.ts` | 6 scénarios d'export ; contrat de grille sans Exporter sur la page d'une version ; popover GH433 testé depuis le bouton de la barre de titre |
| SPEC-REQ §11.1–§11.5, SPEC-SYSTEM-VIEW (grilles, export), SPEC-ELECTRON-DESKTOP (route, §19.8b, §19.15), SPEC-WEB, SPEC-INDEX, CLAUDE.md | mises à jour (voir ci-dessous) |

## Comportement

- **Exporter** (barre de titre) : fenêtre avec une case par section affichée (toutes cochées au départ), formats Excel et
  PDF ; aucun format sans section cochée. Les cases se cochent à la souris sans fermer la fenêtre (leçon GH416).
- **Excel** : un classeur, une feuille par section dans l'ordre de la page ; colonnes **visibles à l'écran, dans l'ordre**
  (préférences `grid::version-*` de l'utilisateur), **toutes** les lignes (ni filtre ni tri, même avec un filtre actif à l'écran),
  texte tel qu'affiché ; section repliée exportée ; Informations : libellé, état, statut, version précédente, tag, date de gel,
  commit (7 caractères), champs du type, composant, date d'export (pas de tag ni de commit pour une version en cours).
- **PDF** : A4 paysage, échelle 1, en-tête de tableau répété sur chaque page, lignes jamais coupées, pied « page n / N »,
  titre de version et de section. Même fonction de tables que l'Excel : mêmes sections, colonnes et lignes.
- **Version abandonnée** : Analyse et Tests ne sont pas proposées ; sans gel, pas de section Exigences ni d'export de celle-ci.

## Divergences par rapport au design

- Le chargement des données de l'export relit **tout** (page, analyse, exigences) au moment de l'export, par
  `loadVersionSectionTables`, au lieu de réutiliser le cache React Query de l'écran : un seul chemin pour Excel et
  PDF, jamais de données d'un écran périmé.
- Le dédoublonnage des noms de feuille est fait **une seule fois**, dans le générateur du main (`exportTablesXlsx`).
- `getPrintParams` accepte une promesse (nom d'utilisateur du projet, lu de façon asynchrone).
- PDF : pas de lecteur de texte PDF dans les e2e. Structure vérifiée sur le fichier (`%PDF-`, plus de 3 pages, MediaBox
  842 × 595 pt), contenu vérifié sur la route imprimable (mêmes sections, mêmes colonnes et lignes que l'Excel, `thead`
  en `table-header-group`, `break-inside: avoid`), pied de page et gabarit d'en-tête vérifiés en test unitaire
  (`print-renderer.gh439.test.ts`). Le rendu réel du pied et de l'en-tête répété est à voir à la main.

## Mises à jour SPEC

| Section | Résumé |
|---|---|
| SPEC-REQ §11.1, §11.2, §11.3 (page), nouveau §11.5 | champs `analysis` et `verification` ; passage released ; sections de la page ; exigences d'une version, couverture figée, export de la page |
| SPEC-SYSTEM-VIEW § Grilles communes | grilles de la page d'une version sans Exporter ; grille Exigences ; `noExport` |
| SPEC-ELECTRON-DESKTOP route `/version/$versionId`, §19.8b, §19.15 | six sections, `VersionInfoSection` / `VersionRequirementsSection`, kind `version`, `choices`, `/print/version` |
| SPEC-WEB §11 | canal `versions:requirements`, Excel et PDF sur le web |
| SPEC-INDEX | colonne `MAJ` → GH439 sur les cinq lignes touchées |
| CLAUDE.md | champ système `verification` des versions |

## Vérifications

- `pnpm typecheck` OK ; lint : seules les 3 erreurs préexistantes de `main` (#437).
- Tests unitaires ajoutés : tables de sections 13 (T1–T10), classeur multi-feuilles 3, mise en page PDF 4.
- e2e web (build web à jour) : `gh439-version-export` 6/6, `gh439-version-page` 15/15, `gh389-versions` (adapté),
  `gh433-export-popover` (adapté) 2/2, `gh252-versions` 5/5, `gh389-excel-export`.
- Suite unitaire complète : voir le message de commit. Suite e2e complète : **à lancer après le « Validé »** (niveau 3).

## Comment tester à la main (ce que les tests ne couvrent pas)

1. **PDF, mise en page réelle** : ouvrir le PDF d'une version avec plus d'une page — en-tête du tableau répété en haut de
   chaque page, pied « n / N », lignes non coupées, tableaux larges lisibles en paysage (desktop Electron **et** web).
2. **E7** : sur une version en cours, section Exigences ouverte, exécuter un test (ou créer un lien de vérification) :
   la colonne Vérification suit sans recharger.
3. **Version released avant GH439** (si le projet en a) : colonne « — » et mention dédiée.
4. **Gros projet** : ouvrir la section Exigences et exporter (temps et mémoire).
5. **Anglais** : changer la langue, exporter en PDF : titres et en-têtes dans la langue de l'interface.
6. **Desktop Electron** : les scénarios ci-dessus passent aussi sur l'application (les e2e tournent sur le client web).
