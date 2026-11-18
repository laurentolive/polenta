import * as fs from 'fs'
import * as path from 'path'

import { objectInfo } from './cat-file-batch'
import { runGit, splitZ, withRepoWriteLock } from './git-runner'

/**
 * GH337 — essai sprint 0 : checkout dont les fichiers sont écrits par Polenta (processus épargné par
 * l'analyse de Windows Defender), pas par git.exe (GH337-sprint0.md § Emplacement de git.exe).
 *
 * git calcule ce qui change (`diff-tree`) et donne les blobs (`cat-file --batch`) ; Polenta applique
 * la règle de fin de ligne de git (attributs de la cible, `core.autocrlf`, `core.eol`), écrit et
 * supprime les fichiers ; git remet l'index (`read-tree --reset`, qui garde les stats des entrées
 * inchangées, puis `update-index --refresh`) et HEAD, sans réécrire le disque.
 *
 * Renvoie `false` sans rien toucher quand le cas sort du chemin simple (modification locale suivie,
 * fichier non suivi sur le chemin d'un ajout, sous-module, attribut `filter` / `ident` /
 * `working-tree-encoding`) : l'appelant fait alors un `git checkout` ordinaire, qui refuse ou traite
 * le cas comme avant.
 */
export interface NodeCheckoutOptions {
  detach?: boolean
  /** Nombre d'écritures disque simultanées. */
  concurrency?: number
  /** Raison du retour `false` (journal, mesures). */
  onFallback?: (reason: string) => void
  /** Durée de chaque étape (mesures). */
  onStep?: (step: string, ms: number) => void
}

interface Change { oldMode: string; newMode: string; newOid: string; status: string; path: string }

function parseDiffTree(out: Buffer): Change[] {
  const parts = splitZ(out)
  const changes: Change[] = []
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const [oldMode, newMode, , newOid, status] = parts[i].slice(1).split(' ')
    changes.push({ oldMode, newMode, newOid, status, path: parts[i + 1] })
  }
  return changes
}

/** Lit la sortie de `cat-file --batch` : en-tête `<oid> <type> <size>`, LF, contenu, LF. */
function parseBatch(out: Buffer, count: number): Buffer[] {
  const res: Buffer[] = []
  let pos = 0
  for (let i = 0; i < count; i++) {
    const nl = out.indexOf(10, pos)
    const header = out.subarray(pos, nl).toString('utf8')
    const fields = header.split(' ')
    if (fields.length < 3 || fields[1] === 'missing') throw new Error(`cat-file : objet absent (${header})`)
    const size = Number(fields[2])
    res.push(out.subarray(nl + 1, nl + 1 + size))
    pos = nl + 1 + size + 1
  }
  return res
}

// ─── Fins de ligne (reprise de convert.c de git, sens dépôt → working directory) ──────────────

type CrlfAction = 'binary' | 'text' | 'text-input' | 'text-crlf' | 'auto' | 'auto-input' | 'auto-crlf'

export interface EolConfig { autocrlf: 'true' | 'false' | 'input'; eol: 'lf' | 'crlf' | 'native' }

function crlfAction(text: string, eol: string, cfg: EolConfig): CrlfAction {
  const action: CrlfAction | null =
    text === 'set' ? 'text' : text === 'unset' ? 'binary' : text === 'auto' ? 'auto' : null
  if (action === 'binary') return 'binary'
  if (eol === 'lf' || eol === 'crlf') {
    if (action === 'auto') return eol === 'lf' ? 'auto-input' : 'auto-crlf'
    return eol === 'lf' ? 'text-input' : 'text-crlf'
  }
  if (action) return action
  return cfg.autocrlf === 'true' ? 'auto-crlf' : cfg.autocrlf === 'input' ? 'auto-input' : 'binary'
}

function outputIsCrlf(action: CrlfAction, cfg: EolConfig): boolean {
  switch (action) {
    case 'binary': case 'text-input': case 'auto-input': return false
    case 'text-crlf': case 'auto-crlf': return true
    default:
      if (cfg.autocrlf === 'true') return true
      if (cfg.autocrlf === 'input') return false
      if (cfg.eol === 'crlf') return true
      if (cfg.eol === 'lf') return false
      return process.platform === 'win32' // core.eol=native
  }
}

