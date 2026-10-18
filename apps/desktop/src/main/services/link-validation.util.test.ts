import { describe, expect, it } from 'vitest'
import type { LinkTypeDefinition } from '@polenta/types'
import { validateLinkEntries } from './link-validation.util'

// GH104 — un type de lien dont une liste de refs a été vidée (type cible supprimé) n'accepte rien.

const objects = {
  'R-1': { id: 'R-1', category: 'requirement', objectTypeRef: 'root::R' },
  'T-1': { id: 'T-1', category: 'test', objectTypeRef: 'root::T' },
} as const
const resolve = (id: string) => (objects as Record<string, (typeof objects)[keyof typeof objects]>)[id] ?? null
const entry = { type: 'verifies', sourceId: 'T-1', targetId: 'R-1' }
const lt = (l: Partial<LinkTypeDefinition>) => [{ name: 'verifies', labelSourceToTarget: '', labelTargetToSource: '', ...l }] as LinkTypeDefinition[]

describe('validateLinkEntries', () => {
  it('liste vide : refusé (LINK_TYPE_INCOMPATIBLE)', () => {
    const { valid, errors } = validateLinkEntries(lt({ sourceRefs: ['test'], targetRefs: [] }), [entry], resolve, [])
    expect(valid).toEqual([])
    expect(errors.map(e => e.code)).toEqual(['LINK_TYPE_INCOMPATIBLE'])
  })

  it('liste absente : non contrainte (inchangé)', () => {
    expect(validateLinkEntries(lt({ sourceRefs: ['test'] }), [entry], resolve, []).errors).toEqual([])
  })
})
