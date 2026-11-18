import * as fsP from 'fs/promises'
import * as path from 'path'

import { gitFor } from '../git/git-backend'

const SHA_RE = /^[0-9a-f]{40}$/i

/** SHA of `ref` (branch, tag, `HEAD`, SHA), or null when it does not resolve. */
export async function resolveCommitSha(repoPath: string, ref: string): Promise<string | null> {
  if (SHA_RE.test(ref)) return ref.toLowerCase()
  try {
    return await gitFor(repoPath).resolve(ref)
  } catch {
    return null
  }
}

/**
 * GH178 — bytes of `filepath` (relative to the repo) at `ref`, or in the working tree when `ref` is
 * null. Null when the file does not exist there. A working-tree path that escapes the repo is
 * refused (same guard as the other file handlers).
 */
export async function readFileAt(repoPath: string, ref: string | null, filepath: string): Promise<Uint8Array | null> {
  if (ref === null) {
    const abs = path.resolve(repoPath, filepath)
    const rel = path.relative(path.resolve(repoPath), abs)
    if (path.isAbsolute(rel) || rel === '..' || rel.startsWith('..' + path.sep)) return null
    try {
      return await fsP.readFile(abs)
    } catch {
      return null
    }
  }
  const oid = await resolveCommitSha(repoPath, ref)
  // Same spellings as the working tree accepts (`./images/x.png`, `a/../b`) → the tree path git expects.
  const treePath = path.posix.normalize(filepath.replace(/\\/g, '/')).replace(/^(\.\/|\/)+/, '')
  if (!oid || treePath === '.' || treePath === '..' || treePath.startsWith('../')) return null
  try {
    // `<oid>:<chemin>` : git pèle commit ou tag annoté jusqu'à l'arbre ; `null` si absent ou pas un blob.
    return await gitFor(repoPath).readBlob(`${oid}:${treePath}`)
  } catch {
    return null
  }
}
