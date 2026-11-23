import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ObjectTypeDefinition, ProjectSchema, TestCampaign, TestCase, TestRun } from '@polenta/types'
import { mergeCampaignInputs, prepareRunFields, runFieldIssues } from '@polenta/types'
import { CampaignsService } from './campaigns.service'
import { GitService } from './git.service'
import type { SchemaService } from './schema.service'
import { TestsIndexService } from './tests-index.service'
import { TestsService } from './tests.service'

// GH428 — champs d'exécution « renseigné en campagne » : specs/GH428-tests.md (S*, C*, X*).

const TYPE: ObjectTypeDefinition = {
  name: 'essai-gh428', label: 'Essai GH428', prefix: 'G4', category: 'test', fields: [],
  statuses: [{ name: 'draft' }, { name: 'approved', isApproval: true }],
  runFields: [
    { name: 'criticite', label: 'Criticité', type: 'enum', values: ['critique', 'regression', 'information'], campaignInput: true },
    { name: 'quantite', label: 'Quantité', type: 'number', required: true, campaignInput: true },
    { name: 'reportNumber', label: 'N° de rapport', type: 'text' },
  ],
}

const SCHEMA = { version: 1, nodes: [{ name: 'root', label: 'Produit', readonly: false, objectTypes: [TYPE] }], linkTypes: [] } as unknown as ProjectSchema

function runFieldsOf(list: Partial<ObjectTypeDefinition>): ObjectTypeDefinition {
  return { ...TYPE, ...list }
}

describe('règles de schéma (GH428 S1–S4)', () => {
  const issuesOf = (defs: Partial<ObjectTypeDefinition>) => runFieldIssues([runFieldsOf(defs)]).map(i => i.message)

  it('S1 : champ d\'exécution de type admis, sans erreur', () => {
    expect(issuesOf({})).toEqual([])
  })
  it('S2 : « renseigné en campagne » sur stepFields refusé', () => {
    const msgs = issuesOf({ runFields: [], stepFields: [{ name: 'mesure', type: 'number', campaignInput: true }] })
    expect(msgs.join(' ')).toMatch(/n'existe que pour un champ d'exécution/)
  })
  it('S3 : type non admis (richtext) refusé', () => {
    const msgs = issuesOf({ runFields: [{ name: 'notes', type: 'richtext', campaignInput: true }] })
    expect(msgs.join(' ')).toMatch(/non admis pour un champ renseigné en campagne/)
  })
  it('S4 : sans la propriété, aucune nouvelle erreur', () => {
    expect(issuesOf({ runFields: [{ name: 'notes', type: 'richtext' }] })).toEqual([])
  })
})

describe('fusion des valeurs d\'entrée (GH428 §2.2)', () => {
  it('reprend la valeur de l\'entrée quand la saisie ne la donne pas', () => {
    expect(mergeCampaignInputs(TYPE.runFields!, { criticite: 'critique' }, { reportNumber: 'RE-1' }))
      .toEqual({ criticite: 'critique', reportNumber: 'RE-1' })
  })
  it('la saisie (dto) l\'emporte sur la valeur de l\'entrée', () => {
    expect(mergeCampaignInputs(TYPE.runFields!, { quantite: '12.5' }, { quantite: '20' })).toEqual({ quantite: '20' })
  })
  it('une valeur de saisie vide reprend l\'entrée (cellule vide du classeur)', () => {
    expect(mergeCampaignInputs(TYPE.runFields!, { quantite: '12.5' }, { quantite: '' })).toEqual({ quantite: '12.5' })
  })
  it('rien à écrire quand ni l\'entrée ni la saisie n\'ont de valeur', () => {
    expect(mergeCampaignInputs(TYPE.runFields!, undefined, undefined)).toBeUndefined()
  })
  it('X3 : champ obligatoire absent après fusion : refus', () => {
    const merged = mergeCampaignInputs(TYPE.runFields!, {}, {})
    const prepared = prepareRunFields(TYPE, { result: 'PASS', fields: merged, stepResults: [] })
    expect(prepared.ok).toBe(false)
    if (!prepared.ok) expect(prepared.reason).toMatch(/Quantité/)
  })
  it('X2 : la valeur saisie est convertie comme un champ de run', () => {
    const merged = mergeCampaignInputs(TYPE.runFields!, { quantite: '12,5' }, undefined)
    const prepared = prepareRunFields(TYPE, { result: 'PASS', fields: merged, stepResults: [] })
    expect(prepared.ok && prepared.fields).toEqual({ quantite: 12.5 })
  })
})

