import { describe, expect, it } from 'vitest'

import { applyHistory, effectiveHistory, hasHistoryGap, renameFieldKeys, trackedKeys, withoutHistory } from '@polenta/types'
import type { HistoryCarrier, ObjectTypeDefinition } from '@polenta/types'

// GH77 — logique pure de l'historique (scénarios P1–P17 de specs/GH77-tests.md).

const TYPE: ObjectTypeDefinition = {
  name: 'exigence', category: 'requirement',
  fields: [
    { name: 'priority', type: 'enum', values: ['high', 'medium', 'low'], trackHistory: true },
    { name: 'statement', type: 'richtext', trackHistory: true },
    { name: 'tags', type: 'multi_enum', values: ['a', 'b', 'c'], trackHistory: true },
    { name: 'owner', type: 'user' },
  ],
}

const NOW = new Date('2026-10-13T10:00:00.123Z')
const AT = '2026-10-13T10:00:00Z'
const actor = { by: 'lolive' }
const obj = (status: string, fields: Record<string, unknown> = {}, history?: HistoryCarrier['history']): HistoryCarrier =>
  ({ status, fields, ...(history && { history }) })

describe('trackedKeys', () => {
  it('suit le statut par défaut et les champs trackHistory, avec leur mode', () => {
    expect(trackedKeys(TYPE)).toEqual([
      { key: 'status', mode: 'value', type: 'status' },
      { key: 'priority', mode: 'value', type: 'enum' },
      { key: 'statement', mode: 'event', type: 'richtext' },
      { key: 'tags', mode: 'value', type: 'multi_enum' },
    ])
  })

  it('P16 — type introuvable : statut seul', () => {
    expect(trackedKeys(null).map(k => k.key)).toEqual(['status'])
  })

  it('textarea et drawio en mode événement ; champ nommé status jamais suivi', () => {
    const keys = trackedKeys({
      fields: [
        { name: 'notes', type: 'textarea', trackHistory: true },
        { name: 'diagram', type: 'drawio', trackHistory: true },
        { name: 'status', type: 'enum', trackHistory: true },
      ],
    })
    expect(keys).toEqual([
      { key: 'status', mode: 'value', type: 'status' },
      { key: 'notes', mode: 'event', type: 'textarea' },
      { key: 'diagram', mode: 'event', type: 'drawio' },
    ])
  })
})

