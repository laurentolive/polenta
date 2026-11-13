import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  created: [] as { kind: 'Agent' | 'ProxyAgent'; opts: Record<string, unknown> }[],
  resolveProxy: vi.fn(async () => 'DIRECT'),
}))

vi.mock('electron', () => ({ session: { defaultSession: { resolveProxy: h.resolveProxy } } }))
vi.mock('undici', async importOriginal => {
  const actual = await importOriginal<typeof import('undici')>()
  class Agent { constructor(opts: Record<string, unknown>) { h.created.push({ kind: 'Agent', opts }) } }
  class ProxyAgent { constructor(opts: Record<string, unknown>) { h.created.push({ kind: 'ProxyAgent', opts }) } }
  return { ...actual, Agent, ProxyAgent }
})

import { matchesNoProxy, resolveProxyDispatcher } from './net-proxy'
import { setNetworkTimeoutSeconds } from './net-timeouts'

// GH347 — NO_PROXY : une cible exclue est contactée en direct, même avec HTTPS_PROXY.

describe('GH347 — matchesNoProxy', () => {
  it.each([
    ['http://127.0.0.1:8797/o/r.git', 'localhost,127.0.0.1'],
    ['http://localhost:3000/', 'localhost'],
    ['https://forge.corp.example/o/r.git', 'forge.corp.example'],
    ['https://forge.corp.example/', '.corp.example'],
    ['https://forge.corp.example/', 'corp.example'],
    ['https://forge.corp.example/', '*.corp.example'],
    ['https://FORGE.Corp.Example/', 'forge.corp.example'],
    ['https://forge.corp.example/', 'github.com forge.corp.example'],
    ['https://forge.corp.example/', ' github.com , forge.corp.example '],
    ['https://forge.corp.example:8443/', 'forge.corp.example:8443'],
    ['https://forge.corp.example/', 'forge.corp.example:443'],
    ['http://[::1]:8080/', '::1'],
    ['http://[::1]:8080/', '[::1]:8080'],
    ['https://github.com/', '*'],
  ])('%s exclu par « %s »', (url, noProxy) => {
    expect(matchesNoProxy(url, noProxy)).toBe(true)
  })

  it.each([
    ['https://github.com/o/r.git', 'localhost,127.0.0.1'],
    ['https://notcorp.example/', 'corp.example'],
    ['https://forge.corp.example:8443/', 'forge.corp.example:443'],
    ['https://github.com/', ''],
    ['https://github.com/', undefined],
    ['pas une url', 'github.com'],
    ['http://127.0.0.10/', '127.0.0.1'],
  ])('%s non exclu par « %s »', (url, noProxy) => {
    expect(matchesNoProxy(url, noProxy)).toBe(false)
  })
})

describe('GH347 — resolveProxyDispatcher', () => {
  const VARS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy']
  const saved: Record<string, string | undefined> = {}
  beforeEach(() => {
    for (const v of VARS) { saved[v] = process.env[v]; delete process.env[v] }
    h.created.length = 0
    h.resolveProxy.mockClear()
    setNetworkTimeoutSeconds(10)
  })
  afterEach(() => {
    for (const v of VARS) if (saved[v] === undefined) delete process.env[v]; else process.env[v] = saved[v]
  })

  it('HTTPS_PROXY + NO_PROXY : forge locale en direct, GitHub par le proxy', async () => {
    process.env['HTTPS_PROXY'] = 'http://gateway.corp.example:80'
    process.env['NO_PROXY'] = 'localhost,127.0.0.1'
    await resolveProxyDispatcher('http://127.0.0.1:8797/o/r.git')
    await resolveProxyDispatcher('https://github.com/o/r.git')
    expect(h.created.map(c => c.kind)).toEqual(['Agent', 'ProxyAgent'])
    // Exclusion explicite : le proxy système n'est pas consulté à sa place.
    expect(h.resolveProxy).not.toHaveBeenCalled()
  })

  it('no_proxy en minuscules aussi', async () => {
    process.env['https_proxy'] = 'http://gateway.corp.example:80'
    process.env['no_proxy'] = '.corp.example'
    setNetworkTimeoutSeconds(12)   // autre délai : pas l'agent direct mis en cache au test précédent
    await resolveProxyDispatcher('https://forge.corp.example/o/r.git')
    expect(h.created.map(c => c.kind)).toEqual(['Agent'])
  })

  it('sans variable de proxy : proxy système consulté comme avant', async () => {
    process.env['NO_PROXY'] = 'localhost'
    await resolveProxyDispatcher('https://github.com/o/r.git')
    expect(h.resolveProxy).toHaveBeenCalledWith('https://github.com/o/r.git')
  })
})
