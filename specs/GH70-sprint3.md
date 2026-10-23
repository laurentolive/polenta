# GH70 — Sprint 3 : colonne indépendante du modèle (A), colonnes du résultat choisies (B)

> Spec : [GH70.md](GH70.md) §9 — design : [GH70-design.md](GH70-design.md) §7 — sprints
> précédents : [GH70-sprint1.md](GH70-sprint1.md), [GH70-sprint2.md](GH70-sprint2.md)

Demande après test dans PH2 (2026-10-20) : devoir passer par un modèle dédié ou réécrire une requête
en Script manquait de souplesse.

## Fichiers modifiés

| Fichier | Modification |
|---|---|
| `packages/types/src/suivi-columns.ts` | `idColumn` / `valueColumn` / `tooltipColumn` (validés, défauts `id` / `value` / `tooltip`) ; `columnValuesFromRows(rows, decl)` ; infobulle texte ou nombre seulement |
| `packages/types/src/suivi-templates.ts` | `queryCodeForHash(script, parameters)` sans la colonne ; `legacyQueryCodeForHashWithColumn` (compatibilité) |
| `apps/desktop/src/main/services/saved-queries.service.ts` | colonne acceptée avec un modèle (fournie > actuelle > proposée par un modèle nouveau) ; colonne proposée ignorée en privé ; empreinte d'avant reconnue puis réécrite (`refreshedHash`) ; `setScope` conserve le modèle |
| `apps/desktop/src/mcp-server/tools/queries.tools.ts`, `suivi-common.ts` | `template` + `column` acceptés, mêmes règles, champs de colonnes du résultat (nullables) |
| `apps/desktop/src/main/services/agents-md.template.ts` | contrat de ligne mis à jour |
| `apps/desktop/src/renderer/hooks/useComputedColumns.ts` | déclaration passée à `columnValuesFromRows` |
| `apps/desktop/src/renderer/components/dashboard/ColumnDeclEditor.tsx` | listes « Colonne identifiant / valeur / infobulle » (colonnes du dernier résultat) |
| `apps/desktop/src/renderer/routes/query.tsx` | éditeur actif en mode modèle ; préremplissage par le modèle sans écraser une saisie ; colonne préremplie non modifiée non « fournie » (privé possible) |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | libellés des listes, contrat |
| `specs/SPEC-DASHBOARDS.md` §5.2, `SPEC-MCP-SERVER.md` §4.5, `SPEC-INDEX.md`, `GH70.md` §9, `GH70-design.md` §7 | |
| Tests : `suivi-columns.test.ts` (25), `e2e-web/gh70-query-column.spec.ts` (+1), `gh70-computed-column.spec.ts` (+1) | |

## Comportement implémenté

- **A** — Toute requête partagée, y compris générée par un modèle, peut être déclarée en colonne
  depuis `/query` (mode modèle ou Script) ; déclarer, modifier ou retirer la colonne ne la détache
  pas de son modèle. « Dernier résultat de campagne » reste un exemple qui propose sa colonne.
  Réappliquer le même modèle garde la colonne actuelle (même retirée) ; un autre modèle propose la
  sienne si la requête n'en a pas.
- **B** — La déclaration choisit les colonnes du résultat : ex. requête « Entrées de campagne »
  (modèle, sans code) avec identifiant `testCaseId`, valeur `status`, infobulle `campaignTitle` →
  colonne « Statut en campagne » dans la Vue Tests. Colonne absente du résultat → ⚠ « colonne « X »
  manquante ». Plusieurs lignes pour un élément : la première est retenue (règle du script).
- Compatibilité : une requête créée aux sprints 1–2 (PH2) dont l'empreinte comptait la colonne
  reste non personnalisée ; l'empreinte est réécrite au calcul actuel à la prochaine écriture.

## Revue de code

Corrigé : empreinte d'avant qui rendait la requête personnalisée au premier changement de colonne ;
colonne retirée réintroduite en réappliquant le modèle ; préremplissage qui écrasait une saisie ;
colonne seulement proposée bloquant l'enregistrement en privé ; infobulle `[object Object]` ;
champs de colonnes du résultat non nullables côté MCP. Non retenu : option « aucune infobulle »
(une colonne `tooltip` présente dans le résultat est toujours utilisée), factorisation de la
règle de priorité entre MCP et service, triple calcul d'empreinte à la lecture (coût négligeable).

## Résultats des tests

- `pnpm test` : 65 fichiers, 739 tests passés (`suivi-columns.test.ts` : 25).
- TypeScript (`tsc --noEmit`) : 0 erreur (un cast de test corrigé après la suite complète).
- E2E web, suite complète : 128 passés, 13 ignorés (tests OIDC sans accès SSH), 0 échec — dont
  `gh70-query-column.spec.ts` 5/5 et `gh70-computed-column.spec.ts` 8/8.

## Tester manuellement

1. Vue Suivi → requête existante « Entrées de campagne » (ou Ajouter → ce modèle) → Exécuter.
2. « Utiliser comme colonne dans la Vue Système » : libellé « Statut en campagne », Tests, type
   `text`, Colonne identifiant `testCaseId`, Colonne valeur `status`, Colonne infobulle
   `campaignTitle` → Sauvegarder : la requête reste en mode modèle (non personnalisée).
3. Vue Tests → ⚙️ → « Colonnes calculées » → cocher « Statut en campagne ».
4. PH2 : la requête « Dernier résultat » créée avant reste non personnalisée ; modifier son libellé
   de colonne ne la détache pas.
