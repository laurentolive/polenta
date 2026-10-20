import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuickJSWASMModule } from 'quickjs-emscripten-core'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { GraphRow, QueryColumnDef, ScriptRunResult } from '@polenta/types'
import {
  buildHost, columnAppliesTo, columnFieldDef, columnValuesFromRows, computedColumnKey, findQueryTemplate, hashableText, isComputedColumnKey, legacyQueryCodeForHashWithColumn,
  queryCode, queryCodeForHash, validateColumnDecl,
} from '@polenta/types'
import { GitService } from './git.service'
import { SavedQueriesService } from './saved-queries.service'
import { DashboardsService } from './dashboards.service'
import { SuiviService } from './suivi.service'
import { createSandboxModule, SandboxContext } from './script-sandbox'
import { sha256 } from './dashboard-library.service'
import type { ScriptEngineService } from './script-engine.service'
import type { GraphService } from './graph.service'
import type { SchemaService } from './schema.service'
import { CAMPAIGN_SEED_QUERIES } from './dashboard-seed.service'
import { registerQueryTools } from '../../mcp-server/tools/queries.tools'
import type { McpContainer } from '../../mcp-server/container'

// GH70 — colonnes calculées définies par le projet, sprint 1 (specs/GH70-tests.md) : déclaration,
// stockage, MCP, bibliothèque `lastEntryResults`, modèle « Dernier résultat de campagne ».

const COLUMN: QueryColumnDef = {
  label: { fr: 'Dernier résultat', en: 'Last result' },
  appliesTo: { categories: ['test'], objectTypes: [] },
  type: 'enum',
  values: ['PASS', 'FAIL', 'BLOCKED', 'INCOMPLETE'],
}

// ─── Logique pure ────────────────────────────────────────────────────────────

