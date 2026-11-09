/**
 * GH336 — contenu de référence d'un repo Polenta (spec §3.1, §4) : écrit à la création d'un projet
 * ou d'un composant, et proposé par la mise en conformité pour un repo existant.
 */

/** Lignes que tout `.gitignore` de repo Polenta contient : état local, jamais versionné. */
export const GITIGNORE_LINES = ['.polenta/tree.cache.yaml', '*.pref'] as const

/** Fins de ligne LF pour tout le repo, quel que soit `core.autocrlf` du poste (Q2). */
export const GITATTRIBUTES_LINE = '* text=auto eol=lf'

export const GITIGNORE_CONTENT = `${GITIGNORE_LINES.join('\n')}\n`
export const GITATTRIBUTES_CONTENT = `${GITATTRIBUTES_LINE}\n`

/** Fichier d'état local (préférences, cache) : ne doit jamais être suivi par git. */
export function isLocalStateFile(filepath: string): boolean {
  return filepath === '.polenta/tree.cache.yaml' || /(^|\/)[^/]*\.pref$/.test(filepath)
}
