import { execFileSync } from 'child_process'
import { createRequire } from 'module'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { QuickJSWASMModule } from 'quickjs-emscripten-core'
import type { GraphRow, PolentaHost } from '@polenta/types'
import { buildHost } from '@polenta/types'
import { createSandboxModule, SandboxContext } from './script-sandbox'
import type { LibraryModules } from './script-limits'
import { GraphService } from './graph.service'
import { GitService } from './git.service'
import { AuthService } from './auth.service'
import { RequirementsIndexService } from './requirements-index.service'
import { TestsIndexService } from './tests-index.service'
import { SyncService } from './sync.service'
import { PolentaRepoService } from './polenta-repo.service'
import { WorkspaceTreeService } from './workspace-tree.service'
import { SchemaService } from './schema.service'
import { TraceabilityService } from './traceability.service'
import { CampaignsService } from './campaigns.service'
import { TestsService } from './tests.service'
import { TreeService } from './tree.service'
import { HistoryService } from './history.service'
import { RevalidationService } from './revalidation.service'
import { DashboardsService } from './dashboards.service'
import { SavedQueriesService } from './saved-queries.service'
import { CAMPAIGN_SEED_QUERIES, CAMPAIGN_SEED_WIDGETS, STATUS_SEED_QUERIES, STATUS_SEED_WIDGETS } from './dashboard-seed.service'
import { applyQueryTemplate, applyWidgetTemplate } from './suivi-store.util'
import { ROOT, WS, fixtureServices } from './graph-fixture.test-util'
import { inflatedGraphJson } from './suivi-corpus.test-util'
import { SHIPPED_DIR } from '../../../scripts/dashboard-lib-manifest'

// GH74 §12 — corpus de non-régression de la vue Suivi. Sur trois jeux (projet de démonstration
// généré, projet minimal, jeu gonflé ×50), chaque widget des dashboards de la démo et des seeds est
// exécuté (script + transformation, bibliothèque de départ) et ses lignes sont comparées à une
// référence JSON versionnée (`fixtures/suivi-corpus/`, mise à jour par `vitest -u`). Toute évolution
// du contrat, d'un modèle ou de la bibliothèque apparaît dans le diff des références.
// Budgets de performance (§12) vérifiés sur les mêmes exécutions.

const NOW = new Date('2026-10-13T12:00:00Z')
const HOST: PolentaHost = buildHost({ locale: 'fr', timezone: 'Europe/Paris' }, 1, NOW)
const LIB: LibraryModules = Object.fromEntries(
  fs.readdirSync(SHIPPED_DIR).filter((f) => f.endsWith('.js')).map((f) => [`lib/${f}`, fs.readFileSync(path.join(SHIPPED_DIR, f), 'utf8')]),
)
const REFS = path.join(__dirname, 'fixtures', 'suivi-corpus')
const DEMO_GENERATOR = path.resolve(__dirname, '../../../../../scripts/demo-lave-linge/generate.mjs')
/** Le générateur importe les modèles TypeScript : lancé par tsx (Node 20 sans type stripping). */
const TSX_CLI = createRequire(__filename).resolve('tsx/cli')

interface WidgetCase { name: string; script: string; transform?: string }

/** Widgets des dashboards pré-configurés (Status, Campagnes), code généré comme par l'application. */
const SEED_CASES: WidgetCase[] = [
  ...STATUS_SEED_WIDGETS.map((w) => ({
    name: `Status / ${w.title}`,
    script: applyQueryTemplate(STATUS_SEED_QUERIES.find((q) => q.key === w.queryKey)!.template).script,
    transform: applyWidgetTemplate(w.template).code.transform,
  })),
  ...CAMPAIGN_SEED_WIDGETS.map((w) => ({
    name: `Campagnes / ${w.queryKey}`,
    script: applyQueryTemplate(CAMPAIGN_SEED_QUERIES.find((q) => q.key === w.queryKey)!.template).script,
    transform: applyWidgetTemplate(w.template).code.transform,
  })),
]
const seedCase = (name: string) => SEED_CASES.find((c) => c.name === name)!

/** Lignes de chaque widget (script puis transformation) ; une erreur est une valeur de la référence. */
function runCases(ctx: SandboxContext, cases: WidgetCase[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const c of cases) {
    const script = ctx.runScript(c.script, HOST)
    if (!script.ok) { out[c.name] = { error: script.error }; continue }
    if (!c.transform) { out[c.name] = script.rows; continue }
    const t = ctx.runTransform(c.transform, script.rows, HOST, `${c.name}.js`)
    out[c.name] = t.ok ? t.rows : { error: t.error }
  }
  return out
}

/** Temps médian (ms) d'une exécution script + transformation sur un contexte déjà préparé. */
function medianMs(ctx: SandboxContext, c: WidgetCase, runs = 5): number {
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    const r = ctx.runScript(c.script, HOST)
    if (!r.ok) throw new Error(JSON.stringify(r.error))
    if (c.transform) {
      const t = ctx.runTransform(c.transform, r.rows as GraphRow[], HOST, 'transform.js')
      if (!t.ok) throw new Error(JSON.stringify(t.error))
    }
    times.push(performance.now() - t0)
  }
  return times.sort((a, b) => a - b)[Math.floor(runs / 2)]
}

/** Référence lisible en diff : une ligne de résultat par ligne de texte. */
function json(cases: Record<string, unknown>): string {
  const body = Object.entries(cases).map(([name, value]) => {
    const rows = Array.isArray(value)
      ? (value.length ? `[\n${value.map((r) => `    ${JSON.stringify(r)}`).join(',\n')}\n  ]` : '[]')
      : JSON.stringify(value)
    return `  ${JSON.stringify(name)}: ${rows}`
  })
  return `{\n${body.join(',\n')}\n}\n`
}

