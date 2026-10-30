import { describe, expect, it } from 'vitest'
import { cdCommand, resolveShell, shellEnv, type ShellProbe } from './terminal-shell.util'

// GH238 — détection de Git Bash, environnement du shell, commande « Aller au repo sélectionné ».

const win = (files: string[], env: Record<string, string>): ShellProbe => {
  const set = new Set(files.map(f => f.toLowerCase()))
  return { platform: 'win32', env, exists: p => set.has(p.toLowerCase()) }
}

describe('resolveShell — Windows', () => {
  it('git.exe dans <racine>\\cmd du PATH → <racine>\\bin\\bash.exe', () => {
    const p = win(['D:\\Tools\\Git\\cmd\\git.exe', 'D:\\Tools\\Git\\bin\\bash.exe'], { Path: 'C:\\Windows;D:\\Tools\\Git\\cmd' })
    expect(resolveShell(p)).toEqual({ name: 'Git Bash', file: 'D:\\Tools\\Git\\bin\\bash.exe', args: ['--login', '-i'] })
  })

  it('PATH sans git : emplacement standard (installé après le lancement)', () => {
    const p = win(['C:\\Program Files\\Git\\bin\\bash.exe'], { PATH: 'C:\\Windows', ProgramFiles: 'C:\\Program Files' })
    expect(resolveShell(p)?.file).toBe('C:\\Program Files\\Git\\bin\\bash.exe')
  })

  it('installation par utilisateur (%LOCALAPPDATA%\\Programs\\Git)', () => {
    const p = win(['C:\\Users\\u\\AppData\\Local\\Programs\\Git\\bin\\bash.exe'], { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' })
    expect(resolveShell(p)?.file).toBe('C:\\Users\\u\\AppData\\Local\\Programs\\Git\\bin\\bash.exe')
  })

  it('git.exe dans <racine>\\mingw64\\bin → racine remontée de deux niveaux', () => {
    const p = win(['E:\\Git\\mingw64\\bin\\git.exe', 'E:\\Git\\bin\\bash.exe'], { PATH: 'E:\\Git\\mingw64\\bin' })
    expect(resolveShell(p)?.file).toBe('E:\\Git\\bin\\bash.exe')
  })

  it('rien → null', () => {
    expect(resolveShell(win([], { PATH: 'C:\\Windows', ProgramFiles: 'C:\\Program Files' }))).toBeNull()
  })
})

describe('resolveShell — macOS / Linux', () => {
  it('$SHELL en shell de login', () => {
    expect(resolveShell({ platform: 'darwin', env: { SHELL: '/bin/zsh' }, exists: () => false }))
      .toEqual({ name: 'zsh', file: '/bin/zsh', args: ['-l'] })
  })

  it('$SHELL absent → /bin/bash', () => {
    expect(resolveShell({ platform: 'linux', env: {}, exists: () => false })?.file).toBe('/bin/bash')
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

describe('cdCommand', () => {
  it('Windows : chemin MSYS entre apostrophes', () => {
    expect(cdCommand('C:\\Dev\\a b', 'win32')).toBe(`cd '/c/Dev/a b'\r`)
  })

  it('apostrophe échappée', () => {
    expect(cdCommand("/home/u/l'atelier", 'linux')).toBe(`cd '/home/u/l'\\''atelier'\r`)
  })
})
