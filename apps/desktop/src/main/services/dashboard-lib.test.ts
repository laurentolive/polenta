import * as fs from 'fs'
import * as path from 'path'
import ts from 'typescript'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { QuickJSWASMModule } from 'quickjs-emscripten-core'
import type { GraphRow, PolentaGraph } from '@polenta/types'
import { buildHost, findQueryTemplate } from '@polenta/types'
import { createSandboxModule, SandboxContext } from './script-sandbox'
import type { LibraryModules } from './script-limits'
import { GraphService } from './graph.service'
import { ROOT, WS, fixtureServices } from './graph-fixture.test-util'
import { renderGraphDts, GRAPH_DTS_PATH } from '../../../scripts/generate-graph-dts'
import { readManifest, staleFiles, SHIPPED_DIR, SHIPPED_FILES } from '../../../scripts/dashboard-lib-manifest'

// GH74 — bibliothèque de départ (specs/GH74-tests.md §3) : équivalence avec l'ancien calcul de
// Polenta (étapes GH71, maturité T77), état des campagnes dans le temps, fuseau, types livrés.

const NOW = new Date('2026-10-13T12:00:00Z')
const LIB: LibraryModules = Object.fromEntries(
  fs.readdirSync(SHIPPED_DIR).filter((f) => f.endsWith('.js')).map((f) => [`lib/${f}`, fs.readFileSync(path.join(SHIPPED_DIR, f), 'utf8')]),
)

let qjs: QuickJSWASMModule
let graphJson: string
let ctx: SandboxContext

/** Sorties de l'ancien moteur SQL sur le même jeu, figées avant sa suppression (GH74 sprint 2). */
const LEGACY = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'gh74-legacy-reference.json'), 'utf8')) as {
  steps: Record<string, string>
  maturity: Record<string, string>
  builder: { config: Record<string, unknown>; rows: unknown[] }[]
}

function services() {
  const s = fixtureServices()
  return { graph: new GraphService(s.reqIndex, s.testsIndex, s.schema, s.traceability, s.git, s.workspaceTree, s.campaigns, { now: () => NOW }) }
}

beforeAll(async () => {
  qjs = await createSandboxModule()
  graphJson = (await services().graph.build(ROOT, WS)).json
  ctx = SandboxContext.prepare(qjs, graphJson, LIB)
})
afterAll(() => ctx.dispose())

function run(script: string, timezone = 'UTC', drill: Record<string, string> | null = null, json?: string): GraphRow[] {
  const host = buildHost({ locale: 'fr', timezone }, 1, NOW, drill)
  const c = json ? SandboxContext.prepare(qjs, json, LIB) : ctx
  try {
    const r = c.runScript(script, host)
    if (!r.ok) throw new Error(JSON.stringify(r.error))
    return r.rows
  } finally {
    if (json) c.dispose()
  }
}

describe('GH74 — équivalence avec l\'ancien calcul de Polenta', () => {
  it('L1 — entryStep = étape GH71 (campaign-progress) pour chaque entrée', async () => {
    const expected = LEGACY.steps
    const rows = run(
      "import { entryStep, stepContext } from 'lib/campaign.js'\n" +
      'export default (data) => { const ctx = stepContext(data); return data.campaigns.flatMap((c) => c.entries.map((e) => ({ id: c.id + "/" + e.entryId, step: entryStep(data, e, ctx) }))) }',
    )
    expect(Object.fromEntries(rows.map((r) => [r.id, r.step]))).toEqual(expected)
    // Le jeu couvre chaque cas : résultat, préparation (deux schémas), prêt.
    expect(new Set(Object.values(expected))).toEqual(new Set(['PASS', 'prep:draft', 'prep:brouillon', 'ready']))
  })

  it('L2 — maturity = critères T77 (maturity.util) pour chaque exigence', async () => {
    const expected = LEGACY.maturity
    const rows = run(
      "import { maturity, maturityContext } from 'lib/maturity.js'\n" +
      'export default (data) => { const ctx = maturityContext(data); return data.requirements.map((r) => { const m = maturity(data, r, ctx); return { id: r.id, v: m.ok + "|" + m.missing.join(", ") } }) }',
    )
    expect(Object.fromEntries(rows.map((r) => [r.id, r.v]))).toEqual(expected)
    expect(expected['REQ-0001']).toBe('true|')
    expect(expected['REQ-0002']).toBe('false|EARS, critère d\'acceptance, lien de vérification')
  })

  it.each(LEGACY.builder.map((b, i) => [i, b] as const))('T2 — « Liste filtrée » = ancien builder (cas %i)', (_i, b) => {
    const rows = run(findQueryTemplate('filtered-list')!.generate(b.config))
    const groupBy = b.config.groupBy as string[] | undefined
    const got = groupBy
      ? rows.map((r) => ({ ...Object.fromEntries(groupBy.map((k) => [k, r[k] ?? null])), count: r.count })).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)))
      : rows.map((r) => (r.entryId ? `${r.campaignId}/${r.entryId}` : r.id)).sort()
    expect(got).toEqual(b.rows)
  })
})

