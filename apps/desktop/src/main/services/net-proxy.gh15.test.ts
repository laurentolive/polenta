import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  created: [] as { kind: 'Agent' | 'ProxyAgent'; opts: Record<string, unknown> }[],
  request: vi.fn(),
}))

vi.mock('electron', () => ({ session: { defaultSession: { resolveProxy: async () => 'DIRECT' } } }))
vi.mock('undici', async importOriginal => {
  const actual = await importOriginal<typeof import('undici')>()
  class Agent { constructor(opts: Record<string, unknown>) { h.created.push({ kind: 'Agent', opts }) } }
  class ProxyAgent { constructor(opts: Record<string, unknown>) { h.created.push({ kind: 'ProxyAgent', opts }) } }
  return { ...actual, Agent, ProxyAgent, request: h.request }
})

import { describeFetchError, isNetworkUnreachable, isTimeoutError, resolveProxyDispatcher } from './net-proxy'
import { setNetworkTimeoutSeconds } from './net-timeouts'
import { forgeRequest } from './forge/forge-http'
import { loadImage } from './export/template/image-source'

const PROXY_VARS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']
const coded = (code: string, onCause = false): Error =>
  onCause ? new TypeError('fetch failed', { cause: Object.assign(new Error('boom'), { code }) }) : Object.assign(new Error('boom'), { code })

// En premier : avant tout appel à setNetworkTimeoutSeconds (état du module).
describe('GH15 — net-proxy, serveur web', () => {
  it('réglage non piloté par l\'hôte : message de délai sans le réglage', () => {
    const message = describeFetchError(coded('UND_ERR_CONNECT_TIMEOUT'))
    expect(message).toMatch(/^Délai d'attente dépassé/)
    expect(message).not.toContain('Compte')
  })
})

describe('GH15 — net-proxy', () => {
  const savedEnv: Record<string, string | undefined> = {}
  beforeAll(() => setNetworkTimeoutSeconds(10))   // hôte desktop : le réglage est proposé
  beforeEach(() => {
    for (const v of PROXY_VARS) { savedEnv[v] = process.env[v]; delete process.env[v] }
    h.created.length = 0
    h.request.mockReset()
  })
  afterEach(() => {
    for (const v of PROXY_VARS) if (savedEnv[v] === undefined) delete process.env[v]; else process.env[v] = savedEnv[v]
    setNetworkTimeoutSeconds(10)
  })

  it('connexion directe : délai de connexion explicite, une instance par délai', async () => {
    const a = await resolveProxyDispatcher('https://github.com/o/r.git')
    expect(await resolveProxyDispatcher('https://github.com/o/r.git')).toBe(a)
    setNetworkTimeoutSeconds(30)
    expect(await resolveProxyDispatcher('https://github.com/o/r.git')).not.toBe(a)
    expect(h.created).toEqual([
      { kind: 'Agent', opts: { connect: { timeout: 10_000 } } },
      { kind: 'Agent', opts: { connect: { timeout: 30_000 } } },
    ])
  })

  it('via proxy : délai sur la connexion au proxy et sur le TLS vers la cible', async () => {
    process.env['HTTPS_PROXY'] = 'http://proxy:3128'
    setNetworkTimeoutSeconds(30)
    await resolveProxyDispatcher('https://github.com/o/r.git')
    expect(h.created).toEqual([{
      kind: 'ProxyAgent',
      opts: { uri: 'http://proxy:3128', proxyTls: { timeout: 30_000 }, requestTls: { timeout: 30_000 } },
    }])
  })

  it.each([
    ['UND_ERR_CONNECT_TIMEOUT', false], ['UND_ERR_CONNECT_TIMEOUT', true], ['UND_ERR_HEADERS_TIMEOUT', false],
    ['UND_ERR_BODY_TIMEOUT', false], ['ETIMEDOUT', true],
  ])('délai dépassé (%s, code sur la cause : %s) → message citant le réglage', (code, onCause) => {
    const err = coded(code, onCause)
    expect(isTimeoutError(err)).toBe(true)
    expect(describeFetchError(err)).toContain('Compte → Délai de connexion réseau')
    expect(describeFetchError(err)).toContain('10 s')
    setNetworkTimeoutSeconds(30)
    expect(describeFetchError(err)).toContain('30 s')
  })

  it('autres erreurs : messages inchangés', () => {
    expect(describeFetchError(coded('ENOTFOUND', true))).toMatch(/^Résolution DNS impossible/)
    expect(describeFetchError(coded('ECONNREFUSED', true))).toMatch(/^Connexion refusée/)
    expect(describeFetchError(coded('CERT_HAS_EXPIRED', true))).toMatch(/^Certificat SSL non reconnu/)
    expect(isTimeoutError(coded('ENOTFOUND'))).toBe(false)
  })

  it('isNetworkUnreachable inchangé', () => {
    expect(isNetworkUnreachable(coded('UND_ERR_CONNECT_TIMEOUT'))).toBe(true)
    expect(isNetworkUnreachable(coded('ENOTFOUND', true))).toBe(true)
    expect(isNetworkUnreachable(coded('UND_ERR_HEADERS_TIMEOUT'))).toBe(false)
    expect(isNetworkUnreachable(coded('UND_ERR_BODY_TIMEOUT'))).toBe(false)
  })

  it('forgeRequest : délais mis à l\'échelle (défaut 20 s, sondes 10 s)', async () => {
    h.request.mockResolvedValue({ statusCode: 200, headers: {}, body: { text: async () => '' } })
    setNetworkTimeoutSeconds(30)
    await forgeRequest('https://forge.example/api/v1/user', { fixedUrl: true })
    await forgeRequest('https://forge.example/api/v1/user', { fixedUrl: true, timeoutMs: 10_000 })
    expect(h.request.mock.calls.map(c => [c[1].headersTimeout, c[1].bodyTimeout])).toEqual([[60_000, 60_000], [30_000, 30_000]])
  })

  it('images distantes des gabarits : délai mis à l\'échelle', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    try {
      setNetworkTimeoutSeconds(30)
      await loadImage('https://img.example/a.png', '/repo')
      expect(timeout).toHaveBeenCalledWith(30_000)
    } finally {
      vi.unstubAllGlobals()
      timeout.mockRestore()
    }
  })
})
