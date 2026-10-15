import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContainer } from '../container'
import { jsonToolResult, LIST_RESULT_LIMIT } from '../mcp-types'
import { isPrivateScopeId } from '../../main/services/id-scope.util'
import type { UpdateSavedQueryDto } from '../../main/services/saved-queries.service'
import { applyQueryTemplate } from '../../main/services/suivi-store.util'
import { findDuplicateTitle, validateTemplateInput, type SuiviWarning } from '../../main/services/suivi-validation.util'
import {
  assertWritableBranch,
  checkParameters,
  findVisibleQuery,
  parametersSchema,
  paramsSchema,
  peekSharedId,
  preview,
  PRIVATE_SCOPE_REASON,
  resolveUser,
  runScript,
  suiviError,
} from './suivi-common'

/**
 * Tools « requêtes » de la vue Suivi (GH18 ; GH74 : scripts de données) : `list_queries`,
 * `run_query`, `create_query`, `update_query`, `delete_query`. Une requête est un script JS
 * (`export default (data, polenta) => rows`, cf. get_data_contract), écrit directement ou généré par
 * un modèle (cf. list_templates). Écritures via `SavedQueriesService` (partagé :
 * `queries/QUERY-xxxx/` ; privé : `.{user}.pref`).
 */

const scopeSchema = z.enum(['shared', 'private'])
export const templateSchema = z.object({
  id: z.string().min(1).describe('modèle (cf. list_templates)'),
  params: z.record(z.unknown()).default({}),
})

const listQueriesInput = {
  scope: scopeSchema.optional().describe('ne garder que ce scope'),
}

const runQueryInput = {
  queryId: z.string().min(1).optional().describe('requête enregistrée à exécuter (exclusif avec script)'),
  script: z.string().min(1).optional().describe('script ad hoc (exclusif avec queryId) — cf. aussi test_script'),
  params: paramsSchema.optional(),
  parameters: parametersSchema.optional().describe('déclaration des paramètres d\'un script ad hoc (avec script seulement)'),
  offset: z.number().int().min(0).optional().default(0),
  limit: z.number().int().min(1).max(LIST_RESULT_LIMIT).optional().default(LIST_RESULT_LIMIT),
}

const createQueryInput = {
  title: z.string().min(1),
  script: z.string().min(1).optional().describe('script de données (exclusif avec template)'),
  template: templateSchema.optional().describe('modèle de requête + paramètres : le script est généré (exclusif avec script)'),
  parameters: parametersSchema.optional().describe('paramètres choisis à l\'affichage (avec script ; générés par un modèle)'),
  scope: scopeSchema.optional().default('shared'),
  dryRun: z.boolean().optional().default(true),
}

const updateQueryInput = {
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  script: z.string().min(1).optional().describe('nouveau script (la requête est alors détachée de son modèle)'),
  template: templateSchema.optional().describe('nouveau modèle / paramètres : script régénéré'),
  parameters: parametersSchema.optional().describe('nouvelle déclaration de paramètres choisis à l\'affichage (pas avec template)'),
  dryRun: z.boolean().optional().default(true),
}

const deleteQueryInput = {
  id: z.string().min(1),
  dryRun: z.boolean().optional().default(true),
}

/** Avertissement non bloquant : le script enregistré est en erreur. */
export function scriptWarnings(run: Awaited<ReturnType<typeof runScript>>): SuiviWarning[] {
  return run.ok ? [] : [{ code: 'SCRIPT_ERROR', reason: `Le script est en erreur (${run.error.kind}) : ${run.error.message}${run.error.line ? ` — ${run.error.file}:${run.error.line}` : ''}.` }]
}

