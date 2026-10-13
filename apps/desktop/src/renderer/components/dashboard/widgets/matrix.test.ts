import { describe, expect, it } from 'vitest'
import { aggregateCell, buildMatrix } from './matrix'

// Jeu de référence de specs/GH69-tests.md (Q1, triée par campaignCreatedAt).
const Q1 = [
  { testCaseId: 'TEST-0002', testTitle: 'Démarrage', campaignId: 'CAMP-A', status: 'PASS' },
  { testCaseId: 'TEST-0003', testTitle: 'Charge', campaignId: 'CAMP-A', status: 'FAIL' },
  { testCaseId: 'TEST-0002', testTitle: 'Démarrage', campaignId: 'CAMP-B', status: 'PASS' },
  { testCaseId: 'TEST-0002', testTitle: 'Démarrage', campaignId: 'CAMP-B', status: 'FAIL' },
  { testCaseId: 'TEST-0003', testTitle: 'Charge', campaignId: 'CAMP-B', status: 'pending' },
  { testCaseId: 'TEST-0010', testTitle: 'Turbo', campaignId: 'CAMP-B', status: 'PASS' },
  { testCaseId: 'TEST-0003', testTitle: 'Charge', campaignId: 'CAMP-C', status: 'BLOCKED' },
  { testCaseId: 'TEST-0003', testTitle: 'Charge', campaignId: 'CAMP-C', status: 'PASS' },
  { testCaseId: 'TEST-0010', testTitle: 'Turbo', campaignId: 'CAMP-C', status: 'PASS' },
  { testCaseId: 'TEST-0010', testTitle: 'Turbo', campaignId: 'CAMP-C', status: 'PASS' },
]
const MAPPING = { category: 'testCaseId', series: 'campaignId', measure: 'status', label: 'testTitle' }

describe('buildMatrix (GH69)', () => {
  const m = buildMatrix(Q1, MAPPING)

  it('colonnes dans l’ordre du résultat, lignes en ordre naturel avec libellé', () => {
    expect(m.columns.map((c) => c.key)).toEqual(['CAMP-A', 'CAMP-B', 'CAMP-C'])
    expect(m.rows.map((r) => [r.key, r.label])).toEqual([
      ['TEST-0002', 'Démarrage'],
      ['TEST-0003', 'Charge'],
      ['TEST-0010', 'Turbo'],
    ])
  })

  it('pire statut + compteur + répartition', () => {
    expect(m.cell('TEST-0002', 'CAMP-B')).toEqual({ kind: 'status', status: 'FAIL', count: 2, breakdown: { PASS: 1, FAIL: 1 } })
    expect(m.cell('TEST-0003', 'CAMP-C')).toMatchObject({ kind: 'status', status: 'BLOCKED', count: 2 })
    expect(m.cell('TEST-0010', 'CAMP-C')).toMatchObject({ kind: 'status', status: 'PASS', count: 2 })
    expect(m.cell('TEST-0003', 'CAMP-B')).toMatchObject({ kind: 'status', status: 'pending', count: 1 })
  })

  it('test absent d’une campagne → cellule vide', () => {
    expect(m.cell('TEST-0010', 'CAMP-A')).toEqual({ kind: 'empty' })
    expect(m.cell('TEST-0002', 'CAMP-C')).toEqual({ kind: 'empty' })
  })

  it('l’ordre des colonnes suit le résultat (ORDER BY … DESC)', () => {
    expect(buildMatrix([...Q1].reverse(), MAPPING).columns.map((c) => c.key)).toEqual(['CAMP-C', 'CAMP-B', 'CAMP-A'])
  })

  it('tri naturel insensible à la casse', () => {
    const rows = ['TEST-0002', 'TEST-0010', 'TEST-0003', 'test-0001'].map((id) => ({ id, c: 'X', v: 1 }))
    expect(buildMatrix(rows, { category: 'id', series: 'c', measure: 'v' }).rows.map((r) => r.key)).toEqual([
      'test-0001', 'TEST-0002', 'TEST-0003', 'TEST-0010',
    ])
  })

  it('null en ligne/colonne regroupé sous « — », lignes « — » en dernier, valeur brute conservée', () => {
    const rows = [
      { r: null, c: null, v: 1 },
      { r: 'A', c: 'X', v: 1 },
      { r: undefined, c: 'X', v: 2 },
    ]
    const mx = buildMatrix(rows, { category: 'r', series: 'c', measure: 'v' })
    expect(mx.rows.map((r) => r.key)).toEqual(['A', '—'])
    expect(mx.rows[1].raw).toBeNull()
    expect(mx.columns.map((c) => c.key)).toEqual(['—', 'X'])
    expect(mx.cell('—', 'X')).toEqual({ kind: 'number', value: 2, count: 1 })
  })

  it('colonne absente du résultat : tout sous « — », sans exception', () => {
    const mx = buildMatrix(Q1, { category: 'testCaseId', series: 'nope', measure: 'status' })
    expect(mx.columns.map((c) => c.key)).toEqual(['—'])
    expect(mx.cell('TEST-0002', '—')).toMatchObject({ kind: 'status', status: 'FAIL', count: 3 })
  })

  it('libellé de ligne = dernière occurrence (titre le plus récent d’une requête chronologique)', () => {
    const rows = [
      { id: 'TEST-0002', t: 'Ancien titre', c: 'CAMP-A', s: 'PASS' },
      { id: 'TEST-0002', t: 'Nouveau titre', c: 'CAMP-B', s: 'PASS' },
    ]
    expect(buildMatrix(rows, { category: 'id', series: 'c', measure: 's', label: 't' }).rows[0].label).toBe('Nouveau titre')
  })

  it('résultat vide → matrice vide', () => {
    const mx = buildMatrix([], MAPPING)
    expect(mx.rows).toEqual([])
    expect(mx.columns).toEqual([])
  })
})

describe('aggregateCell (GH69)', () => {
  it('somme des nombres, chaînes numériques comprises', () => {
    expect(aggregateCell([3, '4'])).toEqual({ kind: 'number', value: 7, count: 2 })
  })

  it('textes : valeurs distinctes jointes', () => {
    expect(aggregateCell(['alice', 'bob', 'alice'])).toEqual({ kind: 'text', value: 'alice, bob', count: 3 })
  })

  it('statut mêlé à du texte libre → texte, sans couleur', () => {
    expect(aggregateCell(['PASS', 'xxx'])).toEqual({ kind: 'text', value: 'PASS, xxx', count: 2 })
  })

  it('booléens → texte, pas de somme', () => {
    expect(aggregateCell([true, false])).toMatchObject({ kind: 'text' })
  })

  it('statut en casse différente (pass) n’est pas un statut', () => {
    expect(aggregateCell(['pass'])).toMatchObject({ kind: 'text' })
  })
})
