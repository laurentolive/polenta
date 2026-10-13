# GH69 — Sprint 1 (unique) : widget « Matrice »

Spec : [GH69.md](GH69.md) — Design : [GH69-design.md](GH69-design.md) — Tests : [GH69-tests.md](GH69-tests.md).

## Fichiers modifiés

| Fichier | Modification |
|---|---|
| `packages/types/src/dashboard.ts` | `WidgetType` + `'matrix'` ; `WidgetFieldMapping.label` ; `CAMPAIGN_ENTRY_FIELDS` + `campaignCreatedAt` |
| `apps/desktop/src/main/services/query-engine.service.ts` | colonne `campaignCreatedAt` (= `TestCampaign.createdAt`) dans `campaign_entries` |
| `apps/desktop/src/main/services/suivi-validation.util.ts` | règles de mapping `matrix` (requis : category/series/measure ; autorisé : + label) ; `mappingColumns` inclut `label` |
| `apps/desktop/src/mcp-server/tools/dashboards.tools.ts` | type `matrix`, clé `label`, descriptions |
| `apps/desktop/src/mcp-server/tools/queries.tools.ts` | `WIDGET_MAPPING_BROKEN` calculé sur le mapping élagué au type (`pruneMapping`) |
| `apps/desktop/src/renderer/lib/runStatus.ts` *(nouveau)* | libellés / classes de statut déplacés de la route campagne ; `RUN_STATUS_SEVERITY`, `isTestRunStatus`, `worstRunStatus` |
| `apps/desktop/src/renderer/routes/campaign.$campaignId.tsx`, `print.campaign-report.tsx` | importent depuis `lib/runStatus` ; `parseRunStatus` via `isTestRunStatus` |
| `apps/desktop/src/renderer/components/dashboard/widgets/matrix.ts` *(nouveau)* | pivot pur `buildMatrix` / `aggregateCell` |
| `apps/desktop/src/renderer/components/dashboard/widgets/MatrixWidget.tsx` *(nouveau)* | rendu (sticky, pastilles, `×n`, infobulles), drill-down cellule, ouverture d'en-tête |
| `apps/desktop/src/renderer/components/dashboard/widgets/WidgetRenderer.tsx` | `case 'matrix'` |
| `apps/desktop/src/renderer/components/dashboard/WidgetConfigModal.tsx` | type « Matrice » (grille de types 3 × 2), formulaire Lignes / Libellé / Colonnes / Valeur, `mappingComplete`, `applicableMapping` à l'enregistrement |
| `apps/desktop/src/renderer/components/dashboard/QueryBuilder.tsx` | `campaignCreatedAt` typé date |
| `apps/desktop/src/renderer/i18n/locales/fr.json`, `en.json` | libellés du widget, état vide, champ builder `campaignCreatedAt` |
| Tests | `widgets/matrix.test.ts`, `lib/runStatus.test.ts`, `suivi-validation.matrix.test.ts`, `query-engine.campaigns.test.ts` (N1), `e2e-web/gh69-matrix.spec.ts` |

## Comportement implémenté

Conforme à la spec : nouveau type de widget « Matrice » sur toute requête. Lignes triées en ordre
naturel, colonnes dans l'ordre du résultat. Cellule à statuts : pire statut coloré + `×n` + infobulle
(statuts du plus grave au moins grave) ; nombres : somme ; autres : valeurs distinctes jointes ;
absent : « · ». Clic cellule → popup Détail (GH65) ; clic en-tête en forme d'ID → objet.

## Divergences par rapport au design / à la spec

Issues de la revue de code (`/code-review`), spec et SPEC mises à jour en conséquence :
- **En-têtes cliquables** : seulement si la valeur a la forme d'un ID d'objet
  (`/^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*-\d+$/`), et non toute chaîne non vide — une date, un statut ou un
  titre n'ouvraient jamais rien (mention « introuvable » trompeuse). Scénario L6 adapté.
- **Libellé de ligne** : dernière occurrence au lieu de la première — avec la requête chronologique
  recommandée, c'est le titre le plus récent (`testTitle` est un snapshot par entrée).
- **Enregistrement depuis l'app** : seules les clés applicables au type sont enregistrées
  (`applicableMapping`) — un `label` de matrice ne survit plus à un passage en barres. Les clés
  communes (`category`/`series`/`measure`) restent conservées au changement de type, comme avant.
- **Non prévu au design** : `suivi-validation.util.ts` (règles de mapping MCP, révélé par le
  typecheck) et `queries.tools.ts` (avertissement sur mapping élagué).
- Grille des types de widget en 3 colonnes (6 types).

Non retenus de la revue : regroupement par libellé `toLabel` (1 et « 1 » fusionnés — même
comportement que barres/courbe) ; réutilisation de `rawValueIndex` (la matrice a besoin du tri et du
libellé dans la même passe).

## Mises à jour SPEC

- `SPEC-DASHBOARDS.md` §2.1 — colonne `campaignCreatedAt`.
- `SPEC-DASHBOARDS.md` §4 — 6 types de widget ; nouvelle §4.2 « Widget matrice » (mapping, ordre,
  agrégation, affichage, navigation, enregistrement, exemple).
- `SPEC-MCP-SERVER.md` §global — règles widget : mapping `matrix`.
- `SPEC-INDEX.md` — lignes SPEC-DASHBOARDS §2, §4 et SPEC-MCP-SERVER §global → MAJ `GH69`, mots-clés.

## Vérifications

- `pnpm typecheck` : 0 erreur. Lint : aucune tâche configurée dans le repo.
- `vitest` : 276 tests verts (dont 21 nouveaux).
- E2E web : suite complète verte avant revue (44 passés, 13 ignorés — forge distante) ; après
  corrections : `gh69`, `gh65-*`, `parity` relancés — 18/18 verts.

## Tester manuellement

1. Vue **Suivi** → Requêtes : nouvelle requête SQL
   `SELECT testCaseId, testTitle, campaignId, campaignCreatedAt, status FROM campaign_entries ORDER BY campaignCreatedAt`.
2. Un dashboard → « Ajouter un widget » → type **Matrice** : Lignes `testCaseId`, Libellé `testTitle`,
   Colonnes `campaignId`, Valeur `status`, taille Large.
3. Vérifier : campagnes dans l'ordre de création, tests en ordre naturel, couleurs, `×n` + infobulle
   sur un test itérant, « · » pour un test absent d'une campagne.
4. Clic sur une cellule → popup Détail → clic sur une entrée exécutée → résultat d'exécution.
5. Clic sur un en-tête de test / de campagne → onglet ouvert ; Colonnes = `campaignTitle` → en-têtes
   non cliquables.
6. Grande matrice (L8), thème sombre (L11), impression du dashboard (L10).
