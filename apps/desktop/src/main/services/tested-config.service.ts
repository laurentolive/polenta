import {
  CHANGES_HISTORY_KEY, currentChangesAt, historyAtText, matchTestedVersion, selectableVersions, testedChoiceFromConfig, versionState,
} from '@polenta/types'
import type {
  ProductVersion, TestCampaign, TestRun, TestedConfig, TestedConfigChoice, TestedConfigContext, TestedConfigNode,
  TestedDriftItem, TestedRepoOptions, TestedVersionOption,
} from '@polenta/types'
import type { CampaignsService } from './campaigns.service'
import type { SyncService } from './sync.service'
import type { TestsService } from './tests.service'
import type { VersionsService } from './versions.service'

export class TestedVersionError extends Error {
  readonly code = 'TESTED_VERSION_REQUIRED'
  constructor() {
    super('TESTED_VERSION_REQUIRED : la version testée est obligatoire')
  }
}

interface Repo { name: string; repoPath: string }

type VersionsCache = Map<string, Array<{ version: ProductVersion; option: TestedVersionOption }>>

/**
 * GH202 — version testée d'une exécution (specs/GH202.md) : versions proposées, pré-remplissage, copie
 * figée écrite dans le run, comparaison à l'état courant. Aucune écriture de version ici.
 */
export class TestedConfigService {
  constructor(
    private readonly versions: Pick<VersionsService, 'list' | 'versionType' | 'dependenciesOf' | 'repoName' | 'repoPathNamed'>,
    private readonly sync: Pick<SyncService, 'resolveHead'>,
    private readonly tests: Pick<TestsService, 'findRuns'>,
    private readonly campaigns: Pick<CampaignsService, 'get'>,
  ) {}

  /** Versions du repo de la campagne et de ses dépendances (récursif). */
  async options(repoPath: string, workspaceDir?: string): Promise<TestedRepoOptions> {
    const name = await this.versions.repoName(repoPath, workspaceDir)
    return this.optionsOf({ name, repoPath }, name, workspaceDir)
  }

  private async optionsOf(repo: Repo, label: string, workspaceDir?: string): Promise<TestedRepoOptions> {
    const deps = await this.versions.dependenciesOf(repo.repoPath, workspaceDir)
    return {
      name: repo.name, label,
      versions: (await this.versionsOf(repo.repoPath)).map(({ option }) => option),
      dependencies: await Promise.all(deps.map(d => this.optionsOf(d, d.label, workspaceDir))),
    }
  }

  private async versionsOf(repoPath: string): Promise<Array<{ version: ProductVersion; option: TestedVersionOption }>> {
    const typeDef = (await this.versions.versionType(repoPath))?.typeDef
    if (!typeDef) return []
    return (await this.versions.list(repoPath)).reverse().map(version => ({
      version,
      option: {
        id: version.id, title: version.title, state: versionState(typeDef, version.status),
        ...(version.components && { components: version.components }),
      },
    }))
  }

  /** Options et saisie de la dernière exécution de la campagne, rien n'étant stocké sur la campagne. */
  async context(repoPath: string, campaignId: string, workspaceDir?: string): Promise<TestedConfigContext> {
    const [options, campaign] = await Promise.all([this.options(repoPath, workspaceDir), this.campaigns.get(repoPath, campaignId)])
    return { options, prefill: await this.prefill(repoPath, campaign, options, workspaceDir) }
  }

  async prefill(repoPath: string, campaign: TestCampaign, options: TestedRepoOptions, workspaceDir?: string): Promise<TestedConfigChoice | null> {
    const executed = campaign.runs
      .filter(e => e.runId && e.executedAt)
      .sort((a, b) => (new Date(b.executedAt!).getTime() - new Date(a.executedAt!).getTime()))
    const runsByTest = new Map<string, TestRun[]>()
    for (const entry of executed) {
      if (!runsByTest.has(entry.testCaseId)) runsByTest.set(entry.testCaseId, await this.runsOf(repoPath, entry.testCaseId, workspaceDir))
      const config = runsByTest.get(entry.testCaseId)!.find(r => r.id === entry.runId)?.testedConfig
      if (config) return testedChoiceFromConfig(config, options)
    }
    return null
  }

