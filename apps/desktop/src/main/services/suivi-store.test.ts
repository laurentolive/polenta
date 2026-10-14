import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuickJSWASMModule } from 'quickjs-emscripten-core'
import type { GraphRow } from '@polenta/types'
import { buildHost, findQueryTemplate, findWidgetTemplate, stableJson } from '@polenta/types'
import { GitService } from './git.service'
import { SavedQueriesService } from './saved-queries.service'
import { DashboardsService } from './dashboards.service'
import { SuiviService } from './suivi.service'
import { createSandboxModule, SandboxContext } from './script-sandbox'
import { checkSpec, validateTemplateInput } from './suivi-validation.util'
import type { ScriptEngineService } from './script-engine.service'
import type { GraphService } from './graph.service'
import type { SchemaService } from './schema.service'

// GH74 — stockage v1 de la vue Suivi, migrations à la lecture, modèles (specs/GH74-tests.md §4–5).

let repo: string
let dashboards: DashboardsService
let queries: SavedQueriesService
const U = 'alice'

const write = (rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true })
  fs.writeFileSync(path.join(repo, rel), content)
}
const exists = (rel: string) => fs.existsSync(path.join(repo, rel))
const read = (rel: string) => fs.readFileSync(path.join(repo, rel), 'utf8')

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gh74-store-'))
  const git = new GitService()
  dashboards = new DashboardsService(git)
  queries = new SavedQueriesService(git, dashboards)
})
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }))

const LIST = { id: 'filtered-list', params: { category: 'requirement', groupBy: ['status'] } }
const BAR = { id: 'bar', params: { category: 'status', measure: 'sum', measureColumn: 'count' } }

