import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as path from 'path'

import { gitFor, type GitBackend, type StatusEntry } from '../git/git-backend'
import { isGitError } from '../git/git-errors'
import { isLocalStateFile } from './repo-conformity.util'

/**
 * GH336 (spec §3.3, §5) — le seul checkout de Polenta. Règle : si le panneau Version n'affiche
 * aucune modification locale, le checkout aboutit ; un fichier local qui serait écrasé est refusé en
 * le nommant avec sa raison.
 *
 * GH337 (design §5) — sur le git natif :
 * - contrôle préalable, avant toute écriture, par `GitBackend.status()` (seule définition de
 *   « modification locale ») sur les fichiers que le checkout change : modifié ou indexé → « modifié »,
 *   non suivi → « non suivi, existe sur … », ignoré → « ignoré ici, versionné sur … » (git l'écraserait
 *   sans rien dire) ;
 * - fichier d'état local (`*.pref`, cache de l'arbre ; Q1 GH336) → jamais bloquant : copie locale mise
 *   de côté, fichier ramené à HEAD le temps du checkout, copie restaurée ensuite ;
 * - un refus de git (« local changes / untracked working tree files would be overwritten ») devient
 *   lui aussi une `LocalChangesError` ;
 * - plus de contournement des fins de ligne : git applique `.gitattributes` et ne voit pas modifié un
 *   fichier qui ne diffère que par elles.
 *
 * Atomicité (§5.3) : une erreur après le début de l'écriture, HEAD encore à sa place, ramène les
 * fichiers que le checkout change à HEAD — sans risque, le contrôle préalable ayant établi qu'aucun
 * d'eux ne porte de modification locale. Les autres modifications locales ne sont pas touchées.
 */

export class LocalChangesError extends Error {
  constructor(readonly target: string, readonly files: { path: string; reason: string }[]) {
    super(
      `Impossible de passer sur ${target} : des fichiers locaux seraient écrasés.\n`
      + files.map(f => `- ${f.path} : ${f.reason}`).join('\n'),
    )
    this.name = 'LocalChangesError'
  }
}

export interface CheckoutArgs {
  dir: string
  /** Branche locale, tag, commit (complet ou abrégé) ou ref. Hors branche locale : tête détachée sur son commit. */
  ref: string
  /** Déplace HEAD seulement, sans toucher à l'index ni au disque (T87). */
  noCheckout?: boolean
  /**
   * La branche `ref`, courante, vient d'être avancée par référence (fusion) : le working directory est
   * encore sur le commit `from`. Il est amené sur la nouvelle pointe de la branche avec les mêmes
   * garanties qu'un changement de branche. Sans `from`, un checkout de la branche courante ne change
   * rien, comme `git checkout`.
   */
  from?: string
}

export async function safeCheckout(args: CheckoutArgs): Promise<void> {
  const { dir, ref } = args
  const g = gitFor(dir)
  const branch = ref.startsWith('refs/heads/')
    ? ref.slice('refs/heads/'.length)
    : (await g.resolve(`refs/heads/${ref}`)) !== null ? ref : null
  // GH314 — un tag annoté se checkout par son commit (jamais l'objet tag dans HEAD).
  const target = branch ? await g.resolve(`refs/heads/${branch}`) : await g.resolveCommit(ref)

  if (args.noCheckout) {
    if (branch) await g.setHeadBranch(branch)
    else await g.detachHead(target ?? await g.resolveOrThrow(ref))
    return
  }
  if (!target) {
    await g.checkout(ref) // révision inconnue : l'erreur de git
    return
  }

  // Branche courante avancée par référence : HEAD repassé (détaché) sur le commit du working
  // directory, puis checkout ordinaire de la branche ; HEAD y revient si le checkout est refusé.
  const realign = !!args.from && branch !== null && args.from !== target && (await g.currentBranch()) === branch
  if (realign) await g.detachHead(args.from!)
  try {
    await checkoutChecked(g, dir, ref, branch, target)
  } catch (err) {
    if (realign && (await g.resolve('HEAD')) === args.from) await g.setHeadBranch(branch!).catch(() => {})
    throw err
  }
}

