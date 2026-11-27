/**
 * GH46 — fonctions pures de `fetch-drawio-editor.ts` (testées par `drawio-editor-lib.test.ts`).
 * Aucun accès disque ici.
 */
import { createHash } from 'crypto'

/** SHA-256 hexadécimal (minuscules) d'un contenu. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Lit `drawio-prune.txt` : une règle par ligne, `#` en commentaire, lignes vides ignorées. */
export function parsePruneRules(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#'))
}

/**
 * Une entrée du zip (chemin POSIX relatif) est élaguée si une règle la désigne :
 * `*.ext` = suffixe, `dossier/` ou `nom-` = préfixe, autre = chemin exact.
 */
export function isPruned(entryName: string, rules: readonly string[]): boolean {
  return rules.some(rule => {
    if (rule.startsWith('*')) return entryName.endsWith(rule.slice(1))
    if (rule.endsWith('/') || rule.endsWith('-')) return entryName.startsWith(rule)
    return entryName === rule
  })
}

/** Chemin d'entrée du zip refusé s'il sort de la destination (absolu, `..`, lecteur Windows). */
export function isSafeEntryName(entryName: string): boolean {
  const name = entryName.replace(/\\/g, '/')
  if (name === '' || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return false
  return !name.split('/').includes('..')
}

/** Vrai si le SHA-256 du contenu correspond à la valeur épinglée (insensible à la casse). */
export function sha256Matches(bytes: Uint8Array, expectedHex: string): boolean {
  return sha256Hex(bytes) === expectedHex.toLowerCase()
}
