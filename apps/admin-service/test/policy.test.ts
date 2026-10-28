// GH63 — politique du proxy Docker (scénarios S2-15 à S2-18).
import { describe, expect, it } from 'vitest'
import { decide, needsBody, stripVersion, type Resolver } from '../src/docker-proxy/policy'

const containers: Record<string, { name: string; project?: string }> = {
  'forgejo-acme': { name: 'forgejo-acme', project: 'polenta-acme' },
  abc123: { name: 'forgejo-acme', project: 'polenta-acme' },
  'polenta-web-acme': { name: 'polenta-web-acme', project: 'polenta-acme' },
  'autre-projet-db': { name: 'autre-projet-db', project: 'autre-projet' },
}
const resolver: Resolver = {
  container: async (id) => containers[id] ?? null,
  network: async (id) => ({ name: id }),
}
const req = (method: string, path: string, body: Record<string, unknown> | null = null) => {
  const u = new URL(path, 'http://docker')
  return decide({ method, path: u.pathname, query: u.searchParams, body }, resolver, { edgeNetwork: 'edge-ext' })
}
const create = (hostConfig: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  req('POST', '/v1.47/containers/create?name=forgejo-acme', { Image: 'forgejo', HostConfig: hostConfig, ...extra })

describe('proxy Docker — créations refusées (S2-15)', () => {
  it.each([
    ['Privileged', { Privileged: true }],
    ['Binds /', { Binds: ['/:/host'] }],
    ['Binds /etc', { Binds: ['/etc:/x'] }],
    ['Binds socket', { Binds: ['/var/run/docker.sock:/var/run/docker.sock'] }],
    ['Binds remontée', { Binds: ['/opt/polenta/../etc:/x'] }],
    ['Binds hors kit', { Binds: ['/home/user:/x'] }],
    ['NetworkMode host', { NetworkMode: 'host' }],
    ['CapAdd', { CapAdd: ['SYS_ADMIN'] }],
    ['PidMode host', { PidMode: 'host' }],
    ['Devices', { Devices: [{ PathOnHost: '/dev/sda' }] }],
    ['SecurityOpt', { SecurityOpt: ['seccomp=unconfined'] }],
    ['Mounts bind /root', { Mounts: [{ Type: 'bind', Source: '/root', Target: '/x' }] }],
    ['localtime en écriture', { Binds: ['/etc/localtime:/etc/localtime'] }],
  ])('%s', async (_n, hc) => {
    const d = await create(hc)
    expect(d.allow).toBe(false)
  })

  it('nom de conteneur hors kit', async () => {
    const d = await req('POST', '/containers/create?name=pirate', { HostConfig: {} })
    expect(d).toMatchObject({ allow: false })
  })

  it('réseau du proxy refusé', async () => {
    const d = await create({}, { NetworkingConfig: { EndpointsConfig: { 'polenta-docker-proxy-net': {} } } })
    expect(d.allow).toBe(false)
  })

  it('création conforme au compose d\'instance autorisée', async () => {
    const d = await create(
      { Binds: ['/opt/polenta/instances/acme/data:/data:rw', '/etc/localtime:/etc/localtime:ro'], NetworkMode: 'polenta-acme' },
      { NetworkingConfig: { EndpointsConfig: { 'polenta-acme': {}, 'polenta-admin-net': {}, 'edge-ext': {} } } },
    )
    expect(d).toEqual({ allow: true })
  })
})

describe('proxy Docker — chemins refusés (S2-16)', () => {
  it.each([
    ['POST', '/build'],
    ['POST', '/swarm/init'],
    ['POST', '/plugins/pull'],
    ['POST', '/containers/prune'],
    ['POST', '/commit'],
    ['GET', '/system/df'],
    ['DELETE', '/images/forgejo'],
    ['POST', '/images/forgejo/push'],
    ['GET', '/inconnu'],
  ])('%s %s', async (m, p) => {
    expect((await req(m, p)).allow).toBe(false)
  })

  it('volume hors polenta-*', async () => {
    expect((await req('POST', '/volumes/create', { Name: 'pirate' })).allow).toBe(false)
    expect((await req('POST', '/volumes/create', { Name: 'polenta-x' })).allow).toBe(true)
  })
})

describe('proxy Docker — usage du kit autorisé (S2-17)', () => {
  it.each([
    ['HEAD', '/_ping'],
    ['GET', '/v1.47/version'],
    ['GET', '/containers/json?all=1'],
    ['GET', '/containers/forgejo-acme/json'],
    ['GET', '/containers/abc123/logs?tail=50'],
    ['POST', '/containers/forgejo-acme/stop'],
    ['POST', '/containers/forgejo-acme/start'],
    ['POST', '/containers/forgejo-acme/restart'],
    ['DELETE', '/containers/polenta-web-acme?force=1'],
    ['POST', '/exec/deadbeef/start'],
    ['GET', '/exec/deadbeef/json'],
    ['POST', '/images/create?fromImage=codeberg.org/forgejo/forgejo&tag=11'],
    ['GET', '/networks/polenta-acme'],
    ['DELETE', '/networks/polenta-acme'],
    ['POST', '/containers/forgejo-acme/rename?name=0123456789ab_forgejo-acme'],
  ])('%s %s', async (m, p) => {
    expect(await req(m, p, {})).toEqual({ allow: true })
  })

  it('exec et création de réseau', async () => {
    expect(await req('POST', '/containers/forgejo-acme/exec', { Cmd: ['forgejo', 'dump'] })).toEqual({ allow: true })
    expect(await req('POST', '/networks/create', { Name: 'polenta-acme', Driver: 'bridge' })).toEqual({ allow: true })
    expect((await req('POST', '/containers/forgejo-acme/exec', { Privileged: true })).allow).toBe(false)
  })
})

describe('proxy Docker — conteneurs étrangers (S2-18)', () => {
  it.each([
    ['POST', '/containers/autre-projet-db/exec'],
    ['POST', '/containers/autre-projet-db/stop'],
    ['DELETE', '/containers/autre-projet-db'],
    ['GET', '/containers/inexistant/json'],
  ])('%s %s', async (m, p) => {
    expect((await req(m, p, {})).allow).toBe(false)
  })

  it('rattachement d\'un conteneur étranger à un réseau du kit', async () => {
    expect((await req('POST', '/networks/polenta-acme/connect', { Container: 'autre-projet-db' })).allow).toBe(false)
    expect((await req('POST', '/networks/polenta-acme/connect', { Container: 'forgejo-acme' })).allow).toBe(true)
    expect((await req('POST', '/networks/autre/connect', { Container: 'forgejo-acme' })).allow).toBe(false)
  })
})

describe('outils', () => {
  it('préfixe de version et corps à inspecter', () => {
    expect(stripVersion('/v1.47/containers/json')).toBe('/containers/json')
    expect(needsBody('POST', '/v1.47/containers/create')).toBe(true)
    expect(needsBody('POST', '/networks/polenta-acme/connect')).toBe(true)
    expect(needsBody('GET', '/containers/json')).toBe(false)
  })
})
