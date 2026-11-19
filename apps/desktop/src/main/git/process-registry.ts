import { execFile, type ChildProcess } from 'child_process'
import * as path from 'path'

/**
 * GH337 — suivi des processus git (design §3). Aucun processus ne doit survivre à la fermeture
 * d'un dépôt, d'une session web ou de l'application, y compris sous Windows où tuer `git.exe`
 * ne tue pas ses enfants (`git-remote-https`, `ssh`).
 */

interface Entry { child: ChildProcess; repo: string | null; persistent: boolean }

const children = new Set<Entry>()
const repoClosers = new Map<string, Set<() => void>>()

export function track(child: ChildProcess, repo: string | null, persistent = false): () => void {
  const entry: Entry = { child, repo, persistent }
  children.add(entry)
  const forget = (): void => { children.delete(entry) }
  child.once('exit', forget)
  child.once('error', forget)
  return forget
}

/**
 * Options de `spawn` pour un processus git : hors Windows, `detached` le place dans son propre groupe, dont
 * `killTree` signale les descendants (`git-remote-https`, `ssh`). Sous Windows, `taskkill /T` suit l'arbre.
 */
export function groupSpawnOptions(): { detached: boolean } {
  return { detached: process.platform !== 'win32' }
}

/** Arrête un processus et ses descendants. */
export function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return
  if (process.platform === 'win32') {
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {
      // Repli : taskkill indisponible ou processus déjà parti.
      if (child.exitCode === null) child.kill()
    })
  } else {
    // GH337 P8 — signal au groupe (le processus est chef de groupe, cf. groupSpawnOptions) : ses enfants
    // reçoivent le même signal. Pas de groupe (ESRCH, processus lancé autrement) : le processus seul.
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill('SIGTERM')
    }
  }
}

/** Les processus persistants (cat-file) d'un dépôt s'enregistrent ici pour être fermés avec lui. */
export function onRepoClose(repo: string, close: () => void): () => void {
  const key = repoKey(repo)
  let set = repoClosers.get(key)
  if (!set) repoClosers.set(key, (set = new Set()))
  set.add(close)
  return () => { set!.delete(close) }
}

function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise(resolve => {
    child.once('exit', () => resolve())
    child.once('error', () => resolve())
  })
}

/**
 * Ferme les processus persistants d'un dépôt et attend leur fin : sous Windows, le dossier d'un
 * dépôt ne peut pas être supprimé ni renommé tant qu'un processus l'a pour dossier courant.
 * Les opérations ponctuelles en cours se terminent normalement.
 */
export async function closeRepo(repo: string): Promise<void> {
  const key = repoKey(repo)
  const set = repoClosers.get(key)
  if (set) {
    repoClosers.delete(key)
    for (const close of set) close()
  }
  await Promise.all([...children].filter(e => e.persistent && e.repo !== null && repoKey(e.repo) === key).map(e => exited(e.child)))
}

/** Fermeture de l'application ou du serveur : tout s'arrête. */
export async function closeAll(): Promise<void> {
  await stopWhere(() => true)
}

/**
 * Fin d'une session utilisateur du serveur web : seuls les processus dont le dépôt est sous `dir`
 * (dossier de l'utilisateur) s'arrêtent. Les autres utilisateurs gardent leurs opérations en cours.
 */
export async function closeUnder(dir: string): Promise<void> {
  const root = repoKey(dir)
  await stopWhere(repo => {
    if (repo === null) return false
    const rel = path.relative(root, repoKey(repo))
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
  })
}

async function stopWhere(match: (repo: string | null) => boolean): Promise<void> {
  for (const key of [...repoClosers.keys()]) if (match(key)) void closeRepo(key)
  const picked = [...children].filter(e => match(e.repo))
  for (const e of picked) killTree(e.child)
  await Promise.all(picked.map(e => exited(e.child)))
}

export function repoKey(repo: string): string {
  const p = path.resolve(repo)
  return process.platform === 'win32' ? p.toLowerCase() : p
}

/** Nombre de processus git vivants (tests). */
export function liveProcessCount(): number {
  return [...children].filter(e => e.child.exitCode === null && e.child.signalCode === null).length
}
