import { historyTimestamp } from './history'
import type { HistoryActor, HistoryEntry, ObjectHistory } from './history'

// GH202 — version testée d'une exécution (specs/GH202.md) : copie figée de la structure dans le run,
// liste des changements historisée dans la version et référencée par `changesAt`.

/** Clé de `history` d'une version pour la liste de ses changements. */
export const CHANGES_HISTORY_KEY = 'changes'

/** Version (ou valeur libre) retenue pour un repo de la structure testée. */
export interface TestedConfigNode {
  ref?: string
  label?: string
  /** État de la version au moment de l'exécution. */
  state?: 'in_progress' | 'released' | 'abandoned'
  /** `HEAD` du repo à l'enregistrement. */
  commit?: string
  /** `at` de l'entrée de `history.changes` en vigueur ; absent : historique pas encore amorcé. */
  changesAt?: string
  /** Écart : version prévue par la composition ; `null` : la composition ne prévoyait rien. */
  expected?: string | null
  /** Écart non documenté : valeur saisie qui ne correspond à aucune version déclarée. */
  undocumented?: string
  /** Par nom de montage, récursif comme la structure de la version. */
  components?: Record<string, TestedConfigNode>
}

export interface TestedConfig extends TestedConfigNode {
  /** Repo de la version testée : nom de montage, ou dossier du repo racine. */
  component: string
}

/** Saisie : ID ou label d'une version sélectionnable, sinon texte libre. `components` : écarts, par chemin. */
export interface TestedConfigChoice {
  version: string
  components?: Record<string, string>
}

export interface TestedVersionOption {
  id: string
  title: string
  state: 'in_progress' | 'released' | 'abandoned'
  components?: Record<string, string>
}

/** Versions d'un repo et de ses dépendances. */
export interface TestedRepoOptions {
  name: string
  label: string
  /** Toutes, abandonnées comprises (une composition peut en citer une) ; voir `selectableVersions`. */
  versions: TestedVersionOption[]
  dependencies: TestedRepoOptions[]
}

export interface TestedConfigContext {
  options: TestedRepoOptions
  /** Saisie de la dernière exécution de la campagne ; `null` : rien à reprendre. */
  prefill: TestedConfigChoice | null
}

/** Différence entre la copie d'un run et l'état courant ; `path` : chemin du composant, vide pour la racine. */
export type TestedDriftItem =
  | { kind: 'version_missing'; path: string; ref: string }
  | { kind: 'version_abandoned'; path: string; ref: string }
  | { kind: 'component_changed'; path: string; from: string | null; to: string | null }
  | { kind: 'change_added' | 'change_removed'; path: string; ref: string; id: string; at?: string; by?: string }

export function selectableVersions(repo: Pick<TestedRepoOptions, 'versions'>): TestedVersionOption[] {
  return repo.versions.filter(v => v.state !== 'abandoned')
}

/** Une version sélectionnable, par ID puis par label. */
export function matchTestedVersion(repo: Pick<TestedRepoOptions, 'versions'>, value: string): TestedVersionOption | undefined {
  const text = value.trim()
  const selectable = selectableVersions(repo)
  return selectable.find(v => v.id === text) ?? selectable.find(v => v.title === text)
}

/** Dépendances à plat, avec leur chemin (`motor-control/bms`). */
export function flattenTestedRepos(root: TestedRepoOptions): Array<{ path: string; repo: TestedRepoOptions }> {
  const out: Array<{ path: string; repo: TestedRepoOptions }> = []
  const walk = (repo: TestedRepoOptions, prefix: string) => {
    for (const dep of repo.dependencies) {
      const path = prefix ? `${prefix}/${dep.name}` : dep.name
      out.push({ path, repo: dep })
      walk(dep, path)
    }
  }
  walk(root, '')
  return out
}

/** Saisies qui ne correspondent à aucune version sélectionnable (écarts non documentés). */
export function testedUndocumented(options: TestedRepoOptions, choice: TestedConfigChoice): Array<{ path: string; value: string }> {
  const out: Array<{ path: string; value: string }> = []
  if (choice.version.trim() && !matchTestedVersion(options, choice.version)) out.push({ path: '', value: choice.version.trim() })
  const repos = new Map(flattenTestedRepos(options).map(r => [r.path, r.repo]))
  for (const [path, value] of Object.entries(choice.components ?? {})) {
    if (!value.trim()) continue
    const repo = repos.get(path)
    if (!repo || !matchTestedVersion(repo, value)) out.push({ path, value: value.trim() })
  }
  return out
}

