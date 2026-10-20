# GH70 — Sprint 2 : affichage des colonnes calculées dans les vues

> Spec : [GH70.md](GH70.md) — design : [GH70-design.md](GH70-design.md) §3.1–§3.7 — tests :
> [GH70-tests.md](GH70-tests.md) — sprint 1 : [GH70-sprint1.md](GH70-sprint1.md)

## Fichiers modifiés

| Fichier | Modification |
|---|---|
| `apps/desktop/src/renderer/hooks/useComputedColumns.ts` (nouveau) | colonnes applicables au type, exécution des colonnes visibles, fusion `query::<ID>` dans les objets, `columnsMap` / `exportColumns` / `filterFields` / `ready` |
| `apps/desktop/src/renderer/components/system/SystemView.tsx` | branchement du hook, section « Colonnes calculées » du panneau ⚙️, clés inconnues ignorées, exports (libellé + type, refus si calcul en cours), ouverture de la cible, aucune écriture `query::` |
| `apps/desktop/src/renderer/components/system/ExcelView.tsx` | colonne en lecture seule (`isSystemField`), en-tête `(calc)` + ⚠, cellule : infobulle, double-clic → cible, `…` en attente, richtext mis en forme, largeur auto |
| `apps/desktop/src/renderer/components/system/WordView.tsx` | `ComputedField` dans la carte (lecture seule, infobulle, clic → cible) |
| `apps/desktop/src/renderer/lib/exportColumns.ts` | `ExtraExportColumns` (libellé + type des colonnes hors schéma) |
| `apps/desktop/src/renderer/routes/print.requirements.tsx`, `print.tests.tsx` | valeurs des colonnes cochées en Document, impression attendant les résultats |
| `apps/desktop/src/renderer/components/campaign/TestPickerGrid.tsx`, `TestPickerModal.tsx` | colonnes du sélecteur de tests (sans ouverture) ; `workspaceDir` transmis |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | `system.fieldConfig.computedColumns`, `system.computed.exportPending` |
| `specs/SPEC-*.md`, `SPEC-INDEX.md` | cf. § Mises à jour SPEC |
| Tests : `renderer/lib/exportColumns.test.ts` (nouveau), `e2e-web/gh70-computed-column.spec.ts` (nouveau, 7 tests) | |

## Comportement implémenté

- Panneau ⚙️ (Tableau et Document) : section « Colonnes calculées » listant les requêtes partagées du
  projet dont `column` s'applique au type affiché ; décochées par défaut ; clé `query::<ID>`.
- Vue Tableau : colonne rendue selon le type déclaré, en lecture seule, infobulle `tooltip`,
  double-clic → cible `_ids[0]` (entrée de campagne → page d'exécution de l'entrée, comme le
  drill-down des widgets), `…` pendant le calcul (la vue n'attend pas), ⚠ dans l'en-tête si le
  script est en erreur ; filtrable (T51) ; rafraîchie sans rechargement quand un résultat est saisi.
- Vue Document : valeur dans la carte, mêmes règles.
- Exports xlsx / docx (Standard et gabarit) : colonne avec libellé et type ; refus explicite si le
  calcul n'est pas terminé. Impression PDF : attend les résultats (ou l'échec de la résolution).
- Sélecteur de tests d'une campagne : colonnes visibles dans la configuration Tableau affichées,
  infobulle, pas d'ouverture (lecture seule GH33).
- Requête supprimée / rendue privée / non applicable : colonne retirée des vues et exports, clé
  jamais réécrite dans les préférences.
- Aucun code de Polenta propre aux campagnes pour cette colonne (critère 14) : le hook et les vues
  ne connaissent que le contrat de ligne.

## Divergences par rapport au design

- **Exécution** : un script tourne si sa colonne est cochée dans l'onglet Tableau **ou** Document
  (design / spec §6.4 : vue courante seulement), pour que l'export de l'autre format ait ses valeurs.
  Coût : une exécution par colonne et par rafraîchissement, contexte préparé partagé.
- **Richtext** : rendu par `StaticRichTextViewer` dans le chemin lecture seule d'`InlineCell` (sans
  le rendu paresseux T169) — garde infobulle, ouverture et `…`.
- **Largeur auto** : l'en-tête d'une colonne calculée réserve la place de `(calc)` et de l'icône de
  filtre (sinon recouverte par la colonne suivante).
