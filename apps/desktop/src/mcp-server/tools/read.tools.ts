import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContainer } from '../container'
import { jsonToolResult, paginate } from '../mcp-types'
import { readEffectiveHistory } from '../../main/services/history.service'
import { findOwnerScope, presentObject, workspaceScopes } from './workspace-scope'

/**
 * Filtres communs `list_requirements`/`list_tests` — même forme que
 * `RequirementFilters` (sous-ensemble : `type`/`status`/`search`), cf.
 * specs/T122-design.md §2.4.
 */
const listFiltersSchema = z
  .object({
    type: z.string().optional().describe('objectTypeRef exact (ex. "root::exigence-systeme", "<composant>::<type>" pour un composant en repo séparé)'),
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
        'Liste les exigences du repo et des composants du workspace, triées par ID. Une exigence de composant ' +
        'en repo séparé porte `component` (nom de montage) et son objectTypeRef sous ce nom (`<composant>::<type>`). ' +
        'Filtres optionnels : type ' +
        '(objectTypeRef exact), status (statut exact), search (texte libre). ' +
        'Résultat plafonné à 200 objets (troncature signalée via `truncated`/`total`).',
      inputSchema: { filters: listFiltersSchema },
    },
    async ({ filters }) => {
      // GH447 — tous les repos du workspace ; le type se filtre sur la référence présentée.
      const perRepo = await Promise.all((await workspaceScopes(container)).map(async scope =>
        (await container.requirements.findAll(scope.repoPath, { status: filters?.status, search: filters?.search }))
          .map(r => presentObject(scope, r))))
      const all = perRepo.flat()
        .filter(r => !filters?.type || r.objectTypeRef === filters.type)
        .sort((a, b) => a.id.localeCompare(b.id))
      return jsonToolResult(paginate(all))
    },
  )

  server.registerTool(
    'list_tests',
    {
      title: 'List tests',
      description:
        "Liste les cas de test du repo et des composants du workspace (même présentation que list_requirements), " +
        "triés par ID. Filtres optionnels : type " +
        "(objectTypeRef exact), status (statut exact), search (texte libre sur le " +
        "titre). NOTE : TestsService.findAll() n'accepte aujourd'hui aucun filtre " +
        "côté service — le filtrage est fait en mémoire par ce tool (cf. " +
        "specs/T122-design.md §2.4). Résultat plafonné à 200 objets (troncature " +
        "signalée via `truncated`/`total`).",
      inputSchema: { filters: listFiltersSchema },
    },
    async ({ filters }) => {
      // GH447 — tous les repos du workspace.
      let all = (await Promise.all((await workspaceScopes(container)).map(async scope =>
        (await container.tests.findAll(scope.repoPath)).map(t => presentObject(scope, t))))).flat()

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

  // GH77 — les listes renvoient `history` tel qu'écrit ; ce tool y ajoute les entrées implicites
  // (valeur courante différente de la dernière entrée, `implicit: true`).
  server.registerTool(
    'get_history',
    {
      title: 'Get object history',
      description:
        "Historique des champs suivis d'une exigence, d'un test (repo ouvert ou composant du workspace) ou d'une " +
        "campagne (repo ouvert) : une liste par " +
        'champ (`status` pour le statut), entrées `{ value?, at, by?, source?, comment?, implicit? }` triées ' +
        "par date. `implicit: true` = valeur constatée dont la date de changement est inconnue " +
        '(datée du dernier commit du fichier). Données brutes : aucune interprétation.',
      inputSchema: {
        kind: z.enum(['requirement', 'test', 'campaign', 'issue']),
        id: z.string().describe('ID de l’objet (ex. SYS-0001, CAMP-0003)'),
      },
    },
    async ({ kind, id }) => {
      // GH447 — exigence ou test d'un composant en repo séparé : lu dans son repo.
      const scope = kind === 'requirement' || kind === 'test'
        ? await findOwnerScope(container, await workspaceScopes(container), kind, id)
        : null
      return jsonToolResult(await readEffectiveHistory(container, scope?.repoPath ?? container.repoPath, kind, id))
    },
  )
}
