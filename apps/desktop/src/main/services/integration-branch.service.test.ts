import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import git from 'isomorphic-git'
import * as yaml from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DefaultBranchOutcome } from '@polenta/types'

import type { AuthService } from './auth.service'
import { GitService } from './git.service'
import { SyncService } from './sync.service'
import type { ForgeService } from './forge/forge.service'
import { IntegrationBranchGuardError, IntegrationBranchService } from './integration-branch.service'

/** GH106 — specs/GH106-tests.md (scénarios U du sprint 1), sur de vrais repos git temporaires. */

const execFileAsync = promisify(execFile)
const AUTHOR = { name: 'Testeur', email: 't@x' }
const PROJECT = 'config/project.yaml'

let tmp: string
let repo: string
let sync: SyncService
let align: ReturnType<typeof vi.fn>
let service: IntegrationBranchService

async function write(rel: string, content: string, dir = repo) {
  await fsP.mkdir(path.dirname(path.join(dir, rel)), { recursive: true })
  await fsP.writeFile(path.join(dir, rel), content)
}

async function commitAll(message: string, dir = repo) {
  await git.add({ fs, dir, filepath: '.' })
  return git.commit({ fs, dir, message, author: AUTHOR })
}

/** Fichiers modifiés par le commit `sha` par rapport à son parent. */
async function changedFiles(sha: string): Promise<string[]> {
  const { commit } = await git.readCommit({ fs, dir: repo, oid: sha })
  const out: string[] = []
  await git.walk({
    fs, dir: repo, trees: [git.TREE({ ref: commit.parent[0] }), git.TREE({ ref: sha })],
    map: async (filepath, [a, b]) => {
      if (filepath === '.') return
      if ((await a?.type()) === 'tree' || (await b?.type()) === 'tree') return
      if ((await a?.oid()) !== (await b?.oid())) out.push(filepath)
    },
  })
  return out
}

async function fileAt(ref: string, filepath: string): Promise<string> {
  const oid = await git.resolveRef({ fs, dir: repo, ref })
  return Buffer.from((await git.readBlob({ fs, dir: repo, oid, filepath })).blob).toString('utf8')
}

async function statusOf(filepath: string) {
  return git.status({ fs, dir: repo, filepath })
}

/** `int-A` (project.yaml = int-A) puis `int-B` créée depuis elle, checkoutée : le cas PH2. */
async function setupInherited() {
  await git.init({ fs, dir: repo, defaultBranch: 'int-A' })
  await write(PROJECT, 'integrationBranch: int-A\n')
  await write('requirements/R1.yaml', 'title: r1\n')
  await write('tests/T1.yaml', 'title: t1\n')
  await commitAll('init')
  await git.branch({ fs, dir: repo, ref: 'int-B', checkout: true })
}

beforeEach(async () => {
  tmp = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-gh106-'))
  repo = path.join(tmp, 'repo')
  await fsP.mkdir(repo)
  const auth = { getAuthor: async () => AUTHOR, getHttpsCredentials: async () => null } as unknown as AuthService
  sync = new SyncService(auth)
  align = vi.fn(async (): Promise<DefaultBranchOutcome> => 'set')
  service = new IntegrationBranchService(new GitService(), sync, { alignDefaultBranch: align } as unknown as ForgeService)
})

afterEach(async () => {
  await fsP.rm(tmp, { recursive: true, force: true })
})

describe('state', () => {
  it('int-B héritant de int-A → incoherent (T-01, avant désignation)', async () => {
    await setupInherited()
    expect(await service.state(repo)).toEqual({
      currentBranch: 'int-B', configured: 'int-A', status: 'incoherent',
      candidates: [{ name: 'int-A', remoteOnly: false }, { name: 'int-B', remoteOnly: false }],
    })
  })

  it('repo main sans project.yaml → nonConvention, configured main (T-31)', async () => {
    await git.init({ fs, dir: repo, defaultBranch: 'main' })
    await write('README.md', 'x')
    await commitAll('init')
    expect(await service.state(repo)).toMatchObject({ currentBranch: 'main', configured: 'main', status: 'nonConvention', candidates: [] })
  })

  it('detached HEAD → readonly (T-23)', async () => {
    await setupInherited()
    const sha = await git.resolveRef({ fs, dir: repo, ref: 'HEAD' })
    await git.checkout({ fs, dir: repo, ref: sha })
    expect((await service.state(repo)).status).toBe('readonly')
  })
})

