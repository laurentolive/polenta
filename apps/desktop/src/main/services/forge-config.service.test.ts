import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AuthService } from './auth.service'
import { AppSettingsService } from './app-settings.service'
import { ForgeConfigService } from './forge-config.service'
import { inviteFromArgv, parseInviteLink } from '../host/invite-link'
import type { HostContext, TokenStore } from '../host/host-context'
import { startFakeForge, type FakeForge } from './forge/fake-forge.test-util'

class MapTokenStore implements TokenStore {
  readonly map = new Map<string, string>()
  async get(k: string) { return this.map.get(k) ?? null }
  async set(k: string, v: string) { this.map.set(k, v) }
  async delete(k: string) { return this.map.delete(k) }
}

let dir: string
let forge: FakeForge
let auth: AuthService
let service: ForgeConfigService

const CONFIG = `
defaults:
  projects: [{ repo: acme/demo }, { repo: acme/secret }]
teams:
  testeurs:
    projects: [{ repo: acme/essai }]
    preferences: { projectHome: campaigns }
  lecteurs:
    updates: managed
`

async function signIn(): Promise<void> {
  const host = new URL(forge.baseUrl).hostname
  await fsP.writeFile(path.join(dir, 'auth.json'), JSON.stringify({
    accounts: [{ remoteHost: host, username: 'bob', name: 'Bob', email: 'b@x', provider: 'forgejo', baseUrl: forge.baseUrl }],
    defaultAccount: `${host}:bob`,
  }))
}

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-cfg-'))
  forge = await startFakeForge()
  const tokens = new MapTokenStore()
  await tokens.set(`${new URL(forge.baseUrl).hostname}:bob`, 'tok')
  const ctx: HostContext = { userDataDir: dir, tokenStore: tokens, machineConfig: { hideGithub: false } }
  auth = new AuthService(ctx)
  service = new ForgeConfigService(auth, dir)
  forge.route('GET', '/api/v1/user/orgs', () => ({ status: 200, json: [{ username: 'acme' }] }))
  forge.route('GET', '/api/v1/user/teams', () => ({ status: 200, json: [{ name: 'testeurs', organization: { username: 'acme' } }, { name: 'Owners', organization: { username: 'autre' } }] }))
  forge.route('GET', '/api/v1/repos/acme/polenta-config/raw/config.yaml', () => ({ status: 200, text: CONFIG }))
})

afterEach(async () => {
  await forge.close()
  await fsP.rm(dir, { recursive: true, force: true })
})

