import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GitService } from './git.service'
import { SavedQueriesService } from './saved-queries.service'
import { DashboardsService } from './dashboards.service'
import { DashboardLibraryService, contentHash } from './dashboard-library.service'
import { DashboardSeedService, type CampaignsSeedMarker } from './dashboard-seed.service'
import { SuiviUpdatesService } from './suivi-updates.service'

// GH74 sprint 3 — copie de la bibliothèque de départ, bandeau des mises à jour, seeds (specs/GH74.md
// §6.2, §6.3, §8).

const U = 'alice'
let repo: string
let shipped: string

const write = (root: string, rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  fs.writeFileSync(path.join(root, rel), content)
}
const exists = (rel: string) => fs.existsSync(path.join(repo, rel))
const read = (rel: string) => fs.readFileSync(path.join(repo, rel), 'utf8')

const OLD = '// @polenta-lib campaign 1\nexport const v = 1\n'
const NEW = '// @polenta-lib campaign 2\nexport const v = 2\n'
const TIME = '// @polenta-lib time 1\nexport const t = 1\n'

/** Bibliothèque livrée de test : `campaign.js` en deux versions, `time.js` en une. */
function shipLibrary(): void {
  write(shipped, 'campaign.js', NEW)
  write(shipped, 'time.js', TIME)
  write(shipped, 'manifest.json', JSON.stringify({
    files: [
      { path: 'campaign.js', repoPath: 'dashboards/lib/campaign.js', id: 'campaign', versions: [
        { version: 1, hash: contentHash(OLD), summary: { fr: 'v1', en: 'v1' } },
        { version: 2, hash: contentHash(NEW), summary: { fr: 'Correction du repli GH73.', en: 'GH73 fallback fix.' } },
      ] },
      { path: 'time.js', repoPath: 'dashboards/lib/time.js', id: 'time', versions: [{ version: 1, hash: contentHash(TIME), summary: { fr: 'v1', en: 'v1' } }] },
    ],
  }))
}

function setup(branch = 'main', campaignsMarker: CampaignsSeedMarker | null = null) {
  const git = new GitService()
  vi.spyOn(git, 'currentBranch').mockResolvedValue(branch)
  const dashboards = new DashboardsService(git)
  const queries = new SavedQueriesService(git, dashboards)
  const library = new DashboardLibraryService(git, undefined, () => shipped)
  let marker = campaignsMarker
  const store = { read: () => marker, write: (_r: string, _u: string, m: CampaignsSeedMarker) => { marker = m } }
  const seed = new DashboardSeedService(git, dashboards, queries, store, library)
  const updates = new SuiviUpdatesService(git, library, seed, queries, dashboards)
  return { git, dashboards, queries, library, seed, updates, marker: () => marker }
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gh74-updates-'))
  shipped = fs.mkdtempSync(path.join(os.tmpdir(), 'gh74-shipped-'))
  shipLibrary()
})
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true })
  fs.rmSync(shipped, { recursive: true, force: true })
})

describe('GH74 — copie de la bibliothèque de départ (§6.2)', () => {
  it('B1 — premier accès : copiée et notée dans le marqueur ; un fichier supprimé n\'est pas recréé', async () => {
    const { seed, updates } = setup()
    await seed.ensureSeeded(repo, U)
    expect(read('dashboards/lib/campaign.js')).toBe(NEW)
    expect(read('dashboards/lib/time.js')).toBe(TIME)
    expect(yaml.load(read('dashboards/.seeded.yaml'))).toMatchObject({
      seededAt: expect.any(String), library: ['dashboards/lib/campaign.js', 'dashboards/lib/time.js'], dashboardId: 'DASHBOARD-0001',
    })

    fs.rmSync(path.join(repo, 'dashboards/lib/time.js'))
    await seed.ensureSeeded(repo, U)
    expect(exists('dashboards/lib/time.js')).toBe(false)
    expect((await updates.list(repo, U)).updates.filter((u) => u.kind === 'library')).toEqual([])
  })

  it('B2 — branche en lecture seule : rien n\'est copié', async () => {
    const { seed } = setup('prj-v1')
    await seed.ensureSeeded(repo, U)
    expect(exists('dashboards/lib')).toBe(false)
  })

  it('B3 — `dashboards/lib/` déjà présent sans marqueur : rien n\'est écrasé, les fichiers livrés sont proposés', async () => {
    write(repo, 'dashboards/lib/mesures.js', 'export const m = 1\n')
    const { seed, updates } = setup()
    await seed.ensureSeeded(repo, U)
    expect(exists('dashboards/lib/campaign.js')).toBe(false)
    const lib = (await updates.list(repo, U)).updates.filter((u) => u.kind === 'library')
    expect(lib.map((u) => [u.id, u.fromVersion, u.toVersion])).toEqual([
      ['library:dashboards/lib/campaign.js', undefined, 2], ['library:dashboards/lib/time.js', undefined, 1],
    ])
  })
})

