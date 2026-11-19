import * as fs from 'fs'
import * as path from 'path'

import { objectData, objectInfo } from './cat-file-batch'
import { runGit, splitZ, withRepoWriteLock } from './git-runner'

/**
 * GH337 — checkout dont les fichiers sont écrits par Polenta (processus épargné par l'analyse de
 * Windows Defender), pas par git.exe (GH337-sprint0.md § Emplacement de git.exe).
 *
 * Ce qui change se calcule en lisant les arbres par le `cat-file` persistant (sprint 4 : plus de
 * `diff-tree`) ; les blobs viennent du même processus. git ne sert plus qu'à ce qui exige son code :
 * statut, attributs (`check-attr`), config, et l'index (`update-index --index-info`, seulement les
 * entrées qui changent, sans `read-tree` ni `--refresh`) avec HEAD. Polenta applique la règle de fin de
 * ligne de git (attributs de la cible, `core.autocrlf`, `core.eol`), écrit et supprime les fichiers.
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

const TREE_MODE = '40000'
const GITLINK = '160000'
const ZERO_OID = '0'.repeat(40)

interface TreeEntry { mode: string; oid: string }

/** Entrées d'un objet arbre : `<mode> <nom>\0` suivi de l'oid binaire (20 octets). */
function parseTree(buf: Buffer): Map<string, TreeEntry> {
  const entries = new Map<string, TreeEntry>()
  let pos = 0
  while (pos < buf.length) {
    const sp = buf.indexOf(0x20, pos)
    const nul = buf.indexOf(0, sp + 1)
    entries.set(buf.toString('utf8', sp + 1, nul), {
      mode: buf.toString('ascii', pos, sp),
      oid: buf.toString('hex', nul + 1, nul + 21),
    })
    pos = nul + 21
  }
  return entries
}

async function treeEntries(dir: string, oid: string): Promise<Map<string, TreeEntry>> {
  const obj = await objectData(dir, oid)
  if (!obj || obj.type !== 'tree') throw new Error(`arbre illisible : ${oid}`)
  return parseTree(obj.data)
}

/** Nature d'une entrée : un changement de nature (fichier, lien symbolique, sous-module) est un `T`. */
function kindOf(mode: string): string {
  return mode === GITLINK ? 'link' : mode === '120000' ? 'symlink' : 'file'
}

/**
 * Différence de deux arbres, comme `git diff-tree -r --no-renames` (statuts A, D, M, T), lue par le
 * `cat-file` persistant : seuls les sous-arbres dont l'oid change sont ouverts. Pas de processus git.
 */
async function diffTrees(dir: string, a: string | null, b: string | null, prefix: string, out: Change[]): Promise<void> {
  if (a === b) return
  const ea = a ? await treeEntries(dir, a) : new Map<string, TreeEntry>()
  const eb = b ? await treeEntries(dir, b) : new Map<string, TreeEntry>()
  for (const name of new Set([...ea.keys(), ...eb.keys()])) {
    const x = ea.get(name)
    const y = eb.get(name)
    if (x && y && x.mode === y.mode && x.oid === y.oid) continue
    const p = prefix + name
    const xDir = x?.mode === TREE_MODE
    const yDir = y?.mode === TREE_MODE
    if (x && y && !xDir && !yDir) {
      out.push({ oldMode: x.mode, newMode: y.mode, newOid: y.oid, status: kindOf(x.mode) === kindOf(y.mode) ? 'M' : 'T', path: p })
      continue
    }
    if (x && !xDir) out.push({ oldMode: x.mode, newMode: '000000', newOid: ZERO_OID, status: 'D', path: p })
    if (y && !yDir) out.push({ oldMode: '000000', newMode: y.mode, newOid: y.oid, status: 'A', path: p })
    await diffTrees(dir, x && xDir ? x.oid : null, y && yDir ? y.oid : null, `${p}/`, out)
  }
}

