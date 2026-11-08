import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as path from 'path'
import git, { STAGE, TREE, WORKDIR } from 'isomorphic-git'

/**
 * GH326 — « racy git » : `git.statusMatrix` d'isomorphic-git (`compareStats`) compare les dates d'un
 * fichier à celles de son entrée d'index **à la seconde** et, si elles concordent (et la taille aussi),
 * reprend l'oid de l'index sans relire le fichier. Un fichier réécrit à taille égale dans la même
 * seconde que son ajout à l'index passe donc pour inchangé : il n'est ni affiché, ni stagé, ni publié.
 * Git natif traite ce cas (`Documentation/technical/racy-git.txt`) ; isomorphic-git ne le fait pas.
 *
 * Ce module rejoue le walk de `statusMatrix` et ne relit le contenu que des fichiers dont les dates ne
 * permettent pas de conclure (`needsContentCheck`) — jamais de tout le repo.
 */

export type StatusMatrix = Awaited<ReturnType<typeof git.statusMatrix>>

/** Dates et taille d'un fichier ou d'une entrée d'index, normalisées par isomorphic-git. */
export interface StatTimes {
  mtimeSeconds: number
  mtimeNanoseconds: number
  ctimeSeconds: number
  ctimeNanoseconds: number
  size: number
}

/**
 * Écart sous lequel deux dates sont tenues pour égales : `mtimeMs` (double) n'a qu'environ 250 ns de
 * précision, et un index écrit par git natif porte les nanosecondes exactes du système de fichiers.
 */
const NS_TOLERANCE = 1000

/** Les fractions de seconde diffèrent — sauf entrée sans nanosecondes (index écrit sans `USE_NSEC`). */
const subSecondDiffers = (diskNs: number, entryNs: number) =>
  entryNs !== 0 && Math.abs(diskNs - entryNs) >= NS_TOLERANCE

/**
 * Entrée « racy » au sens de git : le fichier a été daté au même instant ou après l'écriture de
 * l'index, une réécriture dans le même tic d'horloge ne changerait aucune date. Sans nanosecondes dans
 * l'entrée, la comparaison se fait à la seconde, comme git.
 */
function isRacyEntry(entry: StatTimes, indexMtimeMs: number | null): boolean {
  if (indexMtimeMs === null) return true
  if (entry.mtimeNanoseconds === 0) return entry.mtimeSeconds >= Math.floor(indexMtimeMs / 1000)
  const entryMs = entry.mtimeSeconds * 1000 + entry.mtimeNanoseconds / 1e6
  return entryMs >= indexMtimeMs - NS_TOLERANCE / 1e6
}

/**
 * Faut-il relire le fichier alors qu'isomorphic-git le croirait inchangé ? Faux quand la taille ou les
 * secondes diffèrent : isomorphic-git relit alors le fichier lui-même (et rafraîchit l'index).
 * Seule la fraction de seconde du mtime compte : sous Windows, git natif indexe en ctime la date de
 * création, Node la date de changement — leurs fractions diffèrent pour presque tout fichier indexé
 * par git, et les comparer ferait relire tout le repo à chaque statut.
 */
export function needsContentCheck(disk: StatTimes, entry: StatTimes, indexMtimeMs: number | null): boolean {
  if (disk.size !== entry.size || disk.mtimeSeconds !== entry.mtimeSeconds || disk.ctimeSeconds !== entry.ctimeSeconds) {
    return false
  }
  if (subSecondDiffers(disk.mtimeNanoseconds, entry.mtimeNanoseconds)) return true
  return isRacyEntry(entry, indexMtimeMs)
}

/** Dossier git du repo : `.git` ou, pour un submodule / worktree, la cible de son fichier `.git`. */
async function resolveGitdir(repoPath: string): Promise<string> {
  const dotgit = path.join(repoPath, '.git')
  const stat = await fsP.stat(dotgit).catch(() => null)
  if (!stat?.isFile()) return dotgit
  const target = (await fsP.readFile(dotgit, 'utf8')).trim().replace(/^gitdir:\s*/, '')
  return path.isAbsolute(target) ? target : path.join(repoPath, target)
}

/** Date d'écriture de l'index, ou null (aucun index — ou illisible : toute entrée est alors suspecte). */
async function indexMtimeMs(repoPath: string): Promise<number | null> {
  const stat = await fsP.stat(path.join(await resolveGitdir(repoPath), 'index')).catch(() => null)
  return stat ? stat.mtimeMs : null
}

/** Même filtre que `worthWalking` d'isomorphic-git (non exporté). */
function worthWalking(filepath: string, root: string): boolean {
  if (filepath === '.' || root == null || root.length === 0 || root === '.') return true
  return root.length >= filepath.length ? root.startsWith(filepath) : filepath.startsWith(root)
}

/**
 * `git.statusMatrix({ fs, dir, filepaths })` (isomorphic-git 1.38.4, `statusMatrix`) avec le contrôle
 * « racy git » ci-dessus. Même walk, mêmes colonnes ; seul change l'oid du fichier sur disque quand
 * `needsContentCheck` le demande (le contenu est alors haché, sans toucher à l'index).
 */
export async function racySafeStatusMatrix(repoPath: string, filepaths: string[] = ['.']): Promise<StatusMatrix> {
  const indexMtime = await indexMtimeMs(repoPath)
  return git.walk({
    fs,
    dir: repoPath,
    trees: [TREE({ ref: 'HEAD' }), WORKDIR(), STAGE()],
    map: async (filepath, [head, workdir, stage]) => {
      // Fichiers ignorés écartés, sauf s'ils sont déjà suivis.
      if (!head && !stage && workdir) {
        if (await git.isIgnored({ fs, dir: repoPath, filepath })) return null
      }
      if (!filepaths.some(base => worthWalking(filepath, base))) return null

      const [headType, workdirType, stageType] = await Promise.all([
        head && head.type(),
        workdir && workdir.type(),
        stage && stage.type(),
      ])
      const isBlob = [headType, workdirType, stageType].includes('blob')
      if ((headType === 'tree' || headType === 'special') && !isBlob) return
      if (headType === 'commit') return null
      if ((workdirType === 'tree' || workdirType === 'special') && !isBlob) return
      if (stageType === 'commit') return null
      if ((stageType === 'tree' || stageType === 'special') && !isBlob) return

      const headOid = headType === 'blob' ? await head!.oid() : undefined
      const stageOid = stageType === 'blob' ? await stage!.oid() : undefined
      let workdirOid: string | undefined
      if (headType !== 'blob' && workdirType === 'blob' && stageType !== 'blob') {
        workdirOid = '42' // non suivi : n'importe quel oid fait l'affaire (comme isomorphic-git)
      } else if (workdirType === 'blob') {
        const suspect = stageType === 'blob'
          && needsContentCheck(await workdir!.stat(), await stage!.stat(), indexMtime)
        workdirOid = suspect
          ? (await git.hashBlob({ object: (await workdir!.content())! })).oid
          : await workdir!.oid()
      }
      const entry = [undefined, headOid, workdirOid, stageOid]
      const result = entry.map(value => entry.indexOf(value))
      result.shift()
      return [filepath, ...result]
    },
  }) as Promise<StatusMatrix>
}
