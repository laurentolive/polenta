import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GitService } from './git.service'
import { DashboardsService } from './dashboards.service'

// GH435 — dimensions des widgets : lecture, bornage, écriture (specs/GH435-tests.md U6 à U10).

let repo: string
let dashboards: DashboardsService
const U = 'alice'
const Q = 'QUERY-0001'

const write = (rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true })
  fs.writeFileSync(path.join(repo, rel), content)
}
const read = (rel: string) => fs.readFileSync(path.join(repo, rel), 'utf8')
const sharedYaml = (id: string) => yaml.load(read(`dashboards/${id}/dashboard.yaml`)) as { widgets: Array<Record<string, unknown>> }
const privateWidgets = () => (JSON.parse(read(`.${U}.pref`)) as { dashboards: Array<{ widgets: Array<Record<string, unknown>> }> }).dashboards[0].widgets

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gh435-dash-'))
  dashboards = new DashboardsService(new GitService())
})
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }))

const SPEC = '{ "data": { "name": "rows" }, "mark": "bar" }'
const shared = () => dashboards.create(repo, U, { title: 'Suivi', scope: 'shared', createdBy: U })

describe('U6 — lecture d\'un dashboard', () => {
  const folder = (widgets: unknown[]) => write('dashboards/DASHBOARD-0001/dashboard.yaml', yaml.dump({
    id: 'DASHBOARD-0001', title: 'D', formatVersion: 1, widgetOrder: ['a', 'b', 'c', 'd'], createdBy: 'x', createdAt: '2026-01-01T00:00:00Z', widgets,
  }))

  it('dimensions valides lues ; hors bornes ramenées ; non numériques ignorées ; absentes absentes', async () => {
    folder([
      { id: 'a', title: 'A', queryId: Q, size: 'md', width: 700, height: 320 },
      { id: 'b', title: 'B', queryId: Q, size: 'md', width: 5000, height: 10 },
      { id: 'c', title: 'C', queryId: Q, size: 'lg', width: '700', height: 'haut' },
      { id: 'd', title: 'D', queryId: Q, size: 'sm' },
    ])
    for (const id of ['a', 'b', 'c', 'd']) write(`dashboards/DASHBOARD-0001/${id}.vl.json`, SPEC)
    const d = (await dashboards.get(repo, U, 'DASHBOARD-0001'))!
    const [a, b, c, dd] = d.widgets
    expect(a).toMatchObject({ width: 700, height: 320 })
    expect(b).toMatchObject({ width: 1104, height: 160 })
    expect(c.width).toBeUndefined()
    expect(c.height).toBeUndefined()
    expect('width' in dd).toBe(false)
    expect('height' in dd).toBe(false)
    expect(d.state.readOnly).toBeUndefined()
  })

  it('format d\'avant GH74 : lu comme avant, sans dimension', async () => {
    write('dashboards/DASHBOARD-0002.yaml', yaml.dump({
      id: 'DASHBOARD-0002', title: 'Ancien', scope: 'shared', createdBy: 'x', createdAt: '2026-01-01', widgetOrder: ['w1'],
      widgets: [{ id: 'w1', title: 'Barres', queryId: Q, type: 'bar', size: 'lg', fieldMapping: { category: 'component', measure: 'count' } }],
    }))
    const d = (await dashboards.get(repo, U, 'DASHBOARD-0002'))!
    expect(d.widgets[0].size).toBe('lg')
    expect(d.widgets[0].width).toBeUndefined()
  })
})

describe('U7 — ajout avec dimensions', () => {
  it('partagé : écrites dans dashboard.yaml, dans l\'ordre size, width, height', async () => {
    const d = await shared()
    await dashboards.addWidget(repo, U, d.id, { title: 'W', queryId: Q, size: 'md', width: 700, height: 320, spec: SPEC })
    const [w] = sharedYaml(d.id).widgets
    expect(Object.keys(w)).toEqual(['id', 'title', 'queryId', 'size', 'width', 'height'])
    expect(w).toMatchObject({ width: 700, height: 320 })
    const back = (await dashboards.get(repo, U, d.id))!.widgets[0]
    expect(back).toMatchObject({ size: 'md', width: 700, height: 320 })
  })

  it('privé : écrites dans le .pref', async () => {
    const d = await dashboards.create(repo, U, { title: 'Privé', scope: 'private', createdBy: U })
    await dashboards.addWidget(repo, U, d.id, { title: 'W', queryId: 'local-1-a', size: 'sm', width: 300, height: 200, spec: SPEC })
    expect(privateWidgets()[0]).toMatchObject({ size: 'sm', width: 300, height: 200 })
  })

  it('hors bornes bornées, nombre à virgule arrondi', async () => {
    const d = await shared()
    const after = await dashboards.addWidget(repo, U, d.id, { title: 'W', queryId: Q, size: 'md', width: 5000, height: 99.6, spec: SPEC })
    expect(after.widgets[0]).toMatchObject({ width: 1104, height: 160 })
  })
})

