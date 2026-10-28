import { describe, expect, it } from 'vitest'
import { MAX_DIFF_TOKENS, diffTokens, diffValueText, tokenize, wordDiff, wordSegments } from './wordDiff'
import { alignByKey, alignSteps, pageKeys } from './align'
import { alignMedia, changedMedia, mediaBlocks } from './mediaDiff'

/** GH178 sprint 2 — diff mot à mot, alignements (étapes, médias, pages). */

const changedText = (segs: Array<{ text: string; changed: boolean }>) => segs.filter(s => s.changed).map(s => s.text)

describe('tokenize', () => {
  it('mots accentués, apostrophes et traits d’union internes, ponctuation isolée, espaces', () => {
    expect(tokenize("L'état « démarré » : 500 ms, auto-test.")).toEqual([
      "L'état", ' ', '«', ' ', 'démarré', ' ', '»', ' ', ':', ' ', '500', ' ', 'ms', ',', ' ', 'auto-test', '.',
    ])
  })
})

describe('diffTokens / wordSegments', () => {
  it('seuls les mots changés sont marqués, de chaque côté', () => {
    const a = 'THE system SHALL start within 500 ms'
    const b = 'THE system SHALL start within 300 ms'
    expect(changedText(wordSegments(a, b, 'before'))).toEqual(['500'])
    expect(changedText(wordSegments(b, a, 'after'))).toEqual(['300'])
  })

  it('un espace entre deux mots changés rejoint le changement', () => {
    expect(changedText(wordSegments('a b c d', 'a x y d', 'before'))).toEqual(['b c'])
  })

  it('texte identique : rien de marqué ; texte vide d’un côté : tout marqué', () => {
    expect(changedText(wordSegments('a b', 'a b', 'before'))).toEqual([])
    expect(changedText(wordSegments('a b', '', 'before'))).toEqual(['a b'])
  })

  it('garde-fou de taille : milieu entier marqué, sans détail, préfixe et suffixe communs exclus', () => {
    const big = (w: string) => Array.from({ length: MAX_DIFF_TOKENS + 10 }, (_, i) => `${w}${i}`)
    const a = ['début', ...big('a'), 'fin']
    const b = ['début', ...big('b'), 'fin']
    const d = diffTokens(a, b)
    expect(d.detailed).toBe(false)
    expect(d.removed[0]).toBe(false)
    expect(d.removed[a.length - 1]).toBe(false)
    expect(d.removed.slice(1, -1).every(Boolean)).toBe(true)
  })
})

describe('alignByKey', () => {
  it('ancres par clé ; restants appariés par position seulement si demandé', () => {
    expect(alignByKey(['a', 'b', 'c'], ['a', 'x', 'c'])).toEqual([[0, 0], [1, null], [null, 1], [2, 2]])
    expect(alignByKey(['a', 'b', 'c'], ['a', 'x', 'c'], true)).toEqual([[0, 0], [1, 1], [2, 2]])
  })
})

describe('alignSteps', () => {
  const s = (action: string, expectedResult = 'ok') => ({ order: 0, action, expectedResult, notes: null })

  it('étape insérée : les suivantes restent appariées à l’identique', () => {
    const before = [s('A'), s('B'), s('C')]
    const after = [s('A'), s('N'), s('B'), s('C')]
    expect(alignSteps(before, after)).toEqual([[0, 0], [null, 1], [1, 2], [2, 3]])
  })

  it('étape modifiée en place : appariée par position ; suppression : rangée seule', () => {
    expect(alignSteps([s('A'), s('B'), s('C')], [s('A'), s('B2'), s('C')])).toEqual([[0, 0], [1, 1], [2, 2]])
    expect(alignSteps([s('A'), s('B'), s('C')], [s('A'), s('C')])).toEqual([[0, 0], [1, null], [2, 1]])
  })
})

describe('mediaBlocks / changedMedia', () => {
  const drawio = (path: string, extra: Record<string, unknown> = {}) => '```drawio\n' + JSON.stringify({ path, ...extra }) + '\n```\n'
  const image = (src: string) => '```image\n' + JSON.stringify({ src }) + '\n```\n'

  it('blocs dans l’ordre du rendu ; drawio sans chemin et fence illisible ignorés', () => {
    const md = `texte\n\n${drawio('d/a.drawio', { nodeId: 'p2' })}\n${image('images/x.png')}\n\`\`\`drawio\n{"path":""}\n\`\`\`\n\n\`\`\`image\nnot json\n\`\`\`\n`
    expect(mediaBlocks(md).map(b => [b.kind, b.path, b.nodeId])).toEqual([
      ['drawio', 'd/a.drawio', 'p2'], ['image', 'images/x.png', null],
    ])
  })

  it('cadre : bloc ajouté, référence modifiée, contenu référencé différent', () => {
    const before = mediaBlocks(drawio('a.drawio') + image('x.png') + drawio('b.drawio', { width: 100 }))
    const after = mediaBlocks(drawio('a.drawio') + image('x.png') + drawio('b.drawio', { width: 200 }) + image('new.png'))
    expect(alignMedia(before, after)).toEqual([[0, 0], [1, 1], [2, 2], [null, 3]])
    const content = (side: 'before' | 'after', b: { path: string }) => (b.path === 'a.drawio' ? `<xml ${side}>` : 'same')
    const res = changedMedia(before, after, content)
    expect([...res.before].sort()).toEqual([0, 2])
    expect([...res.after].sort()).toEqual([0, 2, 3])
  })

  it('contenu pas encore lu : jugé sur la référence seule', () => {
    const blocks = mediaBlocks(drawio('a.drawio'))
    expect(changedMedia(blocks, blocks, () => undefined)).toEqual({ before: new Set(), after: new Set() })
  })
})

describe('pageKeys', () => {
  it('nom de page, ou nom + id quand le nom est en double d’un côté — même règle des deux côtés', () => {
    const before = [{ id: '1', name: 'Vue' }, { id: '2', name: 'Détail' }, { id: '3', name: 'Détail' }]
    const after = [{ id: '1', name: 'Vue' }, { id: '2', name: 'Détail' }]
    expect(pageKeys(before, after)).toEqual([['Vue', 'Détail\u00002', 'Détail\u00003'], ['Vue', 'Détail\u00002']])
    expect(alignByKey(...pageKeys(before, after))).toEqual([[0, 0], [1, 1], [2, null]])
  })
})

describe('mediaBlocks — robustesse', () => {
  it('fence dont le JSON vaut null : ignorée, sans erreur', () => {
    expect(mediaBlocks('```image\nnull\n```\n')).toEqual([])
  })
})

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
