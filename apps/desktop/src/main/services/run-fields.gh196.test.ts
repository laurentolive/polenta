import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ObjectTypeDefinition, ProjectSchema, TestCase, TestRun } from '@polenta/types'
import { convertFieldValue, prepareRunFields, runFieldIssues } from '@polenta/types'
import { GitService } from './git.service'
import { SchemaService, SchemaValidationError } from './schema.service'
import { TestsIndexService } from './tests-index.service'
import { TestsService } from './tests.service'

// GH196 — champs d'exécution (`runFields`) et d'étape (`stepFields`) : specs/GH196-tests.md.

const TN: ObjectTypeDefinition = {
  name: 'essai-normatif', label: 'Essai normatif', prefix: 'TN', category: 'test', fields: [],
  statuses: [{ name: 'draft' }, { name: 'approved', isApproval: true }],
  runFields: [
    { name: 'reportNumber', label: 'N° de rapport', type: 'text', requiredWhen: { result: ['FAIL'] } },
    { name: 'ambientTemp', label: 'Température ambiante', type: 'number' },
    { name: 'report', label: "Rapport d'essai", type: 'link', multiple: true },
    { name: 'bench', label: 'Banc', type: 'enum', values: ['B1', 'B2'] },
  ],
  stepFields: [{ name: 'measured', label: 'Valeur mesurée', type: 'number', requiredWhen: { result: ['PASS', 'FAIL'] } }],
}

const SCHEMA = { version: 1, nodes: [{ name: 'root', label: 'Produit', objectTypes: [TN] }], linkTypes: [] } as unknown as ProjectSchema

describe('convertFieldValue', () => {
  const def = (type: string, extra = {}) => ({ name: 'x', label: 'X', type, ...extra }) as never
  it('convertit selon le type', () => {
    expect(convertFieldValue(def('number'), '23,5')).toEqual({ ok: true, value: 23.5 })
    expect(convertFieldValue(def('number'), 'abc').ok).toBe(false)
    expect(convertFieldValue(def('boolean'), 'Oui')).toEqual({ ok: true, value: true })
    expect(convertFieldValue(def('boolean'), 'no')).toEqual({ ok: true, value: false })
    expect(convertFieldValue(def('enum', { values: ['B1'] }), 'B2').ok).toBe(false)
    expect(convertFieldValue(def('link'), 'RE | https://x')).toEqual({ ok: true, value: { label: 'RE', url: 'https://x' } })
    expect(convertFieldValue(def('text'), '  ')).toEqual({ ok: true, value: undefined })
  })

  it('dates normalisées ; cellule Excel (UTC) lue en heure locale ; texte illisible refusé', () => {
    expect(convertFieldValue(def('date'), '29/10/2026')).toEqual({ ok: true, value: '2026-10-29' })
    expect(convertFieldValue(def('date'), new Date(Date.UTC(2026, 9, 29)))).toEqual({ ok: true, value: '2026-10-29' })
    expect(convertFieldValue(def('date'), 'demain').ok).toBe(false)
    expect(convertFieldValue(def('date'), '31/02/2026').ok).toBe(false)
    expect(convertFieldValue(def('datetime'), new Date(Date.UTC(2026, 9, 29, 14, 0))))
      .toEqual({ ok: true, value: new Date(2026, 9, 29, 14, 0).toISOString() })
  })
})

describe('nom réservé', () => {
  it('un champ d\'exécution ne peut pas s\'appeler result', () => {
    const issues = runFieldIssues([{ name: 't', category: 'test', fields: [], stepFields: [{ name: 'result', type: 'enum', values: ['ok'] }] }])
    expect(issues.some(i => i.level === 'error' && /réservé/.test(i.message))).toBe(true)
  })
})

describe('prepareRunFields', () => {
  const steps = (r3: string, measured?: string) => [
    { order: 1, result: 'PASS', fields: { measured: '12' } },
    { order: 3, result: r3, ...(measured !== undefined && { fields: { measured } }) },
  ]

  it('FAIL sans n° de rapport : refus nommant le champ et le verdict', () => {
    const r = prepareRunFields(TN, { result: 'FAIL', fields: {}, stepResults: steps('FAIL', '13') })
    expect(r).toEqual({ ok: false, field: 'reportNumber', reason: '« N° de rapport » est obligatoire quand Verdict = Échoué' })
  })

  it('champs typés écrits sur le run et les étapes', () => {
    const r = prepareRunFields(TN, { result: 'FAIL', fields: { reportNumber: 'RE-118', ambientTemp: '23,5', bench: 'B1' }, stepResults: steps('FAIL', '13.1') })
    expect(r).toEqual({ ok: true, fields: { reportNumber: 'RE-118', ambientTemp: 23.5, bench: 'B1' }, stepFields: [{ measured: 12 }, { measured: 13.1 }] })
  })

  it('étape non exécutée : ni champ ni obligation ; étape exécutée sans valeur : refus « Étape 3 »', () => {
    const ok = prepareRunFields(TN, { result: 'INCOMPLETE', stepResults: steps('NOT_EXECUTED') })
    expect(ok).toEqual({ ok: true, fields: undefined, stepFields: [{ measured: 12 }, undefined] })
    const ko = prepareRunFields(TN, { result: 'PASS', stepResults: steps('PASS') })
    expect(ko).toMatchObject({ ok: false, field: 'measured', step: 3 })
    if (!ko.ok) expect(ko.reason).toMatch(/^Étape 3 : « Valeur mesurée » est obligatoire/)
  })

  it('clé inconnue et valeur illisible refusées', () => {
    expect(prepareRunFields(TN, { result: 'PASS', fields: { ghost: 'x' }, stepResults: [] })).toMatchObject({ ok: false, field: 'ghost' })
    expect(prepareRunFields(TN, { result: 'PASS', fields: { ambientTemp: 'chaud' }, stepResults: [] })).toMatchObject({ ok: false, field: 'ambientTemp' })
  })
})

