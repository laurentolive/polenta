import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import { gitFor, type GitBackend } from './git-backend'
import { closeAll, closeRepo } from './process-registry'

/**
 * GH337 revue (point 5) — `restore()` ne supprime un chemin non suivi qu'après contrôle : `..`, chemin
 * absolu ou `.git` ne suppriment rien ; un fichier normal non suivi est supprimé.
 */

let root: string
let dir: string
let g: GitBackend
let outsideDir: string

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'gh337-restore-'))
  dir = path.join(root, 'repo')
  outsideDir = path.join(root, 'hors')
  fs.mkdirSync(dir)
  fs.mkdirSync(outsideDir)
  g = gitFor(dir)
  await g.init('main')
  fs.writeFileSync(path.join(dir, 'x.txt'), 'v1\n')
  await g.addAll()
  await g.commit({ message: 'init', author: { name: 'Alice', email: 'a@x', timestamp: 1_700_000_000 } })
})

afterEach(async () => {
  await closeRepo(dir)
  fs.rmSync(root, { recursive: true, force: true })
})

afterAll(() => closeAll())

describe('GH337 revue P5 — restore() : suppression hors dépôt refusée', () => {
  it('chemin relatif « ../… » : erreur, fichier hors du dépôt intact', async () => {
    const outside = path.join(outsideDir, 'cible.txt')
    fs.writeFileSync(outside, 'intact\n')
    await expect(g.restore(['../hors/cible.txt'])).rejects.toThrow()
    expect(fs.readFileSync(outside, 'utf8')).toBe('intact\n')
  })

  it('chemin absolu : erreur, fichier intact', async () => {
    const outside = path.join(outsideDir, 'abs.txt')
    fs.writeFileSync(outside, 'intact\n')
    await expect(g.restore([outside])).rejects.toThrow()
    expect(fs.readFileSync(outside, 'utf8')).toBe('intact\n')
  })

  it('chemin « .git/… » : erreur, dépôt intact', async () => {
    const config = fs.readFileSync(path.join(dir, '.git', 'config'), 'utf8')
    await expect(g.restore(['.git/config'])).rejects.toThrow()
    expect(fs.readFileSync(path.join(dir, '.git', 'config'), 'utf8')).toBe(config)
  })

  it('témoin : un fichier normal non suivi est supprimé', async () => {
    fs.writeFileSync(path.join(dir, 'loose.txt'), 'local\n')
    await g.restore(['loose.txt'])
    expect(fs.existsSync(path.join(dir, 'loose.txt'))).toBe(false)
    expect(fs.readFileSync(path.join(dir, 'x.txt'), 'utf8')).toBe('v1\n')
  })
})
