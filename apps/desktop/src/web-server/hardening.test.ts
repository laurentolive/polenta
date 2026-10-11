import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { disableSymlinks, gitRemoteGuard } from './hardening'
import { isSafeMountName } from '../main/services/workspace-tree.service'

let dir: string
beforeAll(async () => { dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-hard-')) })
afterAll(async () => { await fsP.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) })

describe('liens symboliques neutralisés (core.symlinks=false)', () => {
  it('fs.promises.symlink et fs.symlinkSync écrivent un fichier texte', async () => {
    disableSymlinks()
    // `require` : le module réel, celui que voient isomorphic-git et les services.
    const realFs = require('fs') as typeof fs
    await realFs.promises.symlink('/etc/passwd', path.join(dir, 'a'))
    realFs.symlinkSync('/etc/shadow', path.join(dir, 'b'))
    for (const [name, target] of [['a', '/etc/passwd'], ['b', '/etc/shadow']]) {
      const stat = await fsP.lstat(path.join(dir, name))
      expect(stat.isSymbolicLink()).toBe(false)
      expect(await fsP.readFile(path.join(dir, name), 'utf-8')).toBe(target)
    }
  })
})

describe('hôtes git autorisés (SSRF)', () => {
  const guard = gitRemoteGuard(['git.acme.fr'], false)
  it('forge en HTTPS acceptée', () => {
    expect(() => guard(new URL('https://git.acme.fr/org/repo.git/info/refs'))).not.toThrow()
  })
  it('autres hôtes, HTTP, métadonnées cloud, localhost refusés', () => {
    for (const u of ['http://git.acme.fr/x', 'https://github.com/x', 'http://169.254.169.254/latest/meta-data',
      'https://localhost:6379/', 'https://git.acme.fr.evil.com/x']) {
      expect(() => guard(new URL(u))).toThrow(/non autorisé/)
    }
  })
  it('HTTP accepté seulement si configuré', () => {
    expect(() => gitRemoteGuard(['git.acme.fr'], true)(new URL('http://git.acme.fr/x'))).not.toThrow()
  })
})

describe('noms de montage des dépendances', () => {
  it('un seul segment', () => {
    for (const ok of ['motor-control', 'comp.v2', 'a_b']) expect(isSafeMountName(ok)).toBe(true)
    for (const bad of ['', '.', '..', '../bob', 'a/b', 'a\\b', 'C:x', 'x\0', 42]) expect(isSafeMountName(bad)).toBe(false)
  })
})
