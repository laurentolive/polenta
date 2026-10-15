import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuickJSWASMModule } from 'quickjs-emscripten-core'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { GraphParamValue, QueryParameterDef, ScriptRunResult } from '@polenta/types'
import {
  buildHost, dashboardSelectors, findQueryTemplate, normalizeParamValue, paramsForQuery, paramValueText, queryCode,
  queryCodeForHash, resolveRunParams, validateParameterDecls,
} from '@polenta/types'
import { GitService } from './git.service'
import { SavedQueriesService } from './saved-queries.service'
import { DashboardsService } from './dashboards.service'
import { SuiviService } from './suivi.service'
import { createSandboxModule, SandboxContext } from './script-sandbox'
import { contentHash, sha256 } from './dashboard-library.service'
import type { ScriptEngineService, ScriptRunCode } from './script-engine.service'
import type { GraphService } from './graph.service'
import type { SchemaService } from './schema.service'
import { CAMPAIGN_SEED_QUERIES } from './dashboard-seed.service'
import { registerQueryTools } from '../../mcp-server/tools/queries.tools'
import type { McpContainer } from '../../mcp-server/container'

// GH93 — paramètres de requête choisis à l'affichage (specs/GH93-tests.md).

const CAMPAIGN: QueryParameterDef = { name: 'campaign', kind: 'campaign', label: { fr: 'Campagne', en: 'Campaign' } }

// ─── Logique pure ────────────────────────────────────────────────────────────