/** Contenus des blobs à écrire, lus par le `cat-file` persistant ; `null` si un blob est illisible. */
async function readBlobs(dir: string, writes: Change[]): Promise<Buffer[] | null> {
  const objs = await Promise.all(writes.map(c => objectData(dir, c.newOid).catch(() => null)))
  if (objs.some(o => !o || o.type !== 'blob')) return null
  return objs.map(o => o!.data)
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

/** Fichiers (chemins `/`, relatifs à `root`) sous le dossier `rel`. */
async function filesUnder(root: string, rel: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (r: string): Promise<void> => {
    for (const e of await fs.promises.readdir(path.join(root, ...r.split('/')), { withFileTypes: true })) {
      const child = `${r}/${e.name}`
      if (e.isDirectory()) await walk(child)
      else out.push(child)
    }
  }
  await walk(rel)
  return out
}

/** Premier chemin à écrire qui heurterait un dossier ou un fichier restant sur le disque, ou `null`. */
async function findDirFileConflict(root: string, writes: string[], deleted: Set<string>): Promise<string | null> {
  const stat = (rel: string): Promise<fs.Stats | null> =>
    fs.promises.lstat(path.join(root, ...rel.split('/'))).catch(() => null)
  const checkedParents = new Set<string>()
  for (const p of writes) {
    const st = await stat(p)
    if (st?.isDirectory() && (await filesUnder(root, p)).some(f => !deleted.has(f))) return p
    const parts = p.split('/')
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('/')
      if (checkedParents.has(parent)) continue
      checkedParents.add(parent)
      const ps = await stat(parent)
      if (ps && !ps.isDirectory() && !deleted.has(parent)) return p
    }
  }
  return null
}

async function removeEmptyParents(root: string, file: string): Promise<void> {
  let dir = path.dirname(file)
  while (dir.length > root.length && dir.startsWith(root)) {
    try { await fs.promises.rmdir(dir) } catch { return }
    dir = path.dirname(dir)
  }
}

/**
 * GH337 P10 — chemin de l'arbre sûr pour une écriture dans le dépôt (mêmes refus que `verify_path` de git) :
 * vide, absolu, avec `\` ou `:` (préfixe de lecteur, flux NTFS), NUL, ou un composant vide, `.`, `..` ou
 * `.git` (insensible à la casse).
 */
export function isSafeTreePath(p: string): boolean {
  if (p === '' || p.startsWith('/') || /[\\:\0]/.test(p)) return false
  return p.split('/').every(seg => seg !== '' && seg !== '.' && seg !== '..' && seg.toLowerCase() !== '.git')
}