describe('GH74 — campaignsTimeline', () => {
  const timeline = (campaignId: string, from: string, to: string) =>
    `import { campaignTimeline } from 'lib/campaign.js'\nexport default (data, polenta) => campaignTimeline(data, '${campaignId}', { polenta, from: '${from}', to: '${to}' })`
  const counts = (rows: GraphRow[]) => {
    const out: Record<string, Record<string, number>> = {}
    for (const r of rows) if ((r.count as number) > 0) (out[r.date as string] ??= {})[r.status as string] = r.count as number
    return out
  }

  it('L3 — ajout, exécutions successives, retrait (faits GH73)', () => {
    const rows = run(timeline('CAMP-0001', '2026-09-30', '2026-10-05'))
    expect(counts(rows)).toEqual({
      '2026-10-01': { pending: 2 },
      '2026-10-02': { pending: 4, FAIL: 1 },
      '2026-10-03': { pending: 4, PASS: 1 },
      '2026-10-04': { pending: 5, PASS: 1 },
      '2026-10-05': { pending: 4, PASS: 1 },
    })
    expect(rows.every((r) => r.approximate === false)).toBe(true)
    expect(rows.filter((r) => r.date === '2026-10-01').map((r) => r.status)).toEqual(['pending', 'INCOMPLETE', 'BLOCKED', 'FAIL', 'PASS'])
  })

  it('L3 — données antérieures à GH73 : repli approximatif, marqué', () => {
    const rows = run(timeline('CAMP-0002', '2026-09-04', '2026-09-26'))
    const c = counts(rows)
    expect(c['2026-09-04']).toEqual({ pending: 2 })
    expect(c['2026-09-05']).toEqual({ pending: 1, FAIL: 1 }) // RUN-OLDER rattaché par repli
    expect(c['2026-09-10']).toEqual({ pending: 1, PASS: 1 })
    expect(c['2026-09-26']).toEqual({ pending: 1, PASS: 1 }) // RUN-ALONE (hors fenêtre) ignoré
    expect(rows.every((r) => r.approximate === true)).toBe(true)
  })

  it('drill-down : seule la ligne demandée, avec ses _ids', () => {
    const rows = run(timeline('CAMP-0001', '2026-10-01', '2026-10-05'), 'UTC', { date: '2026-10-02', status: 'FAIL' })
    expect(rows).toEqual([expect.objectContaining({ date: '2026-10-02', status: 'FAIL', count: 1, _ids: ['CAMP-0001/TST-0001-1'] })])
  })

  it('L4 — fuseau : une exécution à 23 h 30 UTC compte le lendemain à Paris', () => {
    const mini: Partial<PolentaGraph> = {
      schema: { objectTypes: [], linkTypes: [], campaignStatuses: [], entryStatuses: ['pending', 'INCOMPLETE', 'BLOCKED', 'FAIL', 'PASS'].map((name, order) => ({ name, label: name, order })) },
      campaigns: [{
        id: 'C', repo: 'r', component: 'r', objectTypeRef: null, title: 'C', status: 'in_progress', fields: {}, history: {}, baselineRef: null, targetComponent: null, level: null,
        createdAt: '2026-10-01T08:00:00Z', completedAt: null, removedEntries: [],
        entries: [{ entryId: 'E', testCaseId: 'T', requirementId: null, status: 'PASS', addedAt: '2026-10-01T08:00:00Z', runId: 'R', executedAt: '2026-10-02T23:30:00Z', executedBy: null, carriedFrom: null, snapshot: null, resyncable: false }],
      }],
      runs: [{ id: 'R', repo: 'r', testCaseId: 'T', campaignEntry: { campaignId: 'C', entryId: 'E' }, requirementId: null, result: 'PASS', executedAt: '2026-10-02T23:30:00Z', executedBy: 'x', duration: 0, origin: null }],
    }
    const script = timeline('C', '2026-10-02', '2026-10-03')
    expect(counts(run(script, 'UTC', null, JSON.stringify(mini)))).toEqual({ '2026-10-02': { PASS: 1 }, '2026-10-03': { PASS: 1 } })
    expect(counts(run(script, 'Europe/Paris', null, JSON.stringify(mini)))).toEqual({ '2026-10-02': { pending: 1 }, '2026-10-03': { PASS: 1 } })
  })
})