describe('GH93 — déclaration et valeurs', () => {
  it('24 — déclaration invalide : erreurs lisibles, aucune déclaration retenue', () => {
    const { decls, errors } = validateParameterDecls([
      { name: '1abc', kind: 'campaign', label: 'x' },
      { name: 'a', kind: 'nope', label: 'x' },
      { name: 'b', kind: 'enum', label: 'x' },
      { name: 'c', kind: 'text', label: '' },
      { name: 'd', kind: 'period', label: 'P', default: { from: '2026-09-15', to: '2026-09-01' } },
      { name: 'e', kind: 'text', label: 'E' },
      { name: 'e', kind: 'text', label: 'E' },
    ])
    expect(decls).toEqual([])
    expect(errors.join('\n')).toMatch(/« 1abc » : nom invalide/)
    expect(errors.join('\n')).toMatch(/« a » : type inconnu/)
    expect(errors.join('\n')).toMatch(/« b » : valeurs manquantes/)
    expect(errors.join('\n')).toMatch(/« c » : libellé manquant/)
    expect(errors.join('\n')).toMatch(/« d » : défaut invalide/)
    expect(errors.join('\n')).toMatch(/« e » : nom en double/)
    expect(validateParameterDecls(undefined)).toEqual({ decls: [], errors: [] })
    expect(validateParameterDecls({}).errors).toEqual(['parameters : liste attendue'])
  })

  it('déclaration valide : normalisée (propriétés connues, défaut normalisé)', () => {
    const { decls, errors } = validateParameterDecls([
      { name: 'statut', kind: 'enum', label: ' Statut ', values: ['A', { value: 'B', label: 'Bé' }], default: 'B', required: true, extra: 1 },
      { name: 'p', kind: 'period', label: { fr: 'Période', en: 'Period' }, default: { from: '2026-09-01', to: null } },
    ])
    expect(errors).toEqual([])
    expect(decls).toEqual([
      { name: 'statut', kind: 'enum', label: 'Statut', values: [{ value: 'A' }, { value: 'B', label: 'Bé' }], default: 'B', required: true },
      { name: 'p', kind: 'period', label: { fr: 'Période', en: 'Period' }, default: { from: '2026-09-01', to: null } },
    ])
  })

  it('22 / 23 — format des valeurs', () => {
    const text = { kind: 'text' as const }
    expect(normalizeParamValue(text, '  abc ')).toEqual({ ok: true, value: 'abc' })
    expect(normalizeParamValue(text, '   ')).toEqual({ ok: true, value: null })
    expect(normalizeParamValue(text, 'x'.repeat(1001)).ok).toBe(false)
    expect(normalizeParamValue({ kind: 'enum', values: [{ value: 'A' }] }, 'Z').ok).toBe(false)
    expect(normalizeParamValue({ kind: 'campaign' }, 12).ok).toBe(false)
    const period = { kind: 'period' as const }
    expect(normalizeParamValue(period, { from: '2026-09-01', to: '' })).toEqual({ ok: true, value: { from: '2026-09-01', to: null } })
    expect(normalizeParamValue(period, { from: null, to: null })).toEqual({ ok: true, value: null })
    expect(normalizeParamValue(period, { from: '2026-02-30', to: null }).ok).toBe(false)
    expect(normalizeParamValue(period, { from: '2026-09-15', to: '2026-09-01' }).ok).toBe(false)
  })

  it('19 / 20 / 21 — résolution : clé non déclarée, défaut, « Toutes » explicite, obligatoire', () => {
    const decls: QueryParameterDef[] = [CAMPAIGN, { name: 'lot', kind: 'text', label: 'Lot', default: 'L1' }]
    expect(resolveRunParams(decls, { foo: 'x' })).toMatchObject({ ok: false, message: expect.stringContaining('non déclaré(s) : foo') })
    expect(resolveRunParams(decls, undefined)).toEqual({ ok: true, params: { campaign: null, lot: 'L1' } })
    expect(resolveRunParams(decls, { lot: null, campaign: 'CAMP-0002' })).toEqual({ ok: true, params: { campaign: 'CAMP-0002', lot: null } })
    expect(resolveRunParams([], undefined)).toEqual({ ok: true, params: {} })
    const required: QueryParameterDef[] = [{ ...CAMPAIGN, required: true }]
    expect(resolveRunParams(required, {})).toMatchObject({ ok: false, missing: ['campaign'] })
    expect(resolveRunParams([{ ...CAMPAIGN, required: true, default: 'CAMP-0001' }], {})).toEqual({ ok: true, params: { campaign: 'CAMP-0001' } })
  })

  it('11 / 30 — sélecteurs d\'un dashboard : couple (name, kind) partagé, ordre, union enum, obligatoire', () => {
    const decls: Record<string, QueryParameterDef[]> = {
      Q1: [CAMPAIGN, { name: 's', kind: 'enum', label: 'S', values: [{ value: 'A' }] }],
      Q2: [{ ...CAMPAIGN, label: 'Autre', required: true }, { name: 's', kind: 'enum', label: 'S2', values: [{ value: 'A' }, { value: 'B' }] }],
      Q3: [{ name: 'campaign', kind: 'text', label: 'Texte' }],
    }
    const sel = dashboardSelectors([{ id: 'w1', queryId: 'Q1' }, { id: 'w2', queryId: 'Q2' }, { id: 'w3', queryId: 'Q3' }, { id: 'w4', queryId: 'Q0' }], (q) => decls[q])
    expect(sel.map((s) => [s.key, s.widgetIds, s.required])).toEqual([
      ['campaign:campaign', ['w1', 'w2'], true],
      ['s:enum', ['w1', 'w2'], false],
      ['campaign:text', ['w3'], false],
    ])
    expect(sel[0].label).toEqual(CAMPAIGN.label)
    expect(sel[1].values!.map((v) => v.value)).toEqual(['A', 'B'])
    const values: Record<string, GraphParamValue> = { 'campaign:campaign': 'CAMP-0002', 'campaign:enum': 'x' }
    expect(paramsForQuery(decls.Q1, values)).toEqual({ campaign: 'CAMP-0002' })
    expect(paramsForQuery(decls.Q3, values)).toEqual({})
    // Énumération partagée : une valeur que la requête ne déclare pas ne lui est pas transmise.
    expect(paramsForQuery(decls.Q1, { 's:enum': 'B' })).toEqual({})
    expect(paramsForQuery(decls.Q2, { 's:enum': 'B' })).toEqual({ s: 'B' })
    expect(paramsForQuery(decls.Q1, { 's:enum': null })).toEqual({ s: null })
  })

  it('14 — valeur lisible (impression, docx)', () => {
    const titles = (_k: string, v: string) => (v === 'CAMP-0002' ? 'CAMP-0002 — Lot 2' : undefined)
    expect(paramValueText({ kind: 'campaign' }, 'CAMP-0002', 'fr', titles)).toBe('CAMP-0002 — Lot 2')
    expect(paramValueText({ kind: 'campaign' }, null, 'fr')).toBe('Toutes')
    expect(paramValueText({ kind: 'component' }, null, 'fr')).toBe('Tous')
    expect(paramValueText({ kind: 'period' }, { from: '2026-09-01', to: '2026-09-15' }, 'fr')).toBe('du 2026-09-01 au 2026-09-15')
    expect(paramValueText({ kind: 'period' }, { from: null, to: '2026-09-15' }, 'en')).toBe('until 2026-09-15')
    expect(paramValueText({ kind: 'enum', values: [{ value: 'B', label: { fr: 'Bé', en: 'Bee' } }] }, 'B', 'en')).toBe('Bee')
  })
})

