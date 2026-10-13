import { describe, expect, it } from 'vitest'
import {
  compareProgressKeys, entryProgress, isProgressKey, prepStatusOrder, progressRank, progressSubject,
} from '@polenta/types'
import type { CampaignTestRun, ProjectSchema, TestCase } from '@polenta/types'

// GH71 — étape d'avancement d'une entrée de campagne (scénarios P1–P8 de specs/GH71-tests.md).

const tc = (id: string, status: string, objectTypeRef = 'root::test') => ({ id, status, objectTypeRef } as unknown as TestCase)
const isApproved = (t: TestCase) => t.status === 'valide'
const run = (testCaseId: string, status: CampaignTestRun['status'], snapshot?: TestCase): CampaignTestRun =>
  ({ entryId: `${testCaseId}-1`, testCaseId, status, ...(snapshot && { testSnapshot: snapshot }) })
const progressOf = (r: CampaignTestRun, live?: TestCase, open = true) =>
  entryProgress(r, progressSubject(r, live, open, isApproved), isApproved)

const SCHEMA = {
  nodes: [
    { name: 'root', objectTypes: [{ name: 'test', category: 'test', fields: [], statuses: [{ name: 'draft' }, { name: 'review' }, { name: 'valide', isApproval: true }] }] },
    { name: 'comp', objectTypes: [{ name: 'essai', category: 'test', fields: [], statuses: [{ name: 'brouillon' }, { name: 'relecture' }, { name: 'valide', isApproval: true }] }] },
  ],
} as unknown as ProjectSchema

describe('campaign-progress', () => {
  it('P1 — étapes de la campagne de référence', () => {
    expect([
      progressOf(run('A', 'pending', tc('A', 'draft')), tc('A', 'draft')),
      progressOf(run('B', 'pending', tc('B', 'review')), tc('B', 'review')),
      progressOf(run('C', 'pending', tc('C', 'valide')), tc('C', 'valide')),
      progressOf(run('D', 'PASS', tc('D', 'valide')), tc('D', 'valide')),
      progressOf(run('E', 'FAIL', tc('E', 'valide')), tc('E', 'valide')),
    ]).toEqual(['prep:draft', 'prep:review', 'ready', 'PASS', 'FAIL'])
  })

  it('P2 — entrée exécutée sur une copie brouillon : son résultat', () => {
    expect(progressOf(run('A', 'BLOCKED', tc('A', 'draft')), tc('A', 'draft'))).toBe('BLOCKED')
  })

  it('P3 — copie brouillon, test passé en revue : live si la campagne est ouverte, copie sinon', () => {
    const r = run('A', 'pending', tc('A', 'draft'))
    expect(progressOf(r, tc('A', 'review'), true)).toBe('prep:review')
    expect(progressOf(r, tc('A', 'review'), false)).toBe('prep:draft')
  })

  it('P4 — copie approuvée, test repassé brouillon : prêt (copie figée, T49)', () => {
    expect(progressOf(run('C', 'pending', tc('C', 'valide')), tc('C', 'draft'))).toBe('ready')
  })

  it('P5 — entrée pré-T49 : live ; ni copie ni live : prêt', () => {
    expect(progressOf(run('A', 'pending'), tc('A', 'draft'))).toBe('prep:draft')
    expect(progressOf(run('A', 'pending'), undefined)).toBe('ready')
  })

  it('P6 — rangs : préparation (ordre du schéma), inconnu, prêt, résultats, hors étape', () => {
    const ranks = [
      progressRank('prep:draft', 0), progressRank('prep:review', 1), progressRank('prep:inconnu'),
      progressRank('ready'), progressRank('INCOMPLETE'), progressRank('BLOCKED'), progressRank('FAIL'),
      progressRank('PASS'), progressRank('component-x'),
    ]
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)
    expect(new Set(ranks).size).toBe(ranks.length)
  })

  it('P7 — deux types de test : ordre par rang dans le type, puis par nom', () => {
    const order = prepStatusOrder(SCHEMA)
    expect([order.get('draft'), order.get('brouillon'), order.get('review'), order.get('relecture')]).toEqual([0, 0, 1, 1])
    const keys = ['PASS', 'prep:review', 'ready', 'prep:relecture', 'prep:draft', 'prep:brouillon', 'prep:obsolete-inconnu']
    expect([...keys].sort(compareProgressKeys(order))).toEqual([
      'prep:brouillon', 'prep:draft', 'prep:relecture', 'prep:review', 'prep:obsolete-inconnu', 'ready', 'PASS',
    ])
  })

  it('P8 — isProgressKey', () => {
    expect(['prep:x', 'ready', 'PASS', 'INCOMPLETE'].every(isProgressKey)).toBe(true)
    expect(['prep:', 'pending', '', 42, null].some(isProgressKey)).toBe(false)
  })
})