describe('GH70 — déclaration de colonne', () => {
  it('valide : normalisée (propriétés connues, listes dédoublonnées)', () => {
    const { decl, errors } = validateColumnDecl({
      label: ' Score ', appliesTo: { categories: ['requirement', 'requirement'], objectTypes: ['root::exigence-systeme'] }, type: 'number', extra: 1,
    })
    expect(errors).toEqual([])
    expect(decl).toEqual({ label: 'Score', appliesTo: { categories: ['requirement'], objectTypes: ['root::exigence-systeme'] }, type: 'number' })
    expect(validateColumnDecl(undefined)).toEqual({ decl: null, errors: [] })
    expect(validateColumnDecl(null)).toEqual({ decl: null, errors: [] })
    // appliesTo absent : valide, ne s'applique à rien.
    expect(validateColumnDecl({ label: 'X', type: 'text' }).decl?.appliesTo).toEqual({ categories: [], objectTypes: [] })
  })

  it('C3 — invalide : erreurs lisibles, aucune déclaration retenue', () => {
    expect(validateColumnDecl('x').errors).toEqual(['column : objet attendu'])
    const errs = (raw: unknown) => validateColumnDecl(raw).errors.join('\n')
    expect(errs({ label: 'X', type: 'drawio' })).toMatch(/type de champ non pris en charge \(drawio\)/)
    expect(errs({ label: 'X', type: 'enum' })).toMatch(/column.values : valeurs manquantes/)
    expect(errs({ label: 'X', type: 'text', values: ['a'] })).toMatch(/réservé aux types enum/)
    expect(errs({ type: 'text' })).toMatch(/libellé manquant/)
    expect(errs({ label: 'X', type: 'text', appliesTo: 'test' })).toMatch(/appliesTo : objet attendu/)
    expect(errs({ label: 'X', type: 'text', appliesTo: { categories: ['campaign'] } })).toMatch(/catégorie inconnue \(campaign\)/)
    expect(errs({ label: 'X', type: 'text', appliesTo: { objectTypes: ['exigence'] } })).toMatch(/<nœud>::<type> attendue/)
    expect(validateColumnDecl({ label: 'X', type: 'enum' }).decl).toBeNull()
    // `values:` vide dans le YAML (null) sur un type non enum : traité comme absent.
    expect(validateColumnDecl({ label: 'X', type: 'text', values: null }).errors).toEqual([])
  })

  it('C17 / C18 — applicabilité : catégorie OU type précis', () => {
    expect(columnAppliesTo(COLUMN, 'test', 'root::cas-de-test')).toBe(true)
    expect(columnAppliesTo(COLUMN, 'requirement', 'root::exigence')).toBe(false)
    const byType: QueryColumnDef = { ...COLUMN, appliesTo: { categories: [], objectTypes: ['root::cas-de-test'] } }
    expect(columnAppliesTo(byType, 'test', 'root::cas-de-test')).toBe(true)
    expect(columnAppliesTo(byType, 'test', 'root::autre-test')).toBe(false)
  })

  it('clé et champ synthétique', () => {
    expect(computedColumnKey('QUERY-0012')).toBe('query::QUERY-0012')
    expect(isComputedColumnKey('query::QUERY-0012')).toBe(true)
    expect(isComputedColumnKey('link::verification')).toBe(false)
    expect(columnFieldDef('QUERY-0012', COLUMN, 'en')).toEqual({ name: 'query::QUERY-0012', label: 'Last result', type: 'enum', values: COLUMN.values })
  })

  it('C7–C11 — valeurs à partir des lignes', () => {
    const { values, error } = columnValuesFromRows([
      { id: 'T1', value: 'FAIL', tooltip: 'CAMP-0002', _ids: ['CAMP-0002/e1'] },
      { id: 'T1', value: 'PASS' },                       // C8 — la première ligne d'un id est retenue
      { id: 'T2', value: null },                         // C11 — vide
      { id: 'T3', value: 42 },
      { id: 'T4', value: true },
      { id: 'T5', value: 'MAYBE' },                      // C10 — hors liste : telle quelle
    ])
    expect(error).toBeUndefined()
    expect(values.get('T1')).toEqual({ value: 'FAIL', tooltip: 'CAMP-0002', target: 'CAMP-0002/e1' })
    expect(values.get('T2')).toEqual({ value: '' })
    expect(values.get('T3')).toEqual({ value: '42' })
    expect(values.get('T4')).toEqual({ value: 'true' })
    expect(values.get('T5')).toEqual({ value: 'MAYBE' })
    expect(columnValuesFromRows([{ value: 'x' }]).error).toMatch(/Ligne 1 : colonne « id » manquante/)
    expect(columnValuesFromRows([{ id: 'T1' }]).error).toMatch(/Ligne 1 \(T1\) : colonne « value » manquante/)
    expect(columnValuesFromRows([{ id: 'T1' }]).values.size).toBe(0)
  })

  it('B — colonnes du résultat choisies (idColumn / valueColumn / tooltipColumn)', () => {
    const decl = validateColumnDecl({ ...COLUMN, idColumn: ' testCaseId ', valueColumn: 'status', tooltipColumn: 'campaignTitle' })
    expect(decl.errors).toEqual([])
    expect(decl.decl).toMatchObject({ idColumn: 'testCaseId', valueColumn: 'status', tooltipColumn: 'campaignTitle' })
    // Vide / null : défaut, rien d'écrit.
    expect(validateColumnDecl({ ...COLUMN, idColumn: '', valueColumn: null }).decl).not.toHaveProperty('idColumn')
    expect(validateColumnDecl({ ...COLUMN, idColumn: 3 }).errors).toEqual(['column.idColumn : nom de colonne attendu'])
    const { values, error } = columnValuesFromRows([
      { testCaseId: 'T1', status: 'FAIL', campaignTitle: 'Camp A', _ids: ['CAMP-1/e1'] },
      { testCaseId: 'T1', status: 'PASS', campaignTitle: 'Camp B' },
      { testCaseId: 'T2', status: 'pending', campaignTitle: null },
    ], decl.decl)
    expect(error).toBeUndefined()
    expect(values.get('T1')).toEqual({ value: 'FAIL', tooltip: 'Camp A', target: 'CAMP-1/e1' })
    expect(values.get('T2')).toEqual({ value: 'pending' })
    // Infobulle : texte ou nombre seulement.
    expect(columnValuesFromRows([{ id: 'T1', value: 'x', tooltip: { a: 1 } } as unknown as GraphRow]).values.get('T1')).toEqual({ value: 'x' })
    expect(columnValuesFromRows([{ id: 'T1', value: 'x', tooltip: 3 }]).values.get('T1')).toEqual({ value: 'x', tooltip: '3' })
    // 17 — colonne absente du résultat : erreur nommée.
    expect(columnValuesFromRows([{ id: 'T1', value: 'x' }], decl.decl).error).toMatch(/colonne « testCaseId » manquante/)
    expect(columnValuesFromRows([{ testCaseId: 'T1' }], decl.decl).error).toMatch(/colonne « status » manquante/)
  })

  it('C4 — la colonne n\'entre pas dans l\'empreinte (sprint 3) ; empreinte des seeds inchangée', () => {
    expect(queryCodeForHash('s', [])).toBe('s')
    expect(legacyQueryCodeForHashWithColumn('s', [], COLUMN)).not.toBe('s')
    // Seeds Campagnes (aucune colonne) : empreinte inchangée.
    for (const q of CAMPAIGN_SEED_QUERIES) {
      const code = queryCode(q.template, sha256)
      expect(code.column).toBeNull()
      expect(code.template.hash).toBe(sha256(hashableText(queryCodeForHash(code.script, code.parameters))))
    }
  })
})

