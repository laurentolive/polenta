import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Dashboard, Widget } from '@polenta/types'
import type { McpContainer } from '../container'
import { jsonToolResult } from '../mcp-types'
import { isPrivateScopeId } from '../../main/services/id-scope.util'
import {
  checkSpec,
  findDuplicateTitle,
  orderedWidgets,
  validateOrder,
  validateTemplateInput,
  type SuiviWarning,
} from '../../main/services/suivi-validation.util'
import { applyWidgetTemplate } from '../../main/services/suivi-store.util'
import { compileSpecError } from '../spec-compile'
import { templateSchema } from './queries.tools'
import {
  assertWritableBranch,
  findVisibleDashboard,
  findVisibleQuery,
  peekSharedId,
  preview as previewOf,
  PRIVATE_SCOPE_REASON,
  resolveUser,
  runScript,
  suiviError,
} from './suivi-common'

/**
 * Tools « dashboards » de la vue Suivi (GH18 ; GH74 : widgets = transformation JS + spec Vega-Lite) :
 * `list_dashboards`, `create/update/delete_dashboard`, `add/update/delete_widget`,
 * `reorder_widgets`. Écritures via `DashboardsService` (partagé : `dashboards/DASHBOARD-xxxx/` ;
 * privé : `.{user}.pref`). `list_dashboards` ne déclenche jamais le seed des dashboards pré-configurés.
 */

const scopeSchema = z.enum(['shared', 'private'])
const widgetSizeSchema = z.enum(['sm', 'md', 'lg'])

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
  queryId: z.string().min(1).describe('requête enregistrée (cf. list_queries)'),
  transform: z.string().optional().describe('transformation JS `export default (rows, polenta) => rows` (regroupement, union des _ids) — exclusif avec template'),
  spec: z.string().optional().describe('spec Vega-Lite (texte JSON, "data": { "name": "rows" }) — requise sans template'),
  template: templateSchema.optional().describe('modèle de widget + paramètres (cf. list_templates) : transformation et spec générées'),
  size: widgetSizeSchema.optional().default('md'),
  position: z.number().int().min(0).optional().describe('index dans l’ordre des widgets, défaut = à la fin'),
  dryRun: z.boolean().optional().default(true),
}

const updateWidgetInput = {
  dashboardId: z.string().min(1),
  widgetId: z.string().min(1),
  title: z.string().min(1).optional(),
  queryId: z.string().min(1).optional(),
  transform: z.string().nullable().optional().describe('nouvelle transformation (null : aucune) — détache le widget de son modèle'),
  spec: z.string().optional().describe('nouvelle spec Vega-Lite — détache le widget de son modèle'),
  template: templateSchema.optional().describe('nouveau modèle / paramètres : code régénéré'),
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
  if (dashboard.state.readOnly) return { error: suiviError('SUIVI_READ_ONLY', `Dashboard ${id} en lecture seule (${dashboard.state.readOnly}).`) }
  return { dashboard }
}

/**
 * Contrôles d'un widget candidat (ajout ou modification) : requête visible, portée, spec (forme puis
 * compilation Vega-Lite), exécution de la requête et de la transformation (aperçu ; une erreur est
 * un avertissement, pas un refus).
 */
async function checkWidget(
  c: McpContainer,
  dashboard: Dashboard,
  widget: { queryId: string; transform?: string; spec: string },
): Promise<{ error: ToolError } | { warnings: SuiviWarning[]; preview: unknown }> {
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
  const { issue, warnings } = checkSpec(widget.spec)
  if (issue) return { error: suiviError(issue.code, issue.reason) }
  const compileError = await compileSpecError(widget.spec)
  if (compileError) return { error: suiviError('SPEC_INVALID', `Spec Vega-Lite invalide : ${compileError}`) }
  if (compileError === undefined) warnings.push({ code: 'SPEC_UNCHECKED', reason: 'Compilateur Vega-Lite indisponible : spec non compilée.' })
  const run = await runScript(c, { queryId: widget.queryId, transform: widget.transform ?? null, transformFile: 'transform.js' })
  if (!run.ok) warnings.push({ code: 'SCRIPT_ERROR', reason: `Exécution en erreur (${run.error.kind}) : ${run.error.message}${run.error.line ? ` — ${run.error.file}:${run.error.line}` : ''}.` })
  return { warnings, preview: previewOf(run) }
}

/** Code d'un widget à partir de l'entrée MCP : modèle, ou transformation + spec fournies. */
function widgetCode(input: { transform?: string | null; spec?: string; template?: { id: string; params: Record<string, unknown> } }):
  { error: ToolError } | { transform?: string; spec: string } {
  if (input.template) {
    if (input.transform !== undefined || input.spec !== undefined) return { error: suiviError('INVALID_INPUT', 'Fournir template, ou transform / spec, pas les deux.') }
    const issue = validateTemplateInput('widget', input.template)
    if (issue) return { error: suiviError(issue.code, issue.reason) }
    const { code } = applyWidgetTemplate(input.template)
    return { ...(code.transform !== undefined ? { transform: code.transform } : {}), spec: code.spec }
  }
  if (input.spec === undefined) return { error: suiviError('INVALID_INPUT', 'spec (ou template) requise.') }
  return { ...(typeof input.transform === 'string' ? { transform: input.transform } : {}), spec: input.spec }
}

