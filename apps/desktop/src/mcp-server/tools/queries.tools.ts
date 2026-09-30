import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { BuilderConfig, QueryDefinition, QueryResult, SavedQuery } from '@polenta/types'
import type { McpContainer } from '../container'
import { jsonToolResult, LIST_RESULT_LIMIT } from '../mcp-types'
import { isPrivateScopeId } from '../../main/services/id-scope.util'
import type { UpdateSavedQueryDto } from '../../main/services/saved-queries.service'
import {
  findDuplicateTitle,
  mappingColumns,
  type SuiviWarning,
} from '../../main/services/suivi-validation.util'
import {
  assertWritableBranch,
  PRIVATE_SCOPE_REASON,
  resolveUser,
  resultColumnNames,
  runDefinition,
  suiviError,
} from './suivi-common'

/**
 * Tools « requêtes » de la vue Suivi (GH18 — specs/GH18-design.md §7.1) : `list_queries`,
 * `run_query`, `create_query`, `update_query`, `delete_query`. Écritures via
 * `SavedQueriesService` (partagé : `queries/QUERY-xxxx.yaml` ; privé : `.{user}.pref`).
 * Aucun cache : les services relisent YAML/`.pref` à chaque appel.
 */

const builderConfigSchema = z.object({
  objectTypeRef: z.string().min(1).describe('"<nœud>::<type>" (cf. get_schema)'),
  component: z.string().optional().describe('nom du composant workspace, absent pour le repo courant'),
  conditions: z.array(
    z.object({
      field: z.string().min(1),
      operator: z.enum(['=', '!=', '>', '<', 'contains', 'in']),
      value: z.unknown(),
    }),
  ),
  combinator: z.enum(['AND', 'OR']),
  groupBy: z.array(z.string().min(1)).optional(),
})

/** zod infère `value` optionnel là où `BuilderCondition.value` est requis ; une valeur
 *  absente devient `NULL` dans la SQL générée (`sqlValue`), le cast est donc sans risque. */
function asBuilderConfig(b: z.infer<typeof builderConfigSchema> | undefined): BuilderConfig | undefined {
  return b as BuilderConfig | undefined
}

const modeSchema = z.enum(['builder', 'sql'])
const scopeSchema = z.enum(['shared', 'private'])

const definitionSchema = z.object({
  mode: modeSchema,
  sqlText: z.string().optional(),
  builderConfig: builderConfigSchema.optional(),
})

const listQueriesInput = {
  scope: scopeSchema.optional().describe('ne garder que ce scope'),
}

const runQueryInput = {
  queryId: z.string().min(1).optional().describe('requête sauvegardée à exécuter (exclusif avec definition)'),
  definition: definitionSchema.optional().describe('requête ad hoc (exclusif avec queryId)'),
  offset: z.number().int().min(0).optional().default(0),
  limit: z.number().int().min(1).max(LIST_RESULT_LIMIT).optional().default(LIST_RESULT_LIMIT),
}

const createQueryInput = {
  title: z.string().min(1),
  mode: modeSchema,
  sqlText: z.string().optional().describe('requis si mode = sql'),
  builderConfig: builderConfigSchema.optional().describe('requis si mode = builder'),
  scope: scopeSchema.optional().default('shared'),
  dryRun: z.boolean().optional().default(true),
}

const updateQueryInput = {
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  mode: modeSchema.optional().describe('changer de mode exige la définition complète du nouveau mode'),
  sqlText: z.string().optional(),
  builderConfig: builderConfigSchema.optional(),
  dryRun: z.boolean().optional().default(true),
}

const deleteQueryInput = {
  id: z.string().min(1),
  dryRun: z.boolean().optional().default(true),
}

const SAMPLE_SIZE = 5
const SHARED_QUERY_ID = /^QUERY-\d+$/

function preview(result: QueryResult) {
  return { columns: result.columns, total: result.rows.length, sample: result.rows.slice(0, SAMPLE_SIZE) }
}

/** Id qu'aurait une requête partagée créée maintenant — même calcul que
 *  `GitService.nextCounterId('QUERY')`, sans écrire `config/counters.yaml`. */
async function peekSharedQueryId(c: McpContainer): Promise<string> {
  const counters = (await c.git.readYaml<Record<string, number | undefined>>(c.repoPath, 'config/counters.yaml').catch(() => null)) ?? {}
  return `QUERY-${String((counters.QUERY ?? 0) + 1).padStart(4, '0')}`
}

/** Requête visible par cet appel : un id privé sans `--user` n'est jamais résolu, et un id
 *  partagé hors format `QUERY-NNNN` non plus (il servirait de chemin de fichier). */