describe('designate', () => {
  it('commit du seul project.yaml, WD propre (T-01)', async () => {
    await setupInherited()
    const outcome = await service.designate(repo, 'int-B')
    expect(outcome).toMatchObject({ branch: 'int-B', committed: true, push: 'no-remote', defaultBranch: 'no-forge' })
    expect(await changedFiles(outcome.commitSha!)).toEqual([PROJECT])
    expect(yaml.load(await fileAt('int-B', PROJECT))).toEqual({ integrationBranch: 'int-B' })
    expect(await fileAt('int-A', PROJECT)).toBe('integrationBranch: int-A\n')
    // La branche elle-même (et HEAD) avance, pas une référence mal nommée.
    expect(await git.resolveRef({ fs, dir: repo, ref: 'refs/heads/int-B' })).toBe(outcome.commitSha)
    expect(await git.resolveRef({ fs, dir: repo, ref: 'HEAD' })).toBe(outcome.commitSha)
    expect(fs.existsSync(path.join(repo, '.git', 'int-B'))).toBe(false)
    const { commit } = await git.readCommit({ fs, dir: repo, oid: outcome.commitSha! })
    expect(commit.message.trim()).toBe("Branche d'intégration : int-B")
    expect(await statusOf(PROJECT)).toBe('unmodified')
    expect((await service.state(repo)).status).toBe('ok')
  })

  it("modifications en attente (indexée et non indexée) hors du commit et conservées (T-02)", async () => {
    await setupInherited()
    await write('requirements/R1.yaml', 'title: r1 modifiée\n')
    await git.add({ fs, dir: repo, filepath: 'requirements/R1.yaml' })
    await write('tests/T1.yaml', 'title: t1 modifié\n')
    const outcome = await service.designate(repo, 'int-B')
    expect(await changedFiles(outcome.commitSha!)).toEqual([PROJECT])
    expect(await statusOf('requirements/R1.yaml')).toBe('modified')   // indexée, toujours en attente
    expect(await statusOf('tests/T1.yaml')).toBe('*modified')          // non indexée
    expect(await fsP.readFile(path.join(repo, 'requirements/R1.yaml'), 'utf8')).toBe('title: r1 modifiée\n')
    expect(await fileAt('int-B', 'requirements/R1.yaml')).toBe('title: r1\n')
  })

  it('déjà désignée → aucun commit (T-03)', async () => {
    await setupInherited()
    await service.designate(repo, 'int-B')
    const head = await git.resolveRef({ fs, dir: repo, ref: 'HEAD' })
    const outcome = await service.designate(repo, 'int-B')
    expect(outcome.committed).toBe(false)
    expect(await git.resolveRef({ fs, dir: repo, ref: 'HEAD' })).toBe(head)
  })

  it('project.yaml modifié en attente : clé appliquée au WD, reste de la modification conservé (T-16)', async () => {
    await setupInherited()
    await write(PROJECT, 'integrationBranch: int-A\nnote: locale\n')
    const outcome = await service.designate(repo, 'int-B')
    expect(yaml.load(await fileAt('int-B', PROJECT))).toEqual({ integrationBranch: 'int-B' })
    expect(yaml.load(await fsP.readFile(path.join(repo, PROJECT), 'utf8'))).toEqual({ integrationBranch: 'int-B', note: 'locale' })
    expect(await changedFiles(outcome.commitSha!)).toEqual([PROJECT])
    expect(await statusOf(PROJECT)).toBe('*modified')
  })

  it('HEAD déjà juste mais copie de travail désignant une autre branche : WD réaligné, sans commit', async () => {
    await setupInherited()
    await service.designate(repo, 'int-B')
    const head = await git.resolveRef({ fs, dir: repo, ref: 'HEAD' })
    await write(PROJECT, 'integrationBranch: int-A\n')   // reste d'une ancienne écriture non commitée
    expect((await service.state(repo)).status).toBe('incoherent')
    const outcome = await service.designate(repo, 'int-B')
    expect(outcome.committed).toBe(false)
    expect(await git.resolveRef({ fs, dir: repo, ref: 'HEAD' })).toBe(head)
    expect((await service.state(repo)).status).toBe('ok')
    expect(await statusOf(PROJECT)).toBe('unmodified')
  })

  it('copie de travail en YAML invalide : refus, fichier et HEAD intacts', async () => {
    await setupInherited()
    const head = await git.resolveRef({ fs, dir: repo, ref: 'HEAD' })
    await write(PROJECT, 'integrationBranch: int-A\nnote: [non fermé\n')
    await expect(service.designate(repo, 'int-B')).rejects.toThrow(/YAML valide/)
    expect(await fsP.readFile(path.join(repo, PROJECT), 'utf8')).toBe('integrationBranch: int-A\nnote: [non fermé\n')
    expect(await git.resolveRef({ fs, dir: repo, ref: 'HEAD' })).toBe(head)
  })

  it('config/ absent : créé dans le commit (T-17)', async () => {
    await git.init({ fs, dir: repo, defaultBranch: 'main' })
    await write('README.md', 'x')
    await commitAll('init')
    await git.branch({ fs, dir: repo, ref: 'int-B', checkout: true })
    const outcome = await service.designate(repo, 'int-B')
    expect(await changedFiles(outcome.commitSha!)).toEqual([PROJECT])
    expect(await fileAt('int-B', PROJECT)).toBe('integrationBranch: int-B\n')
    expect(await fileAt('int-B', 'README.md')).toBe('x')
  })

  it('checkout de la branche si besoin', async () => {
    await setupInherited()
    await git.checkout({ fs, dir: repo, ref: 'int-A' })
    await service.designate(repo, 'int-B')
    expect(await git.currentBranch({ fs, dir: repo })).toBe('int-B')
    expect((await service.state(repo)).configured).toBe('int-B')
  })

  it('noms invalides refusés sans écriture (T-21)', async () => {
    await setupInherited()
    const head = await git.resolveRef({ fs, dir: repo, ref: 'HEAD' })
    await expect(service.designate(repo, 'main')).rejects.toThrow(/int-<nom>/)
    await expect(service.designate(repo, 'int-a b')).rejects.toThrow()
    await expect(service.designate(repo, 'int-')).rejects.toThrow()
    expect(await git.resolveRef({ fs, dir: repo, ref: 'HEAD' })).toBe(head)
  })

  describe('avec origin (repo nu local, push par la CLI git)', () => {
    let bare: string
    beforeEach(async () => {
      // Barres obliques : un `C:\…` écrit tel quel dans .git/config est illisible pour la CLI git.
      bare = path.join(tmp, 'origin.git').replace(/\\/g, '/')
      await execFileAsync('git', ['init', '--bare', '-q', bare])
      await setupInherited()
      await git.addRemote({ fs, dir: repo, remote: 'origin', url: bare })
    })

    it('push puis branche par défaut (T-01, T-05 côté service)', async () => {
      const outcome = await service.designate(repo, 'int-B')
      expect(outcome).toMatchObject({ push: 'ok', defaultBranch: 'set' })
      expect(align).toHaveBeenCalledWith(repo, 'int-B')
      const { stdout } = await execFileAsync('git', ['--git-dir', bare, 'show', 'int-B:config/project.yaml'])
      expect(stdout).toBe('integrationBranch: int-B\n')
    })

    it('push en échec → push-pending, commit local présent, pas d’alignement (T-19)', async () => {
      await git.deleteRemote({ fs, dir: repo, remote: 'origin' })
      await git.addRemote({ fs, dir: repo, remote: 'origin', url: path.join(tmp, 'absent.git').replace(/\\/g, '/') })
      const outcome = await service.designate(repo, 'int-B')
      expect(outcome.committed).toBe(true)
      expect(typeof outcome.push).toBe('object')
      expect(outcome.defaultBranch).toBe('push-pending')
      expect(align).not.toHaveBeenCalled()
    })

    it("branche présente seulement sur origin : suivi créé puis désignée (T-04)", async () => {
      await sync.pushBranch(repo, 'int-A')
      await sync.pushBranch(repo, 'int-B')
      const other = path.join(tmp, 'clone')
      await execFileAsync('git', ['clone', '-q', '--branch', 'int-A', bare, other])
      const svc = new IntegrationBranchService(new GitService(), sync, { alignDefaultBranch: align } as unknown as ForgeService)
      expect((await svc.state(other)).candidates).toContainEqual({ name: 'int-B', remoteOnly: true })
      const outcome = await svc.designate(other, 'int-B')
      expect(await git.currentBranch({ fs, dir: other })).toBe('int-B')
      expect(outcome.committed).toBe(true)
    })

    it('createAndDesignate refuse un nom pris sur origin (T-22)', async () => {
      await sync.pushBranch(repo, 'int-B')
      await git.checkout({ fs, dir: repo, ref: 'int-A' })
      await git.deleteBranch({ fs, dir: repo, ref: 'int-B' })
      await expect(service.createAndDesignate(repo, 'B')).rejects.toThrow(/existe déjà/)
      expect(await git.listBranches({ fs, dir: repo })).toEqual(['int-A'])
    })
  })
})

