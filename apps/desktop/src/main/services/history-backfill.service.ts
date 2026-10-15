import yaml from 'js-yaml'
import { mergeHistories } from '@polenta/merge-core'
import { changeEntries, historyTimestamp, sameHistoryValue, trackedKeys } from '@polenta/types'
import type {
  HistoryBackfillResult, HistoryCarrier, HistoryEntry, ObjectHistory, ObjectTypeDefinition, ProjectSchema,
} from '@polenta/types'
import type { CampaignsService } from './campaigns.service'
import type { GitService } from './git.service'
import type { RequirementsService } from './requirements.service'
import { findObjectTypeDef } from './schema-lookup.util'
import type { TestsService } from './tests.service'

const DIRS = ['requirements', 'tests', 'campaigns'] as const
type Dir = typeof DIRS[number]

/** État d'un fichier pendant le parcours des commits. */
interface FileState {
  dir: Dir
  id: string | null
  /** Valeurs de la version précédente du fichier (null : pas encore vu, ou supprimé). */
  prev: HistoryCarrier | null
  /** Date du commit précédent qui a touché le fichier. */
  lastAt: string | null
  entries: ObjectHistory
  /** Pour chaque entrée produite : date du commit précédent du fichier (fenêtre de dédoublonnage). */
  windows: Map<HistoryEntry, string | null>
}

const entryKey = (e: HistoryEntry) => JSON.stringify([String(e.at), e.by ?? null, e.value ?? null, e.source ?? null])
const historyKey = (h: ObjectHistory) => JSON.stringify(Object.keys(h).sort().map(k => [k, (h[k] ?? []).map(entryKey)]))

/**
 * Une entrée `source: schema` (valeur constatée au démarrage du suivi, datée du dernier commit)
 * devient redondante quand la reprise a retrouvé, avant elle, l'entrée qui a posé cette valeur :
 * elle est retirée. Les autres sont gardées.
 */
function dropRedundantSchemaEntries(history: ObjectHistory, sameValue: (key: string, a: unknown, b: unknown) => boolean): ObjectHistory {
  const out: ObjectHistory = {}
  for (const [k, list] of Object.entries(history)) {
    out[k] = list.filter((e, i) => !(e.source === 'schema' && i > 0 && sameValue(k, list[i - 1].value, e.value)))
  }
  return out
}

/**
 * GH77 — reprise de l'historique des champs suivis depuis `git log` (spec §9, design §4.1) :
 * action manuelle, par repo. Un seul parcours des commits de la branche courante (premier parent),
 * une entrée `source: git` à chaque changement de valeur d'un champ suivi (configuration actuelle du
 * schéma), datée du commit et signée de son auteur. Fusion avec l'historique existant : union
 * dédoublonnée ; une entrée git déjà notée par l'application (même valeur, posée entre le commit
 * précédent du fichier et ce commit) n'est pas ajoutée. Rejouable sans doublon. Écrit dans le
 * working tree, sans commit.
 */
export class HistoryBackfillService {
  constructor(
    private readonly git: GitService,
    private readonly requirements: RequirementsService,
    private readonly tests: TestsService,
    private readonly campaigns: CampaignsService,
  ) {}

