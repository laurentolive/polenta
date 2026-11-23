import { describe, expect, it } from 'vitest'

import type { ExecutionHistoryRow, ProjectSchema, TestRun } from '@polenta/types'
import { campaignRunFieldDefs, lastRunFieldsByEntry, uniqueTypeRefs } from './campaignRunFields'

// GH428 — colonnes « champs d'exécution » et dernier run de chaque entrée de campagne (R1, R2).

const SCHEMA = {
  version: 1,
  nodes: [{
    name: 'root', label: 'Produit', readonly: false,
    objectTypes: [
      { name: 'essai', category: 'test', fields: [], statuses: [], runFields: [
        { name: 'criticite', type: 'enum', values: ['critique'], campaignInput: true },
        { name: 'rapport', type: 'text' },
      ] },
      { name: 'autre', category: 'test', fields: [], statuses: [], runFields: [
        { name: 'criticite', type: 'enum', values: ['critique'], campaignInput: true },
        { name: 'temperature', type: 'number' },
      ] },
    ],
  }],
  linkTypes: [],
} as unknown as ProjectSchema

describe('colonnes des champs d\'exécution (R1)', () => {
  it('union des runFields des types, par nom, dans l\'ordre de déclaration', () => {
    const names = campaignRunFieldDefs(SCHEMA, ['root::essai', 'root::autre']).map(f => f.name)
    expect(names).toEqual(['criticite', 'rapport', 'temperature'])
  })

  it('type inconnu : aucune colonne', () => {
    expect(campaignRunFieldDefs(SCHEMA, ['root::inconnu'])).toEqual([])
  })

  it('refs sans doublon ni valeur absente', () => {
    expect(uniqueTypeRefs(['root::essai', undefined, 'root::essai', 'root::autre'])).toEqual(['root::essai', 'root::autre'])
  })
})

function row(entryId: string, executedAt: string, fields: Record<string, unknown>, campaignId = 'CAMP-0001'): ExecutionHistoryRow {
  return {
    key: `run-${executedAt}`, kind: 'run', testCaseId: 'T-1', testTitle: 'T', objectTypeRef: 'root::essai',
    run: { id: `T-1-run-${executedAt}`, executedAt, fields } as unknown as TestRun,
    campaign: { id: campaignId, title: 'C', status: 'in_progress', fields: {} },
    entry: { entryId },
  }
}

describe('dernier run de chaque entrée (R2)', () => {
  it('garde le run le plus récent de chaque entrée', () => {
    const rows = [
      row('T-1-1', '2026-11-20T10:00:00.000Z', { rapport: 'ancien' }),
      row('T-1-1', '2026-11-22T10:00:00.000Z', { rapport: 'récent' }),
      row('T-1-2', '2026-11-21T10:00:00.000Z', { rapport: 'autre entrée' }),
    ]
    const last = lastRunFieldsByEntry(rows, 'CAMP-0001')
    expect(last.get('T-1-1')).toEqual({ rapport: 'récent' })
    expect(last.get('T-1-2')).toEqual({ rapport: 'autre entrée' })
  })

  it('ignore les runs d\'une autre campagne et les lignes en attente', () => {
    const pending: ExecutionHistoryRow = { key: 'pending:x', kind: 'pending', testCaseId: 'T-1', testTitle: 'T', objectTypeRef: 'root::essai', entry: { entryId: 'T-1-1' } }
    const last = lastRunFieldsByEntry([row('T-1-1', '2026-11-22T10:00:00.000Z', { rapport: 'autre' }, 'CAMP-0002'), pending], 'CAMP-0001')
    expect(last.size).toBe(0)
  })
})