// ─── Bibliothèque et modèle ──────────────────────────────────────────────────

const ENTRY = (over: Record<string, unknown>) => ({
  entryId: 'e1', testCaseId: 'T1', requirementId: null, status: 'pending', addedAt: '2026-09-01T08:00:00Z', runId: null,
  executedAt: null, executedBy: null, carriedFrom: null, snapshot: null, resyncable: false, ...over,
})
const CAMP = (id: string, status: string, entries: Record<string, unknown>[], removed: Record<string, unknown>[] = []) => ({
  id, title: `Campagne ${id}`, status, createdAt: '2026-09-01T08:00:00Z', completedAt: null, objectTypeRef: 'root::campagne', baselineRef: null,
  level: null, targetComponent: null, component: 'produit', fields: {}, history: {}, entries: entries.map(ENTRY), removedEntries: removed.map(ENTRY),
})
const GRAPH = {
  schema: { objectTypes: [], entryStatuses: [] },
  requirements: [],
  tests: ['T1', 'T2', 'T3', 'T4', 'T5'].map((id) => ({ id, objectTypeRef: 'root::test', component: 'produit', title: id, status: 'draft', fields: {} })),
  campaigns: [
    CAMP('CAMP-0001', 'completed', [
      { testCaseId: 'T1', status: 'FAIL', executedAt: '2026-09-01T10:00:00Z', executedBy: 'alice' },
      // L3 — deux instances d'un test itérant : la plus récente l'emporte.
      { entryId: 'T3-1', testCaseId: 'T3', status: 'PASS', executedAt: '2026-09-02T10:00:00Z' },
      { entryId: 'T3-2', testCaseId: 'T3', status: 'BLOCKED', executedAt: '2026-09-04T10:00:00Z' },
      // L5 — jamais exécutée.
      { testCaseId: 'T4', status: 'pending' },
    ], [
      // L5 — entrée retirée : ignorée.
      { entryId: 'old', testCaseId: 'T4', status: 'FAIL', executedAt: '2026-09-09T10:00:00Z', removedAt: '2026-09-10T00:00:00Z' },
    ]),
    CAMP('CAMP-0002', 'in_progress', [{ testCaseId: 'T1', status: 'PASS', executedAt: '2026-09-03T10:00:00Z', executedBy: 'bob' }]),
    // L2 — campagne abandonnée comprise.
    CAMP('CAMP-0003', 'abandoned', [{ testCaseId: 'T2', status: 'INCOMPLETE', executedAt: '2026-09-05T10:00:00Z' }]),
  ],
  runs: [
    // L4 — run hors campagne : ignoré par lastEntryResults (mais vu par lastResult).
    { id: 'RUN-9', testCaseId: 'T5', requirementId: null, result: 'PASS', executedAt: '2026-09-06T10:00:00Z', campaignEntry: null },
    { id: 'RUN-8', testCaseId: 'T1', requirementId: null, result: 'BLOCKED', executedAt: '2026-09-07T10:00:00Z', campaignEntry: null },
  ],
}

