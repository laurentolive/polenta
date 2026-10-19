import { describe, expect, it } from 'vitest'
import type { ObjectTypeDefinition, TypeTreeNode } from '@polenta/types'
import { buildExportRows, getExportColumnLabel } from './exportColumns'

// GH70 — colonnes calculées dans les exports de la Vue Système (specs/GH70-tests.md N12) : la
// valeur vient des objets (fusionnée par `useComputedColumns`), le libellé de la déclaration.

const node = (id: string, objectId: string): TypeTreeNode => ({ id, kind: 'item', name: objectId, objectId, children: [] } as unknown as TypeTreeNode)
const typeDef = { name: 'cas-de-test', category: 'test', fields: [] } as unknown as ObjectTypeDefinition

describe('GH70 — colonnes calculées dans les exports', () => {
  it('N12 — libellé de la colonne et valeurs fusionnées', () => {
    const labels = new Map([['query::QUERY-0012', { label: 'Dernier résultat', type: 'enum' as const }]])
    const { columns, rows } = buildExportRows(
      ['id', 'query::QUERY-0012'],
      [node('n1', 'T1'), node('n2', 'T2')],
      [{ id: 'T1', title: 'a', 'query::QUERY-0012': 'FAIL' }, { id: 'T2', title: 'b', 'query::QUERY-0012': '' }],
      new Map(), undefined, typeDef, '', labels,
    )
    expect(columns).toEqual([{ key: 'id', label: 'ID' }, { key: 'query::QUERY-0012', label: 'Dernier résultat', type: 'enum' }])
    expect(rows).toEqual([{ id: 'T1', 'query::QUERY-0012': 'FAIL' }, { id: 'T2', 'query::QUERY-0012': '' }])
  })

  it('sans libellé fourni : la clé (comme un champ inconnu)', () => {
    expect(getExportColumnLabel('query::QUERY-0099', typeDef)).toBe('query::QUERY-0099')
  })
})
