import { describe, expect, it } from 'vitest'
import type { CampaignTestRun, ParamResolutionPreview, TestCampaign, TestCase, TestRunStatus } from '@polenta/types'
import {
  DEFAULT_CARRY_STATUSES, buildCarryRows, carriedReqIds, carryCoverage, countCarryInstances, initialCarryValues,
  isCarryComplete, pickCarried, sourceCampaigns, targetKeysOf, toCarriedSelection, versionChanged, withCarryPrecedence,
  type CarryEligibility,
} from './carryOver'

// GH64 — logique de l'onglet « Depuis une campagne » (scénarios L1–L9 de specs/GH64-tests.md).

function testCase(id: string, extra: Partial<TestCase> = {}): TestCase {
  return { id, title: `Titre ${id}`, objectTypeRef: 'root::test', status: 'approved', version: 1, fields: {}, ...extra } as unknown as TestCase
}

function run(entryId: string, status: TestRunStatus, extra: Partial<CampaignTestRun> = {}): CampaignTestRun {
  const testCaseId = entryId.replace(/-\d+$/, '')
  return { entryId, testCaseId, status, testSnapshot: testCase(testCaseId), ...extra }
}

function campaign(id: string, createdAt: string, runs: CampaignTestRun[], status: TestCampaign['status'] = 'completed'): TestCampaign {
  return { id, title: id, fields: {}, status, testCaseIds: runs.map(r => r.testCaseId), runs, createdAt }
}

function preview(id: string, extra: Partial<ParamResolutionPreview> = {}): ParamResolutionPreview {
  return { testCaseId: id, resolved: {}, manual: [], unresolved: [], ...extra }
}

const CAMP1 = campaign('CAMP-0001', '2026-09-01T00:00:00.000Z', [
  run('TEST-0001-1', 'PASS'),
  run('TEST-0002-1', 'pending', { paramValues: { tension: '12V' } }),
  run('TEST-0002-2', 'BLOCKED', { paramValues: { tension: '24V' } }),
  run('TEST-0003-1', 'FAIL', { requirementId: 'SYS-0001' }),
  run('TEST-0003-2', 'pending', { requirementId: 'SYS-0002' }),
  run('TEST-0004-1', 'INCOMPLETE'),
])

const TESTS = new Map(['TEST-0001', 'TEST-0002', 'TEST-0003'].map(id => [id, testCase(id)]))
TESTS.set('TEST-0004', testCase('TEST-0004', { status: 'draft' }))

const PREVIEWS = new Map<string, ParamResolutionPreview>([
  ['TEST-0001', preview('TEST-0001')],
  ['TEST-0002', preview('TEST-0002', { manual: ['tension'] })],
  ['TEST-0003', preview('TEST-0003', {
    requirements: ['SYS-0001', 'SYS-0002'].map(r => ({ requirementId: r, title: r, resolved: {}, unresolved: [] })),
  })],
  ['TEST-0004', preview('TEST-0004')],
])

// GH68 — à l'ajout, tout statut est éligible (plus de filtre d'approbation).
const addEligibility = (): CarryEligibility => 'ok'

function rows(overrides: Partial<Parameters<typeof buildCarryRows>[0]> = {}) {
  return buildCarryRows({
    sources: [CAMP1],
    statuses: DEFAULT_CARRY_STATUSES,
    testsById: TESTS,
    isEligible: addEligibility,
    previews: PREVIEWS,
    targetKeys: new Set(),
    ...overrides,
  })
}