- Revue de code : correctifs intégrés (richtext, impression jamais bloquée, type exporté, export
  pendant le calcul, message d'erreur rafraîchi, dérivés centralisés dans le hook). Non retenu :
  limiter l'exécution à la vue affichée (cf. ci-dessus) ; position d'une clé `query::` inconnue
  lors d'un changement de colonnes dans ⚙️ (déplacée en fin de liste, conservée).

## Mises à jour SPEC

| Section | Modification |
|---|---|
| `SPEC-DASHBOARDS.md` §4 | `lastEntryResult(s)` (campaign.js v3) |
| `SPEC-DASHBOARDS.md` §5, §5.2 (nouvelle) | modèle `campaign-last-result` ; colonnes calculées : déclaration, contrat de ligne, validation, empreinte, saisie, exécution |
| `SPEC-DASHBOARDS.md` §7.0 | `column?` dans `query.yaml` (jamais dans le `.pref`) |
| `SPEC-DASHBOARDS.md` §10 | hors scope GH70 |
| `SPEC-SYSTEM-VIEW.md` §Vue Excel, §Vue Word, §Configuration des champs, §Persistance | colonnes calculées |
| `SPEC-MCP-SERVER.md` §4.5 | `column` dans `list_queries` / `create_query` / `update_query`, `COLUMN_INVALID` / `COLUMN_PRIVATE` |
| `SPEC-TECH-stack.md` §1.1 | mécanisme générique livré (GH70), exemple « Dernier résultat » |
| `SPEC-INDEX.md` | colonne `MAJ` → GH70 pour les 5 lignes concernées, mots-clés |

## Résultats des tests

- `pnpm test` : 65 fichiers, 735 tests passés (dont `exportColumns.test.ts`).
- TypeScript (`tsc --noEmit`) : 0 erreur (pas de lint configuré dans le repo).
- E2E web, suite complète : 126 passés, 13 ignorés (tests OIDC sans accès SSH), 0 échec — dont
  `gh70-computed-column.spec.ts` 7/7 et `gh70-query-column.spec.ts` 4/4. Échecs rencontrés en
  cours de sprint : icône de filtre recouverte (corrigé dans le code, largeur auto) ; assertions
  du test d'ouverture (l'entrée s'ouvre sur sa page d'exécution, pas sur la campagne).

## Tester manuellement

1. Projet de démo : Vue Suivi → Requêtes → Ajouter → modèle « Dernier résultat de campagne
   (colonne) » → Enregistrer sous… (Partagé).
2. Vue Tests, un type de test, ⚙️ → « Colonnes calculées » → cocher « Dernier résultat » : statut de
   la dernière entrée exécutée, vide pour un test jamais exécuté en campagne ; survol = campagne,
   date, exécutant ; double-clic = page de l'entrée.
3. Saisir un résultat dans une campagne : la cellule change sans recharger.
4. Filtre de colonne « FAIL » ; Vue Document (cocher dans l'onglet Document) ; export Excel.
5. Requête script `throw new Error('x')` déclarée en colonne : ⚠ dans l'en-tête, vue utilisable.
6. Sélecteur de tests d'une campagne (Ajouter des tests) : colonne visible, infobulle.

## Correctif après test utilisateur (projet PH2)

**Symptôme** : modèle « Dernier résultat de campagne » → `SyntaxError: Could not find export
'lastEntryResults' in module 'lib/campaign.js'`, sans proposition de mise à jour au bandeau.

**Cause** (antérieure à GH70) : GH112 a modifié `campaign.js` en place en le laissant « v1 » et a
**remplacé** l'empreinte v1 du manifeste (`c9fd…`, version GH74) par la sienne (`0ec9…`), en
supposant la v1 jamais déployée. Un projet seedé avec la version GH74 (PH2) a une empreinte
inconnue : le fichier passe pour « modifié par le projet » et sa mise à jour n'est jamais proposée.

**Correctif** : historique de `campaign.js` renuméroté dans le manifeste — v1 = GH74 (`c9fd…`),
v2 = GH112 (`0ec9…`), v3 = GH70 (en-tête `// @polenta-lib campaign 3`). La détection se fait par
empreinte uniquement : les projets en GH74 ou GH112 se voient proposer la v3. Test de non-régression
`dashboard-lib.test.ts` (empreintes GH74 / GH112 toujours connues, toutes distinctes).

**Pour tester dans PH2** : relancer l'app (manifeste relu), Vue Suivi → bandeau « Mises à jour
disponibles » → `dashboards/lib/campaign.js` 1 → 3 → Appliquer ; la requête « Dernier résultat »
s'exécute alors.
