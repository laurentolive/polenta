import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContainer } from '../container'
import { jsonToolResult } from '../mcp-types'

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
        "Retourne le schéma résolu du projet Polenta courant (.polenta/schema.yaml) : " +
        "nœuds (composants), types d'objets, champs, statuts, types de lien. À appeler " +
        "avant toute création d'objet pour connaître les objectTypeRef valides et leurs " +
        "champs requis.",
    },
    async () => jsonToolResult(await container.schema.get(container.repoPath)),
  )
}
