import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContainer } from '../container'
import { errorToolResult, jsonToolResult } from '../mcp-types'

/**
 * GH198 — changes (specs/GH198.md §6) : `list_changesets`, `get_changeset`, `create_changeset` (demande de
 * changement). Mêmes contrôles que l'application (`ChangesService`). GH199 : `get_changeset` renvoie aussi l'analyse.
 */

const changeItemSchema = z.object({ id: z.string().min(1) })

export function registerChangeTools(server: McpServer, container: McpContainer): void {
  server.registerTool(
    'list_changesets',
    {
      title: 'List changesets',
      description:
        "Liste les changesets (modifications pilotées d'un composant) de tous les repos du workspace : " +
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
      return jsonToolResult({ changesets: changes })
    },
  )

  server.registerTool(
    'get_changeset',
    {
      title: 'Get changeset',
      description:
        "Lit un changeset : champs, composant, éléments à modifier (toModify : id, state planned|modified), " +
        'éléments impactés (impacted : id, status d\'impact, comment, source declared|computed), origine, ' +
        'version intégrée, campagnes, historique ; et son analyse d\'impact (`analysis` : racines, arbres, lignes des impactés ' +
        'déclarées et calculées, campagnes en cours concernées ; figée si le changeset est terminal) ; `trace` : pour chaque ' +
        'élément à modifier, version de départ (base, absente : création) et commit d\'approbation (approved). repoPath : repo de stockage ' +
        '(cf. list_changesets), défaut repo ouvert.',
      inputSchema: { id: z.string().min(1), repoPath: z.string().optional() },
    },
    async ({ id, repoPath }) => {
      try {
        const rp = repoPath ?? container.repoPath
        const [change, analysis, trace] = await Promise.all([
          container.changes.get(rp, id), container.changes.analysis(rp, id), container.changes.trace(rp, id),
        ])
        return jsonToolResult({ changeset: change, analysis, trace })
      } catch (err) {
        return errorToolResult(err instanceof Error ? err.message : String(err))
      }
    },
  )

  server.registerTool(
    'create_changeset',
    {
      title: 'Create changeset',
      description:
        "Crée un changeset (demande de changement, mode request). objectTypeRef : type de catégorie changeset du schéma " +
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
        return jsonToolResult({ changeset: change })
      } catch (err) {
        return errorToolResult(err instanceof Error ? err.message : String(err))
      }
    },
  )
}
