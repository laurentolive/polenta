import { constants as fsConstants } from 'fs'
import * as fsP from 'fs/promises'
import * as path from 'path'
import PizZip from 'pizzip'
import type { ExportTemplateInfo, ExportTemplateListResult, TemplateExportFormat, TemplateImportResult } from '@polenta/types'
import type { AppSettingsService } from './app-settings.service'
import { BRAND } from '../../shared/brand'

// Profondeur de sous-dossiers parcourue (un sous-dossier par client, éventuellement un niveau de
// rangement en plus) — borne un dossier mal choisi (ex. la racine d'un disque).
const MAX_DEPTH = 5

/** Sous-dossier de la bibliothèque recevant les gabarits d'exemple livrés avec l'application. */
// GH49 — au nom de la marque du binaire.
export const EXAMPLES_FOLDER = `Exemples ${BRAND.productName}`

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

  /**
   * GH54 — ajout d'un gabarit envoyé depuis le client web : copie à la racine de la bibliothèque, sous son
   * nom d'origine. Refusé (rien écrit) si le nom ou l'extension ne conviennent pas, si le fichier n'est pas
   * une archive du bon format, ou si la bibliothèque n'est pas configurée. Un nom déjà présent n'est
   * remplacé que si `replace` est vrai (D3). L'écriture passe par un fichier temporaire puis un renommage.
   */
  async importFile(format: TemplateExportFormat, srcPath: string, fileName: string, replace: boolean): Promise<TemplateImportResult> {
    const dir = this.appSettings.get().exportTemplatesDir
    if (!dir) return { status: 'refused', message: 'Aucune bibliothèque de gabarits d’export n’est configurée.' }
    if (!isPlainFileName(fileName, format)) {
      return { status: 'refused', message: `Nom refusé : un gabarit est un fichier .${format}, sans dossier dans son nom.` }
    }
    const content = await fsP.readFile(srcPath).catch(() => null)
    if (!content) return { status: 'refused', message: 'Le fichier envoyé est illisible.' }
    if (!hasMainPart(content, format)) {
      return { status: 'refused', message: `Ce fichier n’est pas un document ${format === 'docx' ? 'Word' : 'Excel'} valide.` }
    }
    await fsP.mkdir(dir, { recursive: true })
    const target = path.join(dir, fileName)
    if (!replace && (await exists(target))) return { status: 'exists', relPath: fileName }
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
    try {
      await fsP.writeFile(tmp, content)
      await fsP.rename(tmp, target)
    } catch {
      await fsP.rm(tmp, { force: true }).catch(() => undefined)
      return { status: 'refused', message: 'Impossible d’enregistrer le gabarit dans la bibliothèque.' }
    }
    return { status: 'ok', relPath: fileName }
  }

  /** GH54 — suppression d'un gabarit de la bibliothèque (même confinement que `resolve`). */
  async deleteFile(relPath: string): Promise<{ status: 'ok' } | { status: 'refused'; message: string }> {
    let abs: string
    try {
      abs = await this.resolve(relPath)
    } catch {
      return { status: 'refused', message: 'Gabarit introuvable dans la bibliothèque.' }
    }
    try {
      await fsP.unlink(abs)
    } catch {
      return { status: 'refused', message: 'Impossible de supprimer le gabarit.' }
    }
    return { status: 'ok' }
  }
}

/** GH54 — partie principale d'un document : `word/document.xml` (Word) ou `xl/workbook.xml` (Excel). */
const MAIN_PART: Record<TemplateExportFormat, string> = { docx: 'word/document.xml', xlsx: 'xl/workbook.xml' }

/** Nom sans dossier, sans nom caché ni verrou Office, avec l'extension du format. */
function isPlainFileName(name: string, format: TemplateExportFormat): boolean {
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) return false
  if (name !== path.basename(name) || isIgnored(name)) return false
  return name.toLowerCase().endsWith(`.${format}`) && name.length > format.length + 1
}

/** Vrai si le contenu est une archive ZIP qui contient la partie principale du format. */
function hasMainPart(content: Buffer, format: TemplateExportFormat): boolean {
  try {
    return new PizZip(content).file(MAIN_PART[format]) !== null
  } catch {
    return false
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fsP.stat(file)
    return true
  } catch {
    return false
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
