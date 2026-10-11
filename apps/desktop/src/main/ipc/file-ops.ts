import * as fsP from 'fs/promises'
import * as path from 'path'
import type { ExportKind, ExportFormat, ExportResult, ExecutionSheetLocale } from '@polenta/types'
import type { Container } from './index'

// Deux tables distinctes (pas une dérivée de l'autre) : la relation n'est pas
// bijective — `jpg` et `jpeg` pointent tous deux vers `image/jpeg`, mais
// l'extension de sortie choisie pour ce MIME (fichier collé, T76) doit rester
// `jpg` de façon stable, pas dépendre de l'ordre d'itération d'une inversion.
export const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
}
export const IMAGE_EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif',
  'image/svg+xml': 'svg', 'image/webp': 'webp',
}

// Renvoie `baseName` s'il est libre dans `dir`, sinon `stem-1.ext`, `stem-2.ext`, etc.
export async function findAvailableFileName(dir: string, baseName: string): Promise<string> {
  const ext = path.extname(baseName)
  const stem = path.basename(baseName, ext)
  let candidate = baseName
  for (let i = 1; ; i++) {
    try {
      await fsP.access(path.join(dir, candidate))
      candidate = `${stem}-${i}${ext}`
    } catch {
      return candidate
    }
  }
}

export type ImportIntoRepoResult =
  | { status: 'ok'; path: string; copied: boolean }
  | { status: 'error'; message: string }

/**
 * Référence un fichier choisi par l'utilisateur depuis le repo (T76 images, T47 diagrammes).
 * Fichier déjà dans le repo (pas de '..' ni de chemin absolu résiduel, ce dernier cas couvrant un
 * autre volume Windows) : référence directe. Sinon : les fichiers référencés doivent vivre dans le
 * repo (D4, CONTEXT.md) — copie dans `<subdir>/` plutôt que rejet, nom dédupliqué en cas de
 * collision. `displayName` (GH44, upload web) : nom d'origine quand `srcPath` est un fichier
 * temporaire.
 */
export async function importFileIntoRepo(
  repoPath: string,
  srcPath: string,
  subdir: 'images' | 'diagrams',
  displayName: string = path.basename(srcPath),
): Promise<ImportIntoRepoResult> {
  const rel = path.relative(repoPath, srcPath)
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
    return { status: 'ok', path: rel.split(path.sep).join('/'), copied: false }
  }
  try {
    const destDir = path.join(repoPath, subdir)
    await fsP.mkdir(destDir, { recursive: true })
    const destName = await findAvailableFileName(destDir, path.basename(displayName))
    await fsP.copyFile(srcPath, path.join(destDir, destName))
    return { status: 'ok', path: `${subdir}/${destName}`, copied: true }
  } catch {
    return { status: 'error', message: 'Impossible de copier le fichier dans le repo.' }
  }
}

/** Export (T43) vers `destPath`, choisi par un dialogue (desktop) ou temporaire (web, GH44). */
export async function saveExport(
  c: Pick<Container, 'export'>,
  destPath: string,
  repoPath: string,
  kind: ExportKind,
  format: ExportFormat,
  payload: unknown,
  printParams: Record<string, string> | undefined,
  templateRelPath?: string,
): Promise<ExportResult> {
  try {
    await c.export.run(kind, format, payload, printParams, destPath, { repoPath, templateRelPath })
    return { status: 'ok', filePath: destPath }
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : 'Erreur lors de l’export' }
  }
}

/** Classeur Excel d'exécution (GH36) vers `destPath`. */
export async function saveExecutionSheet(
  c: Pick<Container, 'campaignExecution'>,
  destPath: string,
  repoPath: string,
  campaignId: string,
  locale: ExecutionSheetLocale,
): Promise<ExportResult> {
  try {
    await c.campaignExecution.exportSheet(repoPath, campaignId, locale === 'en' ? 'en' : 'fr', destPath)
    return { status: 'ok', filePath: destPath }
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : 'Erreur lors de l’export' }
  }
}
