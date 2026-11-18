import { spawn, type ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeAll, closeUnder, liveProcessCount, track } from './process-registry'

// GH337 §5.7 / critère 7 — aucun processus git ne survit à la fermeture (design §3).

const SLEEP = 'setInterval(() => {}, 1000)'
const dirs: string[] = []

function tempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gh337-proc-'))
  dirs.push(d)
  return d
}

function spawnSleeper(repo: string | null): ChildProcess {
  const child = spawn(process.execPath, ['-e', SLEEP], { cwd: repo ?? os.tmpdir(), windowsHide: true, stdio: 'ignore' })
  track(child, repo)
  return child
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

afterEach(async () => {
  await closeAll()
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

describe('process-registry — arrêt des processus', () => {
  it('closeAll : aucun processus enregistré ne reste (liveProcessCount() === 0)', async () => {
    const repoA = tempDir()
    const repoB = tempDir()
    spawnSleeper(repoA)
    spawnSleeper(repoB)
    spawnSleeper(null)
    expect(liveProcessCount()).toBe(3)

    await closeAll()

    expect(liveProcessCount()).toBe(0)
  })

  it('closeUnder : ne ferme que les processus dont le dépôt est sous le dossier donné', async () => {
    const userRoot = tempDir()
    const userRepo = path.join(userRoot, 'workspaces', 'repo')
    const otherRepo = tempDir()
    fs.mkdirSync(userRepo, { recursive: true })
    spawnSleeper(userRepo)
    spawnSleeper(otherRepo)
    expect(liveProcessCount()).toBe(2)

    await closeUnder(userRoot)

    expect(liveProcessCount()).toBe(1)
  })

  it.skipIf(process.platform !== 'win32')('closeAll arrête aussi les descendants (taskkill /T) : un petit-enfant ne survit pas', async () => {
    // Le parent lance un enfant (comme git lance git-remote-https) et écrit son PID sur stdout.
    const script = `
      const { spawn } = require('child_process');
      const c = spawn(process.execPath, ['-e', ${JSON.stringify(SLEEP)}], { stdio: 'ignore' });
      process.stdout.write(String(c.pid) + '\\n');
      ${SLEEP};
    `
    const parent = spawn(process.execPath, ['-e', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    track(parent, null)
    const grandchildPid = await new Promise<number>((resolve, reject) => {
      parent.stdout!.once('data', (chunk: Buffer) => resolve(Number(String(chunk).trim())))
      parent.once('error', reject)
    })
    expect(isAlive(grandchildPid)).toBe(true)

    await closeAll()

    expect(liveProcessCount()).toBe(0)
    expect(isAlive(grandchildPid)).toBe(false)
  }, 20_000)
})
