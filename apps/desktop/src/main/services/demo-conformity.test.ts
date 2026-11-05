import { execFileSync, spawnSync } from 'child_process'
import { createRequire } from 'module'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ProjectSchema, Validation } from '@polenta/types'
import { transitionRuleIssues, validationState, versionState } from '@polenta/types'
import { appServices, type AppServices } from '../../../../../scripts/demo-lave-linge/app-services'
import { flattenSystemNodes } from '@polenta/types'

// GH278 — la démo générée, relue par les services de l'application : rien que l'application refuserait,
// et chaque exemple annoncé par le guide et les tutoriels se trouve à l'endroit indiqué.

const ROOT = path.resolve(__dirname, '../../../../..')
const GENERATOR = path.join(ROOT, 'scripts/demo-lave-linge/generate.mjs')
const TSX_CLI = createRequire(__filename).resolve('tsx/cli')
const REPOS = ['if-bus-interne', 'comp-module-wifi', 'comp-pompe-vidange', 'comp-moteur', 'll800-produit']
const OBJECT_DIRS = ['requirements', 'tests', 'campaigns', 'versions', 'issues', 'validations', 'queries', 'dashboards']

let ws: string
let app: AppServices
const repo = (name: string) => path.join(ws, name)
const read = <T>(rel: string) => yaml.load(fs.readFileSync(path.join(ws, rel), 'utf-8')) as T
const list = (rel: string) => (fs.existsSync(path.join(ws, rel)) ? fs.readdirSync(path.join(ws, rel)) : [])
const gitIn = (name: string, ...args: string[]) => execFileSync('git', args, { cwd: repo(name), encoding: 'utf-8' }).trim()

beforeAll(async () => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'gh278-demo-'))
  execFileSync(process.execPath, [TSX_CLI, GENERATOR, '--out', ws, '--force'], { stdio: 'pipe' })
  app = appServices('conformité')
  const built = await app.workspaceTree.buildTree(ws, repo('ll800-produit'), [])
  expect(built.status, JSON.stringify(built)).toBe('ok')
  if (built.status === 'ok') await app.workspaceTree.writeCache(ws, built.tree)
}, 300_000)

afterAll(() => { if (ws) fs.rmSync(ws, { recursive: true, force: true }) })

describe('GH278 — générateur', () => {
  const generate = (...args: string[]) => spawnSync(process.execPath, [TSX_CLI, GENERATOR, ...args], { encoding: 'utf-8' })

  it('G1 — refuse un --out relatif au lecteur, sans valeur, ou dans le repo Polenta', () => {
    expect(generate('--out', 'C:Devdemo').stderr).toContain('relatif au lecteur')
    expect(generate('--out').stderr).toContain('attend un dossier')
    const inside = generate('--out', path.join(ROOT, 'apps'), '--force')
    expect(inside.stderr).toContain('dans le repo Polenta')
    expect(fs.existsSync(path.join(ROOT, 'apps/desktop/package.json'))).toBe(true)
  }, 60_000)
})

