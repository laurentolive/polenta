# GH245 — Sprint 1 : analyse et tests à exécuter côté main, graphe, MCP

## Fichiers modifiés

- `packages/types/src/product-version.ts` — `VersionImpacted`, `VersionImpactStep`, `VersionImpactSource`,
  `VersionImpactRow`, `VersionImpactRoot`, `VersionAnalysis`, `VersionTestToRun`, `VersionTestsToRun` ;
  `ProductVersion.impacted`, `.analysis` ; code `VERSION_ABANDONED`.
- `packages/types/src/impact-analysis.ts` — `IMPACT_ANALYSIS_STATUSES`.
- `packages/types/src/graph.ts` — `GraphVersion.impacted`, `GraphVersion.analysis` (lignes, sans arbres).
- `apps/desktop/src/main/services/version-analysis.util.ts` (nouveau) — `computeVersionAnalysis`
  (racines, lignes du repo, sources avec chemin, statuts reportés sur les nœuds), `computeVersionTests`.
- `versions.service.ts` — `setImpactSources`, `analysis`, `setImpact`, `testsToRun` ; analyse figée (sans
  arbres) écrite au passage released.
- `graph.service.ts`, `container.ts`, `mcp-server/container.ts`, `ipc/index.ts` (`versions:analysis`,
  `versions:set-impact`, `versions:tests`), `web-server/channel-policy.ts`, `packages/api-client`.
- `mcp-server/tools/versions.tools.ts` — `get_version_impact`, `get_version_tests`.
- `resources/dashboard-lib/polenta.d.ts` régénéré, `manifest.json` v12.
- Tests : `versions.gh245.test.ts`.

## Divergences par rapport au design

- Analyse figée sans les arbres (revue : volume, chemins locaux) ; version released sans analyse
  (antérieure) : analyse vide, pas de recalcul.
- Un test seulement atteint garde les instances des exigences qui l'amènent (il n'est « entier » que s'il
  est lui-même changé ou amené par aucune exigence).

## Comment tester

`npx vitest run src/main/services/versions.gh245.test.ts` (interface : sprint 2).