describe('applyHistory', () => {
  it('P1 — création : une entrée de statut', () => {
    const out = applyHistory(null, obj('draft'), TYPE, actor, NOW)
    expect(out.history).toEqual({ status: [{ value: 'draft', at: AT, by: 'lolive' }] })
  })

  it('P2 — création : valeur pour un enum, événement seul pour un richtext', () => {
    const out = applyHistory(null, obj('draft', { priority: 'high', statement: '<p>x</p>' }), TYPE, { by: 'bot', source: 'mcp' }, NOW)
    expect(out.history?.priority).toEqual([{ value: 'high', at: AT, by: 'bot', source: 'mcp' }])
    expect(out.history?.statement).toEqual([{ at: AT, by: 'bot', source: 'mcp' }])
  })

  it('P3 — création : champ suivi vide sans entrée', () => {
    const out = applyHistory(null, obj('draft', { priority: '', tags: [] }), TYPE, actor, NOW)
    expect(Object.keys(out.history ?? {})).toEqual(['status'])
  })

  it('P4 — changement de statut : une entrée ajoutée', () => {
    const before = obj('draft', {}, { status: [{ value: 'draft', at: '2026-09-01T00:00:00Z', by: 'lolive' }] })
    const out = applyHistory(before, { ...before, status: 'review' }, TYPE, actor, NOW)
    expect(out.history?.status.map(e => e.value)).toEqual(['draft', 'review'])
  })

  it('P5 — sans changement : objet renvoyé tel quel', () => {
    const before = obj('draft', { priority: 'high' }, {
      status: [{ value: 'draft', at: '2026-09-01T00:00:00Z' }],
      priority: [{ value: 'high', at: '2026-09-01T00:00:00Z' }],
    })
    const after = { ...before }
    expect(applyHistory(before, after, TYPE, actor, NOW)).toBe(after)
  })

  it('P6 — multi_enum réordonné : aucune entrée', () => {
    const history = { status: [{ value: 'draft', at: 'x' }], tags: [{ value: 'a, b', at: 'x' }] }
    const before = obj('draft', { tags: 'a, b' }, history)
    const after = { ...before, fields: { tags: 'b,a' } }
    expect(applyHistory(before, after, TYPE, actor, NOW)).toBe(after)
  })

  it('P7 — champ vidé : entrée value null', () => {
    const history = { status: [{ value: 'draft', at: 'x' }], priority: [{ value: 'high', at: 'x' }] }
    const before = obj('draft', { priority: 'high' }, history)
    const out = applyHistory(before, { ...before, fields: { priority: '' } }, TYPE, actor, NOW)
    expect(out.history?.priority.at(-1)).toEqual({ value: null, at: AT, by: 'lolive' })
  })

  it('P8 — deux changements : deux entrées au même at', () => {
    const history = { status: [{ value: 'draft', at: 'x' }], priority: [{ value: 'high', at: 'x' }] }
    const before = obj('draft', { priority: 'high' }, history)
    const out = applyHistory(before, { ...before, status: 'review', fields: { priority: 'low' } }, TYPE, actor, NOW)
    expect(out.history?.status.at(-1)?.at).toBe(AT)
    expect(out.history?.priority.at(-1)).toEqual({ value: 'low', at: AT, by: 'lolive' })
  })

  it('P9 — trackStatusHistory false : pas d\'entrée, historique existant conservé', () => {
    const history = { status: [{ value: 'draft', at: 'x' }] }
    const before = obj('draft', {}, history)
    const after = { ...before, status: 'review' }
    const out = applyHistory(before, after, { ...TYPE, trackStatusHistory: false }, actor, NOW)
    expect(out).toBe(after)
    expect(out.history).toEqual(history)
  })

  it('P10 — champ non suivi modifié : rien ; clé d\'un champ plus suivi conservée', () => {
    const history = { status: [{ value: 'draft', at: 'x' }], legacy: [{ value: 1, at: 'x' }] }
    const before = obj('draft', { owner: 'a' }, history)
    const after = { ...before, fields: { owner: 'b' } }
    expect(applyHistory(before, after, TYPE, actor, NOW)).toBe(after)
  })

  it('P11 — trou comblé (YAML modifié à la main) avant le changement', () => {
    const before = obj('approved', {}, { status: [{ value: 'review', at: '2026-09-01T00:00:00Z', by: 'lolive' }] })
    const fallback = { at: '2026-09-15T12:00:00Z', by: 'Laurent Olive' }
    const out = applyHistory(before, { ...before, status: 'obsolete' }, TYPE, actor, NOW, fallback)
    expect(out.history?.status).toEqual([
      { value: 'review', at: '2026-09-01T00:00:00Z', by: 'lolive' },
      { value: 'approved', at: '2026-09-15T12:00:00Z', by: 'Laurent Olive' },
      { value: 'obsolete', at: AT, by: 'lolive' },
    ])
  })

  it('P12 — historique jamais commencé : valeur avant marquée source schema', () => {
    const before = obj('draft')
    const out = applyHistory(before, { ...before, status: 'review' }, TYPE, actor, NOW, { at: '2026-01-01T00:00:00Z', by: 'X' })
    expect(out.history?.status).toEqual([
      { value: 'draft', at: '2026-01-01T00:00:00Z', by: 'X', source: 'schema' },
      { value: 'review', at: AT, by: 'lolive' },
    ])
  })

  it('le trou est comblé par toute écriture, même sans changement suivi', () => {
    const before = obj('draft')
    const out = applyHistory(before, { ...before, fields: { owner: 'x' } }, TYPE, actor, NOW, { at: null, by: null })
    expect(out.history?.status).toEqual([{ value: 'draft', at: AT, source: 'schema' }])
  })

  it('trou daté jamais avant la dernière entrée (écriture non commitée plus récente que le commit)', () => {
    const before = obj('approved', {}, { status: [{ value: 'review', at: '2026-10-01T11:00:00Z', by: 'lolive' }] })
    const out = applyHistory(before, { ...before, status: 'obsolete' }, TYPE, actor, NOW, { at: '2026-10-01T10:00:00Z', by: 'X' })
    expect(out.history?.status.map(e => [e.value, e.at])).toEqual([
      ['review', '2026-10-01T11:00:00Z'],
      ['approved', '2026-10-01T11:00:00Z'],
      ['obsolete', AT],
    ])
  })

  it('date YAML non quotée (Date) et date texte : même valeur, enregistrée en YYYY-MM-DD', () => {
    const type = { fields: [{ name: 'due', type: 'date' as const, trackHistory: true }] }
    const before = obj('draft', { due: '2026-01-01' }, { status: [{ value: 'draft', at: 'x' }], due: [{ value: '2026-01-01', at: 'x' }] })
    const after = { ...before, fields: { due: new Date('2026-01-01T00:00:00Z') } }
    expect(applyHistory(before, after, type, actor, NOW)).toBe(after)
    const created = applyHistory(null, obj('draft', { due: new Date('2026-02-03T00:00:00Z') }), type, actor, NOW)
    expect(created.history?.due[0].value).toBe('2026-02-03')
  })

  it('nombre saisi en texte : même valeur, enregistré en nombre', () => {
    const type = { fields: [{ name: 'n', type: 'number' as const, trackHistory: true }] }
    const before = obj('draft', { n: 5 }, { status: [{ value: 'draft', at: 'x' }], n: [{ value: 5, at: 'x' }] })
    const after = { ...before, fields: { n: '5' } }
    expect(applyHistory(before, after, type, actor, NOW)).toBe(after)
    expect(applyHistory(before, { ...before, fields: { n: '7' } }, type, actor, NOW).history?.n.at(-1)?.value).toBe(7)
  })

  it('ne mute pas les objets reçus', () => {
    const history = { status: [{ value: 'draft', at: 'x' }] }
    const before = obj('draft', {}, history)
    applyHistory(before, { ...before, status: 'review' }, TYPE, actor, NOW)
    expect(history.status).toHaveLength(1)
  })
})

