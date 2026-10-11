import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AuthService } from './auth.service'
import { AppSettingsService } from './app-settings.service'
import type { HostContext, TokenStore } from '../host/host-context'
import { startFakeForge, SIGNED_IN_ONLY, type FakeForge } from './forge/fake-forge.test-util'

class MapTokenStore implements TokenStore {
  readonly map = new Map<string, string>()
  async get(k: string) { return this.map.get(k) ?? null }
  async set(k: string, v: string) { this.map.set(k, v) }
  async delete(k: string) { return this.map.delete(k) }
}

const PASSWORD = 'S3cret-Passw0rd!'
let dir: string
let tokens: MapTokenStore
let auth: AuthService
let forge: FakeForge

function host(): HostContext {
  return { userDataDir: dir, tokenStore: tokens, machineConfig: { hideGithub: false }, deviceLabel: 'PC-Test 01' }
}

function forgejoRoutes(user: { status: number; json?: unknown } = { status: 200, json: { login: 'bob', full_name: 'Bob Martin', email: 'bob@acme.fr' } }) {
  forge.route('GET', '/api/v1/version', () => SIGNED_IN_ONLY)
  forge.route('GET', '/api/forgejo/v1/version', () => SIGNED_IN_ONLY)
  forge.route('POST', '/api/v1/users/bob/tokens', () => ({ status: 201, json: { sha1: 'tok-bob' } }))
  forge.route('GET', '/api/v1/user', () => user)
}

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-auth-'))
  tokens = new MapTokenStore()
  auth = new AuthService(host())
  forge = await startFakeForge()
})

afterEach(async () => {
  await forge.close()
  await fsP.rm(dir, { recursive: true, force: true })
})

const forgeHost = () => new URL(forge.baseUrl).hostname

describe('connexion par mot de passe (Forgejo/Gitea)', () => {
  it('crée le compte forgejo, stocke le jeton, jamais le mot de passe', async () => {
    forgejoRoutes()
    const result = await auth.loginWithPassword(forge.baseUrl, 'bob', PASSWORD)
    expect(result).toEqual({
      status: 'ok',
      account: { key: `${forgeHost()}:bob`, provider: 'forgejo', baseUrl: forge.baseUrl, host: forgeHost(), login: 'bob', name: 'Bob Martin', email: 'bob@acme.fr' },
    })
    expect(tokens.map.get(`${forgeHost()}:bob`)).toBe('tok-bob')
    const authJson = await fsP.readFile(path.join(dir, 'auth.json'), 'utf-8')
    expect(authJson).not.toContain(PASSWORD)
    expect([...tokens.map.values()]).not.toContain(PASSWORD)
    expect(JSON.parse(forge.requests.find(r => r.path.endsWith('/tokens'))!.body).name).toMatch(/^polenta-pc-test-01-\d{8}-\d{4}-[0-9a-f]{4}$/)
    expect(await auth.currentAccount()).toMatchObject({ provider: 'forgejo', login: 'bob' })
    expect(await auth.hasAnyAccount()).toBe(true)
  })

  it('identité introuvable : la connexion échoue, aucun compte « Git User » créé', async () => {
    forgejoRoutes({ status: 500 })
    const result = await auth.loginWithPassword(forge.baseUrl, 'bob', PASSWORD)
    expect(result.status).toBe('network')
    expect(JSON.stringify(result)).not.toContain(PASSWORD)
    expect(await auth.currentAccount()).toBeNull()
    expect(await auth.hasAnyAccount()).toBe(false)
  })

  it('serveur qui n’est pas une forge → not-a-forge, aucun appel de création de jeton', async () => {
    const result = await auth.loginWithPassword(forge.baseUrl, 'bob', PASSWORD)
    expect(result).toEqual({ status: 'not-a-forge' })
    expect(forge.requests.some(r => r.path.endsWith('/tokens'))).toBe(false)
  })

  it('une connexion réussie lève l’état « accès révoqué » de l’hôte', async () => {
    forgejoRoutes()
    auth.markAccessRevoked(forgeHost())
    await auth.loginWithPassword(forge.baseUrl, 'bob', PASSWORD)
    expect(auth.isAccessRevoked(forgeHost())).toBe(false)
  })
})

