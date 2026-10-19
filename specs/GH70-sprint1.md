# GH70 — Sprint 1 : déclaration, stockage, MCP, bibliothèque, saisie

> Spec : [GH70.md](GH70.md) — design : [GH70-design.md](GH70-design.md) §1, §2, §3.8 — tests :
> [GH70-tests.md](GH70-tests.md)

## Fichiers modifiés

| Fichier | Modification |
|---|---|
| `packages/types/src/suivi-columns.ts` (nouveau), `index.ts` | `QueryColumnDef`, `validateColumnDecl`, `columnAppliesTo`, `columnValuesFromRows`, `columnFieldDef`, `columnLabel`, clés `query::<ID>`, `COMPUTED_COLUMN_TYPES` / `_CATEGORIES` |
| `packages/types/src/suivi-params.ts` | `validLabel` exporté (réutilisé pour le libellé de colonne) |
| `packages/types/src/suivi-format.ts`, `dashboard.ts` | `column` stocké / lu ; `SavedQuery.column` + `columnError` |
| `packages/types/src/suivi-templates.ts` | `queryCodeForHash(script, parameters, column?)` (inchangée sans colonne), `QueryTemplate.column?()`, `queryCode` renvoie `column`, modèle `campaign-last-result`, `describeTemplates` sans fonctions |
| `packages/api-client/src/types.ts` | DTO `column`, `renderTemplate` / `templates()` typés |
| `apps/desktop/src/main/services/saved-queries.service.ts` | lecture / écriture / validation de `column`, refus `[COLUMN_INVALID]` / `[COLUMN_PRIVATE]`, `setScope` |
| `apps/desktop/src/main/services/suivi-store.util.ts`, `suivi.service.ts`, `suivi-validation.util.ts` | colonne générée par le modèle, aperçu, codes d'erreur |
| `apps/desktop/src/mcp-server/tools/queries.tools.ts`, `suivi-common.ts` | `column` dans `create_query` / `update_query` / `list_queries` |
| `apps/desktop/src/main/services/agents-md.template.ts` | paragraphe « Colonnes calculées » |
| `apps/desktop/resources/dashboard-lib/campaign.js`, `manifest.json` | `lastEntryResults` / `lastEntryResult`, version 2 |
| `scripts/demo-lave-linge/content.mjs`, `generate.mjs` | requête `QUERY-0010` « Dernier résultat de campagne » |
| `apps/desktop/src/renderer/components/dashboard/ColumnDeclEditor.tsx` (nouveau), `routes/query.tsx` | section « Colonne des vues » de la vue `/query` |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | `queryPage.column.*` |
| Tests : `suivi-columns.test.ts` (nouveau, 22 tests), `suivi-corpus.test.ts` + `fixtures/suivi-corpus/demo-columns.json`, `dashboard-library.service.test.ts` (liste des modèles), `e2e-web/gh70-query-column.spec.ts` (nouveau) | |

## Comportement implémenté

- Une requête **partagée** peut porter `column` dans `query.yaml` (libellé bilingue ou texte,
  `appliesTo.categories` / `objectTypes`, `type` de champ hors `drawio`, `values` pour un enum).
  Absente : rien n'est écrit, `column: null`, **empreinte identique à avant GH70** (aucun seed
  détaché, vérifié sur les seeds Campagnes).
- Requête privée : déclaration refusée (`[COLUMN_PRIVATE]`) à la création, à la mise à jour, par
  un modèle qui génère une colonne, et via le MCP (dry-run compris). Un `.pref` édité à la main
  qui en porte une : signalée (`columnError`), ignorée.
- Déclaration lue invalide : `columnError`, la requête reste exécutable en Suivi ; la réécrire
  sans corriger (titre seul…) est refusée, comme `parametersError` (GH93).
- Passage partagé → privé : la déclaration est retirée ; si la requête venait d'un modèle qui
  génère une colonne, sa référence de modèle aussi (la copie privée est un script personnalisé).
- Modèle « Dernier résultat de campagne (colonne) » (`campaign-last-result` v1) : une ligne par
  test exécuté en campagne `{ id, value: statut, tooltip, _ids: [CAMP/entrée] }`, colonne
  « Dernier résultat » / « Last result », `categories: [test]`, enum `PASS, FAIL, BLOCKED,
  INCOMPLETE`. Règles dans `lib/campaign.js` (`lastEntryResults`) : entrée active exécutée la plus
  récente, toutes campagnes, abandonnées comprises, runs hors campagne ignorés. `lastResult(s)`
  inchangée.
- Vue `/query` : section « Utiliser comme colonne dans la Vue Système » (libellé, catégories,
  types précis, type de champ, valeurs), erreurs en direct qui bloquent l'enregistrement,
  avertissement si la colonne n'est proposée pour aucun type, lecture seule en mode modèle,
  désactivée sur une requête privée, refus explicite dans « Enregistrer sous… » en privé.
- MCP : `column` en entrée de `create_query` / `update_query` (`null` retire), renvoyé par
  `list_queries` (+ `columnError`) ; `AGENTS.md` documente le contrat de ligne.

## Divergences par rapport au design

- **Éditeur actif sur une requête non enregistrée** (design §3.8 : désactivé) : on peut déclarer la
  colonne avant le premier enregistrement ; « Enregistrer sous… » propose alors *Partagé* par défaut
  et refuse *Privée*. Plus direct pour une requête écrite à la main.
- **Pas de confirmation au passage en privé** (design §3.8) : l'application n'a aucune action UI
  pour changer la portée d'une requête (seul le service l'expose ; le MCP ne le permet pas). Le
  retrait de la colonne est fait par le service ; à reprendre si une telle action est ajoutée.
- `columnFieldDef(queryId, decl, locale)` prend la langue (libellé résolu une fois).
- Revue de code : correctifs intégrés (déclaration cassée retirable depuis `/query`, modèle à
  colonne sur requête privée bloqué dans l'UI et le dry-run MCP, libellé bilingue conservé à
  l'édition, `values: null` toléré, catégories partagées entre types, MCP et éditeur).

## Résultats des tests

- `pnpm test` : 64 fichiers, 733 tests passés (dont `suivi-columns.test.ts` 22, corpus avec la
  nouvelle référence `demo-columns.json`).
- TypeScript (`tsc --noEmit`) : 0 erreur. Pas de lint configuré dans le repo (ESLint sans fichier
  de configuration).
- E2E web : `gh70-query-column.spec.ts` 4/4 ; suite complète 116 passés, 13 ignorés (tests OIDC
  sans accès SSH), aucun échec hors GH70 (l'échec initial de N2 venait du test : après un
  rechargement l'app revient au tableau de bord, la requête est maintenant rouverte).

## Mises à jour SPEC

Aucune à ce sprint (dernier sprint : sprint 2).

## Tester manuellement

1. Vue Suivi → Requêtes → Ajouter ; modèle « Dernier résultat de campagne (colonne) » ; la section
   « Colonne des vues » montre la colonne générée (lecture seule). Enregistrer sous… → *Partagé*
   présélectionné ; choisir *Privée* → message de refus.
2. Enregistrer en partagé : `queries/QUERY-xxxx/query.yaml` contient `column`.
3. Requête script partagée : cocher « Utiliser comme colonne », type `enum` sans valeur → erreur,
   Sauvegarder grisé ; ajouter des valeurs → enregistrable ; recharger → relu.
4. Modifier `query.yaml` à la main (`type: drawio`) → bandeau d'erreur dans `/query`, exécution OK.
5. MCP : `create_query { title, script, column }` puis `list_queries` → `column` présent.
