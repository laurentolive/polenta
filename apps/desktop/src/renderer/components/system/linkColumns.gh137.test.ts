import { describe, expect, it } from 'vitest'
import type { LinkTypeDefinition } from '@polenta/types'
import { linkColumnKeys, linkColumnLabel, normalizeLinkColumns, parseLinkColumn } from './linkUtils'

// GH137 — colonnes « raffine » / « est raffinée par » séparées quand le type est source et cible.

const raffinement: LinkTypeDefinition = {
  name: 'raffinement',
  labelSourceToTarget: 'raffine',
  labelTargetToSource: 'est raffinée par',
  sourceRefs: ['root::exigence-fonctionnelle', 'root::exigence-technique'],
  targetRefs: ['root::exigence-metier', 'root::exigence-fonctionnelle'],
} as LinkTypeDefinition

const EF = 'root::exigence-fonctionnelle'
const EM = 'root::exigence-metier'
const ET = 'root::exigence-technique'

describe('linkColumnKeys / linkColumnLabel', () => {
  it('1/4 — deux colonnes pour un type source et cible, une seule sinon', () => {
    expect(linkColumnKeys(raffinement, EF, 'requirement')).toEqual(['link-out::raffinement', 'link-in::raffinement'])
    expect(linkColumnKeys(raffinement, EM, 'requirement')).toEqual(['link::raffinement'])
    expect(linkColumnKeys(raffinement, ET, 'requirement')).toEqual(['link::raffinement'])
  })

  it('titres par sens ; colonne unique : libellé du côté du type', () => {
    expect(linkColumnLabel(raffinement, 'out', EF, 'requirement')).toBe('raffine')
    expect(linkColumnLabel(raffinement, 'in', EF, 'requirement')).toBe('est raffinée par')
    expect(linkColumnLabel(raffinement, 'both', EM, 'requirement')).toBe('est raffinée par')
    expect(linkColumnLabel(raffinement, 'both', ET, 'requirement')).toBe('raffine')
  })

  it('parseLinkColumn', () => {
    expect(parseLinkColumn('link-in::raffinement')).toEqual({ typeName: 'raffinement', direction: 'in' })
    expect(parseLinkColumn('link::x')).toEqual({ typeName: 'x', direction: 'both' })
    expect(parseLinkColumn('status')).toBeNull()
  })
})

describe('normalizeLinkColumns', () => {
  it('5 — link:: d\'un type « deux sens » vaut ses deux colonnes, à sa place', () => {
    expect(normalizeLinkColumns(['id', 'link::raffinement', 'status'], [raffinement], EF, 'requirement'))
      .toEqual(['id', 'link-out::raffinement', 'link-in::raffinement', 'status'])
  })

  it('clé de sens d\'un type redevenu « un sens » : colonne unique ; type inconnu : inchangée', () => {
    expect(normalizeLinkColumns(['link-in::raffinement', 'link-out::raffinement'], [raffinement], EM, 'requirement'))
      .toEqual(['link::raffinement'])
    expect(normalizeLinkColumns(['link::inconnu'], [raffinement], EF, 'requirement')).toEqual(['link::inconnu'])
  })

  it('nouvelles clés conservées telles quelles pour un type « deux sens »', () => {
    expect(normalizeLinkColumns(['link-in::raffinement'], [raffinement], EF, 'requirement')).toEqual(['link-in::raffinement'])
  })
})
