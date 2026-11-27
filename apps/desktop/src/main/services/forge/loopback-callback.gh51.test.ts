import * as http from 'http'
import { describe, expect, it } from 'vitest'

import { startLoopbackCallback } from './loopback-callback'
import { SsoLoginError } from './forgejo-sso'

/** Requête GET sur l'URL de retour ; renvoie le statut, sans lever sur un refus. */
function hit(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    http.get(url, res => { res.resume(); resolve(res.statusCode ?? 0) }).on('error', reject)
  })
}

async function refused(url: string): Promise<boolean> {
  return hit(url).then(() => false, () => true)
}

describe('serveur de retour loopback (GH51)', () => {
  it('écoute sur 127.0.0.1, port attribué par le système, chemin /callback', async () => {
    const cb = await startLoopbackCallback({ timeoutMs: 60_000 })
    try {
      expect(cb.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
      expect(Number(new URL(cb.redirectUri).port)).toBeGreaterThan(0)
    } finally {
      cb.cancel()
      await cb.result.catch(() => undefined)
    }
  })

  it('premier retour valide : code et state remis, serveur fermé ensuite', async () => {
    const cb = await startLoopbackCallback({ timeoutMs: 60_000 })
    const status = await hit(`${cb.redirectUri}?code=c-1&state=s-1`)
    expect(status).toBe(200)
    await expect(cb.result).resolves.toEqual({ code: 'c-1', state: 's-1' })
    expect(await refused(cb.redirectUri)).toBe(true)
  })

  it('retour d’erreur (access_denied) remis tel quel', async () => {
    const cb = await startLoopbackCallback({ timeoutMs: 60_000 })
    await hit(`${cb.redirectUri}?error=access_denied&state=s-1`)
    await expect(cb.result).resolves.toEqual({ error: 'access_denied', state: 's-1' })
  })

  it('autre chemin : 404, l’attente continue', async () => {
    const cb = await startLoopbackCallback({ timeoutMs: 60_000 })
    const other = cb.redirectUri.replace('/callback', '/autre')
    expect(await hit(other)).toBe(404)
    expect(await hit(`${cb.redirectUri}?code=c&state=s`)).toBe(200)
    await expect(cb.result).resolves.toMatchObject({ code: 'c' })
  })

  it('un second retour ne remplace pas le premier (serveur fermé au premier)', async () => {
    const cb = await startLoopbackCallback({ timeoutMs: 60_000 })
    await hit(`${cb.redirectUri}?code=premier&state=s`)
    await expect(cb.result).resolves.toEqual({ code: 'premier', state: 's' })
    expect(await refused(`${cb.redirectUri}?code=second&state=s`)).toBe(true)
  })

  it('aucun retour dans le délai : rejet timeout, serveur fermé', async () => {
    const cb = await startLoopbackCallback({ timeoutMs: 50 })
    const err = await cb.result.catch(e => e)
    expect(err).toBeInstanceOf(SsoLoginError)
    expect(err).toMatchObject({ code: 'timeout' })
    expect(await refused(cb.redirectUri)).toBe(true)
  })

  it('annulation pendant l’attente : rejet cancelled, serveur fermé', async () => {
    const cb = await startLoopbackCallback({ timeoutMs: 60_000 })
    cb.cancel()
    await expect(cb.result).rejects.toMatchObject({ code: 'cancelled' })
    expect(await refused(cb.redirectUri)).toBe(true)
  })

  it('annulation après un retour : sans effet sur le résultat', async () => {
    const cb = await startLoopbackCallback({ timeoutMs: 60_000 })
    await hit(`${cb.redirectUri}?code=c&state=s`)
    cb.cancel()
    await expect(cb.result).resolves.toMatchObject({ code: 'c' })
  })

  it('liaison refusée : erreur bind immédiate, sans attente', async () => {
    const started = Date.now()
    const err = await startLoopbackCallback({
      timeoutMs: 60_000,
      createServer: listener => {
        const server = http.createServer(listener)
        server.listen = (() => { server.emit('error', new Error('EACCES')); return server }) as typeof server.listen
        return server
      },
    }).catch(e => e)
    expect(err).toBeInstanceOf(SsoLoginError)
    expect(err).toMatchObject({ code: 'bind' })
    expect(Date.now() - started).toBeLessThan(5_000)
  })
})
