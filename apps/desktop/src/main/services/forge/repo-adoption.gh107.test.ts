import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdoptRepoRequest, DefaultBranchOutcome, ForgeRepoDetails } from '@polenta/types'

import type { AuthService } from '../auth.service'
import { GitService } from '../git.service'
import { IntegrationBranchService } from '../integration-branch.service'
import { SyncService } from '../sync.service'
import { WorkspaceService } from '../workspace.service'
import type { HostContext } from '../../host/host-context'
import type { ForgeService } from './forge.service'
import { RepoProvisioningService } from './repo-provisioning.service'

/**
 * GH107 sprint 3 — inspection et adoption d'un repo existant (specs/GH107-tests.md A-01 à A-10) :
 * vrais repos git, repo nu local à la place du serveur. La forge est simulée ; `clone` et les
 * lectures du serveur, en HTTP dans l'application, passent ici par la CLI git.
 */

const AUTHOR = { name: 'Testeur', email: 't@x' }
const OWNER = 'acme'
const NAME = 'proj'

let tmp: string
let bare: string
let seed: string
let container: string
let details: ForgeRepoDetails
let forge: { repoDetails: ReturnType<typeof vi.fn>; updateRepo: ReturnType<typeof vi.fn>; alignDefaultBranch: ReturnType<typeof vi.fn>; grantMember: ReturnType<typeof vi.fn> }
let service: RepoProvisioningService

const run = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
const bareGit = (...args: string[]) => run(bare, ...args)
const serverBranches = () => bareGit('for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n').filter(Boolean).sort()
const showOnServer = (ref: string, file: string) => bareGit('show', `${ref}:${file}`)
const commitCount = (ref: string) => Number(bareGit('rev-list', '--count', ref))

class CliSync extends SyncService {
  override async remoteHeads(remoteUrl: string): Promise<string[]> {
    return run(tmp, 'ls-remote', '--heads', remoteUrl).split('\n').filter(Boolean).map(l => l.split('refs/heads/')[1])
  }
  override async cloneBranchShallow(remoteUrl: string, localPath: string, branch: string): Promise<void> {
    run(tmp, 'clone', '-q', '--single-branch', '--branch', branch, remoteUrl, localPath)
  }
  override async clone(remoteUrl: string, localPath: string): Promise<void> {
    run(tmp, 'clone', '-q', remoteUrl, localPath)
    run(localPath, 'config', 'user.name', AUTHOR.name)
    run(localPath, 'config', 'user.email', AUTHOR.email)
  }
}

/** Publie sur le serveur une branche contenant `files`, et la met en branche par défaut. */
async function seedBranch(branch: string, files: Record<string, string>, opts: { default?: boolean } = {}) {
  run(seed, 'checkout', '-q', '--orphan', branch)
  run(seed, 'rm', '-rfq', '--ignore-unmatch', '.')
  for (const [file, content] of Object.entries(files)) {
    await fsP.mkdir(path.dirname(path.join(seed, file)), { recursive: true })
    await fsP.writeFile(path.join(seed, file), content)
  }
  run(seed, 'add', '-A')
  run(seed, '-c', 'user.name=S', '-c', 'user.email=s@x', 'commit', '-qm', `seed ${branch}`)
  run(seed, 'push', '-q', 'origin', branch)
  if (opts.default !== false) bareGit('symbolic-ref', 'HEAD', `refs/heads/${branch}`)
}

function request(over: Partial<AdoptRepoRequest> = {}): AdoptRepoRequest {
  return { accountKey: 'k', owner: OWNER, name: NAME, target: { kind: 'project', containerDir: container }, ...over }
}

function setDetails(over: Partial<ForgeRepoDetails>) {
  details = { ...details, ...over }
}

beforeEach(async () => {
  tmp = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-gh107-adopt-'))
  // Même nom que le repo : `createFromClone` nomme le dossier d'après l'URL.
  bare = path.join(tmp, 'serveur', `${NAME}.git`).replace(/\\/g, '/')
  seed = path.join(tmp, 'seed')
  container = path.join(tmp, 'projets')
  await fsP.mkdir(container)
  await fsP.mkdir(bare, { recursive: true })
  run(tmp, 'init', '-q', '--bare', '--initial-branch=main', bare)
  run(tmp, 'init', '-q', '--initial-branch=seed', seed)
  run(seed, 'remote', 'add', 'origin', bare)
  details = {
    cloneUrl: bare, description: 'Déjà décrit', visibility: 'private', defaultBranch: 'main',
    permissions: { pull: true, push: true, admin: true },
  }
  forge = {
    repoDetails: vi.fn(async () => details),
    updateRepo: vi.fn(async () => {}),
    alignDefaultBranch: vi.fn(async (): Promise<DefaultBranchOutcome> => (details.permissions.admin ? 'set' : 'not-admin')),
    grantMember: vi.fn(async () => 'added'),
  }
  const auth = { getAuthor: async () => AUTHOR, getHttpsCredentials: async () => null } as unknown as AuthService
  const sync = new CliSync(auth)
  const ctx = { userDataDir: tmp, machineConfig: { hideGithub: false } } as unknown as HostContext
  const workspace = new WorkspaceService(ctx, sync)
  const f = forge as unknown as ForgeService
  service = new RepoProvisioningService(f, workspace, sync, new IntegrationBranchService(new GitService(), sync, f))
})

