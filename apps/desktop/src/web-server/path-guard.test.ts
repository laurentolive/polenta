import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { checkArgs, PathGuardError } from './path-guard'

let base: string
let root: string
let other: string

beforeAll(async () => {
  base = await fsP.realpath(await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-guard-')))
  root = path.join(base, 'users', 'alice')
  other = path.join(base, 'users', 'bob')
  await fsP.mkdir(path.join(root, 'workspaces', 'p1', 'repo'), { recursive: true })
  await fsP.mkdir(path.join(other, 'workspaces'), { recursive: true })
  // Lien symbolique sortant (ignoré là où l'OS refuse d'en créer).
  await fsP.symlink(other, path.join(root, 'workspaces', 'evil'), 'junction').catch(() => {})
})

afterAll(async () => {
  await fsP.rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function rejected(channel: string, args: unknown[]): Promise<PathGuardError> {
  const err = await checkArgs(channel, args, root).then(() => null, (e: unknown) => e)
  expect(err).toBeInstanceOf(PathGuardError)
  return err as PathGuardError
}

describe('checkArgs — refus (S2-10)', () => {
  it('repoPath d\'un autre utilisateur', async () => {
    expect((await rejected('requirements:list', [path.join(other, 'workspaces')])).argIndex).toBe(0)
  })
  it('remontée par .. dans un chemin absolu', async () => {
    await rejected('requirements:list', [path.join(root, 'workspaces', '..', '..', 'bob')])
  })
  it('chemins système', async () => {
    await rejected('drawio:read', [process.platform === 'win32' ? 'C:\\Windows' : '/etc', 'x'])
    await rejected('drawio:read', ['/etc/passwd', 'x'])
  })
  it('identifiant relatif avec ..', async () => {
    expect((await rejected('requirements:get', [path.join(root, 'workspaces', 'p1', 'repo'), '../../x'])).argIndex).toBe(1)
    await rejected('requirements:get', [root, '..\\..\\x'])
  })
  it('lecteur Windows et octet nul', async () => {
    await rejected('requirements:get', [root, 'C:foo'])
    await rejected('requirements:get', [root, 'SYS-1\0'])
  })
  it('chemin dans un DTO', async () => {
    await rejected('app:set-settings', [{ exportTemplatesDir: '/etc' }])
    await rejected('workspace:set-mount-override', [root, { localPath: path.join(other, 'x') }])
    await rejected('baseline:create', [root, { tag: 'v1', components: [{ name: 'c', repoPath: '/etc' }] }])
  })
  it('argument racine relatif (résolu depuis le dossier courant du serveur)', async () => {
    expect((await rejected('workspace:remove-repo-dir', ['src'])).argIndex).toBe(0)
    await rejected('drawio:read', ['.web-data/users/bob/workspaces/x', 'a.drawio'])
    await rejected('requirements:create', [root, {}, 'relatif'])
    await rejected('interface:coverage', [root, 'relatif', []])
  })
  it('tableau de chemins', async () => {
    await rejected('merge-resolution:list', [[root, '/etc']])
  })
  it('lien symbolique vers l\'espace d\'un autre utilisateur', async () => {
    const link = path.join(root, 'workspaces', 'evil')
    const isLink = await fsP.lstat(link).then(s => s.isSymbolicLink(), () => false)
    if (!isLink) return
    await rejected('requirements:list', [path.join(link, 'workspaces')])
  })
})

describe('checkArgs — acceptés', () => {
  it('chemins de l\'utilisateur, y compris inexistants', async () => {
    await checkArgs('requirements:get', [path.join(root, 'workspaces', 'p1', 'repo'), 'SYS-0001'], root)
    await checkArgs('workspace:create-new', [path.join(root, 'workspaces', 'nouveau'), 'Mon projet'], root)
  })
  it('richtext contenant ../ dans un DTO (S2-11)', async () => {
    await checkArgs('requirements:update', [root, 'SYS-1', { fields: { statement: 'voir ../docs et a/../b' } }], root)
  })
  it('texte libre de premier niveau déclaré', async () => {
    await checkArgs('sync:commit', [root, 'fix: chemin ../relatif'], root)
    await checkArgs('merge-resolution:validate', ['id', 'requirements/SYS-1.yaml', 'a: ../b'], root)
  })
  it('URL de remote', async () => {
    await checkArgs('workspace:create-from-clone', [path.join(root, 'workspaces', 'x'), 'https://github.com/org/repo.git'], root)
  })
  it('racine optionnelle absente', async () => {
    await checkArgs('requirements:create', [root, {}, undefined], root)
    await checkArgs('requirements:create', [root, {}, null], root)
  })
  it('undefined, null, nombres, booléens', async () => {
    await checkArgs('sync:log', [root, undefined], root)
    await checkArgs('web:delete-workspace', [path.join(root, 'workspaces', 'p1'), true], root)
    await checkArgs('sync:graph', [root, 50], root)
    await checkArgs('requirements:list', [root, null], root)
  })
})