export function nodeCheckout(dir: string, target: string, opts: NodeCheckoutOptions = {}): Promise<boolean> {
  return withRepoWriteLock(dir, async () => {
    const git = (args: string[], stdin?: string | Buffer) => runGit(dir, args, { stdin })
    const fallback = (reason: string): false => { opts.onFallback?.(reason); return false }
    let t0 = performance.now()
    const step = (name: string): void => { const t = performance.now(); opts.onStep?.(name, t - t0); t0 = t }
    // Chaque lancement de git coûte ~50 à 140 ms sous Windows : résolutions, arbres et blobs par le
    // `cat-file` persistant ; deux vagues de processus git (lecture, puis index et HEAD).
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

    const [oldTree, newTree] = await Promise.all([
      objectInfo(dir, `${oldOid}^{tree}`),
      objectInfo(dir, `${newOid}^{tree}`),
    ])
    if (!oldTree || !newTree) return fallback('arbre introuvable')
    const all: Change[] = []
    try {
      await diffTrees(dir, oldTree.oid, newTree.oid, '', all)
    } catch (e) {
      return fallback(`arbre illisible : ${(e as Error).message}`)
    }
    step('diff des arbres')
    // Sous-modules (dépôts antérieurs à #333) : comme `git checkout` sans --recurse-submodules, leur
    // contenu n'est pas touché ; dossier vide créé à l'ajout, retiré s'il est vide à la suppression.
    const isLink = (m: string): boolean => m === GITLINK
    const swapped = all.find(c => c.status === 'T' && isLink(c.oldMode) !== isLink(c.newMode))
    if (swapped) return fallback(`fichier ↔ sous-module : ${swapped.path}`)
    const links = all.filter(c => isLink(c.oldMode) || isLink(c.newMode))
    const changes = all.filter(c => !isLink(c.oldMode) && !isLink(c.newMode))
    // GH337 P10 — chemin de l'arbre non sûr (`..`, `.git`, `\`, préfixe de lecteur…) : rien n'est écrit ici ;
    // `git checkout`, qui refuse ces chemins, prend la suite.
    const unsafe = [...changes, ...links].find(c => !isSafeTreePath(c.path))
    if (unsafe) return fallback(`chemin non sûr dans l'arbre : ${JSON.stringify(unsafe.path)}`)
    const writes = changes.filter(c => c.status !== 'D')

    // Un seul lot de processus git, en parallèle : statut, config, attributs de la cible (`check-attr`).
    // Les blobs viennent du `cat-file` persistant.
    const [statusOut, cfg, attrOut, blobs] = await Promise.all([
      git(['status', '--porcelain=v2', '-z', '--untracked-files=all']),
      repoConfig(dir),
      writes.length
        ? git(
          ['check-attr', '--stdin', '-z', `--source=${newOid}`, 'text', 'eol', 'filter', 'ident', 'working-tree-encoding'],
          writes.map(c => `${c.path}\0`).join(''),
        )
        : null,
      readBlobs(dir, writes),
    ])
    step('statut, config, attributs, blobs')
    if (!blobs) return fallback('blob illisible')
    if (links.length && cfg.recurseSubmodules) return fallback(`sous-module avec submodule.recurse : ${links[0].path}`)

    // Chemin simple seulement : aucune modification suivie, aucun fichier non suivi sur un ajout.
    const status = splitZ(statusOut.stdout)
    const tracked = status.find(l => l.startsWith('1 ') || l.startsWith('2 ') || l.startsWith('u '))
    if (tracked) return fallback(`modification locale : ${tracked}`)
    const untracked = new Set(status.filter(l => l.startsWith('? ')).map(l => l.slice(2)))
    const blocked = changes.find(c => c.status === 'A' && untracked.has(c.path))
    if (blocked) return fallback(`fichier non suivi : ${blocked.path}`)

    // Conflits dossier / fichier, vérifiés avant de toucher au disque (rien n'est annulable ensuite) :
    // un fichier à écrire là où resterait un dossier (fichiers ignorés ou non suivis), ou sous un
    // « dossier » qui est un fichier non supprimé. git checkout les traite (ou refuse proprement).
    const deleted = new Set(changes.filter(c => c.status === 'D').map(c => c.path))
    const dfConflict = await findDirFileConflict(dir, writes.map(c => c.path), deleted)
    if (dfConflict) return fallback(`conflit dossier / fichier : ${dfConflict}`)
    let contents: Buffer[] = []
    if (writes.length) {
      const attrs = parseCheckAttr(attrOut?.stdout ?? Buffer.alloc(0))
      // Filtres que Polenta ne reproduit pas : git checkout ordinaire.
      const special = (a?: Record<string, string>): boolean =>
        !a || ['filter', 'ident', 'working-tree-encoding'].some(k => a[k] !== 'unspecified' && a[k] !== 'unset')
      const filtered = writes.find(c => special(attrs.get(c.path)))
      if (filtered) return fallback(`attribut de filtre : ${filtered.path} ${JSON.stringify(attrs.get(filtered.path))}`)
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
    // Index : seules les entrées qui changent, suppressions d'abord (un fichier remplacé par un dossier
    // ou l'inverse). Leurs stats restent à zéro : `git status` les compare au contenu au besoin.
    const indexInfo = [
      ...all.filter(c => c.status === 'D').map(c => `0 ${ZERO_OID}\t${c.path}\0`),
      ...all.filter(c => c.status !== 'D').map(c => `${c.newMode} ${c.newOid}\t${c.path}\0`),
    ].join('')
    await Promise.all([
      runGit(dir, ['update-index', '-z', '--index-info'], { stdin: indexInfo }),
      branchRef
        ? runGit(dir, ['symbolic-ref', '-m', `checkout: moving to ${target}`, 'HEAD', branchRef])
        : runGit(dir, ['update-ref', '--no-deref', '-m', `checkout: moving to ${target}`, 'HEAD', newOid]),
    ])
    step('index, HEAD')
    return true
  })
}
