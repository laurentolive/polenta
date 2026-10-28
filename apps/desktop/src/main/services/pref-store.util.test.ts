import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { writePref } from './pref-store.util'

describe('GH167 — writePref garde le .pref hors gestion de conf', () => {
  let repo: string
  const gitignore = () => fs.readFileSync(path.join(repo, '.gitignore'), 'utf-8')

  beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pref-store-')) })
  afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }) })

  it('crée le .gitignore avec *.pref s’il n’existe pas', () => {
    writePref(repo, 'alice', { a: 1 })
    expect(gitignore()).toBe('*.pref\n')
  })

  it('ajoute *.pref à un .gitignore existant sans saut de ligne final', () => {
    fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/')
    writePref(repo, 'alice', { a: 1 })
    expect(gitignore()).toBe('node_modules/\n*.pref\n')
  })

  it('ne duplique pas la ligne', () => {
    fs.writeFileSync(path.join(repo, '.gitignore'), '.polenta/tree.cache.yaml\r\n*.pref\r\n')
    writePref(repo, 'alice', { a: 1 })
    writePref(repo, 'alice', { a: 2 })
    expect(gitignore()).toBe('.polenta/tree.cache.yaml\r\n*.pref\r\n')
  })
})
