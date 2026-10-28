import * as http from 'http'
import * as https from 'https'
import * as net from 'net'
import type { AddressInfo } from 'net'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ session: { defaultSession: { resolveProxy: async () => 'DIRECT' } } }))

import client from './git-http'
import { isNetworkUnreachable } from './net-proxy'
import { setNetworkTimeoutSeconds, setTimeoutBaseScaleForTests } from './net-timeouts'

// Certificat auto-signé de test (localhost, valable 100 ans) — accepté via NODE_TLS_REJECT_UNAUTHORIZED.
const KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgWtiX64ds6pONlbZz
aKmdgI4siR9S2G0EiJrRdY50oPahRANCAASBqncaPPNMoNhRH8hp4/2xfJx2Ars4
4lMD7NhDFAiEDwWpkRRd2xQ6xTyDs80l/q8NKpRbVgsirIUAqzQ5e6MX
-----END PRIVATE KEY-----`
const CERT = `-----BEGIN CERTIFICATE-----
MIIBfzCCASWgAwIBAgIUPGNsmhjmLjb0cQ10ZtDjF04dqWgwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI2MTAyNzIyNDgwNFoYDzIxMjYxMDAz
MjI0ODA0WjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjO
PQMBBwNCAASBqncaPPNMoNhRH8hp4/2xfJx2Ars44lMD7NhDFAiEDwWpkRRd2xQ6
xTyDs80l/q8NKpRbVgsirIUAqzQ5e6MXo1MwUTAdBgNVHQ4EFgQU7NkXADCQaEok
DCD8cRm/+/qvMcUwHwYDVR0jBBgwFoAU7NkXADCQaEokDCD8cRm/+/qvMcUwDwYD
VR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNIADBFAiBtlhzoP4Lt1JTjkdjyNQLp
84xY4VsTSSRIhFvphZ3uVwIhAKKqzk4jfLFqxyq81fUkcDTaH9j++DD48OJVIkJZ
fQDJ
-----END CERTIFICATE-----`

// Le délai de connexion d'undici passe par ses minuteries « rapides » (résolution ~1 s) : les
// délais simulés se comptent donc en secondes.
const LINK_DELAY_MS = 3_000

async function drain(body: AsyncIterableIterator<Uint8Array> | undefined): Promise<string> {
  let out = ''
  for await (const chunk of body ?? []) out += Buffer.from(chunk).toString()
  return out
}

function listen(server: net.Server): Promise<number> {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)))
}

describe('GH15 — git-http sur lien lent simulé', () => {
  let target: https.Server
  let relay: net.Server
  let stalling: http.Server
  let slowUrl: string
  let stallUrl: string
  const savedTls = process.env['NODE_TLS_REJECT_UNAUTHORIZED']

  beforeAll(async () => {
    process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'
    setNetworkTimeoutSeconds(10)   // hôte desktop : le réglage est proposé
    target = https.createServer({ key: KEY, cert: CERT }, (_req, res) => res.end('ok'))
    const targetPort = await listen(target)
    // Lien filtré : la connexion TCP est acceptée, mais rien ne passe avant LINK_DELAY_MS
    // (la négociation TLS, comptée dans le délai de connexion, attend d'autant).
    relay = net.createServer(socket => {
      socket.pause()
      setTimeout(() => {
        const upstream = net.connect(targetPort, '127.0.0.1', () => {
          socket.pipe(upstream).pipe(socket)
          socket.resume()
        })
        upstream.on('error', () => socket.destroy())
      }, LINK_DELAY_MS)
      socket.on('error', () => {})
    })
    slowUrl = `https://localhost:${await listen(relay)}/o/r.git/info/refs`
    // En-têtes puis un début de corps, puis plus rien : délai de corps dépassé pendant la lecture.
    stalling = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-git-upload-pack-advertisement' })
      res.write('partial')
    })
    stallUrl = `http://127.0.0.1:${await listen(stalling)}/o/r.git/info/refs`
  })

  afterAll(() => {
    if (savedTls === undefined) delete process.env['NODE_TLS_REJECT_UNAUTHORIZED']
    else process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = savedTls
    stalling.closeAllConnections()
    for (const s of [target, relay, stalling]) s.close()
  })

  afterEach(() => {
    setNetworkTimeoutSeconds(10)
    setTimeoutBaseScaleForTests(1)
  })

  it('délai par défaut : échec, message citant le réglage, code conservé', async () => {
    setTimeoutBaseScaleForTests(0.1)    // connexion : 1 s (+ ~1 s de résolution) < LINK_DELAY_MS
    const err = await client.request({ url: slowUrl, method: 'GET', headers: {} }).then(() => null, e => e as Error)
    expect(err).toBeInstanceOf(Error)
    expect(err!.message).toContain('Compte → Délai de connexion réseau')
    expect(err!.message).toContain('10 s')
    expect((err as { code?: string }).code).toBe('UND_ERR_CONNECT_TIMEOUT')
    expect(isNetworkUnreachable(err)).toBe(true)
  })

  it('délai augmenté : la requête aboutit', async () => {
    setTimeoutBaseScaleForTests(0.1)
    setNetworkTimeoutSeconds(60)        // connexion : 6 s > LINK_DELAY_MS
    const res = await client.request({ url: slowUrl, method: 'GET', headers: {} })
    expect(res.statusCode).toBe(200)
    expect(await drain(res.body)).toBe('ok')
  })

  it('délai de corps dépassé pendant la lecture : message traduit', async () => {
    setTimeoutBaseScaleForTests(0.005)  // en-têtes / corps : 1,5 s
    const res = await client.request({ url: stallUrl, method: 'GET', headers: {} })
    const err = await drain(res.body).then(() => null, e => e as Error)
    expect(err?.message).toContain('Compte → Délai de connexion réseau')
    expect((err as { code?: string }).code).toBe('UND_ERR_BODY_TIMEOUT')
  })
})
