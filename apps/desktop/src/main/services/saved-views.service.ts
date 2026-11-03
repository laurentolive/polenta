import * as fsP from 'fs/promises'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { SAVED_VIEWS_FORMAT_VERSION, normalizeViewName, sameViewName } from '@polenta/types'
import type { FieldRename, SavedView, SavedViewRef, SavedViewScope, SavedViewsList } from '@polenta/types'
import { readPref, updateFieldVisibilityEntry } from './pref-store.util'
import { pathExists } from './schema-refs.util'
import { withKeyLock } from './serialize-writes.util'

/** Clés de `settings` contenant des noms de champs : seule connaissance de leur contenu côté main. */
const FIELD_LIST_KEYS = ['excel', 'word', 'popup']

const VIEWS_DIR = path.join('.polenta', 'views')

type PrefEntry = Record<string, unknown> & { savedViews?: unknown }
type TeamRead = { views: SavedView[]; error?: 'unreadable' | 'newer-format' }

/** La clé reçue du client compose un chemin : pas de séparateur ni de remontée. */
function parseTypeKey(typeKey: string): { node: string; type: string } {
  const parts = typeof typeKey === 'string' ? typeKey.split('::') : []
  const safe = (s: string) => s.length > 0 && !/[/\\]/.test(s) && s !== '.' && s !== '..'
  if (parts.length !== 2 || !parts.every(safe)) throw new Error(`VIEW_TYPE_INVALID: ${String(typeKey)}`)
  return { node: parts[0], type: parts[1] }
}

function teamFile(repoPath: string, node: string, type: string): string {
  return path.join(repoPath, VIEWS_DIR, node, `${type}.yaml`)
}

/** Verrou par fichier d'équipe (lecture, modification, écriture), comme les autres objets du repo. */
function lockTeamFile<T>(repoPath: string, node: string, type: string, fn: () => Promise<T>): Promise<T> {
  return withKeyLock(`${repoPath}::.polenta/views/${node}/${type}`, fn)
}