describe('GH278 — structure', () => {
  it('C1 — chaque schéma est accepté à l\'enregistrement, sans avertissement de transition', async () => {
    for (const name of REPOS) {
      const schema = read<ProjectSchema>(`${name}/.polenta/schema.yaml`)
      await expect(app.schema.save(repo(name), schema), name).resolves.toBeUndefined()
      for (const { node } of flattenSystemNodes(schema.nodes)) {
        for (const type of node.objectTypes ?? []) {
          expect(transitionRuleIssues({ ...type }), `${name} ${type.name}`).toEqual([])
        }
      }
    }
  })

  it('C2 — arbres sans `name` sur les éléments ; ID supprimé jamais réutilisé', () => {
    const scan = (n: { kind?: string; name?: string; children?: unknown[] }): void => {
      if (n.kind === 'item') expect(n.name).toBeUndefined()
      for (const c of n.children ?? []) scan(c as typeof n)
    }
    const tree = read<{ root: unknown[] }>('ll800-produit/.polenta/trees/root/exigence-systeme.yaml')
    tree.root.forEach(n => scan(n as Parameters<typeof scan>[0]))
    expect(list('ll800-produit/.polenta/tombstones')).toContain('SYS-0015')
    expect(fs.existsSync(path.join(repo('ll800-produit'), 'requirements/SYS-0015.yaml'))).toBe(false)
  })

  it('C3 — chaque campagne ne contient que les tests de son dépôt (#255)', () => {
    for (const name of REPOS) {
      for (const file of list(`${name}/campaigns`)) {
        const c = read<{ runs: Array<{ testCaseId: string }> }>(`${name}/campaigns/${file}`)
        for (const r of c.runs) expect(fs.existsSync(path.join(repo(name), `tests/${r.testCaseId}.yaml`)), `${file} ${r.testCaseId}`).toBe(true)
      }
    }
    expect(list('comp-moteur/campaigns')).toEqual(['CMOT-0001.yaml'])
  })

  it('C4 — vues d\'équipe au format attendu, reflets compris', () => {
    const views = read<{ version: number; views: Array<{ name: string; settings: { excel: string[] } }> }>('ll800-produit/.polenta/views/root/exigence-produit.yaml')
    expect(views.version).toBe(1)
    expect(views.views.map(v => v.name)).toEqual(['Revue marketing', 'Suivi de conformité'])
    expect(views.views[1].settings.excel).toEqual(expect.arrayContaining(['designStatus', 'validationStatus']))
  })

  it('C11 — les défauts annoncés restent présents', () => {
    const req = (id: string) => read<{ status: string; needsRevalidation?: boolean; fields: Record<string, unknown> }>(`ll800-produit/requirements/${id}.yaml`)
    expect(String(req('PRD-0012').fields.reference_client)).toBe('CLI-12')
    expect(String(req('SYS-0012').fields.statement)).toContain('{effort_fermeture_hublot}')
    const flagged = ['ll800-produit/requirements/PRD-0002', 'comp-moteur/requirements/MOT-0001', 'comp-moteur/requirements/MOT-0006', 'comp-module-wifi/requirements/WIFI-0004']
    for (const f of flagged) expect(read<{ needsRevalidation?: boolean }>(`${f}.yaml`).needsRevalidation, f).toBe(true)
    expect(read<{ result: string }>('comp-moteur/test-runs/TMOT-0003/TMOT-0003-run-0001.yaml').result).toBe('FAIL')
  })
})

