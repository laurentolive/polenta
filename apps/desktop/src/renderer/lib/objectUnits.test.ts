import { describe, expect, it } from 'vitest'
import type { ObjectTypeDefinition } from '@polenta/types'
import { scalarLabel, statusLabel } from './objectUnits'

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
