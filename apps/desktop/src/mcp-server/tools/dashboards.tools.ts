import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Dashboard, QueryDefinition, Widget, WidgetFieldMapping } from '@polenta/types'
import type { McpContainer } from '../container'
import { jsonToolResult } from '../mcp-types'
import { isPrivateScopeId } from '../../main/services/id-scope.util'
import type { UpdateWidgetDto } from '../../main/services/dashboards.service'
import {
  findDuplicateTitle,
  orderedWidgets,
  pruneMapping,
  validateOrder,
  validateWidget,
  type SuiviWarning,
} from '../../main/services/suivi-validation.util'
import {
  assertWritableBranch,
  findVisibleDashboard,
  findVisibleQuery,
  peekSharedId,
  PRIVATE_SCOPE_REASON,
  resolveUser,
  resultColumnNames,
  runDefinition,
  suiviError,
} from './suivi-common'

/**
 * Tools « dashboards » de la vue Suivi (GH18 — specs/GH18-design.md §7.2) :
 * `list_dashboards`, `create/update/delete_dashboard`, `add/update/delete_widget`,
 * `reorder_widgets`. Écritures via `DashboardsService` (partagé :
 * `dashboards/DASHBOARD-xxxx.yaml`, widgets embarqués ; privé : `.{user}.pref`).
 * `list_dashboards` ne déclenche jamais le seed des dashboards pré-configurés.
 */

const scopeSchema = z.enum(['shared', 'private'])
const widgetTypeSchema = z.enum(['bar', 'pie', 'line', 'kpi', 'table'])
const widgetSizeSchema = z.enum(['sm', 'md', 'lg'])

const fieldMappingSchema = z
  .object({
    category: z.string().optional().describe('bar/line/pie : colonne des catégories'),
    measure: z.string().optional().describe('bar/line/pie/kpi : colonne numérique'),
    series: z.string().optional().describe('bar/line : colonne de série (multi-série)'),
    stacked: z.boolean().optional().describe('bar avec series : empiler les séries'),
    columns: z.array(z.string()).optional().describe('table : colonnes affichées (absent = toutes)'),
  })
  .strict()

const listDashboardsInput = {
  scope: scopeSchema.optional().describe('ne garder que ce scope'),
}

const createDashboardInput = {
  title: z.string().min(1),
  scope: scopeSchema.optional().default('shared'),
  dryRun: z.boolean().optional().default(true),
}

const updateDashboardInput = {
  id: z.string().min(1),
  title: z.string().min(1),
  dryRun: z.boolean().optional().default(true),
}

const deleteDashboardInput = {
  id: z.string().min(1),
  dryRun: z.boolean().optional().default(true),
}

const addWidgetInput = {
  dashboardId: z.string().min(1),
  title: z.string().min(1),
  queryId: z.string().min(1).describe('requête sauvegardée (cf. list_queries)'),
  type: widgetTypeSchema,
  fieldMapping: fieldMappingSchema,
  size: widgetSizeSchema.optional().default('md'),
  position: z.number().int().min(0).optional().describe('index dans l’ordre des widgets, défaut = à la fin'),
  dryRun: z.boolean().optional().default(true),
}

const updateWidgetInput = {
  dashboardId: z.string().min(1),
  widgetId: z.string().min(1),
  title: z.string().min(1).optional(),
  queryId: z.string().min(1).optional(),
  type: widgetTypeSchema.optional(),
  fieldMapping: fieldMappingSchema.optional().describe('remplace entièrement le mapping existant'),
  size: widgetSizeSchema.optional(),
  dryRun: z.boolean().optional().default(true),
}

const deleteWidgetInput = {
  dashboardId: z.string().min(1),
  widgetId: z.string().min(1),
  dryRun: z.boolean().optional().default(true),
}

const reorderWidgetsInput = {
  dashboardId: z.string().min(1),
  order: z.array(z.string().min(1)).describe('permutation exacte des ids de widgets du dashboard'),
  dryRun: z.boolean().optional().default(true),
}