function gatherStats(buf: Buffer): { lonecr: number; lonelf: number; crlf: number; nul: number; printable: number; nonprintable: number } {
  const s = { lonecr: 0, lonelf: 0, crlf: 0, nul: 0, printable: 0, nonprintable: 0 }
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i]
    if (c === 13) {
      if (i + 1 < buf.length && buf[i + 1] === 10) { s.crlf++; i++ } else s.lonecr++
      continue
    }
    if (c === 10) { s.lonelf++; continue }
    if (c === 127) { s.nonprintable++; continue }
    if (c < 32) {
      if (c === 8 || c === 9 || c === 27 || c === 12) s.printable++
      else { if (c === 0) s.nul++; s.nonprintable++ }
    } else s.printable++
  }
  if (buf.length >= 1 && buf[buf.length - 1] === 0o32) s.nonprintable-- // EOF DOS final
  return s
}

/** Contenu tel que `git checkout` l'écrit, pour un blob et ses attributs `text` / `eol`. */
export function toWorktree(blob: Buffer, text: string, eol: string, cfg: EolConfig): Buffer {
  const action = crlfAction(text, eol, cfg)
  if (!outputIsCrlf(action, cfg)) return blob
  const st = gatherStats(blob)
  if (!st.lonelf) return blob
  if (action.startsWith('auto')) {
    if (st.lonecr || st.crlf) return blob
    if (st.nul || (st.printable >> 7) < st.nonprintable) return blob
  }
  const out = Buffer.allocUnsafe(blob.length + st.lonelf)
  let o = 0
  for (let i = 0; i < blob.length; i++) {
    if (blob[i] === 10 && (i === 0 || blob[i - 1] !== 13)) out[o++] = 13
    out[o++] = blob[i]
  }
  return out.subarray(0, o)
}

interface RepoConfig extends EolConfig { recurseSubmodules: boolean }

async function repoConfig(dir: string): Promise<RepoConfig> {
  const r = await runGit(dir, ['config', '-z', '--get-regexp', '^(core\\.(autocrlf|eol)|submodule\\.recurse)$'], { okExitCodes: [1] })
  const cfg: RepoConfig = { autocrlf: 'false', eol: 'native', recurseSubmodules: false }
  for (const item of splitZ(r.stdout)) {
    const nl = item.indexOf('\n')
    const key = nl < 0 ? item : item.slice(0, nl)
    const v = (nl < 0 ? '' : item.slice(nl + 1)).toLowerCase()
    if (key === 'core.autocrlf') cfg.autocrlf = v === 'input' ? 'input' : ['true', 'yes', 'on', '1'].includes(v) ? 'true' : 'false'
    if (key === 'core.eol' && (v === 'lf' || v === 'crlf')) cfg.eol = v
    if (key === 'submodule.recurse') cfg.recurseSubmodules = ['true', 'yes', 'on', '1', ''].includes(v)
  }
  return cfg
}

/** Attributs `check-attr -z` : chemin → attribut → valeur (`set`, `unset`, `unspecified`, valeur). */
function parseCheckAttr(out: Buffer): Map<string, Record<string, string>> {
  const parts = splitZ(out)
  const res = new Map<string, Record<string, string>>()
  for (let i = 0; i + 2 < parts.length; i += 3) {
    const rec = res.get(parts[i]) ?? {}
    rec[parts[i + 1]] = parts[i + 2]
    res.set(parts[i], rec)
  }
  return res
}

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) await fn(items[next++])
  }))
}

async function removeEmptyParents(root: string, file: string): Promise<void> {
  let dir = path.dirname(file)
  while (dir.length > root.length && dir.startsWith(root)) {
    try { await fs.promises.rmdir(dir) } catch { return }
    dir = path.dirname(dir)
  }
}

