import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { GraphRow, QueryColumnDef, ScriptRunResult } from '@polenta/types'
import {
  columnFieldDef, columnValuesFromRows, computedColumnKey, isComputedColumnKey, MAX_SPLIT_COLUMNS, parseComputedColumnKey,
  splitColumnValuesFromRows, validateColumnDecl,
} from '@polenta/types'
import { GitService } from './git.service'
import { SavedQueriesService } from './saved-queries.service'
import { DashboardsService } from './dashboards.service'
import { SuiviService } from './suivi.service'
import type { ScriptEngineService } from './script-engine.service'
import type { GraphService } from './graph.service'
import type { SchemaService } from './schema.service'
import { registerQueryTools } from '../../mcp-server/tools/queries.tools'
import type { McpContainer } from '../../mcp-server/container'

// GH126 — colonne calculée éclatée (`splitColumn`), sprint 1 (specs/GH126-tests.md T1–T20) :
// déclaration, clés, éclatement des lignes, stockage, MCP.

const SPLIT: QueryColumnDef = {
  label: { fr: 'Résultat par campagne', en: 'Result by campaign' },
  appliesTo: { categories: ['test'], objectTypes: [] },
  type: 'enum',
  values: ['PASS', 'FAIL', 'BLOCKED', 'INCOMPLETE', 'pending'],
  splitColumn: 'campaignId',
  splitLabelColumn: 'campaignTitle',
}
const BASE = { label: 'X', appliesTo: { categories: ['test'], objectTypes: [] }, type: 'text' }
const row = (id: string, campaignId: unknown, value: string, extra: Record<string, unknown> = {}): GraphRow =>
  ({ id, value, campaignId, campaignTitle: `Titre ${String(campaignId)}`, ...extra }) as GraphRow

// ─── Logique pure ────────────────────────────────────────────────────────────

describe('GH126 — déclaration éclatée', () => {
  it('T1 — sans splitColumn : déclaration et valeurs GH70 inchangées', () => {
    const { decl, errors } = validateColumnDecl(BASE)
    expect(errors).toEqual([])
    expect(decl).toEqual(BASE)
    expect(decl).not.toHaveProperty('splitColumn')
    expect(columnValuesFromRows([{ id: 'T1', value: 'a' }, { id: 'T1', value: 'b' }]).values.get('T1')).toEqual({ value: 'a' })
  })

  it('T2 — splitColumn / splitLabelColumn normalisés', () => {
    const { decl, errors } = validateColumnDecl({ ...SPLIT, splitColumn: ' campaignId ', splitLabelColumn: 'campaignTitle' })
    expect(errors).toEqual([])
    expect(decl).toEqual(SPLIT)
  })

  it('T3 — vide ou null : colonne simple', () => {
    expect(validateColumnDecl({ ...BASE, splitColumn: '' }).decl).toEqual(BASE)
    expect(validateColumnDecl({ ...BASE, splitColumn: null, splitLabelColumn: null }).decl).toEqual(BASE)
  })

  it('T4 / T5 — invalide : nom attendu ; libellé sans splitColumn', () => {
    expect(validateColumnDecl({ ...BASE, splitColumn: 12 }).errors).toEqual(['column.splitColumn : nom de colonne attendu'])
    expect(validateColumnDecl({ ...BASE, splitLabelColumn: 'campaignTitle' }).errors)
      .toEqual(['column.splitLabelColumn : réservé aux colonnes éclatées (splitColumn)'])
    expect(validateColumnDecl({ ...BASE, splitLabelColumn: 'campaignTitle' }).decl).toBeNull()
  })

  it('T6 / T7 — clés de sous-colonne', () => {
    expect(computedColumnKey('QUERY-0007')).toBe('query::QUERY-0007')
    expect(computedColumnKey('QUERY-0007', 'CAMP-0005')).toBe('query::QUERY-0007::CAMP-0005')
    expect(isComputedColumnKey('query::QUERY-0007::CAMP-0005')).toBe(true)
    expect(parseComputedColumnKey('query::QUERY-0007')).toEqual({ queryId: 'QUERY-0007' })
    expect(parseComputedColumnKey('query::QUERY-0007::CAMP-0005')).toEqual({ queryId: 'QUERY-0007', split: 'CAMP-0005' })
    expect(parseComputedColumnKey('query::QUERY-0007::a::b')).toEqual({ queryId: 'QUERY-0007', split: 'a::b' })
    expect(parseComputedColumnKey('link::verification')).toBeNull()
    expect(parseComputedColumnKey('query::')).toBeNull()
    expect(columnFieldDef('QUERY-0007', SPLIT, 'fr', { value: 'CAMP-0005', label: 'RP1' }))
      .toEqual({ name: 'query::QUERY-0007::CAMP-0005', label: 'RP1', type: 'enum', values: SPLIT.values })
  })
})

