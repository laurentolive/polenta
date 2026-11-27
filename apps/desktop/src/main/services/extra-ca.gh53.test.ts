import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as https from 'https'
import * as os from 'os'
import * as path from 'path'
import * as tls from 'tls'
import type { AddressInfo } from 'net'
import { request as undiciRequest } from 'undici'

vi.mock('electron', () => ({ session: { defaultSession: { resolveProxy: async () => 'DIRECT' } } }))

import {
  configureExtraCa, extraCaCertificates, gitCaBundlePath, gitDefaultBundle, loadExtraCaCertificates,
  parsePemCertificates, tlsCaOption,
} from './extra-ca'
import { resolveProxyDispatcher } from './net-proxy'

// Fixtures de test uniquement (voir fixtures/extra-ca/README.md) : CA de test et certificat « localhost ».
const FIXTURES = path.join(__dirname, 'fixtures', 'extra-ca')
const caPem = fs.readFileSync(path.join(FIXTURES, 'ca.pem'), 'utf-8')
const serverPem = fs.readFileSync(path.join(FIXTURES, 'server.pem'), 'utf-8')
const serverKey = fs.readFileSync(path.join(FIXTURES, 'server.key'), 'utf-8')

const PROXY_VARS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy']
const savedEnv: Record<string, string | undefined> = {}
const quietWarn = () => undefined
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'polenta-extra-ca-'))

let server: https.Server
let url: string

