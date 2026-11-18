import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import { gitFor } from '../git/git-backend'
import { closeAll } from '../git/process-registry'
import type { HostContext } from '../host/host-context'
import type { SyncService } from './sync.service'
import { WorkspaceService } from './workspace.service'
import { GITATTRIBUTES_CONTENT } from './repo-conformity.util'

/**
 * GH337 (design §9, spec §4.3) — normalisation unique des fins de ligne à l'ouverture : un vieux
 * clone (`autocrlf=true`) qui a déjà le `.gitattributes` de #336, en CRLF sur disque et LF dans git,
 * repasse en LF sur disque sans commit ; un fichier réellement modifié n'est pas touché.
 */

const AUTHOR = { name: 'Testeur', email: 't@x' }

let tmp: string
let ws: string
let repo: string

const write = (rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true })
  fs.writeFileSync(path.join(repo, rel), content)
}
const read = (rel: string) => fs.readFileSync(path.join(repo, rel), 'utf8')
const open = () => new WorkspaceService({ userDataDir: tmp } as unknown as HostContext, {} as SyncService).openWorkspace(ws)

async function makeRepo(files: Record<string, string>): Promise<string> {
  const g = gitFor(repo)
  await g.init('main')
  for (const [f, c] of Object.entries(files)) write(f, c)
  await g.add(Object.keys(files))
  return g.commit({ message: 'base', author: AUTHOR })
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh337-eol-open-'))
  ws = path.join(tmp, 'ws')
  repo = path.join(ws, 'repo')
  fs.mkdirSync(path.join(ws, '.polenta'), { recursive: true })
  fs.writeFileSync(path.join(ws, '.polenta', 'workspace.yaml'), 'rootRepo: repo\n')
})

afterEach(async () => {
  await gitFor(repo).close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

afterAll(() => closeAll())

describe('GH337 §9 — normalisation des fins de ligne à l\'ouverture', () => {
  it('CRLF sur disque / LF dans git → LF sur disque, statut propre, aucun commit ; vraie modification intacte', async () => {
    const head = await makeRepo({
      '.gitattributes': GITATTRIBUTES_CONTENT,
      'a.yaml': 'a: 1\nb: 2\n',
      'sub/b.yaml': 'x: 1\n',
      'm.yaml': 'a: 1\n',
    })
    // Ancien clone autocrlf=true : contenu identique en CRLF ; m.yaml réellement modifié, en CRLF.
    write('a.yaml', 'a: 1\r\nb: 2\r\n')
    write('sub/b.yaml', 'x: 1\r\n')
    write('m.yaml', 'a: 9\r\n')

    expect((await open()).status).toBe('ok')

    expect(read('a.yaml')).toBe('a: 1\nb: 2\n')
    expect(read('sub/b.yaml')).toBe('x: 1\n')
    expect(read('m.yaml')).toBe('a: 9\r\n')
    const g = gitFor(repo)
    expect(await g.resolve('HEAD')).toBe(head)
    expect((await g.status()).map(e => e.path)).toEqual(['m.yaml'])
    expect((await g.lsFilesEol()).filter(e => e.worktree === 'crlf').map(e => e.path)).toEqual(['m.yaml'])
  })

  it('sans le .gitattributes de #336 : rien n\'est réécrit (laissé à la mise en conformité)', async () => {
    await makeRepo({ 'a.yaml': 'a: 1\n' })
    write('a.yaml', 'a: 1\r\n')
    expect((await open()).status).toBe('ok')
    expect(read('a.yaml')).toBe('a: 1\r\n')
  })

  it('une seule fois par dépôt et par session : la réouverture ne réécrit plus', async () => {
    await makeRepo({ '.gitattributes': GITATTRIBUTES_CONTENT, 'a.yaml': 'a: 1\n' })
    write('a.yaml', 'a: 1\r\n')
    await open()
    expect(read('a.yaml')).toBe('a: 1\n')
    write('a.yaml', 'a: 1\r\n')
    await open()
    expect(read('a.yaml')).toBe('a: 1\r\n')
  })
})