/** Services réels du main sur un workspace du disque (comme le serveur MCP), horloge figée. */
async function realGraph(repoPath: string, workspaceDir: string): Promise<{ json: string; dashboards: DashboardsService; queries: SavedQueriesService }> {
  const auth = new AuthService({ userDataDir: os.tmpdir() } as never)
  const git = new GitService()
  const reqIndex = new RequirementsIndexService(git)
  const testsIndex = new TestsIndexService(git)
  const sync = new SyncService(auth)
  const workspaceTree = new WorkspaceTreeService(sync, new PolentaRepoService())
  const schema = new SchemaService(auth, workspaceTree)
  const history = new HistoryService(git, async () => ({ by: 'corpus', source: 'mcp' }))
  const revalidation = new RevalidationService(git, reqIndex, testsIndex, schema, workspaceTree, history)
  const tests = new TestsService(git, testsIndex, schema, new TreeService(), revalidation, history)
  const campaigns = new CampaignsService(git, tests, undefined, schema, history)
  const traceability = new TraceabilityService(reqIndex, testsIndex, git, sync, workspaceTree)
  const built = await workspaceTree.buildTree(workspaceDir, repoPath, [])
  if (built.status === 'ok') await workspaceTree.writeCache(workspaceDir, built.tree)
  else throw new Error(`Arbre du workspace de démo : ${JSON.stringify(built)}`)
  const graph = new GraphService(reqIndex, testsIndex, schema, traceability, git, workspaceTree, campaigns, { cache: false, now: () => NOW })
  const dashboards = new DashboardsService(git)
  return { json: (await graph.build(repoPath, workspaceDir)).json, dashboards, queries: new SavedQueriesService(git, dashboards) }
}

let qjs: QuickJSWASMModule
beforeAll(async () => { qjs = await createSandboxModule() })

describe('GH74 — corpus : projet de démonstration (scripts/demo-lave-linge)', () => {
  let ws: string
  let ctx: SandboxContext
  let demoCases: WidgetCase[]

  beforeAll(async () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'gh74-corpus-demo-'))
    try {
      execFileSync(process.execPath, [TSX_CLI, DEMO_GENERATOR, '--out', ws, '--force'], { stdio: 'pipe' })
    } catch (err) {
      throw new Error(`Génération de la démo en échec : ${String((err as { stderr?: Buffer }).stderr ?? err)}`)
    }
    const repoPath = path.join(ws, 'll800-produit')
    const { json: graphJson, dashboards, queries } = await realGraph(repoPath, ws)
    ctx = SandboxContext.prepare(qjs, graphJson, LIB)
    // Dashboards partagés de la démo, lus par les services de l'application (format v1).
    const savedQueries = await queries.list(repoPath, 'corpus')
    demoCases = []
    for (const d of await dashboards.list(repoPath, 'corpus')) {
      expect(d.state.readOnly).toBeUndefined()
      for (const w of d.widgets) {
        expect(w.state.customized, `${d.title} / ${w.title} : code généré par son modèle`).toBe(false)
        const q = savedQueries.find((x) => x.id === w.queryId)!
        expect(q.state.readOnly).toBeUndefined()
        demoCases.push({ name: `${d.title} / ${w.title}`, script: q.script, transform: w.transform })
      }
    }
  }, 180_000)
  afterAll(() => {
    ctx?.dispose()
    if (ws) fs.rmSync(ws, { recursive: true, force: true })
  })

  it('C1 — dashboards de la démo et des seeds : lignes identiques aux références', async () => {
    expect(demoCases).toHaveLength(9)
    await expect(json(runCases(ctx, demoCases))).toMatchFileSnapshot(path.join(REFS, 'demo-dashboards.json'))
    await expect(json(runCases(ctx, SEED_CASES))).toMatchFileSnapshot(path.join(REFS, 'demo-seeds.json'))
  })

  it('C2 — budget : avancement des campagnes < 200 ms (contexte préparé)', () => {
    expect(medianMs(ctx, seedCase('Campagnes / progress'))).toBeLessThan(200)
    expect(medianMs(ctx, seedCase('Campagnes / timeline'))).toBeLessThan(200)
  })
})

describe('GH74 — corpus : projet minimal (fixture)', () => {
  it('C3 — widgets des seeds : lignes identiques aux références', async () => {
    const s = fixtureServices()
    const graph = new GraphService(s.reqIndex, s.testsIndex, s.schema, s.traceability, s.git, s.workspaceTree, s.campaigns, { now: () => NOW })
    const ctx = SandboxContext.prepare(qjs, (await graph.build(ROOT, WS)).json, LIB)
    try {
      await expect(json(runCases(ctx, SEED_CASES))).toMatchFileSnapshot(path.join(REFS, 'minimal-seeds.json'))
    } finally {
      ctx.dispose()
    }
  })
})

describe('GH74 — corpus : jeu gonflé ×50', () => {
  let ctx: SandboxContext
  beforeAll(() => { ctx = SandboxContext.prepare(qjs, inflatedGraphJson(), LIB) })
  afterAll(() => ctx?.dispose())

  it('C4 — widgets du seed Campagnes : lignes identiques aux références', async () => {
    const cases = SEED_CASES.filter((c) => c.name.startsWith('Campagnes /'))
    await expect(json(runCases(ctx, cases))).toMatchFileSnapshot(path.join(REFS, 'x50-campaigns.json'))
  })

  it('C5 — budget : avancement des campagnes < 1 s (contexte préparé)', () => {
    expect(medianMs(ctx, seedCase('Campagnes / progress'))).toBeLessThan(1000)
    expect(medianMs(ctx, seedCase('Campagnes / timeline'))).toBeLessThan(1000)
  })
})
