import * as fs from 'fs'
import * as path from 'path'
import type { ResultsImportReport } from '@polenta/types'
import { ResultsImportError, type ResultsImportService } from '../main/services/results-import.service'
import { expandResultFiles } from '../main/services/results-import-files.util'

/**
 * GH129 — sous-commande `import-results` (specs/GH129.md §4). Sans E/S de console : le point d'entrée
 * (`index.ts`) écrit `stdout` / `stderr` et sort avec `code`.
 */

export const IMPORT_RESULTS_USAGE = `Usage: polenta import-results --repo <dir> --junit <file|glob> [--junit ...]
                              [--campaign CAMP-xxxx] [--tested-version <id|label|text>]
                              [--executed-by <name>] [--workspace <dir>] [--dry-run] [--json]

Imports JUnit XML results as test runs of the Polenta project in <dir>. Writes the working tree only,
never commits. Exit code: 0 all imported, 1 some results not imported, 2 error (nothing written).`

export interface ImportResultsArgs {
  repo: string
  junit: string[]
  campaign?: string
  testedVersion?: string
  executedBy?: string
  workspace?: string
  dryRun: boolean
  json: boolean
}

export interface CliOutcome { code: 0 | 1 | 2; stdout: string; stderr: string }

const VALUE_OPTIONS: Record<string, keyof ImportResultsArgs> = {
  '--repo': 'repo', '--junit': 'junit', '--campaign': 'campaign', '--tested-version': 'testedVersion',
  '--executed-by': 'executedBy', '--workspace': 'workspace',
}

/** Arguments → options, ou message d'erreur (code 2). `--opt=valeur` accepté. */
export function parseImportResultsArgs(argv: string[]): ImportResultsArgs | { error: string } {
  const out: Partial<ImportResultsArgs> & { junit: string[] } = { junit: [], dryRun: false, json: false }
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].startsWith('--') && argv[i].includes('=')
      ? [argv[i].slice(0, argv[i].indexOf('=')), argv[i].slice(argv[i].indexOf('=') + 1)]
      : [argv[i], undefined]
    if (flag === '--dry-run') { out.dryRun = true; continue }
    if (flag === '--json') { out.json = true; continue }
    const key = VALUE_OPTIONS[flag]
    if (!key) return { error: `unknown argument: ${argv[i]}` }
    const value = inline ?? argv[++i]
    if (value === undefined || value === '') return { error: `${flag} needs a value` }
    if (key === 'junit') out.junit.push(value)
    else (out as Record<string, unknown>)[key] = value
  }
  if (!out.repo) return { error: '--repo <dir> is required' }
  if (out.junit.length === 0) return { error: 'at least one --junit <file|glob> is required' }
  return out as ImportResultsArgs
}

const COUNT_LABELS: Array<[keyof ResultsImportReport['counts'], string]> = [
  ['results', 'results read'], ['imported', 'runs imported'], ['alreadyImported', 'already imported'],
  ['skipped', 'skipped'], ['unmapped', 'unmapped'], ['ambiguous', 'ambiguous'], ['rejected', 'rejected'],
]

/** Résumé texte (spec §4, Q9 : anglais). */
export function formatReport(report: ResultsImportReport): string {
  const lines = [
    `${report.dryRun ? '[dry run] ' : ''}JUnit import: ${report.files.length} file(s)`,
    COUNT_LABELS.map(([k, label]) => `${label}: ${report.counts[k]}`).join(', '),
  ]
  for (const item of report.imported) {
    lines.push(`  ${report.dryRun ? 'would import' : 'imported'} ${item.testId}${item.entryId ? ` (${item.entryId})` : ''} ${item.result}${item.runId ? ` -> ${item.runId}` : ''}`)
  }
  for (const n of report.notImported) {
    const extra = [n.candidates?.length ? n.candidates.join(', ') : '', n.field ? `field ${n.field}` : ''].filter(Boolean).join('; ')
    lines.push(`  not imported: ${n.file} ${n.testcase}: ${n.reason}${extra ? ` (${extra})` : ''}`)
  }
  for (const w of report.warnings) {
    const where = [w.file, w.testcase, w.testId].filter(Boolean).join(' ')
    lines.push(`  warning ${w.code}${where ? `: ${where}` : ''}${w.detail ? ` — ${w.detail}` : ''}`)
  }
  return `${lines.join('\n')}\n`
}

export async function runImportResults(
  argv: string[], cwd: string, makeService: (repoPath: string, workspaceDir?: string) => ResultsImportService,
): Promise<CliOutcome> {
  const args = parseImportResultsArgs(argv)
  if ('error' in args) return { code: 2, stdout: '', stderr: `${args.error}\n\n${IMPORT_RESULTS_USAGE}\n` }
  const repoPath = path.resolve(cwd, args.repo)
  if (!fs.existsSync(path.join(repoPath, '.polenta', 'schema.yaml'))) {
    return { code: 2, stdout: '', stderr: `not a Polenta project (no .polenta/schema.yaml): ${repoPath}\n` }
  }
  const workspaceDir = args.workspace ? path.resolve(cwd, args.workspace) : undefined
  if (workspaceDir && !fs.existsSync(workspaceDir)) return { code: 2, stdout: '', stderr: `workspace not found: ${workspaceDir}\n` }
  try {
    const files = await expandResultFiles(args.junit, cwd)
    const report = await makeService(repoPath, workspaceDir).importJunit({
      repoPath, workspaceDir, files, displayBase: cwd, dryRun: args.dryRun,
      ...(args.campaign && { campaignId: args.campaign }),
      ...(args.testedVersion && { testedVersion: args.testedVersion }),
      ...(args.executedBy && { executedBy: args.executedBy }),
    })
    return { code: report.exitCode, stdout: args.json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report), stderr: '' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const partial = err instanceof ResultsImportError && err.partial
      ? (args.json ? `${JSON.stringify(err.partial, null, 2)}\n` : formatReport(err.partial))
      : ''
    return { code: 2, stdout: partial, stderr: `error: ${message}\n` }
  }
}
