import type {
  DescribedObject, ProjectSchema, RowTarget, ScriptClientInfo, ScriptRunRequest, ScriptRunResult, WidgetCode,
} from '@polenta/types'
import { describeTemplates, flattenSystemNodes } from '@polenta/types'
import type { GraphService } from './graph.service'
import type { ScriptEngineService } from './script-engine.service'
import type { SavedQueriesService } from './saved-queries.service'
import type { DashboardsService } from './dashboards.service'
import type { SchemaService } from './schema.service'
import type { WorkspaceTreeService } from './workspace-tree.service'
import { applyQueryTemplate, applyWidgetTemplate } from './suivi-store.util'
import type { TemplateInput } from './suivi-store.util'

// GH74 — façade de la vue Suivi pour l'IPC, le serveur web et le MCP (specs/GH74-design.md §2.7) :
// exécution d'une requête / d'un widget enregistré ou de code fourni, drill-down, modèles.

/** Type d'objet proposé par le formulaire « Liste filtrée » (champs filtrables). */
export interface SuiviObjectTypeOption {
  objectTypeRef: string
  /** Composant (nœud local ou repo) qui déclare le type. */
  component: string
  label: string
  category: 'requirement' | 'test' | 'campaign'
  fields: string[]
}

const SYSTEM_FIELDS: Record<SuiviObjectTypeOption['category'], string[]> = {
  requirement: ['id', 'title', 'status', 'component', 'version', 'needsRevalidation', 'coverageStatus', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'],
  test: ['id', 'title', 'status', 'component', 'version', 'needsRevalidation', 'latestRunResult', 'latestRunDate', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'],
  campaign: [
    'campaignId', 'campaignTitle', 'campaignStatus', 'campaignCreatedAt', 'baselineRef', 'level', 'campaignComponent', 'component',
    'entryId', 'testCaseId', 'requirementId', 'testTitle', 'status', 'executed', 'addedAt', 'executedAt', 'executedDay', 'executedBy', 'runId',
  ],
}

export class SuiviService {
  constructor(
    private readonly engine: ScriptEngineService,
    private readonly graph: GraphService,
    private readonly queries: SavedQueriesService,
    private readonly dashboards: DashboardsService,
    private readonly schema: SchemaService,
    private readonly workspaceTree?: WorkspaceTreeService,
  ) {}

  /**
   * Exécute un widget enregistré (`dashboardId` + `widgetId`), une requête enregistrée (`queryId`)
   * ou un script fourni. Une transformation fournie remplace celle du widget (aperçu).
   */
  async run(repoPath: string, workspaceDir: string | undefined, username: string, req: ScriptRunRequest, client: ScriptClientInfo): Promise<ScriptRunResult> {
    let queryId = req.queryId
    let transform: string | undefined = req.transform ?? undefined
    let transformFile = req.transformFile
    if (req.dashboardId && req.widgetId) {
      const widget = await this.dashboards.getWidget(repoPath, username, req.dashboardId, req.widgetId)
      if (!widget) return fail('runtime', `Widget introuvable : ${req.widgetId}.`)
      queryId = widget.queryId
      if (req.transform === undefined) transform = widget.transform
      transformFile ??= `${widget.id}.js`
    }
    let script = req.script
    if (script === undefined) {
      if (!queryId) return fail('runtime', 'Aucun script à exécuter.')
      const query = await this.queries.findOne(repoPath, username, queryId)
      if (!query) return fail('runtime', `Requête introuvable : ${queryId}.`)
      if (query.state.readOnly === 'legacy-sql') {
        return fail('legacy-sql', `Requête SQL non prise en charge depuis GH74 (« ${query.title} ») : à réécrire en script de données, ou à supprimer.`)
      }
      script = query.script
    }
    return this.engine.run(repoPath, workspaceDir, {
      script,
      ...(transform !== undefined ? { transform, transformFile: transformFile ?? 'transform.js' } : {}),
      drill: req.drill ?? null,
      limit: req.limit,
    }, client)
  }

  describeIds(repoPath: string, workspaceDir: string | undefined, ids: string[], locale?: string): Promise<DescribedObject[]> {
    return this.graph.describeIds(repoPath, ids, workspaceDir, locale?.startsWith('en') ? 'en' : 'fr')
  }

  resolveTarget(repoPath: string, workspaceDir: string | undefined, id: string): Promise<RowTarget | null> {
    return this.graph.resolveTarget(repoPath, id, workspaceDir)
  }

  templates() {
    return describeTemplates()
  }

  /** Code généré par un modèle (aperçu du formulaire, sans enregistrer). */
  renderTemplate(kind: 'query' | 'widget', input: TemplateInput): { script: string } | WidgetCode {
    return kind === 'query' ? { script: applyQueryTemplate(input).script } : applyWidgetTemplate(input).code
  }

  /** Types d'objet du périmètre et leurs champs, pour le formulaire « Liste filtrée ». */
  async objectTypes(repoPath: string, workspaceDir?: string): Promise<SuiviObjectTypeOption[]> {
    const repos: { path: string; name: string }[] = [{ path: repoPath, name: repoPath.split(/[\\/]/).pop() ?? repoPath }]
    if (workspaceDir && this.workspaceTree) {
      const tree = await this.workspaceTree.readCache(workspaceDir)
      for (const n of tree?.nodes ?? []) if (n.repoPath && n.repoPath !== repoPath) repos.push({ path: n.repoPath, name: n.name })
      const own = tree?.nodes.find((n) => n.repoPath === repoPath)
      if (own) repos[0].name = own.name
    }
    const out: SuiviObjectTypeOption[] = []
    for (const r of repos) {
      const schema = (await this.schema.get(r.path).catch(() => null)) as ProjectSchema | null
      for (const { node } of flattenSystemNodes(schema?.nodes ?? [])) {
        for (const t of node.objectTypes ?? []) {
          const category = t.category as SuiviObjectTypeOption['category']
          const custom = (t.fields ?? []).map((f) => (category === 'campaign' ? `campaign_${f.name}` : f.name))
          out.push({
            objectTypeRef: `${node.name}::${t.name}`,
            component: node.name === 'root' ? r.name : node.name,
            label: t.label ?? t.name,
            category,
            fields: [...SYSTEM_FIELDS[category], ...custom],
          })
        }
      }
    }
    return out
  }
}

function fail(kind: 'runtime' | 'legacy-sql', message: string): ScriptRunResult {
  return { ok: false, error: { kind, message, file: null, line: null, column: null } }
}
