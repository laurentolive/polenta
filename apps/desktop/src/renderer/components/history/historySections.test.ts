import { describe, expect, it } from 'vitest'

import { historySections } from './historySections'

// GH77 sprint 3 — mise en forme de la section « Historique » (scénarios H1, H2 de specs/GH77-tests.md).

const TYPE = {
  fields: [
    { name: 'statement', label: 'Énoncé', type: 'richtext' as const },
    { name: 'priority', label: 'Priorité', type: 'enum' as const },
  ],
  statuses: [{ name: 'draft', label: 'Brouillon' }, { name: 'review', label: 'En review' }],
}

describe('historySections', () => {
  const sections = historySections({
    legacy: [{ value: 'x', at: '2026-01-01T00:00:00Z' }],
    priority: [{ value: 'high', at: '2026-01-01T00:00:00Z' }, { value: null, at: '2026-01-02T00:00:00Z' }],
    status: [
      { value: 'draft', at: '2026-01-01T00:00:00Z', by: 'a', source: 'git' },
      { value: 'retired', at: '2026-01-03T00:00:00Z', by: 'b' },
      { value: 'review', at: '2026-01-03T00:00:00Z', by: 'c', implicit: true },
    ],
    statement: [{ at: '2026-01-02T00:00:00Z', by: 'a', source: 'mcp' }],
    empty: [],
  }, TYPE, { status: 'Statut' })

  it('H1 — ordre : statut, champs dans l\'ordre du schéma, clés inconnues ; listes vides omises', () => {
    expect(sections.map(s => [s.key, s.label])).toEqual([
      ['status', 'Statut'], ['statement', 'Énoncé'], ['priority', 'Priorité'], ['legacy', 'legacy'],
    ])
  })

  it('H2 — libellés de statut du schéma ; valeur retirée affichée brute ; plus récent d\'abord', () => {
    expect(sections[0].rows.map(r => [r.value, r.badges])).toEqual([
      ['En review', ['implicit']],
      ['retired', []],
      ['Brouillon', ['git']],
    ])
  })

  it('événement seul → value undefined ; champ vidé → null', () => {
    expect(sections[1].rows[0]).toMatchObject({ value: undefined, badges: ['mcp'] })
    expect(sections[2].rows[0].value).toBeNull()
  })

  it('statusLabel fourni (campagnes) prioritaire', () => {
    const s = historySections({ status: [{ value: 'planned', at: 'x' }] }, null, { status: 'S', statusLabel: n => `L:${n}` })
    expect(s[0].rows[0].value).toBe('L:planned')
  })
})
