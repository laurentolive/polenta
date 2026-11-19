import * as fs from 'fs'

/**
 * GH337 P4 — dossier privé pour la config et les hooks git de Polenta. Un dossier fixe dans `os.tmpdir()`
 * peut être pré-créé par un autre utilisateur (serveur Linux multi-utilisateurs) : un hook déposé là
 * s'exécuterait dans les commits de Polenta.
 *
 * Sous POSIX : le dossier est créé en `0700`, doit appartenir à l'utilisateur courant et ne pas être un
 * lien symbolique (`lstat`). Un dossier à un autre propriétaire est refusé ; un dossier à nous mais aux
 * droits trop ouverts (ex. créé par une version antérieure) est repris en `0700`.
 * Windows : pas de bits POSIX ; le dossier est créé dans le répertoire fourni (userData, déjà réservé à
 * l'utilisateur par le système) et vérifié comme dossier réel (pas un lien).
 */
export function ensurePrivateDir(dir: string, expectedUid: number | undefined = process.getuid?.()): string {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
  }
  const st = fs.lstatSync(dir)
  if (st.isSymbolicLink()) throw new Error(`dossier git refusé (lien symbolique) : ${dir}`)
  if (!st.isDirectory()) throw new Error(`dossier git refusé (pas un dossier) : ${dir}`)
  if (process.platform === 'win32') return dir
  if (expectedUid !== undefined && st.uid !== expectedUid) {
    throw new Error(`dossier git refusé (propriétaire différent de l'utilisateur courant) : ${dir}`)
  }
  if ((st.mode & 0o077) !== 0) fs.chmodSync(dir, 0o700) // à nous (vérifié ci-dessus) : repris en 0700
  return dir
}
