import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { VersionComponentNode } from '@polenta/types'
import type { McpContainer } from '../container'
import { jsonToolResult } from '../mcp-types'

const componentSchema = z.string().optional()
  .describe('Composant (nom du repo dans le workspace, cf. list_versions) ; absent : le repo ouvert')

/**
 * GH201 — lecture des versions de composant / produit (specs/GH201.md §8). Aucune écriture : le MCP
 * ne crée pas de version, n'inclut pas de changement et ne passe pas une version released.
 */
export function registerVersionTools(server: McpServer, container: McpContainer): void {
  const tree = () => container.versions.tree(container.repoPath, container.workspaceDir)
  const flatten = (nodes: VersionComponentNode[]): VersionComponentNode[] => nodes.flatMap(n => [n, ...flatten(n.children)])
  const repoOf = async (component?: string): Promise<string> => {
    if (!component) return container.repoPath
    const node = flatten(await tree()).find(n => n.name === component)
    if (!node) throw new Error(`Composant introuvable : ${component}`)
    return node.repoPath
  }

  server.registerTool(
    'list_versions',
    {
      title: 'List versions',
      description:
        'Versions de chaque composant (repo) du workspace, du plus récent au plus ancien : ID, label (`title`), ' +
        'statut, état (`in_progress` / `released` / `abandoned`), version précédente (`basedOn`), tag figé ' +
        '(`freeze`). Avec le nombre d’éléments au backlog. La version produit est celle du repo racine.',
      inputSchema: { component: componentSchema },
    },
    async ({ component }) => {
      const nodes = flatten(await tree()).filter(n => !component || n.name === component)
      return jsonToolResult(nodes.map(n => ({
        component: n.name, label: n.label, readonly: n.readonly, versionType: n.versionType?.ref ?? null,
        backlogCount: n.backlogCount, versions: n.versions,
      })))
    },
  )

  server.registerTool(
    'get_version',
    {
      title: 'Get version',
      description:
        'Une version : champs, composants (versions des dépendances retenues) et changements — ceux de la ' +
        'version et ceux des versions des composants postérieures à la version précédente (composant, version, ' +
        'type, ID, label, état de base `{ sha, version }` ; `toSha` = commit figé, null = état courant).',
      inputSchema: {
        id: z.string().describe('ID de la version (ex. VER-0004)'),
        component: componentSchema,
      },
    },
    async ({ id, component }) => {
      const page = await container.versions.page(await repoOf(component), id, container.workspaceDir)
      return jsonToolResult({
        version: page.version, state: page.state, component: page.component.name, basedOn: page.basedOn,
        components: page.components.map(c => ({ name: c.name, selected: c.selected })),
        changes: page.rows.map(({ repoPath: _repoPath, ...row }) => row),
      })
    },
  )

  server.registerTool(
    'get_version_backlog',
    {
      title: 'Get version backlog',
      description:
        'Backlog d’un composant : exigences et tests dont un changement n’a jamais été inclus dans une version ' +
        '(`kind: new` jamais livré, `modified` modifié depuis la dernière version released qui l’incluait, avec ' +
        '`base`) ; `outside` : approuvé modifié sans réouverture.',
      inputSchema: { component: componentSchema },
    },
    async ({ component }) => jsonToolResult(await container.versions.backlog(await repoOf(component))),
  )
}
