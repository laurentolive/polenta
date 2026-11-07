#!/usr/bin/env node
/**
 * GH129 — ligne de commande Polenta (`polenta-cli.cjs <commande> …`), sans interface ni Electron :
 * Node.js seul. Une commande : `import-results` (specs/GH129.md §4). stdout ne porte que le résultat
 * de la commande : les services journalisent sur stderr (garde ci-dessous, premier import).
 */
import '../mcp-server/stdout-guard'
import { createMcpContainer } from '../mcp-server/container'
import { IMPORT_RESULTS_USAGE, runImportResults } from './import-results'

const USAGE = `Usage: polenta <command> [options]

Commands:
  import-results   import JUnit XML results as test runs (polenta import-results --help)
`

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(USAGE)
    return command ? 0 : 2
  }
  if (command !== 'import-results') {
    process.stderr.write(`unknown command: ${command}\n\n${USAGE}`)
    return 2
  }
  if (rest.includes('--help') || rest.includes('-h')) {
    process.stdout.write(`${IMPORT_RESULTS_USAGE}\n`)
    return 0
  }
  const outcome = await runImportResults(rest, process.cwd(), (repo, ws) => createMcpContainer(repo, ws).resultsImport)
  if (outcome.stdout) process.stdout.write(outcome.stdout)
  if (outcome.stderr) process.stderr.write(outcome.stderr)
  return outcome.code
}

main(process.argv.slice(2)).then(
  code => { process.exitCode = code },
  (err: unknown) => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
    process.exitCode = 2
  },
)