describe('GH74 — bandeau des mises à jour (§6.3)', () => {
  it('M1 — version livrée antérieure proposée ; fichier modifié jamais ; Appliquer écrit la nouvelle version', async () => {
    write(repo, 'dashboards/.seeded.yaml', yaml.dump({ seededAt: 'x', library: ['dashboards/lib/campaign.js', 'dashboards/lib/time.js'] }))
    write(repo, 'dashboards/lib/campaign.js', OLD.replace(/\n/g, '\r\n'))
    write(repo, 'dashboards/lib/time.js', TIME + '// modifié par le projet\n')
    const { updates } = setup()
    const list = await updates.list(repo, U)
    expect(list.readOnly).toBe(false)
    expect(list.updates).toEqual([{
      id: 'library:dashboards/lib/campaign.js', kind: 'library', title: 'dashboards/lib/campaign.js',
      fromVersion: 1, toVersion: 2, summary: { fr: 'Correction du repli GH73.', en: 'GH73 fallback fix.' }, shared: true,
    }])
    await updates.apply(repo, U, ['library:dashboards/lib/campaign.js'])
    expect(read('dashboards/lib/campaign.js')).toBe(NEW)
    expect(read('dashboards/lib/time.js')).toContain('modifié par le projet')
    expect((await updates.list(repo, U)).updates).toEqual([])
  })

  it('M2 — Ignorer masque cette version pour l\'utilisateur seulement', async () => {
    write(repo, 'dashboards/.seeded.yaml', yaml.dump({ seededAt: 'x', library: ['dashboards/lib/campaign.js', 'dashboards/lib/time.js'] }))
    write(repo, 'dashboards/lib/campaign.js', OLD)
    const { updates } = setup()
    updates.ignore(repo, U, 'library:dashboards/lib/campaign.js', 2)
    expect((await updates.list(repo, U)).updates).toEqual([])
    expect((await updates.list(repo, 'bob')).updates).toHaveLength(1)
  })

  it('M3 — branche en lecture seule : proposée, non applicable', async () => {
    write(repo, 'dashboards/.seeded.yaml', yaml.dump({ seededAt: 'x', library: ['dashboards/lib/campaign.js', 'dashboards/lib/time.js'] }))
    write(repo, 'dashboards/lib/campaign.js', OLD)
    const { updates } = setup('prj-v1')
    const list = await updates.list(repo, U)
    expect(list).toMatchObject({ readOnly: true, updates: [{ id: 'library:dashboards/lib/campaign.js' }] })
    await expect(updates.apply(repo, U, ['library:dashboards/lib/campaign.js'])).rejects.toThrow('SUIVI_READ_ONLY')
    expect(read('dashboards/lib/campaign.js')).toBe(OLD)
  })

  it('M5 — liste périmée (identifiant inconnu) : rien n\'est appliqué', async () => {
    write(repo, 'dashboards/.seeded.yaml', yaml.dump({ seededAt: 'x', library: ['dashboards/lib/campaign.js', 'dashboards/lib/time.js'] }))
    write(repo, 'dashboards/lib/campaign.js', OLD)
    const { updates } = setup()
    await expect(updates.apply(repo, U, ['library:dashboards/lib/campaign.js', 'template:query:QUERY-0404'])).rejects.toThrow('rien n\'a été appliqué')
    expect(read('dashboards/lib/campaign.js')).toBe(OLD)
  })

  it('M4 — nouveau fichier livré appliqué : noté au marqueur (supprimé ensuite, plus proposé)', async () => {
    write(repo, 'dashboards/.seeded.yaml', yaml.dump({ seededAt: 'x', library: ['dashboards/lib/campaign.js'] }))
    write(repo, 'dashboards/lib/campaign.js', NEW)
    const { updates } = setup()
    expect((await updates.list(repo, U)).updates.map((u) => u.id)).toEqual(['library:dashboards/lib/time.js'])
    await updates.apply(repo, U, ['library:dashboards/lib/time.js'])
    fs.rmSync(path.join(repo, 'dashboards/lib/time.js'))
    expect((await updates.list(repo, U)).updates).toEqual([])
  })
})

