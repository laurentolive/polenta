import { describe, expect, it } from 'vitest'
import type { Dashboard, QueryScope, SavedQuery } from '@polenta/types'
import { DashboardSeedService, CAMPAIGN_SEED_QUERIES, seedLocale } from './dashboard-seed.service'
import type { CampaignsSeedMarker, CampaignsSeedMarkerStore } from './dashboard-seed.service'
import type { GitService } from './git.service'
import type { DashboardsService } from './dashboards.service'
import type { SavedQueriesService } from './saved-queries.service'

// GH65 — seed « Campagnes » : privé (rien dans le repo), indépendant du seed historique, une fois
// par utilisateur, reprise sans doublon.

const REPO = '/ws/produit'

function fixture(opts: { branch?: string; failOnQuery?: number; legacySeeded?: boolean } = {}) {
  const files = new Map<string, unknown>()
  if (opts.legacySeeded) files.set('dashboards/.seeded.yaml', { seededAt: 'x' })
  const repoWrites: string[] = []
  const queries = new Map<string, SavedQuery>()
  const dashboards = new Map<string, Dashboard>()
  const markers = new Map<string, CampaignsSeedMarker>()
  let failCountdown = opts.failOnQuery ?? -1
  let seq = 0

  const git = {
    readYaml: async (_r: string, p: string) => structuredClone(files.get(p) ?? null),
    writeYaml: async (_r: string, p: string, v: unknown) => { repoWrites.push(p); files.set(p, structuredClone(v)) },
    currentBranch: async () => opts.branch ?? 'main',
    readYamlDir: async () => [...dashboards.values()].filter(d => d.scope === 'shared'),
  } as unknown as GitService

  const savedQueries = {
    create: async (_r: string, _u: string, dto: { title: string; template: unknown; scope: QueryScope }) => {
      if (failCountdown === 0) { failCountdown = -1; throw new Error('disque plein') }
      if (failCountdown > 0) failCountdown--
      const q = { id: `Q-${++seq}`, ...dto } as unknown as SavedQuery
      queries.set(q.id, q)
      return q
    },
    findOne: async (_r: string, _u: string, id: string) => queries.get(id) ?? null,
  } as unknown as SavedQueriesService

  const dashboardsSvc = {
    get: async (_r: string, _u: string, id: string) => dashboards.get(id) ?? null,
    create: async (_r: string, _u: string, dto: { title: string; scope: QueryScope }) => {
      const d = { id: `D-${++seq}`, title: dto.title, scope: dto.scope, widgets: [], widgetOrder: [] } as unknown as Dashboard
      dashboards.set(d.id, d)
      return d
    },
    addWidget: async (_r: string, _u: string, id: string, dto: { title: string; queryId: string }) => {
      const d = dashboards.get(id)!
      d.widgets.push({ id: `w${d.widgets.length}`, ...dto } as never)
      return d
    },
  } as unknown as DashboardsService

  const markerStore: CampaignsSeedMarkerStore = {
    read: (r, u) => structuredClone(markers.get(`${r}|${u}`) ?? null),
    write: (r, u, m) => { markers.set(`${r}|${u}`, structuredClone(m)) },
  }

  const service = new DashboardSeedService(git, dashboardsSvc, savedQueries, markerStore)
  return { service, queries, dashboards, repoWrites, marker: (u = 'alice') => markers.get(`${REPO}|${u}`) }
}

const campaignDashboards = (ds: Map<string, Dashboard>) => [...ds.values()].filter(d => d.title === 'Campagnes' || d.title === 'Campaigns')

describe('GH65 — seed « Campagnes »', () => {
  it('1.7 — projet déjà seedé (Status) : dashboard + 5 requêtes privés, marqueur done, rien dans le repo', async () => {
    const f = fixture({ legacySeeded: true })
    await f.service.ensureSeeded(REPO, 'alice')
    const [d] = campaignDashboards(f.dashboards)
    expect(d.scope).toBe('private')
    expect(d.widgets.map(w => w.template?.id)).toEqual(['bar', 'kpi', 'kpi', 'line', 'table'])
    expect(f.queries.size).toBe(CAMPAIGN_SEED_QUERIES.length)
    expect([...f.queries.values()].every(q => q.scope === 'private')).toBe(true)
    expect(new Set(d.widgets.map(w => w.queryId))).toEqual(new Set(f.queries.keys()))
    expect(f.marker()).toMatchObject({ state: 'done' })
    expect(f.repoWrites).toEqual([])
  })

  it('projet neuf : seed historique (partagé) puis Campagnes (privé)', async () => {
    const f = fixture()
    await f.service.ensureSeeded(REPO, 'alice')
    expect([...f.dashboards.values()].map(d => [d.title, d.scope])).toEqual([['Status', 'shared'], ['Campagnes', 'private']])
  })

  it('un marqueur par utilisateur : chacun reçoit le sien', async () => {
    const f = fixture({ legacySeeded: true })
    await f.service.ensureSeeded(REPO, 'alice')
    await f.service.ensureSeeded(REPO, 'bob')
    expect(campaignDashboards(f.dashboards)).toHaveLength(2)
    expect(f.marker('bob')).toMatchObject({ state: 'done' })
  })

  it('1.8 — libellés anglais', async () => {
    const f = fixture({ legacySeeded: true })
    await f.service.ensureSeeded(REPO, 'alice', 'en-US')
    expect(campaignDashboards(f.dashboards)[0].title).toBe('Campaigns')
    expect(seedLocale('de')).toBe('fr')
    expect(seedLocale(undefined)).toBe('fr')
  })

  it('1.9 — supprimé puis Suivi rouvert : jamais recréé', async () => {
    const f = fixture({ legacySeeded: true })
    await f.service.ensureSeeded(REPO, 'alice')
    f.dashboards.clear()
    await f.service.ensureSeeded(REPO, 'alice')
    expect(f.dashboards.size).toBe(0)
  })

  it('1.26 — échec après 2 requêtes (non bloquant) puis relance : aucun doublon', async () => {
    const f = fixture({ legacySeeded: true, failOnQuery: 2 })
    await f.service.ensureSeeded(REPO, 'alice') // échec journalisé, dashboards:list non bloqué
    expect(f.queries.size).toBe(2)
    expect(f.marker()).toMatchObject({ state: 'partial' })
    await f.service.ensureSeeded(REPO, 'alice')
    expect(f.queries.size).toBe(CAMPAIGN_SEED_QUERIES.length)
    expect(campaignDashboards(f.dashboards)).toHaveLength(1)
    expect(campaignDashboards(f.dashboards)[0].widgets).toHaveLength(5)
    expect(f.marker()).toMatchObject({ state: 'done' })
  })

  it('1.27 — branche en lecture seule : seed privé quand même (rien dans le repo), seed historique sauté', async () => {
    const f = fixture({ branch: 'prj-v1' })
    await f.service.ensureSeeded(REPO, 'alice')
    expect([...f.dashboards.values()].map(d => d.title)).toEqual(['Campagnes'])
    expect(f.repoWrites).toEqual([])
  })

  it('1.28 — deux appels simultanés : un seul dashboard', async () => {
    const f = fixture({ legacySeeded: true })
    await Promise.all([f.service.ensureSeeded(REPO, 'alice'), f.service.ensureSeeded(REPO, 'alice')])
    expect(campaignDashboards(f.dashboards)).toHaveLength(1)
  })
})