async function findVisibleQuery(c: McpContainer, id: string): Promise<SavedQuery | null> {
  const { username, hasUser } = resolveUser(c)
  if (isPrivateScopeId(id) ? !hasUser : !SHARED_QUERY_ID.test(id)) return null
  return c.savedQueries.findOne(c.repoPath, username, id)
}

/** Widgets utilisant `queryId` dont une colonne mappée disparaît du nouveau résultat. */
async function brokenWidgetWarnings(c: McpContainer, queryId: string, columns: string[] | null): Promise<SuiviWarning[]> {
  if (!columns) return []
  const { username } = resolveUser(c)
  const available = new Set(columns)
  const dependents = await c.dashboards.findDependentWidgets(c.repoPath, username, queryId)
  const warnings: SuiviWarning[] = []
  for (const dashboardId of new Set(dependents.map((d) => d.dashboardId))) {
    const dashboard = await c.dashboards.get(c.repoPath, username, dashboardId)
    for (const w of dashboard?.widgets ?? []) {
      if (w.queryId !== queryId) continue
      const missing = mappingColumns(w.fieldMapping).filter((col) => !available.has(col))
      if (missing.length === 0) continue
      warnings.push({
        code: 'WIDGET_MAPPING_BROKEN',
        reason: `Widget "${w.title}" (dashboard "${dashboard!.title}") : colonne(s) absente(s) du nouveau résultat — ${missing.join(', ')}.`,
        dashboardId,
        widgetId: w.id,
      })
    }
  }
  return warnings
}

