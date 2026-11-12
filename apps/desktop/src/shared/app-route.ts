/**
 * GH342 — route interne de l'application (`pathname?search`) ouverte dans une nouvelle fenêtre,
 * rouverte au lancement ou suivie depuis un lien direct (web). Partagé main / renderer / bridge
 * web : une seule définition de ce qui est acceptable.
 */

const MAX_ROUTE_LENGTH = 4096

/** Route interne (`/…`), jamais une URL, un chemin protocol-relative ni un `\` (que les navigateurs
 *  normalisent en `/`, donc `/\hôte` vaudrait `//hôte`). */
export function isValidAppRoute(route: unknown): route is string {
  return typeof route === 'string'
    && route.length > 0 && route.length <= MAX_ROUTE_LENGTH
    && route.startsWith('/') && !route.startsWith('//') && !route.includes('\\')
}

/** `pathname` et paramètres de recherche d'une route. */
export function splitAppRoute(route: string): { pathname: string; search: Record<string, string> } {
  const q = route.indexOf('?')
  return {
    pathname: q < 0 ? route : route.slice(0, q),
    search: Object.fromEntries(new URLSearchParams(q < 0 ? '' : route.slice(q + 1))),
  }
}

/** Projet de la route (`projectId`), s'il y en a un. */
export function routeProjectId(route: string): string | null {
  return splitAppRoute(route).search['projectId'] || null
}
