import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ObjectTypeDefinition, ProjectSchema, ResultsImportReport } from '@polenta/types'
import { createMcpContainer } from '../mcp-server/container'
import { registerResultsImportTools } from '../mcp-server/tools/results-import.tools'
import { GitService } from '../main/services/git.service'
import { formatReport, parseImportResultsArgs, runImportResults } from './import-results'

// GH129 — commande `import-results` et outil MCP `import_test_results` (specs/GH129-tests.md, 20–23).

const TEST_TYPE = {
  name: 'test-auto', label: 'Test auto', prefix: 'TA', category: 'test',
  fields: [{ name: 'automationId', label: 'Automation ID', type: 'text' }], statuses: [{ name: 'draft' }],
} as ObjectTypeDefinition
const SCHEMA = { version: 1, nodes: [{ name: 'root', label: 'Produit', objectTypes: [TEST_TYPE] }], linkTypes: [] } as unknown as ProjectSchema

let base: string
let repo: string
const git = new GitService()
const cli = (argv: string[]) => runImportResults(argv, base, (r, ws) => createMcpContainer(r, ws).resultsImport)
const xml = (cases: string) => `<testsuite name="s" timestamp="2026-11-07T10:00:00Z">${cases}</testsuite>`

beforeEach(async () => {
  base = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh129-cli-'))
  repo = path.join(base, 'polenta')
  await git.writeYaml(repo, '.polenta/schema.yaml', SCHEMA)
  await git.writeYaml(repo, 'tests/TA-0001.yaml', {
    id: 'TA-0001', objectTypeRef: 'root::test-auto', title: 'T', status: 'draft', version: 1,
    fields: { automationId: 'test_a' }, steps: [], jiraLinks: [],
  })
  await fsP.mkdir(path.join(base, 'out', 'junit'), { recursive: true })
  await fsP.writeFile(path.join(base, 'out', 'junit', 'sim32.xml'), xml('<testcase classname="k" name="test_a"/>'))
  await fsP.writeFile(path.join(base, 'out', 'junit', 'sim64.xml'), xml('<testcase classname="k" name="test_b"/>'))
})
afterEach(() => fsP.rm(base, { recursive: true, force: true }))

const runFiles = () => fsP.readdir(path.join(repo, 'test-runs', 'TA-0001')).catch(() => [] as string[])

describe('arguments (20)', () => {
  it('options, --opt=valeur, plusieurs --junit', () => {
    expect(parseImportResultsArgs(['--repo', 'p', '--junit', 'a.xml', '--junit=b/*.xml', '--campaign', 'CAMP-0001', '--dry-run', '--json']))
      .toEqual({ repo: 'p', junit: ['a.xml', 'b/*.xml'], campaign: 'CAMP-0001', dryRun: true, json: true })
  })

  it('--repo manquant, --junit manquant, option inconnue, valeur manquante → code 2, message stderr', async () => {
    for (const argv of [['--junit', 'x'], ['--repo', 'polenta'], ['--repo', 'polenta', '--junit', 'x', '--force'], ['--repo']]) {
      const out = await cli(argv)
      expect(out.code).toBe(2)
      expect(out.stdout).toBe('')
      expect(out.stderr).toMatch(/Usage: polenta import-results/)
    }
  })

  it('dossier non Polenta → code 2', async () => {
    const out = await cli(['--repo', 'out', '--junit', 'out/junit/sim32.xml'])
    expect(out).toMatchObject({ code: 2, stderr: expect.stringMatching(/not a Polenta project/) })
  })
})

describe('fichiers (21)', () => {
  it('motif sans fichier, chemin absent → code 2, rien écrit', async () => {
    expect((await cli(['--repo', 'polenta', '--junit', 'out/junit/none*.xml'])).stderr).toMatch(/no_files: .*no file matches/)
    expect((await cli(['--repo', 'polenta', '--junit', 'out/absent.xml'])).code).toBe(2)
    expect(await runFiles()).toHaveLength(0)
  })

  it('fichier existant dont le nom contient des métacaractères : pris tel quel', async () => {
    await fsP.copyFile(path.join(base, 'out', 'junit', 'sim32.xml'), path.join(base, 'out', 'run[1].xml'))
    const out = await cli(['--repo', 'polenta', '--junit', 'out/run[1].xml', '--json'])
    expect(out.code).toBe(0)
    expect((JSON.parse(out.stdout) as ResultsImportReport).files).toEqual(['out/run[1].xml'])
  })

  it('motif et séparateurs Windows développés par Polenta', async () => {
    const out = await cli(['--repo', 'polenta', '--junit', 'out\\junit\\*.xml', '--junit', 'out/junit/sim32.xml', '--json'])
    const report = JSON.parse(out.stdout) as ResultsImportReport
    expect(report.files).toEqual(['out/junit/sim32.xml', 'out/junit/sim64.xml'])
  })
})

