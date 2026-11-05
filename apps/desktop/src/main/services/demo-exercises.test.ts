import { execFileSync } from 'child_process'
import { createRequire } from 'module'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { appServices, type AppServices } from '../../../../../scripts/demo-lave-linge/app-services'
import { GitService } from './git.service'
import { deleteWithTombstone } from './id-counter.util'

// GH278 — exercices des tutoriels qui dépendent des données de la démo ou attendent un refus (specs/GH278.md
// § 9.4), joués par les services sur une copie de la démo générée. Les messages cités par les tutoriels
// commencent par ces codes.

const ROOT = path.resolve(__dirname, '../../../../..')
const GENERATOR = path.join(ROOT, 'scripts/demo-lave-linge/generate.mjs')
const TSX_CLI = createRequire(__filename).resolve('tsx/cli')

let template: string
let copies: string[] = []

beforeAll(() => {
  template = fs.mkdtempSync(path.join(os.tmpdir(), 'gh278-ex-'))
  execFileSync(process.execPath, [TSX_CLI, GENERATOR, '--out', template, '--force'], { stdio: 'pipe' })
}, 300_000)

afterAll(() => { for (const d of [template, ...copies]) if (d) fs.rmSync(d, { recursive: true, force: true }) })

/** Copie neuve : chaque exercice part de la démo telle que publiée. */
async function demo(): Promise<{ ws: string; product: string; motor: string; app: AppServices }> {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'gh278-copy-'))
  copies.push(ws)
  fs.cpSync(template, ws, { recursive: true })
  const product = path.join(ws, 'll800-produit')
  const motor = path.join(ws, 'comp-moteur')
  execFileSync('git', ['config', 'user.name', 'Lecteur'], { cwd: product })
  execFileSync('git', ['config', 'user.email', 'lecteur@example.test'], { cwd: product })
  execFileSync('git', ['config', 'user.name', 'Lecteur'], { cwd: motor })
  execFileSync('git', ['config', 'user.email', 'lecteur@example.test'], { cwd: motor })
  const app = appServices('Lecteur')
  const built = await app.workspaceTree.buildTree(ws, product, [])
  if (built.status !== 'ok') throw new Error(JSON.stringify(built))
  await app.workspaceTree.writeCache(ws, built.tree)
  return { ws, product, motor, app }
}

describe('GH278 — exercices à refus', () => {
  it('tutoriel 9 : un label déjà pris est refusé', async () => {
    const { ws, product, app } = await demo()
    await expect(app.versions.create(product, { title: '1.0' }, ws)).rejects.toThrow(/^LABEL_TAKEN/)
    // Le label d'une version abandonnée se réutilise.
    await expect(app.versions.create(product, { title: '1.1' }, ws)).resolves.toMatchObject({ id: 'LLV-0004' })
  }, 60_000)

  it('tutoriel 9 : passage released refusé avec un élément non committé, accepté ensuite', async () => {
    const { ws, motor, app } = await demo()
    await app.versions.update(motor, 'MOTV-0002', { fields: { description: 'Essai' } }, ws)
    const file = path.join(motor, 'requirements/MOT-0007.yaml')
    fs.appendFileSync(file, '# modification\ndeferred: true\n')
    await expect(app.versions.release(motor, 'MOTV-0002', 'comp-moteur-1.3', ws)).rejects.toThrow(/^DIRTY_CHANGES/)
    execFileSync('git', ['add', '-A'], { cwd: motor })
    execFileSync('git', ['commit', '-qm', 'Correction'], { cwd: motor })
    const released = await app.versions.release(motor, 'MOTV-0002', 'comp-moteur-1.3', ws)
    expect(released.freeze?.tag).toBe('comp-moteur-1.3')
  }, 60_000)

  it('tutoriel 10 : signer VAL-0002 est refusé, tous les motifs listés', async () => {
    const { ws, product, app } = await demo()
    await expect(app.validations.sign(product, 'VAL-0002', ws)).rejects.toThrow(/^SIGNATURE_REFUSED.*VERSION_NOT_RELEASED.*DECISION_PENDING/)
  }, 60_000)

  it('tutoriel 10 : une validation signée ne se modifie plus', async () => {
    const { ws, product, app } = await demo()
    await expect(app.validations.decide(product, 'VAL-0001', { requirementId: 'PRD-0001', decision: 'hors_scope' }, ws)).rejects.toThrow(/VALIDATION_LOCKED/)
  }, 60_000)

  it('tutoriel 4 : un test du moteur reste hors des campagnes produit, il a sa campagne moteur', async () => {
    const { ws, product, motor, app } = await demo()
    // Le sélecteur de tests d'une campagne liste les tests du dépôt (`tests:list`).
    const offered = (await app.tests.findAll(product)).map(t => t.id)
    expect(offered).toContain('TSYS-0001')
    expect(offered.filter(id => id.startsWith('TMOT-'))).toEqual([])
    expect((await app.campaigns.get(motor, 'CMOT-0001')).runs.map(r => r.testCaseId)).toEqual(['TMOT-0003'])
  }, 60_000)

  it('tutoriel 4 : exécuter une campagne sans version testée est refusé', async () => {
    const { ws, product, app } = await demo()
    await expect(app.testedConfig.resolve(product, undefined, ws, { required: true })).rejects.toThrow(/TESTED_VERSION_REQUIRED/)
  }, 60_000)

  it('tutoriel 3 : passer en review une SYS sans énoncé est bloqué', async () => {
    const { ws, product, app } = await demo()
    const created = await app.requirements.create(product, { objectTypeRef: 'root::exigence-systeme', title: 'Essai', fields: {} } as never, ws)
    await expect(app.requirements.transition(product, created.id, { toStatus: 'review' }, ws)).rejects.toThrow(/TRANSITION_BLOCKED/)
  }, 60_000)
})

