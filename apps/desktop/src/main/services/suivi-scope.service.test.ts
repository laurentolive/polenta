import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GitService } from './git.service'
import { SavedQueriesService } from './saved-queries.service'
import { DashboardsService } from './dashboards.service'
import { SuiviScopeService } from './suivi-scope.service'

// GH67 — aperçus de changement de portée et partage d'un dashboard avec ses requêtes
// (specs/GH67-tests.md N1–N3, N8–N10, L2–L4, L6–L8, L11–L12).

let repo: string
let dashboards: DashboardsService
let queries: SavedQueriesService
let scope: SuiviScopeService
const U = 'alice'

const exists = (rel: string) => fs.existsSync(path.join(repo, rel))
const prefPath = () => path.join(repo, `.${U}.pref`)
const pref = () => JSON.parse(fs.readFileSync(prefPath(), 'utf8')) as Record<string, unknown> & {
  savedQueries?: { id: string }[]; dashboards?: { id: string }[]; dashboardsOrder?: string[]; queriesOrder?: string[]
  suiviWidgetParamValues?: Record<string, unknown>
}
const editPref = (fn: (p: ReturnType<typeof pref>) => void) => {
  const p = pref()
  fn(p)
  fs.writeFileSync(prefPath(), JSON.stringify(p, null, 2))
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gh67-scope-'))
  const git = new GitService()
  dashboards = new DashboardsService(git)
  queries = new SavedQueriesService(git, dashboards)
  scope = new SuiviScopeService(queries, dashboards)
})
afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(repo, { recursive: true, force: true })
})

const LIST = { id: 'filtered-list', params: { category: 'requirement', groupBy: ['status'] } }
const BAR = { id: 'bar', params: { category: 'status', measure: 'sum', measureColumn: 'count' } }

async function privateQuery(title: string) {
  return queries.create(repo, U, { title, scope: 'private', createdBy: U, template: LIST })
}
async function privateDashboard(title: string, queryIds: string[]) {
  const d = await dashboards.create(repo, U, { title, scope: 'private', createdBy: U })
  for (const [i, queryId] of queryIds.entries()) await dashboards.addWidget(repo, U, d.id, { title: `W${i + 1}`, queryId, size: 'md', template: BAR })
  return (await dashboards.get(repo, U, d.id))!
}

