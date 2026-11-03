import { describe, it, expect } from 'vitest'
import { layoutPatch, resolveLayout, sameLayout, type ViewLayout } from './savedViewSettings'

const defaults = { excel: ['id', 'name'], word: ['name'] }
const layout: ViewLayout = { excel: ['id', 'status'], word: ['name'], popup: ['status'], showFoldersExcel: false, showFoldersWord: true, freezeColCountExcel: 2 }

describe('resolveLayout', () => {
  it('reprend une vue complète telle quelle', () => {
    expect(resolveLayout({ ...layout }, defaults)).toEqual(layout)
  })

  it('une clé absente vaut le défaut', () => {
    expect(resolveLayout({}, defaults)).toEqual({
      excel: defaults.excel, word: defaults.word, popup: [], showFoldersExcel: true, showFoldersWord: true, freezeColCountExcel: 0,
    })
  })

  it('une valeur invalide (fichier édité à la main) vaut le défaut', () => {
    const resolved = resolveLayout({ excel: 'id', word: [1], popup: null, showFoldersExcel: 'non', freezeColCountExcel: -1 }, defaults)
    expect(resolved).toEqual(resolveLayout({}, defaults))
  })
})

describe('layoutPatch', () => {
  it('une clé absente est retirée du .pref ; les autres réglages ne sont pas dans le patch', () => {
    const patch = layoutPatch({ excel: ['id'] })
    expect(patch).toEqual({ excel: ['id'], word: null, popup: null, showFoldersExcel: null, showFoldersWord: null, freezeColCountExcel: null })
    expect(patch).not.toHaveProperty('picker')
    expect(patch).not.toHaveProperty('collapsedFoldersExcel')
  })

  it('garde les valeurs fausses ou nulles d\'une vue', () => {
    expect(layoutPatch({ showFoldersExcel: false, freezeColCountExcel: 0 })).toMatchObject({ showFoldersExcel: false, freezeColCountExcel: 0 })
  })
})

describe('sameLayout', () => {
  it('égalité stricte de chaque réglage', () => {
    expect(sameLayout(layout, { ...layout, excel: [...layout.excel] })).toBe(true)
    expect(sameLayout(layout, { ...layout, excel: ['status', 'id'] })).toBe(false)
    expect(sameLayout(layout, { ...layout, word: [] })).toBe(false)
    expect(sameLayout(layout, { ...layout, popup: [] })).toBe(false)
    expect(sameLayout(layout, { ...layout, showFoldersExcel: true })).toBe(false)
    expect(sameLayout(layout, { ...layout, showFoldersWord: false })).toBe(false)
    expect(sameLayout(layout, { ...layout, freezeColCountExcel: 0 })).toBe(false)
  })
})
