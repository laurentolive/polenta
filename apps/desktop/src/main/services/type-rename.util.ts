import * as fsP from 'fs/promises'
import * as path from 'path'

/**
 * GH100 — dossiers de données Polenta où un ID d'objet peut apparaître (contenu ou chemin). Liste
 * blanche : jamais `diagrams/`, `images/`, `dashboards/`, `queries/` ni code (scripts Suivi : côté
 * projet, GH79 — non réécrits).
 */
export const ID_DATA_DIRS = [
  'requirements', 'tests', 'campaigns', 'changes', 'test-runs', 'links', 'reviews',
  'impact-analyses', 'impact-acks', '.polenta/trees',
]

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Réécrit en une passe chaque ID entier `<oldPrefix>-<n>` présent dans `renames` — mêmes frontières
 * que `renumberText` (`@polenta/merge-core`, GH37) : `SYS-0043` mais ni `SYS-00431`, ni `XSYS-0043`,
 * ni `MC-SYS-0043` ; `SYS-0043-2` (entryId) et `SYS-0043-run-0001` (runId) le contiennent. Une seule
 * passe : un ID déjà réécrit n'est jamais repris par une autre paire.
 */
export function idRenamer(oldPrefix: string, renames: ReadonlyMap<string, string>): (text: string) => string {
  const re = new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(oldPrefix)}-\\d+(?![0-9A-Za-z_])`, 'g')
  return text => text.replace(re, id => renames.get(id) ?? id)
}

/** Chemin relatif (`/`) réécrit segment par segment : `test-runs/OLD-0001/OLD-0001-run-0002.yaml`. */
export function renamePath(rel: string, rename: (text: string) => string): string {
  return rel.split('/').map(rename).join('/')
}

/** Contenu binaire (octet nul) : jamais réécrit. */
export function isBinary(bytes: Buffer): boolean {
  return bytes.includes(0)
}

/** Fichiers des dossiers de données d'un repo, chemins relatifs en `/`. Dossier absent : ignoré. */
export async function listDataFiles(repoPath: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (rel: string): Promise<void> => {
    let entries: import('fs').Dirent[]
    try {
      entries = await fsP.readdir(path.join(repoPath, rel), { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const child = `${rel}/${e.name}`
      if (e.isDirectory()) await walk(child)
      else if (e.isFile()) out.push(child)
    }
  }
  for (const dir of ID_DATA_DIRS) await walk(dir)
  return out.sort()
}

/** Supprime les dossiers devenus vides entre `rel` (exclu) et la racine du dossier de données. */
export async function pruneEmptyDirs(repoPath: string, rel: string): Promise<void> {
  let dir = path.posix.dirname(rel)
  while (dir.includes('/') && !ID_DATA_DIRS.includes(dir)) {
    try {
      await fsP.rmdir(path.join(repoPath, dir))
    } catch {
      return
    }
    dir = path.posix.dirname(dir)
  }
}
