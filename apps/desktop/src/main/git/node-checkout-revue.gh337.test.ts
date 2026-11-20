import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import { gitFor, type GitBackend } from './git-backend'
import { safeCheckout } from '../services/safe-checkout.util'
import { nodeCheckout } from './node-checkout'
import { closeAll } from './process-registry'

/**
 * GH337 revue (points 3, 4, 6) — `nodeCheckout` : arrêt des écritures après une erreur, index avant HEAD,
 * écriture à travers un lien symbolique.
 */

const A = { name: 'Alice', email: 'a@x' }
let dirs: string[] = []
let t = 1_700_000_000

function mk(): { dir: string; g: GitBackend } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh337-revue-co-'))
  dirs.push(dir)
  return { dir, g: gitFor(dir) }
}

async function commit(dir: string, g: GitBackend, files: Record<string, string>): Promise<string> {
  for (const [f, c] of Object.entries(files)) {
    const p = path.join(dir, f)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, c)
  }
  await g.addAll()
  return g.commit({ message: 'm', author: { ...A, timestamp: (t += 60) } })
}

afterEach(async () => {
  vi.restoreAllMocks()
  for (const d of dirs) { await gitFor(d).close(); fs.rmSync(d, { recursive: true, force: true }) }
  dirs = []
})
afterAll(() => closeAll())

/** Dépôt main / feature : `count` fichiers modifiés par feature. */
async function twoBranches(count: number): Promise<{ dir: string; g: GitBackend }> {
  const { dir, g } = mk()
  await g.init('main')
  const base: Record<string, string> = {}
  for (let i = 0; i < count; i++) base[`f${i}.txt`] = 'v1\n'
  await commit(dir, g, base)
  await g.createBranch('feature')
  await g.checkout('feature')
  const changed: Record<string, string> = {}
  for (let i = 0; i < count; i++) changed[`f${i}.txt`] = 'v2\n'
  await commit(dir, g, changed)
  await g.checkout('main')
  return { dir, g }
}

describe('GH337 revue P3 — pool : plus aucune écriture après une erreur', () => {
  it('une écriture en échec : la promesse rejette, et aucune écriture ne suit le rejet', async () => {
    const { dir, g } = await twoBranches(40)
    const realWrite = fs.promises.writeFile
    let writes = 0
    vi.spyOn(fs.promises, 'writeFile').mockImplementation(async (file, data, opts) => {
      writes++
      if (writes === 3) throw Object.assign(new Error('EPERM: fichier verrouillé'), { code: 'EPERM' })
      return realWrite(file, data, opts)
    })
    let writesAtRejection = -1
    await nodeCheckout(dir, 'feature', { concurrency: 8 }).catch((e: Error) => {
      expect(e.message).toMatch(/EPERM/)
      writesAtRejection = writes
    })
    expect(writesAtRejection).toBeGreaterThan(0)
    await new Promise(r => setTimeout(r, 300))
    expect(writes).toBe(writesAtRejection)
    expect(await g.currentBranch()).toBe('main')
  })
})

describe('GH337 revue P4 — index avant HEAD', () => {
  it('index verrouillé (index.lock) : checkout en échec, HEAD inchangé', async () => {
    const { dir, g } = await twoBranches(3)
    const headBefore = await g.resolve('HEAD')
    fs.writeFileSync(path.join(dir, '.git', 'index.lock'), '')
    try {
      await expect(nodeCheckout(dir, 'feature')).rejects.toThrow(/Mise à jour de l'index impossible, HEAD inchangé/)
    } finally {
      fs.rmSync(path.join(dir, '.git', 'index.lock'), { force: true })
    }
    expect(await g.resolve('HEAD')).toBe(headBefore)
    expect(await g.currentBranch()).toBe('main')
  })
})

const canSymlink = (() => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gh337-symprobe-'))
  try {
    fs.writeFileSync(path.join(d, 't'), '')
    fs.symlinkSync(path.join(d, 't'), path.join(d, 'l'))
    return true
  } catch {
    return false
  } finally {
    fs.rmSync(d, { recursive: true, force: true })
  }
})()

describe('GH337 revue P6 — écriture à travers un lien symbolique', () => {
  it.skipIf(!canSymlink)('un lien symbolique (fichier ignoré) à un chemin écrit : fichier régulier, cible intacte', async () => {
    const { dir, g } = mk()
    await g.init('main')
    await commit(dir, g, { 'a.txt': 'a\n' })
    await g.createBranch('feature')
    await g.checkout('feature')
    await commit(dir, g, { 'n.md': '# nouveau\n' })
    await g.checkout('main')
    // n.md ignoré (info/exclude) seulement maintenant : un fichier ignoré au chemin d'un ajout passe les contrôles.
    fs.appendFileSync(path.join(dir, '.git', 'info', 'exclude'), 'n.md\n')

    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh337-symtarget-'))
    dirs.push(outsideDir)
    const target = path.join(outsideDir, 'cible.txt')
    fs.writeFileSync(target, 'intacte\n')
    fs.symlinkSync(target, path.join(dir, 'n.md'))

    expect(await nodeCheckout(dir, 'feature')).toBe(true)
    const st = fs.lstatSync(path.join(dir, 'n.md'))
    expect(st.isSymbolicLink()).toBe(false)
    expect(st.isFile()).toBe(true)
    expect(fs.readFileSync(path.join(dir, 'n.md'), 'utf8')).toBe('# nouveau\n')
    expect(fs.readFileSync(target, 'utf8')).toBe('intacte\n')
  })
})

describe('GH337 revue P4 — index verrouillé : aucune écriture disque, rien à rattraper', () => {
  it('safeCheckout : index.lock → erreur, fichiers et HEAD inchangés, statut propre', async () => {
    const { dir, g } = await twoBranches(3)
    fs.writeFileSync(path.join(dir, '.git', 'index.lock'), '')
    try {
      await expect(safeCheckout({ dir, ref: 'feature' })).rejects.toThrow(/HEAD inchangé/)
    } finally {
      fs.rmSync(path.join(dir, '.git', 'index.lock'), { force: true })
    }
    expect(await g.currentBranch()).toBe('main')
    expect(fs.readFileSync(path.join(dir, 'f0.txt'), 'utf8')).toBe('v1\n')
    expect(await g.status()).toEqual([])
  })
})

describe('GH337 revue P3+P4 — écriture disque en échec : retour à HEAD par safeCheckout', () => {
  it('une écriture échoue après la mise à jour de l’index : fichiers, index et HEAD ramenés à main', async () => {
    const { dir, g } = await twoBranches(10)
    const realWrite = fs.promises.writeFile
    let writes = 0
    vi.spyOn(fs.promises, 'writeFile').mockImplementation(async (file, data, opts) => {
      writes++
      if (writes === 4) throw Object.assign(new Error('EPERM: fichier verrouillé'), { code: 'EPERM' })
      return realWrite(file, data, opts)
    })
    await expect(safeCheckout({ dir, ref: 'feature' })).rejects.toThrow(/EPERM/)
    vi.restoreAllMocks()
    expect(await g.currentBranch()).toBe('main')
    for (let i = 0; i < 10; i++) expect(fs.readFileSync(path.join(dir, `f${i}.txt`), 'utf8')).toBe('v1\n')
    expect(await g.status()).toEqual([])
  })
})
