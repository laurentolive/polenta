// GH63 — persistance des travaux, rétention (S2-24), secrets à usage unique, filtre, paramètres (S2-27).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AuditLog, auditCsv } from '../src/audit'
import { REGISTRY, checkConfirm, checkParams } from '../src/jobs/registry'
import { JobStore, ulid, type JobRecord } from '../src/jobs/store'
import { redact } from '../src/secrets/redact'

const job = (id: string, createdAt: string): JobRecord => ({
  id,
  operation: 'backup.run',
  instance: 'acme',
  actor: { login: 'alice', instance: 'acme' },
  origin: 'ui',
  state: 'succeeded',
  createdAt,
  steps: [],
  cancellable: false,
  logSize: 0,
  argv: [],
})

describe('rétention (S2-24)', () => {
  it('purge les travaux de plus de 90 jours au-delà des 200 plus récents, audit intact', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gh63-store-'))
    const store = new JobStore(root)
    const audit = new AuditLog(root)
    audit.write({ actor: 'a', actorInstance: 'acme', origin: 'ui', operation: 'x', target: '', params: {}, result: 'accepted' })
    const now = Date.UTC(2026, 9, 28)
    const old = now - 100 * 86_400_000
    for (let i = 0; i < 250; i++) store.create(job(ulid(old + i * 1000), new Date(old).toISOString()))
    for (let i = 0; i < 10; i++) store.create(job(ulid(now - 1000 + i), new Date(now).toISOString()))
    const removed = store.purge(now)
    expect(removed).toHaveLength(60)
    expect(store.list()).toHaveLength(200)
    expect(audit.read()).toHaveLength(1)
  })
})

describe('secret à usage unique', () => {
  it('lu une fois, puis expiré', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gh63-secret-'))
    const store = new JobStore(root)
    const j = job(ulid(), new Date().toISOString())
    store.create(j)
    store.writeSecret(j.id, { pw: 'x' })
    expect(store.takeSecret(j.id)).toEqual({ pw: 'x' })
    expect(store.takeSecret(j.id)).toBeNull()
    store.writeSecret(j.id, { pw: 'y' })
    expect(store.takeSecret(j.id, Date.now() + 11 * 60_000)).toBeNull()
  })
})

describe('filtre des secrets', () => {
  it('masque valeurs connues et motifs', () => {
    expect(redact('password=hunter2 ok')).toBe('password=*** ok')
    expect(redact('Authorization: Bearer abcdefghijkl')).toContain('Bearer ***')
    expect(redact('RESTIC_PASSWORD: "a b"')).toBe('RESTIC_PASSWORD: ***')
    expect(redact('clé SENTINEL-123456 lue', ['SENTINEL-123456'])).toBe('clé *** lue')
  })
})

describe('paramètres et confirmations (S2-25, S2-27)', () => {
  const add = REGISTRY.get('instance.add')!
  const dns = REGISTRY.get('dns.check')!
  const upd = REGISTRY.get('forge.update')!
  const remove = REGISTRY.get('instance.remove')!

  it.each([
    [add, { name: '../x' }],
    [add, { name: 'A;rm' }],
    [add, { name: 'ok', inconnu: 1 }],
    [dns, { domain: 'a b' }],
    [upd, { version: 'latest' }],
    [upd, {}],
    [REGISTRY.get('fail2ban.unban')!, { ip: '1.2.3' }],
  ])('%#: refusé', (def, params) => {
    expect(checkParams(def, params).ok).toBe(false)
  })

  it('argv construit en tableau, jamais en chaîne shell', () => {
    const p = checkParams(add, { name: 'beta', domain: 'beta.exemple.fr', demo: false })
    expect(p.ok).toBe(true)
    expect(add.argv(null, (p as { params: Record<string, unknown> }).params)).toEqual(['instance', 'add', 'beta', '--domain', 'beta.exemple.fr', '--no-demo'])
  })

  it('suppression : nom exact seulement', () => {
    expect(checkConfirm(remove, undefined, 'acme')).toBe(false)
    expect(checkConfirm(remove, true, 'acme')).toBe(false)
    expect(checkConfirm(remove, 'globex', 'acme')).toBe(false)
    expect(checkConfirm(remove, 'acme', 'acme')).toBe(true)
  })
})

describe('export CSV de l\'audit', () => {
  it('neutralise les formules', () => {
    const csv = auditCsv([{ ts: 't', actor: '=cmd', actorInstance: 'acme', origin: 'ui', operation: 'x', target: '', params: { a: 1 }, result: 'accepted' }])
    expect(csv).toContain("'=cmd")
    expect(csv).toContain('"{""a"":1}"')
  })
})