export function registerDashboardTools(server: McpServer, container: McpContainer): void {
  const c = container

  server.registerTool(
    'list_dashboards',
    {
      title: 'List dashboards',
      description:
        'Liste les dashboards de la vue Suivi (partagés ; + privés de --user si fourni), widgets ' +
        "dans l'ordre d'affichage. Chaque widget : id, title, queryId, queryTitle, transform (JS), spec " +
        "(Vega-Lite), template (modèle d'origine), state.customized, size (sm|md|lg).",
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
          formatVersion: 1,
          widgetOrder: [],
          widgets: [],
          createdBy: 'mcp',
          createdAt: new Date().toISOString(),
          state: { customized: false },
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
        'Ajoute un widget à un dashboard : un modèle + paramètres (cf. list_templates), ou une transformation JS ' +
        'facultative + une spec Vega-Lite (cf. get_data_contract : agréger dans la transformation en faisant ' +
        "l'union des _ids, jamais avec aggregate dans la spec ; données = { \"name\": \"rows\" }). dryRun " +
        '(défaut true) : valide la spec, EXÉCUTE requête + transformation et retourne un aperçu SANS RIEN ÉCRIRE. ' +
        "Un dashboard partagé n'accepte pas de requête privée.",
      inputSchema: addWidgetInput,
    },
    async ({ dashboardId, title, queryId, transform, spec, template, size, position, dryRun }) => {
      const loaded = await loadWritableDashboard(c, dashboardId)
      if ('error' in loaded) return loaded.error
      const { dashboard } = loaded
      const cleanTitle = title.trim()
      if (!cleanTitle) return suiviError('INVALID_INPUT', 'title ne peut pas être vide.')
      const code = widgetCode({ transform, spec, template })
      if ('error' in code) return code.error
      const checked = await checkWidget(c, dashboard, { queryId, ...code })
      if ('error' in checked) return checked.error

      if (dryRun) {
        const widget: Widget = { id: PENDING_ID, title: cleanTitle, queryId, size, ...code, state: { customized: !template } }
        const next: Dashboard = {
          ...dashboard,
          widgets: [...dashboard.widgets, widget],
          widgetOrder: insertAt(dashboard.widgetOrder, widget.id, position),
        }
        return jsonToolResult({ dryRun: true, dashboard: presentDashboard(next), widget, preview: checked.preview, warnings: checked.warnings })
      }

      const { username } = resolveUser(c)
      let updated = await c.dashboards.addWidget(c.repoPath, username, dashboardId, {
        title: cleanTitle, queryId, size, ...(template ? { template } : code),
      })
      const widget = updated.widgets[updated.widgets.length - 1]
      const order = insertAt(updated.widgetOrder, widget.id, position)
      if (order.join('\n') !== updated.widgetOrder.join('\n')) {
        updated = await c.dashboards.setWidgetOrder(c.repoPath, username, dashboardId, order)
      }
      return jsonToolResult({ dryRun: false, dashboard: presentDashboard(updated), widget, preview: checked.preview, warnings: checked.warnings })
    },
  )

  server.registerTool(
    'update_widget',
    {
      title: 'Update widget',
      description:
        'Modifie un widget (titre, requête, taille, transformation / spec, ou modèle + paramètres). Une ' +
        'transformation ou une spec fournie détache le widget de son modèle. Contenu modifié : mêmes contrôles ' +
        "qu'add_widget. dryRun (défaut true) : aperçu SANS RIEN ÉCRIRE.",
      inputSchema: updateWidgetInput,
    },
    async ({ dashboardId, widgetId, title, queryId, transform, spec, template, size, dryRun }) => {
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
      let nextCode: { transform?: string; spec: string } = { ...(existing.transform !== undefined ? { transform: existing.transform } : {}), spec: existing.spec }
      if (template) {
        const code = widgetCode({ template })
        if ('error' in code) return code.error
        nextCode = code
      } else {
        if (transform === null) nextCode = { spec: nextCode.spec }
        else if (transform !== undefined) nextCode = { ...nextCode, transform }
        if (spec !== undefined) nextCode = { ...nextCode, spec }
      }
      const { transform: _old, ...rest } = existing
      const merged: Widget = {
        ...rest,
        ...(cleanTitle !== undefined ? { title: cleanTitle } : {}),
        ...(queryId !== undefined ? { queryId } : {}),
        ...(size !== undefined ? { size } : {}),
        ...nextCode,
      }

      // Titre / taille seuls : contenu inchangé, pas de revalidation.
      const touchesContent = queryId !== undefined || transform !== undefined || spec !== undefined || template !== undefined
      let preview: unknown = null
      let warnings: SuiviWarning[] = []
      if (touchesContent) {
        const checked = await checkWidget(c, dashboard, merged)
        if ('error' in checked) return checked.error
        preview = checked.preview
        warnings = checked.warnings
      }
      if (dryRun) {
        const next = { ...dashboard, widgets: dashboard.widgets.map((w) => (w.id === widgetId ? merged : w)) }
        return jsonToolResult({ dryRun: true, dashboard: presentDashboard(next), widget: merged, preview, warnings })
      }
      const updated = await c.dashboards.updateWidget(c.repoPath, resolveUser(c).username, dashboardId, widgetId, {
        ...(cleanTitle !== undefined ? { title: cleanTitle } : {}),
        ...(queryId !== undefined ? { queryId } : {}),
        ...(size !== undefined ? { size } : {}),
        ...(template ? { template } : {}),
        ...(!template && transform !== undefined ? { transform } : {}),
        ...(!template && spec !== undefined ? { spec } : {}),
      })
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