describe('effectiveHistory', () => {
  it('P13 — valeur courante différente : entrée implicite datée du fallback', () => {
    const o = obj('approved', {}, { status: [{ value: 'review', at: '2026-09-01T00:00:00Z' }] })
    const h = effectiveHistory(o, TYPE, { at: '2026-09-15T12:00:00Z', by: 'Laurent Olive' }, NOW)
    expect(h.status.at(-1)).toEqual({ value: 'approved', at: '2026-09-15T12:00:00Z', by: 'Laurent Olive', implicit: true })
    expect(o.history?.status).toHaveLength(1)
  })

  it('P14 — fichier jamais commité : at = maintenant, sans by', () => {
    const h = effectiveHistory(obj('draft'), TYPE, { at: null, by: null }, NOW)
    expect(h.status).toEqual([{ value: 'draft', at: AT, implicit: true }])
  })

  it('P15 — champ en mode événement : jamais d\'entrée implicite', () => {
    const o = obj('draft', { statement: '<p>x</p>' }, { status: [{ value: 'draft', at: 'x' }] })
    expect(effectiveHistory(o, TYPE, { at: null, by: null }, NOW).statement).toBeUndefined()
  })

  it('pas d\'écart : historique inchangé ; hasHistoryGap le dit', () => {
    const o = obj('draft', {}, { status: [{ value: 'draft', at: 'x' }] })
    expect(hasHistoryGap(o, TYPE)).toBe(false)
    expect(effectiveHistory(o, TYPE, { at: null, by: null }, NOW)).toEqual(o.history)
    expect(hasHistoryGap({ ...o, status: 'review' }, TYPE)).toBe(true)
  })
})

it('P17 — withoutHistory retire la clé seulement', () => {
  const o = { id: 'T-1', status: 'draft', fields: { a: 1 }, history: { status: [] } }
  expect(withoutHistory(o)).toEqual({ id: 'T-1', status: 'draft', fields: { a: 1 } })
})

describe('renameFieldKeys (GH77 sprint 2)', () => {
  const o = obj('draft', { a: 1, keep: 2, b: 3 }, { status: [], a: [{ value: 1, at: 'x' }] })

  it('déplace valeur et historique, ordre des clés conservé', () => {
    const out = renameFieldKeys(o, [{ from: 'a', to: 'z' }])
    expect(out).not.toBe('conflict')
    const r = out as HistoryCarrier
    expect(Object.keys(r.fields)).toEqual(['z', 'keep', 'b'])
    expect(r.history).toEqual({ status: [], z: [{ value: 1, at: 'x' }] })
  })

  it('R2 — nouveau nom déjà porteur d\'une donnée : conflit', () => {
    expect(renameFieldKeys(o, [{ from: 'a', to: 'b' }])).toBe('conflict')
  })

  it('R6 — chaîne a→b, b→c appliquée d\'un coup', () => {
    const r = renameFieldKeys(o, [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]) as HistoryCarrier
    expect(r.fields).toEqual({ b: 1, keep: 2, c: 3 })
    expect(Object.keys(r.history ?? {})).toEqual(['status', 'b'])
  })

  it('champ nommé status renommé : l\'historique du statut ne bouge pas', () => {
    const withStatusField = obj('draft', { status: 'x' }, { status: [{ value: 'draft', at: 'x' }] })
    const r = renameFieldKeys(withStatusField, [{ from: 'status', to: 'etat' }]) as HistoryCarrier
    expect(r.fields).toEqual({ etat: 'x' })
    expect(r.history).toEqual({ status: [{ value: 'draft', at: 'x' }] })
    expect(renameFieldKeys(obj('draft', { a: 1 }, { status: [] }), [{ from: 'a', to: 'status' }])).not.toBe('conflict')
  })

  it('noms hérités du prototype (constructor…) : ni conflit ni faux renommage', () => {
    expect(renameFieldKeys(o, [{ from: 'constructor', to: 'x' }])).toBeNull()
    expect(renameFieldKeys(o, [{ from: 'a', to: 'toString' }])).not.toBe('conflict')
  })

  it('aucune donnée sous l\'ancien nom : null', () => {
    expect(renameFieldKeys(o, [{ from: 'absent', to: 'x' }])).toBeNull()
  })
})
