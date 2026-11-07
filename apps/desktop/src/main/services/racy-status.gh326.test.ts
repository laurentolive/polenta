import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AuthService } from './auth.service'
import { needsContentCheck, racySafeStatusMatrix, type StatTimes } from './racy-status.util'
import { SyncService } from './sync.service'

/**
 * GH326 — un fichier réécrit à taille égale dans la même seconde que son ajout à l'index passait pour
 * inchangé (`statusMatrix` d'isomorphic-git compare les dates à la seconde) : ni affiché, ni stagé,
 * ni publié.
 */

const AUTHOR = { name: 'Testeur', email: 't@x' }
const FILE = 'links.yaml'
const BEFORE = 'targetId: SYS-0002\n'
const AFTER = 'targetId: SYS-0008\n' // même taille

let repo: string
let sync: SyncService

const abs = (rel: string) => path.join(repo, rel)
const write = (rel: string, content: string) => fsP.writeFile(abs(rel), content)
const rawRow = async (rel: string) => (await git.statusMatrix({ fs, dir: repo, filepaths: [rel] })).find(r => r[0] === rel)
const row = async (rel: string) => (await racySafeStatusMatrix(repo, [rel])).find(r => r[0] === rel)

async function committedText(rel: string) {
  const oid = await git.resolveRef({ fs, dir: repo, ref: 'HEAD' })
  const { blob } = await git.readBlob({ fs, dir: repo, oid, filepath: rel })
  return Buffer.from(blob).toString('utf8')
}

const waitStartOfSecond = () => new Promise(resolve => setTimeout(resolve, 1000 - (Date.now() % 1000) + 5))

/**
 * Rejoue le bug : `index` (indexation de BEFORE), puis réécriture AFTER dans la même seconde. Recommence
 * si la seconde a basculé entre-temps ; vérifie que le statut brut d'isomorphic-git est bien aveugle.
 */
async function rewriteWithinSecond(index: () => Promise<unknown>, blindRow: number[]) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await waitStartOfSecond()
    await write(FILE, BEFORE)
    await index()
    await write(FILE, AFTER)
    const raw = await rawRow(FILE)
    if (raw && JSON.stringify(raw.slice(1)) === JSON.stringify(blindRow)) return
  }
  throw new Error('impossible de rejouer la réécriture dans la même seconde')
}

beforeEach(async () => {
  repo = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh326-'))
  sync = new SyncService({ getAuthor: async () => AUTHOR } as unknown as AuthService)
  await git.init({ fs, dir: repo, defaultBranch: 'main' })
  await write('other.yaml', 'a: 1\n')
  await git.add({ fs, dir: repo, filepath: '.' })
  await git.commit({ fs, dir: repo, message: 'base', author: AUTHOR })
})

afterEach(async () => {
  await fsP.rm(repo, { recursive: true, force: true })
})

const commitBefore = async () => {
  await sync.stageAll(repo)
  await git.commit({ fs, dir: repo, message: 'avant', author: AUTHOR })
}

describe('GH326 — réécriture à taille égale dans la seconde du commit', () => {
  it('la modification est affichée, stagée puis commitée', async () => {
    await rewriteWithinSecond(commitBefore, [1, 1, 1])

    expect((await sync.status(repo)).unstaged).toEqual([{ path: FILE, marker: 'M' }])
    expect(await sync.workdirChangesVsHead(repo, [FILE])).toEqual([{ path: FILE, change: 'modified' }])

    await sync.stageAll(repo)
    expect((await sync.status(repo)).staged).toEqual([{ path: FILE, marker: 'M' }])
    await git.commit({ fs, dir: repo, message: 'après', author: AUTHOR })
    expect(await committedText(FILE)).toBe(AFTER)
    expect((await sync.status(repo)).unstaged).toEqual([])
  })

  it('un fichier stagé puis réécrit dans la seconde est vu différent de l\'index', async () => {
    await write(FILE, 'targetId: SYS-0001\n')
    await sync.stageAll(repo)
    await git.commit({ fs, dir: repo, message: 'v1', author: AUTHOR })
    await rewriteWithinSecond(() => sync.stageAll(repo), [1, 2, 2])

    expect((await row(FILE))!.slice(1)).toEqual([1, 2, 3])
    const status = await sync.status(repo)
    expect(status.staged).toEqual([{ path: FILE, marker: 'M' }])
    expect(status.unstaged).toEqual([{ path: FILE, marker: 'M' }])
  })

  it('une réécriture à l\'identique dans la seconde reste inchangée', async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      await waitStartOfSecond()
      await write(FILE, BEFORE)
      await commitBefore()
      await write(FILE, BEFORE)
      if (Math.floor(Date.now() / 1000) === Math.floor((await fsP.stat(abs(FILE))).mtimeMs / 1000)) break
    }
    expect((await row(FILE))!.slice(1)).toEqual([1, 1, 1])
    expect(await sync.status(repo)).toMatchObject({ staged: [], unstaged: [] })
  })
})

