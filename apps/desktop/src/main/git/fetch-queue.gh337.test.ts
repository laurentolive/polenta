import * as fs from 'fs'
import * as net from 'net'
import * as os from 'os'
import * as path from 'path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import { gitFor, type GitBackend } from './git-backend'
import { closeAll, closeRepo } from './process-registry'

/**
 * GH337 P6 — un fetch réseau lent ne bloque pas les écritures locales : `fetch` ne prend pas la file
 * d'écriture du dépôt (il prend sa propre file, entre fetch). Le remote est un serveur TCP muet
 * (`127.0.0.1`) : le fetch reste en cours jusqu'à son délai ; un commit local doit aboutir avant.
 */

const FETCH_TIMEOUT_MS = 8_000

let root: string
let mute: net.Server
let sockets: Set<net.Socket>
let url: string
let repo: string
let g: GitBackend

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'gh337-fetchq-'))
  sockets = new Set()
  mute = net.createServer(sock => {
    sockets.add(sock)
    sock.on('error', () => undefined)
    sock.on('close', () => sockets.delete(sock))
  })
  await new Promise<void>(resolve => mute.listen(0, '127.0.0.1', resolve))
  const { port } = mute.address() as net.AddressInfo
  url = `http://127.0.0.1:${port}/repo.git`

  repo = path.join(root, 'w')
  g = gitFor(repo)
  await g.init('main')
  fs.writeFileSync(path.join(repo, 'a.txt'), 'v1\n')
  await g.addAll()
  await g.commit({ message: 'init', author: { name: 'T', email: 't@x' } })
  await g.addRemote('origin', url)
})

afterEach(async () => {
  for (const s of sockets) s.destroy()
  await new Promise<void>(resolve => mute.close(() => resolve()))
  await closeRepo(repo)
  fs.rmSync(root, { recursive: true, force: true })
})

afterAll(() => closeAll())

describe('GH337 P6 — fetch lent et écritures locales', () => {
  it('un commit local aboutit pendant qu\'un fetch muet est encore en cours', async () => {
    let fetchSettled = false
    const fetching = g.fetch('origin', { timeoutMs: FETCH_TIMEOUT_MS })
      .catch(() => undefined)
      .finally(() => { fetchSettled = true })

    fs.writeFileSync(path.join(repo, 'a.txt'), 'v2\n')
    await g.addAll()
    await g.commit({ message: 'local pendant fetch', author: { name: 'T', email: 't@x' } })

    expect(fetchSettled).toBe(false)
    await fetching
  }, 30_000)
})
