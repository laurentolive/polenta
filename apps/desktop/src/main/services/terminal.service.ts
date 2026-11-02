import { execFile } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import type { IPty } from 'node-pty'
import type { TerminalDetectResult, TerminalKind } from '@polenta/types'
import { cdCommand, resolveShell, shellEnv } from './terminal-shell.util'

/**
 * GH238 — sessions de pseudo-terminal du panneau Terminal de la vue Version. Desktop seulement :
 * instancié par `registerDesktopOnlyHandlers`, hors du `Container` partagé avec le serveur web, pour
 * que le module natif `node-pty` n'y soit jamais chargé.
 */

type NodePty = typeof import('node-pty')

const WINGET_INSTALL_GIT = [
  'install', '--id', 'Git.Git', '-e', '--source', 'winget',
  '--accept-package-agreements', '--accept-source-agreements',
]

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

export class TerminalService {
  private readonly sessions = new Map<string, { pty: IPty; owner: number }>()
  private nextId = 1
  private wingetAvailable: Promise<boolean> | null = null

  /** `send` diffuse aux fenêtres (`terminal:data`, `terminal:exit`). */
  constructor(private readonly send: (channel: string, ...args: unknown[]) => void) {}

  private shell() {
    return resolveShell({ platform: process.platform, env: process.env, exists: p => fs.existsSync(p) })
  }

  /** Shell re-cherché à chaque appel (Git peut être installé pendant que Polenta tourne) ; la
   *  présence de winget, elle, est mise en cache. */
  async detect(): Promise<TerminalDetectResult> {
    const shell = this.shell()
    if (shell) return { status: 'found', shell: { name: shell.name, file: shell.file } }
    return { status: 'not-found', winget: process.platform === 'win32' && await this.hasWinget() }
  }

  private hasWinget(): Promise<boolean> {
    this.wingetAvailable ??= new Promise(resolve => {
      execFile('winget', ['--version'], { timeout: 5000, windowsHide: true }, err => resolve(!err))
    })
    return this.wingetAvailable
  }

  /** `owner` : id du webContents demandeur — ses sessions sont tuées quand il recharge ou disparaît
   *  (`killOwnedBy`), le nettoyage React n'ayant alors pas lieu. */
  start(kind: TerminalKind, cwd: string, cols: number, rows: number, owner: number): { id: string; name: string } {
    let file: string
    let args: string[]
    let name: string
    if (kind === 'install-git') {
      file = 'winget'
      args = WINGET_INSTALL_GIT
      name = 'winget'
      cwd = os.homedir()
    } else {
      const shell = this.shell()
      if (!shell) throw new Error('Git Bash not found')
      ;({ file, args, name } = shell)
    }
    const pty = loadNodePty().spawn(file, args, {
      name: 'xterm-256color',
      cols: Math.max(cols, 2),
      rows: Math.max(rows, 1),
      cwd: cwd && fs.existsSync(cwd) ? cwd : os.homedir(),
      env: shellEnv(process.env, process.platform),
      // ConPTY de Windows, pas celui livré par node-pty (option expérimentale, désactivée aussi par
      // défaut dans VS Code) : avec ce dernier, une frappe rapide arrivait parfois dans le désordre
      // au shell (`techo` pour `echo`), constaté en test d'interface.
      useConptyDll: false,
    })
    const id = String(this.nextId++)
    this.sessions.set(id, { pty, owner })
    pty.onData(chunk => this.send('terminal:data', id, chunk))
    pty.onExit(({ exitCode }) => {
      this.sessions.delete(id)
      this.send('terminal:exit', id, exitCode)
    })
    return { id, name }
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
    const pty = this.sessions.get(id)?.pty
    if (!pty) return
    const pid = pty.pid
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
