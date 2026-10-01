import * as fsP from 'fs/promises'
import type {
  CampaignExportPayload,
  DashboardExportPayload,
  ExportKind,
  RequirementsExportPayload,
  TemplateExportFormat,
  TestsExportPayload,
} from '@polenta/types'
import type { ExportTemplateLibrary } from '../../export-template-library'
import type { GitService } from '../../git.service'
import type { SchemaService } from '../../schema.service'
import type { AuthService } from '../../auth.service'
import type { TestsService } from '../../tests.service'
import type { RichConverter } from './template-data'
import type { RunLoader, TableBuilder } from './template-data-campaign'
import type { DrawioSnapshotter } from './drawio-ref'

interface BuilderContext {
  toRich: RichConverter
  loadRun: RunLoader
  toTable: TableBuilder
}

type KindDataBuilder = (payload: unknown, ctx: BuilderContext) => Promise<object>

const NO_RICH = { render: () => '' }

// Kinds pris en charge par un gabarit, par format — étendu au fil des sprints (GH34-design §5 :
// campagnes et dashboard au sprint 3, xlsx au sprint 4). Modules chargés en `import()` dynamique
// (T141) : ce service est construit au démarrage, markdown-it/docxtemplater ne doivent l'être
// qu'au premier export par gabarit.
const campaignData: KindDataBuilder = async (p, c) =>
  (await import('./template-data-campaign')).buildCampaignData(p as CampaignExportPayload, c.toRich, c.loadRun)

const DATA_BUILDERS: Partial<Record<`${ExportKind}:${TemplateExportFormat}`, KindDataBuilder>> = {
  'requirements:docx': async (p, c) => (await import('./template-data')).buildItemsData(p as RequirementsExportPayload, c.toRich),
  'tests:docx': async (p, c) => (await import('./template-data')).buildItemsData(p as TestsExportPayload, c.toRich),
  'campaign-plan:docx': campaignData,
  'campaign-report:docx': campaignData,
  'dashboard:docx': async (p, c) => (await import('./template-data-campaign')).buildDashboardData(p as DashboardExportPayload, c.toTable),
}

/**
 * GH34 — export à partir d'un gabarit client de la bibliothèque : résolution du fichier,
 * construction des données (communes + propres au kind), remplissage, puis écriture de la
 * destination seulement une fois le document entièrement généré.
 */
export class TemplateExportService {
  constructor(
    private readonly library: ExportTemplateLibrary,
    private readonly git: GitService,
    private readonly schema: SchemaService,
    private readonly auth: AuthService,
    private readonly tests: TestsService,
    /** Rendu des diagrammes draw.io en image (fenêtre cachée, `drawio-snapshot.ts`) — injecté
     *  pour que les vérifications automatiques puissent s'en passer (pas d'Electron). */
    private readonly snapshotDrawios: DrawioSnapshotter,
  ) {}

  async run(
    kind: ExportKind,
    format: TemplateExportFormat,
    payload: unknown,
    repoPath: string,
    templateRelPath: string,
    destPath: string,
  ): Promise<void> {
    const builder = DATA_BUILDERS[`${kind}:${format}`]
    if (!builder) throw new Error(`Export ${format} à partir d’un gabarit non disponible pour « ${kind} ».`)
    const templatePath = await this.library.resolve(templateRelPath)

    const [projectLabel, user, branch, commit, tags] = await Promise.all([
      this.schema.get(repoPath).then(s => s.nodes.find(n => n.name === 'root')?.label ?? '').catch(() => ''),
      // `local` = aucun compte connecté pour ce remote (GH29) : rien de signifiant à imprimer.
      this.auth.projectUsername(repoPath).then(u => (u === 'local' ? '' : u)).catch(() => ''),
      this.git.currentBranch(repoPath).catch(() => ''),
      this.git.headSha(repoPath).catch(() => ''),
      this.git.tagsAtHead(repoPath).catch(() => [] as string[]),
    ])
    const p = payload as { componentLabel?: string; campaign?: { component?: string } } | null
    const componentLabel = p?.componentLabel ?? p?.campaign?.component ?? ''
    const [{ buildCommonData }, { renderDocxTemplate }, { MarkdownToOoxml, textTableXml }, { collectDrawioRefs }] = await Promise.all([
      import('./template-data'),
      import('./docx-template'),
      import('./markdown-to-ooxml'),
      import('./drawio-ref'),
    ])
    const loadRun: RunLoader = async (testCaseId, runId) =>
      (await this.tests.findRuns(repoPath, testCaseId)).find(r => r.id === runId) ?? null
    const common = buildCommonData({
      projectLabel, componentLabel, user, kind, templateRelPath, branch, commit, tags, now: new Date(),
    })
    const buffer = await renderDocxTemplate(templatePath, templateRelPath, async pkg => {
      // Gabarit sans balise `{{@…}}` : pas de conversion (ni chargement d'images) inutile.
      let converter: InstanceType<typeof MarkdownToOoxml> | null = null
      if (pkg.usesRawTags) {
        // Diagrammes rendus en une seule passe (une fenêtre cachée), avant la conversion.
        const refs = collectDrawioRefs(payload)
        // Rendu impossible (fenêtre, délai) : les diagrammes passent en repli texte, l'export continue.
        const drawings = refs.length > 0
          ? await this.snapshotDrawios(repoPath, refs).catch(err => {
            console.error('[GH34] rendu des diagrammes draw.io impossible :', err)
            return new Map()
          })
          : new Map()
        converter = new MarkdownToOoxml(pkg, repoPath, drawings)
      }
      const toRich: RichConverter = async md => (converter ? converter.convert(md) : NO_RICH)
      const toTable: TableBuilder = (header, rows) => textTableXml(pkg, header, rows)
      return { ...common, ...(await builder(payload, { toRich, loadRun, toTable })) }
    })
    await fsP.writeFile(destPath, buffer)
  }
}