describe('GH74 — history.js et time.js', () => {
  it('L5 — valueAt : avant la première entrée, entrée implicite, sans historique', () => {
    const rows = run(
      "import { valueAt } from 'lib/history.js'\n" +
      'export default (data) => { const r1 = data.requirements.find((r) => r.id === "REQ-0001"); const r2 = data.requirements.find((r) => r.id === "REQ-0002")\n' +
      '  return [{ before: valueAt(r1, "status", "2026-08-01T00:00:00Z"), mid: valueAt(r1, "status", "2026-09-05T00:00:00Z"), after: valueAt(r1, "status", "2026-12-01T00:00:00Z"), implicit: valueAt(r2, "status", "2026-12-01T00:00:00Z"), none: valueAt({ status: "x", fields: { f: 1 }, history: {} }, "f", "2026-01-01T00:00:00Z") }] }',
    )
    expect(rows).toEqual([{ before: null, mid: 'draft', after: 'approved', implicit: 'approved', none: 1 }])
  })

  it('timeline d\'un champ suivi', () => {
    const rows = run(
      "import { timeline } from 'lib/history.js'\n" +
      'export default (data, polenta) => timeline(data.requirements.filter((r) => r.id === "REQ-0001"), "status", { polenta, from: "2026-09-09", to: "2026-09-10" })',
    )
    expect(rows).toEqual([{ date: '2026-09-09', value: 'draft', count: 1 }, { date: '2026-09-10', value: 'approved', count: 1 }])
  })

  it('dayOf / dayEnd suivent les changements d\'heure', () => {
    const rows = run(
      "import { dayOf, dayEnd } from 'lib/time.js'\n" +
      'export default (data, polenta) => [{ winter: dayOf("2026-01-15T23:30:00Z", polenta), summer: dayOf("2026-07-15T22:30:00Z", polenta), endWinter: dayEnd("2026-01-15", polenta), endSummer: dayEnd("2026-07-15", polenta) }]',
      'Europe/Paris',
    )
    expect(rows).toEqual([{ winter: '2026-01-16', summer: '2026-07-16', endWinter: '2026-01-15T22:59:59Z', endSummer: '2026-07-15T21:59:59Z' }])
  })
})

