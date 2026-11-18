import * as path from 'path'

/**
 * GH238 / GH337 — shell du terminal de la vue Version. Sous Windows, c'est le Git Bash embarqué
 * (`<gitDir>/bin/bash.exe`, design §7) : pas de shell du PC, dont la configuration et la version de
 * git varieraient d'un poste à l'autre. Hors Windows, `$SHELL`. Logique pure, le disque et
 * l'environnement sont injectés pour être testés par vitest.
 */

export interface ShellSpec {
  name: string
  file: string
  args: string[]
}

export interface ShellProbe {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  /** Git Bash de l'installation embarquée (`gitInstall().bashExe`), `null` si absent. */
  embeddedBash: string | null
  exists(p: string): boolean
}

/** Shell à lancer. Lève une erreur sous Windows si l'installation embarquée n'a pas de Git Bash :
 *  il n'y a pas de repli sur les shells du poste. */
export function resolveShell(p: ShellProbe): ShellSpec {
  if (p.platform === 'win32') {
    if (!p.embeddedBash || !p.exists(p.embeddedBash)) {
      throw new Error('Git Bash embarqué introuvable (resources/git). En développement : lancer `pnpm git:fetch` dans apps/desktop.')
    }
    return { name: 'Git Bash', file: p.embeddedBash, args: ['--login', '-i'] }
  }
  const shell = p.env['SHELL'] || '/bin/bash'
  return { name: path.posix.basename(shell), file: shell, args: ['-l'] }
}

/** Environnement du shell : `base` doit venir de `gitEnv({ terminal: true })` (PATH avec le git
 *  embarqué en tête, config isolée, locale et invites de l'utilisateur, `HOME` inchangé). On retire
 *  ce qui vient d'Electron / de Polenta : `ELECTRON_RUN_AS_NODE` ferait d'un `electron` lancé depuis
 *  le terminal un simple Node. */
export function shellEnv(base: Record<string, string | undefined>, platform: NodeJS.Platform): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(base)) {
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
