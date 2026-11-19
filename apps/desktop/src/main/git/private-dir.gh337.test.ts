import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ensurePrivateDir } from './private-dir'

/**
 * GH337 P4 — dossiers de config/hooks git : `0700`, propriétaire courant, pas de lien symbolique.
 * Les contrôles POSIX ne s'appliquent pas sous Windows (ACL du profil utilisateur) : le dossier y est créé
 * et vérifié comme dossier réel. Les tests POSIX sont sautés sous Windows.
 */

const POSIX = process.platform !== 'win32'

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'gh337-private-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('GH337 P4 — ensurePrivateDir', () => {
  it('crée le dossier (Windows : dossier réel, sans contrôle de bits)', () => {
    const dir = path.join(root, 'hooks')
    expect(ensurePrivateDir(dir)).toBe(dir)
    expect(fs.statSync(dir).isDirectory()).toBe(true)
  })

  it.skipIf(!POSIX)('crée le dossier en 0700', () => {
    const dir = path.join(root, 'hooks')
    ensurePrivateDir(dir)
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700)
  })

  it.skipIf(!POSIX)('dossier à nous aux droits trop ouverts : repris en 0700', () => {
    const dir = path.join(root, 'old')
    fs.mkdirSync(dir, { mode: 0o755 })
    fs.chmodSync(dir, 0o755)
    ensurePrivateDir(dir)
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700)
  })

  it.skipIf(!POSIX)('dossier d\'un autre propriétaire : refusé', () => {
    const dir = path.join(root, 'theirs')
    fs.mkdirSync(dir, { mode: 0o700 })
    const someoneElse = (process.getuid?.() ?? 0) + 1
    expect(() => ensurePrivateDir(dir, someoneElse)).toThrow(/propriétaire/)
  })

  it.skipIf(!POSIX)('lien symbolique (même vers un dossier sûr) : refusé, la cible n\'est pas suivie', () => {
    const target = path.join(root, 'target')
    fs.mkdirSync(target, { mode: 0o700 })
    const link = path.join(root, 'link')
    fs.symlinkSync(target, link, 'dir')
    expect(() => ensurePrivateDir(link)).toThrow(/lien symbolique/)
  })

  it('fichier à la place du dossier : refusé', () => {
    const file = path.join(root, 'file')
    fs.writeFileSync(file, 'x')
    expect(() => ensurePrivateDir(file)).toThrow(/pas un dossier/)
  })
})
