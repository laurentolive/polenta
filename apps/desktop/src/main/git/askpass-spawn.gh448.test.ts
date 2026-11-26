import { spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, describe, expect, it } from 'vitest'

import { askpassDir, closeAskpassServer, openAskpassSession } from './askpass'
import { gitInstall } from './git-binary'

/**
 * GH448 — git exécute `GIT_ASKPASS` directement (sans shell) : un chemin cité n'est pas trouvé
 * (« cannot spawn "…askpass.sh": Permission denied ») et toute opération HTTPS avec identifiant échoue.
 * Vérifié avec le git embarqué : `git credential fill` interroge GIT_ASKPASS comme le ferait un fetch.
 */

const tmpRoots: string[] = []
afterAll(async () => {
  await closeAskpassServer()
  for (const d of tmpRoots) fs.rmSync(d, { recursive: true, force: true })
})

/** `git credential fill` pour https://example.test, sans helper : seul GIT_ASKPASS peut répondre. */
function credentialFill(env: Record<string, string>): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // Asynchrone : le serveur d'identifiants tourne dans ce même processus.
    const child = spawn(gitInstall().gitExe, ['-c', 'credential.helper=', 'credential', 'fill'], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env },
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })
    child.on('error', reject)
    child.on('close', code => resolve({ code, stdout, stderr }))
    child.stdin.end('protocol=https\nhost=example.test\n\n')
  })
}

describe('GH448 — git lance le shim askpass de la session', () => {
  it('GIT_ASKPASS est un chemin brut (non cité)', async () => {
    const session = await openAskpassSession(async () => null)
    try {
      expect(session.env.GIT_ASKPASS).toBe(path.join(askpassDir(), 'askpass.sh'))
    } finally {
      session.revoke()
    }
  })

  it('git obtient identifiant et mot de passe par le shim', async () => {
    const session = await openAskpassSession(async () => ({ username: 'alice', password: 'pw' }))
    try {
      const run = await credentialFill(session.env)
      expect(run.stderr).not.toMatch(/cannot spawn/)
      expect(run.code).toBe(0)
      expect(run.stdout).toContain('username=alice')
      expect(run.stdout).toContain('password=pw')
    } finally {
      session.revoke()
    }
  }, 30_000)

  it('depuis un dossier avec espace (profil « Jean Dupont »)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gh448 espace '))
    tmpRoots.push(root)
    const dir = path.join(root, 'Jean Dupont', 'askpass')
    fs.mkdirSync(dir, { recursive: true })
    for (const f of ['askpass.sh', 'askpass.js']) fs.copyFileSync(path.join(askpassDir(), f), path.join(dir, f))
    if (process.platform !== 'win32') fs.chmodSync(path.join(dir, 'askpass.sh'), 0o755)

    const session = await openAskpassSession(async () => ({ username: 'bob', password: 'pw2' }))
    try {
      const run = await credentialFill({
        ...session.env,
        GIT_ASKPASS: path.join(dir, 'askpass.sh'),
        POLENTA_ASKPASS_JS: path.join(dir, 'askpass.js'),
      })
      expect(run.stderr).not.toMatch(/cannot spawn/)
      expect(run.stdout).toContain('username=bob')
      expect(run.stdout).toContain('password=pw2')
    } finally {
      session.revoke()
    }
  }, 30_000)
})