  /** Runs d'un test : celui d'un composant vit dans le repo du composant, pas dans celui de la campagne. */
  private async runsOf(repoPath: string, testCaseId: string, workspaceDir?: string): Promise<TestRun[]> {
    const runs = await this.tests.findRuns(repoPath, testCaseId).catch(() => [])
    if (runs.length > 0) return runs
    for (const dep of await this.versions.dependenciesOf(repoPath, workspaceDir)) {
      const found = await this.runsOf(dep.repoPath, testCaseId, workspaceDir)
      if (found.length > 0) return found
    }
    return []
  }

  /**
   * Copie à écrire dans le run. Sans saisie : refus si une version est sélectionnable et `required`,
   * sinon pas de copie.
   */
  async resolve(
    repoPath: string, choice: TestedConfigChoice | undefined, workspaceDir: string | undefined, opts: { required: boolean },
  ): Promise<TestedConfig | undefined> {
    const value = choice?.version?.trim()
    if (!value) {
      if (!opts.required) return undefined
      const available = (await this.versionsOf(repoPath)).map(({ option }) => option)
      if (selectableVersions({ versions: available }).length > 0) throw new TestedVersionError()
      return undefined
    }
    const name = await this.versions.repoName(repoPath, workspaceDir)
    const versions = await this.versionsOf(repoPath)
    const matched = matchTestedVersion({ versions: versions.map(v => v.option) }, value)
    const version = matched ? versions.find(v => v.option.id === matched.id) : undefined
    const overrides = choice?.components ?? {}
    const components = await this.componentsOf({ name, repoPath }, version?.version ?? null, overrides, '', workspaceDir)
    const commit = await this.sync.resolveHead(repoPath).catch(() => null)
    const head: TestedConfigNode = version
      ? this.versionNode(version.version, version.option, commit)
      : { undocumented: value, ...(commit && { commit }) }
    return { component: name, ...head, ...(Object.keys(components).length > 0 && { components }) }
  }

  private versionNode(version: ProductVersion, option: TestedVersionOption, commit: string | null): TestedConfigNode {
    const changesAt = currentChangesAt(version)
    return {
      ref: version.id, label: version.title, state: option.state,
      ...(commit && { commit }), ...(changesAt && { changesAt }),
    }
  }

  private async componentsOf(
    repo: Repo, version: ProductVersion | null, overrides: Record<string, string>, prefix: string, workspaceDir?: string,
  ): Promise<Record<string, TestedConfigNode>> {
    const out: Record<string, TestedConfigNode> = {}
    for (const dep of await this.versions.dependenciesOf(repo.repoPath, workspaceDir)) {
      const path = prefix ? `${prefix}/${dep.name}` : dep.name
      const expected = version?.components?.[dep.name]
      const override = overrides[path]?.trim() || undefined
      const value = override ?? expected
      if (!value) {
        // Sans valeur ni version retenue : les écarts saisis plus bas restent dans la copie.
        const below = await this.componentsOf(dep, null, overrides, path, workspaceDir)
        if (Object.keys(below).length > 0) out[dep.name] = { components: below }
        continue
      }
      const known = await this.versionsOf(dep.repoPath)
      // Une valeur saisie vise une version sélectionnable ; la composition peut en citer une abandonnée.
      const matched = override
        ? matchTestedVersion({ versions: known.map(v => v.option) }, override)
        : known.find(v => v.option.id === expected)?.option
      const found = matched ? known.find(v => v.option.id === matched.id) : undefined
      const deviates = !!override && (!found || found.version.id !== expected)
      const mark = deviates ? { expected: expected ?? null } : {}
      if (!found) {
        // Composition qui cite une version supprimée : référence gardée telle quelle.
        const below = await this.componentsOf(dep, null, overrides, path, workspaceDir)
        out[dep.name] = {
          ...(override ? { undocumented: override, ...mark } : { ref: value }),
          ...(Object.keys(below).length > 0 && { components: below }),
        }
        continue
      }
      const commit = await this.sync.resolveHead(dep.repoPath).catch(() => null)
      const children = await this.componentsOf(dep, found.version, overrides, path, workspaceDir)
      out[dep.name] = {
        ...this.versionNode(found.version, found.option, commit), ...mark,
        ...(Object.keys(children).length > 0 && { components: children }),
      }
    }
    return out
  }