describe('U8 — modification des dimensions', () => {
  it('un nombre pose, null retire la clé du fichier, absent conserve', async () => {
    const d = await shared()
    const added = await dashboards.addWidget(repo, U, d.id, { title: 'W', queryId: Q, size: 'md', spec: SPEC })
    const id = added.widgets[0].id
    expect(Object.keys(sharedYaml(d.id).widgets[0])).toEqual(['id', 'title', 'queryId', 'size'])

    await dashboards.updateWidget(repo, U, d.id, id, { width: 700 })
    expect(sharedYaml(d.id).widgets[0]).toMatchObject({ width: 700 })
    expect('height' in sharedYaml(d.id).widgets[0]).toBe(false)

    await dashboards.updateWidget(repo, U, d.id, id, { height: 333.4 })
    await dashboards.updateWidget(repo, U, d.id, id, { title: 'Renommé' }) // dimensions conservées
    expect(sharedYaml(d.id).widgets[0]).toMatchObject({ title: 'Renommé', width: 700, height: 333 })

    await dashboards.updateWidget(repo, U, d.id, id, { width: null })
    const w = sharedYaml(d.id).widgets[0]
    expect('width' in w).toBe(false)
    expect(w.height).toBe(333)
    await dashboards.updateWidget(repo, U, d.id, id, { height: null })
    expect(Object.keys(sharedYaml(d.id).widgets[0])).toEqual(['id', 'title', 'queryId', 'size'])
  })

  it('hors bornes bornées ; valeur non numérique ou non finie refusée sans rien écrire', async () => {
    const d = await shared()
    const id = (await dashboards.addWidget(repo, U, d.id, { title: 'W', queryId: Q, size: 'md', spec: SPEC })).widgets[0].id
    await dashboards.updateWidget(repo, U, d.id, id, { width: 99999, height: 1 })
    expect(sharedYaml(d.id).widgets[0]).toMatchObject({ width: 1104, height: 160 })
    const before = read(`dashboards/${d.id}/dashboard.yaml`)
    for (const bad of [Number.NaN, Infinity, '700', {}]) {
      await expect(dashboards.updateWidget(repo, U, d.id, id, { width: bad as never })).rejects.toThrow(/Largeur de widget invalide/)
      await expect(dashboards.updateWidget(repo, U, d.id, id, { height: bad as never })).rejects.toThrow(/Hauteur de widget invalide/)
    }
    expect(read(`dashboards/${d.id}/dashboard.yaml`)).toBe(before)
  })

  it('privé : posées et retirées dans le .pref', async () => {
    const d = await dashboards.create(repo, U, { title: 'Privé', scope: 'private', createdBy: U })
    const id = (await dashboards.addWidget(repo, U, d.id, { title: 'W', queryId: 'local-1-a', size: 'md', spec: SPEC })).widgets[0].id
    await dashboards.updateWidget(repo, U, d.id, id, { width: 640, height: 400 })
    expect(privateWidgets()[0]).toMatchObject({ width: 640, height: 400 })
    await dashboards.updateWidget(repo, U, d.id, id, { width: null, height: null })
    expect('width' in privateWidgets()[0]).toBe(false)
    expect('height' in privateWidgets()[0]).toBe(false)
  })
})

describe('U9 — les dimensions suivent le widget', () => {
  it('changement de portée privé → partagé → privé, ordre, suppression d\'un autre widget', async () => {
    const d = await dashboards.create(repo, U, { title: 'Privé', scope: 'private', createdBy: U })
    const first = await dashboards.addWidget(repo, U, d.id, { title: 'A', queryId: Q, size: 'md', width: 700, height: 320, spec: SPEC })
    const withB = await dashboards.addWidget(repo, U, d.id, { title: 'B', queryId: Q, size: 'sm', spec: SPEC })
    const idA = first.widgets[0].id
    const idB = withB.widgets[1].id

    await dashboards.setWidgetOrder(repo, U, d.id, [idB, idA])
    const removed = await dashboards.deleteWidget(repo, U, d.id, idB)
    expect(removed.widgets[0]).toMatchObject({ id: idA, width: 700, height: 320 })

    const toShared = await dashboards.setScope(repo, U, d.id, 'shared')
    expect(toShared.widgets[0]).toMatchObject({ width: 700, height: 320 })
    expect(sharedYaml(toShared.id).widgets[0]).toMatchObject({ width: 700, height: 320 })

    const back = await dashboards.setScope(repo, U, toShared.id, 'private')
    expect(back.widgets[0]).toMatchObject({ width: 700, height: 320 })
    expect(privateWidgets()[0]).toMatchObject({ width: 700, height: 320 })
  })

  it('changement de modèle (code régénéré) : dimensions conservées', async () => {
    const d = await shared()
    const id = (await dashboards.addWidget(repo, U, d.id, { title: 'A', queryId: Q, size: 'md', width: 700, spec: SPEC })).widgets[0].id
    const after = await dashboards.updateWidget(repo, U, d.id, id, { spec: '{ "data": { "name": "rows" }, "mark": "line" }' })
    expect(after.widgets[0]).toMatchObject({ width: 700 })
  })
})

describe('U10 — widget sans dimension', () => {
  it('n\'écrit ni width ni height (seeds et fichiers existants inchangés)', async () => {
    const d = await shared()
    await dashboards.addWidget(repo, U, d.id, { title: 'A', queryId: Q, size: 'lg', spec: SPEC })
    const text = read(`dashboards/${d.id}/dashboard.yaml`)
    expect(text).not.toMatch(/width|height/)
    // Ré-écriture d'un dashboard sans dimension : octet pour octet identique.
    await dashboards.update(repo, U, d.id, { title: 'Suivi' })
    expect(read(`dashboards/${d.id}/dashboard.yaml`)).toBe(text)
  })
})
