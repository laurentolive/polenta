import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as path from 'path'
import * as yaml from 'js-yaml'
import git from 'isomorphic-git'
import type { DesignateOutcome, IntegrationGuardCode, IntegrationState, IntegrationStatus } from '@polenta/types'

import type { GitService } from './git.service'
import type { SyncService } from './sync.service'
import type { ForgeService } from './forge/forge.service'

const PROJECT_FILE = 'config/project.yaml'
const INT_PREFIX = 'int-'
/** Suffixe d'une `int-*` : mêmes caractères que les slugs `dev-*`, sans `..` ni `.lock` final. */
const SUFFIX_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Refus de suppression (spec GH103 §1.5). `message` est affiché tel quel par le renderer. */
export class IntegrationBranchGuardError extends Error {
  constructor(readonly code: IntegrationGuardCode, branch: string) {
    super(code === 'designated'
      ? `${branch} est la branche d'intégration de ce repo : désignez-en une autre avant de la supprimer.`
      : `${branch} est la dernière branche d'intégration de ce repo : un repo ne doit jamais rester sans branche d'intégration.`)
    this.name = 'IntegrationBranchGuardError'
  }
}

/**
 * GH106 — branche d'intégration explicite (specs/GH106-design.md §2). « Désigner » remplace
 * l'écriture non commitée de `config/project.yaml` : checkout, commit de ce seul fichier, push,
 * branche par défaut de la forge. Invariant : sur `int-X`, `project.yaml` désigne `int-X`.
 */
export class IntegrationBranchService {
  constructor(
    private readonly git: GitService,
    private readonly sync: SyncService,
    private readonly forge: ForgeService,
  ) {}

  async state(repoPath: string): Promise<IntegrationState> {
    const currentBranch = (await git.currentBranch({ fs, dir: repoPath }).catch(() => undefined)) ?? ''
    const configured = await this.git.getIntegrationBranch(repoPath)
    let status: IntegrationStatus = 'ok'
    if (!currentBranch) status = 'readonly'
    else if (currentBranch.startsWith(INT_PREFIX) && currentBranch !== configured) status = 'incoherent'
    else if (!configured.startsWith(INT_PREFIX)) status = 'nonConvention'
    return { currentBranch, configured, status, candidates: await this.candidates(repoPath) }
  }

  async designate(repoPath: string, branch: string): Promise<DesignateOutcome> {
    if (!branch.startsWith(INT_PREFIX) || !isValidSuffix(branch.slice(INT_PREFIX.length))) {
      throw new Error(`« ${branch} » n'est pas un nom de branche d'intégration valide (int-<nom>).`)
    }
    const current = await git.currentBranch({ fs, dir: repoPath }).catch(() => undefined)
    // Branche absente en local : isomorphic-git crée la branche de suivi depuis origin/<branch>.
    if (current !== branch) await this.sync.checkoutBranch(repoPath, branch)

    const outcome: DesignateOutcome = { branch, committed: false, push: 'no-remote', defaultBranch: 'no-forge' }
    // Both copies are parsed before anything is written: an unreadable file is never overwritten
    // with a config reduced to `integrationBranch` (a pending hand edit would be lost).
    const headRaw = await this.sync.readFileAtHead(repoPath, PROJECT_FILE)
    const headConfig = parseConfigStrict(headRaw, 'commit courant')
    const wdPath = path.join(repoPath, PROJECT_FILE)
    const wdRaw = await fsP.readFile(wdPath, 'utf-8').catch(() => null)
    const wdConfig = parseConfigStrict(wdRaw, 'copie de travail')

    let committedText: string | null = null
    if (headConfig.integrationBranch !== branch) {
      committedText = dumpConfig({ ...headConfig, integrationBranch: branch })
      outcome.commitSha = await this.sync.commitSingleFile(repoPath, PROJECT_FILE, committedText, `Branche d'intégration : ${branch}`)
      outcome.committed = true
    }
    // The working copy is what "Publier" reads (`getIntegrationBranch`): realigned whenever it
    // doesn't name the branch, committed or not — e.g. HEAD already right but a leftover
    // uncommitted write of the old `setIntegrationBranch` naming another branch.
    if (committedText !== null || wdConfig.integrationBranch !== branch) {
      const unchangedWd = wdRaw === null || normalizeEol(wdRaw) === normalizeEol(headRaw ?? '')
      const next = committedText !== null && unchangedWd
        ? committedText
        : dumpConfig({ ...wdConfig, integrationBranch: branch })
      await fsP.mkdir(path.dirname(wdPath), { recursive: true })
      await fsP.writeFile(wdPath, next, 'utf-8')
    }

    const remotes = await git.listRemotes({ fs, dir: repoPath }).catch(() => [])
    if (!remotes.some(r => r.remote === 'origin')) return outcome
    try {
      await this.sync.pushBranch(repoPath, branch)
      outcome.push = 'ok'
    } catch (err) {
      outcome.push = { error: err instanceof Error ? err.message : String(err) }
      outcome.defaultBranch = 'push-pending'
      return outcome
    }
    outcome.defaultBranch = await this.forge.alignDefaultBranch(repoPath, branch)
    return outcome
  }

