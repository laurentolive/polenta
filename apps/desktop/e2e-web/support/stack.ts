import { spawn, execFileSync, type ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as net from 'net'
import * as path from 'path'
import type * as http from 'http'
import { E2E, serverEnv, type StackInfo } from './env'
import { startGitHttpServer } from './git-http-server'

/**
 * GH387 — pile de test d'un worker : forge git HTTP (dans le process du global setup), faux service
 * d'administration et serveur web (process enfants), dossiers propres au worker. Une pile par
 * worker : les workers ne se gênent pas, et des ports libres par pile évitent les conflits entre
 * worktrees.
 */

/** Écoute `port` sur 127.0.0.1 (0 : port choisi par le système) puis le libère ; rejette s'il est pris. */
function probePort(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(port, '127.0.0.1', () => {
      const { port: bound } = srv.address() as net.AddressInfo
      srv.close(() => resolve(bound))
    })
  })
}

/**
 * Ports des piles. Forcé par `POLENTA_E2E_<name>` (base, worker `i` → base + 10·i) : vérifié libre,
 * sinon la pile répondrait par le serveur d'une autre exécution. Sinon port libre, jamais deux fois
 * le même dans l'exécution.
 */
async function stackPort(envName: string, index: number, taken: Set<number>): Promise<number> {
  const base = process.env[envName]
  if (base) {
    const port = Number(base) + 10 * index
    await probePort(port).catch(() => { throw new Error(`e2e : port ${port} (${envName}) déjà utilisé`) })
    taken.add(port)
    return port
  }
  for (;;) {
    const port = await probePort(0)
    if (!taken.has(port)) {
      taken.add(port)
      return port
    }
  }
}

/** Dossiers et ports des piles `0..count-1` (rien n'est démarré). */
export async function planStacks(count: number): Promise<StackInfo[]> {
  const taken = new Set<number>()
  const stacks: StackInfo[] = []
  for (let index = 0; index < count; index++) {
    const root = path.join(E2E.root, `w${index}`)
    stacks.push({
      index,
      root,
      dataDir: path.join(root, 'data'),
      remotesDir: path.join(root, 'remotes'),
      downloadsDir: path.join(root, 'downloads'),
      port: await stackPort('POLENTA_E2E_PORT', index, taken),
      gitPort: await stackPort('POLENTA_E2E_GIT_PORT', index, taken),
      adminPort: await stackPort('POLENTA_E2E_ADMIN_PORT', index, taken),
    })
  }
  return stacks
}

/** Démarre la pile ; renvoie sa fonction d'arrêt. `remotes` : repos nus copiés dans sa forge (nom → chemin). */
export async function startStack(stack: StackInfo, remotes: Record<string, string>): Promise<() => Promise<void>> {
  for (const dir of [stack.dataDir, stack.downloadsDir, stack.remotesDir]) fs.mkdirSync(dir, { recursive: true })
  for (const [name, from] of Object.entries(remotes)) fs.cpSync(from, path.join(stack.remotesDir, name), { recursive: true })

  const git = await startGitHttpServer(stack.remotesDir, stack.gitPort)
  const children: ChildProcess[] = []
  const tag = `[w${stack.index}]`
  const start = (args: string[], env: Record<string, string>) => {
    const child = spawn(process.execPath, args, {
      cwd: path.resolve(__dirname, '..', '..'),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'ignore', 'pipe'],
      // Hors Windows : groupe de process propre, arrêté d'un coup (`killTree`).
      detached: process.platform !== 'win32',
    })
    child.stderr!.on('data', (d: Buffer) => {
      for (const line of d.toString().split(/\r?\n/)) if (line) process.stderr.write(`${tag} ${line}\n`)
    })
    children.push(child)
    return child
  }
  start(['e2e-web/support/fake-admin-service.mjs'], {
    POLENTA_E2E_ADMIN_PORT: String(stack.adminPort),
    POLENTA_E2E_ADMIN_TOKEN: E2E.adminToken,
  })
  start(['e2e-web/support/run-server.mjs', 'out/web-server/index.cjs'], serverEnv(stack))

  const stop = async () => {
    for (const child of children) killTree(child)
    await new Promise<void>(resolve => (git as http.Server).close(() => resolve()))
  }
  try {
    await Promise.all([
      waitHealthy(`http://127.0.0.1:${stack.adminPort}/healthz`, children),
      waitHealthy(`http://127.0.0.1:${stack.port}/healthz`, children),
    ])
  } catch (err) {
    await stop()
    throw err
  }
  return stop
}

/** Attend une réponse 2xx de `url` ; échoue si un process de la pile s'arrête ou après 60 s. */
async function waitHealthy(url: string, children: ChildProcess[], timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const dead = children.find(c => c.exitCode !== null || c.signalCode !== null)
    if (dead) throw new Error(`${url} : process de la pile arrêté au démarrage (code ${dead.exitCode})`)
    const ok = await fetch(url).then(r => r.ok, () => false)
    if (ok) return
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error(`${url} : pas de réponse en ${timeoutMs / 1000} s`)
}

/** Arrête un process et ses descendants (le serveur web est l'enfant de `run-server.mjs`). */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else process.kill(-child.pid, 'SIGKILL')
  } catch {
    // déjà arrêté
  }
}