afterEach(async () => {
  await fsP.rm(tmp, { recursive: true, force: true })
})

const COMPLETE = {
  'README.md': '# proj\n', 'config/project.yaml': 'integrationBranch: int-a\n', '.polenta/schema.yaml': 'version: 1\n',
}

describe('inspect', () => {
  it('A-01 — repo vide : empty, rien de manquant à détailler', async () => {
    const found = await service.inspect('k', OWNER, NAME)
    expect(found).toMatchObject({ fullName: 'acme/proj', empty: true, integration: null, missing: [] })
  })

  it('A-02 — repo complet : missing vide', async () => {
    await seedBranch('int-a', COMPLETE)
    setDetails({ defaultBranch: 'int-a' })
    expect(await service.inspect('k', OWNER, NAME)).toMatchObject({
      empty: false, integration: { branch: 'int-a', source: 'default' }, hasReadme: true, hasDescription: true, isPolentaProject: true, missing: [],
    })
  })

  it('A-03 — sans int-* ni README, déjà un projet Polenta : ces deux éléments seulement', async () => {
    await seedBranch('main', { '.polenta/schema.yaml': 'version: 1\n' })
    setDetails({ description: '' })
    expect(await service.inspect('k', OWNER, NAME)).toMatchObject({
      integration: null, hasReadme: false, hasDescription: false, isPolentaProject: true, missing: ['integration', 'description'],
    })
  })

  it('A-04 — int-* désignée par project.yaml, branche par défaut autre : lue sur l\'intégration', async () => {
    await seedBranch('int-a', COMPLETE, { default: false })
    await seedBranch('main', { 'config/project.yaml': 'integrationBranch: int-a\n' })
    expect(await service.inspect('k', OWNER, NAME)).toMatchObject({
      integration: { branch: 'int-a', source: 'project-yaml' }, hasReadme: true, missing: [],
    })
  })

  it('A-05 — project.yaml désigne une int-* absente du serveur : integration absente', async () => {
    await seedBranch('main', { 'README.md': '# p\n', 'config/project.yaml': 'integrationBranch: int-absente\n' })
    expect(await service.inspect('k', OWNER, NAME)).toMatchObject({ integration: null, missing: ['integration'] })
  })

  it('projet neuf de Polenta, sans .polenta/ : reconnu (AGENTS.md généré ou project.yaml)', async () => {
    const agents = new WorkspaceService({ userDataDir: tmp, machineConfig: {} } as unknown as HostContext, {} as SyncService).polentaInitFiles()['AGENTS.md']
    await seedBranch('main', { 'README.md': '# p\n', 'AGENTS.md': agents })
    expect((await service.inspect('k', OWNER, NAME)).isPolentaProject).toBe(true)
  })

  it('repo quelconque, AGENTS.md qui n\'est pas celui de Polenta : pas un projet Polenta', async () => {
    await seedBranch('main', { 'README.md': '# p\n', 'AGENTS.md': 'mes consignes\n' })
    expect(await service.inspect('k', OWNER, NAME)).toMatchObject({ isPolentaProject: false, missing: ['integration', 'polenta'] })
  })

  it('repo introuvable : erreur', async () => {
    forge.repoDetails.mockResolvedValueOnce(null)
    await expect(service.inspect('k', OWNER, NAME)).rejects.toThrow(/introuvable/)
  })
})

