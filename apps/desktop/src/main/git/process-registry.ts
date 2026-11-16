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

/** Arrête un processus et ses descendants. */
export function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return
  if (process.platform === 'win32') {
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {
      // Repli : taskkill indisponible ou processus déjà parti.
      if (child.exitCode === null) child.kill()
    })
  } else {
    child.kill('SIGTERM')
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
  for (const repo of [...repoClosers.keys()]) void closeRepo(repo)
  const all = [...children]
  for (const e of all) killTree(e.child)
  await Promise.all(all.map(e => exited(e.child)))
}

export function repoKey(repo: string): string {
  const p = path.resolve(repo)
  return process.platform === 'win32' ? p.toLowerCase() : p
}

/** Nombre de processus git vivants (tests). */
export function liveProcessCount(): number {
  return [...children].filter(e => e.child.exitCode === null && e.child.signalCode === null).length
}
