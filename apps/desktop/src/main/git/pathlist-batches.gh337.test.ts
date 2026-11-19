import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest'

import { chunkPaths, gitFor, type GitBackend } from './git-backend'
import { closeAll, closeRepo } from './process-registry'

/**
 * GH337 P5 — listes de chemins longues : les chemins ne passent plus tous en argv (limite de la ligne de
 * commande Windows, ~32 Ko, `ENAMETOOLONG`). `status`, `ls-files` et le rafraîchissement d'index les
 * passent par lots dont la longueur reste sous le budget.
 */

/** 5 000 chemins de 60 caractères : ~300 Ko si passés tous en argv. */
function longPaths(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `dossier/${String(i).padStart(5, '0')}-${'x'.repeat(60)}`.slice(0, 60))
}

let repo: string
let g: GitBackend

beforeEach(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gh337-paths-'))
  g = gitFor(repo)
  await g.init('main')
  fs.writeFileSync(path.join(repo, 'a.txt'), 'v1\n')
  await g.addAll()
  await g.commit({ message: 'init', author: { name: 'T', email: 't@x' } })
  fs.writeFileSync(path.join(repo, 'a.txt'), 'v2\n')
})

afterEach(async () => {
  await closeRepo(repo)
  fs.rmSync(repo, { recursive: true, force: true })
})

afterAll(() => closeAll())

describe('GH337 P5 — découpage des listes de chemins', () => {
  it('chunkPaths : chaque lot reste sous le budget, aucun chemin perdu ni dupliqué', () => {
    const paths = longPaths(5000)
    const batches = chunkPaths(paths)
    expect(batches.length).toBeGreaterThan(1)
    for (const b of batches) {
      const total = b.reduce((s, p) => s + p.length + 3, 0)
      expect(total).toBeLessThanOrEqual(24_000)
    }
    expect(batches.flat()).toEqual(paths)
  })

  it('chunkPaths : liste vide → un lot vide (sans chemin, la commande garde son comportement)', () => {
    expect(chunkPaths([])).toEqual([[]])
  })
})

describe('GH337 P5 — 5 000 chemins de 60 caractères', () => {
  it('status({ prefixes }) ne lève pas et renvoie la modification réelle', async () => {
    const statuses = await g.status({ prefixes: [...longPaths(5000), 'a.txt'] })
    expect(statuses.map(s => s.path)).toContain('a.txt')
  })

  it('lsFiles(prefixes) ne lève pas et renvoie les fichiers suivis demandés', async () => {
    const files = await g.lsFiles([...longPaths(5000), 'a.txt'])
    expect(files).toEqual(['a.txt'])
  })
})
