import { describe, expect, it } from 'vitest'
import { buildHost } from '@polenta/types'
import { GraphService } from './graph.service'
import { ROOT, WS, fixtureServices } from './graph-fixture.test-util'
import { createSandboxModule, SandboxContext } from './script-sandbox'

// GH441 — `GraphVersion.verification` : couverture figée lue telle quelle dans le fichier de version
// (specs/GH441-tests.md, T1 à T3 et T6). Versions injectées par `setVersions` ; le schéma de la fixture n'a pas de type version.

const NOW = new Date('2026-11-27T12:00:00Z')
const TYPE_DEF = {
  name: 'version', label: 'Version', prefix: 'VER', category: 'version', fields: [],
  statuses: [{ name: 'en_cours' }, { name: 'released', isApproval: true }, { name: 'abandonnee', isTerminal: true }],
}
const VERIFICATION = {
  computedAt: '2026-11-20T10:00:00.000Z',
  rows: [
    { id: 'REQ-0001', status: 'validated', tests: ['TST-0001'] },
    { id: 'REQ-0002', status: 'not_covered', tests: [] },
  ],
}

function version(id: string, status: string, extra: Record<string, unknown> = {}) {
  return { id, objectTypeRef: 'root::version', title: id, status, basedOn: null, components: {}, changes: [], fields: {}, ...extra }
}

async function build(versions: unknown[]) {
  const s = fixtureServices()
  const graph = new GraphService(s.reqIndex, s.testsIndex, s.schema, s.traceability, s.git, s.workspaceTree, s.campaigns, { now: () => NOW })
  graph.setVersions({
    list: async (rp: string) => (rp === ROOT ? versions : []),
    versionType: async () => ({ typeDef: TYPE_DEF, ref: 'root::version' }),
    designVersions: async () => new Map(),
  } as never)
  return graph.build(ROOT, WS)
}

describe('GH441 — couverture figée dans le graphe de données', () => {
  it('T1 — version released avec verification : copie fidèle du fichier', async () => {
    const { graph } = await build([version('VER-0001', 'released', { verification: VERIFICATION })])
    expect(graph.versions[0]).toMatchObject({ id: 'VER-0001', state: 'released', verification: VERIFICATION })
  })

  it('T2a — version en cours : null', async () => {
    const { graph } = await build([version('VER-0001', 'en_cours')])
    expect(graph.versions[0].verification).toBeNull()
  })

  it('T2b — version abandonnée sans gel : null', async () => {
    const { graph } = await build([version('VER-0001', 'abandonnee')])
    expect(graph.versions[0]).toMatchObject({ state: 'abandoned', verification: null })
  })

  it('T2c — version released avant GH439 (sans verification) : null, jamais recalculée', async () => {
    const { graph } = await build([version('VER-0001', 'released')])
    expect(graph.versions[0]).toMatchObject({ state: 'released', verification: null })
  })

  it('T3a — bloc verification sans rows : rows vide, les autres versions restent listées', async () => {
    const { graph } = await build([
      version('VER-0001', 'released', { verification: { computedAt: VERIFICATION.computedAt } }),
      version('VER-0002', 'en_cours'),
    ])
    expect(graph.versions.map(v => v.id)).toEqual(['VER-0001', 'VER-0002'])
    expect(graph.versions[0].verification).toEqual({ computedAt: VERIFICATION.computedAt, rows: [] })
  })

  it('T3b — ligne sans tests : tests vide pour cette ligne, les autres intactes', async () => {
    const { graph } = await build([
      version('VER-0001', 'released', {
        verification: { computedAt: VERIFICATION.computedAt, rows: [{ id: 'REQ-0001', status: 'covered' }, VERIFICATION.rows[0]] },
      }),
    ])
    expect(graph.versions[0].verification?.rows).toEqual([
      { id: 'REQ-0001', status: 'covered', tests: [] },
      VERIFICATION.rows[0],
    ])
  })

  it('T6 — script de la vue Suivi (bac à sable, contrat v1) lit verification ; version non figée : null', async () => {
    const { json } = await build([
      version('VER-0001', 'released', { verification: VERIFICATION }),
      version('VER-0002', 'en_cours'),
    ])
    const qjs = await createSandboxModule()
    const ctx = SandboxContext.prepare(qjs, json, {})
    try {
      const host = buildHost({ locale: 'fr', timezone: 'UTC' }, 1, NOW)
      const r = ctx.runScript(
        'export default (data) => data.versions.map((v) => ({ id: v.id, n: v.verification ? v.verification.rows.length : null, s: v.verification ? v.verification.rows[0].status : null }))',
        host,
      )
      expect(r).toEqual({
        ok: true,
        rows: [{ id: 'VER-0001', n: 2, s: 'validated' }, { id: 'VER-0002', n: null, s: null }],
      })
    } finally {
      ctx.dispose()
    }
  })
})
