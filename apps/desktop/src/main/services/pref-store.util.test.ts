import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { writePref } from './pref-store.util'

describe('GH336 — writePref ne touche jamais au .gitignore (ex-GH167)', () => {
  let repo: string
  const exists = () => fs.existsSync(path.join(repo, '.gitignore'))
  const gitignore = () => fs.readFileSync(path.join(repo, '.gitignore'), 'utf-8')

  beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pref-store-')) })
  afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }) })

  it('ne crée pas de .gitignore', () => {
    writePref(repo, 'alice', { a: 1 })
    expect(exists()).toBe(false)
  })

  it('ne complète pas un .gitignore existant (la mise en conformité le propose)', () => {
    fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/')
    writePref(repo, 'alice', { a: 1 })
    expect(gitignore()).toBe('node_modules/')
  })
})
