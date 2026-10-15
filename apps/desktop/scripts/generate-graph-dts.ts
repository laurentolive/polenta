/**
 * GH74 — génère `resources/dashboard-lib/polenta.d.ts` (types du graphe de données, livrés dans
 * `dashboards/lib/` des projets) à partir de la source unique `packages/types/src/graph.ts`, pour
 * que les types publiés ne divergent jamais du contrat. Les types d'historique (`history.ts`) sont
 * recopiés : le fichier livré est autonome.
 *
 * `tsx scripts/generate-graph-dts.ts` écrit le fichier ; `--check` échoue s'il n'est pas à jour
 * (aussi vérifié par `src/main/services/dashboard-lib.test.ts`, L8).
 */
import * as fs from 'fs'
import * as path from 'path'

const TYPES_DIR = path.resolve(__dirname, '../../../packages/types/src')
export const GRAPH_DTS_PATH = path.resolve(__dirname, '../resources/dashboard-lib/polenta.d.ts')

/** Déclaration exportée `export type|interface <name>` (avec son commentaire JSDoc éventuel). */
function extractDeclaration(source: string, name: string): string {
  const m = new RegExp(`^export (type|interface) ${name}\\b.*$`, 'm').exec(source)
  if (!m) throw new Error(`Déclaration introuvable : ${name}`)
  // Commentaire JSDoc immédiatement au-dessus.
  const before = source.slice(0, m.index)
  const doc = /\/\*\*(?:(?!\*\/)[\s\S])*\*\/\n$/.exec(before)?.[0] ?? ''
  const rest = source.slice(m.index)
  // Déclaration multiligne (`{` en fin de ligne) : jusqu'à l'accolade fermante en début de ligne.
  const end = m[0].trimEnd().endsWith('{') ? rest.indexOf('\n}\n') + 3 : rest.indexOf('\n') + 1
  return doc + rest.slice(0, end)
}

export function renderGraphDts(): string {
  const graph = fs.readFileSync(path.join(TYPES_DIR, 'graph.ts'), 'utf8').replace(/\r\n/g, '\n')
  const history = fs.readFileSync(path.join(TYPES_DIR, 'history.ts'), 'utf8').replace(/\r\n/g, '\n')
  const historyDecls = ['HistorySource', 'HistoryEntry', 'ObjectHistory'].map((n) => extractDeclaration(history, n)).join('\n')
  const body = graph
    .replace(/^import type [^\n]*\n/gm, '')
    .replace(/^export const GRAPH_CONTRACT_VERSION = (\d+)$/m, 'export declare const GRAPH_CONTRACT_VERSION: $1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return [
    '// Généré par Polenta — ne pas modifier : remplacé par les mises à jour de la bibliothèque.',
    '// Types du graphe de données (contrat v1) pour la vérification des scripts (`checkJs`).',
    '',
    body,
    '',
    '// ─── Historique ──────────────────────────────────────────────────────────────',
    '',
    historyDecls.trim(),
    '',
    '// ─── Alias courts ────────────────────────────────────────────────────────────',
    '',
    'export type Row = GraphRow',
    'export type EntryStatus = GraphEntryStatus',
    'export type RunResult = GraphRunResult',
    '',
  ].join('\n')
}

if (require.main === module) {
  const expected = renderGraphDts()
  const current = fs.existsSync(GRAPH_DTS_PATH) ? fs.readFileSync(GRAPH_DTS_PATH, 'utf8').replace(/\r\n/g, '\n') : ''
  if (process.argv.includes('--check')) {
    if (current !== expected) {
      console.error(`${GRAPH_DTS_PATH} n'est pas à jour : lancer \`tsx scripts/generate-graph-dts.ts\`.`)
      process.exit(1)
    }
  } else {
    fs.writeFileSync(GRAPH_DTS_PATH, expected)
    console.log(`Écrit : ${GRAPH_DTS_PATH}`)
  }
}
