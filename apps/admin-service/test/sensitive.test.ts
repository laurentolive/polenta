// GH63 Sprint 5 — opérations sensibles (S5-1 à S5-4, S5-7, S5-12 à S5-17, S5-19, S5-20, S5-22).
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { absentAgent } from '../src/agent-client'
import { loadConfig } from '../src/config'
import { createService } from '../src/service'
import { fakeForge, setupRoot, until } from './helpers'

const forge = fakeForge(
  { 'SENTINEL-USERTOKEN': 'olga', 'u-alice': 'alice', 'u-gina': 'gina' },
  { ops: ['olga'], acme: ['alice'], globex: ['gina'] },
)
const OLGA = { authorization: 'Bearer svc-ops', 'x-polenta-forge-token': 'SENTINEL-USERTOKEN' }
const ALICE = { authorization: 'Bearer svc-acme', 'x-polenta-forge-token': 'u-alice' }

let app: FastifyInstance | null = null
afterEach(async () => {
  await app?.close()
  app = null
})

function start() {
  const env = setupRoot()
  const cfg = loadConfig({ POLENTA_ROOT: env.root, POLENTA_KIT_DIR: env.kit, POLENTA_HOST_NAME: 'hote1' })
  app = createService(cfg, { fetchImpl: forge.fetch, lockProbe: { held: () => false }, pollMs: 50, agent: absentAgent })
  return { a: app, env }
}

const post = (a: FastifyInstance, headers: Record<string, string>, payload: Record<string, unknown>) =>
  a.inject({ method: 'POST', url: '/jobs', headers, payload })

async function done(a: FastifyInstance, headers: Record<string, string>, jobId: string) {
  let job: { state: string } = { state: 'running' }
  await until(async () => {
    job = (await a.inject({ url: `/jobs/${jobId}`, headers })).json()
    return !['running', 'queued'].includes(job.state)
  })
  return job as { state: string; result?: Record<string, unknown>; error?: unknown }
}

/** Tout ce que le service a écrit ou rendu, pour la recherche de sentinelles (S5-1). */
function everything(root: string, responses: string[]): string {
  const out: string[] = [...responses]
  const walk = (d: string) => {
    for (const n of fs.readdirSync(d)) {
      const f = path.join(d, n)
      if (fs.statSync(f).isDirectory()) walk(f)
      else if (!f.endsWith('secret.json')) out.push(fs.readFileSync(f, 'utf8'))
    }
  }
  walk(path.join(root, 'admin'))
  return out.join('\n')
}

describe('clé restic (S5-2, S5-3)', () => {
  it('niveau hôte, confirmation par le nom, valeur à usage unique, absente du journal et de l\'audit', async () => {
    const { a, env } = start()
    expect((await post(a, ALICE, { operation: 'backup.keys', confirm: 'acme' })).statusCode).toBe(403)
    expect((await post(a, OLGA, { operation: 'backup.keys', instance: 'acme' })).statusCode).toBe(400)
    expect((await post(a, OLGA, { operation: 'backup.keys', instance: 'acme', confirm: 'globex' })).statusCode).toBe(400)
    const { jobId } = (await post(a, OLGA, { operation: 'backup.keys', instance: 'acme', confirm: 'acme' })).json()
    const job = await done(a, OLGA, jobId)
    expect(job.state).toBe('succeeded')
    expect(job.result).toMatchObject({ instance: 'acme', resticPassword: null, oneTime: true })
    const s1 = await a.inject({ url: `/jobs/${jobId}/secret`, headers: OLGA })
    expect(s1.json().secret).toEqual({ resticPassword: 'SENTINEL-RESTICKEY' })
    expect(s1.headers['cache-control']).toBe('no-store')
    expect((await a.inject({ url: `/jobs/${jobId}/secret`, headers: OLGA })).statusCode).toBe(404)
    expect(fs.existsSync(path.join(env.root, 'admin', 'jobs', jobId, 'secret.json'))).toBe(false)
    expect(everything(env.root, [])).not.toContain('SENTINEL-RESTICKEY')
    const lines = fs.readFileSync(path.join(env.root, 'admin', 'audit.log'), 'utf8')
    expect(lines).toContain('"operation":"backup.keys.secret"')
  })
})

