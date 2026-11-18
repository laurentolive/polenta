/**
 * GH337 — mesures du spike (spec §8, design §10) : isomorphic-git contre git natif embarqué, sur
 * une COPIE des dépôts donnés (jamais les originaux : le checkout aller-retour les modifie).
 *
 *   tsx scripts/bench-git.ts <dépôt> [<dépôt>…]   [--only native|iso] [--runs 3]
 *
 * Après le sprint 4 (isomorphic-git supprimé), seul `--only native` reste utilisable.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { objectData, objectInfo } from '../src/main/git/cat-file-batch'
import { gitText, runGit, splitZ } from '../src/main/git/git-runner'
import { closeAll } from '../src/main/git/process-registry'
import { gitFor } from '../src/main/git/git-backend'
import { nodeCheckout } from '../src/main/git/node-checkout'

type Op = { name: string; iso?: (dir: string) => Promise<unknown>; native: (dir: string) => Promise<unknown>; runs?: number }

async function loadIso(): Promise<typeof import('isomorphic-git') | null> {
  try { return (await import('isomorphic-git')).default as unknown as typeof import('isomorphic-git') } catch { return null }
}

/** Copie du seul `.git` (pas de node_modules ni de fichiers locaux), puis working directory reconstruit. */
async function copyRepo(src: string, pair?: [string, string]): Promise<string> {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'polenta-bench-'))
  fs.cpSync(path.join(src, '.git'), path.join(dest, '.git'), { recursive: true })
  // Sous-modules jamais parcourus : même travail pour tous les moteurs (Polenta n'en a plus, #333).
  await runGit(dest, ['config', '--unset-all', 'submodule.recurse'], { write: true, okExitCodes: [5] })
  await runGit(dest, ['reset', '--hard', '-q'], { write: true })
  if (pair) {
    // Checkout entre deux révisions choisies : branches bench-a / bench-b.
    const [a, b] = await Promise.all(pair.map(r => gitText(dest, ['rev-parse', '--verify', `${r}^{commit}`]).then(s => s.trim())))
    await runGit(dest, ['branch', '-f', 'bench-b', b], { write: true })
    await runGit(dest, ['checkout', '-q', '-B', 'bench-a', a], { write: true })
    pairs.add(dest)
  }
  return dest
}

/** --trace : durées des étapes de nodeCheckout, par copie et par étape. */
const stepTotals = new Map<string, number[]>()

/** Copies créées avec `--pair` : le checkout alterne entre bench-a et bench-b. */
const pairs = new Set<string>()

async function otherBranch(dir: string): Promise<string | null> {
  const cur = (await gitText(dir, ['symbolic-ref', '--short', 'HEAD'])).trim()
  if (pairs.has(dir)) return cur === 'bench-a' ? 'bench-b' : 'bench-a'
  const heads = (await gitText(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])).split('\n').filter(Boolean)
  return heads.find(h => h !== cur) ?? null
}

function opsFor(iso: typeof import('isomorphic-git') | null): Op[] {
  return [
    {
      name: '200 × resolve HEAD',
      iso: iso ? async dir => { for (let i = 0; i < 200; i++) await iso.resolveRef({ fs, dir, ref: 'HEAD' }) } : undefined,
      native: async dir => { for (let i = 0; i < 200; i++) await objectInfo(dir, 'HEAD') },
    },
    {
      name: 'lire tous les fichiers à HEAD',
      iso: iso ? async dir => {
        const files = await iso.listFiles({ fs, dir, ref: 'HEAD' })
        const oid = await iso.resolveRef({ fs, dir, ref: 'HEAD' })
        for (const filepath of files) await iso.readBlob({ fs, dir, oid, filepath })
      } : undefined,
      native: async dir => {
        const entries = splitZ((await runGit(dir, ['ls-tree', '-r', '-z', 'HEAD'])).stdout)
        for (const e of entries) {
          const tab = e.indexOf('\t')
          const [, type, oid] = e.slice(0, tab).split(' ')
          if (type === 'blob') await objectData(dir, oid)
        }
      },
    },
    {
      name: 'statut, arbre propre',
      iso: iso ? dir => iso.statusMatrix({ fs, dir }) : undefined,
      native: dir => runGit(dir, ['status', '--porcelain=v2', '-z', '--untracked-files=all']),
    },
    {
      name: 'historique par fichier',
      iso: undefined, // 451 s mesurés sur polenta-official (commentaire de l'issue) : non relancé
      native: dir => gitFor(dir).log('HEAD', { changes: true }),
    },
    {
      name: 'checkout aller-retour',
      iso: iso ? async dir => {
        const other = await otherBranch(dir)
        if (!other) return
        const cur = await iso.currentBranch({ fs, dir }) as string
        await iso.checkout({ fs, dir, ref: other })
        await iso.checkout({ fs, dir, ref: cur })
      } : undefined,
      native: async dir => {
        const other = await otherBranch(dir)
        if (!other) return
        const cur = (await gitText(dir, ['symbolic-ref', '--short', 'HEAD'])).trim()
        await runGit(dir, ['checkout', '-q', other], { write: true })
        await runGit(dir, ['checkout', '-q', cur], { write: true })
      },
    },
    {
      // Essai GH337 : git calcule, Polenta écrit les fichiers (node-checkout.ts).
      name: 'checkout aller-retour, écriture Polenta',
      native: async dir => {
        const other = await otherBranch(dir)
        if (!other) return
        const cur = (await gitText(dir, ['symbolic-ref', '--short', 'HEAD'])).trim()
        const onFallback = (r: string): never => { throw new Error(`nodeCheckout : ${r}`) }
        // --verify : statut vide après chaque checkout (contrôle hors mesure, sur les vrais dépôts).
        const check = async (rev: string): Promise<void> => {
          if (!process.argv.includes('--verify')) return
          const st = await gitText(dir, ['status', '--porcelain', '--untracked-files=all'])
          if (st.trim()) throw new Error(`statut non vide après nodeCheckout ${rev} :\n${st.slice(0, 2000)}`)
        }
        const onStep = process.argv.includes('--trace')
          ? (s: string, ms: number): void => { const k = `${path.basename(dir)} ${s}`; stepTotals.set(k, [...(stepTotals.get(k) ?? []), ms]) }
          : undefined
        await nodeCheckout(dir, other, { onFallback, onStep })
        await check(other)
        await nodeCheckout(dir, cur, { onFallback, onStep })
        await check(cur)
      },
    },
  ]
}