describe('saisie et exécution avec entrée de campagne (GH428 C*, X*)', () => {
  let dir: string
  let git: GitService
  let tests: TestsService
  let campaigns: CampaignsService

  const tc = { id: 'G4-0001', title: 'Essai', projectId: '', branchId: '', objectTypeRef: 'root::essai-gh428', status: 'approved', version: 1, fields: {}, steps: [{ order: 1, action: 'Mesurer', expectedResult: '', notes: '' }] } as unknown as TestCase

  async function writeCampaign(runs: TestCampaign['runs'] = [entry()]): Promise<void> {
    await git.writeYaml(dir, 'campaigns/CAMP-0001.yaml', {
      title: 'Campagne', fields: {}, status: 'planned', createdAt: '2026-11-23T00:00:00.000Z', completedAt: null,
      testCaseIds: ['G4-0001'], runs,
    } as unknown as TestCampaign)
  }
  function entry(extra: Partial<TestCampaign['runs'][number]> = {}): TestCampaign['runs'][number] {
    return { entryId: 'G4-0001-1', testCaseId: 'G4-0001', status: 'pending', testSnapshot: tc, ...extra } as TestCampaign['runs'][number]
  }
  const campaignFile = async () => git.readYaml<TestCampaign>(dir, 'campaigns/CAMP-0001.yaml')
  const runFiles = async () => (await fsP.readdir(path.join(dir, 'test-runs', 'G4-0001')).catch(() => [])).sort()
  const runOn = async (name: string) => git.readYaml<TestRun>(dir, `test-runs/G4-0001/${name}`)

  beforeEach(async () => {
    dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh428-'))
    git = new GitService()
    await git.writeYaml(dir, '.polenta/schema.yaml', SCHEMA)
    await git.writeYaml(dir, 'tests/G4-0001.yaml', tc)
    const schemaStub = { resolveComponentRepoPath: async () => null, get: async () => SCHEMA } as unknown as SchemaService
    tests = new TestsService(git, new TestsIndexService(git), schemaStub)
    campaigns = new CampaignsService(git, tests, undefined, schemaStub)
    await writeCampaign()
  })
  afterEach(async () => { await fsP.rm(dir, { recursive: true, force: true }) })

  describe('saisie en campagne', () => {
    it('C1 : nombre à virgule converti et stocké', async () => {
      await campaigns.updateRunInputs(dir, 'CAMP-0001', 'G4-0001-1', { quantite: '12,5' })
      expect((await campaignFile())?.runs[0].runInputs).toEqual({ quantite: '12.5' })
    })
    it('C2 : champ qui n\'est pas « renseigné en campagne » refusé, campagne inchangée', async () => {
      await expect(campaigns.updateRunInputs(dir, 'CAMP-0001', 'G4-0001-1', { reportNumber: 'RE-1' })).rejects.toThrow(/n'est pas un champ d'exécution renseigné en campagne/)
      expect((await campaignFile())?.runs[0].runInputs).toBeUndefined()
    })
    it('C3 : valeur d\'enum hors liste refusée, campagne inchangée', async () => {
      await expect(campaigns.updateRunInputs(dir, 'CAMP-0001', 'G4-0001-1', { criticite: 'inconnue' })).rejects.toThrow(/valeurs : critique, regression, information/)
      expect((await campaignFile())?.runs[0].runInputs).toBeUndefined()
    })
    it('C4 : valeur vide retire la clé', async () => {
      await campaigns.updateRunInputs(dir, 'CAMP-0001', 'G4-0001-1', { quantite: '3', criticite: 'critique' })
      await campaigns.updateRunInputs(dir, 'CAMP-0001', 'G4-0001-1', { quantite: '3' })
      expect((await campaignFile())?.runs[0].runInputs).toEqual({ quantite: '3' })
    })
    it('C5 : entrée inconnue (ou retirée) refusée', async () => {
      await expect(campaigns.updateRunInputs(dir, 'CAMP-0001', 'G4-9999-1', { quantite: '3' })).rejects.toThrow(/not found/)
    })
    it('C6 : entrée déjà exécutée : saisie acceptée, aucun run modifié', async () => {
      const run = await tests.execute(dir, 'G4-0001', { fields: { quantite: '5' }, stepResults: [{ order: 1, result: 'PASS', comment: '' }], campaignEntry: { campaignId: 'CAMP-0001', entryId: 'G4-0001-1' } })
      const before = await runOn(`${run.id}.yaml`)
      await campaigns.updateRunInputs(dir, 'CAMP-0001', 'G4-0001-1', { quantite: '9' })
      expect((await campaignFile())?.runs[0].runInputs).toEqual({ quantite: '9' })
      expect(await runOn(`${run.id}.yaml`)).toEqual(before)
    })
  })

  describe('exécution', () => {
    const stepResults = [{ order: 1, result: 'PASS' as const, comment: '' }]
    const link = { campaignId: 'CAMP-0001', entryId: 'G4-0001-1' }

    it('X1 : valeurs de l\'entrée figées dans le run', async () => {
      await campaigns.updateRunInputs(dir, 'CAMP-0001', 'G4-0001-1', { criticite: 'critique', quantite: '12,5' })
      const run = await tests.execute(dir, 'G4-0001', { stepResults, campaignEntry: link })
      expect((await runOn(`${run.id}.yaml`))?.fields).toEqual({ criticite: 'critique', quantite: 12.5 })
    })
    it('X2 : la saisie d\'exécution (import classeur) l\'emporte et est figée', async () => {
      await campaigns.updateRunInputs(dir, 'CAMP-0001', 'G4-0001-1', { quantite: '12,5' })
      const run = await tests.execute(dir, 'G4-0001', { stepResults, fields: { quantite: '20' }, campaignEntry: link })
      expect((await runOn(`${run.id}.yaml`))?.fields).toEqual({ quantite: 20 })
    })
    it('X3 : entrée obligatoire absente : refus, aucun run écrit', async () => {
      await expect(tests.execute(dir, 'G4-0001', { stepResults, campaignEntry: link })).rejects.toThrow(/Quantité/)
      expect(await runFiles()).toEqual([])
    })
    it('X4 : modifier l\'entrée après un run ne touche pas le run', async () => {
      await campaigns.updateRunInputs(dir, 'CAMP-0001', 'G4-0001-1', { quantite: '12' })
      const run = await tests.execute(dir, 'G4-0001', { stepResults, campaignEntry: link })
      const before = await runOn(`${run.id}.yaml`)
      await campaigns.updateRunInputs(dir, 'CAMP-0001', 'G4-0001-1', { quantite: '99' })
      expect(await runOn(`${run.id}.yaml`)).toEqual(before)
    })
    it('X5 : retest de la même entrée : le nouveau run porte la nouvelle valeur', async () => {
      await campaigns.updateRunInputs(dir, 'CAMP-0001', 'G4-0001-1', { quantite: '12' })
      await tests.execute(dir, 'G4-0001', { stepResults, campaignEntry: link })
      await campaigns.updateRunInputs(dir, 'CAMP-0001', 'G4-0001-1', { quantite: '99' })
      const second = await tests.execute(dir, 'G4-0001', { stepResults, campaignEntry: link })
      expect((await runOn(`${second.id}.yaml`))?.fields).toEqual({ quantite: 99 })
    })
    it('X6 : exécution hors campagne : aucune lecture d\'entrée, saisie seule', async () => {
      const run = await tests.execute(dir, 'G4-0001', { stepResults, fields: { quantite: '7' } })
      expect((await runOn(`${run.id}.yaml`))?.fields).toEqual({ quantite: 7 })
    })
  })
})