describe('GH70 — bibliothèque lastEntryResults et modèle « Dernier résultat de campagne »', () => {
  let qjs: QuickJSWASMModule
  let ctx: SandboxContext
  const host = () => buildHost({ locale: 'fr', timezone: 'UTC' }, 1, new Date('2026-09-20T12:00:00Z'), null, {})
  beforeAll(async () => {
    qjs = await createSandboxModule()
    const lib = path.resolve(__dirname, '../../../resources/dashboard-lib')
    const modules = Object.fromEntries(fs.readdirSync(lib).filter((f) => f.endsWith('.js')).map((f) => [`lib/${f}`, fs.readFileSync(path.join(lib, f), 'utf8')]))
    ctx = SandboxContext.prepare(qjs, JSON.stringify(GRAPH), modules)
  })
  afterAll(() => ctx.dispose())

  const rows = (script: string) => {
    const r = ctx.runScript(script, host())
    if (!r.ok) throw new Error(JSON.stringify(r.error))
    return r.rows
  }

  it('L1–L5 — entrée exécutée la plus récente, toutes campagnes, abandonnées comprises ; hors campagne ignoré', () => {
    const out = rows(`import { lastEntryResults, lastEntryResult } from 'lib/campaign.js'
export default (data) => [...lastEntryResults(data)].map(([id, r]) => ({ id, ...r })).concat([{ id: 'none', status: String(lastEntryResult(data, 'T5')) }])`)
    const byId = Object.fromEntries(out.map((r) => [r.id, r]))
    expect(byId.T1).toMatchObject({ status: 'PASS', campaignId: 'CAMP-0002', campaignTitle: 'Campagne CAMP-0002', entryId: 'e1', executedBy: 'bob' })
    expect(byId.T2).toMatchObject({ status: 'INCOMPLETE', campaignId: 'CAMP-0003' })
    expect(byId.T3).toMatchObject({ status: 'BLOCKED', entryId: 'T3-2' })
    expect(byId.T4).toBeUndefined()
    expect(byId.T5).toBeUndefined()
    expect(byId.none.status).toBe('null')
  })

  it('L6 — lastResult inchangée (tous les runs)', () => {
    const out = rows(`import { lastResult } from 'lib/campaign.js'
export default (data) => [{ t1: lastResult(data, 'T1').result, t5: lastResult(data, 'T5').result }]`)
    expect(out).toEqual([{ t1: 'BLOCKED', t5: 'PASS' }])
  })

  it('N1 — modèle : script, déclaration de colonne, lignes au contrat', () => {
    const tpl = findQueryTemplate('campaign-last-result')!
    expect(tpl.parameters({})).toEqual([])
    expect(tpl.column!({})).toEqual(COLUMN)
    const out = rows(tpl.generate({}))
    expect(columnValuesFromRows(out).error).toBeUndefined()
    const t1 = out.find((r) => r.id === 'T1')!
    expect(t1).toEqual({ id: 'T1', value: 'PASS', tooltip: 'CAMP-0002 — Campagne CAMP-0002 · 2026-09-03 · bob', _ids: ['CAMP-0002/e1'] })
    expect(out.find((r) => r.id === 'T2')!.tooltip).toBe('CAMP-0003 — Campagne CAMP-0003 · 2026-09-05')
    expect(out.map((r) => r.id).sort()).toEqual(['T1', 'T2', 'T3'])
  })
})

// ─── Stockage ────────────────────────────────────────────────────────────────

let repo: string
let git: GitService
let dashboards: DashboardsService
let queries: SavedQueriesService
const U = 'alice'
const SCRIPT = "export default () => [{ id: 'T1', value: 'PASS' }]\n"
const read = (rel: string) => fs.readFileSync(path.join(repo, rel), 'utf8')

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gh70-'))
  git = new GitService()
  dashboards = new DashboardsService(git)
  queries = new SavedQueriesService(git, dashboards)
})
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }))

