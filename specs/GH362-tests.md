# GH362 — Scénarios de test

Unitaires (`apps/desktop/src/mcp-server/gh362.test.ts`), via `createMcpContainer` sur un repo git
temporaire et les handlers enregistrés. Pas d'e2e : aucun changement d'UI.

## Versions

1. **Cycle complet** : `create_version` → `include_in_version` (2 exigences) → `remove_from_version` (1) →
   `set_version_impact` → commit → `get_version_release_preview` sans problème → `release_version` :
   `freeze.tag` posé, le tag existe, statut d'approbation, historique `source: mcp`.
2. `update_version` (champs, label) sur une version en cours : écrit ; `status` vers released →
   `RELEASE_REQUIRED`.
3. Version released : `update_version { title }` → `VERSION_LOCKED` ; `update_version { status: abandonné }`
   accepté.
4. `release_version` avec un changement non commité → `DIRTY_CHANGES`, pas de tag, statut inchangé.
5. `release_version` avec un tag déjà pris → `TAG_EXISTS`.
6. `copy_version` : nouvelle version en cours, nouvel ID.
7. `set_version_impact` sur une version released → `NOT_IN_PROGRESS`.

## Validations

8. **Cycle** : `create_validation` sur une version released → `decide_validation` (exigence A) →
   `propose_validation_decision` (B) puis `reject_validation_decision` (B) → `propose` (B) puis
   `confirm_validation_decision` (B) : `get_validation.pendingCount === 0`, aucune entrée `proposed`,
   `decidedBy` = acteur MCP.
9. `create_validation` en double pour la même version → `VALIDATION_EXISTS` ; titre vide → `TITLE_EMPTY`.
10. `update_validation { title, fields }` : écrit.
11. `cancel_validation` : statut terminal ; toute écriture ensuite → `VALIDATION_LOCKED`.
12. Aucun outil nommé `*sign*` ; aucun outil de validation n'accepte `status` ; la validation reste non signée
    après le cycle 8 (signature possible ensuite par le service = l'humain).

## Garde-fous

13. Liste des outils enregistrés = liste attendue (test GH271 mis à jour).