/** Écarts d'une copie, non documentés en tête. */
export function testedDeviations(config: TestedConfig): Array<{ path: string; node: TestedConfigNode }> {
  const out: Array<{ path: string; node: TestedConfigNode }> = []
  if (config.undocumented) out.push({ path: '', node: config })
  const walk = (node: TestedConfigNode, prefix: string) => {
    for (const [name, child] of Object.entries(node.components ?? {})) {
      const path = prefix ? `${prefix}/${name}` : name
      if (child.undocumented || child.expected !== undefined) out.push({ path, node: child })
      walk(child, path)
    }
  }
  walk(config, '')
  return [...out.filter(d => d.node.undocumented), ...out.filter(d => !d.node.undocumented)]
}

/**
 * Saisie à reprendre d'une copie : version et écarts encore valables. Sans version sélectionnable
 * (abandonnée, supprimée) : `null`, pour ne jamais attribuer un résultat à une version par défaut.
 */
export function testedChoiceFromConfig(config: TestedConfig, options: TestedRepoOptions): TestedConfigChoice | null {
  const root = config.undocumented ?? (config.ref && selectableVersions(options).some(v => v.id === config.ref) ? config.ref : '')
  if (!root) return null
  const repos = new Map(flattenTestedRepos(options).map(r => [r.path, r.repo]))
  const components: Record<string, string> = {}
  for (const { path, node } of testedDeviations(config)) {
    if (!path) continue
    if (node.undocumented) components[path] = node.undocumented
    else if (node.ref && repos.get(path)?.versions.some(v => v.id === node.ref && v.state !== 'abandoned')) components[path] = node.ref
  }
  return { version: root, ...(Object.keys(components).length > 0 && { components }) }
}

/** `at` d'une entrée sous forme de texte (une date non quotée, éditée à la main, est lue en `Date`). */
export function historyAtText(at: unknown): string {
  return at instanceof Date ? historyTimestamp(at) : String(at)
}

/** IDs triés : forme enregistrée et comparée de la liste des changements. */
export function changeIdsOf(changes: ReadonlyArray<{ id: string }> | undefined): string[] {
  return (changes ?? []).map(c => c.id).sort((a, b) => a.localeCompare(b))
}

function sameIds(a: unknown, b: string[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

interface ChangesCarrier {
  changes?: ReadonlyArray<{ id: string }>
  history?: ObjectHistory
}

/** La dernière entrée de `history.changes` ne reflète pas la liste : une écriture doit l'ajouter. */
export function changesHistoryDue(version: ChangesCarrier): boolean {
  const list = version.history?.[CHANGES_HISTORY_KEY] ?? []
  const last = list[list.length - 1]
  return !last || !sameIds(last.value, changeIdsOf(version.changes))
}

/**
 * `at` de l'entrée en vigueur, si elle reflète bien la liste courante ; sinon (YAML modifié à la main)
 * absent, plutôt que de désigner une entrée fausse.
 */
export function currentChangesAt(version: ChangesCarrier): string | undefined {
  if (changesHistoryDue(version)) return undefined
  const list = version.history![CHANGES_HISTORY_KEY]
  return historyAtText(list[list.length - 1].at)
}

/**
 * Ajoute à `history.changes` la liste courante si elle a changé. Même seconde : la dernière entrée est
 * remplacée, pour que `at` désigne une seule entrée. Ne mute pas l'objet reçu.
 */
export function applyChangesHistory<T extends ChangesCarrier>(version: T, actor: HistoryActor, now: Date): T {
  if (!changesHistoryDue(version)) return version
  const at = historyTimestamp(now)
  const list = [...(version.history?.[CHANGES_HISTORY_KEY] ?? [])]
  const entry: HistoryEntry = {
    value: changeIdsOf(version.changes), at,
    ...(actor.by && { by: actor.by }), ...(actor.source && { source: actor.source }),
  }
  if (list.length > 0 && historyAtText(list[list.length - 1].at) === at) list[list.length - 1] = entry
  else list.push(entry)
  return { ...version, history: { ...version.history, [CHANGES_HISTORY_KEY]: list } } as T
}