describe('GH67 — partage d\'un dashboard avec ses requêtes', () => {
  it('N1 / N2 — aperçu (requête utilisée deux fois listée une fois), puis partage groupé', async () => {
    const a = await privateQuery('A')
    const b = await privateQuery('B')
    const shared = await queries.create(repo, U, { title: 'S', scope: 'shared', createdBy: U, template: LIST })
    const d = await privateDashboard('Mon suivi', [a.id, b.id, a.id, shared.id])

    const preview = await scope.previewDashboardShare(repo, U, d.id)
    expect(preview.missing).toEqual([])
    expect(preview.queries.map((q) => [q.title, q.widgets.map((w) => w.widgetTitle), q.blockers])).toEqual([
      ['A', ['W1', 'W3'], []],
      ['B', ['W2'], []],
    ])
    expect(preview.queries.every((q) => q.remapped.length === 0)).toBe(true)

    const result = await scope.shareDashboardWithQueries(repo, U, d.id)
    expect(result.scope).toBe('shared')
    expect(result.id).toMatch(/^DASHBOARD-\d{4}$/)
    expect(exists(`dashboards/${result.id}/dashboard.yaml`)).toBe(true)
    const ids = result.widgets.map((w) => w.queryId)
    expect(ids.every((id) => /^QUERY-\d{4}$/.test(id))).toBe(true)
    expect(ids[0]).toBe(ids[2])
    expect(new Set(ids).size).toBe(3)
    for (const id of new Set(ids)) expect(exists(`queries/${id}/query.yaml`)).toBe(true)
    expect(pref().savedQueries ?? []).toEqual([])
    expect(pref().dashboards ?? []).toEqual([])
  })

  it('N3 — requête aussi utilisée par un autre dashboard privé : listée, remappée, l\'autre reste privé', async () => {
    const a = await privateQuery('A')
    const d = await privateDashboard('D1', [a.id])
    const other = await privateDashboard('D2', [a.id])
    const preview = await scope.previewDashboardShare(repo, U, d.id)
    expect(preview.queries[0].remapped.map((r) => [r.dashboardId, r.widgetTitle])).toEqual([[other.id, 'W1']])

    const result = await scope.shareDashboardWithQueries(repo, U, d.id)
    const after = (await dashboards.get(repo, U, other.id))!
    expect(after.scope).toBe('private')
    expect(after.widgets[0].queryId).toBe(result.widgets[0].queryId)
  })

  it('N9 — ordre du panneau et valeurs des sélecteurs des widgets (GH125) suivent le nouvel id', async () => {
    const a = await privateQuery('A')
    const d = await privateDashboard('D', [a.id, a.id])
    const before = await dashboards.create(repo, U, { title: 'Avant', scope: 'private', createdBy: U })
    await dashboards.setDashboardsOrder(repo, U, [before.id, d.id])
    await queries.setQueriesOrder(repo, U, [a.id])
    const [w1, w2] = d.widgets.map((w) => w.id)
    await dashboards.setParamValues(repo, U, d.id, w1, { 'campaign:campaign': 'CAMP-0002' })
    await dashboards.setParamValues(repo, U, d.id, w2, { 'campaign:campaign': null })
    await dashboards.setParamValues(repo, U, before.id, before.id, { 'campaign:campaign': 'CAMP-0001' })

    const result = await scope.shareDashboardWithQueries(repo, U, d.id)
    expect(pref().dashboardsOrder).toEqual([before.id, result.id])
    expect(pref().queriesOrder).toEqual([result.widgets[0].queryId])
    // Ids de widget conservés : valeurs propres à chaque widget, sous le nouvel id du dashboard.
    expect(result.widgets.map((w) => w.id)).toEqual([w1, w2])
    expect(await dashboards.getParamValues(repo, U, result.id)).toEqual({ [w1]: { 'campaign:campaign': 'CAMP-0002' }, [w2]: { 'campaign:campaign': null } })
    expect(pref().suiviWidgetParamValues?.[d.id]).toBeUndefined()
    expect(await dashboards.getParamValues(repo, U, before.id)).toEqual({ [before.id]: { 'campaign:campaign': 'CAMP-0001' } })
  })

  it('N10 — requête partagée seule d\'abord : le partage du dashboard ne la liste plus', async () => {
    const a = await privateQuery('A')
    const b = await privateQuery('B')
    const d = await privateDashboard('D', [a.id, b.id])
    await queries.setScope(repo, U, a.id, 'shared')
    const preview = await scope.previewDashboardShare(repo, U, d.id)
    expect(preview.queries.map((q) => q.title)).toEqual(['B'])
  })

  it('L2 / L3 / L4 — lecture seule, paramètres invalides, requête introuvable : refus sans écriture', async () => {
    const a = await privateQuery('A')
    const b = await privateQuery('B')
    const c = await privateQuery('C')
    const d = await privateDashboard('D', [a.id, b.id, c.id])
    editPref((p) => {
      const list = p.savedQueries as ({ id: string } & Record<string, unknown>)[]
      // A : requête SQL d'avant GH74 ; B : déclaration de paramètres modifiée à la main.
      list[0] = { id: a.id, title: 'A', mode: 'sql', sqlText: 'SELECT 1', createdBy: U, createdAt: '2026-01-01' }
      list[1] = { ...list[1], parameters: [{ name: 'x', kind: 'inconnu' }] }
      p.savedQueries = list.filter((q) => q.id !== c.id)
    })
    const before = fs.readFileSync(prefPath(), 'utf8')

    const preview = await scope.previewDashboardShare(repo, U, d.id)
    expect(preview.queries.map((q) => [q.title, q.blockers.map((x) => x.kind)])).toEqual([['A', ['read-only']], ['B', ['params']]])
    expect(preview.missing).toEqual([{ widgetId: d.widgets[2].id, widgetTitle: 'W3', queryId: c.id }])

    await expect(scope.shareDashboardWithQueries(repo, U, d.id)).rejects.toThrow(/^SCOPE_BLOCKED: .*"A".*"B".*W3/)
    expect(fs.readFileSync(prefPath(), 'utf8')).toBe(before)
    expect(exists('queries')).toBe(false)
    expect(exists('dashboards')).toBe(false)
  })

  it('L6 — titre déjà pris (casse, espaces) : signalé, partage possible, titres inchangés', async () => {
    const taken = await queries.create(repo, U, { title: 'Avancement', scope: 'shared', createdBy: U, template: LIST })
    const a = await privateQuery('  avancement ')
    const d = await privateDashboard('D', [a.id])
    expect((await scope.previewDashboardShare(repo, U, d.id)).queries[0].titleTakenBy).toEqual([taken.id])
    const result = await scope.shareDashboardWithQueries(repo, U, d.id)
    expect((await queries.findOne(repo, U, result.widgets[0].queryId))!.title).toBe('  avancement ')
    expect((await queries.findOne(repo, U, taken.id))!.title).toBe('Avancement')
  })

  it('L7 — échec à la 2e promotion : 1 partagée, le reste privé ; relance sans doublon', async () => {
    const qs = [await privateQuery('A'), await privateQuery('B'), await privateQuery('C')]
    const d = await privateDashboard('D', qs.map((q) => q.id))
    const real = queries.setScope.bind(queries)
    let calls = 0
    const spy = vi.spyOn(queries, 'setScope').mockImplementation(async (...args) => {
      calls += 1
      if (calls === 2) throw new Error('disque plein')
      return real(...args)
    })

    await expect(scope.shareDashboardWithQueries(repo, U, d.id)).rejects.toThrow(
      "SCOPE_PARTIAL: 1 requête(s) sur 3 partagée(s) ; le dashboard n'a pas été partagé : disque plein",
    )
    const mid = (await dashboards.get(repo, U, d.id))!
    expect(mid.scope).toBe('private')
    expect(mid.widgets[0].queryId).toMatch(/^QUERY-/)
    expect(mid.widgets.slice(1).map((w) => w.queryId)).toEqual([qs[1].id, qs[2].id])

    spy.mockRestore()
    expect((await scope.previewDashboardShare(repo, U, d.id)).queries.map((q) => q.title)).toEqual(['B', 'C'])
    const result = await scope.shareDashboardWithQueries(repo, U, d.id)
    expect(result.scope).toBe('shared')
    expect((await queries.list(repo, U)).filter((q) => q.scope === 'shared')).toHaveLength(3)
  })

  it('L6b — deux requêtes du lot au même titre : signalées entre elles', async () => {
    const a = await privateQuery('Couverture')
    const b = await privateQuery('couverture')
    const d = await privateDashboard('D', [a.id, b.id])
    const preview = await scope.previewDashboardShare(repo, U, d.id)
    expect(preview.queries.map((q) => q.titleTakenBy)).toEqual([[b.id], [a.id]])
  })

  it('L7b — échec à la 1re promotion : erreur initiale, rien de partagé', async () => {
    const a = await privateQuery('A')
    const d = await privateDashboard('D', [a.id])
    vi.spyOn(queries, 'setScope').mockRejectedValueOnce(new Error('disque plein'))
    await expect(scope.shareDashboardWithQueries(repo, U, d.id)).rejects.toThrow(/^disque plein$/)
    expect((await dashboards.get(repo, U, d.id))!.widgets[0].queryId).toBe(a.id)
  })

  it('dashboard déjà partagé : aperçu refusé', async () => {
    const d = await dashboards.create(repo, U, { title: 'P', scope: 'shared', createdBy: U })
    await expect(scope.previewDashboardShare(repo, U, d.id)).rejects.toThrow(/déjà partagé/)
  })

  it('L12 — dashboard en lecture seule : aperçu refusé', async () => {
    fs.mkdirSync(path.join(repo, 'dashboards/DASHBOARD-0001'), { recursive: true })
    fs.writeFileSync(path.join(repo, 'dashboards/DASHBOARD-0001/dashboard.yaml'), 'id: DASHBOARD-0001\ntitle: Futur\nformatVersion: 99\nwidgets: []\nwidgetOrder: []\ncreatedBy: x\ncreatedAt: "2026-01-01"\n')
    await expect(scope.previewDashboardShare(repo, U, 'DASHBOARD-0001')).rejects.toThrow(/SUIVI_READ_ONLY/)
  })
})

