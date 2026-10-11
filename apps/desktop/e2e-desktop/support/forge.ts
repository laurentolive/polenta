import * as crypto from 'crypto'
import * as path from 'path'
import { execFileSync, execSync } from 'child_process'

/**
 * GH45 — accès à la forge de test (instance du kit deploy/) pour les tests d'interface du desktop.
 *
 *   POLENTA_E2E_SSH       commande SSH vers l'hôte, ex. « ssh -o BatchMode=yes debian@vps-xxxx »
 *   POLENTA_E2E_INSTANCE  instance du kit (défaut : acme)
 */
export interface Accounts {
  instance: string
  baseUrl: string
  org: string
  auteur: string
  testeur: string
  lecteur: string
  twofa: { password: string; secret: string }
  neuf: string
}

export const SSH = process.env['POLENTA_E2E_SSH'] ?? ''
export const INSTANCE = process.env['POLENTA_E2E_INSTANCE'] ?? 'acme'
const SETUP = path.join(__dirname, 'forge-setup.py')

function ssh(remote: string): string {
  if (!SSH) throw new Error('POLENTA_E2E_SSH requis (accès SSH à l’hôte de la forge de test).')
  return execSync(`${SSH} ${remote}`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
}

export function uploadSetupScript(): void {
  const [cmd, ...args] = SSH.split(/\s+/)
  const target = args.pop()!
  execFileSync(cmd === 'ssh' ? 'scp' : cmd, [...args.filter(a => a !== '-T'), '-q', SETUP, `${target}:/tmp/forge-setup.py`])
}

export function resetAccounts(instance = INSTANCE): Accounts {
  return JSON.parse(ssh(`sudo python3 /tmp/forge-setup.py accounts ${instance}`)) as Accounts
}

/** GH45 S4 — itest : schéma avec un champ `user` et une exigence. */
export function seedItest(): void {
  ssh(`sudo python3 /tmp/forge-setup.py seed ${INSTANCE}`)
}

/** GH45 S4 — état d'un repo de l'organisation sur la forge. */
export function repoInfo(name: string): { exists: boolean; private?: boolean; branches?: string[] } {
  return JSON.parse(ssh(`sudo python3 /tmp/forge-setup.py repo ${INSTANCE} ${name}`))
}

/** GH45 S4 — supprime les repos de l'organisation `<préfixe>*`. */
export function deleteRepos(prefix: string): void {
  ssh(`sudo python3 /tmp/forge-setup.py delete-repos ${INSTANCE} ${prefix}`)
}

/** GH45 S4 — n repos vides `<préfixe>NN`. */
export function bulkRepos(prefix: string, n: number): void {
  ssh(`sudo python3 /tmp/forge-setup.py bulk ${INSTANCE} ${prefix} ${n}`)
}

export function setTeamConfig(yaml: string): void {
  ssh(`sudo python3 /tmp/forge-setup.py config ${INSTANCE} ${Buffer.from(yaml, 'utf-8').toString('base64')}`)
}

export function admin(args: string): void {
  ssh(`sudo polenta-admin --instance ${INSTANCE} ${args}`)
}

export function totp(secret: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of secret.replace(/=+$/, '')) bits += alphabet.indexOf(c).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g)!.map(b => parseInt(b, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)))
  const h = crypto.createHmac('sha1', key).update(counter).digest()
  const o = h[h.length - 1] & 15
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}
