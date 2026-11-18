import * as path from 'path'
import { describe, expect, it } from 'vitest'
import { gitEnv } from '../git/git-config'
import { gitInstall } from '../git/git-binary'
import { cdCommand, resolveShell, shellEnv, type ShellProbe } from './terminal-shell.util'

// GH238 / GH337 — Git Bash embarqué, environnement du shell, commande « Aller au repo sélectionné ».

const BASH = 'C:\\polenta\\resources\\git\\bin\\bash.exe'

const win = (embeddedBash: string | null, files: string[] = [BASH]): ShellProbe => {
  const set = new Set(files.map(f => f.toLowerCase()))
  return { platform: 'win32', env: { Path: 'C:\\Windows' }, embeddedBash, exists: p => set.has(p.toLowerCase()) }
}

describe('resolveShell — Windows (GH337 : Git Bash embarqué uniquement)', () => {
  it('bash.exe embarqué → bash --login -i', () => {
    expect(resolveShell(win(BASH))).toEqual({ name: 'Git Bash', file: BASH, args: ['--login', '-i'] })
  })

  it('pas de bash embarqué → erreur, sans repli sur un Git Bash du poste', () => {
    const p = win(null, ['C:\\Program Files\\Git\\bin\\bash.exe'])
    p.env = { PATH: 'C:\\Program Files\\Git\\cmd', ProgramFiles: 'C:\\Program Files' }
    expect(() => resolveShell(p)).toThrow(/Git Bash embarqué introuvable/)
  })

  it('bash embarqué annoncé mais absent du disque → erreur', () => {
    expect(() => resolveShell(win(BASH, []))).toThrow(/git:fetch/)
  })
})

describe('resolveShell — macOS / Linux', () => {
  it('$SHELL en shell de login', () => {
    expect(resolveShell({ platform: 'darwin', env: { SHELL: '/bin/zsh' }, embeddedBash: null, exists: () => false }))
      .toEqual({ name: 'zsh', file: '/bin/zsh', args: ['-l'] })
  })

  it('$SHELL absent → /bin/bash', () => {
    expect(resolveShell({ platform: 'linux', env: {}, embeddedBash: null, exists: () => false }).file).toBe('/bin/bash')
  })
})

describe('shellEnv', () => {
  const env = { PATH: 'x', ELECTRON_RUN_AS_NODE: '1', ELECTRON_RENDERER_URL: 'http://l', POLENTA_USER_DATA_DIR: 'd', HOME: 'h' }

  it('retire ELECTRON_* / POLENTA_*, pose TERM et CHERE_INVOKING sous Windows', () => {
    expect(shellEnv(env, 'win32')).toEqual({ PATH: 'x', HOME: 'h', TERM: 'xterm-256color', COLORTERM: 'truecolor', CHERE_INVOKING: '1' })
  })

  it('pas de CHERE_INVOKING hors Windows', () => {
    expect(shellEnv(env, 'darwin')['CHERE_INVOKING']).toBeUndefined()
  })
})

describe('gitEnv({ terminal: true }) — environnement du terminal', () => {
  const base = { PATH: 'C:\\Windows', HOME: 'C:\\Users\\u', LANG: 'fr_FR.UTF-8', LC_ALL: 'fr_FR.UTF-8', GIT_LITERAL_PATHSPECS: '0' }

  it('git embarqué en tête du PATH, HOME et locale de l\'utilisateur conservés, config isolée', () => {
    const env = gitEnv({ terminal: true }, base)
    const install = gitInstall()
    expect(env['PATH']?.split(path.delimiter).slice(0, install.pathDirs.length)).toEqual(install.pathDirs)
    expect(env['HOME']).toBe('C:\\Users\\u')
    expect(env['LC_ALL']).toBe('fr_FR.UTF-8')
    expect(env['LANG']).toBe('fr_FR.UTF-8')
    expect(env['GIT_CONFIG_NOSYSTEM']).toBe('1')
    expect(env['GIT_CONFIG_GLOBAL']).toBeTruthy()
    expect(env['GIT_TERMINAL_PROMPT']).toBeUndefined()
  })

  it('pas de GIT_LITERAL_PATHSPECS dans le terminal (les pathspecs usuels restent actifs)', () => {
    expect(gitEnv({ terminal: true }, base)['GIT_LITERAL_PATHSPECS']).toBeUndefined()
  })

  it('hors terminal : GIT_LITERAL_PATHSPECS posé, locale C', () => {
    const env = gitEnv({}, base)
    expect(env['GIT_LITERAL_PATHSPECS']).toBe('1')
    expect(env['LC_ALL']).toBe('C')
  })
})

describe('cdCommand', () => {
  it('Windows : chemin MSYS entre apostrophes', () => {
    expect(cdCommand('C:\\Dev\\a b', 'win32')).toBe(`cd '/c/Dev/a b'\r`)
  })

  it('apostrophe échappée', () => {
    expect(cdCommand("/home/u/l'atelier", 'linux')).toBe(`cd '/home/u/l'\\''atelier'\r`)
  })
})