async function time(fn: () => Promise<unknown>, runs: number): Promise<number> {
  const t: number[] = []
  for (let i = 0; i < runs; i++) {
    const s = performance.now()
    await fn()
    t.push(performance.now() - s)
  }
  t.sort((a, b) => a - b)
  return t[Math.floor(t.length / 2)]
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null
  const runs = args.includes('--runs') ? Number(args[args.indexOf('--runs') + 1]) : 3
  // --ops <texte> : seulement les opérations dont le nom contient ce texte (ex. « checkout »).
  const opsFilter = args.includes('--ops') ? args[args.indexOf('--ops') + 1] : null
  // --pair <rev1>..<rev2> : une par dépôt, dans l'ordre (« - » : première autre branche locale).
  const pairArgs = args.flatMap((a, i) => (a === '--pair' ? [args[i + 1]] : []))
  const repos = args.filter((a, i) => !a.startsWith('--') && !['--only', '--runs', '--ops', '--pair'].includes(args[i - 1] ?? ''))
  const iso = only === 'native' ? null : await loadIso()
  const ops = opsFor(iso).filter(op => !opsFilter || op.name.includes(opsFilter))
  console.log(`| Opération | ${repos.map(r => `${path.basename(r)} iso / natif`).join(' | ')} |`)
  console.log(`|---|${repos.map(() => '---').join('|')}|`)
  const copies = await Promise.all(repos.map((r, i) => {
    const p = pairArgs[i]
    return copyRepo(r, p && p !== '-' ? (p.split('..') as [string, string]) : undefined)
  }))
  const rows: string[][] = ops.map(op => [op.name])
  for (let r = 0; r < copies.length; r++) {
    // Chauffe : cache disque, premier lancement de git.
    await runGit(copies[r], ['status', '--porcelain=v2'])
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i]
      const n = op.runs ?? runs
      const isoMs = op.iso && only !== 'native' ? await time(() => op.iso!(copies[r]), n) : null
      const natMs = only !== 'iso' ? await time(() => op.native(copies[r]), n) : null
      const fmt = (v: number | null) => (v === null ? '—' : `${Math.round(v)} ms`)
      rows[i].push(`${fmt(isoMs)} / ${fmt(natMs)}`)
    }
  }
  for (const row of rows) console.log(`| ${row.join(' | ')} |`)
  for (const [k, v] of stepTotals) {
    const sorted = [...v].sort((a, b) => a - b)
    console.log(`| étape ${k} | médiane ${Math.round(sorted[Math.floor(sorted.length / 2)])} ms par checkout (${v.length} mesures) |`)
  }
  await closeAll()
  for (const c of copies) removeCopy(c)
}

/** Les objets git sont en lecture seule : sous Windows, `rmSync` échoue (EPERM) sans chmod. */
function removeCopy(dir: string): void {
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else fs.chmodSync(p, 0o666)
    }
  }
  try { walk(dir) } catch { /* best effort */ }
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
}

main().catch(err => { console.error(err); process.exit(1) })
