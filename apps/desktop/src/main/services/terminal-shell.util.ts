import * as path from 'path'

/**
 * GH238 — shell du terminal de la vue Version : Git Bash de l'installation Git for Windows du
 * poste (rien d'embarqué), `$SHELL` ailleurs. Logique pure, le disque et l'environnement sont
 * injectés pour être testés par vitest.
 */

export interface ShellSpec {
  name: string
  file: string
  args: string[]
}

export interface ShellProbe {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  exists(p: string): boolean
}

/** Variable d'environnement sans tenir compte de la casse (Windows : `Path`, `ProgramFiles`…). */
function envVar(env: Record<string, string | undefined>, name: string): string | undefined {
  const key = Object.keys(env).find(k => k.toUpperCase() === name.toUpperCase())
  return key ? env[key] : undefined
}

/** Racines Git for Windows candidates : dossiers du PATH contenant `git.exe` (`cmd`, `bin` ou
 *  `mingw64\bin`), puis emplacements standards — toujours consultés, car le PATH du processus ne
 *  voit pas une installation faite pendant que Polenta tourne. */
function gitRoots(p: ShellProbe): string[] {
  const w = path.win32
  const roots: string[] = []
  for (const dir of (envVar(p.env, 'PATH') ?? '').split(';').filter(Boolean)) {
    if (!p.exists(w.join(dir, 'git.exe'))) continue
    const base = w.basename(dir).toLowerCase()
    const parent = w.dirname(dir)
    if (base === 'bin' && w.basename(parent).toLowerCase() === 'mingw64') roots.push(w.dirname(parent))
    else if (base === 'cmd' || base === 'bin') roots.push(parent)
  }
  for (const v of ['ProgramFiles', 'ProgramW6432']) {
    const dir = envVar(p.env, v)
    if (dir) roots.push(w.join(dir, 'Git'))
  }
  const local = envVar(p.env, 'LOCALAPPDATA')
  if (local) roots.push(w.join(local, 'Programs', 'Git'))
  return roots
}

/** Shell à lancer, ou `null` si Git Bash est introuvable (Windows seulement). */
export function resolveShell(p: ShellProbe): ShellSpec | null {
  if (p.platform === 'win32') {
    for (const root of gitRoots(p)) {
      const bash = path.win32.join(root, 'bin', 'bash.exe')
      if (p.exists(bash)) return { name: 'Git Bash', file: bash, args: ['--login', '-i'] }
    }
    return null
  }
  const shell = p.env['SHELL'] || '/bin/bash'
  return { name: path.posix.basename(shell), file: shell, args: ['-l'] }
}

/** Environnement du shell : celui de l'utilisateur, sans les variables d'Electron / de Polenta
 *  (`ELECTRON_RUN_AS_NODE` ferait d'un `electron` lancé depuis le terminal un simple Node). */
export function shellEnv(env: Record<string, string | undefined>, platform: NodeJS.Platform): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || /^(ELECTRON_|POLENTA_)/i.test(k)) continue
    out[k] = v
  }
  out['TERM'] = 'xterm-256color'
  out['COLORTERM'] = 'truecolor'
  // Sans elle, le /etc/profile de Git Bash fait `cd ~` et ignore le dossier de départ.
  if (platform === 'win32') out['CHERE_INVOKING'] = '1'
  return out
}

/** Ligne tapée par « Aller au repo sélectionné » ; chemin Windows au format MSYS (`/c/…`). */
export function cdCommand(repoPath: string, platform: NodeJS.Platform): string {
  let p = repoPath
  if (platform === 'win32') {
    p = p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`)
  }
  return `cd '${p.replace(/'/g, `'\\''`)}'\r`
}
