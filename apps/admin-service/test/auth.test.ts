// GH63 — jetons de service, limiteur, revérification « propriétaire », niveaux (S2-9 à S2-13).
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ForgeOwnerChecker } from '../src/auth/forge-owner'
import { levelOf, scope } from '../src/auth/levels'
import { FailureLimiter } from '../src/auth/rate-limit'
import { ServiceTokens } from '../src/auth/service-token'
import { fakeForge } from './helpers'

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

describe('jetons de service (S2-13)', () => {
  it('reconnaît un jeton par son empreinte, à temps constant', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gh63-tok-'))
    fs.mkdirSync(path.join(root, 'admin'))
    fs.writeFileSync(path.join(root, 'admin', 'service-tokens.json'), JSON.stringify({ acme: { sha256: sha('tok-acme') }, ops: { sha256: sha('tok-ops') } }))
    const spy = vi.spyOn(crypto, 'timingSafeEqual')
    const t = new ServiceTokens(root)
    expect(t.identify('tok-acme')).toBe('acme')
    expect(t.identify('tok-ops')).toBe('ops')
    expect(t.identify('mauvais')).toBeNull()
    expect(t.identify(undefined)).toBeNull()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
    // Aucune valeur claire stockée.
    expect(fs.readFileSync(path.join(root, 'admin', 'service-tokens.json'), 'utf8')).not.toContain('tok-acme')
  })
})

describe('limiteur (S2-12)', () => {
  it('bloque une source après 10 échecs, pas les autres', () => {
    let now = 0
    const l = new FailureLimiter(10, 60_000, () => now)
    for (let i = 0; i < 10; i++) l.fail(['ip:1'])
    expect(l.blocked(['ip:1'])).toBe(true)
    expect(l.blocked(['ip:2'])).toBe(false)
    now = 61_000
    expect(l.blocked(['ip:1'])).toBe(false)
  })
})

describe('revérification propriétaire (S2-9, S2-10, S2-11)', () => {
  const forge = fakeForge({ 'tok-alice': 'alice', 'tok-bob': 'bob' }, { acme: ['alice'] })
  const mk = (now = () => 0) => new ForgeOwnerChecker({ forgeUrl: (i) => `http://forgejo-${i}:3000`, cacheMs: 60_000, fetchImpl: forge.fetch, now })

  it('propriétaire, non-propriétaire, jeton invalide', async () => {
    const c = mk()
    expect(await c.check({ instance: 'acme', org: 'acme', userToken: 'tok-alice' })).toEqual({ ok: true, login: 'alice' })
    expect(await c.check({ instance: 'acme', org: 'acme', userToken: 'tok-bob' })).toMatchObject({ ok: false, status: 403 })
    expect(await c.check({ instance: 'acme', org: 'acme', userToken: 'faux' })).toMatchObject({ ok: false, status: 401 })
  })

  it("le login annoncé n'est pas cru", async () => {
    const r = await mk().check({ instance: 'acme', org: 'acme', userToken: 'tok-bob', announcedLogin: 'alice' })
    expect(r).toMatchObject({ ok: false, status: 403 })
  })

  it('cache 60 s pour les lectures, aucun cache pour une destructive', async () => {
    let now = 0
    const c = mk(() => now)
    expect((await c.check({ instance: 'acme', org: 'acme', userToken: 'tok-alice' })).ok).toBe(true)
    forge.owners.acme = []
    now = 5_000
    expect((await c.check({ instance: 'acme', org: 'acme', userToken: 'tok-alice' })).ok).toBe(true)
    expect((await c.check({ instance: 'acme', org: 'acme', userToken: 'tok-alice', noCache: true })).ok).toBe(false)
    now = 61_000
    expect((await c.check({ instance: 'acme', org: 'acme', userToken: 'tok-alice' })).ok).toBe(false)
    forge.owners.acme = ['alice']
  })
})

describe('niveaux et portée (S2-6 à S2-8)', () => {
  it('niveau hôte réservé à ADMIN_INSTANCE', () => {
    expect(levelOf('ops', 'ops')).toBe('host')
    expect(levelOf('acme', 'ops')).toBe('instance')
    expect(levelOf('acme', '')).toBe('instance')
  })

  it('portée', () => {
    expect(scope({ level: 'instance', originInstance: 'globex', opLevel: 'instance', needsInstance: true, requested: 'acme' })).toMatchObject({ ok: false })
    expect(scope({ level: 'instance', originInstance: 'acme', opLevel: 'host', needsInstance: false })).toMatchObject({ ok: false })
    expect(scope({ level: 'instance', originInstance: 'acme', opLevel: 'instance', needsInstance: true })).toEqual({ ok: true, target: 'acme' })
    expect(scope({ level: 'host', originInstance: 'ops', opLevel: 'instance', needsInstance: true, requested: 'acme' })).toEqual({ ok: true, target: 'acme' })
  })
})
