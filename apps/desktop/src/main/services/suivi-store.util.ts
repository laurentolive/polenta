import * as fsP from 'fs/promises'
import * as path from 'path'
import * as yaml from 'js-yaml'
import type { SuiviObjectState, TemplateRef, WidgetCode } from '@polenta/types'
import { findQueryTemplate, findWidgetTemplate, widgetCodeForHash } from '@polenta/types'
import { contentHash } from './dashboard-library.service'
import type { GitService } from './git.service'
import { deleteFolderWithTombstone, deleteWithTombstone } from './id-counter.util'

// GH74 — stockage v1 de la vue Suivi (specs/GH74.md §5, GH74-design.md §2.4) : un dossier par objet
// partagé (`queries/QUERY-0001/{query.yaml,script.js}`, `dashboards/DASHBOARD-0001/{dashboard.yaml,
// <widget>.js,<widget>.vl.json}`), fichiers d'avant GH74 (`QUERY-0001.yaml`) lus et convertis en
// mémoire. Calcul de l'état (personnalisé, version de modèle) et application d'un modèle.

/** Entrée de premier niveau d'un dossier d'objets : fichier historique ou dossier v1. */
export interface ObjectEntry {
  id: string
  kind: 'file' | 'folder'
}

/** Objets `<prefix>-NNNN` d'un dossier : dossiers v1 et fichiers `.yaml` historiques (le dossier
 *  l'emporte si les deux existent). Les autres entrées (`lib/`, `jsconfig.json`, `.seeded.yaml`) sont
 *  ignorées. */
export async function listObjectEntries(repoPath: string, dir: string, prefix: string): Promise<ObjectEntry[]> {
  const entries = await fsP.readdir(path.join(repoPath, dir), { withFileTypes: true }).catch(() => [])
  const pattern = new RegExp(`^${prefix}-\\d+$`)
  const out = new Map<string, ObjectEntry>()
  for (const e of entries) {
    if (e.isDirectory() && pattern.test(e.name)) out.set(e.name, { id: e.name, kind: 'folder' })
  }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.yaml')) continue
    const id = e.name.slice(0, -'.yaml'.length)
    if (pattern.test(id) && !out.has(id)) out.set(id, { id, kind: 'file' })
  }
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id))
}

export async function readText(repoPath: string, rel: string): Promise<string | undefined> {
  return fsP.readFile(path.join(repoPath, rel), 'utf8').catch(() => undefined)
}

export async function readYamlFile<T>(repoPath: string, rel: string): Promise<T | null> {
  const text = await readText(repoPath, rel)
  if (text === undefined) return null
  return (yaml.load(text) as T) ?? null
}

/** Écrit les fichiers d'un dossier d'objet et retire ceux qui n'en font plus partie (widget supprimé). */
export async function writeObjectFolder(repoPath: string, relDir: string, files: Record<string, string>): Promise<void> {
  const dir = path.join(repoPath, relDir)
  await fsP.mkdir(dir, { recursive: true })
  for (const [name, content] of Object.entries(files)) await fsP.writeFile(path.join(dir, name), content, 'utf8')
  const existing = await fsP.readdir(dir).catch(() => [] as string[])
  for (const name of existing) if (!(name in files)) await fsP.rm(path.join(dir, name), { force: true })
}

export function toYaml(data: unknown): string {
  return yaml.dump(data, { lineWidth: -1, noRefs: true })
}

/** Erreur des écritures refusées sur un objet en lecture seule. */
export function readOnlyError(what: string, reason: SuiviObjectState['readOnly']): Error {
  return new Error(reason === 'legacy-sql'
    ? `[SUIVI_READ_ONLY] ${what} : requête SQL d'avant GH74, non prise en charge (à réécrire en script ou à supprimer).`
    : `[SUIVI_READ_ONLY] ${what} : créé par une version plus récente de Polenta, lecture seule.`)
}

/** État calculé : personnalisé si sans modèle ou si le code ne correspond plus à l'empreinte. */
export function computeState(
  template: { id: string; version: number; hash?: string } | undefined,
  code: string,
  kind: 'query' | 'widget',
  extra: Pick<SuiviObjectState, 'readOnly' | 'legacyFormat'> = {},
): SuiviObjectState {
  const latest = template ? (kind === 'query' ? findQueryTemplate(template.id) : findWidgetTemplate(template.id)) : undefined
  return {
    customized: !template || (template.hash !== undefined && contentHash(code) !== template.hash),
    ...(template && latest && latest.version > template.version ? { templateUpdate: latest.version } : {}),
    ...(extra.readOnly ? { readOnly: extra.readOnly } : {}),
    ...(extra.legacyFormat ? { legacyFormat: true } : {}),
  }
}

/** Demande de modèle venue de l'UI ou du MCP. */
export interface TemplateInput {
  id: string
  params: Record<string, unknown>
}

/** Script généré par un modèle de requête, avec sa référence (empreinte comprise). */
export function applyQueryTemplate(input: TemplateInput): { script: string; template: TemplateRef } {
  const tpl = findQueryTemplate(input.id)
  if (!tpl) throw new Error(`Modèle de requête inconnu : ${input.id}`)
  const script = tpl.generate(input.params)
  return { script, template: { id: tpl.id, version: tpl.version, params: input.params, hash: contentHash(script) } }
}

/** Code généré par un modèle de widget, avec sa référence. */
export function applyWidgetTemplate(input: TemplateInput): { code: WidgetCode; template: TemplateRef } {
  const tpl = findWidgetTemplate(input.id)
  if (!tpl) throw new Error(`Modèle de widget inconnu : ${input.id}`)
  const code = tpl.generate(input.params)
  return { code, template: { id: tpl.id, version: tpl.version, params: input.params, hash: contentHash(widgetCodeForHash(code)) } }
}

/** Empreinte d'un modèle lu sans empreinte (format converti à la lecture) : celle du code régénéré. */
export function withHash(template: { id: string; version: number; params: Record<string, unknown>; hash?: string }, code: string): TemplateRef {
  return { ...template, hash: template.hash ?? contentHash(code) }
}

/** Supprime un objet partagé (dossier v1 et / ou fichier d'avant GH74), pierre tombale comprise. */
export async function removeSharedObject(git: GitService, repoPath: string, dir: string, id: string): Promise<void> {
  if (await git.fileExists(repoPath, `${dir}/${id}`)) await deleteFolderWithTombstone(git, repoPath, `${dir}/${id}`, id)
  if (await git.fileExists(repoPath, `${dir}/${id}.yaml`)) await deleteWithTombstone(git, repoPath, `${dir}/${id}.yaml`, id)
}

/** Après l'écriture d'un dossier v1 : retire le fichier d'avant GH74 qu'il remplace (même id). */
export async function dropLegacyFile(git: GitService, repoPath: string, dir: string, id: string): Promise<void> {
  if (await git.fileExists(repoPath, `${dir}/${id}.yaml`)) await git.deleteFile(repoPath, `${dir}/${id}.yaml`)
}