// ─── Modèles ─────────────────────────────────────────────────────────────────

const ENTRY = (over: Record<string, unknown>) => ({
  entryId: 'e1', testCaseId: 'T1', requirementId: null, status: 'pending', addedAt: '2026-09-01T08:00:00Z', runId: null,
  executedAt: null, executedBy: null, carriedFrom: null, snapshot: null, resyncable: false, ...over,
})
const CAMP = (id: string, status: string, createdAt: string, entry: Record<string, unknown>) => ({
  id, title: `Campagne ${id}`, status, createdAt, objectTypeRef: 'root::campagne', baselineRef: null, level: null,
  targetComponent: null, component: 'produit', fields: {}, entries: [ENTRY(entry)], removedEntries: [],
})
const GRAPH = {
  schema: {
    objectTypes: [
      { repo: 'produit', ref: 'root::exigence', component: 'moteur', category: 'requirement', statuses: [] },
      { repo: 'produit', ref: 'root::exigence', component: 'pompe', category: 'requirement', statuses: [] },
      { repo: 'produit', ref: 'root::test', component: 'moteur', category: 'test', statuses: [] },
    ],
    entryStatuses: ['pending', 'INCOMPLETE', 'BLOCKED', 'FAIL', 'PASS'].map((name, order) => ({ name, label: name, order })),
  },
  requirements: [
    { id: 'R-1', objectTypeRef: 'root::exigence', component: 'moteur', title: 'r1', status: 'draft', fields: {} },
    { id: 'R-2', objectTypeRef: 'root::exigence', component: 'pompe', title: 'r2', status: 'draft', fields: {} },
  ],
  tests: [{ id: 'T1', objectTypeRef: 'root::test', component: 'moteur', title: 'Test 1', status: 'draft', fields: {} }],
  campaigns: [
    CAMP('CAMP-0001', 'in_progress', '2026-09-01T08:00:00Z', { status: 'PASS', runId: 'RUN-1', executedAt: '2026-09-05T10:00:00Z' }),
    CAMP('CAMP-0002', 'completed', '2026-09-10T08:00:00Z', { status: 'FAIL', runId: 'RUN-2', addedAt: '2026-09-10T08:00:00Z', executedAt: '2026-09-12T10:00:00Z' }),
  ],
  runs: [
    { id: 'RUN-1', testCaseId: 'T1', requirementId: null, result: 'PASS', executedAt: '2026-09-05T10:00:00Z', campaignEntry: { campaignId: 'CAMP-0001', entryId: 'e1' } },
    { id: 'RUN-2', testCaseId: 'T1', requirementId: null, result: 'FAIL', executedAt: '2026-09-12T10:00:00Z', campaignEntry: { campaignId: 'CAMP-0002', entryId: 'e1' } },
  ],
}

