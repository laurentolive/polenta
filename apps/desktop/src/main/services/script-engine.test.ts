import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildScriptWorker } from '../../../scripts/script-worker-build'
import { ScriptEngineService } from './script-engine.service'
import { DEFAULT_SANDBOX_LIMITS } from './script-limits'
import type { GraphService } from './graph.service'
import type { DashboardLibraryService } from './dashboard-library.service'

// GH74 — moteur de scripts, côté hôte, avec le vrai worker (specs/GH74-tests.md §2 : S5, S8, S9,
// S14–S18).

let dir: string
let workerPath: string
const engines: ScriptEngineService[] = []

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh74-worker-'))
  await buildScriptWorker(dir)
  workerPath = path.join(dir, 'script-worker.js')
}, 60_000)
afterEach(async () => {
  await Promise.all(engines.splice(0).map((e) => e.dispose()))
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const GRAPH = { requirements: [{ id: 'R1' }, { id: 'R2' }, { id: 'R3' }] }

function stubs(modules: Record<string, string> = { 'lib/n.js': 'export const n = 7' }) {
  let version = 1
  const lib = { modules, hash: 'h1' }
  const graph = { build: vi.fn(async () => ({ graph: GRAPH, json: JSON.stringify(GRAPH), version, repoPaths: new Map() })) }
  const library = { load: vi.fn(async () => lib) }
  return {
    graph: graph as unknown as GraphService,
    library: library as unknown as DashboardLibraryService,
    bumpGraph: () => { version++ },
    setLibrary: (m: Record<string, string>, hash: string) => { lib.modules = m; lib.hash = hash },
  }
}

function engine(s = stubs(), opts: Partial<ConstructorParameters<typeof ScriptEngineService>[2]> = {}) {
  const e = new ScriptEngineService(s.graph, s.library, { workerPath, now: () => new Date('2026-10-13T23:30:00Z'), ...opts })
  engines.push(e)
  return e
}

const client = { locale: 'fr', timezone: 'UTC' }

describe('GH74 — moteur de scripts', () => {
  it('exécute script + transformation, colonnes et limite (S18)', async () => {
    const e = engine()
    const r = await e.run('/repo', '/ws', {
      script: "import { n } from 'lib/n.js'\nexport default (data) => data.requirements.map((r, i) => ({ id: r.id, n: n + i, _ids: [r.id] }))",
      transform: 'export default (rows) => rows.filter((r) => r.n > 7)',
      transformFile: 'w1.js',
      limit: 1,
    }, client)
    expect(r).toMatchObject({
      ok: true, total: 2, truncated: true,
      rows: [{ id: 'R2', n: 8, _ids: ['R2'] }],
      columns: [{ name: 'id', type: 'string' }, { name: 'n', type: 'number' }],
    })
  })

  it('erreur de transformation : fichier du widget', async () => {
    const r = await engine().run('/repo', undefined, { script: 'export default () => [{ a: 1 }]', transform: 'export default (rows) => rows[0].b.c', transformFile: 'w9.js' }, client)
    expect(r).toMatchObject({ ok: false, error: { kind: 'runtime', file: 'w9.js' } })
  })

  it("données du projet illisibles : erreur dans le résultat, pas d'exception", async () => {
    const s = stubs()
    ;(s.library.load as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('EBUSY: dashboards/lib/x.js'))
    const r = await engine(s).run('/repo', undefined, { script: 'export default () => []' }, client)
    expect(r).toMatchObject({ ok: false, error: { kind: 'runtime', message: expect.stringContaining('EBUSY') } })
  })

  it('S14 — contrat non pris en charge : pas d\'exécution', async () => {
    const s = stubs()
    const r = await engine(s).run('/repo', undefined, { script: '// @polenta contract 2\nexport default () => []' }, client)
    expect(r).toMatchObject({ ok: false, error: { kind: 'contract', file: 'script.js' } })
    expect((s.graph.build as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  it('S15 — PolentaHost : fuseau et date du client', async () => {
    const script = 'export default (d, p) => [{ tz: p.timezone, today: p.today, locale: p.locale, drill: p.drill === null, offsets: p.timezoneOffsets.length > 0 }]'
    const r = await engine().run('/repo', undefined, { script }, { locale: 'en-GB', timezone: 'Pacific/Auckland' })
    expect(r).toMatchObject({ ok: true, rows: [{ tz: 'Pacific/Auckland', today: '2026-10-14', locale: 'en', drill: true, offsets: true }] })
    const bad = await engine().run('/repo', undefined, { script }, { locale: 'fr', timezone: 'Pas/Un_Fuseau' })
    expect(bad).toMatchObject({ ok: true, rows: [{ tz: 'UTC', today: '2026-10-13' }] })
  })

  it('S16 — un script partagé par plusieurs widgets n\'est exécuté qu\'une fois', async () => {
    const e = engine()
    const exec = vi.spyOn(e as unknown as { exec: (...a: unknown[]) => unknown }, 'exec')
    const script = 'export default (data) => data.requirements.map((r) => ({ id: r.id }))'
    const results = await Promise.all(['a', 'b', 'c'].map((k) => e.run('/repo', '/ws', { script, transform: `export default (rows) => rows.map((r) => ({ ...r, k: '${k}' }))`, transformFile: `${k}.js` }, client)))
    expect(results.map((r) => r.ok && r.rows[0].k)).toEqual(['a', 'b', 'c'])
    const kinds = exec.mock.calls.map((c) => (c[3] as { kind: string }).kind)
    expect(kinds.filter((k) => k === 'script')).toHaveLength(1)
    expect(kinds.filter((k) => k === 'transform')).toHaveLength(3)
  })

  it('S17 — nouveau graphe ou bibliothèque modifiée : contexte reconstruit', async () => {
    const s = stubs()
    const e = engine(s)
    const script = "import { n } from 'lib/n.js'\nexport default (data) => [{ n, count: data.requirements.length }]"
    expect(await e.run('/repo', undefined, { script }, client)).toMatchObject({ ok: true, rows: [{ n: 7 }] })
    s.setLibrary({ 'lib/n.js': 'export const n = 8' }, 'h2')
    expect(await e.run('/repo', undefined, { script }, client)).toMatchObject({ ok: true, rows: [{ n: 8 }] })
    s.bumpGraph()
    expect(await e.run('/repo', undefined, { script }, client)).toMatchObject({ ok: true, rows: [{ n: 8, count: 3 }] })
  })

  it('S5 / S9 — boucle infinie interrompue sans bloquer l\'hôte ; moteur réutilisable', async () => {
    const e = engine(stubs(), { limits: { ...DEFAULT_SANDBOX_LIMITS, timeMs: 400 } })
    await e.run('/repo', undefined, { script: 'export default () => []' }, client) // worker démarré, contexte prêt
    let maxGap = 0
    let last = Date.now()
    const timer = setInterval(() => { const now = Date.now(); maxGap = Math.max(maxGap, now - last); last = now }, 10)
    const t0 = Date.now()
    const r = await e.run('/repo', undefined, { script: 'export default () => { for (;;) {} }' }, client)
    clearInterval(timer)
    expect(r).toMatchObject({ ok: false, error: { kind: 'timeout' } })
    expect(Date.now() - t0).toBeLessThan(3000)
    expect(maxGap).toBeLessThan(150)
    expect(await e.run('/repo', undefined, { script: 'export default () => [{ ok: true }]' }, client)).toMatchObject({ ok: true })
  })

  it('S6 — mémoire dépassée : erreur, puis moteur réutilisable', async () => {
    const e = engine(stubs(), { limits: { ...DEFAULT_SANDBOX_LIMITS, memoryBytes: 16 * 1024 * 1024, wasmMaxMb: 64 } })
    const r = await e.run('/repo', undefined, { script: 'export default () => { const a = []; for (;;) a.push(new Array(10000).fill(1)) }' }, client)
    expect(r).toMatchObject({ ok: false, error: { kind: 'memory' } })
    expect(await e.run('/repo', undefined, { script: 'export default () => [{ ok: true }]' }, client)).toMatchObject({ ok: true })
  })

  it('S8 — chien de garde : worker muet remplacé, erreur timeout', async () => {
    const mute = path.join(dir, 'mute-worker.js')
    fs.writeFileSync(mute, "require('worker_threads').parentPort.on('message', () => {})\n")
    const e = engine(stubs(), { workerPath: mute, watchdogGraceMs: 50, limits: { ...DEFAULT_SANDBOX_LIMITS, timeMs: 100 } })
    const t0 = Date.now()
    const r = await e.run('/repo', undefined, { script: 'export default () => []' }, client)
    expect(r).toMatchObject({ ok: false, error: { kind: 'timeout' } })
    expect(Date.now() - t0).toBeLessThan(2000)
  })
})