describe('createAndDesignate', () => {
  it('depuis la position courante (T-08)', async () => {
    await setupInherited()
    await git.checkout({ fs, dir: repo, ref: 'int-A' })
    const base = await git.resolveRef({ fs, dir: repo, ref: 'int-A' })
    const outcome = await service.createAndDesignate(repo, 'PH2')
    expect(await git.currentBranch({ fs, dir: repo })).toBe('int-PH2')
    const { commit } = await git.readCommit({ fs, dir: repo, oid: outcome.commitSha! })
    expect(commit.parent).toEqual([base])
    expect(yaml.load(await fileAt('int-PH2', PROJECT))).toEqual({ integrationBranch: 'int-PH2' })
  })

  it('échec de la désignation : branche retirée, HEAD revenu, nouvel essai possible', async () => {
    await setupInherited()
    await git.checkout({ fs, dir: repo, ref: 'int-A' })
    await write(PROJECT, 'cassé: [\n')
    await expect(service.createAndDesignate(repo, 'v3')).rejects.toThrow(/YAML valide/)
    expect(await git.currentBranch({ fs, dir: repo })).toBe('int-A')
    expect(await git.listBranches({ fs, dir: repo })).not.toContain('int-v3')
    expect(await fsP.readFile(path.join(repo, PROJECT), 'utf8')).toBe('cassé: [\n')   // WD non réécrit
    await write(PROJECT, 'integrationBranch: int-A\n')
    await expect(service.createAndDesignate(repo, 'v3')).resolves.toMatchObject({ branch: 'int-v3', committed: true })
  })

  it('depuis une baseline (T-14)', async () => {
    await setupInherited()
    await git.checkout({ fs, dir: repo, ref: 'int-A' })
    const tagged = await git.resolveRef({ fs, dir: repo, ref: 'HEAD' })
    await git.tag({ fs, dir: repo, ref: 'v1.0' })
    await write('requirements/R2.yaml', 'title: r2\n')
    await commitAll('après la baseline')
    const outcome = await service.createAndDesignate(repo, 'v2', { tag: 'v1.0' })
    const { commit } = await git.readCommit({ fs, dir: repo, oid: outcome.commitSha! })
    expect(commit.parent).toEqual([tagged])
    expect(fs.existsSync(path.join(repo, 'requirements/R2.yaml'))).toBe(false)
  })
})

