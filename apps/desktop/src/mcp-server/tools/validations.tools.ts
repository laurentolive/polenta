import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { VersionComponentNode } from '@polenta/types'
import type { McpContainer } from '../container'
import { jsonToolResult } from '../mcp-types'

const componentSchema = z.string().optional()
  .describe('Composant (nom du repo dans le workspace, cf. list_versions) ; absent : le repo ouvert')

/**
 * GH204 — validations d'une version : lecture et décisions **proposées**. Le MCP ne confirme, ne
 * rejette et ne signe pas : un humain le fait dans la vue Validation.
 */
export function registerValidationTools(server: McpServer, container: McpContainer): void {
  const flatten = (nodes: VersionComponentNode[]): VersionComponentNode[] => nodes.flatMap(n => [n, ...flatten(n.children)])
  const repoOf = async (component?: string): Promise<string> => {
    if (!component) return container.repoPath
    const node = flatten(await container.versions.tree(container.repoPath, container.workspaceDir)).find(n => n.name === component)
    if (!node) throw new Error(`Composant introuvable : ${component}`)
    return node.repoPath
  }

  server.registerTool(
    'list_validations',
    {
      title: 'List validations',
      description: 'Validations d’un composant : ID, titre, version validée, statut, nombre de décisions enregistrées.',
      inputSchema: { component: componentSchema },
    },
    async ({ component }) => {
      const list = await container.validations.list(await repoOf(component))
      return jsonToolResult(list.map(v => ({ id: v.id, title: v.title, versionId: v.versionId, status: v.status, decisions: v.entries.length })))
    },
  )

  server.registerTool(
    'get_validation',
    {
      title: 'Get validation',
      description: 'Validation complète : une ligne par exigence (décision, statuts de rédaction, de design et de vérification, impact, « à revoir »), décisions restantes et motifs de refus de signature.',
      inputSchema: { id: z.string(), component: componentSchema },
    },
    async ({ id, component }) => {
      const page = await container.validations.page(await repoOf(component), id, container.workspaceDir)
      return jsonToolResult({
        validation: page.validation, state: page.state, version: page.version, decisions: page.typeDef.decisions ?? [],
        rows: page.rows, pendingCount: page.pendingCount, problems: page.problems,
      })
    },
  )

  server.registerTool(
    'propose_validation_decision',
    {
      title: 'Propose validation decision',
      description:
        'Propose une décision sur une exigence d’une validation en cours. Elle reste « proposée » et bloque la signature jusqu’à ce qu’un humain la confirme ou la rejette. ' +
        'Refusé sur une exigence dont la décision est déjà confirmée. Le MCP ne confirme pas et ne signe pas.',
      inputSchema: {
        id: z.string().describe('ID de la validation'),
        requirementId: z.string(),
        decision: z.string().describe('Valeur de décision du type (hors valeur « en attente »)'),
        comment: z.string().optional(),
        fields: z.record(z.unknown()).optional().describe('entryFields du type'),
        component: componentSchema,
      },
    },
    async ({ id, requirementId, decision, comment, fields, component }) => {
      const updated = await container.validations.propose(await repoOf(component), id, { requirementId, decision, comment, fields }, container.workspaceDir)
      return jsonToolResult(updated.entries.find(e => e.requirementId === requirementId) ?? null)
    },
  )
}
