import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContainer } from '../container'
import { errorToolResult, jsonToolResult } from '../mcp-types'

/**
 * GH198 — changes (specs/GH198.md §6) : `list_changes`, `get_change`, `create_change` (demande de
 * changement). Mêmes contrôles que l'application (`ChangesService`). Mise à jour des listes : lot L3.
 */

const changeItemSchema = z.object({ id: z.string().min(1) })

export function registerChangeTools(server: McpServer, container: McpContainer): void {
  server.registerTool(
    'list_changes',
    {
      title: 'List changes',
      description:
        "Liste les changes (modifications pilotées d'un composant) de tous les repos du workspace : " +
        'id, repo de stockage (repoPath), type (objectTypeRef), titre, statut, composant, nombres d\'éléments ' +
        'à modifier et impactés. Filtres optionnels : status, objectTypeRef.',
      inputSchema: {
        status: z.string().optional(),
        objectTypeRef: z.string().optional(),
      },
    },
    async ({ status, objectTypeRef }) => {
      let changes = await container.changes.list(container.repoPath, container.workspaceDir)
      if (status) changes = changes.filter((c) => c.status === status)
      if (objectTypeRef) changes = changes.filter((c) => c.objectTypeRef === objectTypeRef)
      return jsonToolResult({ changes })
    },
  )

  server.registerTool(
    'get_change',
    {
      title: 'Get change',
      description:
        "Lit un change : champs, composant, éléments à modifier (toModify : id, state planned|modified), " +
        'éléments impactés (impacted : id, status d\'impact, comment, source declared|computed), origine, ' +
        'version intégrée, campagnes, historique. repoPath : repo de stockage (cf. list_changes), défaut repo ouvert.',
      inputSchema: { id: z.string().min(1), repoPath: z.string().optional() },
    },
    async ({ id, repoPath }) => {
      try {
        return jsonToolResult({ change: await container.changes.get(repoPath ?? container.repoPath, id) })
      } catch (err) {
        return errorToolResult(err instanceof Error ? err.message : String(err))
      }
    },
  )

  server.registerTool(
    'create_change',
    {
      title: 'Create change',
      description:
        "Crée une demande de changement (mode request). objectTypeRef : type de catégorie change du schéma " +
        "(cf. get_schema). component : nœud concerné, obligatoire si le repo porte plusieurs composants locaux. " +
        "toModify : exigences / tests prévus à modifier ; impacted : éléments impactés déclarés (statut " +
        "impact_non_verifie). Champs du type contrôlés comme dans l'application (required, requiredWhen, liens).",
      inputSchema: {
        objectTypeRef: z.string().min(1),
        title: z.string().min(1),
        component: z.string().optional(),
        fields: z.record(z.string(), z.unknown()).optional(),
        toModify: z.array(changeItemSchema).optional(),
        impacted: z.array(changeItemSchema).optional(),
      },
    },
    async ({ objectTypeRef, title, component, fields, toModify, impacted }) => {
      try {
        const change = await container.changes.create(container.repoPath, {
          objectTypeRef, title, component, fields,
          toModify: (toModify ?? []).map((t) => ({ id: t.id, state: 'planned' as const })),
          impacted: (impacted ?? []).map((i) => ({ id: i.id, status: 'impact_non_verifie' as const, source: 'declared' as const })),
        }, container.workspaceDir)
        return jsonToolResult({ change })
      } catch (err) {
        return errorToolResult(err instanceof Error ? err.message : String(err))
      }
    },
  )
}
