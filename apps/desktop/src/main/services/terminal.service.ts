import { execFile } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import type { IPty } from 'node-pty'
import type { TerminalDetectResult, TerminalKind } from '@polenta/types'
import { gitInstall } from '../git/git-binary'
import { gitEnv } from '../git/git-config'
import { cdCommand, resolveShell, shellEnv, type ShellSpec } from './terminal-shell.util'

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

export class TerminalService {
  private readonly sessions = new Map<string, { pty: IPty; owner: number }>()
  private nextId = 1

  /** `send` diffuse aux fenêtres (`terminal:data`, `terminal:exit`). */
  /** GH342 — `send` vise la fenêtre propriétaire (id de webContents) : avec plusieurs fenêtres, la
   *  sortie d'un shell ne part pas dans les autres. */
  constructor(private readonly send: (owner: number, channel: string, ...args: unknown[]) => void) {}

  /** Shell à lancer, re-résolu à chaque appel. Sous Windows, lève `GitUnavailableError` si le git
   *  embarqué est absent. */
  private shell(): ShellSpec {
    const embeddedBash = process.platform === 'win32' ? gitInstall().bashExe : null
    return resolveShell({ platform: process.platform, env: process.env, embeddedBash, exists: p => fs.existsSync(p) })
  }

  async detect(): Promise<TerminalDetectResult> {
    const shell = this.shell()
    return { status: 'found', shell: { name: shell.name, file: shell.file } }
  }

  /** `owner` : id du webContents demandeur — ses sessions sont tuées quand il recharge ou disparaît
   *  (`killOwnedBy`), le nettoyage React n'ayant alors pas lieu. */
  start(_kind: TerminalKind, cwd: string, cols: number, rows: number, owner: number): { id: string; name: string } {
    const shell = this.shell()
    const pty = loadNodePty().spawn(shell.file, shell.args, {
      name: 'xterm-256color',
      cols: Math.max(cols, 2),
      rows: Math.max(rows, 1),
      cwd: cwd && fs.existsSync(cwd) ? cwd : os.homedir(),
      env: shellEnv(gitEnv({ terminal: true }), process.platform),
      // ConPTY de Windows, pas celui livré par node-pty (option expérimentale, désactivée aussi par
      // défaut dans VS Code) : avec ce dernier, une frappe rapide arrivait parfois dans le désordre
      // au shell (`techo` pour `echo`), constaté en test d'interface.
      useConptyDll: false,
    })
    const id = String(this.nextId++)
    this.sessions.set(id, { pty, owner })
    pty.onData(chunk => this.send(owner, 'terminal:data', id, chunk))
    pty.onExit(({ exitCode }) => {
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
