/**
 * GH45 — test d'intégration contre une VRAIE forge (Forgejo ou Gitea installée par le kit deploy/).
 * Exerce les services du process main (AuthService, SyncService) comme le desktop, sans UI.
 *
 *   pnpm exec tsx scripts/forge-smoke.ts <comptes.json> "<commande admin>"
 *
 * <comptes.json> : sortie du script de préparation des comptes de test (itest-auteur, itest-lecteur,
 * itest-2fa avec secret TOTP, itest-neuf à mot de passe temporaire, repo <org>/itest).
 * <commande admin> : préfixe qui exécute polenta-admin sur l'hôte, ex.
 *   "ssh debian@hote sudo polenta-admin --instance acme"
 *
 * Aucun mot de passe ni jeton n'est affiché. Sortie non nulle si un scénario échoue.
 */
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { execSync } from 'child_process'
import git from 'isomorphic-git'
import { parseForgeAccessError } from '@polenta/types'

import { AuthService } from '../src/main/services/auth.service'
import { SyncService } from '../src/main/services/sync.service'
import type { HostContext, TokenStore } from '../src/main/host/host-context'

interface Accounts {
  instance: string
  baseUrl: string
  org: string
  auteur: string
  lecteur: string
  twofa: { password: string; secret: string }
  neuf: string
}

const [, , accountsFile, adminCmd] = process.argv
if (!accountsFile || !adminCmd) {
  console.error('usage : tsx scripts/forge-smoke.ts <comptes.json> "<commande admin>"')
  process.exit(2)
}
const A = JSON.parse(fs.readFileSync(accountsFile, 'utf-8')) as Accounts
const host = new URL(A.baseUrl).hostname
const repoUrl = `${A.baseUrl}/${A.org}/itest.git`

let failures = 0
function check(id: string, label: string, ok: boolean, detail = ''): void {
  if (!ok) failures += 1
  console.log(`  ${ok ? '✓' : '✗'} ${id} ${label}${detail ? ` — ${detail}` : ''}`)
}

class MapTokenStore implements TokenStore {
  readonly map = new Map<string, string>()
  async get(k: string) { return this.map.get(k) ?? null }
  async set(k: string, v: string) { this.map.set(k, v) }
  async delete(k: string) { return this.map.delete(k) }
}

async function workstation(label: string): Promise<{ auth: AuthService; sync: SyncService; dir: string; tokens: MapTokenStore }> {
  const dir = await fsP.mkdtemp(path.join(os.tmpdir(), `polenta-smoke-${label}-`))
  const tokens = new MapTokenStore()
  const ctx: HostContext = { userDataDir: path.join(dir, 'userData'), tokenStore: tokens, machineConfig: { hideGithub: true }, deviceLabel: `smoke-${label}` }
  const auth = new AuthService(ctx)
  return { auth, sync: new SyncService(auth), dir, tokens }
}

function totp(secret: string, offset = 0): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of secret.replace(/=+$/, '')) bits += alphabet.indexOf(c).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g)!.map(b => parseInt(b, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30) + offset))
  const h = crypto.createHmac('sha1', key).update(counter).digest()
  const o = h[h.length - 1] & 15
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

function admin(args: string): void {
  execSync(`${adminCmd} ${args}`, { stdio: 'pipe' })
}

async function caught(p: Promise<unknown>): Promise<unknown> {
  try { await p; return null } catch (err) { return err }
}

async function commitFile(sync: SyncService, repo: string, name: string): Promise<string> {
  await fsP.writeFile(path.join(repo, name), `smoke ${new Date().toISOString()}\n`)
  await git.add({ fs, dir: repo, filepath: name })
  return (await sync.commit(repo, `smoke: ${name}`)).sha
}