const PENDING_ID = "(généré à l'écriture)"

/** Retire les clés `undefined` (sinon le spread des services écraserait l'existant). */
function definedOnly<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>
}

/** Dashboard tel que renvoyé par les tools : widgets dans l'ordre d'affichage. */
function presentDashboard(d: Dashboard, queryTitles?: Map<string, string>) {
  return {
    ...d,
    widgets: orderedWidgets(d).map((w) =>
      queryTitles ? { ...w, queryTitle: queryTitles.get(w.queryId) ?? null } : w,
    ),
  }
}

/** Ordre après insertion de `id` à `position` (fin si absente ou au-delà). */
function insertAt(order: string[], id: string, position: number | undefined): string[] {
  const rest = order.filter((x) => x !== id)
  const at = position === undefined ? rest.length : Math.min(position, rest.length)
  return [...rest.slice(0, at), id, ...rest.slice(at)]
}

type ToolError = ReturnType<typeof suiviError>

/** Préambule commun des écritures sur un dashboard existant : branche, scope, existence. */
async function loadWritableDashboard(c: McpContainer, id: string): Promise<{ dashboard: Dashboard } | { error: ToolError }> {
  const readonly = await assertWritableBranch(c)
  if (readonly) return { error: readonly }
  if (isPrivateScopeId(id) && !resolveUser(c).hasUser) return { error: suiviError('PRIVATE_SCOPE_UNAVAILABLE', PRIVATE_SCOPE_REASON) }
  const dashboard = await findVisibleDashboard(c, id)
  if (!dashboard) return { error: suiviError('DASHBOARD_NOT_FOUND', `Dashboard introuvable : ${id}.`) }
  return { dashboard }
}

/**
 * Règles 2 à 7 d'`add_widget` pour un widget candidat (ajout ou modification) : requête
 * visible, scope, exécution de la requête, mapping/colonnes/doublon.
 */
async function checkWidget(
  c: McpContainer,
  dashboard: Dashboard,
  widget: { id?: string; type: Widget['type']; queryId: string; fieldMapping: WidgetFieldMapping },
): Promise<{ error: ToolError } | { warnings: SuiviWarning[]; columns: unknown; total: number }> {
  const query = await findVisibleQuery(c, widget.queryId)
  if (!query) return { error: suiviError('QUERY_NOT_FOUND', `Requête introuvable : ${widget.queryId}.`) }
  if (dashboard.scope === 'shared' && isPrivateScopeId(widget.queryId)) {
    return {
      error: suiviError(
        'PRIVATE_QUERY_IN_SHARED_DASHBOARD',
        `Le dashboard partagé ${dashboard.id} ne peut pas utiliser la requête privée ${widget.queryId}.`,
      ),
    }
  }
  const def: QueryDefinition = { mode: query.mode, sqlText: query.sqlText, builderConfig: query.builderConfig }
  const run = await runDefinition(c, def)
  if (!run.ok) return { error: suiviError(run.code, `Requête ${query.id} : ${run.reason}`) }
  const siblings = dashboard.widgets.filter((w) => w.id !== widget.id)
  const { issue, warnings } = validateWidget(widget, resultColumnNames(run.result), siblings)
  if (issue) return { error: suiviError(issue.code, issue.reason) }
  return { warnings, columns: run.result.columns, total: run.result.rows.length }
}

