import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WorkspaceService } from './workspace.service'
import type { SyncService } from './sync.service'
import type { HostContext } from '../host/host-context'

/** GH343 — T4 : « Fermer le projet » dans une fenêtre n'efface le dernier projet ouvert que s'il le désigne. */
describe('GH343 — clearLastOpened(workspaceDir)', () => {
  let tmp: string
  let a: string
  let b: string
  let ws: WorkspaceService

  beforeEach(async () => {
    tmp = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh343-'))
    a = path.join(tmp, 'projet-a')
    b = path.join(tmp, 'projet-b')
    for (const dir of [a, b]) await fsP.mkdir(path.join(dir, '.polenta'), { recursive: true })
    for (const dir of [a, b]) await fsP.writeFile(path.join(dir, '.polenta', 'workspace.yaml'), 'rootRepo: x\n')
    ws = new WorkspaceService({ userDataDir: tmp, machineConfig: {} } as unknown as HostContext, {} as SyncService)
  })

  afterEach(async () => {
    await fsP.rm(tmp, { recursive: true, force: true })
  })

  it('un autre projet : le pointeur reste', async () => {
    await ws.markRecent(b)
    await ws.clearLastOpened(a)
    expect((await ws.getLastOpened())?.workspaceDir).toBe(b)
  })

  it('ce projet : le pointeur est effacé', async () => {
    await ws.markRecent(a)
    await ws.clearLastOpened(path.join(a, '.'))
    expect(await ws.getLastOpened()).toBeNull()
  })

  it('sans paramètre : effacé comme avant', async () => {
    await ws.markRecent(b)
    await ws.clearLastOpened()
    expect(await ws.getLastOpened()).toBeNull()
  })
})
