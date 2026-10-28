import { describe, expect, it } from 'vitest'
import type { ObjectTypeDefinition } from '@polenta/types'
import { diffUnits, scalarLabel, statusLabel, unitChanged } from './objectUnits'

/** GH178 — unités du mode Rendu des vues de diff (specs/GH178-tests.md). */

const reqType = {
  name: 'exigence-systeme', label: 'Exigence', prefix: 'SYS', category: 'requirement',
  fields: [
    { name: 'priority', label: 'Priorité', type: 'enum', values: ['high', 'low'], valueLabels: { high: 'Haute' } },
    { name: 'statement', label: 'Énoncé', type: 'richtext' },
    { name: 'rationale', type: 'text' },
  ],
  statuses: [{ name: 'draft', label: 'Brouillon' }, { name: 'review', label: 'En review' }],
} as unknown as ObjectTypeDefinition

const testType = { ...reqType, category: 'test', fields: [] } as unknown as ObjectTypeDefinition

describe('diffUnits', () => {
  it('ordre : titre, statut, champs du schéma, hors schéma, autres racines ; identité et history exclus', () => {
    const before = {
      id: 'SYS-0001', objectTypeRef: 'root::exigence-systeme', title: 'T', status: 'draft', version: 1,
      fields: { statement: 'a', legacy: 'x' }, history: { status: [] },
    }
    const after = { ...before, status: 'review', needsRevalidation: true, fields: { statement: 'b', priority: 'high' } }
    const keys = diffUnits(before, after, reqType).map(u => u.key)
    expect(keys).toEqual([
      'title', 'status', 'fields.priority', 'fields.statement', 'fields.rationale', 'fields.legacy', 'version', 'needsRevalidation',
    ])
  })

  it('un test a préconditions, étapes et postconditions à leur place', () => {
    const keys = diffUnits({ title: 'T', steps: [] }, null, testType).map(u => u.key)
    expect(keys).toEqual(['title', 'status', 'preconditions', 'steps', 'postconditions'])
  })

  it('champ hors schéma : nom technique, rendu brut', () => {
    const u = diffUnits({ fields: { legacy: 1 } }, null, reqType).find(x => x.key === 'fields.legacy')
    expect(u).toMatchObject({ kind: 'raw', label: 'legacy' })
  })

  it('richtext du schéma rendu comme richtext, le reste comme champ', () => {
    const units = diffUnits(null, { fields: {} }, reqType)
    expect(units.find(u => u.key === 'fields.statement')?.kind).toBe('richtext')
    expect(units.find(u => u.key === 'fields.priority')?.kind).toBe('field')
  })
})

describe('unitChanged', () => {
  it('compare en profondeur ; absent d’un côté = changé', () => {
    const a = { status: 'draft', steps: [{ action: 'x' }], fields: { p: 'high' } }
    expect(unitChanged(a, { ...a, steps: [{ action: 'x' }] }, 'steps')).toBe(false)
    expect(unitChanged(a, { ...a, status: 'review' }, 'status')).toBe(true)
    expect(unitChanged(a, { ...a, fields: {} }, 'fields.p')).toBe(true)
    expect(unitChanged(null, a, 'title')).toBe(false)
  })
})

describe('libellés', () => {
  it('statut et valeurs d’enum par leur libellé, à défaut le nom technique', () => {
    expect(statusLabel(reqType, 'review')).toBe('En review')
    expect(statusLabel(reqType, 'unknown')).toBe('unknown')
    expect(scalarLabel(reqType.fields[0], 'high')).toBe('Haute')
    expect(scalarLabel(reqType.fields[0], 'low')).toBe('low')
    expect(scalarLabel({ name: 'm', type: 'multi_enum', valueLabels: { a: 'A' } }, 'a, b')).toBe('A, b')
    expect(scalarLabel({ name: 'n', type: 'number' }, 42)).toBe('42')
  })
})