describe('adopt', () => {
  const repoDir = () => path.join(container, NAME)

  it('A-01 — repo vide : parcours de création sans repo distant, même état final', async () => {
    const result = await service.adopt(request({ integrationSuffix: 'x', description: 'Nouvelle description', members: [{ kind: 'user', name: 'ann', level: 'read' }] }))
    expect(serverBranches()).toEqual(['int-x'])
    expect(commitCount('int-x')).toBe(1)
    expect(showOnServer('int-x', 'README.md')).toBe('# proj\n\nNouvelle description')
    expect(showOnServer('int-x', 'config/project.yaml')).toBe('integrationBranch: int-x')
    expect(forge.updateRepo).toHaveBeenCalledWith('k', OWNER, NAME, { description: 'Nouvelle description', visibility: undefined })
    expect(forge.grantMember).toHaveBeenCalledTimes(1)
    expect(result.steps.map(s => `${s.id}:${s.status}`)).toEqual(['description:done', 'local:done', 'push:done', 'defaultBranch:done', 'members:done', 'open:done'])
    expect(result.open).toBeDefined()
  })

  it('A-01 — repo vide sans changement de description : pas d\'appel à la forge, pas d\'étape', async () => {
    const result = await service.adopt(request({ integrationSuffix: 'x', description: 'Déjà décrit' }))
    expect(forge.updateRepo).not.toHaveBeenCalled()
    expect(result.steps.map(s => s.id)).toEqual(['local', 'push', 'defaultBranch', 'members', 'open'])
  })

  it('A-02 — repo complet : aucun commit, aucune question', async () => {
    await seedBranch('int-a', COMPLETE)
    setDetails({ defaultBranch: 'int-a' })
    const before = commitCount('int-a')
    const result = await service.adopt(request())
    expect(commitCount('int-a')).toBe(before)
    expect(forge.updateRepo).not.toHaveBeenCalled()
    expect(result.steps.every(s => s.status === 'done')).toBe(true)
    expect(result.steps.map(s => s.id)).toEqual(['local', 'push', 'defaultBranch', 'open'])
    expect(result.branch).toBe('int-a')
    expect(result.open).toBeDefined()
    expect(run(repoDir(), 'branch', '--show-current')).toBe('int-a')
  })

  it('A-03 — sans int-* ni README : int-x créée depuis la branche par défaut, README commité, description sur la forge', async () => {
    await seedBranch('main', { '.polenta/schema.yaml': 'version: 1\n', 'requirements/R1.yaml': 'title: r\n' })
    setDetails({ description: '' })
    const result = await service.adopt(request({ integrationSuffix: 'x', description: 'Le projet' }))
    expect(serverBranches()).toEqual(['int-x', 'main'])
    expect(showOnServer('int-x', 'requirements/R1.yaml')).toBe('title: r')
    expect(showOnServer('int-x', 'README.md')).toBe('# proj\n\nLe projet')
    expect(showOnServer('int-x', 'config/project.yaml')).toBe('integrationBranch: int-x')
    expect(forge.updateRepo).toHaveBeenCalledWith('k', OWNER, NAME, { description: 'Le projet' })
    expect(forge.alignDefaultBranch).toHaveBeenCalled()
    expect(result.steps.every(s => s.status === 'done')).toBe(true)
    // Rien en attente après l'adoption, sauf AGENTS.md que toute ouverture régénère s'il manque.
    expect(run(repoDir(), 'status', '--porcelain')).toBe('?? AGENTS.md')
  })

  it('A-04 — int-* désignée par project.yaml : checkout, pas de nouvelle branche, défaut aligné si admin', async () => {
    await seedBranch('int-a', COMPLETE, { default: false })
    await seedBranch('main', { 'config/project.yaml': 'integrationBranch: int-a\n' })
    await service.adopt(request())
    expect(serverBranches()).toEqual(['int-a', 'main'])
    expect(run(repoDir(), 'branch', '--show-current')).toBe('int-a')
    expect(forge.alignDefaultBranch).toHaveBeenCalledWith(expect.anything(), 'int-a')
  })

  it('A-06 — sans .polenta/, sans confirmation : abandon, aucune écriture', async () => {
    await seedBranch('main', { 'README.md': '# p\n' })
    const before = commitCount('main')
    await expect(service.adopt(request({ integrationSuffix: 'x' }))).rejects.toThrow(/pas un projet Polenta/)
    expect(serverBranches()).toEqual(['main'])
    expect(commitCount('main')).toBe(before)
    expect(fs.existsSync(repoDir())).toBe(false)
  })

  it('initialisation confirmée : fichiers Polenta commités sur l\'intégration, AGENTS.md existant conservé', async () => {
    await seedBranch('main', { 'README.md': '# p\n', 'AGENTS.md': 'mes consignes\n' })
    const result = await service.adopt(request({ integrationSuffix: 'x', initPolenta: true }))
    expect(showOnServer('int-x', 'AGENTS.md')).toBe('mes consignes')
    expect(showOnServer('int-x', '.gitignore')).toContain('.polenta/tree.cache.yaml')
    expect(result.steps.find(s => s.id === 'polenta')?.status).toBe('done')
    // Le repo ainsi adopté est reconnu ensuite comme un projet complet.
    setDetails({ defaultBranch: 'int-x' })
    expect((await service.inspect('k', OWNER, NAME)).missing).toEqual([])
  })

  it('A-07 — sans droit d\'écriture, repo complet : ajouté en lecture seule, aucune écriture', async () => {
    await seedBranch('int-a', COMPLETE)
    setDetails({ defaultBranch: 'int-a', permissions: { pull: true, push: false, admin: false } })
    const before = commitCount('int-a')
    const result = await service.adopt(request())
    expect(commitCount('int-a')).toBe(before)
    expect(result.open).toBeDefined()
    expect(forge.alignDefaultBranch).not.toHaveBeenCalled()
  })

  it('décision du 2026-11-05 — sans droit d\'écriture, projet Polenta incomplet : ouvert tel quel', async () => {
    await seedBranch('main', { '.polenta/schema.yaml': 'version: 1\n' })
    setDetails({ permissions: { pull: true, push: false, admin: false } })
    const result = await service.adopt(request())
    expect(result.open).toBeDefined()
    expect(serverBranches()).toEqual(['main'])
    expect(fs.existsSync(path.join(repoDir(), '.polenta', 'schema.yaml'))).toBe(true)
  })

  it('A-08 — sans droit d\'écriture, repo non Polenta incomplet : refus avec la liste', async () => {
    await seedBranch('main', { 'src/a.txt': 'x\n' })
    setDetails({ description: '', permissions: { pull: true, push: false, admin: false } })
    await expect(service.adopt(request())).rejects.toThrow(/droit d'écriture.*branche d'intégration.*description.*initialisation Polenta/)
    expect(fs.existsSync(repoDir())).toBe(false)
  })

  it('A-09 — écriture sans admin : locaux complétés, description et branche par défaut à faire par un administrateur', async () => {
    await seedBranch('main', { '.polenta/schema.yaml': 'version: 1\n' })
    setDetails({ description: '', permissions: { pull: true, push: true, admin: false } })
    const result = await service.adopt(request({ integrationSuffix: 'x', description: 'Le projet' }))
    expect(showOnServer('int-x', 'README.md')).toBe('# proj\n\nLe projet')
    expect(forge.updateRepo).not.toHaveBeenCalled()
    expect(result.steps.find(s => s.id === 'description')).toEqual({ id: 'description', status: 'admin', detail: 'À faire par un administrateur du repo.' })
    expect(result.steps.find(s => s.id === 'defaultBranch')?.status).toBe('admin')
    expect(result.open).toBeDefined()
  })

  it('A-10 — reprise après un push en échec : le repo resté vide est adopté, sans nouveau repo', async () => {
    // État laissé par C-04 : repo distant créé, vide.
    expect(serverBranches()).toEqual([])
    const result = await service.adopt(request({ integrationSuffix: 'x', description: 'Déjà décrit' }))
    expect(serverBranches()).toEqual(['int-x'])
    expect(result.steps.every(s => s.status === 'done')).toBe(true)
  })

  it('validation avant écriture : suffixe invalide, branche déjà sur le serveur, description absente, dossier occupé', async () => {
    await seedBranch('int-x', { 'a.txt': 'a\n' }, { default: false })
    await seedBranch('main', { '.polenta/schema.yaml': 'version: 1\n' })
    setDetails({ description: '' })
    await expect(service.adopt(request({ integrationSuffix: 'a b', description: 'd' }))).rejects.toThrow(/int-a b/)
    await expect(service.adopt(request({ integrationSuffix: 'x', description: 'd' }))).rejects.toThrow(/existe déjà sur le serveur/)
    await expect(service.adopt(request({ integrationSuffix: 'y' }))).rejects.toThrow(/description est obligatoire/)
    expect(fs.existsSync(repoDir())).toBe(false)
    await fsP.mkdir(repoDir())
    await fsP.writeFile(path.join(repoDir(), 'x'), '')
    await expect(service.adopt(request({ integrationSuffix: 'y', description: 'd' }))).rejects.toThrow(/n'est pas vide/)
  })

  it('composant : dossier temporaire supprimé, URL et branche rendues, rien dans le dossier projet', async () => {
    await seedBranch('int-a', COMPLETE)
    setDetails({ defaultBranch: 'int-a' })
    const result = await service.adopt(request({ target: { kind: 'component' } }))
    expect(result).toMatchObject({ cloneUrl: bare, branch: 'int-a' })
    expect(result.open).toBeUndefined()
    expect(fs.readdirSync(container)).toEqual([])
    expect(serverBranches()).toEqual(['int-a'])
  })
})
