# GH150 — Sprint 1 (unique)

## Fichiers modifiés

- `apps/desktop/src/main/services/field-merge.util.ts` (nouveau) : `mergeFields`.
- `apps/desktop/src/main/services/update-validation.util.ts` (nouveau) : `planUpdate`.
- `apps/desktop/src/main/services/requirements.service.ts`, `tests.service.ts` : option
  `removeNullFields` de `update()` (l'appli garde la fusion simple).
- `apps/desktop/src/mcp-server/tools/update.tools.ts` (nouveau) : `update_requirements`, `update_tests`.
- `apps/desktop/src/mcp-server/tools/parameters.tools.ts` (nouveau) : `list_parameters`,
  `set_parameters`, `delete_parameter`.
- `apps/desktop/src/mcp-server/container.ts` : `ParametersService` ; `index.ts` : enregistrement.
- `apps/desktop/src/main/services/agents-md.template.ts` : nouveaux outils, gabarit v6.
- `apps/desktop/src/main/services/update-tools.gh150.test.ts` (nouveau).

## Comportement

Conforme à `specs/GH150.md` et `specs/GH150-design.md`, avec les décisions du 27/10 :
`modificationComment` non exposé (#163), version d'un test inchangée en sortie d'approbation (#164).

## Divergences par rapport au design

- La suppression d'une clé à `null` n'est pas appliquée à l'appli : option `removeNullFields`
  réservée au MCP (repli prévu par le design), pour ne pas changer le comportement des écrans.
- `planUpdate` ne contrôle `required` / EARS que sur les champs modifiés par l'entrée.
- La règle « statut inconnu » est recopiée de `isUnknownStatus` (#160, GH149) tant que #160 n'est
  pas mergée ; à remplacer par l'import après merge.

## Mises à jour SPEC

- `SPEC-MCP-SERVER.md` §4.6 (nouveau) : outils de modification et de paramètres.
- `SPEC-INDEX.md` : ligne `SPEC-MCP-SERVER.md §global`, `MAJ` → GH150.

## Points d'attention

- Écrit sur un poste sans Node : **typecheck, lint et `pnpm test` non lancés**.
- Conflit attendu avec #160 sur `AGENTS_MD_TEMPLATE_VERSION` (les deux passent en v6) : le second
  mergé passe en v7.

## Tester manuellement

Depuis un client MCP sur un projet de test :
1. `update_requirements` en `dryRun` sur une exigence : aperçu, aucun fichier modifié.
2. `dryRun: false` avec `fields: { <champ>: null }` : champ retiré, autres conservés.
3. Exigence `approved` → `draft` : version +1, éléments liés `needsRevalidation`.
4. `set_parameters` puis `list_parameters` ; `delete_parameter` d'un paramètre utilisé : refus + usages.