describe('GH74 — stockage v1', () => {
  it('F1 — requête et dashboard partagés : un dossier par objet', async () => {
    const q = await queries.create(repo, U, { title: 'Statuts', scope: 'shared', createdBy: U, template: LIST })
    expect(q).toMatchObject({ id: 'QUERY-0001', scope: 'shared', formatVersion: 1, state: { customized: false } })
    expect(read('queries/QUERY-0001/script.js')).toBe(findQueryTemplate('filtered-list')!.generate(LIST.params))
    expect(yaml.load(read('queries/QUERY-0001/query.yaml'))).toMatchObject({ id: 'QUERY-0001', formatVersion: 1, template: { id: 'filtered-list', version: 1 } })

    const d = await dashboards.create(repo, U, { title: 'Suivi', scope: 'shared', createdBy: U })
    const after = await dashboards.addWidget(repo, U, d.id, { title: 'Barres', queryId: q.id, size: 'md', template: BAR })
    const w = after.widgets[0]
    expect(read(`dashboards/${d.id}/${w.id}.js`)).toBe(findWidgetTemplate('bar')!.generate(BAR.params).transform)
    expect(JSON.parse(read(`dashboards/${d.id}/${w.id}.vl.json`))).toMatchObject({ data: { name: 'rows' }, mark: { type: 'bar' } })
    expect(w.state.customized).toBe(false)
    const deleted = await dashboards.deleteWidget(repo, U, d.id, w.id)
    expect(deleted.widgets).toEqual([])
    expect(exists(`dashboards/${d.id}/${w.id}.js`)).toBe(false)
  })

  it('F2 — ids : fichiers historiques et dossiers comptés, pierres tombales respectées', async () => {
    write('queries/QUERY-0001.yaml', 'id: QUERY-0001\ntitle: a\nmode: sql\nsqlText: SELECT 1\nscope: shared\ncreatedBy: x\ncreatedAt: "2026-01-01"\n')
    write('queries/QUERY-0002/query.yaml', 'id: QUERY-0002\ntitle: b\nformatVersion: 1\ncreatedBy: x\ncreatedAt: "2026-01-02"\n')
    write('queries/QUERY-0002/script.js', 'export default () => []\n')
    write('.polenta/tombstones/QUERY-0005', '')
    const q = await queries.create(repo, U, { title: 'c', scope: 'shared', createdBy: U, script: 'export default () => []\n' })
    expect(q.id).toBe('QUERY-0006')
    await queries.delete(repo, U, 'QUERY-0002')
    expect(exists('queries/QUERY-0002')).toBe(false)
    expect(exists('.polenta/tombstones/QUERY-0002')).toBe(true)
  })

  it('F3 — requête builder d\'avant GH74 : convertie à la lecture, réécrite en v1 à la modification', async () => {
    write('queries/QUERY-0001.yaml', yaml.dump({
      id: 'QUERY-0001', title: 'Approuvées', mode: 'builder', scope: 'shared', createdBy: 'x', createdAt: '2026-01-01',
      builderConfig: { objectTypeRef: 'root::exigence', conditions: [{ field: 'status', operator: '=', value: 'approved' }], combinator: 'AND' },
    }))
    const [q] = await queries.list(repo, U)
    expect(q).toMatchObject({ template: { id: 'filtered-list', params: { objectTypeRef: 'root::exigence' } }, state: { customized: false, legacyFormat: true } })
    expect(q.script).toContain('"objectTypeRef": "root::exigence"')
    expect(exists('queries/QUERY-0001.yaml')).toBe(true) // lecture : rien d'écrit
    await queries.update(repo, U, 'QUERY-0001', { title: 'Approuvées (v1)' })
    expect(exists('queries/QUERY-0001.yaml')).toBe(false)
    expect(exists('queries/QUERY-0001/script.js')).toBe(true)
    expect((await queries.findOne(repo, U, 'QUERY-0001'))).toMatchObject({ title: 'Approuvées (v1)', state: { customized: false } })
  })

  it('F4 — requête SQL d\'avant GH74 : lecture seule, non exécutable, supprimable', async () => {
    write('queries/QUERY-0001.yaml', 'id: QUERY-0001\ntitle: SQL\nmode: sql\nsqlText: SELECT * FROM requirements\nscope: shared\ncreatedBy: x\ncreatedAt: "2026-01-01"\n')
    const q = (await queries.findOne(repo, U, 'QUERY-0001'))!
    expect(q).toMatchObject({ legacySql: 'SELECT * FROM requirements', script: '', state: { readOnly: 'legacy-sql' } })
    await expect(queries.update(repo, U, 'QUERY-0001', { title: 'x' })).rejects.toThrow(/SUIVI_READ_ONLY/)
    const suivi = new SuiviService({} as ScriptEngineService, {} as GraphService, queries, dashboards, {} as SchemaService)
    expect(await suivi.run(repo, undefined, U, { queryId: 'QUERY-0001' }, { locale: 'fr', timezone: 'UTC' }))
      .toMatchObject({ ok: false, error: { kind: 'legacy-sql' } })
    await queries.delete(repo, U, 'QUERY-0001')
    expect(await queries.list(repo, U)).toEqual([])
  })

  it('F5 — widget d\'avant GH74 : converti dans le modèle correspondant', async () => {
    write('dashboards/DASHBOARD-0001.yaml', yaml.dump({
      id: 'DASHBOARD-0001', title: 'Status', scope: 'shared', createdBy: 'x', createdAt: '2026-01-01', widgetOrder: ['w1', 'w2'],
      widgets: [
        { id: 'w1', title: 'Barres', queryId: 'QUERY-0001', type: 'bar', size: 'lg', fieldMapping: { category: 'component', series: 'status', measure: 'count', stacked: true, preset: 'campaignProgress' } },
        { id: 'w2', title: 'Matrice', queryId: 'QUERY-0001', type: 'matrix', size: 'md', fieldMapping: { category: 'testCaseId', series: 'campaignId', measure: 'status', label: 'testTitle' } },
      ],
    }))
    const d = (await dashboards.get(repo, U, 'DASHBOARD-0001'))!
    expect(d.state.legacyFormat).toBe(true)
    expect(d.widgets[0].template).toMatchObject({ id: 'bar', params: { category: 'component', series: 'status', measure: 'sum', measureColumn: 'count', stacked: true, entryColors: true } })
    expect(d.widgets[1].template).toMatchObject({ id: 'matrix', params: { row: 'testCaseId', column: 'campaignId', value: 'status', label: 'testTitle' } })
    await dashboards.update(repo, U, 'DASHBOARD-0001', { title: 'Status v1' })
    expect(exists('dashboards/DASHBOARD-0001.yaml')).toBe(false)
    expect(exists('dashboards/DASHBOARD-0001/w1.vl.json')).toBe(true)
  })

  it('F6 — format plus récent : lecture seule, jamais réécrit', async () => {
    const content = 'id: DASHBOARD-0001\ntitle: Futur\nformatVersion: 2\nwidgetOrder: []\nwidgets: []\ncreatedBy: x\ncreatedAt: "2026-01-01"\nnouveauChamp: 1\n'
    write('dashboards/DASHBOARD-0001/dashboard.yaml', content)
    const d = (await dashboards.get(repo, U, 'DASHBOARD-0001'))!
    expect(d.state.readOnly).toBe('newer-format')
    await expect(dashboards.update(repo, U, 'DASHBOARD-0001', { title: 'x' })).rejects.toThrow(/SUIVI_READ_ONLY/)
    await expect(dashboards.setScope(repo, U, 'DASHBOARD-0001', 'private')).rejects.toThrow(/SUIVI_READ_ONLY/)
    expect(read('dashboards/DASHBOARD-0001/dashboard.yaml')).toBe(content)
  })

  it('F7 — privé dans le .pref ; passage en partagé : fichiers v1, widgets privés remappés', async () => {
    const q = await queries.create(repo, U, { title: 'Privée', scope: 'private', createdBy: U, template: LIST })
    expect(q.scope).toBe('private')
    const d = await dashboards.create(repo, U, { title: 'Mon suivi', scope: 'private', createdBy: U })
    await dashboards.addWidget(repo, U, d.id, { title: 'B', queryId: q.id, size: 'md', template: BAR })
    const pref = JSON.parse(read(`.${U}.pref`))
    expect(pref.savedQueries[0].script).toContain('filtered-list')
    expect(pref.dashboards[0].widgets[0].spec).toContain('"rows"')

    await expect(dashboards.setScope(repo, U, d.id, 'shared')).rejects.toThrow(/requête privée/)
    const shared = await queries.setScope(repo, U, q.id, 'shared')
    expect(shared.id).toBe('QUERY-0001')
    expect((await dashboards.get(repo, U, d.id))!.widgets[0].queryId).toBe('QUERY-0001')
    const sharedDash = await dashboards.setScope(repo, U, d.id, 'shared')
    expect(sharedDash.id).toBe('DASHBOARD-0001')
    expect(exists(`dashboards/DASHBOARD-0001/${sharedDash.widgets[0].id}.vl.json`)).toBe(true)
  })

  it('F8 — dépendances : suppression d\'une requête utilisée bloquée', async () => {
    const q = await queries.create(repo, U, { title: 'Q', scope: 'shared', createdBy: U, template: LIST })
    const d = await dashboards.create(repo, U, { title: 'D', scope: 'shared', createdBy: U })
    await dashboards.addWidget(repo, U, d.id, { title: 'W', queryId: q.id, size: 'md', template: BAR })
    await expect(queries.delete(repo, U, q.id)).rejects.toThrow(/utilisée par 1 widget/)
  })

  it('T7 — détachement : code modifié → personnalisé ; modèle réappliqué → non personnalisé', async () => {
    const q = await queries.create(repo, U, { title: 'Q', scope: 'shared', createdBy: U, template: LIST })
    const d = await dashboards.create(repo, U, { title: 'D', scope: 'shared', createdBy: U })
    const w = (await dashboards.addWidget(repo, U, d.id, { title: 'W', queryId: q.id, size: 'md', template: BAR })).widgets[0]
    const edited = (await dashboards.updateWidget(repo, U, d.id, w.id, { spec: w.spec.replace('"bar"', '"line"') })).widgets[0]
    expect(edited.state.customized).toBe(true)
    expect(edited.template?.id).toBe('bar')
    const reverted = (await dashboards.updateWidget(repo, U, d.id, w.id, { template: { id: 'bar', params: edited.template!.params } })).widgets[0]
    expect(reverted.state.customized).toBe(false)
    expect(reverted.spec).toBe(w.spec)
    // Modification hors application (fichier édité à la main) : détectée aussi.
    write(`dashboards/${d.id}/${w.id}.js`, '// modifié\n' + reverted.transform)
    expect((await dashboards.get(repo, U, d.id))!.widgets[0].state.customized).toBe(true)
    const qEdited = await queries.update(repo, U, q.id, { script: 'export default () => []\n' })
    expect(qEdited.state.customized).toBe(true)
  })

  it('T8 — modèle d\'une version antérieure : nouvelle version signalée', async () => {
    write('queries/QUERY-0001/query.yaml', yaml.dump({
      id: 'QUERY-0001', title: 'Vieille', formatVersion: 1, createdBy: 'x', createdAt: '2026-01-01',
      template: { id: 'filtered-list', version: 0, params: LIST.params, hash: 'x' },
    }))
    write('queries/QUERY-0001/script.js', 'export default () => []\n')
    expect((await queries.findOne(repo, U, 'QUERY-0001'))!.state).toMatchObject({ customized: true, templateUpdate: 1 })
  })

  it('historique : script, sans doublon ; entrées d\'avant GH74 ignorées', async () => {
    write(`.${U}.pref`, JSON.stringify({ queryHistory: [{ id: 'h0', mode: 'sql', sqlText: 'SELECT 1', executedAt: 'x' }] }))
    await queries.addHistoryEntry(repo, U, { script: 'a' })
    await queries.addHistoryEntry(repo, U, { script: 'b' })
    await queries.addHistoryEntry(repo, U, { script: 'a' })
    expect((await queries.listHistory(repo, U)).map((h) => h.script)).toEqual(['a', 'b'])
  })
})