describe('restauration et exports (S5-10, S5-12 à S5-14)', () => {
  it('restauration : confirmation par le nom de la cible, argv attendu', async () => {
    const { a, env } = start()
    expect((await post(a, ALICE, { operation: 'backup.restore', params: { from: 'latest' }, confirm: true })).statusCode).toBe(400)
    expect((await post(a, ALICE, { operation: 'backup.restore', params: { from: 'pas un id' }, confirm: 'acme' })).statusCode).toBe(400)
    const { jobId } = (await post(a, ALICE, { operation: 'backup.restore', params: { from: 'abc12345' }, confirm: 'acme' })).json()
    expect((await done(a, ALICE, jobId)).state).toBe('succeeded')
    expect(fs.readFileSync(path.join(env.root, 'calls.log'), 'utf8')).toContain('instance restore acme --from abc12345 --confirm acme')
  })

  it('export, liste filtrée à l\'instance, téléchargement en flux audité, suppression de sa seule archive', async () => {
    const { a, env } = start()
    const { jobId } = (await post(a, ALICE, { operation: 'export.run' })).json()
    expect((await done(a, ALICE, jobId)).state).toBe('succeeded')
    const list = (await a.inject({ url: '/exports', headers: ALICE })).json().exports
    expect(list.map((e: { file: string }) => e.file)).toEqual(['acme-20261028-101500.tar.gz'])
    const dl = await a.inject({ url: '/exports/acme-20261028-101500.tar.gz/download', headers: ALICE })
    expect(dl.statusCode).toBe(200)
    expect(dl.body).toBe('ARCHIVE')
    expect(dl.headers['content-disposition']).toContain('acme-20261028-101500.tar.gz')
    expect((await a.inject({ url: '/exports/globex-20261028-101500.tar.gz/download', headers: ALICE })).statusCode).toBe(403)
    expect((await a.inject({ url: '/exports/..%2Fhost.env/download', headers: ALICE })).statusCode).toBe(400)
    expect((await post(a, ALICE, { operation: 'export.delete', params: { file: 'globex-20261028-101500.tar.gz' }, confirm: true })).statusCode).toBe(403)
    const del = (await post(a, ALICE, { operation: 'export.delete', params: { file: 'acme-20261028-101500.tar.gz' }, confirm: true })).json()
    expect((await done(a, ALICE, del.jobId)).state).toBe('succeeded')
    expect(fs.readFileSync(path.join(env.root, 'admin', 'audit.log'), 'utf8')).toContain('"operation":"export.download"')
  })
})

describe('clé S3 et purge (S5-1, S5-5, S5-7, S5-9)', () => {
  // Descripteur 4 : non transmis à bash MSYS par Node sous Windows ; vérifié sous Linux.
  it.skipIf(process.platform === 'win32')('remplacement de clé : secrets par descripteur, jamais écrits nulle part', async () => {
    const { a, env } = start()
    const responses: string[] = []
    const r = await post(a, OLGA, { operation: 's3.rotate', params: { accessKey: 'SENTINEL-S3NEWKEY', secretKey: 'SENTINEL-S3SECRET', bucket: 'polenta-sauvegardes' } })
    responses.push(r.body)
    const job = await done(a, OLGA, r.json().jobId)
    expect(job.state).toBe('succeeded')
    const log = await a.inject({ url: `/jobs/${r.json().jobId}/log`, headers: OLGA })
    responses.push(log.body, JSON.stringify(job))
    // Le faux kit a bien reçu les valeurs sur le fd 4 (et les a affichées : le filtre doit les masquer).
    expect(log.json().lines.join('\n')).toContain('lu sur fd 4 : access_key=***')
    expect(fs.readFileSync(path.join(env.root, 'calls.log'), 'utf8')).toContain('s3-key rotate --credentials-fd 4')
    const all = everything(env.root, responses) + fs.readFileSync(path.join(env.root, 'calls.log'), 'utf8')
    for (const s of ['SENTINEL-S3NEWKEY', 'SENTINEL-S3SECRET', 'SENTINEL-USERTOKEN']) expect(all).not.toContain(s)
    expect((await a.inject({ url: '/host/s3', headers: OLGA })).json()).toEqual({ s3: { endpoint: 'https://s3.test', bucket: 'b', accessKeyHint: '…2345', rotatedAt: null } })
    expect((await a.inject({ url: '/host/s3', headers: ALICE })).statusCode).toBe(403)
  })

  it.skipIf(process.platform === 'win32')('purge : inventaire d\'abord, instance existante refusée, phrase exacte, clé de purge jamais conservée', async () => {
    const { a, env } = start()
    expect((await a.inject({ url: '/s3/purge-preview?name=ancien', headers: OLGA })).json()).toMatchObject({ snapshots: 4, preview: true })
    const keys = { purgeAccessKey: 'SENTINEL-PURGEKEY', purgeSecretKey: 'SENTINEL-PURGESECRET' }
    expect((await post(a, OLGA, { operation: 's3.purge', params: { name: 'acme', ...keys }, confirm: 'supprimer définitivement les sauvegardes de acme' })).statusCode).toBe(422)
    expect((await post(a, OLGA, { operation: 's3.purge', params: { name: 'ancien' }, confirm: 'supprimer définitivement les sauvegardes de ancien' })).statusCode).toBe(400)
    expect((await post(a, OLGA, { operation: 's3.purge', params: { name: 'ancien', ...keys }, confirm: 'ancien' })).statusCode).toBe(400)
    const r = await post(a, OLGA, { operation: 's3.purge', params: { name: 'ancien', ...keys }, confirm: 'supprimer définitivement les sauvegardes de ancien' })
    expect(r.statusCode).toBe(202)
    expect((await done(a, OLGA, r.json().jobId)).state).toBe('succeeded')
    expect(fs.readFileSync(path.join(env.root, 'calls.log'), 'utf8')).toContain('s3-purge ancien --purge-key-fd 4 --confirm supprimer définitivement les sauvegardes de ancien')
    const all = everything(env.root, [r.body])
    expect(all).not.toContain('SENTINEL-PURGEKEY')
    expect(all).not.toContain('SENTINEL-PURGESECRET')
  })
})