describe('GH74 — performance (jeu ×50)', () => {
  /** Jeu synthétique de la taille ×50 de #78 : 250 campagnes, 1 250 entrées, ~2 000 runs sur 200 jours. */
  function inflated(): string {
    let seed = 42
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    const day = (d: number, h = 10) => new Date(Date.UTC(2026, 3, 1) + d * 86_400_000 + h * 3_600_000).toISOString().replace('.000Z', 'Z')
    const results = ['PASS', 'FAIL', 'BLOCKED', 'INCOMPLETE'] as const
    const campaigns: PolentaGraph['campaigns'] = []
    const runs: PolentaGraph['runs'] = []
    for (let c = 0; c < 250; c++) {
      const start = Math.floor(rnd() * 150)
      const id = `CAMP-${String(c).padStart(4, '0')}`
      const entries = Array.from({ length: 5 }, (_, i) => {
        const entryId = `T-${c}-${i}`
        const n = Math.floor(rnd() * 3)
        let last: string | null = null
        let status: 'pending' | (typeof results)[number] = 'pending'
        for (let k = 0; k < n; k++) {
          last = day(start + 1 + Math.floor(rnd() * 40))
          status = results[Math.floor(rnd() * 4)]
          runs.push({ id: `R-${c}-${i}-${k}`, repo: 'r', testCaseId: `T-${i}`, campaignEntry: { campaignId: id, entryId }, requirementId: null, result: status, executedAt: last, executedBy: 'x', duration: 0, origin: null })
        }
        return { entryId, testCaseId: `T-${i}`, requirementId: null, status, addedAt: day(start), runId: null, executedAt: last, executedBy: null, carriedFrom: null, snapshot: null, resyncable: false }
      })
      campaigns.push({ id, repo: 'r', component: 'r', objectTypeRef: null, title: id, status: 'in_progress', fields: {}, history: {}, baselineRef: null, targetComponent: null, level: null, createdAt: day(start, 8), completedAt: null, entries, removedEntries: [] })
    }
    return JSON.stringify({
      schema: { objectTypes: [], linkTypes: [], campaignStatuses: [], entryStatuses: ['pending', 'INCOMPLETE', 'BLOCKED', 'FAIL', 'PASS'].map((name, order) => ({ name, label: name, order })) },
      campaigns, runs, requirements: [], tests: [], links: [],
    })
  }

  it('L6 — campaignsTimeline : une campagne < 100 ms, toutes < 1 s (contexte préparé)', () => {
    const big = SandboxContext.prepare(qjs, inflated(), LIB)
    try {
      const host = buildHost({ locale: 'fr', timezone: 'Europe/Paris' }, 1, new Date('2026-10-13T12:00:00Z'))
      const time = (script: string) => {
        big.runScript(script, host) // modules compilés, comme un contexte réutilisé
        const t0 = performance.now()
        const r = big.runScript(script, host)
        if (!r.ok) throw new Error(JSON.stringify(r.error))
        return { ms: performance.now() - t0, rows: r.rows.length }
      }
      const one = time("import { campaignTimeline } from 'lib/campaign.js'\nexport default (data, polenta) => campaignTimeline(data, 'CAMP-0007', { polenta })")
      const all = time("import { campaignsTimeline } from 'lib/campaign.js'\nexport default (data, polenta) => campaignsTimeline(data, { polenta })")
      expect(all.rows).toBeGreaterThan(900)
      expect(one.ms).toBeLessThan(100)
      expect(all.ms).toBeLessThan(1000)
    } finally {
      big.dispose()
    }
  })
})

describe('GH74 — fichiers livrés', () => {
  it('L7 — la bibliothèque passe checkJs (strict) contre polenta.d.ts', () => {
    const files = fs.readdirSync(SHIPPED_DIR).filter((f) => f.endsWith('.js') || f.endsWith('.d.ts')).map((f) => path.join(SHIPPED_DIR, f))
    const program = ts.createProgram(files, {
      allowJs: true, checkJs: true, noEmit: true, strict: true, noImplicitAny: false,
      target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ['lib.es2020.d.ts'], types: [],
    })
    const diagnostics = ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
    expect(diagnostics).toEqual([])
  })

  it('L8 — polenta.d.ts généré depuis graph.ts est à jour', () => {
    expect(fs.readFileSync(GRAPH_DTS_PATH, 'utf8').replace(/\r\n/g, '\n')).toBe(renderGraphDts())
  })

  it('L11 — manifeste : dernière empreinte = contenu livré, versions croissantes', () => {
    expect(staleFiles()).toEqual([])
    const manifest = readManifest()
    expect(manifest.files.map((f) => f.path).sort()).toEqual(SHIPPED_FILES.map((f) => f.path).sort())
    for (const f of manifest.files) expect(f.versions.map((v) => v.version)).toEqual(f.versions.map((_, i) => i + 1))
  })
})
