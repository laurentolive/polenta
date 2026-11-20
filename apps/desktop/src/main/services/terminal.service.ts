import { execFile } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import type { IPty } from 'node-pty'
import type { TerminalDetectResult, TerminalKind } from '@polenta/types'
import { type AskpassCredentials, type AskpassSession, hostFromRemoteUrl, openAskpassSession, terminalCredentials } from '../git/askpass'
import { gitFor } from '../git/git-backend'
import { gitInstall } from '../git/git-binary'
import { gitEnv, pcGitIdentity } from '../git/git-config'
import { gitText } from '../git/git-runner'
import { cdCommand, resolveShell, shellEnv, type ShellSpec } from './terminal-shell.util'

/**
 * GH337 P3 — terminal : l'identité globale du PC sert de repli pour les clés `user.name` / `user.email`
 * absentes du dépôt et du compte actif (la config effective du terminal). Ces clés passent par
 * `GIT_CONFIG_COUNT`, qui ne sont posées que pour la clé manquante : jamais au-dessus d'une identité
 * déjà présente. Pas de dépôt ou pas d'identité PC : rien (git garde son comportement).
 */
async function terminalIdentityEnv(dir: string): Promise<Record<string, string>> {
  const read = (key: string): Promise<string> =>
    gitFor(dir).config(key).then(v => v?.trim() ?? '', () => '')
  const [name, email] = await Promise.all([read('user.name'), read('user.email')])
  if (name && email) return {}
  const pc = await pcGitIdentity().catch(() => null)
  if (!pc) return {}
  const pairs: Array<[string, string]> = []
  if (!name) pairs.push(['user.name', pc.name])
  if (!email) pairs.push(['user.email', pc.email])
  const env: Record<string, string> = { GIT_CONFIG_COUNT: String(pairs.length) }
  pairs.forEach(([key, value], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = key
    env[`GIT_CONFIG_VALUE_${i}`] = value
  })
  return env
}

/**
 * GH238 — sessions de pseudo-terminal du panneau Terminal de la vue Version. Desktop seulement :
 * instancié par `registerDesktopOnlyHandlers`, hors du `Container` partagé avec le serveur web, pour
 * que le module natif `node-pty` n'y soit jamais chargé.
 *
 * GH337 — sous Windows, le shell est le Git Bash embarqué, avec le même environnement isolé que les
 * processus git de Polenta (`gitEnv({ terminal: true })`). Sans installation embarquée, la session
 * ne démarre pas : l'erreur (qui indique `pnpm git:fetch` en dev) s'affiche dans le terminal.
 */

type NodePty = typeof import('node-pty')

let nodePty: NodePty | null = null

/** `node-pty` chargé au premier usage, depuis `app.asar.unpacked` en build packagé : son worker
 *  de sortie ConPTY (`new Worker(__dirname/…)`) et ses binaires doivent être de vrais fichiers. */
function loadNodePty(): NodePty {
  if (!nodePty) {
    const resolved = require.resolve('node-pty')
    const unpacked = resolved.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    nodePty = require(unpacked !== resolved && fs.existsSync(unpacked) ? unpacked : resolved) as NodePty
  }
  return nodePty
}

/**
 * GH337 §6 — hôtes des remotes du dépôt dans lequel le terminal démarre. Hors dépôt (ou git
 * indisponible) : ensemble vide. `rev-parse` d'abord, pour ne pas lire la config globale de git
 * (`remotes()` la lirait hors dépôt).
 */
async function remoteHostsOf(dir: string): Promise<Set<string>> {
  try {
    await gitText(dir, ['rev-parse', '--git-dir'])
    const remotes = await gitFor(dir).remotes()
    return new Set(remotes.map(r => hostFromRemoteUrl(r.url)).filter((h): h is string => h !== null))
  } catch {
    return new Set()
  }
}

/** Dépendances injectables (tests) : par défaut, le compte connecté, `node-pty` et le Git Bash embarqué. */
export interface TerminalDeps {
  /** Identifiants du compte connecté pour un remote (GH337 §6, session terminal). */
  auth?: { getHttpsCredentials(remote: string): Promise<AskpassCredentials | null> }
  spawnPty?: NodePty['spawn']
  shell?: () => ShellSpec
}

interface TerminalSession { pty: IPty; owner: number; askpass: AskpassSession }

export class TerminalService {
  private readonly sessions = new Map<string, TerminalSession>()
  private nextId = 1

  /** `send` diffuse aux fenêtres (`terminal:data`, `terminal:exit`). */
  /** GH342 — `send` vise la fenêtre propriétaire (id de webContents) : avec plusieurs fenêtres, la
   *  sortie d'un shell ne part pas dans les autres. */
  constructor(
    private readonly send: (owner: number, channel: string, ...args: unknown[]) => void,
    private readonly deps: TerminalDeps = {},
  ) {}