export function nodeCheckout(dir: string, target: string, opts: NodeCheckoutOptions = {}): Promise<boolean> {
  return withRepoWriteLock(dir, async () => {
    const git = (args: string[], stdin?: string | Buffer) => runGit(dir, args, { stdin })
    const fallback = (reason: string): false => { opts.onFallback?.(reason); return false }
    let t0 = performance.now()
    const step = (name: string): void => { const t = performance.now(); opts.onStep?.(name, t - t0); t0 = t }
    // Chaque lancement de git coûte ~50 à 140 ms sous Windows : résolutions par le `cat-file`
    // persistant, appels indépendants en parallèle (4 vagues de processus au lieu d'une dizaine).
    const branchRef = !opts.detach && !target.startsWith('refs/')
      ? ((await objectInfo(dir, `refs/heads/${target}`)) ? `refs/heads/${target}` : null)
      : (!opts.detach && target.startsWith('refs/heads/') ? target : null)
    const [oldInfo, newInfo] = await Promise.all([
      objectInfo(dir, 'HEAD^{commit}'),
      objectInfo(dir, `${branchRef ?? target}^{commit}`),
    ])
    if (!oldInfo) return fallback('HEAD sans commit')
    if (!newInfo) return fallback(`révision inconnue : ${target}`)
    const oldOid = oldInfo.oid
    step('résolution')
    const newOid = newInfo.oid

    const [diffOut, cfg, statusOut] = await Promise.all([
      git(['diff-tree', '-r', '-z', '--no-renames', oldOid, newOid]),
      repoConfig(dir),
      git(['status', '--porcelain=v2', '-z', '--untracked-files=all']),
    ])
    step('diff-tree, config, statut')
    const all = parseDiffTree(diffOut.stdout)
    // Sous-modules (dépôts antérieurs à #333) : comme `git checkout` sans --recurse-submodules, leur
    // contenu n'est pas touché ; dossier vide créé à l'ajout, retiré s'il est vide à la suppression.
    const GITLINK = '160000'
    const isLink = (m: string): boolean => m === GITLINK
    const swapped = all.find(c => c.status === 'T' && isLink(c.oldMode) !== isLink(c.newMode))
    if (swapped) return fallback(`fichier ↔ sous-module : ${swapped.path}`)
    const links = all.filter(c => isLink(c.oldMode) || isLink(c.newMode))
    const changes = all.filter(c => !isLink(c.oldMode) && !isLink(c.newMode))
    if (links.length && cfg.recurseSubmodules) return fallback(`sous-module avec submodule.recurse : ${links[0].path}`)

    // Chemin simple seulement : aucune modification suivie, aucun fichier non suivi sur un ajout.
    const status = splitZ(statusOut.stdout)
    const tracked = status.find(l => l.startsWith('1 ') || l.startsWith('2 ') || l.startsWith('u '))
    if (tracked) return fallback(`modification locale : ${tracked}`)
    const untracked = new Set(status.filter(l => l.startsWith('? ')).map(l => l.slice(2)))
    const blocked = changes.find(c => c.status === 'A' && untracked.has(c.path))
    if (blocked) return fallback(`fichier non suivi : ${blocked.path}`)

    const writes = changes.filter(c => c.status !== 'D')
    let contents: Buffer[] = []
    if (writes.length) {
      const [attrOut, blobOut] = await Promise.all([
        git(
          ['check-attr', '--stdin', '-z', `--source=${newOid}`, 'text', 'eol', 'filter', 'ident', 'working-tree-encoding'],
          writes.map(c => `${c.path}\0`).join(''),
        ),
        git(['cat-file', '--batch'], writes.map(c => `${c.newOid}\n`).join('')),
      ])
      const attrs = parseCheckAttr(attrOut.stdout)
      // Filtres que Polenta ne reproduit pas : git checkout ordinaire.
      const special = (a?: Record<string, string>): boolean =>
        !a || ['filter', 'ident', 'working-tree-encoding'].some(k => a[k] !== 'unspecified' && a[k] !== 'unset')
      const filtered = writes.find(c => special(attrs.get(c.path)))
      if (filtered) return fallback(`attribut de filtre : ${filtered.path} ${JSON.stringify(attrs.get(filtered.path))}`)
      step('check-attr, blobs')
      const blobs = parseBatch(blobOut.stdout, writes.length)
      contents = writes.map((c, i) => {
        const a = attrs.get(c.path)!
        return toWorktree(blobs[i], a.text, a.eol, cfg)
      })
    }

    step('conversion')
    const abs = (p: string): string => path.join(dir, ...p.split('/'))
    const concurrency = opts.concurrency ?? 32
    await pool(changes.filter(c => c.status === 'D'), concurrency, async c => {
      await fs.promises.rm(abs(c.path), { force: true })
      await removeEmptyParents(dir, abs(c.path))
    })
    await pool(writes.map((c, i) => ({ c, data: contents[i] })), concurrency, async ({ c, data }) => {
      const file = abs(c.path)
      await fs.promises.mkdir(path.dirname(file), { recursive: true })
      await fs.promises.writeFile(file, data)
    })
    for (const c of links) {
      if (c.status === 'A') await fs.promises.mkdir(abs(c.path), { recursive: true })
      if (c.status === 'D') {
        try { await fs.promises.rmdir(abs(c.path)) } catch { continue } // sous-module peuplé : gardé, comme git
        await removeEmptyParents(dir, abs(c.path))
      }
    }

    step('écriture disque')
    await runGit(dir, ['read-tree', '--reset', newOid])
    step('read-tree')
    await Promise.all([
      runGit(dir, ['update-index', '-q', '--refresh'], { okExitCodes: [1] }),
      branchRef
        ? runGit(dir, ['symbolic-ref', '-m', `checkout: moving to ${target}`, 'HEAD', branchRef])
        : runGit(dir, ['update-ref', '--no-deref', '-m', `checkout: moving to ${target}`, 'HEAD', newOid]),
    ])
    step('refresh, HEAD')
    return true
  })
}
