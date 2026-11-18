import { randomBytes } from 'crypto'
import * as fs from 'fs'
import * as net from 'net'
import * as os from 'os'
import * as path from 'path'

/**
 * GH337 — identifiants des opérations réseau git (design §6).
 *
 * Le process hôte (main Electron ou serveur web) ouvre un serveur sur un pipe nommé (Windows) ou une
 * socket unix `0600` (ailleurs). Chaque opération réseau reçoit un jeton à usage limité, qui mène à
 * une fonction de résolution des identifiants (`auth.getHttpsCredentials`). Le processus git ne reçoit
 * que le chemin du pipe et le jeton : jamais le PAT, qui n'entre pas dans son environnement.
 *
 * Git appelle `GIT_ASKPASS` avec l'invite (`Username for 'https://…': ` / `Password for …`) ; le shim
 * (`askpass/askpass.sh` → `askpass/askpass.js`) envoie `{ nonce, prompt }` au serveur, qui répond la
 * valeur. Jeton inconnu, révoqué ou invite non reconnue : réponse vide, git échoue en `auth`.
 */

export interface AskpassCredentials { username: string; password: string }
export type CredentialResolver = () => Promise<AskpassCredentials | null>

/** Nombre maximal de réponses données pour un jeton (username + password, avec une marge de reprise). */
const MAX_ANSWERS_PER_TOKEN = 6

interface TokenEntry { resolve: CredentialResolver; answers: number }

const tokens = new Map<string, TokenEntry>()
let server: net.Server | null = null
let endpoint: string | null = null
let starting: Promise<string> | null = null
let scratchDir: string | null = null

/** Dossier des shims (`askpass.sh`, `askpass.js`) : resources packagées, sinon sources (dev, tests). */
export function askpassDir(): string {
  const candidates: string[] = []
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'git', 'askpass'))
  let dir = __dirname
  for (let i = 0; i < 6; i++) {
    candidates.push(path.join(dir, 'git', 'askpass'), path.join(dir, 'src', 'main', 'git', 'askpass'))
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  const found = candidates.find(c => fs.existsSync(path.join(c, 'askpass.js')))
  if (!found) throw new Error('Shim askpass introuvable (git/askpass/askpass.js)')
  return found
}

/** Adresse du serveur : pipe nommé sous Windows, socket unix `0600` dans un dossier privé ailleurs. */
function listen(): Promise<string> {
  const name = randomBytes(12).toString('hex')
  const where = process.platform === 'win32'
    ? `\\\\.\\pipe\\polenta-askpass-${name}`
    : path.join(scratchDir ??= fs.mkdtempSync(path.join(os.tmpdir(), 'polenta-askpass-')), `${name}.sock`)
  return new Promise((resolve, reject) => {
    const srv = net.createServer(handleConnection)
    srv.once('error', reject)
    srv.listen(where, () => {
      srv.removeListener('error', reject)
      if (process.platform !== 'win32') fs.chmodSync(where, 0o600)
      server = srv
      endpoint = where
      resolve(where)
    })
  })
}

async function ensureServer(): Promise<string> {
  if (endpoint) return endpoint
  starting ??= listen().finally(() => { starting = null })
  return starting
}

function handleConnection(sock: net.Socket): void {
  let buf = ''
  let answered = false
  sock.setEncoding('utf8')
  sock.setTimeout(10_000, () => sock.destroy())
  sock.on('data', (chunk: string) => {
    if (answered) return
    buf += chunk
    const nl = buf.indexOf('\n')
    if (nl < 0 || buf.length > 4096) return
    answered = true
    void answer(buf.slice(0, nl)).then(value => sock.end(JSON.stringify({ value }) + '\n'), () => sock.end(JSON.stringify({ value: '' }) + '\n'))
  })
  sock.on('error', () => undefined)
}

/** Réponse à une invite : `Username…` → login, `Password…` → mot de passe ; sinon, rien. */
async function answer(line: string): Promise<string> {
  let req: { nonce?: unknown; prompt?: unknown }
  try { req = JSON.parse(line) } catch { return '' }
  const entry = typeof req.nonce === 'string' ? tokens.get(req.nonce) : undefined
  if (!entry || entry.answers >= MAX_ANSWERS_PER_TOKEN) return ''
  entry.answers++
  const prompt = typeof req.prompt === 'string' ? req.prompt : ''
  if (!/^(username|password)\b/i.test(prompt.trim())) return ''
  const creds = await entry.resolve().catch(() => null)
  if (!creds) return ''
  return /^username/i.test(prompt.trim()) ? creds.username : creds.password
}

export interface AskpassSession {
  /** Variables à passer au processus git (jamais l'identifiant lui-même). */
  env: Record<string, string>
  /** Révoque le jeton : toute invite ultérieure reçoit une réponse vide. */
  revoke(): void
}

/**
 * Ouvre une session d'identifiants pour une opération réseau. `resolve` est appelé à chaque invite
 * (lazy : rien n'est lu si git n'en a pas besoin). Appeler `revoke()` à la fin de l'opération.
 */
export async function openAskpassSession(resolve: CredentialResolver): Promise<AskpassSession> {
  const where = await ensureServer()
  const nonce = randomBytes(32).toString('hex')
  tokens.set(nonce, { resolve, answers: 0 })
  const dir = askpassDir()
  return {
    env: {
      POLENTA_ASKPASS_PIPE: where,
      POLENTA_ASKPASS_NONCE: nonce,
      GIT_ASKPASS: path.join(dir, 'askpass.sh'),
      SSH_ASKPASS: path.join(dir, 'askpass.sh'),
      POLENTA_NODE: process.execPath,
      POLENTA_ASKPASS_JS: path.join(dir, 'askpass.js'),
      ELECTRON_RUN_AS_NODE: '1',
    },
    revoke: () => { tokens.delete(nonce) },
  }
}

/** Nombre de jetons encore valides (tests, diagnostic). */
export function activeAskpassTokens(): number {
  return tokens.size
}

/** Arrête le serveur d'identifiants (fermeture de l'application ou du serveur web). */
export function closeAskpassServer(): Promise<void> {
  tokens.clear()
  const srv = server
  server = null
  endpoint = null
  if (!srv) return Promise.resolve()
  return new Promise(resolve => {
    srv.close(() => {
      if (scratchDir) fs.rmSync(scratchDir, { recursive: true, force: true })
      scratchDir = null
      resolve()
    })
  })
}
