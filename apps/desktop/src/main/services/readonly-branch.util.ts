/**
 * Branche en lecture seule côté main process : `''` (HEAD détaché — baseline/tag) ou
 * `prj-*` (branche projet figée), même règle que `VersioningContext.isReadonly` côté
 * renderer. Factorisé depuis `DashboardSeedService` (GH18) pour que les tools MCP de la
 * vue Suivi appliquent exactement la même règle.
 */
export function isReadonlyBranch(branch: string): boolean {
  return branch === '' || branch.startsWith('prj-')
}