describe('GH93 — modèles « choisi à l\'affichage »', () => {
  let qjs: QuickJSWASMModule
  let ctx: SandboxContext
  beforeAll(async () => {
    qjs = await createSandboxModule()
    const lib = path.resolve(__dirname, '../../../resources/dashboard-lib')
    const modules = Object.fromEntries(fs.readdirSync(lib).filter((f) => f.endsWith('.js')).map((f) => [`lib/${f}`, fs.readFileSync(path.join(lib, f), 'utf8')]))
    ctx = SandboxContext.prepare(qjs, JSON.stringify(GRAPH), modules)
  })
  afterAll(() => ctx.dispose())

  const run = (id: string, tplParams: Record<string, unknown>, params: Record<string, GraphParamValue> = {}) => {
    const tpl = findQueryTemplate(id)!
    const resolved = resolveRunParams(tpl.parameters(tplParams), params)
    if (!resolved.ok) throw new Error(resolved.message)
    const r = ctx.runScript(tpl.generate(tplParams), buildHost({ locale: 'fr', timezone: 'UTC' }, 1, new Date('2026-09-20T12:00:00Z'), null, resolved.params))
    if (!r.ok) throw new Error(JSON.stringify(r.error))
    return r.rows
  }

  it('déclarations générées ; sans option, aucune déclaration et empreinte = script seul', () => {
    expect(findQueryTemplate('campaign-entries')!.parameters({ campaignAtDisplay: true })).toEqual([CAMPAIGN])
    expect(findQueryTemplate('campaign-timeline')!.parameters({ campaignAtDisplay: true, periodAtDisplay: true }).map((d) => d.name)).toEqual(['campaign', 'period'])
    expect(findQueryTemplate('filtered-list')!.parameters({ componentAtDisplay: true, objectTypeAtDisplay: true }).map((d) => d.kind)).toEqual(['component', 'objectType'])
    const plain = queryCode({ id: 'campaign-entries', params: {} }, sha256)
    expect(plain.parameters).toEqual([])
    expect(plain.template.hash).toBe(contentHash(plain.script))
    expect(plain.script).not.toContain('polenta.params')
    const shown = queryCode({ id: 'campaign-entries', params: { campaignAtDisplay: true } }, sha256)
    expect(shown.template.hash).toBe(contentHash(queryCodeForHash(shown.script, shown.parameters)))
    expect(shown.template.hash).not.toBe(contentHash(shown.script))
  })

  it('2 / 3 — entrées : campagne choisie (même terminée, filtre « en cours » ignoré) ; « Toutes » → filtres', () => {
    const tpl = { campaignStatuses: ['in_progress'], campaignAtDisplay: true }
    expect(run('campaign-entries', tpl).map((r) => r.campaignId)).toEqual(['CAMP-0001'])
    expect(run('campaign-entries', tpl, { campaign: 'CAMP-0002' }).map((r) => [r.campaignId, r.status])).toEqual([['CAMP-0002', 'FAIL']])
    // Filtre de statut d'entrée toujours appliqué.
    expect(run('campaign-entries', { ...tpl, entryStatuses: ['PASS'] }, { campaign: 'CAMP-0002' })).toEqual([])
  })

  it('2 / 8 — avancement dans le temps : une seule campagne, période bornée', () => {
    const tpl = { campaignStatuses: ['in_progress'], campaignAtDisplay: true, periodAtDisplay: true }
    const last = (rows: Record<string, unknown>[]) => {
      const day = rows[rows.length - 1].date
      return Object.fromEntries(rows.filter((r) => r.date === day && (r.count as number) > 0).map((r) => [r.status, r.count]))
    }
    expect(last(run('campaign-timeline', tpl))).toEqual({ PASS: 1 })
    const chosen = run('campaign-timeline', tpl, { campaign: 'CAMP-0002' })
    expect(last(chosen)).toEqual({ FAIL: 1 })
    expect(chosen[0].date).toBe('2026-09-10')
    const bounded = run('campaign-timeline', tpl, { campaign: 'CAMP-0002', period: { from: '2026-09-11', to: '2026-09-13' } })
    expect([...new Set(bounded.map((r) => r.date))]).toEqual(['2026-09-11', '2026-09-12', '2026-09-13'])
  })

  it('9 — liste filtrée : composant / type choisis à l\'affichage', () => {
    const tpl = { category: 'requirement', componentAtDisplay: true, objectTypeAtDisplay: true }
    expect(run('filtered-list', tpl).map((r) => r.id)).toEqual(['R-1', 'R-2'])
    expect(run('filtered-list', tpl, { component: 'pompe' }).map((r) => r.id)).toEqual(['R-2'])
    expect(run('filtered-list', { ...tpl, component: 'moteur' }).map((r) => r.id)).toEqual(['R-1'])
    expect(run('filtered-list', tpl, { objectType: 'root::test' }).map((r) => r.id)).toEqual(['T1'])
  })

  it('10 / 28 — polenta.params reçu par script et transformation, non modifiable', () => {
    const host = buildHost({ locale: 'fr', timezone: 'UTC' }, 1, new Date('2026-09-20T12:00:00Z'), null, { campaign: 'CAMP-0002', period: { from: '2026-09-01', to: null } })
    const r = ctx.runScript('export default (data, polenta) => [{ c: polenta.params.campaign, from: polenta.params.period.from }]', host)
    expect(r).toMatchObject({ ok: true, rows: [{ c: 'CAMP-0002', from: '2026-09-01' }] })
    const t = ctx.runTransform('export default (rows, polenta) => rows.map((x) => ({ ...x, c: polenta.params.campaign }))', [{ a: 1 }], host, 'w.js')
    expect(t).toMatchObject({ ok: true, rows: [{ a: 1, c: 'CAMP-0002' }] })
    for (const code of ['polenta.params.campaign = "x"', 'polenta.params.period.from = "x"']) {
      const w = ctx.runScript(`export default (data, polenta) => { ${code}; return [] }`, host)
      expect(w).toMatchObject({ ok: false, error: { kind: 'runtime' } })
    }
  })

  it('1 — seed Campagnes : campagne choisie à l\'affichage sur les six requêtes', () => {
    expect(CAMPAIGN_SEED_QUERIES).toHaveLength(6)
    for (const q of CAMPAIGN_SEED_QUERIES) expect(findQueryTemplate(q.template.id)!.parameters(q.template.params)).toEqual([CAMPAIGN])
  })
})