describe('GH74 — seed « Campagnes » (§8)', () => {
  it('S1 — nouveau seed : « Avancement par campagne » sur entryStep, « Avancement dans le temps » ajouté', async () => {
    const { seed, dashboards, queries, marker } = setup()
    await seed.ensureSeeded(repo, U)
    const m = marker()!
    expect(m.state).toBe('done')
    const d = (await dashboards.get(repo, U, m.dashboardId!))!
    const byTitle = new Map(d.widgets.map((w) => [w.title, w]))
    expect(byTitle.get('Avancement par campagne')!.template).toMatchObject({ id: 'bar', params: { series: 'stepLabel', seriesOrder: 'stepRank' } })
    expect(byTitle.get('Avancement dans le temps')!.template).toMatchObject({ id: 'stacked-area', params: { x: 'date', series: 'status', value: 'count' } })
    const progress = (await queries.findOne(repo, U, m.queries!.progress!))!
    expect(progress.script).toContain("import { entryStep, stepContext, stepLabel, stepRank } from 'lib/campaign.js'")
    const timeline = (await queries.findOne(repo, U, m.queries!.timeline!))!
    expect(timeline.template).toMatchObject({ id: 'campaign-timeline', params: { campaignStatuses: ['in_progress'] } })
  })

  it('S2 — seed existant sans le widget : proposé dans le bandeau, ajouté sur Appliquer', async () => {
    const before = setup()
    const q = await before.queries.create(repo, U, { title: 'Campagnes — avancement', scope: 'private', createdBy: U, template: { id: 'campaign-entries', params: {} } })
    const d = await before.dashboards.create(repo, U, { title: 'Campagnes', scope: 'private', createdBy: U })
    const { updates, dashboards, marker } = setup('main', { state: 'done', dashboardId: d.id, queries: { progress: q.id } })
    const seedWidgets = async () => (await updates.list(repo, U)).updates.filter((u) => u.kind !== 'library')
    expect(await seedWidgets()).toEqual([expect.objectContaining({ id: 'seed-widget:timeline', kind: 'seed-widget', title: 'Campagnes', toVersion: 1, shared: false })])
    await updates.apply(repo, U, ['seed-widget:timeline'], 'fr')
    expect((await dashboards.get(repo, U, d.id))!.widgets.map((w) => w.title)).toEqual(['Avancement dans le temps'])
    expect(marker()!.queries!.timeline).toBeTruthy()
    expect(await seedWidgets()).toEqual([])
  })

  it('S2b — ajout du widget en échec : pas de requête orpheline, toujours proposé', async () => {
    const before = setup()
    const d = await before.dashboards.create(repo, U, { title: 'Campagnes', scope: 'private', createdBy: U })
    const { updates, dashboards, queries, marker } = setup('main', { state: 'done', dashboardId: d.id, queries: {} })
    vi.spyOn(dashboards, 'addWidget').mockRejectedValueOnce(new Error('disque plein'))
    await expect(updates.apply(repo, U, ['seed-widget:timeline'], 'fr')).rejects.toThrow('disque plein')
    expect(await queries.list(repo, U)).toEqual([])
    expect(marker()!.queries).toEqual({})
    expect((await updates.list(repo, U)).updates.map((u) => u.id)).toContain('seed-widget:timeline')
  })

  it('S3 — dashboard « Campagnes » supprimé : rien n\'est proposé', async () => {
    const { updates } = setup('main', { state: 'done', dashboardId: 'local-404', queries: {} })
    expect((await updates.list(repo, U)).updates.filter((u) => u.kind !== 'library')).toEqual([])
  })
})
