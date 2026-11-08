import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as path from 'path'
import git from 'isomorphic-git'

import { racySafeStatusMatrix } from './racy-status.util'

/**
 * GH296 — isomorphic-git ne lit que `.git/config`, alors que `core.autocrlf=true` est le plus souvent
 * dans la config système de Git (défaut de Git for Windows). Après un checkout natif, un fichier suivi
 * en LF est en CRLF sur le disque : sans ce module, il passe pour modifié, et le stager écrit du CRLF
 * dans git.
 */

const hasNul = (content: Buffer) => content.subarray(0, 8000).includes(0)
const hasCrlf = (content: Buffer) => content.includes('\r\n')
const toLf = (content: Buffer) => Buffer.from(content.toString('latin1').replace(/\r\n/g, '\n'), 'latin1')

/** Seul un texte peut différer « par les fins de ligne » : même règle que git, un NUL = binaire. */
function differsOnlyByEol(a: Buffer, b: Buffer): boolean {
  if (a.equals(b) || hasNul(a) || hasNul(b)) return false
  if (!hasCrlf(a) && !hasCrlf(b)) return false
  return toLf(a).equals(toLf(b))
}

async function readHeadBlob(repoPath: string, filepath: string, cache: object): Promise<Buffer | null> {
  try {
    const oid = await git.resolveRef({ fs, dir: repoPath, ref: 'HEAD' })
    const { blob } = await git.readBlob({ fs, dir: repoPath, oid, filepath, cache })
    return Buffer.from(blob)
  } catch {
    return null
  }
}

/**
 * `git.statusMatrix` où un fichier qui ne diffère de HEAD que par ses fins de ligne, et n'est pas
 * stagé, compte comme inchangé. Tout code qui décide « ce fichier est-il modifié ? » passe par ici.
 * GH326 — repose sur `racySafeStatusMatrix` : un fichier réécrit à taille égale dans la seconde de son
 * ajout à l'index est bien vu modifié.
 */
export async function eolAwareStatusMatrix(repoPath: string, filepaths?: string[]) {
  const matrix = await racySafeStatusMatrix(repoPath, filepaths)
  const cache = {}
  return Promise.all(matrix.map(async row => {
    const [filepath, head, workdir, stage] = row
    if (head !== 1 || workdir !== 2 || stage !== 1) return row
    const headBlob = await readHeadBlob(repoPath, filepath, cache)
    const onDisk = await fsP.readFile(path.join(repoPath, filepath)).catch(() => null)
    if (!headBlob || !onDisk || !differsOnlyByEol(headBlob, onDisk)) return row
    return [filepath, 1, 1, 1] as typeof row
  }))
}

/**
 * `git.add` qui garde le style de fins de ligne d'un fichier suivi : si HEAD est en LF et le disque en
 * CRLF, le fichier repasse en LF avant d'être stagé (git, qui sort ce fichier en CRLF au besoin, ne voit
 * pas de différence) — sinon le commit afficherait le fichier entier comme modifié.
 */
export async function addKeepingEol(repoPath: string, filepath: string): Promise<void> {
  const absPath = path.join(repoPath, filepath)
  const headBlob = await readHeadBlob(repoPath, filepath, {})
  if (headBlob && !hasCrlf(headBlob)) {
    const onDisk = await fsP.readFile(absPath)
    if (hasCrlf(onDisk) && !hasNul(onDisk)) await fsP.writeFile(absPath, toLf(onDisk))
  }
  await git.add({ fs, dir: repoPath, filepath })
}