describe('buildCarryRows (GH64)', () => {
  it('L1 — filtre par défaut : pending / BLOCKED / INCOMPLETE, ni PASS ni FAIL', () => {
    expect(rows().map(r => r.entryId)).toEqual(['TEST-0002-1', 'TEST-0002-2', 'TEST-0003-2', 'TEST-0004-1'])
  })

  it('L2 — FAIL ajouté au filtre', () => {
    expect(rows({ statuses: [...DEFAULT_CARRY_STATUSES, 'FAIL'] }).map(r => r.entryId))
      .toEqual(['TEST-0002-1', 'TEST-0002-2', 'TEST-0003-1', 'TEST-0003-2', 'TEST-0004-1'])
  })

  it('L3 — ajout : test non approuvé disponible (GH68)', () => {
    expect(TESTS.get('TEST-0004')?.status).not.toBe('approved')
    expect(rows().find(r => r.testCaseId === 'TEST-0004')?.unavailable).toBeUndefined()
    expect(rows().filter(r => r.unavailable)).toHaveLength(0)
  })

  it('L4 — création : test hors périmètre indisponible', () => {
    const r = rows({ isEligible: tc => (tc.id === 'TEST-0002' ? 'outOfScope' : 'ok') })
    expect(r.filter(x => x.testCaseId === 'TEST-0002').map(x => x.unavailable)).toEqual(['outOfScope', 'outOfScope'])
  })

  it('L5 — test supprimé', () => {
    const tests = new Map(TESTS)
    tests.delete('TEST-0002')
    const r = rows({ testsById: tests }).filter(x => x.testCaseId === 'TEST-0002')
    expect(r.map(x => [x.unavailable, x.liveVersion])).toEqual([['deleted', undefined], ['deleted', undefined]])
  })

  it('L5b — exigence plus liée (lue à la baseline cible)', () => {
    const previews = new Map(PREVIEWS)
    previews.set('TEST-0003', preview('TEST-0003', { requirements: [{ requirementId: 'SYS-0001', title: '', resolved: {}, unresolved: [] }] }))
    expect(rows({ previews }).find(r => r.entryId === 'TEST-0003-2')?.unavailable).toBe('reqUnlinked')
  })

  it('L6 — même clé dans deux campagnes : une ligne, la plus récente, les autres signalées', () => {
    const camp2 = campaign('CAMP-0002', '2026-10-01T00:00:00.000Z', [
      run('TEST-0002-1', 'pending', { paramValues: { tension: '12V' } }),
    ], 'in_progress')
    const camp1 = campaign('CAMP-0001', '2026-09-01T00:00:00.000Z', [
      run('TEST-0002-3', 'BLOCKED', { paramValues: { tension: '12V' }, executedAt: '2026-10-05T00:00:00.000Z' }),
    ])
    const r = rows({ sources: [camp1, camp2] })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ campaignId: 'CAMP-0001', entryId: 'TEST-0002-3', otherSources: ['CAMP-0002'] })
  })

  it('L7 — déjà présent dans la cible', () => {
    const targetKeys = targetKeysOf([run('TEST-0002-1', 'pending', { paramValues: { tension: ' 12V' } })])
    const r = rows({ targetKeys })
    expect(r.find(x => x.entryId === 'TEST-0002-1')?.unavailable).toBe('alreadyPresent')
    expect(r.find(x => x.entryId === 'TEST-0002-2')?.unavailable).toBeUndefined()
  })

  it('L8 — test modifié depuis la source : avertissement, toujours disponible', () => {
    const tests = new Map(TESTS)
    tests.set('TEST-0002', testCase('TEST-0002', { version: 3 }))
    const r = rows({ testsById: tests }).find(x => x.entryId === 'TEST-0002-1')!
    expect([r.sourceVersion, r.liveVersion, r.unavailable, versionChanged(r)]).toEqual([1, 3, undefined, true])
  })

  it('L9 — entrée pré-T49 sans copie : pas d\'avertissement de version', () => {
    const old = campaign('CAMP-0000', '2026-01-01T00:00:00.000Z', [{ entryId: 'TEST-0001-1', testCaseId: 'TEST-0001', status: 'pending' }])
    const r = rows({ sources: [old] })[0]
    expect([r.sourceVersion, versionChanged(r)]).toEqual([undefined, false])
  })
})

