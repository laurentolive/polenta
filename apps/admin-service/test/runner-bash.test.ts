// GH308 — choix de l'interpréteur bash des scripts du kit (lanceur WSL écarté sous Windows).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveBash } from '../src/jobs/runner'

let root: string
const touch = (...parts: string[]) => {
  const p = path.win32.join(root, ...parts)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, '')
  return p
}
const dir = (...parts: string[]) => path.win32.join(root, ...parts)

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'gh308-'))
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('resolveBash (GH308)', () => {
  it('Linux : bash du PATH, inchangé', () => {
    expect(resolveBash({ PATH: '/usr/bin:/bin' }, 'linux')).toBe('bash')
  })

  it('POLENTA_BASH force l\'interpréteur', () => {
    expect(resolveBash({ POLENTA_BASH: '/opt/bash', PATH: '' }, 'linux')).toBe('/opt/bash')
  })

  it.skipIf(process.platform !== 'win32')('Windows : le lanceur WSL (WindowsApps, System32) est écarté au profit de Git Bash', () => {
    touch('WindowsApps', 'bash.exe')
    touch('System32', 'bash.exe')
    const gitBash = touch('Git', 'usr', 'bin', 'bash.exe')
    const PATH = [dir('WindowsApps'), dir('System32'), dir('Git', 'usr', 'bin')].join(';')
    expect(resolveBash({ PATH }, 'win32')).toBe(gitBash)
  })

  it.skipIf(process.platform !== 'win32')('Windows : seul git.exe au PATH → <Git>\\bin\\bash.exe', () => {
    touch('WindowsApps', 'bash.exe')
    touch('Git', 'cmd', 'git.exe')
    const gitBash = touch('Git', 'bin', 'bash.exe')
    const PATH = [dir('WindowsApps'), dir('Git', 'cmd')].join(';')
    expect(path.win32.normalize(resolveBash({ PATH }, 'win32'))).toBe(gitBash)
  })

  it('Windows sans Git Bash : repli sur bash', () => {
    expect(resolveBash({ PATH: '' }, 'win32')).toBe('bash')
  })
})
