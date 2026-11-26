import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContainer } from '../container'
import { jsonToolResult } from '../mcp-types'
import { BRAND } from '../../shared/brand'
import { workspaceScopes } from './workspace-scope'

/**
 * `get_schema` — tool de lecture seule (T122 sprint 1).
 *
 * Retourne le `.polenta/schema.yaml` résolu du repo courant (nœuds, types d'objets,
 * champs, statuts, types de lien) — identique à `SchemaService.get()`, y compris le
 * repli sur le schéma par défaut (`root` seul) si le repo n'a jamais été initialisé
 * comme projet Polenta (cf. specs/T122-tests.md scénario 9).
 */
export function registerSchemaTools(server: McpServer, container: McpContainer): void {
  server.registerTool(
    'get_schema',
    {
      title: 'Get project schema',
      description:
        `Retourne le schéma résolu du projet ${BRAND.productName} courant (.polenta/schema.yaml) : ` +
        "nœuds (composants), types d'objets, champs, statuts, types de lien. À appeler " +
        "avant toute création d'objet pour connaître les objectTypeRef valides et leurs " +
        "champs requis. Workspace : `workspaceComponents` liste les composants en repo séparé ; " +
        "`component` (nom de montage) retourne le schéma de ce composant, dont les types s'adressent " +
        "alors `<composant>::<type>` (ex. type `X` du nœud `root` du composant `comp` : `comp::X`).",
      inputSchema: { component: z.string().optional().describe('Composant en repo séparé (nom de montage, cf. workspaceComponents) ; absent : le repo ouvert') },
    },
    async ({ component }) => {
      // GH447 — schéma d'un composant en repo séparé, et liste des composants du workspace.
      const scopes = await workspaceScopes(container)
      if (component) {
        const scope = scopes.find(s => s.component === component)
        if (!scope) throw new Error(`Composant introuvable : ${component} (cf. workspaceComponents de get_schema)`)
        return jsonToolResult(await container.schema.get(scope.repoPath))
      }
      const schema = await container.schema.get(container.repoPath)
      const components = scopes.flatMap(s => (s.component ? [s.component] : []))
      return jsonToolResult(components.length > 0 ? { ...schema, workspaceComponents: components } : schema)
    },
  )
}