  /** Crée `int-<suffix>` à la position courante (ou sur un tag) puis la désigne (spec §1.3). */
  async createAndDesignate(repoPath: string, suffix: string, from?: { tag: string }): Promise<DesignateOutcome> {
    if (!isValidSuffix(suffix)) throw new Error(`« ${suffix} » : lettres, chiffres, « - », « _ » et « . » seulement.`)
    const branch = `${INT_PREFIX}${suffix}`
    if ((await this.candidates(repoPath)).some(c => c.name === branch)) {
      throw new Error(`La branche ${branch} existe déjà (en local ou sur le serveur).`)
    }
    const previous = (await git.currentBranch({ fs, dir: repoPath }).catch(() => undefined)) || undefined
    let sha: string | null = null
    if (from) {
      sha = await this.sync.resolveTag(repoPath, from.tag)
      if (!sha) throw new Error(`Baseline « ${from.tag} » introuvable.`)
    }
    try {
      if (sha) {
        await this.sync.createBranchAt(repoPath, branch, sha)
        await this.sync.checkoutBranch(repoPath, branch)
      } else {
        await this.sync.createBranch(repoPath, branch)
      }
      return await this.designate(repoPath, branch)
    } catch (err) {
      await this.undoCreate(repoPath, branch, previous, !!sha)
      throw err
    }
  }

  /**
   * Échec avant la désignation (commit impossible, checkout en conflit…) : la branche créée est
   * retirée et HEAD revient sur la branche de départ, pour qu'un nouvel essai ne bute pas sur
   * « existe déjà » et que le repo ne reste pas sur une `int-*` non désignée. Une branche dont le
   * commit de désignation a abouti n'est jamais retirée (seul le push peut encore échouer, et il
   * ne lève pas).
   */
  private async undoCreate(repoPath: string, branch: string, previous: string | undefined, rewroteWd: boolean): Promise<void> {
    try {
      const head = await this.sync.readFileAtHead(repoPath, PROJECT_FILE)
      if (parseConfigStrict(head, '').integrationBranch === branch) return
    } catch {
      // HEAD illisible : on poursuit le retour arrière.
    }
    try {
      if (previous && (await git.currentBranch({ fs, dir: repoPath }).catch(() => undefined)) === branch) {
        // Sans tag, la branche a été créée sans toucher au WD (T87) : retour sans réécrire les fichiers.
        await git.checkout({ fs, dir: repoPath, ref: previous, noCheckout: !rewroteWd })
      }
      if ((await git.listBranches({ fs, dir: repoPath })).includes(branch)) await git.deleteBranch({ fs, dir: repoPath, ref: branch })
    } catch {
      // Best-effort : l'erreur d'origine reste celle remontée à l'utilisateur.
    }
  }

  async assertDeletable(repoPath: string, branch: string, scope: 'local' | 'remote'): Promise<void> {
    // Seule une désignation écrite compte : le repli `main` d'un repo sans project.yaml ne protège rien.
    if (branch === (await this.explicitIntegrationBranch(repoPath))) throw new IntegrationBranchGuardError('designated', branch)
    if (!branch.startsWith(INT_PREFIX)) return
    const [locals, remotes] = await this.branchLists(repoPath)
    const remaining = new Set([
      ...(scope === 'local' ? locals.filter(b => b !== branch) : locals),
      ...(scope === 'remote' ? remotes.filter(b => b !== branch) : remotes),
    ])
    if (![...remaining].some(b => b.startsWith(INT_PREFIX))) throw new IntegrationBranchGuardError('lastIntegration', branch)
  }

  private async candidates(repoPath: string): Promise<IntegrationState['candidates']> {
    const [locals, remotes] = await this.branchLists(repoPath)
    const local = new Set(locals.filter(b => b.startsWith(INT_PREFIX)))
    const names = new Set([...local, ...remotes.filter(b => b.startsWith(INT_PREFIX))])
    return [...names].sort().map(name => ({ name, remoteOnly: !local.has(name) }))
  }

  private async branchLists(repoPath: string): Promise<[string[], string[]]> {
    const locals = await git.listBranches({ fs, dir: repoPath }).catch(() => [] as string[])
    const remotes = await git.listBranches({ fs, dir: repoPath, remote: 'origin' }).catch(() => [] as string[])
    return [locals, remotes.filter(b => b !== 'HEAD')]
  }

  /** `integrationBranch` écrit dans le `project.yaml` du WD, sans le repli `main` (garde §1.5). */
  private async explicitIntegrationBranch(repoPath: string): Promise<string | null> {
    const raw = await fsP.readFile(path.join(repoPath, PROJECT_FILE), 'utf-8').catch(() => null)
    try {
      const value = parseConfigStrict(raw, '').integrationBranch
      return typeof value === 'string' ? value : null
    } catch {
      return null
    }
  }
}

function isValidSuffix(suffix: string): boolean {
  return SUFFIX_RE.test(suffix) && !suffix.includes('..') && !suffix.endsWith('.lock') && !suffix.endsWith('.')
}

/** `{}` si absent ou vide ; lève une erreur si le YAML est illisible ou n'est pas un objet. */
function parseConfigStrict(raw: string | null, where: string): Record<string, unknown> {
  if (raw === null || !raw.trim()) return {}
  let data: unknown
  try {
    data = yaml.load(raw)
  } catch {
    throw new Error(`${PROJECT_FILE} (${where}) n'est pas un YAML valide : corrigez-le avant de désigner une branche d'intégration.`)
  }
  if (data === null || data === undefined) return {}
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${PROJECT_FILE} (${where}) doit contenir des clés : corrigez-le avant de désigner une branche d'intégration.`)
  }
  return data as Record<string, unknown>
}

/** Même sérialisation que `GitService.writeYaml`. */
function dumpConfig(data: Record<string, unknown>): string {
  return yaml.dump(data, { lineWidth: 120 })
}

function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, '\n')
}