  async run(repoPath: string): Promise<HistoryBackfillResult> {
    const result: HistoryBackfillResult = { objects: 0, entriesAdded: 0, failed: [] }
    const schema = await this.git.readYaml<ProjectSchema>(repoPath, '.polenta/schema.yaml').catch(() => null)
    const typeDefFor = (ref: unknown): ObjectTypeDefinition | null => {
      if (!schema || typeof ref !== 'string') return null
      const resolved = findObjectTypeDef(schema, ref)
      return resolved && resolved !== 'unresolvable' ? resolved : null
    }

    const states = new Map<string, FileState>()
    for (const commit of await this.git.commitChanges(repoPath, [...DIRS])) {
      const at = historyTimestamp(new Date(commit.at))
      for (const file of commit.files) {
        const dir = DIRS.find(d => file.startsWith(`${d}/`))
        if (!dir || !file.endsWith('.yaml')) continue
        const state: FileState = states.get(file) ?? { dir, id: null, prev: null, lastAt: null, entries: {}, windows: new Map() }
        states.set(file, state)

        let text: string | null
        try {
          text = await this.git.readTextAt(repoPath, commit.oid, file)
        } catch (err) {
          // Objet illisible : signalé, sans faire passer le fichier pour supprimé.
          result.failed.push({ file: `${file}@${commit.oid.slice(0, 7)}`, error: err instanceof Error ? err.message.split('\n')[0] : String(err) })
          continue
        }
        if (text === null) {
          // Fichier supprimé dans ce commit : une recréation repartira de zéro.
          state.prev = null
          state.lastAt = at
          continue
        }
        let obj: Record<string, unknown>
        try {
          const loaded = yaml.load(text)
          if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded) || typeof (loaded as { id?: unknown }).id !== 'string') {
            throw new Error('not an object file')
          }
          obj = loaded as Record<string, unknown>
        } catch (err) {
          result.failed.push({ file: `${file}@${commit.oid.slice(0, 7)}`, error: err instanceof Error ? err.message.split('\n')[0] : String(err) })
          state.lastAt = at
          continue
        }

        const carrier: HistoryCarrier = {
          status: String(obj.status ?? ''),
          fields: obj.fields && typeof obj.fields === 'object' ? obj.fields as Record<string, unknown> : {},
        }
        const step = changeEntries(state.prev, carrier, typeDefFor(obj.objectTypeRef), { by: commit.by, source: 'git' }, at)
        for (const [key, list] of Object.entries(step)) {
          state.entries[key] = [...(state.entries[key] ?? []), ...list]
          for (const e of list) state.windows.set(e, state.lastAt)
        }
        state.id = obj.id as string
        state.prev = carrier
        state.lastAt = at
      }
    }

    for (const state of states.values()) {
      if (!state.id || !state.prev || Object.keys(state.entries).length === 0) continue
      try {
        let added = 0
        const changed = await this.updateHistory(repoPath, state.dir, state.id, current => {
          const existing: ObjectHistory = current.history ?? {}
          const keys = trackedKeys(typeDefFor((current as { objectTypeRef?: unknown }).objectTypeRef))
          const extra: ObjectHistory = {}
          for (const [k, list] of Object.entries(state.entries)) {
            const key = keys.find(x => x.key === k)
            const known = (existing[k] ?? []).filter(x => x.source !== 'git')
            const kept = list.filter(e => !known.some(x => {
              const windowStart = state.windows.get(e) ?? null
              const inWindow = String(x.at) <= e.at && (windowStart === null || String(x.at) > windowStart)
              const sameValue = !key || key.mode === 'event' || sameHistoryValue(key.type, x.value, e.value)
              return inWindow && sameValue
            }))
            if (kept.length > 0) extra[k] = kept
          }
          if (Object.keys(extra).length === 0) return null
          const sameValue = (k: string, a: unknown, b: unknown) => {
            const key = keys.find(x => x.key === k)
            return !!key && key.mode === 'value' && sameHistoryValue(key.type, a, b)
          }
          const merged = dropRedundantSchemaEntries((mergeHistories(existing, extra) ?? {}) as ObjectHistory, sameValue)
          if (historyKey(merged) === historyKey(existing)) return null
          const known = new Set(Object.values(existing).flat().map(entryKey))
          added = Object.values(merged).flat().filter(e => !known.has(entryKey(e))).length
          return merged
        })
        if (changed) {
          result.objects++
          result.entriesAdded += added
        }
      } catch (err) {
        result.failed.push({ file: state.id, error: err instanceof Error ? err.message : String(err) })
      }
    }
    return result
  }

  private updateHistory(
    repoPath: string, dir: Dir, id: string, next: (current: HistoryCarrier) => ObjectHistory | null,
  ): Promise<boolean> {
    if (dir === 'requirements') return this.requirements.updateHistory(repoPath, id, next)
    if (dir === 'tests') return this.tests.updateHistory(repoPath, id, next)
    return this.campaigns.updateHistory(repoPath, id, next)
  }
}
