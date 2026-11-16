import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Validation } from '@polenta/types'
import type { McpContainer } from '../container'
import { jsonToolResult } from '../mcp-types'
import { componentRepoResolver, componentSchema, freshComponentRepoResolver } from './component-repo'

/**
 * Validations d'une version : lecture et décisions proposées (GH204), puis, depuis GH362, création,
 * modification, décisions directes, confirmation / rejet des propositions et annulation. **Aucun outil
 * ne signe** et aucun ne prend de `status` : la signature reste un geste humain dans la vue Validation.
 */
export function registerValidationTools(server: McpServer, container: McpContainer): void {
  const repoOf = componentRepoResolver(container)
  const writeRepo = freshComponentRepoResolver(container)
  const ws = container.workspaceDir
  const entryOf = (validation: Validation, requirementId: string) => validation.entries.find(e => e.requirementId === requirementId) ?? null

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
      const page = await container.validations.page(await repoOf(component), id, ws)
      return jsonToolResult({
        validation: page.validation, state: page.state, version: page.version, decisions: page.typeDef.decisions ?? [],
        rows: page.rows, pendingCount: page.pendingCount, problems: page.problems,
      })
    },
  )

  const decisionInput = {
    id: z.string().describe('ID de la validation'),
    requirementId: z.string(),
    decision: z.string().describe('Valeur de décision du type (cf. `decisions` de get_validation) ; la valeur « en attente » ' +
      '(`isPending`) retire la décision avec decide_validation, et est refusée par propose_validation_decision'),
    comment: z.string().optional(),
    fields: z.record(z.unknown()).optional().describe('entryFields du type'),
    component: componentSchema,
  }

  server.registerTool(
    'propose_validation_decision',
    {
      title: 'Propose validation decision',
      description:
        'Propose une décision sur une exigence d’une validation en cours. Elle reste « proposée » et bloque la signature jusqu’à ce qu’elle soit confirmée ou rejetée. ' +
        'Refusé sur une exigence dont la décision est déjà confirmée. Pour décider directement : `decide_validation`.',
      inputSchema: decisionInput,
    },
    async ({ id, requirementId, decision, comment, fields, component }) => {
      const updated = await container.validations.propose(await writeRepo(component), id, { requirementId, decision, comment, fields }, ws)
      return jsonToolResult(entryOf(updated, requirementId))
    },
  )

  // GH362 — écritures (sans signature).
  const idInput = { id: z.string().describe('ID de la validation'), component: componentSchema }

  server.registerTool(
    'create_validation',
    {
      title: 'Create validation',
      description:
        'Crée la validation d’une version du composant (statut initial du type validation). Reprend les décisions de la ' +
        'validation signée de la version précédente (`basedOn`). Refusé si une validation non annulée existe déjà pour ' +
        'cette version (`VALIDATION_EXISTS`) ou si la version est abandonnée.',
      inputSchema: {
        versionId: z.string().describe('ID de la version validée'),
        title: z.string().min(1).max(500),
        fields: z.record(z.unknown()).optional(),
        component: componentSchema,
      },
    },
    async ({ versionId, title, fields, component }) => jsonToolResult(await container.validations.create(
      await writeRepo(component), { versionId, title, fields: fields ?? {} }, ws,
    )),
  )

  server.registerTool(
    'update_validation',
    {
      title: 'Update validation',
      description: 'Modifie le titre ou des champs (fusionnés) d’une validation en cours. Le statut ne se change pas ici.',
      inputSchema: { ...idInput, title: z.string().min(1).max(500).optional(), fields: z.record(z.unknown()).optional() },
    },
    async ({ id, component, title, fields }) => jsonToolResult(await container.validations.update(await writeRepo(component), id, { title, fields }, ws)),
  )

  server.registerTool(
    'decide_validation',
    {
      title: 'Decide validation',
      description:
        'Prend ou change la décision d’une exigence d’une validation en cours, directement confirmée (`decidedBy`, ' +
        '`decidedAt`) ; confirme aussi une proposition existante. La valeur « en attente » du type retire la décision.',
      inputSchema: decisionInput,
    },
    async ({ id, requirementId, decision, comment, fields, component }) => {
      const updated = await container.validations.decide(await writeRepo(component), id, { requirementId, decision, comment, fields }, ws)
      return jsonToolResult(entryOf(updated, requirementId))
    },
  )

  server.registerTool(
    'confirm_validation_decision',
    {
      title: 'Confirm validation decision',
      description: 'Confirme telle quelle une décision proposée ou « à revoir » d’une exigence (`NO_DECISION` si aucune).',
      inputSchema: { ...idInput, requirementId: z.string() },
    },
    async ({ id, requirementId, component }) => {
      const updated = await container.validations.confirm(await writeRepo(component), id, requirementId, ws)
      return jsonToolResult(entryOf(updated, requirementId))
    },
  )

  server.registerTool(
    'reject_validation_decision',
    {
      title: 'Reject validation decision',
      description: 'Rejette une décision proposée : l’exigence repasse en attente (`NOT_PROPOSED` si la décision n’est pas proposée).',
      inputSchema: { ...idInput, requirementId: z.string() },
    },
    async ({ id, requirementId, component }) => {
      const updated = await container.validations.reject(await writeRepo(component), id, requirementId, ws)
      return jsonToolResult({ id: updated.id, requirementId, entry: entryOf(updated, requirementId) })
    },
  )

  server.registerTool(
    'cancel_validation',
    {
      title: 'Cancel validation',
      description:
        'Annule une validation (statut terminal du type), en cours ou signée ; l’historique du statut en garde la trace. ' +
        'Une validation annulée n’est plus modifiable ; une nouvelle validation de la version peut alors être créée.',
      inputSchema: idInput,
    },
    async ({ id, component }) => jsonToolResult(await container.validations.cancel(await writeRepo(component), id, ws)),
  )
}
