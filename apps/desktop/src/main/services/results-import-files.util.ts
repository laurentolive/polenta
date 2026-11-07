import * as fs from 'fs'
import * as path from 'path'
import { glob, isDynamicPattern } from 'tinyglobby'
import { ResultsImportError } from './results-import.service'

/**
 * GH129 — chemins et motifs de rapports JUnit → fichiers (spec §1.1), développés par Polenta pour que
 * la commande se comporte de même sous bash, PowerShell et cmd. Un motif sans fichier, ou un chemin
 * absent, est une erreur globale : un rapport manquant ne doit pas passer pour « rien à importer ».
 */
export async function expandResultFiles(patterns: string[], cwd: string): Promise<string[]> {
  if (patterns.length === 0) throw new ResultsImportError('no_files', 'no JUnit file given')
  const out: string[] = []
  for (const raw of patterns) {
    // Séparateurs Windows : tinyglobby attend des « / ».
    const pattern = raw.replace(/\\/g, '/')
    // Un fichier qui existe sous ce nom est pris tel quel, même avec des [ ] ( ) dans son chemin.
    if (!isDynamicPattern(pattern) || fs.existsSync(path.resolve(cwd, raw))) {
      const file = path.resolve(cwd, raw)
      if (!fs.existsSync(file)) throw new ResultsImportError('no_files', `${raw}: file not found`)
      out.push(file)
      continue
    }
    const found = await glob(pattern, { cwd, absolute: true, onlyFiles: true, expandDirectories: false })
    if (found.length === 0) throw new ResultsImportError('no_files', `${raw}: no file matches`)
    out.push(...found.sort().map(f => path.resolve(f)))
  }
  return [...new Set(out)]
}