describe('GH70 — stockage de la déclaration', () => {
  it('N2 — requête partagée : column dans query.yaml, relue ; absente → omise, column null', async () => {
    const q = await queries.create(repo, U, { title: 'Q', scope: 'shared', createdBy: U, script: SCRIPT, column: COLUMN })
    expect(q.column).toEqual(COLUMN)
    expect(q.columnError).toBeUndefined()
    expect(yaml.load(read('queries/QUERY-0001/query.yaml'))).toMatchObject({ column: COLUMN })
    const none = await queries.create(repo, U, { title: 'Q2', scope: 'shared', createdBy: U, script: SCRIPT })
    expect(none.column).toBeNull()
    expect(yaml.load(read('queries/QUERY-0002/query.yaml'))).not.toHaveProperty('column')
  })

  it('N1 / 16 — modèle : colonne proposée, modifiable sans détacher la requête de son modèle', async () => {
    const q = await queries.create(repo, U, { title: 'Dernier résultat', scope: 'shared', createdBy: U, template: { id: 'campaign-last-result', params: {} } })
    expect(q.column).toEqual(COLUMN)
    expect(q.state.customized).toBe(false)
    expect(yaml.load(read('queries/QUERY-0001/query.yaml'))).toMatchObject({ column: COLUMN, template: { id: 'campaign-last-result' } })
    const edited = await queries.update(repo, U, q.id, { column: { ...COLUMN, label: 'Résultat' } })
    expect(edited.state.customized).toBe(false)
    // Modèle réappliqué : colonne actuelle conservée ; `null` explicite la retire.
    expect((await queries.update(repo, U, q.id, { template: { id: 'campaign-last-result', params: {} } })).column?.label).toBe('Résultat')
    expect((await queries.update(repo, U, q.id, { template: { id: 'campaign-last-result', params: {} }, column: null })).column).toBeNull()
    // Colonne retirée : pas réintroduite quand le même modèle est réappliqué ; proposée par un autre modèle.
    expect((await queries.update(repo, U, q.id, { template: { id: 'campaign-last-result', params: {} } })).column).toBeNull()
    const other = await queries.create(repo, U, { title: 'O', scope: 'shared', createdBy: U, template: { id: 'campaign-entries', params: {} } })
    expect((await queries.update(repo, U, other.id, { template: { id: 'campaign-last-result', params: {} } })).column).toEqual(COLUMN)
    // Création : colonne fournie prioritaire sur celle du modèle.
    const own = await queries.create(repo, U, { title: 'X', scope: 'shared', createdBy: U, template: { id: 'campaign-last-result', params: {} }, column: { ...COLUMN, label: 'Mien' } })
    expect(own.column?.label).toBe('Mien')
  })

  it('15 — requête « Entrées de campagne » (mode modèle) déclarée en colonne, non personnalisée', async () => {
    const col = { label: 'Statut en campagne', appliesTo: { categories: ['test' as const], objectTypes: [] }, type: 'text' as const, idColumn: 'testCaseId', valueColumn: 'status' }
    const q = await queries.create(repo, U, { title: 'E', scope: 'shared', createdBy: U, template: { id: 'campaign-entries', params: {} }, column: col })
    expect(q.column).toEqual(col)
    expect(q.state.customized).toBe(false)
    const plain = await queries.create(repo, U, { title: 'E2', scope: 'shared', createdBy: U, template: { id: 'campaign-entries', params: {} } })
    expect((await queries.update(repo, U, plain.id, { column: col })).state.customized).toBe(false)
  })

  it('compatibilité : empreinte calculée avec la colonne (sprints 1–2) reconnue, non personnalisée', async () => {
    const q = await queries.create(repo, U, { title: 'Q', scope: 'shared', createdBy: U, template: { id: 'campaign-last-result', params: {} } })
    const file = path.join(repo, 'queries/QUERY-0001/query.yaml')
    const stored = yaml.load(read('queries/QUERY-0001/query.yaml')) as { template: { hash: string } }
    const legacy = sha256(hashableText(legacyQueryCodeForHashWithColumn(q.script, [], COLUMN)))
    fs.writeFileSync(file, read('queries/QUERY-0001/query.yaml').replace(stored.template.hash, legacy))
    expect((await queries.findOne(repo, U, q.id))!.state.customized).toBe(false)
    // Colonne modifiée ensuite : empreinte réécrite, toujours non personnalisée.
    expect((await queries.update(repo, U, q.id, { column: { ...COLUMN, label: 'Autre' } })).state.customized).toBe(false)
    expect((await queries.update(repo, U, q.id, { column: null })).state.customized).toBe(false)
    // Script modifié : personnalisée, quelle que soit l'empreinte.
    fs.writeFileSync(path.join(repo, 'queries/QUERY-0001/script.js'), 'export default () => []\n')
    expect((await queries.findOne(repo, U, q.id))!.state.customized).toBe(true)
  })

  it('mise à jour : ajout, retrait (null), conservée si non fournie', async () => {
    const q = await queries.create(repo, U, { title: 'Q', scope: 'shared', createdBy: U, script: SCRIPT })
    expect((await queries.update(repo, U, q.id, { column: COLUMN })).column).toEqual(COLUMN)
    expect((await queries.update(repo, U, q.id, { title: 'Q bis' })).column).toEqual(COLUMN)
    expect((await queries.update(repo, U, q.id, { column: null })).column).toBeNull()
    expect(yaml.load(read('queries/QUERY-0001/query.yaml'))).not.toHaveProperty('column')
  })

  it('C1 — requête privée : column refusée (création, mise à jour)', async () => {
    await expect(queries.create(repo, U, { title: 'Q', scope: 'private', createdBy: U, script: SCRIPT, column: COLUMN })).rejects.toThrow('[COLUMN_PRIVATE]')
    // Colonne seulement proposée par le modèle : sans objet en privé, retirée.
    const fromTpl = await queries.create(repo, U, { title: 'T', scope: 'private', createdBy: U, template: { id: 'campaign-last-result', params: {} } })
    expect(fromTpl.column).toBeNull()
    expect(fromTpl.template?.id).toBe('campaign-last-result')
    const p = await queries.create(repo, U, { title: 'Q', scope: 'private', createdBy: U, script: SCRIPT })
    expect(p.column).toBeNull()
    await expect(queries.update(repo, U, p.id, { column: COLUMN })).rejects.toThrow('[COLUMN_PRIVATE]')
    expect((await queries.update(repo, U, p.id, { column: null, title: 'P' })).title).toBe('P')
  })

  it('C2 — passage en privé : déclaration retirée ; retour en partagé sans colonne', async () => {
    const q = await queries.create(repo, U, { title: 'Q', scope: 'shared', createdBy: U, script: SCRIPT, column: COLUMN })
    const priv = await queries.setScope(repo, U, q.id, 'private')
    expect(priv.column).toBeNull()
    expect(priv.columnError).toBeUndefined()
    const back = await queries.setScope(repo, U, priv.id, 'shared')
    expect(back.column).toBeNull()
  })

  it("C2 — passage en privé d'une requête issue d'un modèle à colonne : colonne retirée, modèle conservé", async () => {
    const q = await queries.create(repo, U, { title: 'Q', scope: 'shared', createdBy: U, template: { id: 'campaign-last-result', params: {} } })
    const priv = await queries.setScope(repo, U, q.id, 'private')
    expect(priv.template?.id).toBe('campaign-last-result')
    expect(priv.state.customized).toBe(false)
    expect(priv.column).toBeNull()
    expect((await queries.update(repo, U, priv.id, { template: { id: 'campaign-last-result', params: {} } })).column).toBeNull()
  })

  it('C3 — déclaration modifiée à la main invalide : columnError, exécution possible, pas d\'écrasement silencieux', async () => {
    const q = await queries.create(repo, U, { title: 'Q', scope: 'shared', createdBy: U, script: SCRIPT, column: COLUMN })
    const file = path.join(repo, 'queries/QUERY-0001/query.yaml')
    fs.writeFileSync(file, read('queries/QUERY-0001/query.yaml').replace('type: enum', 'type: drawio'))
    const broken = (await queries.findOne(repo, U, q.id))!
    expect(broken.column).toBeNull()
    expect(broken.columnError).toContain('drawio')
    const engine = { run: vi.fn(async (): Promise<ScriptRunResult> => ({ ok: true, columns: [], rows: [], total: 0, truncated: false, ms: 1 })) }
    const suivi = new SuiviService(engine as unknown as ScriptEngineService, {} as GraphService, queries, dashboards, {} as SchemaService)
    expect(await suivi.run(repo, undefined, U, { queryId: q.id }, { locale: 'fr', timezone: 'UTC' })).toMatchObject({ ok: true })
    await expect(queries.update(repo, U, q.id, { title: 'Q bis' })).rejects.toThrow('[COLUMN_INVALID]')
    expect((await queries.update(repo, U, q.id, { column: COLUMN })).columnError).toBeUndefined()
  })

  it('.pref édité à la main : colonne sur une requête privée signalée, ignorée', async () => {
    const p = await queries.create(repo, U, { title: 'Q', scope: 'private', createdBy: U, script: SCRIPT })
    const prefFile = fs.readdirSync(repo).find((f) => f.endsWith('.pref'))!
    const pref = JSON.parse(fs.readFileSync(path.join(repo, prefFile), 'utf8')) as { savedQueries: Record<string, unknown>[] }
    pref.savedQueries[0].column = COLUMN
    fs.writeFileSync(path.join(repo, prefFile), JSON.stringify(pref))
    const q = (await queries.findOne(repo, U, p.id))!
    expect(q.column).toBeNull()
    expect(q.columnError).toMatch(/réservée aux requêtes partagées/)
  })

  it('aperçu d\'un modèle : colonne renvoyée avec le script', () => {
    const suivi = new SuiviService({} as ScriptEngineService, {} as GraphService, queries, dashboards, {} as SchemaService)
    expect(suivi.renderTemplate('query', { id: 'campaign-last-result', params: {} })).toMatchObject({ column: COLUMN })
    expect(suivi.renderTemplate('query', { id: 'campaign-entries', params: {} })).toMatchObject({ column: null })
  })
})