  /** Shell à lancer, re-résolu à chaque appel. Sous Windows, lève `GitUnavailableError` si le git
   *  embarqué est absent. */
  private shell(): ShellSpec {
    if (this.deps.shell) return this.deps.shell()
    const embeddedBash = process.platform === 'win32' ? gitInstall().bashExe : null
    return resolveShell({ platform: process.platform, env: process.env, embeddedBash, exists: p => fs.existsSync(p) })
  }

  private spawnPty(file: string, args: string[], opts: Parameters<NodePty['spawn']>[2]): IPty {
    return this.deps.spawnPty ? this.deps.spawnPty(file, args, opts) : loadNodePty().spawn(file, args, opts)
  }

  async detect(): Promise<TerminalDetectResult> {
    const shell = this.shell()
    return { status: 'found', shell: { name: shell.name, file: shell.file } }
  }

  /** `owner` : id du webContents demandeur — ses sessions sont tuées quand il recharge ou disparaît
   *  (`killOwnedBy`), le nettoyage React n'ayant alors pas lieu. */
  /** GH337 §6 — la session reçoit un nonce « terminal » : git et son askpass lisent l'hôte de chaque
   *  invite et répondent avec le compte connecté pour cet hôte. Le nonce est révoqué à la fermeture. */
  async start(_kind: TerminalKind, cwd: string, cols: number, rows: number, owner: number): Promise<{ id: string; name: string }> {
    const shell = this.shell()
    const lookup = (remote: string): Promise<AskpassCredentials | null> =>
      this.deps.auth ? this.deps.auth.getHttpsCredentials(remote) : Promise.resolve(null)
    const dir = cwd && fs.existsSync(cwd) ? cwd : os.homedir()
    // GH337 — seuls les hôtes des remotes du dépôt de départ reçoivent des identifiants (ensemble vide
    // hors dépôt).
    const askpass = await openAskpassSession(terminalCredentials(lookup, await remoteHostsOf(dir)), 'terminal')
    let pty: IPty
    try {
      pty = this.spawnPty(shell.file, shell.args, {
        name: 'xterm-256color',
        cols: Math.max(cols, 2),
        rows: Math.max(rows, 1),
        cwd: dir,
        env: shellEnv(gitEnv({ terminal: true, extra: await terminalIdentityEnv(dir) }), process.platform, askpass.env),
        // ConPTY de Windows, pas celui livré par node-pty (option expérimentale, désactivée aussi par
        // défaut dans VS Code) : avec ce dernier, une frappe rapide arrivait parfois dans le désordre
        // au shell (`techo` pour `echo`), constaté en test d'interface.
        useConptyDll: false,
      })
    } catch (err) {
      askpass.revoke()
      throw err
    }
    const id = String(this.nextId++)
    this.sessions.set(id, { pty, owner, askpass })
    pty.onData(chunk => this.send(owner, 'terminal:data', id, chunk))
    pty.onExit(({ exitCode }) => {
      askpass.revoke()
      this.sessions.delete(id)
      this.send(owner, 'terminal:exit', id, exitCode)
    })
    return { id, name: shell.name }
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.pty.write(data)
  }

  /** « Aller au repo sélectionné » : tape `cd '<repo>'` + Entrée dans le shell. */
  cd(id: string, repoPath: string): void {
    this.write(id, cdCommand(repoPath, process.platform))
  }

  resize(id: string, cols: number, rows: number): void {
    try {
      this.sessions.get(id)?.pty.resize(Math.max(cols, 2), Math.max(rows, 1))
    } catch { /* processus déjà terminé */ }
  }

  /** Termine le shell et ses descendants. `pty.kill()` tue les processus attachés à la console
   *  (git, less…) ; `taskkill /T` en repli, une seconde après, pour un descendant qui y aurait
   *  échappé — pas avant : l'agent de node-pty qui liste la console échouerait. */
  kill(id: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    const pty = session.pty
    const pid = pty.pid
    // Session en fermeture : son nonce askpass n'a plus à répondre (GH337 §6).
    session.askpass.revoke()
    try {
      pty.kill()
    } catch { /* déjà terminé */ }
    if (process.platform === 'win32') {
      setTimeout(() => {
        // Shell déjà sorti : son PID a pu être réattribué, ne rien tuer.
        if (this.sessions.get(id)?.pty !== pty) return
        execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {})
      }, 1000)
    }
  }

  killOwnedBy(owner: number): void {
    for (const [id, s] of this.sessions) if (s.owner === owner) this.kill(id)
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }
}
