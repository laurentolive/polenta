import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AuthService } from './auth.service'
import { SyncService } from './sync.service'
import { TestRepo } from '../git/test-repo.test-util'

/**
 * GH326 — un fichier réécrit à taille égale dans la même seconde que son ajout à l'index passait pour
 * inchangé (`statusMatrix` d'isomorphic-git compare les dates à la seconde) : ni affiché, ni stagé,
 * ni publié.
 *
 * GH337 — réécrit sur le backend natif (index écrit par `stage` / `commit` de SyncService ; git gère
 * lui-même les entrées « racy ») : même comportement vu par l'utilisateur. Les tests de l'utilitaire
 * supprimé (`racySafeStatusMatrix`, `needsContentCheck`) n'ont plus d'objet.
 */

const AUTHOR = { name: 'Testeur', email: 't@x' }
const FILE = 'links.yaml'
const BEFORE = 'targetId: SYS-0002\n'
const AFTER = 'targetId: SYS-0008\n' // même taille

let repo: string
let sync: SyncService

const abs = (rel: string) => path.join(repo, rel)
const write = (rel: string, content: string) => fsP.writeFile(abs(rel), content)

async function committedText(rel: string) {
  const text = await new TestRepo(repo).git.readText('HEAD', rel)
  if (text === null) throw new Error(`${rel} absent de HEAD`)
  return text
}

const waitStartOfSecond = () => new Promise(resolve => setTimeout(resolve, 1000 - (Date.now() % 1000) + 5))
const second = (ms: number) => Math.floor(ms / 1000)

/**
 * Rejoue le bug : `index` (indexation de BEFORE), puis réécriture AFTER dans la même seconde que
 * l'écriture de l'index. Recommence si la seconde a basculé entre-temps.
 */
async function rewriteWithinSecond(index: () => Promise<unknown>) {
  const indexPath = path.join(repo, '.git', 'index')
  for (let attempt = 0; attempt < 5; attempt++) {
    await waitStartOfSecond()
    await write(FILE, BEFORE)
    await index()
    await write(FILE, AFTER)
    const [idx, file] = await Promise.all([fsP.stat(indexPath), fsP.stat(abs(FILE))])
    if (second(idx.mtimeMs) === second(file.mtimeMs)) return
  }
  throw new Error('impossible de rejouer la réécriture dans la même seconde')
}

beforeEach(async () => {
  repo = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh326-'))
  sync = new SyncService({ getAuthor: async () => AUTHOR } as unknown as AuthService)
  await TestRepo.create(repo, { 'other.yaml': 'a: 1\n' }, { message: 'base', author: AUTHOR })
})

afterEach(async () => {
  await fsP.rm(repo, { recursive: true, force: true })
})

const indexFile = () => sync.stage(repo, FILE)
const commitBefore = async () => {
  await indexFile()
  await sync.commit(repo, 'avant', AUTHOR)
}

describe('GH326 — réécriture à taille égale dans la seconde du commit', () => {
  it('la modification est affichée, stagée puis commitée', async () => {
    await rewriteWithinSecond(commitBefore)

    expect((await sync.status(repo)).unstaged).toEqual([{ path: FILE, marker: 'M' }])
    expect(await sync.workdirChangesVsHead(repo, [FILE])).toEqual([{ path: FILE, change: 'modified' }])

    await sync.stageAll(repo)
    expect((await sync.status(repo)).staged).toEqual([{ path: FILE, marker: 'M' }])
    await sync.commit(repo, 'après', AUTHOR)
    expect(await committedText(FILE)).toBe(AFTER)
    expect((await sync.status(repo)).unstaged).toEqual([])
  })

  it('un fichier stagé puis réécrit dans la seconde est vu différent de l\'index', async () => {
    await write(FILE, 'targetId: SYS-0001\n')
    await sync.stageAll(repo)
    await sync.commit(repo, 'v1', AUTHOR)
    await rewriteWithinSecond(indexFile)

    const status = await sync.status(repo)
    expect(status.staged).toEqual([{ path: FILE, marker: 'M' }])
    expect(status.unstaged).toEqual([{ path: FILE, marker: 'M' }])
  })

  it('une réécriture à l\'identique dans la seconde reste inchangée', async () => {
    let sameSecond = false
    for (let attempt = 0; attempt < 5 && !sameSecond; attempt++) {
      await waitStartOfSecond()
      const start = second(Date.now())
      await write(FILE, BEFORE)
      await commitBefore()
      await write(FILE, BEFORE)
      sameSecond = second((await fsP.stat(abs(FILE))).mtimeMs) === start
    }
    expect(sameSecond).toBe(true)
    expect(await sync.status(repo)).toMatchObject({ staged: [], unstaged: [] })
  })
})
