import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { describe, expect, it, vi } from 'vitest'
import { GraphService } from './graph.service'
import { COMP, ROOT, WS, fixtureServices } from './graph-fixture.test-util'
import type { FixtureOptions } from './graph-fixture.test-util'

// GH74 — graphe de données (specs/GH74-tests.md §1, G1–G12) et drill-down (describeIds, resolveTarget).

const NOW = new Date('2026-10-13T12:00:00Z')

function service(opts: FixtureOptions & { cache?: boolean } = {}) {
  const s = fixtureServices(opts)
  const graph = new GraphService(s.reqIndex, s.testsIndex, s.schema, s.traceability, s.git, s.workspaceTree, s.campaigns, { cache: opts.cache, now: () => NOW })
  return { graph, calls: s.calls }
}

describe('GH74 — graphe de données', () => {
  it('G1 — collections du contrat, sans indicateur de suivi', async () => {
    const { graph } = (await service().graph.build(ROOT, WS))
    expect(graph.contractVersion).toBe(1)
    expect(graph.repos).toEqual([
      { name: 'produit', label: 'Produit', isRoot: true },
      { name: 'moteur', label: 'Moteur', isRoot: false },
    ])
    expect(graph.components.map((c) => c.name)).toEqual(['produit', 'hydraulique', 'moteur'])
    expect(graph.requirements).toHaveLength(6)
    expect(graph.tests).toHaveLength(4)
    expect(graph.links).toHaveLength(1)
    expect(graph.campaigns).toHaveLength(2)
    expect(graph.runs).toHaveLength(5)
    const json = JSON.stringify(graph)
    expect(json).not.toMatch(/"(maturity\w*|progress\w*|testStatus|steps|preconditions|postconditions)":/)
  })

  it('G2 — couverture : indicateur Polenta repris tel quel', async () => {
    const { graph } = await service().graph.build(ROOT, WS)
    expect(graph.requirements.find((r) => r.id === 'REQ-0001')?.coverageStatus).toBe('covered')
    expect(graph.requirements.find((r) => r.id === 'REQ-0002')?.coverageStatus).toBe('not_covered')
  })

  it('G3 — même objectTypeRef dans deux repos : deux types, distingués par repo', async () => {
    const { graph } = await service().graph.build(ROOT, WS)
    const tests = graph.schema.objectTypes.filter((t) => t.ref === 'root::test')
    expect(tests.map((t) => [t.repo, t.statuses.find((s) => s.isApproval)?.name])).toEqual([['produit', 'approved'], ['moteur', 'valide']])
    expect(graph.tests.find((t) => t.id === 'TMOT-0001')).toMatchObject({ repo: 'moteur', component: 'moteur' })
    expect(graph.requirements.find((r) => r.id === 'HYD-0001')).toMatchObject({ repo: 'produit', component: 'hydraulique' })
    const exigence = graph.schema.objectTypes.find((t) => t.ref === 'root::exigence')!
    expect(exigence.fields.find((f) => f.name === 'statement')).toMatchObject({ validator: 'EARS', required: true })
    expect(exigence.statuses.find((s) => s.name === 'obsolete')).toMatchObject({ isTerminal: true })
  })

  it('G4 — historique : entrée implicite si la valeur courante diffère', async () => {
    const { graph } = await service().graph.build(ROOT, WS)
    const r1 = graph.requirements.find((r) => r.id === 'REQ-0001')!
    expect(r1.history.status.map((e) => e.value)).toEqual(['draft', 'approved'])
    const r2 = graph.requirements.find((r) => r.id === 'REQ-0002')!
    const last = r2.history.status[r2.history.status.length - 1]
    expect(last).toMatchObject({ value: 'approved', implicit: true })
    expect(graph.requirements.find((r) => r.id === 'MOT-0001')!.history).toMatchObject({ status: [{ value: 'valide', implicit: true }] })
  })

  it('G5 — campagne close : completedAt, statut', async () => {
    const { graph } = await service().graph.build(ROOT, WS)
    expect(graph.campaigns.find((c) => c.id === 'CAMP-0002')).toMatchObject({ status: 'completed', completedAt: '2026-09-20T18:00:00Z' })
    const open = graph.campaigns.find((c) => c.id === 'CAMP-0001')!
    expect(open.history.status.map((e) => e.value)).toEqual(['planned', 'in_progress'])
  })

  it('G6 — entrée retirée', async () => {
    const { graph } = await service().graph.build(ROOT, WS)
    const c = graph.campaigns.find((x) => x.id === 'CAMP-0001')!
    expect(c.entries.map((e) => e.entryId)).not.toContain('TST-0002-2')
    expect(c.removedEntries).toEqual([expect.objectContaining({ entryId: 'TST-0002-2', removedAt: '2026-10-05T07:00:00Z' })])
  })

  it('G7 — resyncable (règle GH68) et copie réduite', async () => {
    const { graph } = await service().graph.build(ROOT, WS)
    const open = graph.campaigns.find((x) => x.id === 'CAMP-0001')!
    const byId = Object.fromEntries(open.entries.map((e) => [e.entryId, e]))
    expect(byId['TST-0002-1'].resyncable).toBe(true)
    expect(byId['TST-0001-1'].resyncable).toBe(false) // exécutée
    expect(byId['TST-0001-2'].resyncable).toBe(false) // pas de copie
    expect(byId['TST-0002-1'].snapshot).toEqual({ title: 'Test TST-0002 (copie)', status: 'draft', version: 2 })
    const closed = graph.campaigns.find((x) => x.id === 'CAMP-0002')!
    expect(closed.entries.find((e) => e.entryId === 'TST-0001-1')!.resyncable).toBe(false) // campagne close
  })

  it('G8 — statuts d\'entrée : ordre, gravité, libellés', async () => {
    const fr = await service().graph.build(ROOT, WS, 'fr')
    expect(fr.graph.schema.entryStatuses.map((s) => [s.name, s.order, s.severity])).toEqual([
      ['pending', 0, 1], ['INCOMPLETE', 1, 2], ['BLOCKED', 2, 3], ['FAIL', 3, 4], ['PASS', 4, 0],
    ])
    expect(fr.graph.schema.entryStatuses[4].label).toBe('Passé')
    const en = await service().graph.build(ROOT, WS, 'en')
    expect(en.graph.schema.entryStatuses[4].label).toBe('Passed')
    expect(en.graph.schema.campaignStatuses.map((s) => s.name)).toEqual(['planned', 'in_progress', 'completed', 'abandoned'])
  })

  it('G9 — campagnes illisibles d\'un repo : graphe construit sans elles', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { graph } = await service({ brokenComponentCampaigns: true }).graph.build(ROOT, WS)
    expect(graph.campaigns).toHaveLength(2)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('G10 — cache, invalidé par un changement dans un repo du périmètre', async () => {
    const { graph, calls } = service()
    const a = await graph.build(ROOT, WS)
    const before = calls.findAll
    const b = await graph.build(ROOT, WS)
    expect(b.version).toBe(a.version)
    expect(calls.findAll).toBe(before)
    graph.invalidate('/ailleurs')
    expect((await graph.build(ROOT, WS)).version).toBe(a.version)
    graph.invalidate(COMP)
    const c = await graph.build(ROOT, WS)
    expect(c.version).toBeGreaterThan(a.version)
    expect(calls.findAll).toBeGreaterThan(before)
  })

  it('G11 — constructions simultanées partagées', async () => {
    const { graph, calls } = service()
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => graph.build(ROOT, WS)))
    expect(new Set(results.map((r) => r.version)).size).toBe(1)
    expect(calls.findAll).toBe(2) // une lecture par repo
  })

  it('G12 — sans cache (serveur MCP) : reconstruit à chaque appel, même contenu', async () => {
    const { graph } = service({ cache: false })
    const a = await graph.build(ROOT, WS)
    const b = await graph.build(ROOT, WS)
    expect(b.version).toBeGreaterThan(a.version)
    expect(b.json).toBe(a.json)
  })

  it('arbre du workspace modifié (composant ajouté / retiré) : graphe reconstruit', async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'gh74-ws-'))
    try {
      const cache = path.join(ws, '.polenta', 'tree.cache.yaml')
      fs.mkdirSync(path.dirname(cache), { recursive: true })
      fs.writeFileSync(cache, 'nodes: []' + String.fromCharCode(10))
      const { graph } = service()
      const a = await graph.build(ROOT, ws)
      expect((await graph.build(ROOT, ws)).version).toBe(a.version)
      fs.utimesSync(cache, new Date(), new Date(Date.now() + 5000))
      expect((await graph.build(ROOT, ws)).version).toBeGreaterThan(a.version)
    } finally {
      fs.rmSync(ws, { recursive: true, force: true })
    }
  })

  it('sans workspace : seul le repo ouvert', async () => {
    const { graph } = await service().graph.build(ROOT)
    expect(graph.repos).toEqual([{ name: 'produit', label: 'produit', isRoot: true }])
    expect(graph.tests.map((t) => t.id)).toEqual(['TST-0001', 'TST-0002'])
  })
})

