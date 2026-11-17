# GH377 — Scénarios de test

Tests unitaires : `apps/desktop/src/main/services/mcp-schema.gh377.test.ts` — conteneur MCP réel sur un repo git
temporaire, handlers `add_object_type`, `create_version`, `create_validation` appelés comme le SDK (même harnais
que `mcp-writes.gh362.test.ts`). Pas d'e2e : outil MCP sans interface.

## Nominaux

1. **Version par défaut** — `add_object_type { root, { name: 'version', prefix: 'PV', category: 'version' } }` :
   statuts `en_cours` / `released` (`isApproval`) / `abandonnee` (`isTerminal`) avec libellés et couleurs ;
   `create_version` crée `PV-…` au statut `en_cours`.
2. **Validation par défaut** — idem `category: 'validation'` : trois statuts, cinq décisions (`en_attente`
   `isPending`, `non_conforme` / `derogation` `proposesIssue`) ; `create_validation` sur une version released
   réussit.
3. **Listes fournies** — statuts et décisions fournis écrits tels quels, sans fusion.
4. **entryFields** — écrits sans `trackHistory` / `defaultVisible` ; `requiredWhen: { decision: ['non_conforme'] }`
   accepté avec les décisions par défaut.

## Refus (schéma inchangé octet pour octet)

5. Validation : deux `isPending`, aucun `isApproval`, premier statut signé, `trackStatusHistory: false`,
   `decisions: []` → `VALIDATION_TYPE_INVALID`.
6. Version : aucun ou deux `isApproval` → `VERSION_TYPE_INVALID`.
7. Second type version / validation ; déclaration sur un composant local → `VERSION_TYPE_INVALID` /
   `VALIDATION_TYPE_INVALID`.
8. `prefix` absent ou vide → `VERSION_TYPE_INVALID` / `VALIDATION_TYPE_INVALID`.
9. entryFields : nom `decision`, nom en double → `FIELD_NAME_TAKEN` ; `requiredWhen` décision inconnue ou champ
   inconnu → `REQUIRED_WHEN_INVALID`.
10. `decisions` ou `entryFields` sur un type `requirement` → `VALIDATION_TYPE_INVALID`.

## Non-régression

11. Type `requirement` sans `statuses` : écrit sans statuts (comportement inchangé).
12. `emptyObjType('validation' | 'version', …)` de l'éditeur : mêmes défauts qu'avant (valeurs comparées).