describe('GH126 — éclatement des lignes', () => {
  it('T8 / T11 — ordre de première apparition ; un même test dans plusieurs sous-colonnes', () => {
    const { columns, error } = splitColumnValuesFromRows([
      row('T1', 'CAMP-0001', 'PASS'), row('T2', 'CAMP-0005', 'FAIL'), row('T1', 'CAMP-0005', 'pending'), row('T3', 'CAMP-0006', 'PASS'),
    ], SPLIT)
    expect(error).toBeUndefined()
    expect(columns.map((c) => c.split)).toEqual(['CAMP-0001', 'CAMP-0005', 'CAMP-0006'])
    expect(columns[1].values.get('T1')).toEqual({ value: 'pending' })
    expect(columns[1].values.get('T2')).toEqual({ value: 'FAIL' })
    expect(columns[0].values.get('T1')).toEqual({ value: 'PASS' })
  })

  it('T9 — libellé : premier splitLabelColumn non vide, à défaut la valeur', () => {
    const rows = [
      row('T1', 'C1', 'PASS', { campaignTitle: 'RE2' }), row('T2', 'C1', 'PASS', { campaignTitle: 'autre' }), row('T1', 'C2', 'PASS', { campaignTitle: '' }),
      row('T1', 'C3', 'PASS', { campaignTitle: null }), row('T2', 'C3', 'PASS', { campaignTitle: 'RP2' }),
    ]
    expect(splitColumnValuesFromRows(rows, SPLIT).columns.map((c) => c.label)).toEqual(['RE2', 'C2', 'RP2'])
    const noLabel: QueryColumnDef = { ...SPLIT }
    delete noLabel.splitLabelColumn
    expect(splitColumnValuesFromRows(rows, noLabel).columns.map((c) => c.label)).toEqual(['C1', 'C2', 'C3'])
  })

  it('T10 — deux lignes pour le même (élément, sous-colonne) : la première', () => {
    const { columns } = splitColumnValuesFromRows([row('T1', 'C1', 'PASS'), row('T1', 'C1', 'FAIL')], SPLIT)
    expect(columns[0].values.get('T1')?.value).toBe('PASS')
  })

  it('T12 — ligne sans valeur de split : erreur, aucune sous-colonne', () => {
    for (const missing of [undefined, null, '']) {
      const out = splitColumnValuesFromRows([row('T1', 'C1', 'PASS'), row('T2', missing, 'PASS')], SPLIT)
      expect(out.error).toBe('Ligne 2 (T2) : colonne « campaignId » manquante.')
      expect(out.columns).toEqual([])
    }
    // Contrôles GH70 (id, value) conservés.
    expect(splitColumnValuesFromRows([{ campaignId: 'C1', value: 'x' }], SPLIT).error).toMatch(/Ligne 1 : colonne « id » manquante/)
    expect(splitColumnValuesFromRows([{ id: 'T1', campaignId: 'C1' }], SPLIT).error).toMatch(/Ligne 1 \(T1\) : colonne « value » manquante/)
  })

  it('T13 — valeur de split numérique : clé et libellé texte', () => {
    const noLabel: QueryColumnDef = { ...SPLIT, splitLabelColumn: undefined }
    const { columns } = splitColumnValuesFromRows([{ id: 'T1', value: 'PASS', campaignId: 3 }], noLabel)
    expect(columns).toEqual([{ split: '3', label: '3', values: new Map([['T1', { value: 'PASS' }]]) }])
  })

  it('T14 — plus de 50 valeurs : erreur', () => {
    const rows = Array.from({ length: MAX_SPLIT_COLUMNS + 1 }, (_, i) => row('T1', `C${i}`, 'PASS'))
    expect(splitColumnValuesFromRows(rows.slice(0, MAX_SPLIT_COLUMNS), SPLIT).columns).toHaveLength(MAX_SPLIT_COLUMNS)
    const out = splitColumnValuesFromRows(rows, SPLIT)
    expect(out.error).toBe('50 sous-colonnes au maximum (51 trouvées).')
    expect(out.columns).toEqual([])
  })

  it('T15 / T16 — résultat vide ; infobulle et cible par cellule', () => {
    expect(splitColumnValuesFromRows([], SPLIT)).toEqual({ columns: [] })
    const { columns } = splitColumnValuesFromRows([row('T1', 'C1', 'PASS', { tooltip: 'C1 — RE2', _ids: ['C1/T1-1'] })], SPLIT)
    expect(columns[0].values.get('T1')).toEqual({ value: 'PASS', tooltip: 'C1 — RE2', target: 'C1/T1-1' })
  })

  it('T50 — colonnes du résultat choisies : requête « Entrées de campagne » sans code', () => {
    const decl: QueryColumnDef = { ...SPLIT, idColumn: 'testCaseId', valueColumn: 'status' }
    const { columns, error } = splitColumnValuesFromRows([
      { testCaseId: 'T1', status: 'PASS', campaignId: 'C1', campaignTitle: 'RE2' },
      { testCaseId: 'T1', status: 'FAIL', campaignId: 'C2', campaignTitle: 'RP1' },
    ], decl)
    expect(error).toBeUndefined()
    expect(columns.map((c) => [c.label, c.values.get('T1')?.value])).toEqual([['RE2', 'PASS'], ['RP1', 'FAIL']])
  })
})

