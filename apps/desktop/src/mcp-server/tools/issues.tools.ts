import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { VersionComponentNode } from '@polenta/types'
import type { McpContainer } from '../container'
import { jsonToolResult } from '../mcp-types'

const componentSchema = z.string().optional()
  .describe('Composant (nom du repo dans le workspace, cf. list_versions) ; absent : le repo ouvert')

/**
 * GH244 — issues : lecture, création et modification. Les exigences impactées sont des liens
 * `issue-impact` (`create_links`), limités aux exigences du composant de l'issue.
 */
export function registerIssueTools(server: McpServer, container: McpContainer): void {
  const flatten = (nodes: VersionComponentNode[]): VersionComponentNode[] => nodes.flatMap(n => [n, ...flatten(n.children)])
  const repoOf = async (component?: string): Promise<string> => {
    if (!component) return container.repoPath
    const node = flatten(await container.versions.tree(container.repoPath, container.workspaceDir)).find(n => n.name === component)
    if (!node) throw new Error(`Composant introuvable : ${component}`)
    return node.repoPath
  }
  /** Processus sans watcher : relit le disque. */
  const fresh = async (component?: string): Promise<string> => {
    const repo = await repoOf(component)
    container.issues.invalidate(repo)
    return repo
  }

  server.registerTool(
    'list_issues',
    {
      title: 'List issues',
      description: 'Issues d’un composant : ID, titre, type, statut, origine (exécutions à l’origine de l’issue).',
      inputSchema: { component: componentSchema, status: z.string().optional().describe('Filtre sur le statut') },
    },
    async ({ component, status }) => {
      const issues = await container.issues.findAll(await fresh(component))
      return jsonToolResult(issues.filter(i => !status || i.status === status).map(i => ({
        id: i.id, title: i.title, objectTypeRef: i.objectTypeRef, status: i.status, origin: i.origin ?? null,
      })))
    },
  )

  server.registerTool(
    'get_issue',
    {
      title: 'Get issue',
      description: 'Issue complète : champs, statut, origine, historique.',
      inputSchema: { id: z.string(), component: componentSchema },
    },
    async ({ id, component }) => jsonToolResult(await container.issues.findOne(await fresh(component), id)),
  )

  server.registerTool(
    'create_issue',
    {
      title: 'Create issue',
      description:
        'Crée une issue. `objectTypeRef` : un type de catégorie `issue` du schéma. Statut absent : premier statut du type. ' +
        'Les exigences impactées se lient ensuite par `create_links`, type `issue-impact`.',
      inputSchema: {
        objectTypeRef: z.string(),
        title: z.string().min(1).max(500),
        status: z.string().optional(),
        fields: z.record(z.unknown()).optional(),
        component: componentSchema,
      },
    },
    async ({ objectTypeRef, title, status, fields, component }) => jsonToolResult(await container.issues.create(
      await fresh(component), { objectTypeRef, title, ...(status && { status }), fields: fields ?? {} }, container.workspaceDir,
    )),
  )

  server.registerTool(
    'update_issue',
    {
      title: 'Update issue',
      description: 'Modifie le titre, le statut ou des champs d’une issue. Les champs absents restent inchangés.',
      inputSchema: {
        id: z.string(),
        title: z.string().min(1).max(500).optional(),
        status: z.string().optional(),
        fields: z.record(z.unknown()).optional(),
        modificationComment: z.string().optional(),
        component: componentSchema,
      },
    },
    async ({ id, title, status, fields, modificationComment, component }) => jsonToolResult(await container.issues.update(
      await fresh(component), id, { title, status, fields, modificationComment }, container.workspaceDir,
    )),
  )
}
