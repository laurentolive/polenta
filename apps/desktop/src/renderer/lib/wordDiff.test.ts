import { describe, it, expect } from 'vitest'
import { wordDiff, diffValueText } from './wordDiff'

const text = (parts: ReturnType<typeof wordDiff>, kind: 'same' | 'removed' | 'added') =>
  parts.filter((p) => p.kind !== kind).map((p) => p.text).join('')

describe('wordDiff (GH145)', () => {
  it('textes identiques : une seule partie inchangée', () => {
    expect(wordDiff('a b c', 'a b c')).toEqual([{ kind: 'same', text: 'a b c' }])
  })

  it('un mot remplacé : retiré puis ajouté, le reste inchangé', () => {
    const parts = wordDiff('chaque mois à partir', 'chaque semaine à partir')
    expect(parts).toEqual([
      { kind: 'same', text: 'chaque ' },
      { kind: 'removed', text: 'mois' },
      { kind: 'added', text: 'semaine' },
      { kind: 'same', text: ' à partir' },
    ])
  })

  it('reconstitue exactement l\'avant (sans ajouts) et l\'après (sans retraits), sauts de ligne compris', () => {
    const before = 'Le SI doit permettre plusieurs fenêtres.\n\nPas de limite de fenêtre.'
    const after = 'Le SI doit permettre plusieurs fenêtres.\n\nLimité à 4'
    const parts = wordDiff(before, after)
    expect(text(parts, 'added')).toBe(before)
    expect(text(parts, 'removed')).toBe(after)
  })

  it('avant vide (champ ajouté) : tout ajouté', () => {
    expect(wordDiff('', 'nouveau texte')).toEqual([{ kind: 'added', text: 'nouveau texte' }])
  })

  it('texte très long : repli sur tout retiré / tout ajouté', () => {
    const long = (w: string) => Array.from({ length: 600 }, (_, i) => `${w}${i}`).join(' ')
    const parts = wordDiff(long('a'), long('b'))
    expect(parts.map((p) => p.kind)).toEqual(['removed', 'added'])
  })

  it('diffValueText : chaîne telle quelle, null/undefined vides, autre en JSON', () => {
    expect(diffValueText('x')).toBe('x')
    expect(diffValueText(undefined)).toBe('')
    expect(diffValueText(null)).toBe('')
    expect(diffValueText(['a'])).toBe('["a"]')
  })
})
