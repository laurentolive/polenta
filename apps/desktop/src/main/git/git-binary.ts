import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

/**
 * GH337 — résolution du binaire git embarqué (spec §4.7, design §2.1).
 *
 * Ordre : `POLENTA_GIT_DIR` → `resources/git` (app packagée) → `vendor/git` (dev, tests ; rempli par
 * `pnpm git:fetch`) → hors Windows seulement, le `git` du PATH (Docker, CI Linux). Sous Windows il
 * n'y a jamais de repli sur le git du poste : les postes clients n'en ont pas, et celui d'un
 * développeur aurait une autre configuration.
 */

export const MIN_GIT_VERSION: readonly [number, number] = [2, 38]

export interface GitInstall {
  /** Racine de l'installation (format PortableGit sous Windows), `null` pour le git du PATH. */
  gitDir: string | null
  gitExe: string
  /** Git Bash embarqué (terminal GH238) ; `null` hors installation embarquée Windows. */
  bashExe: string | null
  /** Dossiers à placer en tête du PATH des processus git (ssh, sh, coreutils). */
  pathDirs: string[]
  version: string
}

export class GitUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitUnavailableError'
  }
}

interface ResolveDeps {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  resourcesPath: string | undefined
  /** Dossiers de départ de la recherche de `vendor/git` (dev). */
  searchFrom: string[]
  exists: (p: string) => boolean
  readVersion: (gitExe: string) => string
}

function layout(dir: string, platform: NodeJS.Platform, exists: (p: string) => boolean): { gitExe: string; bashExe: string | null; pathDirs: string[] } {
  if (platform === 'win32') {
    // Exécutable réel plutôt que le lanceur cmd/git.exe (~70 ms de plus par appel, mesuré au spike) ;
    // le PATH fourni par gitEnv (ucrt64/bin, usr/bin) remplace ce que le lanceur préparait.
    const native = ['ucrt64', 'mingw64'].map(d => path.join(dir, d, 'bin', 'git.exe'))
    return {
      gitExe: native.find(exists) ?? path.join(dir, 'cmd', 'git.exe'),
      bashExe: path.join(dir, 'bin', 'bash.exe'),
      pathDirs: [path.join(dir, 'cmd'), path.join(dir, 'ucrt64', 'bin'), path.join(dir, 'mingw64', 'bin'), path.join(dir, 'usr', 'bin')],
    }
  }
  return { gitExe: path.join(dir, 'bin', 'git'), bashExe: null, pathDirs: [path.join(dir, 'bin')] }
}

/** Candidats `vendor/git` : on remonte depuis chaque point de départ (out/main, src/main/git…). */
function vendorCandidates(from: string[]): string[] {
  const out: string[] = []
  for (const start of from) {
    let dir = start
    for (let i = 0; i < 6; i++) {
      out.push(path.join(dir, 'vendor', 'git'), path.join(dir, 'apps', 'desktop', 'vendor', 'git'))
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  return out
}

export function parseGitVersion(output: string): string {
  const m = /git version (\d+\.\d+(?:\.\d+)?)/.exec(output)
  if (!m) throw new GitUnavailableError(`Version de git illisible : ${output.trim()}`)
  return m[1]
}

export function isSupportedVersion(version: string): boolean {
  const [maj, min] = version.split('.').map(Number)
  return maj > MIN_GIT_VERSION[0] || (maj === MIN_GIT_VERSION[0] && min >= MIN_GIT_VERSION[1])
}

export function resolveGitInstall(deps: ResolveDeps): GitInstall {
  const { platform, env, exists } = deps
  const candidates: { dir: string | null; explicit: boolean }[] = []
  if (env.POLENTA_GIT_DIR) candidates.push({ dir: env.POLENTA_GIT_DIR, explicit: true })
  if (deps.resourcesPath) candidates.push({ dir: path.join(deps.resourcesPath, 'git'), explicit: false })
  for (const c of vendorCandidates(deps.searchFrom)) candidates.push({ dir: c, explicit: false })

  let found: { gitDir: string | null; gitExe: string; bashExe: string | null; pathDirs: string[] } | null = null
  for (const c of candidates) {
    const l = layout(c.dir!, platform, exists)
    if (exists(l.gitExe)) {
      found = { gitDir: c.dir, ...l, bashExe: l.bashExe && exists(l.bashExe) ? l.bashExe : null }
      break
    }
    if (c.explicit) throw new GitUnavailableError(`POLENTA_GIT_DIR=${c.dir} ne contient pas ${l.gitExe}.`)
  }
  if (!found) {
    if (platform === 'win32') {
      throw new GitUnavailableError(
        'Git embarqué introuvable (resources/git). En développement : lancer `pnpm git:fetch` dans apps/desktop.',
      )
    }
    found = { gitDir: null, gitExe: 'git', bashExe: null, pathDirs: [] }
  }

  let version: string
  try {
    version = parseGitVersion(deps.readVersion(found.gitExe))
  } catch (err) {
    if (err instanceof GitUnavailableError) throw err
    throw new GitUnavailableError(`git introuvable ou inutilisable (${found.gitExe}) : ${(err as Error).message}`)
  }
  if (!isSupportedVersion(version)) {
    throw new GitUnavailableError(`git ≥ ${MIN_GIT_VERSION.join('.')} requis, trouvé ${version} (${found.gitExe}).`)
  }
  return { ...found, version }
}

let cached: GitInstall | null = null
let cachedError: GitUnavailableError | null = null

/** Installation git du processus, résolue une fois. Lève `GitUnavailableError` à chaque appel si absente. */
export function gitInstall(): GitInstall {
  if (cached) return cached
  if (cachedError) throw cachedError
  try {
    cached = resolveGitInstall({
      platform: process.platform,
      env: process.env,
      resourcesPath: typeof process.resourcesPath === 'string' ? process.resourcesPath : undefined,
      searchFrom: [__dirname, process.cwd()],
      exists: p => fs.existsSync(p),
      readVersion: exe => execFileSync(exe, ['version'], {
        encoding: 'utf8', windowsHide: true, timeout: 15_000,
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull() },
      }),
    })
    return cached
  } catch (err) {
    cachedError = err instanceof GitUnavailableError ? err : new GitUnavailableError(String(err))
    console.error(`[git] ${cachedError.message}`)
    throw cachedError
  }
}

/** Tests uniquement : oublie l'installation résolue. */
export function resetGitInstallForTests(): void {
  cached = null
  cachedError = null
}

export function devNull(): string {
  return process.platform === 'win32' ? 'NUL' : '/dev/null'
}