function isSettings(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function isView(v: unknown): v is SavedView {
  if (!v || typeof v !== 'object') return false
  const { name, settings } = v as Record<string, unknown>
  return typeof name === 'string' && isSettings(settings)
}

/** Une vue écrite sans réglages rendrait tout le fichier d'équipe illisible à la lecture suivante. */
function validSettings(settings: unknown): Record<string, unknown> {
  if (!isSettings(settings)) throw new Error('VIEW_SETTINGS_INVALID: objet attendu')
  return settings
}

async function readTeam(file: string): Promise<TeamRead> {
  let text: string
  try {
    text = await fsP.readFile(file, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { views: [] }
    return { views: [], error: 'unreadable' }
  }
  try {
    const raw = yaml.load(text) as { version?: unknown; views?: unknown } | null
    if (!raw || typeof raw !== 'object') return { views: [], error: 'unreadable' }
    if (typeof raw.version === 'number' && raw.version > SAVED_VIEWS_FORMAT_VERSION) return { views: [], error: 'newer-format' }
    if (raw.version !== SAVED_VIEWS_FORMAT_VERSION || !Array.isArray(raw.views) || !raw.views.every(isView)) {
      return { views: [], error: 'unreadable' }
    }
    return { views: raw.views }
  } catch {
    return { views: [], error: 'unreadable' }
  }
}

/** Le fichier n'existe qu'à partir de la première vue et disparaît avec la dernière. */
async function writeTeam(file: string, views: SavedView[]): Promise<void> {
  if (views.length === 0) {
    await fsP.rm(file, { force: true })
    return
  }
  await fsP.mkdir(path.dirname(file), { recursive: true })
  await fsP.writeFile(file, yaml.dump({ version: SAVED_VIEWS_FORMAT_VERSION, views }, { lineWidth: 120 }), 'utf-8')
}

function readPersonal(repoPath: string, username: string, typeKey: string): SavedView[] {
  const visibility = readPref(repoPath, username)['fieldVisibility'] as Record<string, PrefEntry> | undefined
  const stored = visibility?.[typeKey]?.savedViews
  return Array.isArray(stored) ? stored.filter(isView) : []
}

function writePersonal(repoPath: string, username: string, typeKey: string, views: SavedView[]): void {
  updateFieldVisibilityEntry(repoPath, username, typeKey, entry => {
    if (views.length > 0) entry.savedViews = views
    else delete entry.savedViews
    return entry
  })
}

function validName(raw: string): string {
  const name = normalizeViewName(raw)
  if (!name) throw new Error('VIEW_NAME_INVALID: nom vide ou trop long')
  return name
}

function assertFree(views: SavedView[], name: string): void {
  if (views.some(v => sameViewName(v.name, name))) throw new Error(`VIEW_NAME_TAKEN: ${name}`)
}

function indexOfView(views: SavedView[], name: string): number {
  const i = views.findIndex(v => v.name === name)
  if (i < 0) throw new Error(`VIEW_NOT_FOUND: ${name}`)
  return i
}

/**
 * GH203 — vues enregistrées des deux portées : personnelles dans le `.pref`, d'équipe dans
 * `.polenta/views/<nœud>/<type>.yaml`, écrit sans commit (il suit le flux de Publier).
 */
export class SavedViewsService {
  constructor(
    /** Composant épinglé ou monté en lecture seule (`VersionsService.isReadonly`). */
    private readonly isReadonly: (repoPath: string, workspaceDir?: string) => Promise<boolean>,
  ) {}

  async list(repoPath: string, username: string, typeKey: string, workspaceDir?: string | null): Promise<SavedViewsList> {
    const { node, type } = parseTypeKey(typeKey)
    const team = await readTeam(teamFile(repoPath, node, type))
    return {
      personal: readPersonal(repoPath, username, typeKey),
      team: team.views,
      ...(team.error && { teamError: team.error }),
      teamReadonly: await this.isReadonly(repoPath, workspaceDir || undefined),
    }
  }

  async create(repoPath: string, username: string, typeKey: string, scope: SavedViewScope, rawName: string, settings: Record<string, unknown>, workspaceDir?: string | null): Promise<SavedViewRef> {
    const name = validName(rawName)
    const valid = validSettings(settings)
    return this.mutate(repoPath, username, typeKey, scope, workspaceDir, views => {
      assertFree(views, name)
      return { views: [...views, { name, settings: valid }], result: { scope, name } }
    })
  }

  async update(repoPath: string, username: string, typeKey: string, ref: SavedViewRef, settings: Record<string, unknown>, workspaceDir?: string | null): Promise<SavedViewRef> {
    const valid = validSettings(settings)
    return this.mutate(repoPath, username, typeKey, ref.scope, workspaceDir, views => {
      const i = indexOfView(views, ref.name)
      return { views: views.map((v, j) => (j === i ? { ...v, settings: valid } : v)), result: ref }
    })
  }

  async rename(repoPath: string, username: string, typeKey: string, ref: SavedViewRef, rawName: string, workspaceDir?: string | null): Promise<SavedViewRef> {
    const name = validName(rawName)
    return this.mutate(repoPath, username, typeKey, ref.scope, workspaceDir, views => {
      const i = indexOfView(views, ref.name)
      assertFree(views.filter((_, j) => j !== i), name)
      return { views: views.map((v, j) => (j === i ? { ...v, name } : v)), result: { scope: ref.scope, name } }
    })
  }

  async delete(repoPath: string, username: string, typeKey: string, ref: SavedViewRef, workspaceDir?: string | null): Promise<void> {
    await this.mutate(repoPath, username, typeKey, ref.scope, workspaceDir, views => {
      const i = indexOfView(views, ref.name)
      return { views: views.filter((_, j) => j !== i), result: undefined }
    })
  }

  private async mutate<T>(
    repoPath: string, username: string, typeKey: string, scope: SavedViewScope, workspaceDir: string | null | undefined,
    change: (views: SavedView[]) => { views: SavedView[]; result: T },
  ): Promise<T> {
    const { node, type } = parseTypeKey(typeKey)
    if (scope === 'personal') {
      const { views, result } = change(readPersonal(repoPath, username, typeKey))
      writePersonal(repoPath, username, typeKey, views)
      return result
    }
    if (scope !== 'team') throw new Error(`VIEW_SCOPE_INVALID: ${String(scope)}`)
    if (await this.isReadonly(repoPath, workspaceDir || undefined)) throw new Error(`READONLY_REPO: composant en lecture seule (${repoPath})`)
    return lockTeamFile(repoPath, node, type, async () => {
      const file = teamFile(repoPath, node, type)
      const team = await readTeam(file)
      if (team.error) throw new Error(`VIEWS_UNREADABLE: ${path.relative(repoPath, file)}`)
      const { views, result } = change(team.views)
      await writeTeam(file, views)
      return result
    })
  }
}

/** Renommage de champs d'un type (éditeur de schéma) : répercuté dans ses vues d'équipe. */
export async function renameFieldsInTeamViews(repoPath: string, objectTypeRef: string, renames: FieldRename[]): Promise<void> {
  const { node, type } = parseTypeKey(objectTypeRef)
  const to = new Map(renames.map(r => [r.from, r.to]))
  await lockTeamFile(repoPath, node, type, async () => {
    const file = teamFile(repoPath, node, type)
    const team = await readTeam(file)
    if (team.error) throw new Error(`VIEWS_UNREADABLE: ${path.relative(repoPath, file)}`)
    let changed = false
    const views = team.views.map(view => {
      const settings = { ...view.settings }
      for (const key of FIELD_LIST_KEYS) {
        const fields = settings[key]
        if (!Array.isArray(fields) || !fields.some(f => to.has(f))) continue
        settings[key] = fields.map(f => to.get(f) ?? f)
        changed = true
      }
      return { ...view, settings }
    })
    if (changed) await writeTeam(file, views)
  })
}

/**
 * Renommage d'un type ou déplacement vers un autre nœud : son fichier de vues d'équipe suit, comme
 * son arbre. Un fichier déjà présent à l'arrivée (orphelin d'une autre branche) n'est pas écrasé.
 */
export async function moveTeamViewsFile(
  repoPath: string, from: { node: string; type: string }, to: { node: string; type: string },
): Promise<void> {
  if (from.node === to.node && from.type === to.type) return
  await lockTeamFile(repoPath, from.node, from.type, () => lockTeamFile(repoPath, to.node, to.type, async () => {
    const source = teamFile(repoPath, from.node, from.type)
    const target = teamFile(repoPath, to.node, to.type)
    if (!await pathExists(source)) return
    if (await pathExists(target)) throw new Error(`VIEWS_TARGET_EXISTS: ${path.relative(repoPath, target)}`)
    await fsP.mkdir(path.dirname(target), { recursive: true })
    await fsP.rename(source, target)
  }))
}