// ─── MCP ─────────────────────────────────────────────────────────────────────

describe('GH70 — tools MCP des requêtes', () => {
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

  it('N3 — create_query avec column puis list_queries', async () => {
    const created = await call('create_query', { title: 'Q', script: SCRIPT, column: COLUMN, dryRun: false })
    expect(created.isError).toBe(false)
    expect(created.json.query.column).toEqual(COLUMN)
    const listed = await call('list_queries')
    expect(listed.json.queries[0]).toMatchObject({ id: 'QUERY-0001', column: COLUMN })
    expect(listed.json.queries[0].columnError).toBeUndefined()
    // dryRun : colonne dans l'aperçu, rien d'écrit.
    const dry = await call('create_query', { title: 'Q2', template: { id: 'campaign-last-result', params: {} } })
    expect(dry.json.query.column).toEqual(COLUMN)
    expect(fs.existsSync(path.join(repo, 'queries/QUERY-0002'))).toBe(false)
  })

  it('C1 / C5 — refus : privée, column avec template, déclaration invalide', async () => {
    expect((await call('create_query', { title: 'Q', script: SCRIPT, column: COLUMN, scope: 'private' })).text).toMatch(/PRIVATE_SCOPE_UNAVAILABLE|COLUMN_PRIVATE/)
    // Sprint 3 : column accepté avec un modèle (prioritaire sur celle qu'il propose).
    const withTpl = await call('create_query', { title: 'Q', template: { id: 'campaign-entries', params: {} }, column: { ...COLUMN, idColumn: 'testCaseId', valueColumn: 'status' }, dryRun: false })
    expect(withTpl.json.query).toMatchObject({ column: { idColumn: 'testCaseId', valueColumn: 'status' }, state: { customized: false } })
    expect((await call('create_query', { title: 'Q', script: SCRIPT, column: { ...COLUMN, values: [] } })).text).toContain('[COLUMN_INVALID]')
  })

  it("C1 — update_query d'une requête privée : colonne fournie refusée dès le dryRun ; proposée par un modèle, ignorée", async () => {
    const p = await queries.create(repo, U, { title: 'P', scope: 'private', createdBy: U, script: SCRIPT })
    expect((await call('update_query', { id: p.id, column: COLUMN })).text).toContain('[COLUMN_PRIVATE]')
    const tpl = await call('update_query', { id: p.id, template: { id: 'campaign-last-result', params: {} } })
    expect(tpl.isError).toBe(false)
    expect(tpl.json.query.column).toBeNull()
  })

  it('update_query : ajout, retrait par null ; déclaration lue invalide → COLUMN_INVALID', async () => {
    await call('create_query', { title: 'Q', script: SCRIPT, dryRun: false })
    expect((await call('update_query', { id: 'QUERY-0001', column: COLUMN, dryRun: false })).json.query.column).toEqual(COLUMN)
    expect((await call('update_query', { id: 'QUERY-0001', column: null, dryRun: false })).json.query.column).toBeNull()
    await call('update_query', { id: 'QUERY-0001', column: COLUMN, dryRun: false })
    const file = path.join(repo, 'queries/QUERY-0001/query.yaml')
    fs.writeFileSync(file, read('queries/QUERY-0001/query.yaml').replace('type: enum', 'type: inconnu'))
    expect((await call('update_query', { id: 'QUERY-0001', title: 'Q bis' })).text).toContain('[COLUMN_INVALID]')
    expect((await call('update_query', { id: 'QUERY-0001', column: COLUMN, dryRun: false })).json.query.columnError).toBeUndefined()
  })
})