  /** Différences entre la copie d'un run et l'état courant des versions. */
  async drift(
    repoPath: string, config: TestedConfig, workspaceDir?: string, cache: VersionsCache = new Map(),
  ): Promise<{ repoPath: string; items: TestedDriftItem[] }> {
    const root = await this.versions.repoPathNamed(config.component, repoPath, workspaceDir)
    const items: TestedDriftItem[] = []
    if (config.ref) await this.walkDrift(root, config, '', items, cache, workspaceDir)
    return { repoPath: root, items }
  }

  private async walkDrift(
    repoPath: string, node: TestedConfigNode, path: string, items: TestedDriftItem[],
    cache: VersionsCache, workspaceDir?: string,
  ): Promise<void> {
    if (!node.ref) return
    if (!cache.has(repoPath)) cache.set(repoPath, await this.versionsOf(repoPath))
    const current = cache.get(repoPath)!.find(v => v.option.id === node.ref)
    if (!current) {
      items.push({ kind: 'version_missing', path, ref: node.ref })
      return
    }
    if (current.option.state === 'abandoned' && node.state !== 'abandoned') items.push({ kind: 'version_abandoned', path, ref: node.ref })
    if (node.changesAt) items.push(...changesDrift(current.version, node.changesAt, path, node.ref))

    const deps = await this.versions.dependenciesOf(repoPath, workspaceDir)
    // Un composant hors de l'arbre du workspace n'est jamais copié : pas une évolution.
    const names = new Set([
      ...Object.keys(node.components ?? {}),
      ...Object.keys(current.version.components ?? {}).filter(name => deps.some(d => d.name === name)),
    ])
    for (const name of names) {
      const child = node.components?.[name]
      const childPath = path ? `${path}/${name}` : name
      // Composant en écart : la référence est ce que la composition prévoyait alors.
      const from = child ? (child.expected !== undefined ? child.expected : child.ref ?? null) : null
      const to = current.version.components?.[name] ?? null
      if (from !== to) items.push({ kind: 'component_changed', path: childPath, from, to })
      const dep = deps.find(d => d.name === name)
      if (child && dep) await this.walkDrift(dep.repoPath, child, childPath, items, cache, workspaceDir)
    }
  }
}

/** Changements ajoutés ou retirés depuis l'entrée `changesAt`, avec la première entrée qui les constate. */
function changesDrift(version: ProductVersion, changesAt: string, path: string, ref: string): TestedDriftItem[] {
  const list = version.history?.[CHANGES_HISTORY_KEY] ?? []
  const index = list.findIndex(e => historyAtText(e.at) === changesAt)
  if (index < 0) return []
  const idsOf = (value: unknown) => (Array.isArray(value) ? value as string[] : [])
  const before = new Set(idsOf(list[index].value))
  const after = (version.changes ?? []).map(c => c.id)
  const later = list.slice(index + 1)
  const out: TestedDriftItem[] = []
  for (const id of after) {
    if (before.has(id)) continue
    const entry = later.find(e => idsOf(e.value).includes(id))
    out.push({ kind: 'change_added', path, ref, id, ...(entry && { at: historyAtText(entry.at) }), ...(entry?.by && { by: entry.by }) })
  }
  for (const id of before) {
    if (after.includes(id)) continue
    const entry = later.find(e => !idsOf(e.value).includes(id))
    out.push({ kind: 'change_removed', path, ref, id, ...(entry && { at: historyAtText(entry.at) }), ...(entry?.by && { by: entry.by }) })
  }
  return out
}
