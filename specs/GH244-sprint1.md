# GH244 — Sprint 1 : objet, liens, versions, graphe, MCP

## Fichiers modifiés

- `packages/types` (`issue.ts`, catégorie, `GraphIssue`, `viaIssues`, `NOT_OWN_ELEMENT`), `packages/zod-schemas` (`issue.schema.ts`).
- `issues.service.ts` (nouveau) : index, création, modification, `addRun`, réécritures brutes ; `issues.gh244.test.ts`.
- `schema.service.ts` : `issue-impact` ajouté avec le premier type issue. `workspace-links.service.ts` : issues dans les objets, contrôle du composant.
- `version-tracking.service.ts`, `versions.service.ts`, `version-analysis.util.ts` : issues dans le backlog, l'inclusion et la page ; exigences impactées racines.
- `schema-refs.util.ts`, `schema-delete.service.ts`, `type-rename.service.ts`, `field-rename.service.ts`, `tree.service.ts` : le type issue suit la cascade, les renommages et l'arbre.
- `graph.service.ts`, `polenta.d.ts`, manifeste v13 ; `tools/issues.tools.ts` ; canaux `issues:*`, `channel-policy.ts` ; `api-client`.

## Divergences par rapport au design

- Index des issues oublié par un abonnement à `RepoWatcherService`, sans changer son constructeur.
- Renommage de champ et de valeur inclus (`FieldRenameService`), non listé au design.
