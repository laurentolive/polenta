# GH201 — Sprint 1 : objet version côté main, graphe

## Fichiers modifiés

- `packages/types/src/product-version.ts` (nouveau) — `ProductVersion`, `VersionChange`, `VersionFreeze`,
  `VersionSummary`, `VersionComponentNode`, `VersionBacklogItem`, `VersionChangeRow`, `VersionPage`, DTO,
  codes d'erreur, `versionState`, `isValidTagName`, `suggestVersionTag`.
- `packages/types/src/schema.ts` — `ObjectCategory` + `version` ; `SchemaDeletePlan.errors` + `HAS_VERSIONS`.
- `packages/types/src/graph.ts` — `GraphVersion`, `PolentaGraph.versions`, `GraphRequirement.designVersion`,
  `GraphObjectCategory` + `version`.
- `apps/desktop/src/main/services/versions.service.ts` (nouveau) — CRUD, une version en cours par repo,
  verrou des versions figées, backlog, `base`, page (changements des dépendances postérieurs à `basedOn`),
  passage released (contrôles, commit du seul fichier, tag annoté avant avancée de la branche, mise en
  attente du push), lecture seule, statut de design.
- `apps/desktop/src/main/services/version-tracking.service.ts` (nouveau) — état d'un élément sur disque / à un
  commit (clé hors champs posés par l'application), modifications hors interface (reprise de
  `ChangeTrackingService` @ 4e06052).
- `sync.service.ts` — `queueTagPush`, `pushPendingTags` (après `push` / `pushBranch`), liste locale
  `<gitdir>/polenta-pending-tags` ; `commitSingleFile(…, beforeRefUpdate)`.
- `schema.service.ts` — `VERSION_TYPE_INVALID` : un type version, sur `root` ; nom / préfixe figés et retrait
  refusé tant que le repo a des versions.
- `schema-refs.util.ts`, `schema-delete.service.ts` — versions comptées, `HAS_VERSIONS`.
- `requirements-index.service.ts` — invalidation limitée aux instantanés `versions/<REQ>/vN.yaml`.
- `graph.service.ts` — collection `versions`, `designVersion` ; `setVersions`.
- `container.ts`, `mcp-server/container.ts`, `ipc/index.ts` (channels `versions:*`), `web-server/channel-policy.ts`
  (masqués : client web abandonné), `packages/api-client` (`api.versions`).
- Renderer (compilation seulement) : `objectTypeEditor.tsx` (pas de migration de renommage pour un type
  version), `NoTypeForCategory.tsx`, `objectCategoryColors.ts` (`chart-4`), i18n `schema.editor.version`.
- `resources/dashboard-lib/polenta.d.ts` régénéré, `manifest.json` version 11.
- Tests : `versions.gh201.test.ts` (20 tests).

## Comportement implémenté

Spec §1–§4, §5 (données de la page), §7 (statut de design), §8 (graphe). Voir `GH201-design.md`
§« Ajustements du sprint 1 » pour les points tranchés pendant la revue.

## Divergences par rapport au design

- Graphe avancé du sprint 3 au sprint 1 (un seul cran de manifeste).
- `basedOn` pré-rempli par le service quand il est absent.
- Code `STATUS_UNKNOWN` ajouté.

## Comment tester (sprint 1)

Pas d'interface encore (sprint 2). `pnpm --filter @polenta/desktop exec vitest run src/main/services/versions.gh201.test.ts`.