describe('sélection du report (GH64)', () => {
  it('campagnes source : sans la cible, plus récente d\'abord', () => {
    const a = campaign('CAMP-0001', '2026-09-01T00:00:00.000Z', [])
    const b = campaign('CAMP-0002', '2026-10-01T00:00:00.000Z', [])
    const c = campaign('CAMP-0003', '2026-10-02T00:00:00.000Z', [])
    expect(sourceCampaigns([a, b, c], 'CAMP-0003').map(x => x.id)).toEqual(['CAMP-0002', 'CAMP-0001'])
  })

  it('valeurs pré-remplies depuis la source, limitées aux références à saisir', () => {
    const row = rows().find(r => r.entryId === 'TEST-0002-2')!
    expect(initialCarryValues({ ...row, paramValues: { tension: '24V', ancien: 'x' } }, PREVIEWS.get('TEST-0002'))).toEqual({ tension: '24V' })
  })

  it('entrées retenues : valeurs éditées, exigence gardée, complétude et nombre d\'instances', () => {
    const selected = rows().filter(r => !r.unavailable)
    const edited = { [selected[0].key]: { tension: '' } }
    const picked = pickCarried(selected, PREVIEWS, { values: edited, reqSel: {} }, () => new Set())
    expect(picked.map(c => [c.entryId, c.requirementId, c.paramValues])).toEqual([
      ['TEST-0002-1', undefined, { tension: '' }],
      ['TEST-0002-2', undefined, { tension: '24V' }],
      ['TEST-0003-2', 'SYS-0002', undefined],
      // GH68 — test non approuvé : reporté comme les autres.
      ['TEST-0004-1', undefined, undefined],
    ])
    expect(isCarryComplete(picked, PREVIEWS)).toBe(false)
    expect(isCarryComplete(pickCarried(selected, PREVIEWS, { values: {}, reqSel: {} }, () => new Set()), PREVIEWS)).toBe(true)
    expect(countCarryInstances(picked)).toBe(4)
    expect(toCarriedSelection(picked)[2]).toEqual({ campaignId: 'CAMP-0001', entryId: 'TEST-0003-2' })
  })

  it('entrée sans exigence d\'un test devenu itérant : toutes les exigences non présentes par défaut', () => {
    const old = campaign('CAMP-0000', '2026-01-01T00:00:00.000Z', [run('TEST-0003-1', 'pending')])
    const selected = rows({ sources: [old] })
    const picked = pickCarried(selected, PREVIEWS, { values: {}, reqSel: {} }, () => new Set(['SYS-0001']))
    expect(picked[0].reqInstances).toEqual([{ requirementId: 'SYS-0002', paramValues: {} }])
    expect(countCarryInstances(picked)).toBe(1)
  })

  it('priorité sur l\'onglet Tests : test sans paramètre et exigences reportées', () => {
    const camp = campaign('CAMP-0005', '2026-10-01T00:00:00.000Z', [
      run('TEST-0001-1', 'pending'),
      run('TEST-0002-1', 'pending', { paramValues: { tension: '5V' } }),
      run('TEST-0003-1', 'pending', { requirementId: 'SYS-0001' }),
    ])
    const picked = pickCarried(rows({ sources: [camp] }), PREVIEWS, { values: {}, reqSel: {} }, () => new Set())
    const coverage = carryCoverage(picked, PREVIEWS)
    expect([...coverage.tests]).toEqual(['TEST-0001'])
    expect([...(coverage.reqs.get('TEST-0003') ?? [])]).toEqual(['SYS-0001'])

    // Appliquée à l'envoi, sans toucher à la sélection de l'onglet Tests.
    const selection = ['TEST-0001', 'TEST-0002', 'TEST-0003']
    const precedence = withCarryPrecedence(selection, () => new Set(['SYS-0009']), coverage)
    expect(precedence.testIds).toEqual(['TEST-0002', 'TEST-0003'])
    expect([...precedence.presentOf('TEST-0003')].sort()).toEqual(['SYS-0001', 'SYS-0009'])
    expect(selection).toEqual(['TEST-0001', 'TEST-0002', 'TEST-0003'])
  })

  it('entrée sans exigence : exigences prises par une autre entrée reportée exclues, rien retenu → omise', () => {
    const old = campaign('CAMP-0000', '2026-01-01T00:00:00.000Z', [run('TEST-0003-1', 'pending')])
    const sources = [CAMP1, old]
    const selected = rows({ sources }).filter(r => r.testCaseId === 'TEST-0003')
    const taken = carriedReqIds(selected)
    expect([...(taken.get('TEST-0003') ?? [])]).toEqual(['SYS-0002'])
    const picked = pickCarried(selected, PREVIEWS, { values: {}, reqSel: {} }, id => taken.get(id) ?? new Set())
    expect(picked.map(c => [c.campaignId, c.requirementId, c.reqInstances?.map(r => r.requirementId)])).toEqual([
      ['CAMP-0001', 'SYS-0002', undefined],
      ['CAMP-0000', undefined, ['SYS-0001']],
    ])
    const row = selected.find(r => r.campaignId === 'CAMP-0000')!
    const none = pickCarried([row], PREVIEWS, { values: {}, reqSel: { [row.key]: {} } }, () => new Set())
    expect(none).toEqual([])
  })
})