// ─── Stockage, exécution, valeurs mémorisées ─────────────────────────────────

let repo: string
let git: GitService
let dashboards: DashboardsService
let queries: SavedQueriesService
const U = 'alice'
const read = (rel: string) => fs.readFileSync(path.join(repo, rel), 'utf8')

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gh93-'))
  git = new GitService()
  dashboards = new DashboardsService(git)
  queries = new SavedQueriesService(git, dashboards)
})
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }))

const SCRIPT = 'export default (data, polenta) => [{ c: polenta.params.campaign }]\n'

function suiviWithStubEngine() {
  const calls: ScriptRunCode[] = []
  const engine = { run: vi.fn(async (_r: string, _w: string | undefined, code: ScriptRunCode): Promise<ScriptRunResult> => { calls.push(code); return { ok: true, columns: [], rows: [], total: 0, truncated: false, ms: 1 } }) }
  const suivi = new SuiviService(engine as unknown as ScriptEngineService, {} as GraphService, queries, dashboards, {} as SchemaService)
  return { suivi, calls }
}

describe('GH93 — stockage de la déclaration', () => {
  it('16 — requête partagée : parameters dans query.yaml, relus', async () => {
    const q = await queries.create(repo, U, { title: 'Q', scope: 'shared', createdBy: U, script: SCRIPT, parameters: [CAMPAIGN] })
    expect(q.parameters).toEqual([CAMPAIGN])
    expect(yaml.load(read('queries/QUERY-0001/query.yaml'))).toMatchObject({ parameters: [CAMPAIGN] })
    const none = await queries.create(repo, U, { title: 'Q2', scope: 'shared', createdBy: U, script: SCRIPT })
    expect(none.parameters).toEqual([])
    expect(yaml.load(read('queries/QUERY-0002/query.yaml'))).not.toHaveProperty('parameters')
  })

  it('privée : parameters dans le .pref ; passage en partagé conservé', async () => {
    const q = await queries.create(repo, U, { title: 'Q', scope: 'private', createdBy: U, script: SCRIPT, parameters: [CAMPAIGN] })
    expect((await queries.findOne(repo, U, q.id))!.parameters).toEqual([CAMPAIGN])
    const shared = await queries.setScope(repo, U, q.id, 'shared')
    expect(shared.parameters).toEqual([CAMPAIGN])
  })

  it('24 / 25 — refus : déclaration invalide, parameters avec un modèle', async () => {
    await expect(queries.create(repo, U, { title: 'Q', scope: 'shared', createdBy: U, script: SCRIPT, parameters: [{ name: 'x y', kind: 'text', label: 'X' }] }))
      .rejects.toThrow('[PARAMS_INVALID]')
    await expect(queries.create(repo, U, { title: 'Q', scope: 'shared', createdBy: U, template: { id: 'campaign-entries', params: {} }, parameters: [CAMPAIGN] }))
      .rejects.toThrow('[PARAMS_INVALID]')
  })

  it('26 — modèle : déclaration générée ; déclaration modifiée seule → personnalisée', async () => {
    const q = await queries.create(repo, U, { title: 'Q', scope: 'shared', createdBy: U, template: { id: 'campaign-entries', params: { campaignAtDisplay: true } } })
    expect(q.parameters).toEqual([CAMPAIGN])
    expect(q.state.customized).toBe(false)
    const edited = await queries.update(repo, U, q.id, { parameters: [{ ...CAMPAIGN, required: true }] })
    expect(edited.state.customized).toBe(true)
    const back = await queries.update(repo, U, q.id, { template: { id: 'campaign-entries', params: { campaignAtDisplay: true } } })
    expect(back.state.customized).toBe(false)
    expect(back.parameters).toEqual([CAMPAIGN])
  })

  it('24 — déclaration modifiée à la main invalide : erreur format, pas d\'exécution, pas d\'écrasement silencieux', async () => {
    const q = await queries.create(repo, U, { title: 'Q', scope: 'shared', createdBy: U, script: SCRIPT, parameters: [CAMPAIGN] })
    const file = path.join(repo, 'queries/QUERY-0001/query.yaml')
    fs.writeFileSync(file, read('queries/QUERY-0001/query.yaml').replace('kind: campaign', 'kind: inconnu'))
    const broken = (await queries.findOne(repo, U, q.id))!
    expect(broken.parameters).toEqual([])
    expect(broken.parametersError).toContain('type inconnu')
    const { suivi, calls } = suiviWithStubEngine()
    expect(await suivi.run(repo, undefined, U, { queryId: q.id }, { locale: 'fr', timezone: 'UTC' })).toMatchObject({ ok: false, error: { kind: 'format' } })
    expect(calls).toEqual([])
    await expect(queries.update(repo, U, q.id, { title: 'Q bis' })).rejects.toThrow('[PARAMS_INVALID]')
    expect((await queries.update(repo, U, q.id, { parameters: [CAMPAIGN] })).parametersError).toBeUndefined()
  })
})