describe('GH74 — modèles', () => {
  let qjs: QuickJSWASMModule
  let ctx: SandboxContext
  const host = buildHost({ locale: 'fr', timezone: 'UTC' }, 1, new Date('2026-10-13T12:00:00Z'))
  beforeAll(async () => {
    qjs = await createSandboxModule()
    ctx = SandboxContext.prepare(qjs, '{}', {})
  })
  afterAll(() => ctx.dispose())
  const transform = (id: string, params: Record<string, unknown>, rows: GraphRow[]) => {
    const r = ctx.runTransform(findWidgetTemplate(id)!.generate(params).transform!, rows, host, 'w.js')
    if (!r.ok) throw new Error(JSON.stringify(r.error))
    return r.rows
  }
  const ENTRIES: GraphRow[] = [
    { campaign: 'C1', test: 'T-2', status: 'PASS', _ids: ['C1/a'] },
    { campaign: 'C1', test: 'T-10', status: 'FAIL', _ids: ['C1/b'] },
    { campaign: 'C1', test: 'T-2', status: 'BLOCKED', _ids: ['C1/c'] },
    { campaign: 'C2', test: 'T-2', status: 'pending', _ids: ['C2/d'] },
  ]

  it('T1 — génération déterministe, indépendante de l\'ordre des paramètres', () => {
    const a = findWidgetTemplate('bar')!.generate({ category: 'c', series: 's', stacked: true })
    const b = findWidgetTemplate('bar')!.generate({ stacked: true, series: 's', category: 'c' })
    expect(a).toEqual(b)
    expect(stableJson({ b: 1, a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1},"b":1}')
    for (const t of ['filtered-list', 'campaign-entries', 'campaign-timeline']) {
      expect(findQueryTemplate(t)!.generate({})).toBe(findQueryTemplate(t)!.generate({}))
    }
  })

  it('T3 — barres empilées : regroupement, comptage, union des _ids, statuts dans l\'ordre', () => {
    const rows = transform('bar', { category: 'campaign', series: 'status', measure: 'count', stacked: true }, ENTRIES)
    expect(rows.map((r) => [r.campaign, r.status, r.count, r._ids])).toEqual([
      ['C2', 'pending', 1, ['C2/d']],
      ['C1', 'BLOCKED', 1, ['C1/c']],
      ['C1', 'FAIL', 1, ['C1/b']],
      ['C1', 'PASS', 1, ['C1/a']],
    ])
    const spec = JSON.parse(findWidgetTemplate('bar')!.generate({ category: 'campaign', series: 'status', stacked: true }).spec)
    expect(JSON.stringify(spec)).not.toContain('aggregate')
    expect(checkSpec(JSON.stringify(spec))).toEqual({ issue: null, warnings: [] })
  })

  it('T4 — matrice : pire statut, ×n, union des _ids, tri naturel des lignes', () => {
    const rows = transform('matrix', { row: 'test', column: 'campaign', value: 'status', entryColors: true }, ENTRIES)
    expect(rows.map((r) => [r.row, r.column, r.value, r.text, r._ids])).toEqual([
      ['T-2', 'C1', 'BLOCKED', 'BLOCKED ×2', ['C1/a', 'C1/c']],
      ['T-2', 'C2', 'pending', 'pending', ['C2/d']],
      ['T-10', 'C1', 'FAIL', 'FAIL', ['C1/b']],
    ])
  })

  it('KPI pourcentage et table', () => {
    expect(transform('kpi', { measure: 'ratio', measureColumn: 'status', ratioValues: 'PASS, FAIL' }, ENTRIES))
      .toEqual([{ value: 50, _ids: ['C1/a', 'C1/b'] }])
    expect(transform('kpi', { measure: 'ratio', measureColumn: 'status', ratioValues: 'PASS' }, [])).toEqual([])
    expect(transform('table', { columns: ['test'] }, ENTRIES.slice(0, 1))).toEqual([{ test: 'T-2', _ids: ['C1/a'] }])
    expect(JSON.parse(findWidgetTemplate('kpi')!.generate({ measure: 'ratio' }).spec).usermeta.polenta).toEqual({ view: 'kpi', field: 'value', suffix: '%' })
  })

  it('T5 — aire empilée : couche cliquable au-dessus de l\'aire', () => {
    const spec = JSON.parse(findWidgetTemplate('stacked-area')!.generate({ x: 'date', series: 'status', value: 'count', entryColors: true }).spec)
    expect(spec.layer.map((l: { mark: { type: string } }) => l.mark.type)).toEqual(['area', 'bar'])
  })

  it('validation : modèle inconnu, paramètre requis, spec', () => {
    expect(validateTemplateInput('widget', { id: 'radar', params: {} })?.code).toBe('INVALID_TEMPLATE')
    expect(validateTemplateInput('widget', { id: 'matrix', params: { row: 'a' } })?.reason).toMatch(/column, value/)
    expect(validateTemplateInput('query', { id: 'filtered-list', params: {} })?.reason).toMatch(/objectTypeRef ou category/)
    expect(checkSpec('{').issue?.code).toBe('SPEC_INVALID')
    expect(checkSpec('{"data":{"values":[]},"mark":"bar"}').issue?.reason).toMatch(/"rows"/)
    expect(checkSpec('{"data":{"name":"rows"},"layer":[{"data":{"url":"http://x"}}]}').issue?.reason).toMatch(/externes/)
    expect(checkSpec('{"data":{"name":"rows"},"mark":"bar","encoding":{"y":{"aggregate":"sum","field":"n"}}}').warnings[0].code).toBe('SPEC_AGGREGATE')
  })
})

describe('GH74 — seeds d\'avant GH74 réécrits', () => {
  const STATUS_SQL = 'SELECT [component], [status], COUNT(*) AS [count] FROM [requirements] GROUP BY [component], [status]'
  const PROGRESS_SQL = "SELECT [campaignTitle], [progress], COUNT(*) AS [count] FROM [campaign_entries] WHERE [campaignStatus] IN ('planned', 'in_progress') GROUP BY [campaignTitle], [progress]"

  async function seedService(branch: string) {
    const { DashboardSeedService } = await import('./dashboard-seed.service')
    const git = new GitService()
    vi.spyOn(git, 'currentBranch').mockResolvedValue(branch)
    const d = new DashboardsService(git)
    const q = new SavedQueriesService(git, d)
    const marker = { read: () => ({ state: 'done' as const }), write: () => {} }
    write('dashboards/.seeded.yaml', 'seededAt: x\n')
    return { seed: new DashboardSeedService(git, d, q, marker), d, q }
  }

  it('D2 — Status (partagé) et Campagnes (privé) intacts : requêtes et widgets réécrits, mêmes ids', async () => {
    write('queries/QUERY-0001.yaml', yaml.dump({ id: 'QUERY-0001', title: 'Exigences — statut par composant', mode: 'sql', sqlText: STATUS_SQL, scope: 'shared', createdBy: 'x', createdAt: '2026-01-01' }))
    write('dashboards/DASHBOARD-0001.yaml', yaml.dump({
      id: 'DASHBOARD-0001', title: 'Status', scope: 'shared', createdBy: 'x', createdAt: '2026-01-01', widgetOrder: ['w1'],
      widgets: [{ id: 'w1', title: 'Statut', queryId: 'QUERY-0001', type: 'bar', size: 'lg', fieldMapping: { category: 'component', measure: 'count', series: 'status', stacked: true } }],
    }))
    write(`.${U}.pref`, JSON.stringify({
      savedQueries: [{ id: 'local-1', title: 'Campagnes — avancement', mode: 'sql', sqlText: PROGRESS_SQL, scope: 'private', createdBy: U, createdAt: '2026-01-01' }],
      dashboards: [{ id: 'local-2', title: 'Campagnes', scope: 'private', createdBy: U, createdAt: '2026-01-01', widgetOrder: ['w2'],
        widgets: [{ id: 'w2', title: 'Avancement', queryId: 'local-1', type: 'bar', size: 'lg', fieldMapping: { category: 'campaignTitle', measure: 'count', series: 'progress', stacked: true, preset: 'campaignProgress' } }] }],
    }))
    const { seed, d, q } = await seedService('main')
    await seed.ensureSeeded(repo, U)
    expect(await q.findOne(repo, U, 'QUERY-0001')).toMatchObject({ template: { id: 'filtered-list' }, state: { customized: false } })
    expect((await q.findOne(repo, U, 'QUERY-0001'))!.state.readOnly).toBeUndefined()
    expect(exists('queries/QUERY-0001.yaml')).toBe(false)
    expect((await d.get(repo, U, 'DASHBOARD-0001'))!.widgets[0].template).toMatchObject({ id: 'bar', params: { category: 'component', series: 'status' } })
    expect(await q.findOne(repo, U, 'local-1')).toMatchObject({ template: { id: 'campaign-entries' } })
    expect((await d.get(repo, U, 'local-2'))!.widgets[0].template).toMatchObject({ id: 'bar', params: { category: 'campaignTitle', series: 'stepLabel', seriesOrder: 'stepRank', measure: 'count' } })
  })

  it('D3 — requête modifiée : non reconnue ; branche en lecture seule : partagé non touché', async () => {
    write('queries/QUERY-0001.yaml', yaml.dump({ id: 'QUERY-0001', title: 'x', mode: 'sql', sqlText: STATUS_SQL + ' ORDER BY [status]', scope: 'shared', createdBy: 'x', createdAt: '2026-01-01' }))
    write('queries/QUERY-0002.yaml', yaml.dump({ id: 'QUERY-0002', title: 'y', mode: 'sql', sqlText: STATUS_SQL, scope: 'shared', createdBy: 'x', createdAt: '2026-01-02' }))
    const { seed, q } = await seedService('prj-v1')
    await seed.ensureSeeded(repo, U)
    expect((await q.findOne(repo, U, 'QUERY-0001'))!.state.readOnly).toBe('legacy-sql')
    expect((await q.findOne(repo, U, 'QUERY-0002'))!.state.readOnly).toBe('legacy-sql')
  })

  it('widget seedé modifié par l\'utilisateur : requête réécrite, widget conservé', async () => {
    write('queries/QUERY-0001.yaml', yaml.dump({ id: 'QUERY-0001', title: 'x', mode: 'sql', sqlText: STATUS_SQL, scope: 'shared', createdBy: 'x', createdAt: '2026-01-01' }))
    write('dashboards/DASHBOARD-0001.yaml', yaml.dump({
      id: 'DASHBOARD-0001', title: 'Status', scope: 'shared', createdBy: 'x', createdAt: '2026-01-01', widgetOrder: ['w1'],
      widgets: [{ id: 'w1', title: 'Camembert', queryId: 'QUERY-0001', type: 'pie', size: 'md', fieldMapping: { category: 'status', measure: 'count' } }],
    }))
    const { seed, d } = await seedService('main')
    await seed.ensureSeeded(repo, U)
    expect((await d.get(repo, U, 'DASHBOARD-0001'))!.widgets[0].template).toMatchObject({ id: 'pie', params: { category: 'status', measure: 'sum', measureColumn: 'count' } })
  })

  it('requête builder sur une colonne retirée (étape, maturité) : lecture seule', async () => {
    write('queries/QUERY-0001.yaml', yaml.dump({
      id: 'QUERY-0001', title: 'Étapes', mode: 'builder', scope: 'shared', createdBy: 'x', createdAt: '2026-01-01',
      builderConfig: { objectTypeRef: 'root::campagne', conditions: [{ field: 'progress', operator: '=', value: 'ready' }], combinator: 'AND' },
    }))
    expect((await queries.findOne(repo, U, 'QUERY-0001'))!.state.readOnly).toBe('legacy-sql')
  })
})