describe('ForgeConfigService', () => {
  it('lit la configuration de l’organisation et la résout pour les équipes de l’utilisateur', async () => {
    await signIn()
    const status = await service.refresh()
    expect(status.org).toBe('acme')
    expect(status.config).toEqual({
      projects: [{ repo: 'acme/demo' }, { repo: 'acme/secret' }, { repo: 'acme/essai' }],
      updates: 'auto',
      preferences: { projectHome: 'campaigns' },
      teams: ['testeurs'],
    })
    expect(forge.requests.find(r => r.path.endsWith('config.yaml'))!.headers.authorization).toBe('token tok')
  })

  it('projets proposés : seulement ceux accessibles, avec leur URL de clone', async () => {
    await signIn()
    forge.route('GET', '/api/v1/repos/acme/demo', () => ({ status: 200, json: { clone_url: `${forge.baseUrl}/acme/demo.git` } }))
    forge.route('GET', '/api/v1/repos/acme/essai', () => ({ status: 200, json: { clone_url: `${forge.baseUrl}/acme/essai.git` } }))
    // acme/secret : 404 (pas d'accès)
    await service.refresh()
    expect((await service.teamProjects()).map(p => p.repo)).toEqual(['acme/demo', 'acme/essai'])
  })

  it('hors ligne : le cache s’applique, l’erreur est signalée (critère 25)', async () => {
    await signIn()
    await service.refresh()
    const url = forge.baseUrl
    await forge.close()
    const again = await service.refresh()
    expect(again.config?.preferences.projectHome).toBe('campaigns')
    expect(again.error).toBeTruthy()
    // Nouveau processus : cache relu depuis userData.
    expect(new ForgeConfigService(auth, dir).status().config?.teams).toEqual(['testeurs'])
    forge = await startFakeForge()
    expect(url).toBeTruthy()
  })

  it('YAML invalide : pas de configuration, erreur visible, rien de bloquant', async () => {
    await signIn()
    forge.route('GET', '/api/v1/repos/acme/polenta-config/raw/config.yaml', () => ({ status: 200, text: 'defaults: [' }))
    const status = await service.refresh()
    expect(status.config).toBeNull()
    expect(status.error).toBeTruthy()
  })

  it('plusieurs organisations avec une configuration : la plus ancienne (celle de l’entreprise)', async () => {
    await signIn()
    forge.route('GET', '/api/v1/user/orgs', () => ({ status: 200, json: [{ id: 9, username: 'aaa-perso' }, { id: 2, username: 'acme' }] }))
    forge.route('GET', '/api/v1/repos/aaa-perso/polenta-config/raw/config.yaml', () => ({ status: 200, text: 'defaults: { updates: auto }' }))
    expect((await service.refresh()).org).toBe('acme')
  })

  it('aucune organisation avec un repo de config : configuration vide', async () => {
    await signIn()
    forge.route('GET', '/api/v1/repos/acme/polenta-config/raw/config.yaml', () => ({ status: 404, json: { message: 'not found' } }))
    expect((await service.refresh()).config).toBeNull()
  })

  it('sans compte forge : aucune configuration, aucun appel réseau', async () => {
    expect((await service.refresh()).config).toBeNull()
    expect(forge.requests).toHaveLength(0)
  })

  it('updates: managed → mises à jour verrouillées ; le fichier DSI l’emporte aussi (critère 26)', async () => {
    await signIn()
    forge.route('GET', '/api/v1/user/teams', () => ({ status: 200, json: [{ name: 'lecteurs', organization: { username: 'acme' } }] }))
    await service.refresh()
    const settings = new AppSettingsService(dir, { hideGithub: false }, () => service.updatesManaged())
    expect(settings.get()).toMatchObject({ autoCheckUpdates: false, autoCheckUpdatesLocked: true })
    const dsi = new AppSettingsService(dir, { hideGithub: false, autoUpdate: false }, () => false)
    expect(dsi.get().autoCheckUpdatesLocked).toBe(true)
  })
})

describe('lien d’invitation (spec §3ter)', () => {
  it('lien valide, avec ou sans identifiant', () => {
    expect(parseInviteLink('polenta://connect?server=https%3A%2F%2Facme.forge.example.fr&login=bob'))
      .toEqual({ server: 'https://acme.forge.example.fr', login: 'bob' })
    expect(parseInviteLink('polenta://connect/?server=https://acme.forge.example.fr/user/login'))
      .toEqual({ server: 'https://acme.forge.example.fr' })
  })

  it.each([
    'polenta://connect?server=javascript:alert(1)',
    'polenta://connect?server=file:///C:/x',
    'polenta://connect?server=https://u:p@acme.example.fr',
    'polenta://connect?server=http://acme.example.fr&login=bob',     // jamais de mot de passe en clair
    'polenta://connect?login=bob',
    'polenta://login?server=https://acme.example.fr',
    'https://acme.example.fr',
    'polenta://connect?server=https://acme.example.fr&login=bob%20;rm',
  ])('refusé : %s', link => {
    expect(parseInviteLink(link)).toBeNull()
  })

  it('ligne de commande (Windows) : le premier lien valide', () => {
    expect(inviteFromArgv(['C:\\Polenta\\Polenta.exe', '--flag', 'polenta://connect?server=https://acme.example.fr&login=bob']))
      .toEqual({ server: 'https://acme.example.fr', login: 'bob' })
    expect(inviteFromArgv(['Polenta.exe'])).toBeNull()
  })
})