describe('GH93 — exécution (SuiviService.run)', () => {
  const client = { locale: 'fr', timezone: 'UTC' }

  it('16 / 19 / 21 — valeurs validées, défauts appliqués, transmis au moteur', async () => {
    const q = await queries.create(repo, U, { title: 'Q', scope: 'shared', createdBy: U, script: SCRIPT, parameters: [CAMPAIGN, { name: 'lot', kind: 'text', label: 'Lot', default: 'L1' }] })
    const d = await dashboards.create(repo, U, { title: 'D', scope: 'shared', createdBy: U })
    const after = await dashboards.addWidget(repo, U, d.id, { title: 'W', queryId: q.id, size: 'md', transform: 'export default (r) => r', spec: '{"data":{"name":"rows"},"mark":"bar"}' })
    const { suivi, calls } = suiviWithStubEngine()
    await suivi.run(repo, undefined, U, { dashboardId: d.id, widgetId: after.widgets[0].id, params: { campaign: 'CAMP-0002' } }, client)
    expect(calls[0].params).toEqual({ campaign: 'CAMP-0002', lot: 'L1' })
    expect(await suivi.run(repo, undefined, U, { queryId: q.id, params: { foo: 'x' } }, client)).toMatchObject({ ok: false, error: { kind: 'params' } })
    expect(calls).toHaveLength(1)
  })

  it('script ad hoc : déclaration fournie ; sans déclaration, aucun paramètre accepté', async () => {
    const { suivi, calls } = suiviWithStubEngine()
    await suivi.run(repo, undefined, U, { script: SCRIPT, parameters: [{ ...CAMPAIGN, required: true }], params: { campaign: 'CAMP-0001' } }, client)
    expect(calls[0]).toMatchObject({ script: SCRIPT, params: { campaign: 'CAMP-0001' } })
    expect(await suivi.run(repo, undefined, U, { script: SCRIPT, parameters: [{ ...CAMPAIGN, required: true }] }, client))
      .toMatchObject({ ok: false, error: { kind: 'params', message: expect.stringContaining('obligatoire') } })
    expect(await suivi.run(repo, undefined, U, { script: SCRIPT, params: { campaign: 'x' } }, client)).toMatchObject({ ok: false, error: { kind: 'params' } })
    expect(await suivi.run(repo, undefined, U, { script: SCRIPT, parameters: [{ name: '', kind: 'text', label: 'x' }] as QueryParameterDef[] }, client))
      .toMatchObject({ ok: false, error: { kind: 'format' } })
  })

  it('aperçu d\'un modèle : déclaration renvoyée avec le script', () => {
    const { suivi } = suiviWithStubEngine()
    expect(suivi.renderTemplate('query', { id: 'campaign-timeline', params: { periodAtDisplay: true } })).toMatchObject({ parameters: [{ name: 'period', kind: 'period' }] })
  })
})

