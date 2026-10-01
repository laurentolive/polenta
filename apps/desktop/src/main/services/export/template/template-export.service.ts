import * as fsP from 'fs/promises'
import type { ExportKind, RequirementsExportPayload, TemplateExportFormat, TestsExportPayload } from '@polenta/types'
import type { ExportTemplateLibrary } from '../../export-template-library'
import type { GitService } from '../../git.service'
import type { SchemaService } from '../../schema.service'
import type { AuthService } from '../../auth.service'
import type { RichConverter } from './template-data'

type KindDataBuilder = (payload: unknown, toRich: RichConverter) => Promise<object>

const NO_RICH = { render: () => '' }

// Kinds pris en charge par un gabarit, par format — étendu au fil des sprints (GH34-design §5 :
// campagnes et dashboard au sprint 3, xlsx au sprint 4). Modules chargés en `import()` dynamique
// (T141) : ce service est construit au démarrage, markdown-it/docxtemplater ne doivent l'être
// qu'au premier export par gabarit.
const DATA_BUILDERS: Partial<Record<`${ExportKind}:${TemplateExportFormat}`, KindDataBuilder>> = {
  'requirements:docx': async (p, r) => (await import('./template-data')).buildItemsData(p as RequirementsExportPayload, r),
  'tests:docx': async (p, r) => (await import('./template-data')).buildItemsData(p as TestsExportPayload, r),
}

export function supportsTemplate(kind: ExportKind, format: string): boolean {
  return `${kind}:${format}` in DATA_BUILDERS
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
    const componentLabel = (payload as { componentLabel?: string } | null)?.componentLabel ?? ''
    const [{ buildCommonData }, { renderDocxTemplate }, { MarkdownToOoxml }] = await Promise.all([
      import('./template-data'),
      import('./docx-template'),
      import('./markdown-to-ooxml'),
    ])
    const common = buildCommonData({
      projectLabel, componentLabel, user, kind, templateRelPath, branch, commit, tags, now: new Date(),
    })
    const buffer = await renderDocxTemplate(templatePath, templateRelPath, async pkg => {
      // Gabarit sans balise `{{@…}}` : pas de conversion (ni chargement d'images) inutile.
      const converter = pkg.usesRawTags ? new MarkdownToOoxml(pkg, repoPath) : null
      const toRich: RichConverter = async md => (converter ? converter.convert(md) : NO_RICH)
      return { ...common, ...(await builder(payload, toRich)) }
    })
    await fsP.writeFile(destPath, buffer)
  }
}
