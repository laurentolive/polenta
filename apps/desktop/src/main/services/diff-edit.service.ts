import * as fsP from 'fs/promises'
import * as path from 'path'
import yaml from 'js-yaml'
import { deepEqual, isPlainObject } from '@polenta/merge-core'
import { isAppMaintainedFile, type DiffSaveResult } from '@polenta/types'
import type { RequirementsService } from './requirements.service'
import type { TestsService } from './tests.service'
import type { SchemaService } from './schema.service'
import { findObjectTypeDef } from './schema-lookup.util'

/**
 * GH222 sprint 5 — enregistrement d'un fichier du working tree modifié depuis la vue de diff
 * (spec §12). Une exigence ou un test passe par le service de l'objet, comme l'éditeur (`version`,
 * `history` GH77, validations) ; un autre fichier est écrit tel quel (YAML valide exigé pour un
 * `.yaml`). Refusé si le fichier a changé sur le disque depuis son chargement (`baseline`).
 */

type Obj = Record<string, unknown>

/** Keys the app maintains itself: never written from the diff. */
const MANAGED = new Set(['history', 'version', 'needsRevalidation', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'])
/** Root keys the object's service writes from the diff (`projectId` / `branchId` are not). */
const REQUIREMENT_KEYS = new Set(['id', 'objectTypeRef', 'title', 'status', 'fields'])
const TEST_KEYS = new Set([...REQUIREMENT_KEYS, 'preconditions', 'equipment', 'steps', 'postconditions'])
/** Test keys its service replaces but cannot remove. */
const TEST_REQUIRED_ON_SAVE = ['preconditions', 'equipment', 'steps', 'postconditions']

export class DiffEditService {
  constructor(
    private readonly requirements: RequirementsService,
    private readonly tests: TestsService,
    private readonly schema: SchemaService,
  ) {}

  async saveWorkingFile(repoPath: string, filepath: string, text: string, baseline: string, workspaceDir?: string): Promise<DiffSaveResult> {
    const abs = path.resolve(repoPath, filepath)
    if (!isInside(path.resolve(repoPath), abs)) return { ok: false, reason: 'outside' }
    // Through a symbolic link too: the real file must be in the real repo.
    const [realRepo, realFile] = await Promise.all([fsP.realpath(repoPath), fsP.realpath(abs).catch(() => null)])
    if (!realFile || !isInside(realRepo, realFile)) return { ok: false, reason: 'outside' }
    if (isAppMaintainedFile(path.relative(path.resolve(repoPath), abs))) return { ok: false, reason: 'unsupported', message: 'maintained by the app' }

    // The diff reads files through a decoder that drops a UTF-8 BOM: compare without it.
    const raw = await fsP.readFile(abs, 'utf8').catch(() => null)
    const current = raw === null ? null : raw.replace(/^\uFEFF/, '')
    if (current === null || current !== baseline) return { ok: false, reason: 'changed' }
    if (text === current) return { ok: true }

    const isYaml = /\.ya?ml$/i.test(filepath)
    let value: unknown
    if (isYaml) {
      try {
        value = yaml.load(text)
      } catch (err) {
        return { ok: false, reason: 'invalid', message: err instanceof Error ? err.message.split('\n')[0] : String(err) }
      }
    }

    // A file on disk that is not valid YAML (a hand edit gone wrong) is repaired as text.
    let before: unknown
    try {
      before = isYaml ? yaml.load(current) : undefined
    } catch {
      before = undefined
    }
    const ref = isPlainObject(before) && typeof before.objectTypeRef === 'string' ? before.objectTypeRef : null
    const typeDef = ref ? findObjectTypeDef(await this.schema.get(repoPath), ref) : null
    const category = typeDef && typeDef !== 'unresolvable' ? typeDef.category : null
    if ((category === 'requirement' || category === 'test') && isPlainObject(before)) {
      // The object's service writes `requirements/<id>.yaml` / `tests/<id>.yaml`: only that file.
      const id = path.basename(filepath).replace(/\.ya?ml$/i, '')
      const expected = `${category === 'requirement' ? 'requirements' : 'tests'}/${id}.yaml`
      if (filepath.replace(/\\/g, '/').replace(/^\.\//, '') !== expected) {
        return { ok: false, reason: 'unsupported', message: `not ${expected}` }
      }
      return this.saveObject(repoPath, filepath, category, before, value, typeDef as Exclude<typeof typeDef, null | 'unresolvable'>, workspaceDir)
    }
    // A campaign keeps its history (GH77) through its own screens.
    if (typeDef && typeDef !== 'unresolvable' && typeDef.category === 'campaign') {
      return { ok: false, reason: 'unsupported', message: 'campaign' }
    }

    await fsP.writeFile(abs, text, 'utf8')
    return { ok: true }
  }

  private async saveObject(
    repoPath: string, filepath: string, category: 'requirement' | 'test', before: Obj, value: unknown,
    typeDef: { statuses?: Array<{ name: string }> }, workspaceDir?: string,
  ): Promise<DiffSaveResult> {
    if (!isPlainObject(value)) return { ok: false, reason: 'invalid', message: 'not a YAML mapping' }
    const id = path.basename(filepath).replace(/\.ya?ml$/i, '')
    if (value.id !== id) return { ok: false, reason: 'invalid', message: `id ${String(value.id ?? '')} ≠ ${id}` }
    if (value.objectTypeRef !== before.objectTypeRef) return { ok: false, reason: 'unsupported', keys: ['objectTypeRef'] }
    if (typeof value.title !== 'string' || value.title.trim() === '') return { ok: false, reason: 'invalid', message: 'empty title' }
    const statuses = typeDef.statuses ?? []
    if (statuses.length > 0 && !statuses.some(s => s.name === value.status)) {
      return { ok: false, reason: 'invalid', message: `unknown status ${String(value.status ?? '')}` }
    }
    if (value.fields !== undefined && value.fields !== null && !isPlainObject(value.fields)) {
      return { ok: false, reason: 'invalid', message: 'fields is not a mapping' }
    }

    // Root keys the object's service does not write: changed from the diff, they are refused.
    const allowed = category === 'requirement' ? REQUIREMENT_KEYS : TEST_KEYS
    const keys = [...new Set([...Object.keys(before), ...Object.keys(value)])]
      .filter(k => !allowed.has(k) && !MANAGED.has(k) && !deepEqual(before[k], value[k]))
    if (category === 'test') {
      for (const k of TEST_REQUIRED_ON_SAVE) if (k in before && !(k in value)) keys.push(k)
    }
    if (keys.length > 0) return { ok: false, reason: 'unsupported', keys }

    // Fields: the edited ones, and those removed (null = removed, GH150).
    const beforeFields = (isPlainObject(before.fields) ? before.fields : {}) as Obj
    const afterFields = (isPlainObject(value.fields) ? value.fields : {}) as Obj
    const fields: Obj = {}
    for (const k of new Set([...Object.keys(beforeFields), ...Object.keys(afterFields)])) {
      if (!deepEqual(beforeFields[k], afterFields[k])) fields[k] = k in afterFields ? afterFields[k] : null
    }
    const changed = (k: string) => !deepEqual(before[k], value[k])

    if (category === 'requirement') {
      if (changed('title') || Object.keys(fields).length > 0) {
        await this.requirements.update(repoPath, id, {
          ...(changed('title') ? { title: value.title as string } : {}),
          ...(Object.keys(fields).length > 0 ? { fields } : {}),
        }, workspaceDir, { removeNullFields: true })
      }
      if (changed('status')) await this.requirements.transition(repoPath, id, { toStatus: value.status as string }, workspaceDir)
      return { ok: true }
    }

    const dto: Record<string, unknown> = {}
    for (const k of ['title', 'status', 'preconditions', 'equipment', 'steps', 'postconditions']) if (changed(k)) dto[k] = value[k]
    if (Object.keys(fields).length > 0) dto.fields = fields
    if (Object.keys(dto).length > 0) {
      await this.tests.update(repoPath, id, dto as Parameters<TestsService['update']>[2], workspaceDir, { removeNullFields: true })
    }
    return { ok: true }
  }
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  return !(path.isAbsolute(rel) || rel === '..' || rel.startsWith('..' + path.sep))
}