describe('runFieldIssues (Q6 : nom unique dans le projet)', () => {
  const t = (name: string, extra: Partial<ObjectTypeDefinition>): ObjectTypeDefinition => ({ name, category: 'test', fields: [], ...extra })
  it('même nom, même liste, même type : accepté ; type ou liste différents : refus', () => {
    const f = { name: 'reportNumber', type: 'text' as const }
    expect(runFieldIssues([t('a', { runFields: [f] }), t('b', { runFields: [f] })])).toEqual([])
    expect(runFieldIssues([t('a', { runFields: [f] }), t('b', { runFields: [{ ...f, type: 'number' }] })])[0].level).toBe('error')
    expect(runFieldIssues([t('a', { runFields: [f] }), t('b', { stepFields: [f] })])[0].level).toBe('error')
  })

  it('hors type de test, drawio, requiredWhen sur un verdict inconnu', () => {
    expect(runFieldIssues([{ name: 'r', category: 'requirement', fields: [], runFields: [{ name: 'x', type: 'text' }] }])[0].level).toBe('error')
    expect(runFieldIssues([t('a', { runFields: [{ name: 'd', type: 'drawio' }] })])[0].level).toBe('error')
    expect(runFieldIssues([t('a', { stepFields: [{ name: 'm', type: 'number', requiredWhen: { result: ['INCOMPLETE'] } }] })])[0].level).toBe('warning')
  })
})

describe('écriture du run et schéma', () => {
  let dir: string
  let git: GitService
  let tests: TestsService

  beforeEach(async () => {
    dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh196-'))
    git = new GitService()
    await git.writeYaml(dir, '.polenta/schema.yaml', SCHEMA)
    const tc = { id: 'TN-0001', title: 'T', objectTypeRef: 'root::essai-normatif', status: 'approved', version: 1, fields: {}, steps: [{ order: 1 }, { order: 3 }] }
    await git.writeYaml(dir, 'tests/TN-0001.yaml', tc as unknown as TestCase)
    const schemaStub = { resolveComponentRepoPath: async () => null, get: async () => SCHEMA } as unknown as SchemaService
    tests = new TestsService(git, new TestsIndexService(git), schemaStub)
  })
  afterEach(async () => { await fsP.rm(dir, { recursive: true, force: true }) })

  const runFiles = async () => (await fsP.readdir(path.join(dir, 'test-runs', 'TN-0001')).catch(() => [])).length

  it('refus : aucun fichier de run écrit', async () => {
    await expect(tests.execute(dir, 'TN-0001', { stepResults: [{ order: 1, result: 'FAIL', comment: '', fields: { measured: '1' } }] }))
      .rejects.toThrow(/N° de rapport/)
    expect(await runFiles()).toBe(0)
  })

  it('verdict calculé depuis les étapes ; champs écrits', async () => {
    const run = await tests.execute(dir, 'TN-0001', {
      fields: { reportNumber: 'RE-118', report: 'RE-118 | https://ged/118' },
      stepResults: [{ order: 1, result: 'FAIL', comment: '', fields: { measured: '13,1' } }, { order: 3, result: 'NOT_EXECUTED', comment: '' }],
    })
    expect(run.result).toBe('FAIL')
    const onDisk = await git.readYaml<TestRun>(dir, `test-runs/TN-0001/${run.id}.yaml`)
    expect(onDisk?.fields).toEqual({ reportNumber: 'RE-118', report: [{ label: 'RE-118', url: 'https://ged/118' }] })
    expect(onDisk?.stepResults.map(s => s.fields)).toEqual([{ measured: 13.1 }, undefined])
  })

  it('schema:save refuse un nom réutilisé avec un autre type ; add_field list hors test refusé', async () => {
    const svc = new SchemaService({} as never)
    const other: ObjectTypeDefinition = { name: 'autre', prefix: 'TA', category: 'test', fields: [], runFields: [{ name: 'reportNumber', type: 'number' }] }
    const bad = { ...SCHEMA, nodes: [{ name: 'root', label: 'Produit', objectTypes: [TN, other] }] } as unknown as ProjectSchema
    await expect(svc.save(dir, bad)).rejects.toBeInstanceOf(SchemaValidationError)
    const req: ObjectTypeDefinition = { name: 'exigence', prefix: 'SYS', category: 'requirement', fields: [] }
    await svc.save(dir, { ...SCHEMA, nodes: [{ name: 'root', label: 'Produit', objectTypes: [TN, req] }] } as unknown as ProjectSchema)
    await expect(svc.addField(dir, { nodeName: 'root', typeName: 'exigence', field: { name: 'z', type: 'text' }, list: 'runFields' }))
      .rejects.toMatchObject({ code: 'RUN_FIELD_INVALID' })
    const updated = await svc.addField(dir, { nodeName: 'root', typeName: 'essai-normatif', field: { name: 'z', type: 'text' }, list: 'stepFields' })
    expect(updated.nodes[0].objectTypes?.[0].stepFields?.map(f => f.name)).toEqual(['measured', 'z'])
  })
})
