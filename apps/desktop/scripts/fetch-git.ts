/**
 * GH337 — `pnpm git:fetch` : installe le Git for Windows portable embarqué dans `vendor/git`
 * (spec §4.7, design §8). Version et SHA-256 fixés dans `scripts/git-version.json` ; élagage selon
 * `scripts/git-prune.txt`. Idempotent (marqueur `vendor/git/.polenta-git-version`).
 *
 * Windows uniquement : ailleurs (Docker, CI Linux) Polenta utilise le git du système.
 *   tsx scripts/fetch-git.ts [--force] [--no-prune]
 */
import { createHash } from 'crypto'
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const root = path.resolve(__dirname, '..')
const dest = path.join(root, 'vendor', 'git')
const marker = path.join(dest, '.polenta-git-version')
const spec = JSON.parse(fs.readFileSync(path.join(__dirname, 'git-version.json'), 'utf8')) as {
  version: string; url: string; sha256: string
}

async function download(url: string, file: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`Téléchargement ${url} : HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(file, buf)
}

function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

/** Supprime les chemins listés (relatifs à `dir`, motifs `*` en fin de segment autorisés). */
export function prune(dir: string, patterns: string[]): number {
  let removed = 0
  for (const raw of patterns) {
    const pattern = raw.trim()
    if (!pattern || pattern.startsWith('#')) continue
    const parts = pattern.split('/')
    const base = path.join(dir, ...parts.slice(0, -1))
    const last = parts[parts.length - 1]
    if (!fs.existsSync(base)) continue
    const re = new RegExp('^' + last.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i')
    for (const name of fs.readdirSync(base)) {
      if (!re.test(name)) continue
      fs.rmSync(path.join(base, name), { recursive: true, force: true })
      removed++
    }
  }
  return removed
}

function dirSize(dir: string): number {
  let total = 0
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    total += e.isDirectory() ? dirSize(p) : fs.statSync(p).size
  }
  return total
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force')
  const noPrune = process.argv.includes('--no-prune')
  if (process.platform !== 'win32') {
    console.log('[git:fetch] hors Windows : le git du système est utilisé, rien à installer.')
    return
  }
  if (!force && fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === spec.version) {
    console.log(`[git:fetch] Git ${spec.version} déjà installé dans ${dest}`)
    return
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'polenta-git-'))
  const archive = path.join(tmp, path.basename(new URL(spec.url).pathname))
  console.log(`[git:fetch] téléchargement de ${spec.url}`)
  await download(spec.url, archive)
  const hash = sha256(archive)
  if (hash !== spec.sha256) throw new Error(`SHA-256 inattendu pour ${archive} : ${hash} (attendu ${spec.sha256})`)
  fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(dest, { recursive: true })
  // Archive 7-Zip auto-extractible : `-y` sans question, `-o<dossier>`.
  execFileSync(archive, ['-y', `-o${dest}`], { stdio: 'inherit', windowsHide: true })
  const before = dirSize(dest)
  if (!noPrune) {
    const patterns = fs.readFileSync(path.join(__dirname, 'git-prune.txt'), 'utf8').split(/\r?\n/)
    const n = prune(dest, patterns)
    console.log(`[git:fetch] élagage : ${n} entrées supprimées`)
  }
  for (const exe of [['cmd', 'git.exe'], ['bin', 'bash.exe'], ['usr', 'bin', 'ssh.exe']]) {
    if (!fs.existsSync(path.join(dest, ...exe))) throw new Error(`Élagage trop large : ${exe.join('/')} absent`)
  }
  const version = execFileSync(path.join(dest, 'cmd', 'git.exe'), ['version'], { encoding: 'utf8', windowsHide: true }).trim()
  fs.writeFileSync(marker, spec.version + '\n')
  fs.rmSync(tmp, { recursive: true, force: true })
  const mb = (n: number) => (n / 1024 / 1024).toFixed(1)
  console.log(`[git:fetch] ${version} — ${mb(before)} Mo extraits, ${mb(dirSize(dest))} Mo après élagage → ${dest}`)
}

if (require.main === module) {
  main().catch(err => {
    console.error(`[git:fetch] ${(err as Error).message}`)
    process.exit(1)
  })
}