async function main(): Promise<void> {
  console.log(`== ${A.instance} (${A.baseUrl})`)

  // ── Détection ────────────────────────────────────────────────────────────────
  const w = await workstation('auteur')
  const detection = await w.auth.detectForge(A.baseUrl)
  check('S2-8', `détection : ${detection.provider}/${detection.flavor}`, detection.provider === 'forgejo')

  // ── Erreurs de connexion ─────────────────────────────────────────────────────
  const bad = await w.auth.loginWithPassword(A.baseUrl, 'itest-auteur', 'mauvais-mot-de-passe')
  check('S2-15', 'mauvais mot de passe → invalid-credentials', bad.status === 'invalid-credentials', bad.status)
  const neuf = await w.auth.loginWithPassword(A.baseUrl, 'itest-neuf', A.neuf)
  check('S2-15', 'compte neuf → password-change-required (URL du même serveur)',
    neuf.status === 'password-change-required' && neuf.url.startsWith(A.baseUrl), neuf.status === 'password-change-required' ? neuf.url : neuf.status)
  const notForge = await w.auth.loginWithPassword('https://www.esquaresoft.fr', 'x', 'y')
  check('S2-15', 'serveur qui n’est pas une forge → not-a-forge', notForge.status === 'not-a-forge', notForge.status)

  // ── 2FA ──────────────────────────────────────────────────────────────────────
  const w2 = await workstation('2fa')
  const noOtp = await w2.auth.loginWithPassword(A.baseUrl, 'itest-2fa', A.twofa.password)
  const expectedNoOtp = detection.flavor === 'gitea' ? 'invalid-credentials' : 'otp-required'
  check('S2-5', `2FA sans code → ${expectedNoOtp}`, noOtp.status === expectedNoOtp, noOtp.status)
  const badOtp = await w2.auth.loginWithPassword(A.baseUrl, 'itest-2fa', A.twofa.password, '000000')
  check('S2-5', '2FA code faux → refus', badOtp.status === 'invalid-otp' || badOtp.status === 'invalid-credentials', badOtp.status)
  const okOtp = await w2.auth.loginWithPassword(A.baseUrl, 'itest-2fa', A.twofa.password, totp(A.twofa.secret))
  check('S2-5', '2FA bon code → connecté', okOtp.status === 'ok', okOtp.status)

  // ── Connexion, identité, commit à son nom ────────────────────────────────────
  const login = await w.auth.loginWithPassword(A.baseUrl, 'itest-auteur', A.auteur)
  check('S2-3', 'connexion identifiant + mot de passe', login.status === 'ok' && login.account.provider === 'forgejo')
  const authJson = await fsP.readFile(path.join(w.dir, 'userData', 'auth.json'), 'utf-8')
  check('S2-16', 'mot de passe absent d’auth.json et du stockage des jetons',
    !authJson.includes(A.auteur) && ![...w.tokens.map.values()].includes(A.auteur))
  const repo = path.join(w.dir, 'itest')
  await w.sync.clone(repoUrl, repo)
  check('S2-4', 'clone du repo privé', fs.existsSync(path.join(repo, '.gitignore')))
  await commitFile(w.sync, repo, 'auteur.txt')
  await w.sync.pushBranch(repo, 'main')
  const [last] = await git.log({ fs, dir: repo, depth: 1 })
  check('S2-4 / critère 1', 'auteur du commit = identité de la forge',
    last.commit.author.name === 'Test itest-auteur' && last.commit.author.email === 'itest-auteur@esquaresoft.fr',
    `${last.commit.author.name} <${last.commit.author.email}>`)
  const info = await git.getRemoteInfo({ url: repoUrl, onAuth: async () => (await w.auth.getHttpsCredentials(repoUrl)) ?? undefined, http: (await import('../src/main/services/git-http')).default })
  const remoteHead = (info.refs as { heads?: Record<string, string> } | undefined)?.heads?.main
  check('S2-4', 'push effectif sur le serveur', remoteHead === last.oid)

  // ── Lecteur : push refusé, commit local conservé ─────────────────────────────
  const wl = await workstation('lecteur')
  const ll = await wl.auth.loginWithPassword(A.baseUrl, 'itest-lecteur', A.lecteur)
  check('S2-12', 'connexion lecteur', ll.status === 'ok')
  const repoL = path.join(wl.dir, 'itest')
  await wl.sync.clone(repoUrl, repoL)
  const shaL = await commitFile(wl.sync, repoL, 'lecteur.txt')
  const errL = await caught(wl.sync.pushBranch(repoL, 'main'))
  const parsedL = errL instanceof Error ? parseForgeAccessError(errL.message) : null
  check('S2-12 / critère 6', 'push lecteur → 403 « pas le droit de publier »', parsedL?.issue.status === 403, parsedL?.humanMessage ?? String(errL))
  const [lastL] = await git.log({ fs, dir: repoL, depth: 1 })
  check('S2-12', 'commit local conservé', lastL.oid === shaL)

  // ── Compte désactivé : accès révoqué, une seule fois, puis reconnexion ───────
  admin('user disable itest-auteur')
  try {
    const errF = await caught(w.sync.fetch(repo, ''))
    const parsedF = errF instanceof Error ? parseForgeAccessError(errF.message) : null
    check('S2-9 / critère 19', 'fetch d’un compte désactivé → 401 accès révoqué', parsedF?.issue.status === 401, parsedF?.humanMessage ?? String(errF))
    const before = (await git.log({ fs, dir: repo, depth: 1 }))[0].oid
    const tick1 = await w.sync.autoSync(repo, 'main')
    const t0 = Date.now()
    const tick2 = await w.sync.autoSync(repo, 'main')
    check('S2-9 / critère 5', 'auto-pull : accessRevoked, sans exception', tick1.accessRevoked === true && tick1.revokedServer === new URL(A.baseUrl).origin)
    check('S2-9 / critère 5', 'tick suivant sans appel réseau', tick2.accessRevoked === true && Date.now() - t0 < 500, `${Date.now() - t0} ms`)
    check('S2-9', 'working tree intact', (await git.log({ fs, dir: repo, depth: 1 }))[0].oid === before)
  } finally {
    admin('user enable itest-auteur')
  }
  const relog = await w.auth.loginWithPassword(A.baseUrl, 'itest-auteur', A.auteur)
  check('S2-11', 'reconnexion (même minute) → accès rétabli', relog.status === 'ok' && !w.auth.isAccessRevoked(host), relog.status === 'ok' ? '' : JSON.stringify(relog))
  const tick3 = await w.sync.autoSync(repo, 'main')
  check('S2-11', 'auto-pull repris', !tick3.accessRevoked, tick3.state)

  // ── Déconnexion ──────────────────────────────────────────────────────────────
  await w.auth.logout()
  check('S2-6', 'déconnexion : plus de compte ni de jeton local', (await w.auth.currentAccount()) === null && w.tokens.map.size === 0)

  for (const d of [w.dir, w2.dir, wl.dir]) await fsP.rm(d, { recursive: true, force: true }).catch(() => {})
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nTous les scénarios passent.' : `\n${failures} scénario(s) en échec.`)
    process.exit(failures === 0 ? 0 : 1)
  })
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