export function registerQueryTools(server: McpServer, container: McpContainer): void {
  const c = container

  server.registerTool(
    'list_queries',
    {
      title: 'List saved queries',
      description:
        'Liste les requêtes sauvegardées de la vue Suivi (partagées ; + privées de --user si fourni). ' +
        'Chaque requête : id, title, mode (builder|sql), builderConfig ou sqlText, scope, createdBy, createdAt.',
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
        'Exécute une requête (lecture seule) sur les tables requirements, tests, links — soit une ' +
        'requête sauvegardée (queryId), soit une définition ad hoc (definition : mode sql + sqlText, ' +
        'ou mode builder + builderConfig). Retourne la SQL exécutée, les colonnes et les lignes ' +
        '(paginées par offset/limit). À utiliser avant add_widget pour connaître les colonnes.',
      inputSchema: runQueryInput,
    },
    async ({ queryId, definition, offset, limit }) => {
      if ((queryId === undefined) === (definition === undefined)) {
        return suiviError('INVALID_INPUT', 'Fournir exactement un de queryId ou definition.')
      }
      let def: QueryDefinition
      if (queryId !== undefined) {
        const saved = await findVisibleQuery(c, queryId)
        if (!saved) return suiviError('QUERY_NOT_FOUND', `Requête introuvable : ${queryId}.`)
        def = { mode: saved.mode, sqlText: saved.sqlText, builderConfig: saved.builderConfig }
      } else {
        def = { mode: definition!.mode, sqlText: definition!.sqlText, builderConfig: asBuilderConfig(definition!.builderConfig) }
      }
      const run = await runDefinition(c, def)
      if (!run.ok) return suiviError(run.code, run.reason)
      return jsonToolResult({
        sql: run.sql,
        columns: run.result.columns,
        rows: run.result.rows.slice(offset, offset + limit),
        total: run.result.rows.length,
        offset,
        limit,
      })
    },
  )

  server.registerTool(
    'create_query',
    {
      title: 'Create saved query',
      description:
        'Crée une requête sauvegardée de la vue Suivi. dryRun (défaut true) : valide, EXÉCUTE la ' +
        'requête et retourne un aperçu SANS RIEN ÉCRIRE. Validation : mode sql → sqlText seul, ' +
        'lecture seule ; mode builder → builderConfig seul, type et champs existants ; la requête ' +
        "doit s'exécuter ; pas d'autre requête du même scope avec le même titre. scope private " +
        'exige --user.',
      inputSchema: createQueryInput,
    },
    async ({ title, mode, sqlText, builderConfig: builderIn, scope, dryRun }) => {
      const builderConfig = asBuilderConfig(builderIn)
      const readonly = await assertWritableBranch(c)
      if (readonly) return readonly
      const { username, hasUser } = resolveUser(c)
      if (scope === 'private' && !hasUser) return suiviError('PRIVATE_SCOPE_UNAVAILABLE', PRIVATE_SCOPE_REASON)
      const cleanTitle = title.trim()
      if (!cleanTitle) return suiviError('INVALID_INPUT', 'title ne peut pas être vide.')

      const existing = await c.savedQueries.list(c.repoPath, username)
      const dup = findDuplicateTitle(existing, cleanTitle, scope)
      if (dup) return suiviError('DUPLICATE_TITLE', `Une requête ${scope === 'shared' ? 'partagée' : 'privée'} porte déjà ce titre : ${dup.id} "${dup.title}".`)

      const def: QueryDefinition = { mode, sqlText, builderConfig }
      const run = await runDefinition(c, def)
      if (!run.ok) return suiviError(run.code, run.reason)

      if (dryRun) {
        const query: SavedQuery = {
          id: scope === 'shared' ? await peekSharedQueryId(c) : "(généré à l'écriture)",
          title: cleanTitle,
          mode,
          ...(mode === 'sql' ? { sqlText } : { builderConfig }),
          scope,
          createdBy: 'mcp',
          createdAt: new Date().toISOString(),
        }
        return jsonToolResult({ dryRun: true, query, preview: preview(run.result) })
      }

      const query = await c.savedQueries.create(c.repoPath, username, {
        title: cleanTitle,
        mode,
        ...(mode === 'sql' ? { sqlText } : { builderConfig }),
        scope,
        createdBy: 'mcp',
      })
      return jsonToolResult({ dryRun: false, query, preview: preview(run.result) })
    },
  )

  server.registerTool(
    'update_query',
    {
      title: 'Update saved query',
      description:
        'Modifie une requête sauvegardée (titre et/ou définition). dryRun (défaut true) : aperçu ' +
        'SANS RIEN ÉCRIRE. La définition résultante est revalidée et réexécutée ; changer de mode ' +
        'exige la définition complète du nouveau mode. warnings liste les widgets dont une colonne ' +
        'mappée disparaît du résultat (non bloquant). Le scope ne se change pas ici.',
      inputSchema: updateQueryInput,
    },
    async ({ id, title, mode, sqlText, builderConfig: builderIn, dryRun }) => {
      const builderConfig = asBuilderConfig(builderIn)
      const readonly = await assertWritableBranch(c)
      if (readonly) return readonly
      const { username, hasUser } = resolveUser(c)
      if (isPrivateScopeId(id) && !hasUser) return suiviError('PRIVATE_SCOPE_UNAVAILABLE', PRIVATE_SCOPE_REASON)
      const existing = await findVisibleQuery(c, id)
      if (!existing) return suiviError('QUERY_NOT_FOUND', `Requête introuvable : ${id}.`)

      const newMode = mode ?? existing.mode
      const def: QueryDefinition =
        newMode !== existing.mode
          ? { mode: newMode, sqlText, builderConfig }
          : newMode === 'sql'
            ? { mode: 'sql', sqlText: sqlText ?? existing.sqlText, builderConfig }
            : { mode: 'builder', sqlText, builderConfig: builderConfig ?? existing.builderConfig }

      let cleanTitle: string | undefined
      if (title !== undefined) {
        cleanTitle = title.trim()
        if (!cleanTitle) return suiviError('INVALID_INPUT', 'title ne peut pas être vide.')
        const all = await c.savedQueries.list(c.repoPath, username)
        const dup = findDuplicateTitle(all, cleanTitle, existing.scope, id)
        if (dup) return suiviError('DUPLICATE_TITLE', `Une autre requête du même scope porte déjà ce titre : ${dup.id} "${dup.title}".`)
      }

      const run = await runDefinition(c, def)
      if (!run.ok) return suiviError(run.code, run.reason)
      const warnings = await brokenWidgetWarnings(c, id, resultColumnNames(run.result))

      const dto: UpdateSavedQueryDto = {
        mode: def.mode,
        ...(def.mode === 'sql' ? { sqlText: def.sqlText } : { builderConfig: def.builderConfig }),
        ...(cleanTitle !== undefined ? { title: cleanTitle } : {}),
      }

      if (dryRun) {
        const { sqlText: _s, builderConfig: _b, ...base } = existing
        return jsonToolResult({ dryRun: true, query: { ...base, ...dto }, preview: preview(run.result), warnings })
      }
      const query = await c.savedQueries.update(c.repoPath, username, id, dto)
      return jsonToolResult({ dryRun: false, query, preview: preview(run.result), warnings })
    },
  )

  server.registerTool(
    'delete_query',
    {
      title: 'Delete saved query',
      description:
        'Supprime une requête sauvegardée. dryRun (défaut true) : retourne la requête qui serait ' +
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
        const list = dependents.map((d) => ({
          dashboardId: d.dashboardId,
          dashboardTitle: d.dashboardTitle,
          widgetId: d.widgetId,
          widgetTitle: d.widgetTitle,
        }))
        return suiviError('QUERY_IN_USE', `Requête utilisée par ${dependents.length} widget(s) : ${JSON.stringify(list)}`)
      }

      if (!dryRun) await c.savedQueries.delete(c.repoPath, username, id)
      return jsonToolResult({ dryRun, deleted: existing })
    },
  )
}