describe('GH74 — drill-down', () => {
  it('describeIds : objets, entrées de campagne, runs, inconnus', async () => {
    const { graph } = service()
    const out = await graph.describeIds(ROOT, ['REQ-0001', 'CAMP-0001/TMOT-0001-1', 'CAMP-0001/TST-0001-2', 'RUN-ALONE', 'NOPE-0001'], WS)
    expect(out).toEqual([
      { id: 'REQ-0001', kind: 'requirement', title: 'Titre REQ-0001', status: 'APPROVED', typeLabel: 'Exigence' },
      { id: 'CAMP-0001/TMOT-0001-1', kind: 'campaign-entry', title: 'Test TMOT-0001 (copie)', status: 'En attente', typeLabel: 'Campagne en cours' },
      { id: 'CAMP-0001/TST-0001-2', kind: 'campaign-entry', title: 'Test TST-0001 — REQ-0001', status: 'En attente', typeLabel: 'Campagne en cours' },
      { id: 'RUN-ALONE', kind: 'run', title: 'Test TST-0002', status: 'Bloqué', typeLabel: null },
      { id: 'NOPE-0001', kind: 'unknown', title: null, status: null, typeLabel: null },
    ])
  })

  it('resolveTarget : repo de l\'objet, entrée exécutée ou non', async () => {
    const { graph } = service()
    expect(await graph.resolveTarget(ROOT, 'TMOT-0001', WS)).toEqual({ kind: 'test', id: 'TMOT-0001', repoPath: COMP })
    expect(await graph.resolveTarget(ROOT, 'CAMP-0001/TST-0001-1', WS)).toEqual({
      kind: 'campaign-entry', campaignId: 'CAMP-0001', entryId: 'TST-0001-1', executed: true, status: 'PASS', repoPath: ROOT,
    })
    expect(await graph.resolveTarget(ROOT, 'CAMP-0001/TST-0002-1', WS)).toMatchObject({ executed: false, status: 'pending' })
    expect(await graph.resolveTarget(ROOT, 'CAMP-0001/TST-0002-2', WS)).toBeNull() // retirée
    expect(await graph.resolveTarget(ROOT, 'NOPE-0001', WS)).toBeNull()
  })
})