beforeAll(async () => {
  for (const v of PROXY_VARS) { savedEnv[v] = process.env[v]; delete process.env[v] }
  server = https.createServer({ key: serverKey, cert: serverPem }, (_req, res) => { res.end('ok') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  url = `https://127.0.0.1:${(server.address() as AddressInfo).port}/`
})

afterEach(() => configureExtraCa({ pems: [], dataDir: tmp }))

afterAll(() => {
  server.close()
  for (const v of PROXY_VARS) { if (savedEnv[v] === undefined) delete process.env[v]; else process.env[v] = savedEnv[v] }
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('GH53 — PEM et chargement', () => {
  it('T-X1 : un fichier à deux certificats donne deux blocs, terminés par un saut de ligne', () => {
    const blocks = parsePemCertificates(`${caPem}\r\n${serverPem}`)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatch(/-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\n$/)
  })

  it('T-X2 : fichier absent → [] et avertissement, sans exception', () => {
    const warnings: string[] = []
    expect(loadExtraCaCertificates({ path: '/absent.pem', readFile: () => null, warn: m => warnings.push(m) })).toEqual([])
    expect(warnings[0]).toContain('introuvable')
  })

  it('T-X3 : fichier sans bloc CERTIFICATE → [] et avertissement', () => {
    const warnings: string[] = []
    const pems = loadExtraCaCertificates({ path: 'x.pem', readFile: () => 'pas un certificat', warn: m => warnings.push(m) })
    expect(pems).toEqual([])
    expect(warnings[0]).toContain('sans certificat PEM')
  })

  it('T-X3b : fichier illisible (erreur levée) → [] et avertissement', () => {
    const warnings: string[] = []
    const pems = loadExtraCaCertificates({ path: 'x.pem', readFile: () => { throw new Error('EACCES') }, warn: m => warnings.push(m) })
    expect(pems).toEqual([])
    expect(warnings[0]).toContain('EACCES')
  })
})

describe('GH53 — racines TLS', () => {
  it('T-X4 : sans CA, aucune option ca (la connexion garde ses réglages)', () => {
    configureExtraCa({ pems: [], dataDir: tmp })
    expect(tlsCaOption()).toBeUndefined()
    expect(extraCaCertificates()).toEqual([])
  })

  it('T-X5 : avec CA, les racines publiques de Node sont conservées et la CA ajoutée', () => {
    configureExtraCa({ pems: [caPem], dataDir: tmp })
    const ca = tlsCaOption()!
    expect(ca).toHaveLength(tls.rootCertificates.length + 1)
    expect(ca.slice(0, tls.rootCertificates.length)).toEqual([...tls.rootCertificates])
    expect(ca[ca.length - 1]).toBe(caPem)
  })
})

describe('GH53 — connexions TLS réelles (serveur local signé par la CA de test)', () => {
  it('T-P1 : avec la CA de l\'entreprise, la requête aboutit', async () => {
    configureExtraCa({ pems: [caPem], dataDir: tmp })
    const dispatcher = await resolveProxyDispatcher(url)
    const res = await undiciRequest(url, { dispatcher })
    expect(res.statusCode).toBe(200)
    await res.body.text()
  })

  it('T-P2 : sans la CA, la même requête échoue sur la chaîne de certification', async () => {
    configureExtraCa({ pems: [], dataDir: tmp })
    const dispatcher = await resolveProxyDispatcher(url)
    let code: string | undefined
    try {
      await undiciRequest(url, { dispatcher })
    } catch (err) {
      code = ((err as { code?: string }).code) ?? ((err as { cause?: { code?: string } }).cause?.code)
    }
    expect(code).toMatch(/SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO/)
  })

  it('T-P3 : le cache ne réutilise pas un agent sans CA quand une CA est configurée', async () => {
    configureExtraCa({ pems: [], dataDir: tmp })
    const sansCa = await resolveProxyDispatcher(url)
    configureExtraCa({ pems: [caPem], dataDir: tmp })
    const avecCa = await resolveProxyDispatcher(url)
    expect(avecCa).not.toBe(sansCa)
  })
})

describe('GH53 — bundle git', () => {
  it('T-G2 : le bundle écrit contient les racines par défaut de git puis la CA', () => {
    const gitRoot = fs.mkdtempSync(path.join(tmp, 'git-'))
    const bundleDir = path.join(gitRoot, 'usr', 'ssl', 'certs')
    fs.mkdirSync(bundleDir, { recursive: true })
    fs.writeFileSync(path.join(bundleDir, 'ca-bundle.crt'), '-----BEGIN CERTIFICATE-----\nRACINE-PUBLIQUE\n-----END CERTIFICATE-----\n')
    const source = gitDefaultBundle(gitRoot)!
    configureExtraCa({ pems: [caPem], dataDir: tmp })
    const dest = gitCaBundlePath(source, quietWarn)!
    const written = fs.readFileSync(dest, 'utf-8')
    expect(written).toContain('RACINE-PUBLIQUE')
    const caBody = caPem.trim().split('\n')[1]!
    expect(written).toContain(caBody)
    expect(written.indexOf('RACINE-PUBLIQUE')).toBeLessThan(written.indexOf(caBody))
  })

  it('T-G5 : bundle par défaut introuvable → null et avertissement (git garde ses réglages)', () => {
    configureExtraCa({ pems: [caPem], dataDir: tmp })
    const warnings: string[] = []
    expect(gitCaBundlePath(null, m => warnings.push(m))).toBeNull()
    expect(warnings[0]).toContain('bundle CA de git introuvable')
  })

  it('sans CA : aucun bundle', () => {
    configureExtraCa({ pems: [], dataDir: tmp })
    expect(gitCaBundlePath('/quelque/part.crt', quietWarn)).toBeNull()
  })

  it('gitDefaultBundle : chemin usr/ssl de PortableGit, null sans installation ou sans fichier', () => {
    expect(gitDefaultBundle(null)).toBeNull()
    expect(gitDefaultBundle('/git', () => false)).toBeNull()
    const found = gitDefaultBundle('/git', f => f.endsWith(path.join('usr', 'ssl', 'certs', 'ca-bundle.crt')))
    expect(found).toBe(path.join('/git', 'usr', 'ssl', 'certs', 'ca-bundle.crt'))
  })

  it('T-G1 : le bundle du PortableGit embarqué est trouvé (fichier réel de vendor/git, si présent)', () => {
    const embedded = path.resolve(__dirname, '../../../vendor/git')
    if (!fs.existsSync(path.join(embedded, 'usr', 'ssl', 'certs', 'ca-bundle.crt'))) return
    expect(gitDefaultBundle(embedded)).not.toBeNull()
  })
})
