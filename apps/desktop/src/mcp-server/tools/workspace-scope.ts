import type { McpContainer } from '../container'
import { repoKey } from '../../main/services/schema-refs.util'

/**
 * GH447 — repos du workspace vus par les outils sur les exigences et les tests.
 *
 * Un composant en repo séparé est un repo autonome : ses objets portent `root::<type>` (ou
 * `<nœud local>::<type>`), relatif à SON schéma, et l'application les lit et les écrit avec le
 * chemin de ce repo (repo sélectionné), comme un repo ouvert seul. Le MCP fait de même : un objet de
 * composant se lit et s'écrit avec un conteneur dont `repoPath` est celui du composant (`scoped`).
 *
 * Vers l'agent, les références d'un composant sont présentées sous son nom de montage
 * (`<montage>::<type>`, règle 8 de CLAUDE.md) : `workspaceRef` à la lecture, `localizeRef` à l'écriture.
 */
export interface RepoScope {
  repoPath: string
  /** Nom de montage du composant (`name` de sa dépendance) ; absent : repo racine. */
  component?: string
}

/** Repos du workspace, racine d'abord (arbre en cache de l'application) ; sans workspace : la racine seule. */
export async function workspaceScopes(c: McpContainer): Promise<RepoScope[]> {
  const root: RepoScope = { repoPath: c.repoPath }
  if (!c.workspaceDir) return [root]
  const tree = await c.workspaceTree.readCache(c.workspaceDir)
  const seen = new Set([repoKey(c.repoPath)])
  const scopes = [root]
  for (const node of tree?.nodes ?? []) {
    const key = repoKey(node.repoPath)
    if (seen.has(key)) continue
    seen.add(key)
    scopes.push({ repoPath: node.repoPath, component: node.name })
  }
  return scopes
}

/** Conteneur dont le repo ouvert est `scope` (même workspace), comme l'application pour un repo sélectionné. */
export function scoped(c: McpContainer, scope: RepoScope): McpContainer {
  return scope.repoPath === c.repoPath ? c : { ...c, repoPath: scope.repoPath }
}

/**
 * `<montage>::<type>` d'un composant en repo séparé → ce repo et la référence telle qu'il l'écrit
 * (`root::<type>`, ou `<nœud local>::<type>` pour `<montage>::<nœud local>::<type>`). Toute autre
 * référence reste au repo racine, inchangée.
 */
export function localizeRef(scopes: RepoScope[], ref: string): { scope: RepoScope; ref: string } {
  const sep = ref.indexOf('::')
  if (sep > 0) {
    const scope = scopes.find(s => s.component !== undefined && s.component === ref.slice(0, sep))
    if (scope) {
      const rest = ref.slice(sep + 2)
      return { scope, ref: rest.includes('::') ? rest : `root::${rest}` }
    }
  }
  return { scope: scopes[0], ref }
}

/** Inverse de `localizeRef` : référence d'un objet de `scope` telle que l'agent l'adresse. */
export function workspaceRef(scope: RepoScope, ref: string): string {
  if (!scope.component || !ref) return ref
  if (ref.startsWith('root::')) return `${scope.component}::${ref.slice('root::'.length)}`
  return `${scope.component}::${ref}`
}

/** Objet de catégorie `category` tel que l'agent le voit : `objectTypeRef` sous le nom de montage, `component`. */
export function presentObject<T extends { objectTypeRef: string }>(scope: RepoScope, obj: T): T & { component?: string } {
  if (!scope.component) return obj
  return { ...obj, objectTypeRef: workspaceRef(scope, obj.objectTypeRef), component: scope.component }
}

/**
 * Repo qui porte l'exigence / le test `id` (racine d'abord). Process sans watcher : si l'ID n'est
 * trouvé nulle part, les index sont relus une fois (objet créé par l'application entre-temps).
 */
export async function findOwnerScope(
  c: McpContainer, scopes: RepoScope[], category: 'requirement' | 'test', id: string,
): Promise<RepoScope | null> {
  const index = category === 'requirement' ? c.reqIndex : c.testsIndex
  const lookup = async () => {
    for (const scope of scopes) {
      if (await index.findById(scope.repoPath, id)) return scope
    }
    return null
  }
  const found = await lookup()
  if (found) return found
  for (const scope of scopes) index.invalidate(scope.repoPath)
  return lookup()
}

/** Écriture dans un composant épinglé ou monté en lecture seule (même règle que les liens et les versions). */
export async function isScopeReadonly(c: McpContainer, scope: RepoScope): Promise<boolean> {
  return scope.component !== undefined && await c.versions.isReadonly(scope.repoPath, c.workspaceDir)
}

/** Regroupe des éléments indexés par repo, dans l'ordre de la requête. */
export function groupByScope<T>(items: Array<{ index: number; scope: RepoScope; item: T }>): Array<{ scope: RepoScope; items: Array<{ index: number; item: T }> }> {
  const groups = new Map<string, { scope: RepoScope; items: Array<{ index: number; item: T }> }>()
  for (const { index, scope, item } of items) {
    const key = repoKey(scope.repoPath)
    const group = groups.get(key) ?? { scope, items: [] }
    group.items.push({ index, item })
    groups.set(key, group)
  }
  return [...groups.values()]
}
