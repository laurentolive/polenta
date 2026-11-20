import { execFile, spawnSync } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, describe, expect, it } from 'vitest'

import { askpassDir, closeAskpassServer, openAskpassSession, shellQuote } from './askpass'

/**
 * GH337 revue (point 2) — git exécute `GIT_ASKPASS` via le shell : un chemin avec espace (profil Windows
 * « Jean Dupont ») doit arriver intact au shim. Vérifié avec le vrai `sh` quand il est disponible.
 */

const hasSh = spawnSync('sh', ['-c', 'exit 0']).status === 0
const tmpRoots: string[] = []
afterAll(async () => {
  await closeAskpassServer()
  for (const d of tmpRoots) fs.rmSync(d, { recursive: true, force: true })
})

describe('GH337 revue — citation des chemins d’askpass', () => {
  it('shellQuote : la valeur produite est citée et reste identique après passage par sh', () => {
    const value = 'C:\\Users\\Jean Dupont\\a$b`c"d\\e'
    expect(shellQuote('C:\\Users\\Jean Dupont\\askpass.sh')).toBe('"C:\\\\Users\\\\Jean Dupont\\\\askpass.sh"')
    if (!hasSh) return
    const out = spawnSync('sh', ['-c', `printf '%s' ${shellQuote(value)}`], { encoding: 'utf8' })
    expect(out.stdout).toBe(value)
  })

  it('la session pose GIT_ASKPASS cité, et SSH_ASKPASS / POLENTA_ASKPASS_JS non cités', async () => {
    const session = await openAskpassSession(async () => null)
    try {
      const dir = askpassDir()
      expect(session.env.GIT_ASKPASS).toBe(shellQuote(path.join(dir, 'askpass.sh')))
      expect(session.env.SSH_ASKPASS).toBe(path.join(dir, 'askpass.sh'))
      expect(session.env.POLENTA_ASKPASS_JS).toBe(path.join(dir, 'askpass.js'))
    } finally {
      session.revoke()
    }
  })

  it.skipIf(!hasSh)('le shim se lance via sh depuis un dossier avec espace (valeur citée)', async () => {
    // Copie des shims dans « dossier avec espace » ; GIT_ASKPASS cité, lancé comme le fait git (sh -c).
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gh337 espace '))
    tmpRoots.push(root)
    const dir = path.join(root, 'Jean Dupont', 'askpass')
    fs.mkdirSync(dir, { recursive: true })
    for (const f of ['askpass.sh', 'askpass.js']) fs.copyFileSync(path.join(askpassDir(), f), path.join(dir, f))

    const session = await openAskpassSession(async () => ({ username: 'alice', password: 'pw' }))
    try {
      const prompt = "Username for 'https://example.test': "
      const env = {
        ...process.env,
        ...session.env,
        GIT_ASKPASS: shellQuote(path.join(dir, 'askpass.sh')),
        POLENTA_ASKPASS_JS: path.join(dir, 'askpass.js'),
      }
      // Asynchrone : le serveur d'identifiants tourne dans ce même processus (un spawnSync le bloquerait).
      const run = await promisify(execFile)('sh', ['-c', `${env.GIT_ASKPASS} ${shellQuote(prompt)}`], { env, encoding: 'utf8', timeout: 20_000 })
      expect(run.stdout.trim()).toBe('alice')
    } finally {
      session.revoke()
    }
  })
})
