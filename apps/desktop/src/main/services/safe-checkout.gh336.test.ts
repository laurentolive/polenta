import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthService } from './auth.service'
import { SyncService } from './sync.service'
import { LocalChangesError, safeCheckout } from './safe-checkout.util'

/**
 * GH336 §5 — « si le panneau Version n'affiche aucune modification locale, le changement de branche
 * aboutit » ; sinon le blocage nomme chaque fichier. Cas réel : PH2/handstickProduct, `int-tmp`
 * ignore `*.pref`, `int-PH2` versionne `.local.migrated.pref`.
 */

const AUTHOR = { name: 'Testeur', email: 't@x' }

let repo: string
let sync: SyncService

const write = async (rel: string, content: string) => {
  await fsP.mkdir(path.dirname(path.join(repo, rel)), { recursive: true })
  await fsP.writeFile(path.join(repo, rel), content)
}
const read = (rel: string) => fsP.readFile(path.join(repo, rel), 'utf8')
const exists = (rel: string) => fsP.stat(path.join(repo, rel)).then(() => true, () => false)

async function commitAll(message: string) {
  await git.add({ fs, dir: repo, filepath: '.' })
  return git.commit({ fs, dir: repo, message, author: AUTHOR })
}

beforeEach(async () => {
  repo = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh336-'))
  sync = new SyncService({ getAuthor: async () => AUTHOR } as unknown as AuthService)
  await git.init({ fs, dir: repo, defaultBranch: 'main' })
  await write('a.yaml', 'a: 0\n')
  await commitAll('base')
  // int-PH2 : la pref a été commitée par erreur.
  await git.branch({ fs, dir: repo, ref: 'int-PH2', checkout: true })
  await write('.local.migrated.pref', 'committed: true\n')
  await write('a.yaml', 'a: ph2\n')
  await commitAll('pref commitée')
  // int-tmp (depuis main) : *.pref ignoré.
  await git.checkout({ fs, dir: repo, ref: 'main', force: true })
  await git.branch({ fs, dir: repo, ref: 'int-tmp', checkout: true })
  await write('.gitignore', '*.pref\n')
  await commitAll('gitignore')
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fsP.rm(repo, { recursive: true, force: true })
})

const nothingToCommit = async () => {
  const s = await sync.status(repo)
  return s.staged.length + s.unstaged.length === 0
}

describe('GH336 — checkout sûr', () => {
  it('pref ignorée ici, versionnée sur la cible : le checkout aboutit et la copie locale est restaurée', async () => {
    await write('.local.migrated.pref', 'local: mine\n')
    expect(await nothingToCommit()).toBe(true)
    // isomorphic-git seul refuse.
    await expect(git.checkout({ fs, dir: repo, ref: 'int-PH2' })).rejects.toBeInstanceOf(git.Errors.CheckoutConflictError)

    await sync.checkoutBranch(repo, 'int-PH2')

    expect(await git.currentBranch({ fs, dir: repo })).toBe('int-PH2')
    expect(await read('a.yaml')).toBe('a: ph2\n')
    expect(await read('.local.migrated.pref')).toBe('local: mine\n')
    // Le fichier local commité sur cette branche apparaît (à corriger par la mise en conformité).
    expect((await sync.status(repo)).unstaged.map(f => f.path)).toEqual(['.local.migrated.pref'])
  })

  it('une vraie modification bloque : message en clair, un fichier par ligne, rien n\'est touché', async () => {
    await write('a.yaml', 'a: local\n')
    const err = await sync.checkoutBranch(repo, 'int-PH2').catch(e => e)
    expect(err).toBeInstanceOf(LocalChangesError)
    expect(err.message).toContain('Impossible de passer sur int-PH2')
    expect(err.message).toContain('- a.yaml : modifié')
    expect(await git.currentBranch({ fs, dir: repo })).toBe('int-tmp')
    expect(await read('a.yaml')).toBe('a: local\n')
  })

  it('un fichier non suivi que la cible versionne est nommé comme tel', async () => {
    await git.checkout({ fs, dir: repo, ref: 'main', force: true })
    await write('.local.migrated.pref', 'x\n') // pas de .gitignore sur main : non suivi, visible
    const err = await sync.checkoutBranch(repo, 'int-PH2').catch(e => e)
    expect(err).toBeInstanceOf(LocalChangesError)
    expect(err.message).toContain('- .local.migrated.pref : non suivi, existe sur int-PH2')
  })

  it('le retour sur la branche où la pref est ignorée aboutit aussi', async () => {
    await git.checkout({ fs, dir: repo, ref: 'int-PH2', force: true })
    expect(await nothingToCommit()).toBe(true)
    await sync.checkoutBranch(repo, 'int-tmp')
    expect(await git.currentBranch({ fs, dir: repo })).toBe('int-tmp')
    expect(await exists('.gitignore')).toBe(true)
  })

  it('erreur après le début de l\'écriture : retour à l\'état de départ, jamais d\'état intermédiaire', async () => {
    const original = git.checkout
    let calls = 0
    vi.spyOn(git, 'checkout').mockImplementation(async (args) => {
      calls += 1
      if (calls === 1) {
        // Écrit l'index de la cible (comme le checkout interrompu de GH335) puis échoue.
        await original({ ...args, noUpdateHead: true } as Parameters<typeof git.checkout>[0])
        throw new Error('Too many pending tasks in queue packed-refs')
      }
      return original(args)
    })

    await expect(safeCheckout({ dir: repo, ref: 'int-PH2' })).rejects.toThrow(/Too many pending tasks/)
    vi.restoreAllMocks()

    expect(await git.currentBranch({ fs, dir: repo })).toBe('int-tmp')
    expect(await exists('.gitignore')).toBe(true)
    expect(await read('a.yaml')).toBe('a: 0\n')
    expect(await nothingToCommit()).toBe(true)
  })
})
