import { describe, expect, it } from 'vitest'
import type { ObjectTypeDefinition, TypeTreeNode } from '@polenta/types'
import { buildFilterRegex, NO_FILTER_OPTIONS } from './textFilter'
import { buildRegex, findMatches, replaceInText } from './searchQuery'
import { diffValueText } from './wordDiff'
import { buildExportOutline, buildExportRows } from './exportColumns'

// GH299 — les balises de couleur d'un richtext ne sont jamais du texte « visible » : filtre,
// recherche, remplacement, diff et exports Standard les ignorent.

const COLORED = 'Seuil <mark class="pl-hl-yellow">6<span class="pl-c-red">0</span> °C</mark> atteint'

describe('GH299 — filtre global', () => {
  const re = (q: string, opts = NO_FILTER_OPTIONS) => buildFilterRegex(q, opts)!

  it('une balise ne fait pas correspondre un objet', () => {
    for (const q of ['pl-hl', 'mark', 'span', 'class']) expect(re(q).test(COLORED)).toBe(false)
  })

  it('le texte coloré est trouvé, même coupé par une balise', () => {
    expect(re('60 °C').test(COLORED)).toBe(true)
    expect(re('atteint').test(COLORED)).toBe(true)
    expect(re('\\b60\\b', { caseSensitive: false, wholeWord: false, regex: true }).test(COLORED)).toBe(true)
  })

  it('reste une RegExp utilisable telle quelle (source / flags)', () => {
    const r = re('Seuil', { caseSensitive: true, wholeWord: true, regex: false })
    expect(r).toBeInstanceOf(RegExp)
    expect(new RegExp(r.source, r.flags).test('Seuil')).toBe(true)
  })
})

describe('GH299 — Vue Recherche', () => {
  const opts = { caseSensitive: false, wholeWord: false, isRegex: false, preserveCase: false }

  it('correspondance et extrait sur le texte visible', () => {
    expect(findMatches([{ key: 'statement', value: COLORED }], buildRegex('mark', opts)!)).toEqual([])
    const [m] = findMatches([{ key: 'statement', value: COLORED }], buildRegex('60', opts)!)
    expect(m.excerpt).toBe('Seuil 60 °C atteint')
  })

  it('le remplacement ne touche jamais une balise', () => {
    const v = '<span class="pl-c-red">span</span> et span'
    expect(replaceInText(v, buildRegex('span', opts)!, 'X', false)).toBe('<span class="pl-c-red">X</span> et X')
    expect(replaceInText(v, buildRegex('pl-c-red', opts)!, 'X', false)).toBe(v)
  })

  it('remplace ce que la recherche a trouvé, même à cheval sur une balise (balises gardées)', () => {
    expect(replaceInText(COLORED, buildRegex('60', opts)!, '70', false))
      .toBe('Seuil <mark class="pl-hl-yellow">70<span class="pl-c-red"></span> °C</mark> atteint')
    expect(replaceInText('Eco <span class="pl-c-red">mode</span>', buildRegex('Eco mode', opts)!, 'Boost', false))
      .toBe('Boost<span class="pl-c-red"></span>')
  })

  it('ancres et limites de mot évaluées sur le texte visible', () => {
    const rx = { ...opts, isRegex: true }
    expect(replaceInText('foo <span class="pl-c-red">foo</span>', buildRegex('^foo', rx)!, 'X', false))
      .toBe('X <span class="pl-c-red">foo</span>')
    expect(replaceInText('x<span class="pl-c-red">mode</span> mode', buildRegex('\\bmode', rx)!, 'M', false))
      .toBe('x<span class="pl-c-red">mode</span> M')
  })
})

describe('GH299 — diff et exports', () => {
  it('diffValueText : texte visible', () => {
    expect(diffValueText(COLORED)).toBe('Seuil 60 °C atteint')
  })

  const node = { id: 'n1', kind: 'item', name: 'R1', objectId: 'R1', children: [] } as unknown as TypeTreeNode
  const typeDef = {
    name: 'exigence', category: 'requirement',
    fields: [{ name: 'statement', type: 'richtext' }, { name: 'note', type: 'text' }],
  } as unknown as ObjectTypeDefinition
  const LITERAL = 'code `</span>` et <mark class="pl-hl-yellow">x</mark>'
  const objects = [{ id: 'R1', title: 't', statement: COLORED, note: LITERAL }]

  it('export Standard / impression : balises retirées des seules colonnes richtext', () => {
    const { rows } = buildExportRows(['id', 'statement', 'note'], [node], objects, new Map(), undefined, typeDef, '')
    expect(rows).toEqual([{ id: 'R1', statement: 'Seuil 60 °C atteint', note: LITERAL }])
  })

  it('outline du gabarit : source conservée ({{@rich.x}} rend les couleurs)', () => {
    const [entry] = buildExportOutline(['id', 'statement'], [node], objects, new Map(), undefined, '', typeDef)
    expect(entry.values.statement).toBe(COLORED)
  })
})