// ─── Stockage ────────────────────────────────────────────────────────────────

let repo: string
let git: GitService
let dashboards: DashboardsService
let queries: SavedQueriesService
const U = 'alice'
const SCRIPT = "export default () => [{ id: 'T1', value: 'PASS', campaignId: 'C1', campaignTitle: 'RE2' }]\n"
const read = (rel: string) => fs.readFileSync(path.join(repo, rel), 'utf8')

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gh126-'))
  git = new GitService()
  dashboards = new DashboardsService(git)
  queries = new SavedQueriesService(git, dashboards)
})
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }))

describe('GH126 — stockage', () => {
  it('T17 — splitColumn / splitLabelColumn écrits dans query.yaml et relus', async () => {
    const q = await queries.create(repo, U, { title: 'Q', scope: 'shared', createdBy: U, script: SCRIPT, column: SPLIT })
    expect(q.column).toEqual(SPLIT)
    expect(yaml.load(read('queries/QUERY-0001/query.yaml'))).toMatchObject({ column: { splitColumn: 'campaignId', splitLabelColumn: 'campaignTitle' } })
    const [listed] = await queries.list(repo, U)
    expect(listed.column).toEqual(SPLIT)
    expect(listed.columnError).toBeUndefined()
  })

  it('T18 — requête issue d\'un modèle : éclatement ajouté sans détachement', async () => {
    const q = await queries.create(repo, U, { title: 'Entrées', scope: 'shared', createdBy: U, template: { id: 'campaign-entries', params: {} } })
    const updated = await queries.update(repo, U, q.id, { column: { ...SPLIT, idColumn: 'testCaseId', valueColumn: 'status' } })
    expect(updated.column).toMatchObject({ splitColumn: 'campaignId', idColumn: 'testCaseId' })
    expect(updated.state.customized).toBe(false)
  })
})

describe('GH126 — tools MCP des requêtes', () => {
  type Handler = (dto: unknown) => Promise<{ isError?: boolean; content: { text: string }[] }>
  const handlers = new Map<string, { schema: Record<string, { parse(v: unknown): unknown }>; handler: Handler }>()
  const server = {
    registerTool: (name: string, config: { inputSchema: Record<string, { parse(v: unknown): unknown }> }, handler: Handler) => {
      handlers.set(name, { schema: config.inputSchema, handler })
    },
  } as unknown as McpServer
  async function call(name: string, dto: Record<string, unknown> = {}) {
    const tool = handlers.get(name)!
    const parsed = Object.fromEntries(Object.entries(tool.schema).map(([k, s]) => [k, s.parse(dto[k])]))
    const res = await tool.handler(parsed)
    return { isError: !!res.isError, text: res.content[0].text, json: (() => { try { return JSON.parse(res.content[0].text) } catch { return null } })() }
  }

  beforeEach(() => {
    vi.spyOn(git, 'currentBranch').mockResolvedValue('main')
    const engine = { run: vi.fn(async (): Promise<ScriptRunResult> => ({ ok: true, columns: [], rows: [], total: 0, truncated: false, ms: 1 })) }
    const suivi = new SuiviService(engine as unknown as ScriptEngineService, {} as GraphService, queries, dashboards, {} as SchemaService)
    const c = {
      repoPath: repo, workspaceDir: undefined, git, user: U,
      workspaceTree: { readCache: async () => null },
      reqIndex: { invalidate: () => {} },
      testsIndex: { invalidate: () => {} },
      dashboardLibrary: { invalidate: () => {} },
      savedQueries: queries,
      suivi,
    } as unknown as McpContainer
    registerQueryTools(server, c)
  })

  it('T19 — create_query avec splitColumn puis list_queries', async () => {
    const created = await call('create_query', { title: 'Q', script: SCRIPT, column: SPLIT, dryRun: false })
    expect(created.isError).toBe(false)
    expect(created.json.query.column).toEqual(SPLIT)
    const listed = await call('list_queries')
    expect(listed.json.queries[0]).toMatchObject({ id: 'QUERY-0001', column: { splitColumn: 'campaignId', splitLabelColumn: 'campaignTitle' } })
  })

  it('T20 — splitLabelColumn sans splitColumn : COLUMN_INVALID', async () => {
    const res = await call('create_query', { title: 'Q', script: SCRIPT, column: { ...SPLIT, splitColumn: null } })
    expect(res.text).toContain('[COLUMN_INVALID]')
    expect(res.text).toContain('réservé aux colonnes éclatées')
  })
})
