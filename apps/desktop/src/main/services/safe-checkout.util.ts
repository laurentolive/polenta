import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as path from 'path'
import git from 'isomorphic-git'

import { eolAwareStatusMatrix, readHeadBlob } from './eol-status.util'

/**
 * GH336 (spec §3.3, §5) — le seul checkout de Polenta. Règle : si le panneau Version n'affiche
 * aucune modification locale, le checkout aboutit ; sinon il est refusé en nommant chaque fichier.
 *
 * isomorphic-git lève `CheckoutConflictError` *avant* toute écriture dans trois cas où git (et le
 * panneau Version) ne voient pourtant rien de modifié, ou rien de visible :
 * - fichier qui ne diffère de HEAD que par ses fins de ligne (`core.autocrlf=true` système, GH335) →
 *   réécrit tel que dans HEAD (même contenu), puis checkout ;
 * - `*.pref` ignoré ici mais versionné sur la cible (commité par erreur, Q1) → copie locale mise de
 *   côté, checkout, copie restaurée : ce sont les préférences de l'utilisateur ;
 * - tout autre cas → `LocalChangesError`, un fichier par ligne avec sa raison.
 *
 * Atomicité (§5.3) : une erreur après le début de l'écriture (index déjà écrit, HEAD pas déplacé,
 * vu avec « Too many pending tasks », GH335) ramène le working directory sur la position de départ —
 * sans risque, le contrôle préalable ayant établi qu'il n'y a aucune modification locale.
 */

type CheckoutArgs = Omit<Parameters<typeof git.checkout>[0], 'fs'> & { dir: string }

export class LocalChangesError extends Error {
  constructor(readonly target: string, readonly files: { path: string; reason: string }[]) {
    super(
      `Impossible de passer sur ${target} : des fichiers locaux seraient écrasés.\n`
      + files.map(f => `- ${f.path} : ${f.reason}`).join('\n'),
    )
    this.name = 'LocalChangesError'
  }
}

const isPref = (filepath: string) => /(^|\/)[^/]*\.pref$/.test(filepath)

export async function safeCheckout(args: CheckoutArgs): Promise<void> {
  if (args.noCheckout) {
    await git.checkout({ fs, ...args })
    return
  }
  const dir = args.dir
  const start = await startPosition(dir)
  const setAside = new Map<string, Buffer>()
  try {
    try {
      await git.checkout({ fs, ...args })
      return
    } catch (err: unknown) {
      if (!(err instanceof git.Errors.CheckoutConflictError)) throw err
      await clearConflicts(dir, String(args.ref ?? 'HEAD'), err.data.filepaths, setAside)
    }
    await git.checkout({ fs, ...args })
  } catch (err: unknown) {
    if (!(err instanceof LocalChangesError) && !(err instanceof git.Errors.CheckoutConflictError)) {
      await rollbackIfPartial(dir, start)
    }
    throw err
  } finally {
    for (const [filepath, content] of setAside) {
      await fsP.writeFile(path.join(dir, filepath), content).catch(() => {})
    }
  }
}

/** Lève `LocalChangesError` si un fichier en cause est une vraie modification ; sinon le neutralise. */
async function clearConflicts(dir: string, target: string, conflicts: string[], setAside: Map<string, Buffer>) {
  const rows = new Map((await eolAwareStatusMatrix(dir, conflicts)).map(r => [r[0], r]))
  const eolOnly: string[] = []
  const blocking: { path: string; reason: string }[] = []
  for (const filepath of conflicts) {
    const row = rows.get(filepath)
    if (row && row[1] === 1 && row[2] === 1 && row[3] === 1) {
      eolOnly.push(filepath)
    } else if (!row && await git.isIgnored({ fs, dir, filepath })) {
      if (isPref(filepath)) setAside.set(filepath, await fsP.readFile(path.join(dir, filepath)))
      else blocking.push({ path: filepath, reason: `ignoré ici, versionné sur ${target}` })
    } else if (row && row[1] === 0 && row[3] === 0) {
      blocking.push({ path: filepath, reason: `non suivi, existe sur ${target}` })
    } else {
      blocking.push({ path: filepath, reason: 'modifié' })
    }
  }
  if (blocking.length > 0) {
    setAside.clear()
    throw new LocalChangesError(target, blocking)
  }
  const headOid = await git.resolveRef({ fs, dir, ref: 'HEAD' })
  const cache = {}
  for (const filepath of eolOnly) {
    const headBlob = await readHeadBlob(dir, filepath, cache, headOid)
    if (headBlob) await fsP.writeFile(path.join(dir, filepath), headBlob)
  }
  for (const filepath of setAside.keys()) await fsP.rm(path.join(dir, filepath), { force: true })
}

async function startPosition(dir: string): Promise<{ ref: string; oid: string } | null> {
  try {
    const oid = await git.resolveRef({ fs, dir, ref: 'HEAD' })
    const branch = await git.currentBranch({ fs, dir })
    return { ref: branch ?? oid, oid }
  } catch {
    return null
  }
}

/** HEAD n'a pas bougé mais l'index ne correspond plus à HEAD : checkout interrompu en cours d'écriture. */
async function rollbackIfPartial(dir: string, start: { ref: string; oid: string } | null) {
  if (!start) return
  try {
    const oid = await git.resolveRef({ fs, dir, ref: 'HEAD' })
    if (oid !== start.oid) return
    const rows = await eolAwareStatusMatrix(dir)
    if (!rows.some(([, head, , stage]) => stage !== head)) return
    await git.checkout({ fs, dir, ref: start.ref, force: true })
  } catch {
    // Meilleur effort : l'erreur d'origine est relancée par l'appelant.
  }
}
