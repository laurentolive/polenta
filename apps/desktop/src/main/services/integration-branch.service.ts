import * as fsP from 'fs/promises'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { encodeIntegrationGuard, isValidIntegrationSuffix } from '@polenta/types'
import type { DesignateOutcome, IntegrationCreateFrom, IntegrationGuardCode, IntegrationState, IntegrationStatus } from '@polenta/types'

import { gitFor } from '../git/git-backend'
import type { GitService } from './git.service'
import type { SyncService } from './sync.service'
import type { ForgeService } from './forge/forge.service'
import { safeCheckout } from './safe-checkout.util'

const PROJECT_FILE = 'config/project.yaml'
const INT_PREFIX = 'int-'

/**
 * Refus de suppression (spec GH103 §1.5). Le code voyage dans `message` (marqueur
 * `⟦integration-guard …⟧`) : le renderer le traduit ; le texte français qui suit sert de repli
 * (serveur MCP, journaux).
 */
export class IntegrationBranchGuardError extends Error {
  constructor(readonly code: IntegrationGuardCode, branch: string) {
    super(encodeIntegrationGuard(code, branch, code === 'designated'
      ? `${branch} est la branche d'intégration de ce repo : désignez-en une autre avant de la supprimer.`
      : `${branch} est la dernière branche d'intégration de ce repo : un repo ne doit jamais rester sans branche d'intégration.`))
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
    const currentBranch = (await branchOf(repoPath)) ?? ''
    const configured = await this.git.getIntegrationBranch(repoPath)
    let status: IntegrationStatus = 'ok'
    if (!currentBranch) status = 'detached'
    else if (currentBranch.startsWith(INT_PREFIX) && currentBranch !== configured) status = 'incoherent'
    else if (!configured.startsWith(INT_PREFIX)) status = 'nonConvention'
    // GH314 — a folder positioned on an annotated tag before the fix has the tag object in HEAD.
    const g = gitFor(repoPath)
    const headOid = await g.resolve('HEAD')
      .then(async oid => oid ? ((await g.resolveCommit(oid).catch(() => null)) ?? oid) : '', () => '')
    return { currentBranch, headOid, configured, status, candidates: await this.candidates(repoPath) }
  }

  async designate(repoPath: string, branch: string): Promise<DesignateOutcome> {
    if (!branch.startsWith(INT_PREFIX) || !isValidIntegrationSuffix(branch.slice(INT_PREFIX.length))) {
      throw new Error(`« ${branch} » n'est pas un nom de branche d'intégration valide (int-<nom>).`)
    }
    const current = await branchOf(repoPath)
    // Branche absente en local : la branche de suivi est créée depuis origin/<branch>.
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

    const remotes = await gitFor(repoPath).remotes().catch(() => [])
    if (!remotes.some(r => r.name === 'origin')) return outcome
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

  /** Crée `int-<suffix>` à la position courante, sur un tag ou sur un commit, puis la désigne (spec §1.3). */
  async createAndDesignate(repoPath: string, suffix: string, from?: IntegrationCreateFrom): Promise<DesignateOutcome> {
    if (!isValidIntegrationSuffix(suffix)) throw new Error(`« ${suffix} » : lettres, chiffres, « - », « _ » et « . » seulement.`)
    const branch = `${INT_PREFIX}${suffix}`
    if ((await this.candidates(repoPath)).some(c => c.name === branch)) {
      throw new Error(`La branche ${branch} existe déjà (en local ou sur le serveur).`)
    }
    // Detached HEAD (composant épinglé) : la position de retour est le commit.
    const previous = (await branchOf(repoPath))
      || ((await gitFor(repoPath).resolve('HEAD').catch(() => null)) ?? undefined)
    let sha: string | null = null
    if (from && 'tag' in from) {
      sha = await this.sync.resolveTag(repoPath, from.tag)
      if (!sha) throw new Error(`Baseline « ${from.tag} » introuvable.`)
    } else if (from) {
      // Un oid (pas un nom de branche ou de tag), pelé jusqu'au commit comme le faisait readCommit.
      sha = /^[0-9a-f]{4,40}$/i.test(from.commit)
        ? await gitFor(repoPath).resolveCommit(from.commit).catch(() => null)
        : null
      if (!sha) throw new Error(`Commit « ${from.commit} » introuvable.`)
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
   * retirée et HEAD revient sur la branche (ou le commit, en detached HEAD) de départ, pour qu'un
   * nouvel essai ne bute pas sur « existe déjà » et que le repo ne reste pas sur une `int-*` non désignée. Une branche dont le
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
      if (previous && (await branchOf(repoPath)) === branch) {
        // Sans tag, la branche a été créée sans toucher au WD (T87) : retour sans réécrire les fichiers.
        await safeCheckout({ dir: repoPath, ref: previous, noCheckout: !rewroteWd })
      }
      const g = gitFor(repoPath)
      const oid = await g.resolve(`refs/heads/${branch}`)
      if (oid) {
        // Branche encore courante (retour arrière échoué) → HEAD détaché d'abord.
        if ((await g.currentBranch()) === branch) await g.detachHead(oid)
        await g.deleteBranch(branch)
      }
    } catch {
      // Best-effort : l'erreur d'origine reste celle remontée à l'utilisateur.
    }
  }

  async assertDeletable(repoPath: string, branch: string, scope: 'local' | 'remote'): Promise<void> {
    // Seule une désignation écrite compte : le repli `main` d'un repo sans project.yaml ne protège rien.
    if (branch === (await this.explicitIntegrationBranch(repoPath))) throw new IntegrationBranchGuardError('designated', branch)
    if (!branch.startsWith(INT_PREFIX)) return
    const [locals, remotes] = await this.branchLists(repoPath)
    // En local, le repo garde une int-* tant qu'il en reste une, locale ou sur origin (elle se
    // récupère). Sur origin, seules comptent celles d'origin : une copie locale ne protège pas la
    // forge (GH276).
    const remaining = scope === 'local'
      ? [...locals.filter(b => b !== branch), ...remotes]
      : remotes.filter(b => b !== branch)
    if (!remaining.some(b => b.startsWith(INT_PREFIX))) throw new IntegrationBranchGuardError('lastIntegration', branch)
  }

  private async candidates(repoPath: string): Promise<IntegrationState['candidates']> {
    const [locals, remotes] = await this.branchLists(repoPath)
    const local = new Set(locals.filter(b => b.startsWith(INT_PREFIX)))
    const names = new Set([...local, ...remotes.filter(b => b.startsWith(INT_PREFIX))])
    return [...names].sort().map(name => ({ name, remoteOnly: !local.has(name) }))
  }

  private async branchLists(repoPath: string): Promise<[string[], string[]]> {
    // Un seul `for-each-ref` pour les deux listes (chemin de chaque rafraîchissement).
    const refs = await gitFor(repoPath).refs(['refs/heads/', 'refs/remotes/origin/']).catch(() => [])
    const under = (base: string): string[] => refs.filter(r => r.ref.startsWith(base)).map(r => r.ref.slice(base.length))
    return [under('refs/heads/'), under('refs/remotes/origin/').filter(b => b !== 'HEAD')]
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


/** Branche courante, `undefined` en tête détachée ou hors dépôt. */
async function branchOf(repoPath: string): Promise<string | undefined> {
  return (await gitFor(repoPath).currentBranch().catch(() => null)) ?? undefined
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
