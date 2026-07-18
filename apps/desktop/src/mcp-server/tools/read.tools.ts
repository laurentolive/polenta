import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContainer } from '../container'
import { jsonToolResult, paginate } from '../mcp-types'

/**
 * Filtres communs `list_requirements`/`list_tests` — même forme que
 * `RequirementFilters` (sous-ensemble : `type`/`status`/`search`), cf.
 * specs/T122-design.md §2.4.
 */
const listFiltersSchema = z
  .object({
    type: z.string().optional().describe('objectTypeRef exact (ex. "root::exigence-systeme")'),
    status: z.string().optional().describe('statut exact (ex. "approved")'),
    search: z.string().optional().describe('recherche texte libre (titre / contenu)'),
  })
  .optional()

const campaignFiltersSchema = z
  .object({
    component: z.string().optional(),
    level: z.string().optional(),
  })
  .optional()

/**
 * Tools de lecture des objets (T122 sprint 1) — pour qu'un agent explore le contenu
 * existant avant d'écrire (éviter les doublons avant un import), sans deviner la
 * structure du repo.
 *
 * Chaque résultat de liste est plafonné (`mcp-types.ts::paginate`, seuil
 * `LIST_RESULT_LIMIT`) pour éviter qu'un projet avec des milliers d'objets ne sature
 * le contexte de l'agent appelant.
 */
export function registerReadTools(server: McpServer, container: McpContainer): void {
  server.registerTool(
    'list_requirements',
    {
      title: 'List requirements',
      description:
        'Liste les exigences du repo, triées par ID. Filtres optionnels : type ' +
        '(objectTypeRef exact), status (statut exact), search (texte libre). ' +
        'Résultat plafonné à 200 objets (troncature signalée via `truncated`/`total`).',
      inputSchema: { filters: listFiltersSchema },
    },
    async ({ filters }) => {
      const all = await container.requirements.findAll(container.repoPath, {
        type: filters?.type,
        status: filters?.status,
        search: filters?.search,
      })
      return jsonToolResult(paginate(all))
    },
  )

  server.registerTool(
    'list_tests',
    {
      title: 'List tests',
      description:
        "Liste les cas de test du repo, triés par ID. Filtres optionnels : type " +
        "(objectTypeRef exact), status (statut exact), search (texte libre sur le " +
        "titre). NOTE : TestsService.findAll() n'accepte aujourd'hui aucun filtre " +
        "côté service — le filtrage est fait en mémoire par ce tool (cf. " +
        "specs/T122-design.md §2.4). Résultat plafonné à 200 objets (troncature " +
        "signalée via `truncated`/`total`).",
      inputSchema: { filters: listFiltersSchema },
    },
    async ({ filters }) => {
      let all = await container.tests.findAll(container.repoPath)

      if (filters?.type) all = all.filter((t) => t.objectTypeRef === filters.type)
      if (filters?.status) all = all.filter((t) => t.status === filters.status)
      if (filters?.search) {
        const q = filters.search.toLowerCase()
        all = all.filter((t) => t.title.toLowerCase().includes(q))
      }
      all = [...all].sort((a, b) => a.id.localeCompare(b.id))

      return jsonToolResult(paginate(all))
    },
  )

  server.registerTool(
    'list_campaigns',
    {
      title: 'List campaigns',
      description:
        'Liste les campagnes de test du repo. Filtres optionnels : component, level ' +
        '— réutilise CampaignsService.list() tel quel. Résultat plafonné à 200 objets ' +
        '(troncature signalée via `truncated`/`total`).',
      inputSchema: { filters: campaignFiltersSchema },
    },
    async ({ filters }) => {
      const all = await container.campaigns.list(container.repoPath, filters?.component, filters?.level)
      return jsonToolResult(paginate(all))
    },
  )
}
