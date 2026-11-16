import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { createHash, randomUUID } from 'crypto'
import { TREE_LOCK_TTL_MS } from '@polenta/types'

export { TREE_LOCK_TTL_MS }

/**
 * GH361 — verrou du rangement d'un type (`.polenta/trees/<nœud>/<type>.yaml`), partagé entre
 * l'application (verrou LONG, tant qu'elle affiche l'arbre en édition) et le serveur MCP (verrou
 * COURT, le temps d'une écriture). Un processus = un fichier ; rien n'est versionné : les fichiers
 * vivent dans le dossier git du clone (`<gitdir>/polenta/locks/`). specs/GH361-design.md §2.
 *
 * Ordre qui exclut toute perte d'écriture (§2.5) : le MCP prend le verrou court PUIS lit le verrou
 * long ; l'app écrit le verrou long PUIS attend la fin du verrou court, puis relit l'arbre.
 */

/** Attente max d'un écrivain MCP sur le verrou court d'un autre (au-delà : `TREE_LOCKED`). */
export const TREE_WRITE_WAIT_MS = 5_000
const POLL_MS = 25

export interface TreeLockInfo { by: 'app'; since: string }

export class TreeLockedError extends Error {
  readonly code = 'TREE_LOCKED'
  constructor(message: string, readonly info?: TreeLockInfo) {
    super(message)
  }
}

interface AppLockFile { pid: number; since: string; expiresAt: string }
interface WriteLockFile { pid: number; since: string; token?: string }

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/** Processus vivant sur cette machine (`EPERM` : il existe, on n'a juste pas le droit de le signaler). */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  if (pid === process.pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Dossier des verrous d'un repo : sous son dossier git ; repli dans le dossier temporaire sans `.git`. */
export async function lockDir(repoPath: string): Promise<string> {
  const dotGit = path.join(repoPath, '.git')
  const stat = await fsP.stat(dotGit).catch(() => null)
  if (stat?.isDirectory()) return path.join(dotGit, 'polenta', 'locks')
  if (stat?.isFile()) {
    const target = (await fsP.readFile(dotGit, 'utf-8')).replace(/^gitdir:\s*/, '').trim()
    return path.join(path.resolve(repoPath, target), 'polenta', 'locks')
  }
  const key = createHash('sha1').update(path.resolve(repoPath).toLowerCase()).digest('hex')
  return path.join(os.tmpdir(), 'polenta-locks', key)
}

/**
 * Nom de fichier sûr (Windows compris), injectif : `encodeURIComponent`, puis `_` → `__` et
 * `%XX` → `_XX` (lu de gauche à droite, `__` et `_XX` ne se confondent pas).
 */
const enc = (s: string) => encodeURIComponent(s).replace(/_/g, '__').replace(/%/g, '_')
const treeKey = (nodeId: string, typeId: string) => `tree.${enc(nodeId)}.${enc(typeId)}`

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fsP.readFile(file, 'utf-8')) as T
  } catch {
    return null
  }
}

// ── Verrou long (application) ──────────────────────────────────────────────────

const appLockPrefix = (nodeId: string, typeId: string) => `${treeKey(nodeId, typeId)}.app-`

/** Verrou long actif le plus ancien de cet arbre (tous processus confondus), ou null. */
export async function readAppLock(repoPath: string, nodeId: string, typeId: string): Promise<TreeLockInfo | null> {
  const dir = await lockDir(repoPath)
  const prefix = appLockPrefix(nodeId, typeId)
  const names = await fsP.readdir(dir).catch(() => [] as string[])
  const now = Date.now()
  let oldest: string | null = null
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith('.json')) continue
    const lock = await readJson<AppLockFile>(path.join(dir, name))
    if (!lock || Date.parse(lock.expiresAt) <= now || !isProcessAlive(lock.pid)) continue
    if (!oldest || lock.since < oldest) oldest = lock.since
  }
  return oldest ? { by: 'app', since: oldest } : null
}

/** Fichier du verrou long d'un détenteur : processus + instance (le serveur web en a une par utilisateur). */
const appLockName = (nodeId: string, typeId: string, owner: string) => `${appLockPrefix(nodeId, typeId)}${process.pid}-${enc(owner)}.json`

/** Écrit (ou prolonge) le verrou long du détenteur `owner` de CE processus sur cet arbre. */
export async function writeAppLock(
  repoPath: string, nodeId: string, typeId: string, since: string, expiresAt: string, owner = 'default',
): Promise<void> {
  const dir = await lockDir(repoPath)
  await fsP.mkdir(dir, { recursive: true })
  const lock: AppLockFile = { pid: process.pid, since, expiresAt }
  await fsP.writeFile(path.join(dir, appLockName(nodeId, typeId, owner)), JSON.stringify(lock), 'utf-8')
}