describe('GH278 — exercices à effet', () => {
  it('tutoriel 9 : inclure PRD-0006 dans LLV-0002 le sort du backlog', async () => {
    const { ws, product, app } = await demo()
    expect((await app.versions.backlog(product)).map(b => b.id)).toContain('PRD-0006')
    await app.versions.include(product, 'LLV-0002', ['PRD-0006'], ws)
    expect((await app.versions.backlog(product)).map(b => b.id)).not.toContain('PRD-0006')
  }, 60_000)

  it('tutoriel 9 : passer une ligne d\'analyse en « Modification à faire »', async () => {
    const { ws, product, app } = await demo()
    await app.versions.setImpact(product, 'LLV-0002', 'TSYS-0005', 'modification_a_faire', 'À rejouer', ws)
    const analysis = await app.versions.analysis(product, 'LLV-0002', ws)
    expect(analysis.rows.find(r => r.id === 'TSYS-0005')).toMatchObject({ status: 'modification_a_faire', comment: 'À rejouer' })
  }, 60_000)

  it('tutoriel 10 : créer une issue depuis un run en échec et l\'inclure', async () => {
    const { ws, product, app } = await demo()
    const issue = await app.issues.create(product, { objectTypeRef: 'root::issue', title: 'Essai', fields: {}, origin: { runs: ['TSYS-0005-run-0002'] } }, ws)
    expect(issue.id).toBe('ISS-0004')
    await app.versions.include(product, 'LLV-0002', [issue.id], ws)
    expect((await app.versions.get(product, 'LLV-0002')).changes?.map(c => c.id)).toContain('ISS-0004')
  }, 60_000)

  it('tutoriel 10 : confirmer une proposition, reprendre un « à revoir », décider une ligne', async () => {
    const { ws, product, app } = await demo()
    await app.validations.confirm(product, 'VAL-0002', 'SYS-0013', ws)
    await app.validations.decide(product, 'VAL-0002', { requirementId: 'PRD-0010', decision: 'conforme' }, ws)
    await app.validations.decide(product, 'VAL-0002', { requirementId: 'PRD-0006', decision: 'hors_scope', comment: 'Reporté' }, ws)
    await app.validations.decide(product, 'VAL-0002', { requirementId: 'PRD-0006', decision: 'conforme' }, ws)
    const page = await app.validations.page(product, 'VAL-0002', ws)
    expect(page.rows.find(r => r.requirementId === 'SYS-0013')?.entry?.proposed).toBeFalsy()
    expect(page.rows.find(r => r.requirementId === 'PRD-0006')?.review).toBeNull()
    expect(page.pendingCount).toBe(3)
  }, 60_000)

  it('tutoriel 3 : supprimer une exigence pose une pierre tombale, le numéro n\'est pas réutilisé', async () => {
    const { ws, product, app } = await demo()
    const next = await app.requirements.create(product, { objectTypeRef: 'root::exigence-systeme', title: 'Essai', fields: {} } as never, ws)
    expect(next.id).toBe('SYS-0016')
    await deleteWithTombstone(new GitService(), product, `requirements/${next.id}.yaml`, next.id)
    expect(fs.existsSync(path.join(product, '.polenta/tombstones/SYS-0016'))).toBe(true)
    const again = await app.requirements.create(product, { objectTypeRef: 'root::exigence-systeme', title: 'Essai', fields: {} } as never, ws)
    expect(again.id).toBe('SYS-0017')
  }, 60_000)
})