describe('GH67 — portée d\'une requête seule', () => {
  it('promotion : autres dashboards privés à remapper, titre pris', async () => {
    const taken = await queries.create(repo, U, { title: 'A', scope: 'shared', createdBy: U, template: LIST })
    const a = await privateQuery('A')
    const d = await privateDashboard('D', [a.id])
    const preview = await scope.previewQueryScope(repo, U, a.id, 'shared')
    expect(preview).toMatchObject({ from: 'private', to: 'shared', blockers: [], titleTakenBy: [taken.id], columnRemoved: null })
    expect(preview.remapped.map((r) => r.dashboardId)).toEqual([d.id])
  })

  it('L8 — rétrogradation d\'une requête utilisée : bloquant listant les widgets', async () => {
    const q = await queries.create(repo, U, { title: 'Q', scope: 'shared', createdBy: U, template: LIST })
    const d = await dashboards.create(repo, U, { title: 'Partagé', scope: 'shared', createdBy: U })
    await dashboards.addWidget(repo, U, d.id, { title: 'W', queryId: q.id, size: 'md', template: BAR })
    const preview = await scope.previewQueryScope(repo, U, q.id, 'private')
    expect(preview.blockers).toEqual([{ kind: 'dependents', widgets: [expect.objectContaining({ dashboardId: d.id, dashboardScope: 'shared', widgetTitle: 'W' })] }])
  })

  it('N8 — rétrogradation d\'une requête avec colonne : colonne annoncée, puis retirée', async () => {
    const q = await queries.create(repo, U, {
      title: 'Col', scope: 'shared', createdBy: U,
      script: 'export default (data) => data.requirements.map((r) => ({ id: r.id, value: 1 }))\n',
      column: { label: 'Score', appliesTo: { categories: ['requirement'], objectTypes: [] }, type: 'number' },
    })
    const preview = await scope.previewQueryScope(repo, U, q.id, 'private')
    expect(preview).toMatchObject({ blockers: [], columnRemoved: 'Score' })
    const moved = await queries.setScope(repo, U, q.id, 'private')
    expect(moved.column).toBeNull()
    expect(exists(`queries/${q.id}`)).toBe(false)
  })

  it('L11 — même portée : aucun bloquant, listes vides', async () => {
    const a = await privateQuery('A')
    expect(await scope.previewQueryScope(repo, U, a.id, 'private')).toEqual({
      queryId: a.id, title: 'A', from: 'private', to: 'private', blockers: [], remapped: [], titleTakenBy: [], columnRemoved: null,
    })
  })

  it('portée invalide : refusée (aperçu et écriture)', async () => {
    const a = await privateQuery('A')
    await expect(scope.previewQueryScope(repo, U, a.id, 'foo' as never)).rejects.toThrow(/Portée invalide/)
    await expect(queries.setScope(repo, U, a.id, 'foo' as never)).rejects.toThrow(/Portée invalide/)
    expect((await queries.findOne(repo, U, a.id))!.scope).toBe('private')
  })

  it('setScope applique les gardes de l’aperçu (scopeBlockers) : paramètres, dépendants', async () => {
    const a = await privateQuery('A')
    editPref((p) => {
      p.savedQueries = (p.savedQueries as ({ id: string } & Record<string, unknown>)[]).map((q) => (q.id === a.id ? { ...q, parameters: [{ name: 'x', kind: 'inconnu' }] } : q))
    })
    expect((await scope.previewQueryScope(repo, U, a.id, 'shared')).blockers.map((b) => b.kind)).toEqual(['params'])
    await expect(queries.setScope(repo, U, a.id, 'shared')).rejects.toThrow(/PARAMS_INVALID|param/i)

    const q = await queries.create(repo, U, { title: 'Q', scope: 'shared', createdBy: U, template: LIST })
    const d = await dashboards.create(repo, U, { title: 'D', scope: 'shared', createdBy: U })
    await dashboards.addWidget(repo, U, d.id, { title: 'W', queryId: q.id, size: 'md', template: BAR })
    await expect(queries.setScope(repo, U, q.id, 'private')).rejects.toThrow(/repasser en privé cette requête : utilisée par 1 widget/)
    expect(exists(`queries/${q.id}/query.yaml`)).toBe(true)
  })

  it('requête introuvable : erreur', async () => {
    await expect(scope.previewQueryScope(repo, U, 'local-x', 'shared')).rejects.toThrow(/introuvable/)
  })
})