describe('GH93 — valeurs choisies (.pref)', () => {
  it('4 / 5 / 6 — par utilisateur et par dashboard ; Réinitialiser ; jamais dans le dashboard', async () => {
    const d = await dashboards.create(repo, U, { title: 'D', scope: 'shared', createdBy: U })
    const before = read(`dashboards/${d.id}/dashboard.yaml`)
    await dashboards.setParamValues(repo, U, d.id, { 'campaign:campaign': 'CAMP-0002', 'p:period': { from: '2026-09-01', to: null }, 'x:inconnu': 'y', 'bad:period': 'z' })
    await dashboards.setParamValues(repo, 'bob', d.id, { 'campaign:campaign': null })
    expect(await dashboards.getParamValues(repo, U, d.id)).toEqual({ 'campaign:campaign': 'CAMP-0002', 'p:period': { from: '2026-09-01', to: null } })
    expect(await dashboards.getParamValues(repo, 'bob', d.id)).toEqual({ 'campaign:campaign': null })
    expect(await dashboards.getParamValues(repo, U, 'DASHBOARD-0099')).toEqual({})
    expect(read(`dashboards/${d.id}/dashboard.yaml`)).toBe(before)
    await dashboards.setParamValues(repo, U, d.id, null)
    expect(await dashboards.getParamValues(repo, U, d.id)).toEqual({})
    expect(JSON.parse(read(`.${U}.pref`))).not.toHaveProperty('suiviParamValues')
  })

  it('29 / 32 — changement de portée : valeurs suivies ; suppression : retirées ; lecture seule : autorisé', async () => {
    const d = await dashboards.create(repo, U, { title: 'D', scope: 'private', createdBy: U })
    await dashboards.setParamValues(repo, U, d.id, { 'campaign:campaign': 'CAMP-0001' })
    const shared = await dashboards.setScope(repo, U, d.id, 'shared')
    expect(await dashboards.getParamValues(repo, U, d.id)).toEqual({})
    expect(await dashboards.getParamValues(repo, U, shared.id)).toEqual({ 'campaign:campaign': 'CAMP-0001' })
    await dashboards.delete(repo, U, shared.id)
    expect(await dashboards.getParamValues(repo, U, shared.id)).toEqual({})
    // Dashboard d'un format plus récent : valeurs privées quand même mémorisables.
    fs.mkdirSync(path.join(repo, 'dashboards/DASHBOARD-0007'), { recursive: true })
    fs.writeFileSync(path.join(repo, 'dashboards/DASHBOARD-0007/dashboard.yaml'), yaml.dump({ id: 'DASHBOARD-0007', title: 'N', formatVersion: 99, widgetOrder: [], widgets: [] }))
    await dashboards.setParamValues(repo, U, 'DASHBOARD-0007', { 'campaign:campaign': 'CAMP-0001' })
    expect(await dashboards.getParamValues(repo, U, 'DASHBOARD-0007')).toEqual({ 'campaign:campaign': 'CAMP-0001' })
  })
})