/** Retire le verrou long du détenteur `owner` de CE processus sur cet arbre. */
export async function removeAppLock(repoPath: string, nodeId: string, typeId: string, owner = 'default'): Promise<void> {
  const dir = await lockDir(repoPath)
  await fsP.rm(path.join(dir, appLockName(nodeId, typeId, owner)), { force: true })
}

// ── Verrou court (écriture) ────────────────────────────────────────────────────

async function writeLockFile(repoPath: string, nodeId: string, typeId: string): Promise<string> {
  return path.join(await lockDir(repoPath), `${treeKey(nodeId, typeId)}.write`)
}

/**
 * Retire un verrou court périmé sans risquer d'emporter celui, tout neuf, d'un autre processus :
 * renommage atomique vers un nom unique, puis vérification que c'est bien le fichier lu ; sinon il
 * est remis en place (`link` échoue si un autre verrou a été pris entre-temps).
 */
async function removeStale(file: string, seen: WriteLockFile | null): Promise<void> {
  const aside = `${file}.${randomUUID()}.stale`
  try {
    await fsP.rename(file, aside)
  } catch {
    return // déjà retiré (ou repris) par un autre processus
  }
  const moved = await readJson<WriteLockFile>(aside)
  if ((moved?.token ?? null) !== (seen?.token ?? null)) await fsP.link(aside, file).catch(() => {})
  await fsP.rm(aside, { force: true })
}

/** Verrou court actif ? Un verrou périmé (processus mort, plus de 30 s) est retiré au passage. */
async function activeWriteLock(file: string): Promise<boolean> {
  const lock = await readJson<WriteLockFile>(file)
  if (!lock) {
    // Absent = libre. Illisible : en cours d'écriture par son créateur (actif), ou reste d'un
    // processus tué entre création et écriture (périmé au-delà du délai).
    const stat = await fsP.stat(file).catch(() => null)
    if (!stat) return false
    if (Date.now() - stat.mtimeMs <= TREE_LOCK_TTL_MS) return true
    await removeStale(file, null)
    return false
  }
  const stale = !isProcessAlive(lock.pid) || Date.now() - Date.parse(lock.since) > TREE_LOCK_TTL_MS
  if (!stale) return true
  await removeStale(file, lock)
  return false
}

/**
 * Attend qu'aucun verrou court actif ne tienne cet arbre : jusqu'à sa libération, ou sa péremption
 * (`TREE_LOCK_TTL_MS`), pour que la relecture qui suit voie l'écriture terminée.
 */
export async function waitForWriteLock(repoPath: string, nodeId: string, typeId: string): Promise<void> {
  const file = await writeLockFile(repoPath, nodeId, typeId)
  const deadline = Date.now() + TREE_LOCK_TTL_MS + 5_000
  while (await activeWriteLock(file) && Date.now() < deadline) await sleep(POLL_MS)
}

/** Prend le verrou court ; renvoie son jeton (seul son détenteur le libère). */
async function acquireWriteLock(file: string): Promise<string> {
  await fsP.mkdir(path.dirname(file), { recursive: true })
  const deadline = Date.now() + TREE_WRITE_WAIT_MS
  for (;;) {
    const token = randomUUID()
    try {
      const lock: WriteLockFile = { pid: process.pid, since: new Date().toISOString(), token }
      await fsP.writeFile(file, JSON.stringify(lock), { encoding: 'utf-8', flag: 'wx' })
      return token
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
    if (!(await activeWriteLock(file))) continue
    if (Date.now() >= deadline) {
      throw new TreeLockedError('Rangement en cours de modification par une autre écriture : réessayer dans un instant.')
    }
    await sleep(POLL_MS)
  }
}

/** Libère le verrou court s'il porte encore notre jeton (repris comme périmé : il n'est plus à nous). */
async function releaseWriteLock(file: string, token: string): Promise<void> {
  const lock = await readJson<WriteLockFile>(file)
  if (lock?.token === token) await fsP.rm(file, { force: true })
}

/**
 * Exécute `fn` sous le verrou court de cet arbre, après avoir vérifié qu'aucune application ne
 * l'affiche en édition (sinon `TreeLockedError`, sans exécuter `fn`). Libère toujours.
 */
export async function withTreeWriteLock<T>(repoPath: string, nodeId: string, typeId: string, fn: () => Promise<T>): Promise<T> {
  const file = await writeLockFile(repoPath, nodeId, typeId)
  const token = await acquireWriteLock(file)
  try {
    const app = await readAppLock(repoPath, nodeId, typeId)
    if (app) {
      throw new TreeLockedError(
        `Ce rangement est affiché dans l'application Polenta (depuis ${app.since}) : demander à l'utilisateur ` +
        "d'afficher un autre type ou un autre onglet, puis réessayer.",
        app,
      )
    }
    return await fn()
  } finally {
    await releaseWriteLock(file, token)
  }
}
