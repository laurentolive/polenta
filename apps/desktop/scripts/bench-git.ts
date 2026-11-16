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

type Op = { name: string; iso?: (dir: string) => Promise<unknown>; native: (dir: string) => Promise<unknown>; runs?: number }

async function loadIso(): Promise<typeof import('isomorphic-git') | null> {
  try { return (await import('isomorphic-git')).default as unknown as typeof import('isomorphic-git') } catch { return null }
}

/** Copie du seul `.git` (pas de node_modules ni de fichiers locaux), puis working directory reconstruit. */
async function copyRepo(src: string): Promise<string> {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'polenta-bench-'))
  fs.cpSync(path.join(src, '.git'), path.join(dest, '.git'), { recursive: true })
  await runGit(dest, ['reset', '--hard', '-q'], { write: true })
  return dest
}

async function otherBranch(dir: string): Promise<string | null> {
  const cur = (await gitText(dir, ['symbolic-ref', '--short', 'HEAD'])).trim()
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
  const repos = args.filter((a, i) => !a.startsWith('--') && !['--only', '--runs'].includes(args[i - 1] ?? ''))
  const iso = only === 'native' ? null : await loadIso()
  const ops = opsFor(iso)
  console.log(`| Opération | ${repos.map(r => `${path.basename(r)} iso / natif`).join(' | ')} |`)
  console.log(`|---|${repos.map(() => '---').join('|')}|`)
  const copies = await Promise.all(repos.map(copyRepo))
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
  await closeAll()
  for (const c of copies) fs.rmSync(c, { recursive: true, force: true })
}

main().catch(err => { console.error(err); process.exit(1) })
