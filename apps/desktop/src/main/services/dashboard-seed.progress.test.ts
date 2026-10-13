import { describe, expect, it } from 'vitest'
import type { Dashboard, QueryScope, SavedQuery, Widget, WidgetFieldMapping } from '@polenta/types'
import {
  DashboardSeedService, GH65_PROGRESS_MAPPING, GH65_PROGRESS_SQL, PROGRESS_MAPPING, PROGRESS_SQL,
} from './dashboard-seed.service'
import type { CampaignsSeedMarker, CampaignsSeedMarkerStore } from './dashboard-seed.service'
import type { GitService } from './git.service'
import type { DashboardsService } from './dashboards.service'
import type { SavedQueriesService } from './saved-queries.service'

// GH71 — seed « Campagnes » : widget « Avancement par campagne » sur les étapes d'avancement, et
// mise à niveau des seeds GH65 déjà créés (scénarios D1–D8 de specs/GH71-tests.md).

const REPO = '/ws/produit'

function fixture() {
  const queries = new Map<string, SavedQuery>()
  const dashboards = new Map<string, Dashboard>()
  const markers = new Map<string, CampaignsSeedMarker>()
  const writes: string[] = []
  let failUpdates = false
  let failWidgetUpdates = false
  let seq = 0

  const git = {
    readYaml: async (_r: string, p: string) => (p === 'dashboards/.seeded.yaml' ? { seededAt: 'x' } : null),
    writeYaml: async () => undefined,
    currentBranch: async () => 'main',
    readYamlDir: async () => [],
  } as unknown as GitService

  const savedQueries = {
    create: async (_r: string, _u: string, dto: { title: string; mode: 'sql'; sqlText: string; scope: QueryScope }) => {
      const q = { id: `Q-${++seq}`, ...dto } as unknown as SavedQuery
      queries.set(q.id, q)
      return q
    },
    findOne: async (_r: string, _u: string, id: string) => queries.get(id) ?? null,
    list: async () => [...queries.values()].map(q => structuredClone(q)),
    update: async (_r: string, _u: string, id: string, dto: Partial<SavedQuery>) => {
      if (failUpdates) throw new Error('disque plein')
      writes.push(`query:${id}`)
      const q = { ...queries.get(id)!, ...dto }
      queries.set(id, q)
      return q
    },
  } as unknown as SavedQueriesService

  const dashboardsSvc = {
    get: async (_r: string, _u: string, id: string) => dashboards.get(id) ?? null,
    list: async () => [...dashboards.values()].map(d => structuredClone(d)),
    create: async (_r: string, _u: string, dto: { title: string; scope: QueryScope }) => {
      const d = { id: `D-${++seq}`, title: dto.title, scope: dto.scope, widgets: [], widgetOrder: [] } as unknown as Dashboard
      dashboards.set(d.id, d)
      return d
    },
    addWidget: async (_r: string, _u: string, id: string, dto: Omit<Widget, 'id'>) => {
      const d = dashboards.get(id)!
      d.widgets.push({ id: `w${d.widgets.length}`, ...dto })
      return d
    },
    updateWidget: async (_r: string, _u: string, id: string, widgetId: string, dto: Partial<Widget>) => {
      if (failWidgetUpdates) throw new Error('pref verrouillé')
      writes.push(`widget:${widgetId}`)
      const d = dashboards.get(id)!
      d.widgets = d.widgets.map(w => (w.id === widgetId ? { ...w, ...dto } : w))
      return d
    },
  } as unknown as DashboardsService

  const markerStore: CampaignsSeedMarkerStore = {
    read: (r, u) => structuredClone(markers.get(`${r}|${u}`) ?? null),
    write: (r, u, m) => { markers.set(`${r}|${u}`, structuredClone(m)) },
  }

  /** État laissé par un seed GH65 terminé : requête et widget d'origine, marqueur `done` sans ids. */
  function seedGh65(opts: { sql?: string; mapping?: WidgetFieldMapping; scope?: QueryScope; withWidget?: boolean } = {}) {
    const q = { id: 'Q-OLD', title: 'Campagnes — avancement par statut', mode: 'sql', sqlText: opts.sql ?? GH65_PROGRESS_SQL, scope: opts.scope ?? 'private' } as SavedQuery
    queries.set(q.id, q)
    const d = { id: 'D-OLD', title: 'Campagnes', scope: 'private', widgetOrder: [], widgets: [] } as unknown as Dashboard
    if (opts.withWidget !== false) {
      d.widgets.push({ id: 'w-old', title: 'Avancement par campagne', queryId: q.id, type: 'bar', fieldMapping: opts.mapping ?? { ...GH65_PROGRESS_MAPPING }, size: 'lg' })
    }
    dashboards.set(d.id, d)
    markers.set(`${REPO}|alice`, { state: 'done', seededAt: '2026-10-12T00:00:00.000Z' })
  }

  const service = new DashboardSeedService(git, dashboardsSvc, savedQueries, markerStore)
  return {
    service, queries, dashboards, writes, seedGh65,
    failUpdates: (v: boolean) => { failUpdates = v },
    failWidgetUpdates: (v: boolean) => { failWidgetUpdates = v },
    markers,
    marker: () => markers.get(`${REPO}|alice`),
    oldQuery: () => queries.get('Q-OLD')!,
    oldWidget: () => dashboards.get('D-OLD')!.widgets[0],
  }
}