describe('comptes', () => {
  it('compte antérieur à GH45 (sans provider) : github.com → github', async () => {
    await fsP.writeFile(path.join(dir, 'auth.json'), JSON.stringify({
      accounts: [{ remoteHost: 'github.com', username: 'octo', name: 'Octo', email: 'o@x' }],
      defaultAccount: 'github.com:octo',
    }))
    await tokens.set('github.com', 'ghp_x')
    expect(await auth.currentAccount()).toEqual({
      key: 'github.com:octo', provider: 'github', baseUrl: 'https://github.com', host: 'github.com',
      login: 'octo', name: 'Octo', email: 'o@x',
    })
  })

  it('déconnexion : jetons et compte retirés, le compte suivant devient courant', async () => {
    await fsP.writeFile(path.join(dir, 'auth.json'), JSON.stringify({
      accounts: [
        { remoteHost: 'github.com', username: 'octo', name: 'Octo', email: 'o@x' },
        { remoteHost: forgeHost(), username: 'bob', name: 'Bob', email: 'b@x', provider: 'forgejo', baseUrl: forge.baseUrl },
      ],
      defaultAccount: `${forgeHost()}:bob`,
    }))
    await tokens.set('github.com', 'ghp_x')
    await tokens.set(forgeHost(), 'tok-bob')
    await tokens.set(`${forgeHost()}:bob`, 'tok-bob')
    await auth.logout()
    expect(tokens.map.has(`${forgeHost()}:bob`)).toBe(false)
    expect(tokens.map.has(forgeHost())).toBe(false)
    expect(tokens.map.get('github.com')).toBe('ghp_x')
    expect((await auth.currentAccount())?.login).toBe('octo')
  })

  it('jeton « nu » d’une ancienne version, sans compte : la déconnexion le retire', async () => {
    await tokens.set('github.com', 'ghp_legacy')
    expect(await auth.hasAnyAccount()).toBe(true)
    await auth.logout()
    expect(await auth.hasAnyAccount()).toBe(false)
  })

  it('compte par défaut sans jeton : le compte courant est un compte qui en a un (cohérent avec hasAnyAccount)', async () => {
    await fsP.writeFile(path.join(dir, 'auth.json'), JSON.stringify({
      accounts: [
        { remoteHost: 'github.com', username: 'octo', name: 'Octo', email: 'o@x' },
        { remoteHost: forgeHost(), username: 'bob', name: 'Bob', email: 'b@x', provider: 'forgejo', baseUrl: forge.baseUrl },
      ],
      defaultAccount: 'github.com:octo',
    }))
    await tokens.set(`${forgeHost()}:bob`, 'tok-bob')
    expect((await auth.currentAccount())?.login).toBe('bob')
    expect(await auth.hasAnyAccount()).toBe(true)
  })

  it('page de changement de mot de passe : seulement celle annoncée par la forge, aucune URL fournie', async () => {
    const opened: string[] = []
    const a = new AuthService({ ...host(), openExternal: async url => { opened.push(url) } })
    await expect(a.openPasswordChange()).rejects.toThrow(/Aucun changement/)
    forge.route('GET', '/api/v1/version', () => SIGNED_IN_ONLY)
    forge.route('GET', '/api/forgejo/v1/version', () => SIGNED_IN_ONLY)
    forge.route('POST', '/api/v1/users/neuf/tokens', () => ({
      status: 403, json: { message: `You must change your password. Change it at: ${forge.baseUrl}//user/change_password` },
    }))
    const result = await a.loginWithPassword(forge.baseUrl, 'neuf', PASSWORD)
    expect(result).toEqual({ status: 'password-change-required', url: `${forge.baseUrl}/user/change_password` })
    await a.openPasswordChange()
    expect(opened).toEqual([`${forge.baseUrl}/user/change_password`])
  })

  it('auteur des commits : le compte de l’hôte d’origin, pas le compte par défaut', async () => {
    await fsP.writeFile(path.join(dir, 'auth.json'), JSON.stringify({
      accounts: [
        { remoteHost: forgeHost(), username: 'bob', name: 'Bob Martin', email: 'bob@acme.fr', provider: 'forgejo', baseUrl: forge.baseUrl },
        { remoteHost: 'github.com', username: 'octo', name: 'Octo', email: 'o@x' },
      ],
      defaultAccount: 'github.com:octo',
    }))
    const repo = path.join(dir, 'repo')
    await git.init({ fs, dir: repo, defaultBranch: 'main' })
    await git.addRemote({ fs, dir: repo, remote: 'origin', url: `${forge.baseUrl}/acme/essai.git` })
    expect(await auth.getAuthor(repo)).toEqual({ name: 'Bob Martin', email: 'bob@acme.fr' })
    await git.deleteRemote({ fs, dir: repo, remote: 'origin' })
    expect(await auth.getAuthor(repo)).toEqual({ name: 'Octo', email: 'o@x' })
  })
})

describe('mises à jour verrouillées par la configuration machine', () => {
  it('autoUpdate: false → autoCheckUpdates forcé à false, non modifiable, verrou jamais écrit', () => {
    const settings = new AppSettingsService(dir, { hideGithub: true, autoUpdate: false })
    expect(settings.get()).toMatchObject({ autoCheckUpdates: false, autoCheckUpdatesLocked: true })
    expect(settings.set({ autoCheckUpdates: true }).autoCheckUpdates).toBe(false)
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'app-settings.json'), 'utf-8'))
    expect(written.autoCheckUpdatesLocked).toBeUndefined()
  })

  it('sans configuration machine : préférence libre', () => {
    const settings = new AppSettingsService(dir)
    expect(settings.set({ autoCheckUpdates: false }).autoCheckUpdates).toBe(false)
    expect(settings.get().autoCheckUpdatesLocked).toBeUndefined()
  })
})