export function registerDashboardTools(server: McpServer, container: McpContainer): void {
  const c = container

  server.registerTool(
    'list_dashboards',
    {
      title: 'List dashboards',
      description:
        'Liste les dashboards de la vue Suivi (partagés ; + privés de --user si fourni), widgets ' +
        "dans l'ordre d'affichage. Chaque widget : id, title, queryId, queryTitle, type " +
        '(bar|pie|line|kpi|table), fieldMapping, size (sm|md|lg).',
      inputSchema: listDashboardsInput,
    },
    async ({ scope }) => {
      const { username } = resolveUser(c)
      let dashboards = await c.dashboards.list(c.repoPath, username)
      if (scope) dashboards = dashboards.filter((d) => d.scope === scope)
      const queries = await c.savedQueries.list(c.repoPath, username)
      const titles = new Map(queries.map((q) => [q.id, q.title]))
      return jsonToolResult({ dashboards: dashboards.map((d) => presentDashboard(d, titles)) })
    },
  )

  server.registerTool(
    'create_dashboard',
    {
      title: 'Create dashboard',
      description:
        'Crée un dashboard vide (ajouter ensuite des widgets avec add_widget). dryRun (défaut ' +
        "true) : aperçu SANS RIEN ÉCRIRE. Pas d'autre dashboard du même scope avec le même titre. " +
        'scope private exige --user.',
      inputSchema: createDashboardInput,
    },
    async ({ title, scope, dryRun }) => {
      const readonly = await assertWritableBranch(c)
      if (readonly) return readonly
      const { username, hasUser } = resolveUser(c)
      if (scope === 'private' && !hasUser) return suiviError('PRIVATE_SCOPE_UNAVAILABLE', PRIVATE_SCOPE_REASON)
      const cleanTitle = title.trim()
      if (!cleanTitle) return suiviError('INVALID_INPUT', 'title ne peut pas être vide.')
      const all = await c.dashboards.list(c.repoPath, username)
      const dup = findDuplicateTitle(all, cleanTitle, scope)
      if (dup) return suiviError('DUPLICATE_TITLE', `Un dashboard ${scope === 'shared' ? 'partagé' : 'privé'} porte déjà ce titre : ${dup.id} "${dup.title}".`)

      if (dryRun) {
        const dashboard: Dashboard = {
          id: scope === 'shared' ? await peekSharedId(c, 'DASHBOARD') : PENDING_ID,
          title: cleanTitle,
          scope,
          widgetOrder: [],
          widgets: [],
          createdBy: 'mcp',
          createdAt: new Date().toISOString(),
        }
        return jsonToolResult({ dryRun: true, dashboard })
      }
      const dashboard = await c.dashboards.create(c.repoPath, username, { title: cleanTitle, scope, createdBy: 'mcp' })
      return jsonToolResult({ dryRun: false, dashboard })
    },
  )

  server.registerTool(
    'update_dashboard',
    {
      title: 'Rename dashboard',
      description: 'Renomme un dashboard. dryRun (défaut true) : aperçu SANS RIEN ÉCRIRE.',
      inputSchema: updateDashboardInput,
    },
    async ({ id, title, dryRun }) => {
      const loaded = await loadWritableDashboard(c, id)
      if ('error' in loaded) return loaded.error
      const { username } = resolveUser(c)
      const cleanTitle = title.trim()
      if (!cleanTitle) return suiviError('INVALID_INPUT', 'title ne peut pas être vide.')
      const all = await c.dashboards.list(c.repoPath, username)
      const dup = findDuplicateTitle(all, cleanTitle, loaded.dashboard.scope, id)
      if (dup) return suiviError('DUPLICATE_TITLE', `Un autre dashboard du même scope porte déjà ce titre : ${dup.id} "${dup.title}".`)

      const dashboard = dryRun
        ? { ...loaded.dashboard, title: cleanTitle }
        : await c.dashboards.update(c.repoPath, username, id, { title: cleanTitle })
      return jsonToolResult({ dryRun, dashboard: presentDashboard(dashboard) })
    },
  )

  server.registerTool(
    'delete_dashboard',
    {
      title: 'Delete dashboard',
      description:
        'Supprime un dashboard et ses widgets (les requêtes restent). dryRun (défaut true) : ' +
        'retourne le dashboard qui serait supprimé, SANS RIEN ÉCRIRE.',
      inputSchema: deleteDashboardInput,
    },
    async ({ id, dryRun }) => {
      const loaded = await loadWritableDashboard(c, id)
      if ('error' in loaded) return loaded.error
      if (!dryRun) await c.dashboards.delete(c.repoPath, resolveUser(c).username, id)
      return jsonToolResult({ dryRun, deleted: presentDashboard(loaded.dashboard) })
    },
  )

  server.registerTool(
    'add_widget',
    {
      title: 'Add widget',
      description:
        'Ajoute un indicateur (widget) à un dashboard. dryRun (défaut true) : valide, EXÉCUTE la ' +
        'requête et retourne un aperçu SANS RIEN ÉCRIRE. fieldMapping : bar/line/pie → category + ' +
        'measure (series pour bar/line, stacked pour bar avec series) ; kpi → measure ; table → ' +
        'columns optionnel. Les colonnes doivent exister dans le résultat de la requête (appeler ' +
        "run_query d'abord). Un dashboard partagé n'accepte pas de requête privée. Refus d'un " +
        'widget identique (même requête, type et mapping).',
      inputSchema: addWidgetInput,
    },
    async ({ dashboardId, title, queryId, type, fieldMapping, size, position, dryRun }) => {
      const loaded = await loadWritableDashboard(c, dashboardId)
      if ('error' in loaded) return loaded.error
      const { dashboard } = loaded
      const cleanTitle = title.trim()
      if (!cleanTitle) return suiviError('INVALID_INPUT', 'title ne peut pas être vide.')

      const mapping = definedOnly(fieldMapping) as WidgetFieldMapping
      const checked = await checkWidget(c, dashboard, { type, queryId, fieldMapping: mapping })
      if ('error' in checked) return checked.error
      const preview = { columns: checked.columns, total: checked.total }

      if (dryRun) {
        const widget: Widget = { id: PENDING_ID, title: cleanTitle, queryId, type, fieldMapping: mapping, size }
        const next: Dashboard = {
          ...dashboard,
          widgets: [...dashboard.widgets, widget],
          widgetOrder: insertAt(dashboard.widgetOrder, widget.id, position),
        }
        return jsonToolResult({ dryRun: true, dashboard: presentDashboard(next), widget, preview, warnings: checked.warnings })
      }

      const { username } = resolveUser(c)
      let updated = await c.dashboards.addWidget(c.repoPath, username, dashboardId, {
        title: cleanTitle, queryId, type, fieldMapping: mapping, size,
      })
      const widget = updated.widgets[updated.widgets.length - 1]
      const order = insertAt(updated.widgetOrder, widget.id, position)
      if (order.join('\n') !== updated.widgetOrder.join('\n')) {
        updated = await c.dashboards.setWidgetOrder(c.repoPath, username, dashboardId, order)
      }
      return jsonToolResult({ dryRun: false, dashboard: presentDashboard(updated), widget, preview, warnings: checked.warnings })
    },
  )

  server.registerTool(
    'update_widget',
    {
      title: 'Update widget',
      description:
        'Modifie un widget (titre, requête, type, mapping, taille). fieldMapping fourni REMPLACE ' +
        "l'ancien. Le widget résultant repasse les mêmes contrôles qu'add_widget. dryRun (défaut " +
        'true) : aperçu SANS RIEN ÉCRIRE.',
      inputSchema: updateWidgetInput,
    },
    async ({ dashboardId, widgetId, title, queryId, type, fieldMapping, size, dryRun }) => {
      const loaded = await loadWritableDashboard(c, dashboardId)
      if ('error' in loaded) return loaded.error
      const { dashboard } = loaded
      const existing = dashboard.widgets.find((w) => w.id === widgetId)
      if (!existing) return suiviError('WIDGET_NOT_FOUND', `Widget introuvable dans ${dashboardId} : ${widgetId}.`)

      let cleanTitle: string | undefined
      if (title !== undefined) {
        cleanTitle = title.trim()
        if (!cleanTitle) return suiviError('INVALID_INPUT', 'title ne peut pas être vide.')
      }
      // Type changé sans nouveau mapping : on retire les clés inapplicables au nouveau type
      // (l'éditeur de l'app les conserve) plutôt que de refuser.
      const newMapping = fieldMapping
        ? (definedOnly(fieldMapping) as WidgetFieldMapping)
        : type !== undefined && type !== existing.type
          ? pruneMapping(type, existing.fieldMapping ?? {})
          : undefined
      const dto: UpdateWidgetDto = definedOnly({ title: cleanTitle, queryId, type, fieldMapping: newMapping, size })
      const merged: Widget = { ...existing, ...dto }

      // Titre/taille seuls : contenu inchangé, pas de revalidation (un widget créé dans
      // l'app peut porter un mapping que les règles MCP refuseraient — il reste renommable).
      const touchesContent = queryId !== undefined || type !== undefined || fieldMapping !== undefined
      let preview: { columns: unknown; total: number } | null = null
      let warnings: SuiviWarning[] = []
      if (touchesContent) {
        const checked = await checkWidget(c, dashboard, merged)
        if ('error' in checked) return checked.error
        preview = { columns: checked.columns, total: checked.total }
        warnings = checked.warnings
      }

      if (dryRun) {
        const next = { ...dashboard, widgets: dashboard.widgets.map((w) => (w.id === widgetId ? merged : w)) }
        return jsonToolResult({ dryRun: true, dashboard: presentDashboard(next), widget: merged, preview, warnings })
      }
      const updated = await c.dashboards.updateWidget(c.repoPath, resolveUser(c).username, dashboardId, widgetId, dto)
      const widget = updated.widgets.find((w) => w.id === widgetId)
      return jsonToolResult({ dryRun: false, dashboard: presentDashboard(updated), widget, preview, warnings })
    },
  )

  server.registerTool(
    'delete_widget',
    {
      title: 'Delete widget',
      description: 'Retire un widget d’un dashboard. dryRun (défaut true) : aperçu SANS RIEN ÉCRIRE.',
      inputSchema: deleteWidgetInput,
    },
    async ({ dashboardId, widgetId, dryRun }) => {
      const loaded = await loadWritableDashboard(c, dashboardId)
      if ('error' in loaded) return loaded.error
      const { dashboard } = loaded
      if (!dashboard.widgets.some((w) => w.id === widgetId)) {
        return suiviError('WIDGET_NOT_FOUND', `Widget introuvable dans ${dashboardId} : ${widgetId}.`)
      }
      const next = dryRun
        ? {
            ...dashboard,
            widgets: dashboard.widgets.filter((w) => w.id !== widgetId),
            widgetOrder: dashboard.widgetOrder.filter((id) => id !== widgetId),
          }
        : await c.dashboards.deleteWidget(c.repoPath, resolveUser(c).username, dashboardId, widgetId)
      return jsonToolResult({ dryRun, dashboard: presentDashboard(next) })
    },
  )

  server.registerTool(
    'reorder_widgets',
    {
      title: 'Reorder widgets',
      description:
        "Réordonne les widgets d'un dashboard. order = permutation exacte des ids de widgets " +
        '(cf. list_dashboards). dryRun (défaut true) : aperçu SANS RIEN ÉCRIRE.',
      inputSchema: reorderWidgetsInput,
    },
    async ({ dashboardId, order, dryRun }) => {
      const loaded = await loadWritableDashboard(c, dashboardId)
      if ('error' in loaded) return loaded.error
      const { dashboard } = loaded
      const issue = validateOrder(dashboard.widgets.map((w) => w.id), order)
      if (issue) return suiviError(issue.code, issue.reason)
      const next = dryRun
        ? { ...dashboard, widgetOrder: order }
        : await c.dashboards.setWidgetOrder(c.repoPath, resolveUser(c).username, dashboardId, order)
      return jsonToolResult({ dryRun, dashboard: presentDashboard(next) })
    },
  )
}