describe('utilisateurs (S5-4, S5-16, S5-17, S5-19, S5-20)', () => {
  it('aperçu puis import : mots de passe à usage unique, fichier déposé effacé', async () => {
    const { a, env } = start()
    const bad = await a.inject({ method: 'POST', url: '/users/import/preview', headers: ALICE, payload: { csv: 'x,y\n' } })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error.message).toContain('colonne manquante')
    expect((await a.inject({ method: 'POST', url: '/users/import/preview', headers: ALICE, payload: { csv: 'a'.repeat(5 * 1024 * 1024 + 1) } })).statusCode).toBe(400)
    const prev = await a.inject({ method: 'POST', url: '/users/import/preview', headers: ALICE, payload: { csv: 'login,email\nzoe,zoe@x.test\nzoe,zoe@x.test\n' } })
    expect(prev.statusCode).toBe(200)
    const { uploadId, rows, rejected } = prev.json()
    expect(rows).toHaveLength(1)
    expect(rejected[0]).toMatchObject({ line: 3, cause: 'doublon' })
    const upload = path.join(env.root, 'admin', 'tmp', 'uploads', `${uploadId}.csv`)
    expect(fs.existsSync(upload)).toBe(true)
    // Autre instance : le dépôt n'est pas transmissible.
    expect((await post(a, { authorization: 'Bearer svc-globex', 'x-polenta-forge-token': 'u-gina' }, { operation: 'users.import', params: { uploadId: 'f'.repeat(32) } })).statusCode).toBe(422)
    const { jobId } = (await post(a, ALICE, { operation: 'users.import', params: { uploadId } })).json()
    const job = await done(a, ALICE, jobId)
    expect(job.state).toBe('succeeded')
    expect(job.result).toMatchObject({ created: [{ login: 'zoe', temporaryPassword: null }], oneTime: true })
    expect((await a.inject({ url: `/jobs/${jobId}/secret`, headers: ALICE })).json().secret).toEqual({ 'created.0.temporaryPassword': 'SENTINEL-USERPW' })
    expect(fs.existsSync(upload)).toBe(false)
    expect(everything(env.root, [])).not.toContain('SENTINEL-USERPW')
  })

  it('rapport d\'accès et invitation : lecture seule, instance de l\'appelant', async () => {
    const { a } = start()
    expect((await a.inject({ url: '/users/access-report', headers: ALICE })).json()).toMatchObject({ instance: 'acme', rows: [{ user: 'zoe' }] })
    expect((await a.inject({ url: '/users/access-report?instance=globex', headers: ALICE })).statusCode).toBe(403)
    expect((await a.inject({ url: '/users/invite?login=zoe', headers: ALICE })).json()).toMatchObject({ inviteLink: 'polenta://connect?login=zoe' })
    expect((await a.inject({ url: '/users/invite?login=a;b', headers: ALICE })).statusCode).toBe(400)
  })
})

describe('audit (S5-22, S5-23)', () => {
  it('une ligne par issue (réussi, refusé droit, refusé confirmation), jamais de secret ; fichier en ajout seul', async () => {
    const { a, env } = start()
    await post(a, ALICE, { operation: 'host.reboot', confirm: 'hote1' }) // refusé (droit)
    await post(a, OLGA, { operation: 'instance.remove', instance: 'acme' }) // refusé (confirmation)
    const { jobId } = (await post(a, ALICE, { operation: 'backup.run' })).json()
    await done(a, ALICE, jobId)
    const lines = fs.readFileSync(path.join(env.root, 'admin', 'audit.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(lines.map((l) => [l.operation, l.result, l.reason ?? null])).toEqual([
      ['host.reboot', 'refused', 'host-level-required'],
      ['instance.remove', 'refused', 'confirmation'],
      ['backup.run', 'accepted', null],
      ['backup.run', 'succeeded', null],
    ])
    for (const l of lines) expect(l).toMatchObject({ actor: expect.any(String), actorInstance: expect.any(String), origin: 'ui' })
    // Aucune API de réécriture : le module d'audit n'expose qu'écrire (ajout) et lire.
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'audit.ts'), 'utf8')
    expect(src).toContain('O_APPEND')
    expect(src).not.toMatch(/writeFileSync|truncate|ftruncate/)
  })
})
