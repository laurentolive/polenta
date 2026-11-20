import { describe, expect, it } from 'vitest'
import { activeColumnFilters, matchesColumnFilters, purgeColumnFilters, type ColumnFilters } from './columnFilters'
import { NO_FILTER_OPTIONS } from '../../lib/textFilter'

// GH389 U1 — filtre par colonne, sur le texte affiché.
type Row = Record<string, string>
const rows: Row[] = [
  { id: 'SYS-001', decision: 'Conforme' },
  { id: 'SYS-002', decision: 'Non conforme' },
  { id: 'SW-001', decision: 'Conforme avec réserve' },
  { id: 'SYS-003', decision: 'conformité partielle' },
]
const text = (r: Row, key: string) => r[key] ?? ''
const opts = (o: Partial<typeof NO_FILTER_OPTIONS> = {}) => ({ ...NO_FILTER_OPTIONS, ...o })
const run = (filters: ColumnFilters, visible = ['id', 'decision']) => {
  const active = activeColumnFilters(filters, visible)
  return rows.filter(r => matchesColumnFilters(r, active, text)).map(r => r.id)
}

describe('GH389 U1 — columnFilters', () => {
  it('contient, insensible à la casse par défaut', () => {
    expect(run({ decision: { text: 'CONFORME', options: opts() } })).toEqual(['SYS-001', 'SYS-002', 'SW-001'])
  })

  it('casse respectée', () => {
    expect(run({ decision: { text: 'conform', options: opts({ caseSensitive: true }) } })).toEqual(['SYS-002', 'SYS-003'])
  })

  it('mot entier', () => {
    expect(run({ decision: { text: 'conforme', options: opts({ wholeWord: true }) } })).toEqual(['SYS-001', 'SYS-002', 'SW-001'])
    expect(run({ decision: { text: 'conform', options: opts({ wholeWord: true }) } })).toEqual([])
  })

  it('regex', () => {
    expect(run({ decision: { text: '^conf', options: opts({ regex: true }) } })).toEqual(['SYS-001', 'SW-001', 'SYS-003'])
  })

  it('regex invalide : n’exclut rien', () => {
    expect(run({ decision: { text: '(', options: opts({ regex: true }) } })).toHaveLength(4)
  })

  it('deux colonnes combinées en ET', () => {
    expect(run({
      decision: { text: '^conf', options: opts({ regex: true }) },
      id: { text: 'SYS', options: opts() },
    })).toEqual(['SYS-001', 'SYS-003'])
  })

  it('texte vide : pas de filtre', () => {
    expect(run({ decision: { text: '   ', options: opts() } })).toHaveLength(4)
  })

  it('colonne masquée : filtre ignoré puis purgé', () => {
    const filters: ColumnFilters = { decision: { text: 'Non', options: opts() }, id: { text: 'SYS', options: opts() } }
    expect(run(filters, ['id'])).toEqual(['SYS-001', 'SYS-002', 'SYS-003'])
    expect(purgeColumnFilters(filters, ['id'])).toEqual({ id: filters.id })
    expect(purgeColumnFilters(filters, ['id', 'decision'])).toBe(filters)
  })
})