describe('GH278 — objets du milestone D', () => {
  it('C5 — versions : états, tag sur le commit de gel, composants released', async () => {
    const expected: Record<string, Record<string, ['released' | 'in_progress' | 'abandoned', string?]>> = {
      'if-bus-interne': { 'IFV-0001': ['released', 'v1.1'] },
      'comp-module-wifi': { 'WIFV-0001': ['released', 'comp-module-wifi-1.0'] },
      'comp-pompe-vidange': { 'POMV-0001': ['released', 'comp-pompe-vidange-1.0'], 'POMV-0002': ['released', 'v2.0'] },
      'comp-moteur': { 'MOTV-0001': ['released', 'comp-moteur-1.2.4'], 'MOTV-0002': ['in_progress'] },
      'll800-produit': { 'LLV-0001': ['released', 'll800-produit-1.0'], 'LLV-0002': ['in_progress'], 'LLV-0003': ['abandoned'] },
    }
    for (const [name, versions] of Object.entries(expected)) {
      const typeDef = (await app.versions.versionType(repo(name)))?.typeDef ?? null
      const found = await app.versions.list(repo(name))
      expect(found.map(v => v.id), name).toEqual(Object.keys(versions))
      for (const v of found) {
        const [state, tag] = versions[v.id]
        expect(versionState(typeDef, v.status), v.id).toBe(state)
        if (!tag) continue
        expect(v.freeze?.tag).toBe(tag)
        expect(gitIn(name, 'rev-parse', '--verify', `${v.freeze!.sha}^{commit}`)).toBe(v.freeze!.sha)
        // Tag annoté posé sur le commit qui écrit la version released, enfant du commit gelé.
        expect(gitIn(name, 'cat-file', '-t', tag)).toBe('tag')
        expect(gitIn(name, 'rev-parse', `${tag}^{commit}~1`)).toBe(v.freeze!.sha)
      }
    }
    const product = await app.versions.page(repo('ll800-produit'), 'LLV-0001', ws)
    expect(product.components.map(c => [c.name, c.selected?.state])).toEqual([
      ['comp-moteur', 'released'], ['comp-pompe-vidange', 'released'], ['comp-module-wifi', 'released'],
    ])
    const frozen = await app.versions.analysis(repo('ll800-produit'), 'LLV-0001', ws)
    expect(frozen.frozen).toBe(true)
    expect(frozen.roots.length).toBeGreaterThan(0)
    const live = await app.versions.analysis(repo('ll800-produit'), 'LLV-0002', ws)
    expect(live.frozen).toBe(false)
    expect(live.rows.find(r => r.id === 'SYS-0002')?.status).toBe('impact_a_tester')
    expect(live.roots.find(r => r.elementId === 'PRD-0002')?.viaIssues).toContain('ISS-0003')
    expect((await app.versions.backlog(repo('ll800-produit'))).length).toBeGreaterThan(0)
  })

  it('C6 — validations signées : figées, sans « à revoir », signataire et date lus', async () => {
    for (const [name, id, signer] of [['ll800-produit', 'VAL-0001', 'Marc Dubois'], ['comp-moteur', 'VMOT-0001', 'Yann Petit']] as const) {
      const page = await app.validations.page(repo(name), id, ws)
      expect(page.state, id).toBe('signed')
      expect(page.frozen).toBe('copy')
      expect(page.signed?.by).toBe(signer)
      expect(page.signed?.at).toMatch(/^2026-06/)
      expect(page.rows.length).toBeGreaterThan(0)
      expect(page.rows.filter(r => r.entry && !r.entry.atSignature).map(r => r.requirementId)).toEqual([])
      expect(page.rows.filter(r => r.review).map(r => r.requirementId)).toEqual([])
    }
    const decisions = read<Validation>('ll800-produit/validations/VAL-0001.yaml').entries.map(e => e.decision)
    expect(new Set(decisions)).toEqual(new Set(['conforme', 'hors_scope', 'derogation']))
    const header = await app.validations.page(repo('ll800-produit'), 'VAL-0001', ws)
    expect(header.components.find(c => c.name === 'comp-moteur')).toBeTruthy()
  })

  it('C7 — validation en cours : en attente, proposée, à revoir, reprises', async () => {
    const page = await app.validations.page(repo('ll800-produit'), 'VAL-0002', ws)
    const typeDef = (await app.validations.validationType(repo('ll800-produit')))!.typeDef
    expect(validationState(typeDef, page.validation.status)).toBe('open')
    expect(page.pendingCount).toBeGreaterThan(0)
    const row = (id: string) => page.rows.find(r => r.requirementId === id)!
    expect(row('PRD-0010').decision).toBe('en_attente')
    expect(row('SYS-0013').entry?.proposed).toBe(true)
    expect(row('SYS-0001').entry?.carriedFrom).toBe('VAL-0001')
    // Impactée par une issue incluse dans la version : sa décision n'est pas reprise.
    expect(row('SYS-0004').decision).toBe('en_attente')
    expect(page.rows.filter(r => r.review).map(r => r.requirementId), 'à revoir').toContain('PRD-0006')
    expect(page.problems.map(p => p.code)).toEqual(expect.arrayContaining(['VERSION_NOT_RELEASED', 'DECISION_PENDING', 'DECISION_PROPOSED', 'DECISION_TO_REVIEW']))
  })

  it('C8 — issues : origine résolue, exigences impactées dans leur dépôt', async () => {
    const product = await app.issues.findAll(repo('ll800-produit'))
    expect(product.map(i => [i.id, i.status])).toEqual([['ISS-0001', 'corrigee'], ['ISS-0002', 'en_cours'], ['ISS-0003', 'ouverte']])
    const runFile = (name: string, runId: string) => path.join(repo(name), 'test-runs', runId.replace(/-run-.*/, ''), `${runId}.yaml`)
    for (const i of product.filter(x => x.origin?.runs)) for (const r of i.origin!.runs!) expect(fs.existsSync(runFile('ll800-produit', r)), r).toBe(true)
    expect(product[1].origin?.decisions).toEqual(['VAL-0001/SYS-0004'])
    const motor = await app.issues.findAll(repo('comp-moteur'))
    expect(motor[0].origin?.runs).toEqual(['TMOT-0003-run-0001'])
    const links = read<{ links: Array<{ type: string; sourceId: string; targetId: string }> }>('ll800-produit/links/links.yaml').links
    expect(links.filter(l => l.type === 'issue-impact').map(l => [l.sourceId, l.targetId])).toEqual([['ISS-0001', 'PRD-0004'], ['ISS-0002', 'SYS-0004'], ['ISS-0003', 'PRD-0002']])
  })

  it('C9 — runs de campagne après la première version : version testée, dont un écart', () => {
    const run = (test: string, n: number) => read<{ testedConfig?: { ref?: string; components?: Record<string, { undocumented?: string }> } }>(`ll800-produit/test-runs/${test}/${test}-run-${String(n).padStart(4, '0')}.yaml`)
    expect(run('TSYS-0001', 1).testedConfig).toBeUndefined()
    expect(run('TSYS-0004', 2).testedConfig?.ref).toBe('LLV-0002')
    expect(run('TSYS-0007', 2).testedConfig?.components?.['comp-moteur']?.undocumented).toBe('préversion 1.3-rc2')
  })
})

