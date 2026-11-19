import { spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { describe, expect, it } from 'vitest'

import { groupSpawnOptions, killTree, liveProcessCount, track } from './process-registry'

/**
 * GH337 P8 — hors Windows, un processus git tourne dans son propre groupe et `killTree` signale le groupe :
 * ses descendants (`git-remote-https`, `ssh`) ne survivent plus au délai, à l'annulation ou à la fermeture.
 * Sous Windows, `taskkill /T` suit l'arbre : les options restent celles d'avant (pas de `detached`).
 */

const POSIX = process.platform !== 'win32'

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitFor(cond: () => boolean, ms: number): Promise<boolean> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (cond()) return true
    await new Promise(r => setTimeout(r, 50))
  }
  return cond()
}

describe('GH337 P8 — options de spawn', () => {
  it('Windows : pas de detached (taskkill /T suit l\'arbre) ; POSIX : detached', () => {
    expect(groupSpawnOptions()).toEqual({ detached: process.platform !== 'win32' })
  })
})

describe.skipIf(!POSIX)('GH337 P8 — killTree signale le groupe (POSIX)', () => {
  it('le petit-enfant meurt avec son parent', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh337-pgroup-'))
    const pidFile = path.join(dir, 'grandchild.pid')
    // sh lance un sleep en arrière-plan (petit-enfant), note son pid, puis attend.
    const child = spawn('sh', ['-c', `sleep 60 & echo $! > "${pidFile}"; wait`], { stdio: 'ignore', ...groupSpawnOptions() })
    track(child, null)
    try {
      expect(await waitFor(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8').trim() !== '', 5000)).toBe(true)
      const grandchild = Number(fs.readFileSync(pidFile, 'utf8').trim())
      expect(alive(grandchild)).toBe(true)

      killTree(child)
      const exited = await waitFor(() => child.exitCode !== null || child.signalCode !== null, 5000)
      expect(exited).toBe(true)
      expect(await waitFor(() => !alive(grandchild), 5000)).toBe(true)
      expect(liveProcessCount()).toBe(0)
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, 20_000)
})
