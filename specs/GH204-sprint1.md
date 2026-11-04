# GH204 — Sprint 1 : socle de la validation

## Fichiers

- **Nouveaux** : `packages/types/src/validation.ts` ; `packages/zod-schemas/src/validation.schema.ts` ;
  `main/services/validations.service.ts`, `validation-rows.util.ts`, `validations.gh204.test.ts` ;
  `mcp-server/tools/validations.tools.ts`.
- **Modifiés** : `versions.service.ts` (statut de design P1, `requirementsOf`, `componentVersions`, suppression refusée) ;
  `version-tracking.service.ts` ; `schema.service.ts`, `schema-delete.service.ts`, `schema-refs.util.ts` ;
  `graph.service.ts`, `polenta.d.ts`, manifeste ; `merge-core/structure.ts` ; `issues.service.ts` (`addDecision`) ;
  IPC, `api-client`, `channel-policy.ts`, containers ; éditeur de schéma (`objectTypeEditor`, `ElementConfigModal`,
  `StructureTab`).

## Comportement

Objet, type, décisions, reprise, « à revoir », signature, annulation, propositions du MCP : conformes aux §1 à §6 et
§8 de la spec. Aucun écran de validation à ce stade, hors configuration du type dans `/schema`.

## Divergences par rapport au design

- `validationTypeError` remplace `validationTypeIssues` : une seule erreur suffit à refuser.
- L'éditeur de schéma est livré dès ce sprint : les tables `Record<ObjectCategory, …>` l'exigeaient pour compiler.
- `comment` est du texte simple, pas du richtext (spec §1, exemple `<p>…</p>`) : pas d'image dans un commentaire, et pas
  d'écriture de fichiers annexes à chaque décision.