describe('GH278 — documentation', () => {
  it('C10 — tout ID cité dans le guide et les tutoriels existe dans la démo', () => {
    const known = new Set<string>()
    for (const name of REPOS) {
      for (const dir of OBJECT_DIRS) for (const f of list(`${name}/${dir}`)) known.add(f.replace(/\.yaml$/, ''))
      for (const f of list(`${name}/.polenta/tombstones`)) known.add(f)
    }
    // Exemples que le lecteur crée, ou objet de la branche d'étude.
    const created = new Set(['PRD-0014', 'SYS-0016', 'ISS-0004', 'LLV-0004', 'CAMP-0006'])
    const docs = [
      ...['docs/tutoriels', 'docs/tutorials'].flatMap(d => fs.readdirSync(path.join(ROOT, d)).filter(f => f.endsWith('.md')).map(f => path.join(ROOT, d, f))),
      path.join(repo('ll800-produit'), 'GUIDE-EVALUATION.md'),
    ]
    const missing: string[] = []
    for (const file of docs) {
      const text = fs.readFileSync(file, 'utf-8')
      for (const m of text.matchAll(/\b(?:PRD|SYS|TSYS|HYD|THYD|EV|CC|SW|TSW|BIHM|IHM|MOT|TMOT|FWM|POMP|TPOMP|WIFI|BUS|CAMP|CMOT|LLV|MOTV|POMV|WIFV|IFV|ISS|MISS|VAL|VMOT|QUERY|DASHBOARD)-\d{4}\b/g)) {
        if (!known.has(m[0]) && !created.has(m[0])) missing.push(`${path.basename(path.dirname(file))}/${path.basename(file)}: ${m[0]}`)
      }
    }
    expect([...new Set(missing)]).toEqual([])
  })
})
