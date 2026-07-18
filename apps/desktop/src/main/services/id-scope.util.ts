/**
 * Shared convention for "private" object IDs across T77 (SavedQuery, Dashboard).
 *
 * A privately-stored object (kept in `.{username}.pref`, never committed) gets a
 * locally-generated ID with this prefix; a shared object (YAML file versioned in
 * the repo) gets a counter-based ID instead (`QUERY-0001`, `DASHBOARD-0001`…).
 *
 * The prefix lets any service tell a private ref apart from a shared one from the
 * ID string alone, with no extra lookup — used by `dashboards.service.ts` to check
 * whether a widget's `queryId` points at a private or shared `SavedQuery` without
 * importing `SavedQueriesService` (which would create a circular dependency, since
 * `SavedQueriesService` imports `DashboardsService` for `findDependentWidgets`).
 */
export const PRIVATE_ID_PREFIX = 'local-'

export function isPrivateScopeId(id: string): boolean {
  return id.startsWith(PRIVATE_ID_PREFIX)
}

export function generatePrivateId(): string {
  return `${PRIVATE_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