// ─── MCP ─────────────────────────────────────────────────────────────────────

describe('GH93 — tools MCP des requêtes', () => {
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

  function container() {
    vi.spyOn(git, 'currentBranch').mockResolvedValue('main')
    const { suivi, calls } = suiviWithStubEngine()
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
    return { calls }
  }

  it('16 / 25 — create_query avec parameters ; refus avec template ; déclaration invalide', async () => {
    container()
    const created = await call('create_query', { title: 'Q', script: SCRIPT, parameters: [CAMPAIGN], dryRun: false })
    expect(created.isError).toBe(false)
    expect(created.json.query.parameters).toEqual([CAMPAIGN])
    expect(yaml.load(read('queries/QUERY-0001/query.yaml'))).toMatchObject({ parameters: [CAMPAIGN] })
    const both = await call('create_query', { title: 'Q2', template: { id: 'campaign-entries', params: {} }, parameters: [CAMPAIGN] })
    expect(both.text).toContain('[INVALID_INPUT]')
    const bad = await call('create_query', { title: 'Q3', script: SCRIPT, parameters: [{ name: 'a', kind: 'enum', label: 'A' }] })
    expect(bad.text).toContain('[PARAMS_INVALID]')
    const tpl = await call('create_query', { title: 'Q4', template: { id: 'campaign-timeline', params: { campaignAtDisplay: true } } })
    expect(tpl.json.query.parameters).toEqual([CAMPAIGN])
  })

  it('16 / 19 — run_query avec params ; clé non déclarée → erreur params', async () => {
    const { calls } = container()
    await call('create_query', { title: 'Q', script: SCRIPT, parameters: [CAMPAIGN], dryRun: false })
    calls.length = 0
    const ok = await call('run_query', { queryId: 'QUERY-0001', params: { campaign: 'CAMP-0002' } })
    expect(ok.isError).toBe(false)
    expect(calls[0].params).toEqual({ campaign: 'CAMP-0002' })
    const ko = await call('run_query', { queryId: 'QUERY-0001', params: { foo: 'x' } })
    expect(ko.text).toContain('SCRIPT_ERROR')
    expect(ko.text).toContain('"kind":"params"')
    expect((await call('run_query', { queryId: 'QUERY-0001', parameters: [CAMPAIGN] })).text).toContain('[INVALID_INPUT]')
    await call('run_query', { script: SCRIPT, parameters: [CAMPAIGN], params: { campaign: 'CAMP-0001' } })
    expect(calls[calls.length - 1].params).toEqual({ campaign: 'CAMP-0001' })
    // Période ouverte : une seule borne.
    const period = { name: 'p', kind: 'period', label: 'P' }
    expect((await call('run_query', { script: SCRIPT, parameters: [period], params: { p: { from: '2026-09-01' } } })).isError).toBe(false)
    expect(calls[calls.length - 1].params).toEqual({ p: { from: '2026-09-01', to: null } })
  })

  it('update_query : déclaration lue invalide → PARAMS_INVALID, même en dryRun ; corrigée par parameters', async () => {
    container()
    await call('create_query', { title: 'Q', script: SCRIPT, parameters: [CAMPAIGN], dryRun: false })
    const file = path.join(repo, 'queries/QUERY-0001/query.yaml')
    fs.writeFileSync(file, read('queries/QUERY-0001/query.yaml').replace('kind: campaign', 'kind: inconnu'))
    expect((await call('update_query', { id: 'QUERY-0001', title: 'Q bis' })).text).toContain('[PARAMS_INVALID]')
    const fixed = await call('update_query', { id: 'QUERY-0001', parameters: [CAMPAIGN], dryRun: false })
    expect(fixed.json.query.parameters).toEqual([CAMPAIGN])
  })
})