export function registerQueryTools(server: McpServer, container: McpContainer): void {
  const c = container

  server.registerTool(
    'list_queries',
    {
      title: 'List saved queries',
      description:
        'Liste les requêtes enregistrées de la vue Suivi (partagées ; + privées de --user si fourni). ' +
        'Chaque requête : id, title, scope, script (JS), template (modèle d\'origine), state (customized : ' +
        'code modifié à la main ; readOnly : legacy-sql = ancienne requête SQL non prise en charge, ' +
        'newer-format), createdBy, createdAt.',
      inputSchema: listQueriesInput,
    },
    async ({ scope }) => {
      const { username } = resolveUser(c)
      let queries = await c.savedQueries.list(c.repoPath, username)
      if (scope) queries = queries.filter((q) => q.scope === scope)
      return jsonToolResult({ queries })
    },
  )

  server.registerTool(
    'run_query',
    {
      title: 'Run query',
      description:
        'Exécute une requête enregistrée (queryId) ou un script ad hoc dans le bac à sable, sur les données ' +
        'réelles (repo ouvert + composants). Retourne les colonnes et les lignes (paginées par offset/limit) ' +
        'ou l\'erreur avec fichier et ligne. À utiliser avant add_widget pour connaître les colonnes. ' +
        'params : valeurs des paramètres déclarés par la requête (polenta.params) ; un paramètre non fourni ' +
        'prend son défaut ; clé non déclarée ou paramètre obligatoire sans valeur → erreur kind params.',
      inputSchema: runQueryInput,
    },
    async ({ queryId, script, params, parameters, offset, limit }) => {
      if ((queryId === undefined) === (script === undefined)) return suiviError('INVALID_INPUT', 'Fournir exactement un de queryId ou script.')
      if (parameters !== undefined && script === undefined) return suiviError('INVALID_INPUT', 'parameters seulement avec script (une requête enregistrée a sa déclaration).')
      if (queryId !== undefined && !(await findVisibleQuery(c, queryId))) return suiviError('QUERY_NOT_FOUND', `Requête introuvable : ${queryId}.`)
      let decls
      if (parameters !== undefined) {
        const checked = checkParameters(parameters)
        if ('error' in checked) return checked.error
        decls = checked.decls
      }
      const run = await runScript(c, queryId !== undefined ? { queryId, params } : { script, params, parameters: decls ?? [] })
      if (!run.ok) return suiviError('SCRIPT_ERROR', JSON.stringify(run.error))
      return jsonToolResult({ columns: run.columns, rows: run.rows.slice(offset, offset + limit), total: run.total, offset, limit })
    },
  )

  server.registerTool(
    'create_query',
    {
      title: 'Create saved query',
      description:
        'Crée une requête de la vue Suivi : un script JS fourni, ou un modèle + paramètres (cf. list_templates). ' +
        'parameters (avec script) : paramètres choisis à l\'affichage dans la barre du dashboard, lus dans ' +
        'polenta.params (un modèle génère les siens). ' +
        'dryRun (défaut true) : EXÉCUTE le script et retourne un aperçu SANS RIEN ÉCRIRE. Un script en erreur ' +
        'est enregistré avec un avertissement SCRIPT_ERROR. Pas d\'autre requête du même scope avec le même ' +
        'titre. scope private exige --user.',
      inputSchema: createQueryInput,
    },
    async ({ title, script, template, parameters, scope, dryRun }) => {
      const readonly = await assertWritableBranch(c)
      if (readonly) return readonly
      const { username, hasUser } = resolveUser(c)
      if (scope === 'private' && !hasUser) return suiviError('PRIVATE_SCOPE_UNAVAILABLE', PRIVATE_SCOPE_REASON)
      if ((script === undefined) === (template === undefined)) return suiviError('INVALID_INPUT', 'Fournir exactement un de script ou template.')
      if (template && parameters !== undefined) return suiviError('INVALID_INPUT', 'parameters est généré par le modèle : ne pas le fournir avec template.')
      if (template) {
        const issue = validateTemplateInput('query', template)
        if (issue) return suiviError(issue.code, issue.reason)
      }
      const checked = checkParameters(parameters)
      if ('error' in checked) return checked.error
      const cleanTitle = title.trim()
      if (!cleanTitle) return suiviError('INVALID_INPUT', 'title ne peut pas être vide.')
      const existing = await c.savedQueries.list(c.repoPath, username)
      const dup = findDuplicateTitle(existing, cleanTitle, scope)
      if (dup) return suiviError('DUPLICATE_TITLE', `Une requête ${scope === 'shared' ? 'partagée' : 'privée'} porte déjà ce titre : ${dup.id} "${dup.title}".`)

      const generated = template ? applyQueryTemplate(template) : null
      const code = generated ? generated.script : script!
      const decls = generated ? generated.parameters : checked.decls
      // Aperçu avec les valeurs par défaut (un paramètre obligatoire sans défaut → avertissement).
      const run = await runScript(c, { script: code, parameters: decls })
      const warnings = scriptWarnings(run)
      if (dryRun) {
        const id = scope === 'shared' ? await peekSharedId(c, 'QUERY') : "(généré à l'écriture)"
        return jsonToolResult({ dryRun: true, query: { id, title: cleanTitle, scope, script: code, parameters: decls, ...(template ? { template } : {}) }, preview: preview(run), warnings })
      }
      const query = await c.savedQueries.create(c.repoPath, username, {
        title: cleanTitle, scope, createdBy: 'mcp', ...(template ? { template } : { script, parameters: decls }),
      })
      return jsonToolResult({ dryRun: false, query, preview: preview(run), warnings })
    },
  )

  server.registerTool(
    'update_query',
    {
      title: 'Update saved query',
      description:
        'Modifie une requête (titre, script ou modèle + paramètres, déclaration parameters). dryRun (défaut true) : aperçu SANS RIEN ' +
        'ÉCRIRE. Un script fourni détache la requête de son modèle. Le script résultant est réexécuté ' +
        '(avertissement SCRIPT_ERROR si en erreur). Une requête en lecture seule (SQL d\'avant GH74, format ' +
        'plus récent) est refusée (SUIVI_READ_ONLY). Le scope ne se change pas ici.',
      inputSchema: updateQueryInput,
    },
    async ({ id, title, script, template, parameters, dryRun }) => {
      const readonly = await assertWritableBranch(c)
      if (readonly) return readonly
      const { username, hasUser } = resolveUser(c)
      if (isPrivateScopeId(id) && !hasUser) return suiviError('PRIVATE_SCOPE_UNAVAILABLE', PRIVATE_SCOPE_REASON)
      const existing = await findVisibleQuery(c, id)
      if (!existing) return suiviError('QUERY_NOT_FOUND', `Requête introuvable : ${id}.`)
      if (existing.state.readOnly) return suiviError('SUIVI_READ_ONLY', `Requête ${id} en lecture seule (${existing.state.readOnly}).`)
      if (script !== undefined && template !== undefined) return suiviError('INVALID_INPUT', 'Fournir script ou template, pas les deux.')
      if (template && parameters !== undefined) return suiviError('INVALID_INPUT', 'parameters est généré par le modèle : ne pas le fournir avec template.')
      if (template) {
        const issue = validateTemplateInput('query', template)
        if (issue) return suiviError(issue.code, issue.reason)
      }
      let newDecls
      if (parameters !== undefined) {
        const checked = checkParameters(parameters)
        if ('error' in checked) return checked.error
        newDecls = checked.decls
      } else if (existing.parametersError && !template) {
        // Déclaration lue invalide (modifiée à la main) : la réécrire vide la perdrait.
        return suiviError('PARAMS_INVALID', `Déclaration de paramètres de ${id} invalide, à corriger (parameters) : ${existing.parametersError}.`)
      }
      let cleanTitle: string | undefined
      if (title !== undefined) {
        cleanTitle = title.trim()
        if (!cleanTitle) return suiviError('INVALID_INPUT', 'title ne peut pas être vide.')
        const all = await c.savedQueries.list(c.repoPath, username)
        const dup = findDuplicateTitle(all, cleanTitle, existing.scope, id)
        if (dup) return suiviError('DUPLICATE_TITLE', `Une autre requête du même scope porte déjà ce titre : ${dup.id} "${dup.title}".`)
      }
      const generated = template ? applyQueryTemplate(template) : null
      const code = generated ? generated.script : script ?? existing.script
      const decls = generated ? generated.parameters : newDecls ?? existing.parameters
      const run = await runScript(c, { script: code, parameters: decls })
      const dto: UpdateSavedQueryDto = {
        ...(cleanTitle !== undefined ? { title: cleanTitle } : {}),
        ...(template ? { template } : script !== undefined ? { script } : {}),
        ...(newDecls !== undefined ? { parameters: newDecls } : {}),
      }
      if (dryRun) {
        return jsonToolResult({ dryRun: true, query: { ...existing, ...(cleanTitle ? { title: cleanTitle } : {}), script: code, parameters: decls }, preview: preview(run), warnings: scriptWarnings(run) })
      }
      const query = await c.savedQueries.update(c.repoPath, username, id, dto)
      return jsonToolResult({ dryRun: false, query, preview: preview(run), warnings: scriptWarnings(run) })
    },
  )

  server.registerTool(
    'delete_query',
    {
      title: 'Delete saved query',
      description:
        'Supprime une requête enregistrée. dryRun (défaut true) : retourne la requête qui serait ' +
        'supprimée, SANS RIEN ÉCRIRE. Refusé (QUERY_IN_USE) si un widget de dashboard l’utilise.',
      inputSchema: deleteQueryInput,
    },
    async ({ id, dryRun }) => {
      const readonly = await assertWritableBranch(c)
      if (readonly) return readonly
      const { username, hasUser } = resolveUser(c)
      if (isPrivateScopeId(id) && !hasUser) return suiviError('PRIVATE_SCOPE_UNAVAILABLE', PRIVATE_SCOPE_REASON)
      const existing = await findVisibleQuery(c, id)
      if (!existing) return suiviError('QUERY_NOT_FOUND', `Requête introuvable : ${id}.`)
      const dependents = await c.dashboards.findDependentWidgets(c.repoPath, username, id)
      if (dependents.length > 0) {
        const list = dependents.map((d) => ({ dashboardId: d.dashboardId, dashboardTitle: d.dashboardTitle, widgetId: d.widgetId, widgetTitle: d.widgetTitle }))
        return suiviError('QUERY_IN_USE', `Requête utilisée par ${dependents.length} widget(s) : ${JSON.stringify(list)}`)
      }
      if (!dryRun) await c.savedQueries.delete(c.repoPath, username, id)
      return jsonToolResult({ dryRun, deleted: existing })
    },
  )
}
