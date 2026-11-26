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
- Suite unitaire complète (apps/desktop) : **2 414 / 2 415** — le seul échec, `sync.service.gh414` › R2 (23,4 s pour une
  limite de 20 s), passe seul en 1,3 s : l'intermittence déjà suivie par #432 (commentaire ajouté). La veille, même
  signature sur `repo-conformity.gh336`.
- Suite e2e complète : **à lancer après le « Validé »** (niveau 3).

## Revue (`/code-review medium 440`)

- **Corrigé** : noms de feuille Excel avec apostrophe en tête ou en queue (refusés par Excel, y compris après la coupe à
  31 caractères) ; `buildVerification` réutilise `liveCoverage` (la valeur figée et l'affichage d'une version en cours
  lisent la matrice par le même code).
- **Assumé** : la couverture lit le workspace, pas le commit (précédent GH245), documenté en SPEC-REQ §11.5 ; l'ancienne
  préférence de repli de l'en-tête n'est pas migrée (spec § 2.2).
- **Limite connue** : la route imprimable ne signale pas d'erreur de lecture au moteur (comme les autres routes
  `print.*`) : l'export PDF attend alors le délai du moteur au lieu d'afficher la cause ; l'export Excel affiche l'erreur.

## Suite

- #441 : exposer `verification` au graphe de données et au MCP (hors périmètre, D8).

## Comment tester à la main (ce que les tests ne couvrent pas)

1. **PDF, mise en page réelle** : ouvrir le PDF d'une version avec plus d'une page — en-tête du tableau répété en haut de
   chaque page, pied « n / N », lignes non coupées, tableaux larges lisibles en paysage (desktop Electron **et** web).
2. **E7** : sur une version en cours, section Exigences ouverte, exécuter un test (ou créer un lien de vérification) :
   la colonne Vérification suit sans recharger.
3. **Version released avant GH439** (si le projet en a) : colonne « — » et mention dédiée.
4. **Gros projet** : ouvrir la section Exigences et exporter (temps et mémoire).
5. **Anglais** : changer la langue, exporter en PDF : titres et en-têtes dans la langue de l'interface.
6. **Desktop Electron** : les scénarios ci-dessus passent aussi sur l'application (les e2e tournent sur le client web).

## Révision 3 — périmètre de la liste (2026-11-26, après la validation locale)

Retour de l'humain en test : « les exigences listées doivent être uniquement celles disponibles dans la release » ; « tout est
listé dès la première release ». La spec (D1) listait **toutes** les exigences non terminales du repo à l'état de la version ;
la première release affichait donc tout le repo. Choix de l'humain : **contenu cumulé de la lignée**.

- **Règle** : une exigence est dans la version si elle est incluse (`changes`) dans la version ou dans une version released
  de sa lignée (`basedOn`) ; une version abandonnée de la lignée ne livre rien (comme le backlog) ; état lu au tag
  (disque pour une version en cours) ; non terminale ; type déclaré par le schéma du repo. La validation (GH204) garde son
  périmètre.
- **Code** : `VersionsService.availableIds` (remontée de `basedOn`, garde anti-cycle) ; `perimeterOf` ne lit que ces
  exigences (`requirementsOf(…, only)` : pas de lecture du repo entier) ; le gel de `verification` utilise le même
  périmètre que la page (une ligne par exigence disponible).
- **Tests** : S19–S25 (première release, lignée, version abandonnée, version en cours, terminale, élément non exigence ou
  absent, cycle) ; les tests existants incluent leurs exigences ; e2e : la version figée n'affiche ni l'exigence jamais livrée ni les
  exigences du projet de démo, la version en cours liste ce que sa lignée a livré puis ses propres inclusions.
- **Revue** : une release recalculait sa liste depuis la lignée d'aujourd'hui ; abandonner ensuite une version de la lignée
  l'aurait changée alors que sa couverture figée ne change pas. Le périmètre d'une release est maintenant celui de ses
  lignes `verification` (test S26) ; la lignée n'est lue que pour une version en cours ou sans couverture figée.
- **Limite connue** : une exigence livrée puis modifiée sans être réincluse s'affiche à son état **du tag** de la version
  consultée (pas à son état « livré »). Un ticket peut lire l'état de la dernière version qui l'a incluse.
- **Défaut trouvé par E13 et corrigé** : la grille « Exigences » gardait le même élément DOM d'une version à l'autre (même
  route) ; au retour par Précédent, la mémoire du défilement (nœud + décalage, GH300) se calculait sur les lignes de la
  version quittée et dérivait d'une ligne. La grille est maintenant remontée par version (`key={versionId}`), comme le
  veut la convention de SPEC-SYSTEM-VIEW (« une grille de page qui change d'entité sur la même route est remontée »).
  Les grilles Changements, Tests et Analyse de la page ont la même exposition (hors périmètre, jamais constatée).
  Conséquence sur le test E13 : l'échantillonneur de frames comptait aussi les frames de la page **quittée** (sa grille,
  neuve et donc en haut) ; avant la `key`, la grille gardait son DOM et se trouvait par hasard à la même position, ce
  qui masquait le problème. L'échantillonnage est limité à la page de destination.
- Leçon consignée : `tasks/lessons.md` (2026-11-26).