describe('sortie et codes (22)', () => {
  it('texte : compteurs et une ligne par non importé, code 1 ; puis réimport code 0', async () => {
    const out = await cli(['--repo', 'polenta', '--junit', 'out/junit/*.xml', '--executed-by', 'ci'])
    expect(out.code).toBe(1)
    expect(out.stdout).toContain('results read: 2, runs imported: 1')
    expect(out.stdout).toContain('imported TA-0001 PASS -> TA-0001-run-0001')
    expect(out.stdout).toContain('not imported: out/junit/sim64.xml k.test_b: unmapped')
    expect(await runFiles()).toHaveLength(1)
    const again = await cli(['--repo', 'polenta', '--junit', 'out/junit/sim32.xml'])
    expect(again.code).toBe(0)
    expect(again.stdout).toContain('already imported: 1')
  })

  it('--json : le rapport ; --dry-run : rien écrit, même code', async () => {
    const out = await cli(['--repo', 'polenta', '--junit', 'out/junit/*.xml', '--dry-run', '--json'])
    expect(out.code).toBe(1)
    const report = JSON.parse(out.stdout) as ResultsImportReport
    expect(report).toMatchObject({ dryRun: true, exitCode: 1, counts: { imported: 1, unmapped: 1 } })
    expect(formatReport(report)).toMatch(/^\[dry run\] JUnit import/)
    expect(await runFiles()).toHaveLength(0)
  })

  it('erreur globale (campagne inconnue) → code 2', async () => {
    const out = await cli(['--repo', 'polenta', '--junit', 'out/junit/sim32.xml', '--campaign', 'CAMP-0404'])
    expect(out).toMatchObject({ code: 2, stderr: expect.stringMatching(/campaign_not_found/) })
  })
})

describe('outil MCP import_test_results (23)', () => {
  type Handler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>
  const tool = (user?: string): Handler => {
    const tools: Record<string, Handler> = {}
    registerResultsImportTools({ registerTool: (n: string, _d: unknown, h: Handler) => { tools[n] = h } } as never, createMcpContainer(repo, undefined, user))
    return tools.import_test_results
  }

  it('dry run par défaut, même rapport que la CLI ; dryRun: false écrit ; --user du serveur en testeur', async () => {
    const files = [path.join(base, 'out', 'junit', '*.xml')]
    const dry = JSON.parse((await tool()({ files })).content[0].text) as ResultsImportReport
    expect(dry).toMatchObject({ dryRun: true, counts: { imported: 1, unmapped: 1 } })
    expect(await runFiles()).toHaveLength(0)
    const cliReport = JSON.parse((await cli(['--repo', 'polenta', '--junit', 'out/junit/*.xml', '--dry-run', '--json'])).stdout) as ResultsImportReport
    expect(dry.counts).toEqual(cliReport.counts)

    const real = JSON.parse((await tool('robot')({ files, dryRun: false })).content[0].text) as ResultsImportReport
    expect(real.imported[0].runId).toBe('TA-0001-run-0001')
    const run = await git.readYaml<{ executedBy: string }>(repo, 'test-runs/TA-0001/TA-0001-run-0001.yaml')
    expect(run?.executedBy).toBe('robot')
  })

  it('chemin relatif au repo ; erreur globale → isError', async () => {
    await fsP.copyFile(path.join(base, 'out', 'junit', 'sim32.xml'), path.join(repo, 'r.xml'))
    const ok = JSON.parse((await tool()({ files: ['r.xml'] })).content[0].text) as ResultsImportReport
    expect(ok.files).toEqual(['r.xml'])
    const err = await tool()({ files: ['absent.xml'] })
    expect(err.isError).toBe(true)
    expect(err.content[0].text).toMatch(/no_files/)
  })
})