describe('assertDeletable', () => {
  it('branche désignée refusée (T-25)', async () => {
    await setupInherited()
    await service.designate(repo, 'int-B')
    await git.checkout({ fs, dir: repo, ref: 'int-A' })
    await git.checkout({ fs, dir: repo, ref: 'int-B' })
    await expect(service.assertDeletable(repo, 'int-B', 'local')).rejects.toMatchObject({ code: 'designated' })
  })

  it('dernière int-* refusée, même non désignée (T-26)', async () => {
    await git.init({ fs, dir: repo, defaultBranch: 'main' })
    await write('README.md', 'x')
    await commitAll('init')
    await git.branch({ fs, dir: repo, ref: 'int-x' })
    const err = await service.assertDeletable(repo, 'int-x', 'local').catch(e => e)
    expect(err).toBeInstanceOf(IntegrationBranchGuardError)
    expect(err.code).toBe('lastIntegration')
  })

  it("autre int-* non désignée : autorisée (T-27) ; dev-* jamais concernée (T-29)", async () => {
    await setupInherited()
    await service.designate(repo, 'int-B')
    await expect(service.assertDeletable(repo, 'int-A', 'local')).resolves.toBeUndefined()
    await git.branch({ fs, dir: repo, ref: 'dev-modif' })
    await expect(service.assertDeletable(repo, 'dev-modif', 'local')).resolves.toBeUndefined()
  })

  it('main implicite (pas de project.yaml) : jamais protégée comme « désignée »', async () => {
    await git.init({ fs, dir: repo, defaultBranch: 'main' })
    await write('README.md', 'x')
    await commitAll('init')
    await git.branch({ fs, dir: repo, ref: 'int-x' })
    await git.branch({ fs, dir: repo, ref: 'int-y' })
    await git.checkout({ fs, dir: repo, ref: 'int-y' })
    await expect(service.assertDeletable(repo, 'main', 'local')).resolves.toBeUndefined()
  })

  it('suppression distante de la branche désignée refusée (T-28)', async () => {
    await setupInherited()
    await service.designate(repo, 'int-B')
    await expect(service.assertDeletable(repo, 'int-B', 'remote')).rejects.toMatchObject({ code: 'designated' })
  })
})

describe('checkout (T-24)', () => {
  it("le checkout d'une int-* ne commite ni n'écrit project.yaml", async () => {
    await setupInherited()
    await git.checkout({ fs, dir: repo, ref: 'int-A' })
    const before = await git.resolveRef({ fs, dir: repo, ref: 'int-B' })
    await sync.checkoutBranch(repo, 'int-B')
    expect(await git.resolveRef({ fs, dir: repo, ref: 'int-B' })).toBe(before)
    expect(await fsP.readFile(path.join(repo, PROJECT), 'utf8')).toBe('integrationBranch: int-A\n')
  })
})
