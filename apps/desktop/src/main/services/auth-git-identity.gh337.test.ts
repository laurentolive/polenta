import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AuthService } from './auth.service'
import type { HostContext, TokenStore } from '../host/host-context'
import { configureGitHome, gitGlobalConfigPath } from '../git/git-config'

/**
 * GH337 P3 — la config globale de Polenta suit le compte actif à chaque changement (connexion,
 * déconnexion), pas seulement au démarrage (spec §2.2).
 */

class MapTokenStore implements TokenStore {
  readonly map = new Map<string, string>()
  async get(k: string) { return this.map.get(k) ?? null }
  async set(k: string, v: string) { this.map.set(k, v) }
  async delete(k: string) { return this.map.delete(k) }
}

let dir: string
let tokens: MapTokenStore
let auth: AuthService

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-auth-gitid-'))
  configureGitHome(path.join(dir, 'git'))
  tokens = new MapTokenStore()
  const host: HostContext = { userDataDir: dir, tokenStore: tokens, machineConfig: { hideGithub: false }, deviceLabel: 'PC-Test 01' }
  auth = new AuthService(host)
})

afterEach(async () => {
  await fsP.rm(dir, { recursive: true, force: true })
})

const globalConfig = (): string => fs.readFileSync(gitGlobalConfigPath(), 'utf8')

describe('identité git suit le compte actif', () => {
  it('connexion puis déconnexion : [user] correspond au compte courant, puis disparaît sans compte', async () => {
    const octo = { remoteHost: 'github.com', username: 'octo', name: 'Octo', email: 'o@x' }
    const bob = { remoteHost: 'forge.test', username: 'bob', name: 'Bob Martin', email: 'bob@acme.fr', provider: 'forgejo' as const, baseUrl: 'https://forge.test' }
    tokens.map.set('github.com:octo', 'ghp_x')
    tokens.map.set('forge.test:bob', 'tok-bob')

    await auth.saveAccount(octo)
    expect(globalConfig()).toContain('\tname = "Octo"')

    await auth.saveAccount(bob)
    expect(globalConfig()).toContain('\tname = "Bob Martin"')
    expect(globalConfig()).toContain('\temail = "bob@acme.fr"')

    await auth.logout()
    expect(globalConfig()).toContain('\tname = "Octo"')

    await auth.logout()
    expect(globalConfig()).not.toContain('[user]')
  })
})
