import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyNetworkTimeoutToGit, gitGlobalConfigPath, initGitHome } from './git-config'
import { NETWORK_TIMEOUT_DEFAULT } from '../../shared/network-timeout'
import { setNetworkTimeoutSeconds } from '../services/net-timeouts'

/**
 * GH337 P3 — initialisation de la config git de Polenta au démarrage : la config globale est dans le
 * dossier userData (et non tmpdir), contient `[user]` quand un compte est actif, et `http.lowSpeedTime`
 * suit le réglage réseau GH15.
 */

let userData: string

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'gh337-gitcfg-'))
})

afterEach(() => {
  setNetworkTimeoutSeconds(NETWORK_TIMEOUT_DEFAULT)
  fs.rmSync(userData, { recursive: true, force: true })
})

describe('GH337 P3 — initialisation de la config git', () => {
  it('config globale dans userData, avec [user] quand un compte est actif', async () => {
    await initGitHome(path.join(userData, 'git'), async () => ({ name: 'Alice Martin', email: 'alice@example.test' }))
    const file = gitGlobalConfigPath()
    expect(file.startsWith(path.join(userData, 'git'))).toBe(true)
    expect(fs.existsSync(file)).toBe(true)
    const text = fs.readFileSync(file, 'utf8')
    expect(text).toContain('[user]')
    expect(text).toContain('\tname = "Alice Martin"')
    expect(text).toContain('\temail = "alice@example.test"')
  })

  it('sans compte actif : pas de [user] (le repli est celui de Polenta, pas un nom inventé)', async () => {
    await initGitHome(path.join(userData, 'git-anon'), async () => null)
    const text = fs.readFileSync(gitGlobalConfigPath(), 'utf8')
    expect(text).not.toContain('[user]')
  })

  it('un lookup qui échoue : config écrite sans [user], pas d\'exception', async () => {
    await expect(initGitHome(path.join(userData, 'git-err'), async () => { throw new Error('keychain') })).resolves.toBeUndefined()
    expect(fs.readFileSync(gitGlobalConfigPath(), 'utf8')).not.toContain('[user]')
  })

  it('http.lowSpeedTime suit le réglage GH15 (300 s × réglage / 10)', async () => {
    await initGitHome(path.join(userData, 'git-timeout'), async () => null)
    setNetworkTimeoutSeconds(20)
    applyNetworkTimeoutToGit()
    expect(fs.readFileSync(gitGlobalConfigPath(), 'utf8')).toContain('\tlowSpeedTime = 600')
  })
})