describe('GH71 — seed « Campagnes » : avancement', () => {
  it('D1 — seed neuf : nouvelle requête et préréglage, ids conservés, mise à niveau sans objet', async () => {
    const f = fixture()
    await f.service.ensureSeeded(REPO, 'alice')
    const progress = [...f.queries.values()].find(q => q.sqlText === PROGRESS_SQL)
    expect(progress).toBeDefined()
    const [d] = [...f.dashboards.values()]
    expect(d.widgets.find(w => w.queryId === progress!.id)?.fieldMapping).toEqual(PROGRESS_MAPPING)
    expect(f.marker()).toMatchObject({ state: 'done', dashboardId: d.id, upgrades: ['progressV2'] })
    expect(f.marker()?.queries?.progress).toBe(progress!.id)
    expect(f.writes).toEqual([])
  })

  it('D2 — seed GH65 intact : requête et widget mis à niveau ; titre d’origine de la requête actualisé', async () => {
    const f = fixture()
    f.seedGh65()
    await f.service.ensureSeeded(REPO, 'alice')
    expect(f.oldQuery()).toMatchObject({ sqlText: PROGRESS_SQL, title: 'Campagnes — avancement' })
    expect(f.oldWidget()).toMatchObject({ fieldMapping: PROGRESS_MAPPING, title: 'Avancement par campagne' })
    expect(f.marker()?.upgrades).toEqual(['progressV2'])
  })

  it('D3 — SQL modifié par l\'utilisateur : rien n\'est touché', async () => {
    const f = fixture()
    f.seedGh65({ sql: `${GH65_PROGRESS_SQL} ORDER BY [campaignTitle]` })
    await f.service.ensureSeeded(REPO, 'alice')
    expect(f.writes).toEqual([])
    expect(f.oldWidget().fieldMapping).toEqual(GH65_PROGRESS_MAPPING)
    expect(f.marker()?.upgrades).toEqual(['progressV2'])
  })

  it('D4 — requête intacte, widget modifié : ni la requête ni le widget', async () => {
    const f = fixture()
    f.seedGh65({ mapping: { ...GH65_PROGRESS_MAPPING, stacked: false } })
    await f.service.ensureSeeded(REPO, 'alice')
    expect(f.writes).toEqual([])
    expect(f.oldQuery().sqlText).toBe(GH65_PROGRESS_SQL)
  })

  it('D5 — requête intacte sans widget : requête mise à niveau', async () => {
    const f = fixture()
    f.seedGh65({ withWidget: false })
    await f.service.ensureSeeded(REPO, 'alice')
    expect(f.writes).toEqual(['query:Q-OLD'])
  })

  it('D6 — requête passée en partagé : non touchée', async () => {
    const f = fixture()
    f.seedGh65({ scope: 'shared' })
    await f.service.ensureSeeded(REPO, 'alice')
    expect(f.writes).toEqual([])
  })

  it('D7 — deuxième appel : aucune écriture', async () => {
    const f = fixture()
    f.seedGh65()
    await f.service.ensureSeeded(REPO, 'alice')
    f.writes.length = 0
    f.oldQuery().sqlText = GH65_PROGRESS_SQL // même si une requête d'origine réapparaît
    await f.service.ensureSeeded(REPO, 'alice')
    expect(f.writes).toEqual([])
  })

  it('D8 — échec d\'écriture : non bloquant, marqueur non posé, retenté au prochain appel', async () => {
    const f = fixture()
    f.seedGh65()
    f.failUpdates(true)
    await expect(f.service.ensureSeeded(REPO, 'alice')).resolves.toBeUndefined()
    expect(f.marker()?.upgrades).toBeUndefined()
    f.failUpdates(false)
    await f.service.ensureSeeded(REPO, 'alice')
    expect(f.oldQuery().sqlText).toBe(PROGRESS_SQL)
    expect(f.marker()?.upgrades).toEqual(['progressV2'])
  })

  it('D9 — échec sur le widget après la requête : la reprise termine le widget', async () => {
    const f = fixture()
    f.seedGh65()
    f.failWidgetUpdates(true)
    await f.service.ensureSeeded(REPO, 'alice')
    expect(f.oldQuery().sqlText).toBe(PROGRESS_SQL)
    expect(f.oldWidget().fieldMapping).toEqual(GH65_PROGRESS_MAPPING)
    expect(f.marker()?.upgrades).toBeUndefined()
    f.failWidgetUpdates(false)
    await f.service.ensureSeeded(REPO, 'alice')
    expect(f.oldWidget().fieldMapping).toEqual(PROGRESS_MAPPING)
    expect(f.marker()?.upgrades).toEqual(['progressV2'])
  })

  it('D10 — seed GH65 interrompu (requête d’origine créée) repris : requête remise à niveau', async () => {
    const f = fixture()
    f.queries.set('Q-OLD', { id: 'Q-OLD', title: 'Campagnes — avancement par statut', mode: 'sql', sqlText: GH65_PROGRESS_SQL, scope: 'private' } as SavedQuery)
    f.markers.set(`${REPO}|alice`, { state: 'partial', queries: { progress: 'Q-OLD' }, widgets: [] })
    await f.service.ensureSeeded(REPO, 'alice')
    expect(f.oldQuery().sqlText).toBe(PROGRESS_SQL)
    const [d] = [...f.dashboards.values()]
    expect(d.widgets.find(w => w.queryId === 'Q-OLD')?.fieldMapping).toEqual(PROGRESS_MAPPING)
    expect(f.marker()).toMatchObject({ state: 'done', upgrades: ['progressV2'] })
  })
})
