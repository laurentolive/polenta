import { describe, expect, it } from 'vitest'

import type { ProjectSchema } from '@polenta/types'
import { validateBulkEntries } from './bulk-import-validation.util'
import { fieldValuesError } from './field-values.util'
import { planUpdate } from './update-validation.util'

// GH372 — valeurs des champs contrôlées à l'import (bulk_import_*) comme à la modification (update_*).

const SCHEMA = {
  version: 1,
  roles: [{ name: 'emetteur' }, { name: 'recepteur' }],
  nodes: [{
    name: 'root', label: 'Produit', objectTypes: [
      {
        name: 'exigence', label: 'Exigence', prefix: 'SYS', category: 'requirement',
        statuses: [{ name: 'brouillon' }, { name: 'valide', isApproval: true }],
        fields: [
          { name: 'priority', type: 'enum', values: ['high', 'medium', 'low'] },
          { name: 'dev_qualif', type: 'enum', values: ['DEV', 'QUALIF'] },
          { name: 'phases', type: 'multi_enum', values: ['P1', 'P2', 'P3'] },
          { name: 'roles', type: 'multi_enum', values: [] },
          { name: 'quantity', type: 'number' },
          { name: 'safety', type: 'boolean' },
          { name: 'due', type: 'date' },
          { name: 'free', type: 'enum' },
          { name: 'note', type: 'text' },
        ],
      },
      {
        name: 'test', label: 'Test', prefix: 'TEST', category: 'test', statuses: [{ name: 'a-ecrire' }],
        fields: [{ name: 'level', type: 'enum', values: ['unit', 'integration'] }],
      },
    ],
  }],
  linkTypes: [],
} as unknown as ProjectSchema

const typeDef = SCHEMA.nodes[0].objectTypes![0]
const check = (fields: Record<string, unknown>) => fieldValuesError(SCHEMA, typeDef, 'root::exigence', fields)

describe('fieldValuesError', () => {
  it('accepte des valeurs conformes, y compris la saisie de l\'éditeur (nombre en chaîne)', () => {
    expect(check({
      priority: 'high', phases: ['P1', 'P3'], quantity: '12.5', safety: false, due: '2026-02-28', note: 'x',
    })).toBeNull()
    expect(check({ quantity: 3, phases: 'P1, P2' })).toBeNull()
  })

  it('ignore les valeurs vides (obligation contrôlée ailleurs, null retire le champ)', () => {
    expect(check({ priority: null, quantity: '', phases: [], due: undefined })).toBeNull()
  })

  it('refuse un champ non déclaré par le type', () => {
    expect(check({ inconnu: 'x' })).toMatchObject({ field: 'inconnu', reason: expect.stringContaining('non déclaré') })
  })

  it('refuse une enum hors liste', () => {
    expect(check({ priority: '9' })).toMatchObject({ field: 'priority', reason: expect.stringContaining('"9" hors liste') })
    expect(check({ dev_qualif: 'X' })).toMatchObject({ field: 'dev_qualif' })
    expect(check({ priority: 9 })).toMatchObject({ field: 'priority' })
    expect(check({ priority: ['high'] })).toMatchObject({ field: 'priority' })
  })

  it('refuse une valeur inconnue dans un multi_enum, en liste ou en texte', () => {
    expect(check({ phases: ['P1', 'P9'] })).toMatchObject({ field: 'phases', reason: expect.stringContaining('"P9"') })
    expect(check({ phases: 'P1, P9' })).toMatchObject({ field: 'phases' })
    expect(check({ phases: [1] })).toMatchObject({ field: 'phases' })
  })

  it('multi_enum roles : liste lue dans le catalogue de rôles (T110)', () => {
    expect(check({ roles: ['emetteur'] })).toBeNull()
    expect(check({ roles: ['pilote'] })).toMatchObject({ field: 'roles' })
  })

  it('enum sans liste déclarée : pas de contrôle de liste', () => {
    expect(check({ free: 'n importe quoi' })).toBeNull()
  })

  it('refuse du texte dans un number', () => {
    expect(check({ quantity: 'douze' })).toMatchObject({ field: 'quantity', reason: expect.stringContaining('nombre attendu') })
    expect(check({ quantity: '12 kg' })).toMatchObject({ field: 'quantity' })
    expect(check({ quantity: true })).toMatchObject({ field: 'quantity' })
  })

  it('refuse un boolean ou une date mal formés', () => {
    expect(check({ safety: 'true' })).toMatchObject({ field: 'safety' })
    expect(check({ due: '28/02/2026' })).toMatchObject({ field: 'due' })
    expect(check({ due: '2026-02-30' })).toMatchObject({ field: 'due' })
  })
})

describe('bulk_import_* : les quatre cas du rapport sont refusés, par entrée', () => {
  const preview = () => 'SYS-0001'
  const entry = (fields: Record<string, unknown>) => ({ objectTypeRef: 'root::exigence', title: 't', fields })

  it('exigences : enum hors liste, multi_enum inconnu, texte dans number, champ non déclaré', () => {
    const { valid, errors } = validateBulkEntries(SCHEMA, [
      entry({ priority: '9' }),
      entry({ dev_qualif: 'X' }),
      entry({ phases: ['P1', 'P9'] }),
      entry({ quantity: 'abc' }),
      entry({ inconnu: 'x' }),
      entry({ priority: 'low', quantity: '4' }),
    ], preview)
    expect(errors.map(e => [e.index, e.field])).toEqual([
      [0, 'priority'], [1, 'dev_qualif'], [2, 'phases'], [3, 'quantity'], [4, 'inconnu'],
    ])
    expect(valid.map(v => v.index)).toEqual([5])
  })

  it('tests : même contrôle', () => {
    const { errors } = validateBulkEntries(SCHEMA, [{ objectTypeRef: 'root::test', fields: { level: 'system' } }], preview)
    expect(errors).toEqual([expect.objectContaining({ index: 0, field: 'level' })])
  })
})

describe('update_* : même règle que l\'import', () => {
  const existing = { objectTypeRef: 'root::exigence', title: 't', status: 'brouillon', fields: { priority: 'high' } }

  it('refuse le texte dans un number (non contrôlé avant GH372)', () => {
    expect(planUpdate(SCHEMA, 'requirement', existing, { id: 'SYS-0001', fields: { quantity: 'abc' } }))
      .toMatchObject({ ok: false, field: 'quantity' })
  })

  it('multi_enum roles contrôlé contre le catalogue de rôles (liste du champ seule lue avant GH372)', () => {
    expect(planUpdate(SCHEMA, 'requirement', existing, { id: 'SYS-0001', fields: { roles: ['recepteur'] } }))
      .toMatchObject({ ok: true })
    expect(planUpdate(SCHEMA, 'requirement', existing, { id: 'SYS-0001', fields: { roles: ['pilote'] } }))
      .toMatchObject({ ok: false, field: 'roles' })
  })
})