describe('GH326 — même résultat que git.statusMatrix hors cas racy', () => {
  it('nouveau, ignoré, stagé, modifié, supprimé, sous-dossier, filtre', async () => {
    await fsP.mkdir(abs('requirements/SYS'), { recursive: true })
    await write('requirements/SYS/SYS-0001.yaml', 'id: SYS-0001\n')
    await write('gone.yaml', 'x\n')
    await write('.gitignore', '*.log\n')
    await git.add({ fs, dir: repo, filepath: '.' })
    await git.commit({ fs, dir: repo, message: 'arbo', author: AUTHOR })
    await write('requirements/SYS/SYS-0001.yaml', 'id: SYS-0001\ntitle: plus long\n')
    await write('requirements/SYS/SYS-0002.yaml', 'id: SYS-0002\n')
    await write('staged.yaml', 'nouveau\n')
    await git.add({ fs, dir: repo, filepath: 'staged.yaml' })
    await write('staged.yaml', 'nouveau puis modifié\n')
    await write('debug.log', 'ignoré\n')
    await fsP.rm(abs('gone.yaml'))

    const sort = (m: unknown[][]) => [...m].sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    expect(sort(await racySafeStatusMatrix(repo))).toEqual(sort(await git.statusMatrix({ fs, dir: repo })))
    expect(sort(await racySafeStatusMatrix(repo, ['requirements'])))
      .toEqual(sort(await git.statusMatrix({ fs, dir: repo, filepaths: ['requirements'] })))
  })
})

describe('GH326 — needsContentCheck', () => {
  const S = 1_794_089_169
  const times = (mtimeNs: number, extra: Partial<StatTimes> = {}): StatTimes => ({
    mtimeSeconds: S, mtimeNanoseconds: mtimeNs, ctimeSeconds: S, ctimeNanoseconds: mtimeNs, size: 19, ...extra,
  })
  const indexLater = (S + 5) * 1000

  it('taille ou secondes différentes : isomorphic-git relit déjà le fichier', () => {
    expect(needsContentCheck(times(1e8, { size: 20 }), times(1e8), null)).toBe(false)
    expect(needsContentCheck(times(1e8, { mtimeSeconds: S + 1 }), times(1e8), null)).toBe(false)
  })

  it('fraction de seconde différente : à relire', () => {
    expect(needsContentCheck(times(600_000_000), times(100_000_000), indexLater)).toBe(true)
  })

  it('écart d\'arrondi (mtimeMs en double, nanosecondes de git natif) : pas à relire', () => {
    expect(needsContentCheck(times(137_736_800.3), times(137_736_700), indexLater)).toBe(false)
  })

  it('ctime de git natif sous Windows (date de création) : sa fraction de seconde est ignorée', () => {
    const disk = times(837_720_458.98, { ctimeNanoseconds: 837_720_458.98 })
    const nativeEntry = times(837_720_500, { ctimeNanoseconds: 836_720_800 })
    expect(needsContentCheck(disk, nativeEntry, indexLater)).toBe(false)
  })

  it('entrée datée au même instant que l\'index (racy) : à relire', () => {
    const entry = times(100_000_000)
    expect(needsContentCheck(entry, entry, S * 1000 + 100)).toBe(true)
    expect(needsContentCheck(entry, entry, S * 1000 + 99)).toBe(true)
    expect(needsContentCheck(entry, entry, S * 1000 + 101)).toBe(false)
  })

  it('index sans nanosecondes (git natif sans USE_NSEC) : comparaison à la seconde', () => {
    const entry = times(0)
    expect(needsContentCheck(times(500_000_000), entry, indexLater)).toBe(false)
    expect(needsContentCheck(times(500_000_000), entry, S * 1000 + 900)).toBe(true)
    expect(needsContentCheck(times(500_000_000), entry, (S + 1) * 1000)).toBe(false)
  })

  it('date de l\'index inconnue : à relire', () => {
    expect(needsContentCheck(times(1e8), times(1e8), null)).toBe(true)
  })
})