async function checkoutChecked(g: GitBackend, dir: string, label: string, branch: string | null, target: string): Promise<void> {
  const headOid = await g.resolve('HEAD')
  const headBranch = await g.currentBranch().catch(() => null)
  const changes = await g.diffNames(headOid ? `${headOid}^{tree}` : null, `${target}^{tree}`)

  const status = new Map<string, StatusEntry[]>()
  for (const e of changes.length ? await g.status() : []) status.set(e.path, [...(status.get(e.path) ?? []), e])

  const blocking: { path: string; reason: string }[] = []
  const localState: string[] = []
  for (const c of changes) {
    if (isLocalStateFile(c.path)) { localState.push(c.path); continue }
    const entries = status.get(c.path) ?? []
    const tracked = entries.filter(e => e.index !== '?' && e.index !== '!')
    if (tracked.length > 0) {
      const deleted = tracked.every(e => e.index === '.' && e.worktree === 'D')
      blocking.push({ path: c.path, reason: deleted ? 'supprimé' : 'modifié' })
    } else if (entries.some(e => e.index === '?')) {
      blocking.push({ path: c.path, reason: `non suivi, existe sur ${label}` })
    } else if (c.status === 'A' && fs.existsSync(path.join(dir, c.path))) {
      // Absent de HEAD, présent sur le disque, invisible du statut : ignoré. git l'écraserait.
      blocking.push({ path: c.path, reason: `ignoré ici, versionné sur ${label}` })
    }
  }
  if (blocking.length > 0) throw new LocalChangesError(label, blocking)

  // Q1 GH336 — état local de l'utilisateur, réécrit en continu par Polenta : copie mise de côté,
  // fichier ramené à HEAD (ou retiré s'il n'y est pas) le temps du checkout, copie restaurée ensuite.
  const setAside = new Map<string, Buffer>()
  for (const p of localState) {
    const content = await fsP.readFile(path.join(dir, p)).catch(() => null)
    if (content) setAside.set(p, content)
  }
  try {
    const neutralize = localState.filter(p => setAside.has(p) || status.has(p))
    if (neutralize.length) await g.restore(neutralize)
    try {
      await g.checkout(branch ?? target, { detach: !branch })
    } catch (err) {
      const refused = isGitError(err) ? refusedFiles(err.stderr) : []
      if (refused.length > 0) throw new LocalChangesError(label, refused)
      // États locaux compris : ramenés à HEAD ici, leur copie mise de côté est restaurée ensuite.
      await rollbackIfPartial(g, headOid, headBranch, changes.map(c => c.path))
      throw err
    }
  } finally {
    for (const [p, content] of setAside) {
      const abs = path.join(dir, p)
      await fsP.mkdir(path.dirname(abs), { recursive: true }).catch(() => {})
      await fsP.writeFile(abs, content).catch(() => {})
    }
  }
}

/**
 * Fichiers d'un refus de git (`checkout`, `read-tree -m`), avec leur raison ; `[]` si le message n'en
 * est pas un.
 */
export function refusedFiles(stderr: string): { path: string; reason: string }[] {
  const out: { path: string; reason: string }[] = []
  let reason: string | null = null
  for (const line of stderr.split(/\r?\n/)) {
    if (/local changes to the following files would be overwritten/i.test(line)) { reason = 'modifié'; continue }
    if (/untracked working tree files would be (overwritten|removed)/i.test(line)) { reason = 'non suivi'; continue }
    if (reason && line.startsWith('\t')) { out.push({ path: unquote(line.slice(1)), reason }); continue }
    reason = null
    const m = /^error: Entry '(.+)' (not uptodate|would be overwritten)/.exec(line)
    if (m) out.push({ path: m[1], reason: 'modifié' })
  }
  return out
}

/** Chemin cité par git (`core.quotePath`) : `"r\303\251f.yaml"` → `réf.yaml`. */
function unquote(p: string): string {
  if (!p.startsWith('"') || !p.endsWith('"')) return p
  const bytes: number[] = []
  const s = p.slice(1, -1)
  const esc: Record<string, number> = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11, '\\': 92, '"': 34 }
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\') { bytes.push(...Buffer.from(s[i], 'utf8')); continue }
    const oct = /^[0-7]{3}/.exec(s.slice(i + 1))
    if (oct) { bytes.push(parseInt(oct[0], 8)); i += 3; continue }
    bytes.push(esc[s[i + 1]] ?? s.charCodeAt(i + 1))
    i += 1
  }
  return Buffer.from(bytes).toString('utf8')
}

/**
 * HEAD n'a pas bougé mais des fichiers du checkout ont pu être écrits (checkout interrompu) : ils sont
 * ramenés à HEAD (index et disque). Aucun d'eux ne portait de modification locale (contrôle préalable).
 */
async function rollbackIfPartial(g: GitBackend, headOid: string | null, headBranch: string | null, paths: string[]): Promise<void> {
  if (!headOid || paths.length === 0) return
  try {
    if ((await g.resolve('HEAD')) !== headOid || (await g.currentBranch()) !== headBranch) return
    await g.restore(paths)
  } catch {
    // Meilleur effort : l'erreur d'origine est relancée par l'appelant.
  }
}
