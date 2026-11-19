import * as fs from 'fs'
import * as net from 'net'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { gitClone, gitFor, gitLsRemoteHeads } from './git-backend'
import { GitError } from './git-errors'
import { liveProcessCount } from './process-registry'

/**
 * GH337 sprint 5 — délai réseau natif (GH15, design §4) : sur un lien qui ne répond pas, une opération
 * s'arrête avec une `GitError` de kind `timeout` au lieu de bloquer, et le processus git est terminé.
 *
 * Le délai de production (300 s × réglage GH15) n'est pas touché : l'option `timeoutMs` de
 * `NetworkOptions` (déjà transmise à `netRun` par fetch, clone, ls-remote) porte un délai court ici.
 * Le serveur est un vrai socket TCP sur `127.0.0.1` qui accepte la connexion et ne répond jamais.
 */

const SHORT_TIMEOUT_MS = 1500
const MUST_STOP_WITHIN_MS = 20_000

let root: string
let mute: net.Server
let sockets: Set<net.Socket>
let url: string

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'gh337-timeout-'))
  sockets = new Set()
  mute = net.createServer(sock => {
    sockets.add(sock)
    sock.on('error', () => undefined)
    sock.on('close', () => sockets.delete(sock))
    // Silence volontaire : la requête HTTP de git n'obtient jamais de réponse.
  })
  await new Promise<void>(resolve => mute.listen(0, '127.0.0.1', resolve))
  const { port } = mute.address() as net.AddressInfo
  url = `http://127.0.0.1:${port}/repo.git`
})

afterEach(async () => {
  for (const s of sockets) s.destroy()
  await new Promise<void>(resolve => mute.close(() => resolve()))
  fs.rmSync(root, { recursive: true, force: true })
})

/** Attend l'erreur de l'opération et vérifie qu'elle est un délai, arrivé dans le temps imparti. */
async function expectTimeout(run: () => Promise<unknown>): Promise<GitError> {
  const started = Date.now()
  const err = await run().then(() => null, (e: unknown) => e)
  const elapsed = Date.now() - started
  expect(err).toBeInstanceOf(GitError)
  expect((err as GitError).kind).toBe('timeout')
  expect(elapsed).toBeLessThan(MUST_STOP_WITHIN_MS)
  return err as GitError
}

describe('délai réseau natif (GH15) — arrêt à temps avec une erreur timeout', () => {
  it('ls-remote sur un serveur muet : timeout, processus git terminé', async () => {
    await expectTimeout(() => gitLsRemoteHeads(url, { timeoutMs: SHORT_TIMEOUT_MS }))
    expect(liveProcessCount()).toBe(0)
  })

  it('fetch sur un remote muet : timeout, processus git terminé', async () => {
    const dir = path.join(root, 'w')
    const g = gitFor(dir)
    await g.init('main')
    await g.addRemote('origin', url)
    await expectTimeout(() => g.fetch('origin', { timeoutMs: SHORT_TIMEOUT_MS }))
    expect(liveProcessCount()).toBe(0)
  })

  it('clone sur un serveur muet : timeout, processus git terminé', async () => {
    await expectTimeout(() => gitClone(url, path.join(root, 'clone'), { timeoutMs: SHORT_TIMEOUT_MS }))
    expect(liveProcessCount()).toBe(0)
  })
})
