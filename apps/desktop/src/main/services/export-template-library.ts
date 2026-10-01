import { constants as fsConstants } from 'fs'
import * as fsP from 'fs/promises'
import * as path from 'path'
import type { ExportTemplateInfo, ExportTemplateListResult, TemplateExportFormat } from '@polenta/types'
import type { AppSettingsService } from './app-settings.service'

// Profondeur de sous-dossiers parcourue (un sous-dossier par client, éventuellement un niveau de
// rangement en plus) — borne un dossier mal choisi (ex. la racine d'un disque).
const MAX_DEPTH = 5

/** Sous-dossier de la bibliothèque recevant les gabarits d'exemple livrés avec l'application. */
export const EXAMPLES_FOLDER = 'Exemples Polenta'

/**
 * GH34 — bibliothèque de gabarits d'export : dossier choisi dans les préférences application
 * (`exportTemplatesDir`), lu tel quel (jamais écrit). Un gabarit est identifié par son chemin
 * relatif à ce dossier, séparateurs `/`, pour que la préférence projet
 * (`schema.preferences.exportTemplates`) reste valable quel que soit l'emplacement de la
 * bibliothèque sur la machine de chaque membre de l'équipe.
 */
export class ExportTemplateLibrary {
  constructor(private readonly appSettings: AppSettingsService) {}

  async list(format: TemplateExportFormat): Promise<ExportTemplateListResult> {
    const dir = this.appSettings.get().exportTemplatesDir
    if (!dir) return { dirConfigured: false, dirExists: false, templates: [] }
    try {
      if (!(await fsP.stat(dir)).isDirectory()) return { dirConfigured: true, dirExists: false, templates: [] }
    } catch {
      return { dirConfigured: true, dirExists: false, templates: [] }
    }
    const templates: ExportTemplateInfo[] = []
    await walk(dir, '', `.${format}`, 0, templates)
    templates.sort((a, b) => a.relPath.localeCompare(b.relPath))
    return { dirConfigured: true, dirExists: true, templates }
  }

  /**
   * Copie les gabarits d'exemple livrés avec l'application (`sourceDir`) dans le sous-dossier
   * `EXAMPLES_FOLDER` de la bibliothèque. Un fichier déjà présent n'est jamais écrasé (l'utilisateur
   * a pu le modifier) : relancer l'installation ne fait que compléter.
   */
  async installExamples(sourceDir: string): Promise<{ folder: string; copied: number }> {
    const dir = this.appSettings.get().exportTemplatesDir
    if (!dir) throw new Error('Aucune bibliothèque de gabarits d’export n’est configurée.')
    const target = path.join(dir, EXAMPLES_FOLDER)
    await fsP.mkdir(target, { recursive: true })
    let copied = 0
    for (const name of await fsP.readdir(sourceDir)) {
      try {
        await fsP.copyFile(path.join(sourceDir, name), path.join(target, name), fsConstants.COPYFILE_EXCL)
        copied++
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      }
    }
    return { folder: target, copied }
  }

  /** Chemin absolu d'un gabarit — refuse tout chemin sortant de la bibliothèque (`..`, absolu). */
  async resolve(relPath: string): Promise<string> {
    const dir = this.appSettings.get().exportTemplatesDir
    if (!dir) throw new Error('Aucune bibliothèque de gabarits d’export n’est configurée (préférences de l’application).')
    const root = path.resolve(dir)
    const abs = path.resolve(root, relPath)
    const rel = path.relative(root, abs)
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Gabarit « ${relPath} » hors de la bibliothèque de gabarits.`)
    }
    try {
      if (!(await fsP.stat(abs)).isFile()) throw new Error()
    } catch {
      throw new Error(`Gabarit « ${relPath} » introuvable dans la bibliothèque (${root}).`)
    }
    return abs
  }
}

function isIgnored(name: string): boolean {
  // `~$…` : fichier verrou/temporaire d'Office ; `.…` : fichiers et dossiers cachés.
  return name.startsWith('~$') || name.startsWith('.')
}

async function walk(root: string, rel: string, ext: string, depth: number, out: ExportTemplateInfo[]): Promise<void> {
  const entries = await fsP.readdir(path.join(root, rel), { withFileTypes: true }).catch(() => null)
  if (!entries) return
  for (const entry of entries) {
    if (isIgnored(entry.name)) continue
    const childRel = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (depth < MAX_DEPTH) await walk(root, childRel, ext, depth + 1, out)
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(ext)) {
      out.push({ relPath: childRel })
    }
  }
}
