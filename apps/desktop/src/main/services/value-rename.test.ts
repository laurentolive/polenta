import { describe, expect, it } from 'vitest'

import { renameValues } from '@polenta/types'
import type { HistoryCarrier, ValueRename } from '@polenta/types'

// GH82 — renommage de statut / valeur d'enum, logique pure (scénarios P1–P7 de specs/GH82-tests.md).

const status = (from: string, to: string): ValueRename => ({ target: { kind: 'status' }, from, to })
const field = (f: string, from: string, to: string, multi = false): ValueRename => ({ target: { kind: 'field', field: f, multi }, from, to })

const obj = (s: string, fields: Record<string, unknown> = {}, history?: HistoryCarrier['history']): HistoryCarrier =>
  ({ status: s, fields, ...(history && { history }) })

describe('renameValues', () => {
  it('P1 — statut : status et valeurs de history.status', () => {
    const o = obj('review', {}, { status: [{ value: 'draft', at: 'a' }, { value: 'review', at: 'b' }] })
    expect(renameValues(o, [status('review', 'en-revue')])).toEqual(
      obj('en-revue', {}, { status: [{ value: 'draft', at: 'a' }, { value: 'en-revue', at: 'b' }] }),
    )
  })

  it('P1b — historique seul concerné (objet passé à un autre statut depuis)', () => {
    const o = obj('approved', {}, { status: [{ value: 'review', at: 'a' }, { value: 'approved', at: 'b' }] })
    expect(renameValues(o, [status('review', 'en-revue')])?.history?.status[0].value).toBe('en-revue')
  })

  it('P2 — objet sans l\'ancienne valeur : null', () => {
    expect(renameValues(obj('draft', {}, { status: [{ value: 'draft', at: 'a' }] }), [status('review', 'x')])).toBeNull()
  })

  it('P3 — enum : fields et history du champ', () => {
    const o = obj('draft', { prio: 'haute', autre: 'haute' }, { prio: [{ value: 'haute', at: 'a' }] })
    const r = renameValues(o, [field('prio', 'haute', 'high')])!
    expect(r.fields).toEqual({ prio: 'high', autre: 'haute' })
    expect(r.history?.prio[0].value).toBe('high')
  })

  it('P4 — multi_enum CSV et tableau YAML ; liste sans valeur renommée non reformatée', () => {
    expect(renameValues(obj('d', { t: 'haute, basse' }), [field('t', 'haute', 'high', true)])?.fields.t).toBe('high, basse')
    expect(renameValues(obj('d', { t: ['haute', 'basse'] }), [field('t', 'haute', 'high', true)])?.fields.t).toEqual(['high', 'basse'])
    expect(renameValues(obj('d', { t: 'moyenne,basse' }), [field('t', 'haute', 'high', true)])).toBeNull()
  })

  it('P4b — séparateurs CSV conservés', () => {
    expect(renameValues(obj('d', { t: 'haute,basse' }), [field('t', 'haute', 'high', true)])?.fields.t).toBe('high,basse')
  })

  it('champ nommé status : sa valeur, pas le statut de l\'objet', () => {
    const o = obj('open', { status: 'open' }, { status: [{ value: 'open', at: 'a' }] })
    const r = renameValues(o, [field('status', 'open', 'ouvert')])!
    expect(r.status).toBe('open')
    expect(r.fields.status).toBe('ouvert')
    expect(r.history?.status).toEqual([{ value: 'open', at: 'a' }])
  })

  it('P5 — échange a ↔ b', () => {
    const swap = [field('f', 'a', 'b'), field('f', 'b', 'a')]
    expect(renameValues(obj('d', { f: 'a' }), swap)?.fields.f).toBe('b')
    expect(renameValues(obj('d', { f: 'b' }), swap)?.fields.f).toBe('a')
  })

  it('P6 — champ absent : null', () => {
    expect(renameValues(obj('d', { autre: 'x' }), [field('f', 'x', 'y')])).toBeNull()
  })

  it('P7 — entrée sans value (mode événement) intacte', () => {
    const o = obj('d', { f: 'x' }, { f: [{ at: 'a', by: 'u' }, { value: 'x', at: 'b' }] })
    expect(renameValues(o, [field('f', 'x', 'y')])?.history?.f).toEqual([{ at: 'a', by: 'u' }, { value: 'y', at: 'b' }])
  })

  it('ne mute pas l\'objet reçu', () => {
    const o = obj('review', { f: 'x' }, { status: [{ value: 'review', at: 'a' }] })
    renameValues(o, [status('review', 'r'), field('f', 'x', 'y')])
    expect(o).toEqual(obj('review', { f: 'x' }, { status: [{ value: 'review', at: 'a' }] }))
  })
})
