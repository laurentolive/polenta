import { z } from 'zod'
import type { VersionComponentNode } from '@polenta/types'
import type { McpContainer } from '../container'

/** Paramètre `component` commun aux outils des versions, issues et validations. */
export const componentSchema = z.string().optional()
  .describe('Composant (nom du repo dans le workspace, cf. list_versions) ; absent : le repo ouvert')

export const flattenComponents = (nodes: VersionComponentNode[]): VersionComponentNode[] =>
  nodes.flatMap(n => [n, ...flattenComponents(n.children)])

/** Chemin du repo d'un composant du workspace (nom de montage) ; absent : le repo ouvert. */
export function componentRepoResolver(container: McpContainer): (component?: string) => Promise<string> {
  return async component => {
    if (!component) return container.repoPath
    const node = flattenComponents(await container.versions.tree(container.repoPath, container.workspaceDir)).find(n => n.name === component)
    if (!node) throw new Error(`Composant introuvable : ${component}`)
    return node.repoPath
  }
}

/**
 * GH362 — comme `componentRepoResolver`, pour une écriture : ce process n'a pas de watcher, le schéma
 * (statuts, décisions) et les index en cache peuvent avoir changé dans l'app depuis le dernier appel.
 */
export function freshComponentRepoResolver(container: McpContainer): (component?: string) => Promise<string> {
  const repoOf = componentRepoResolver(container)
  return async component => {
    const repo = await repoOf(component)
    container.schema.invalidate(repo)
    container.reqIndex.invalidate(repo)
    container.testsIndex.invalidate(repo)
    return repo
  }
}
