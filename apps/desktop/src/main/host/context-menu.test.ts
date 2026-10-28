import { describe, it, expect, vi } from 'vitest'

// GH134 — seule la construction du gabarit est testée : Menu n'est pas utilisé par buildContextMenuTemplate.
vi.mock('electron', () => ({ Menu: {} }))

import { buildContextMenuTemplate, type ContextMenuInput } from './context-menu'

const allFlags = {
  canUndo: true,
  canRedo: true,
  canCut: true,
  canCopy: true,
  canPaste: true,
  canDelete: true,
  canSelectAll: true,
  canEditRichly: true,
}

function input(overrides: Partial<ContextMenuInput>): ContextMenuInput {
  return {
    isEditable: false,
    selectionText: '',
    misspelledWord: '',
    dictionarySuggestions: [],
    editFlags: allFlags,
    ...overrides,
  }
}

function actions() {
  return { replaceMisspelling: vi.fn(), addToDictionary: vi.fn() }
}

const click = (item: { click?: unknown }) =>
  (item.click as () => void)()

describe('buildContextMenuTemplate', () => {
  it('propose les suggestions puis « Ajouter au dictionnaire » sur un mot mal orthographié', () => {
    const a = actions()
    const t = buildContextMenuTemplate(
      input({ isEditable: true, misspelledWord: 'exigense', dictionarySuggestions: ['exigence', 'exigences'] }),
      a,
    )

    expect(t.map(i => i.label ?? i.type)).toEqual([
      'exigence', 'exigences', 'Ajouter au dictionnaire', 'separator',
      'Couper', 'Copier', 'Coller', 'separator', 'Tout sélectionner',
    ])
    click(t[1])
    expect(a.replaceMisspelling).toHaveBeenCalledWith('exigences')
    click(t[2])
    expect(a.addToDictionary).toHaveBeenCalledWith('exigense')
  })

  it('affiche « Aucune suggestion » désactivé quand le dictionnaire ne propose rien', () => {
    const t = buildContextMenuTemplate(input({ isEditable: true, misspelledWord: 'xqzw' }), actions())

    expect(t[0]).toMatchObject({ label: 'Aucune suggestion', enabled: false })
    expect(t[1]).toMatchObject({ label: 'Ajouter au dictionnaire' })
  })

  it('propose les commandes d\'édition dans un champ éditable sans faute', () => {
    const t = buildContextMenuTemplate(
      input({ isEditable: true, editFlags: { ...allFlags, canCut: false, canCopy: false } }),
      actions(),
    )

    expect(t).toEqual([
      { label: 'Couper', role: 'cut', enabled: false },
      { label: 'Copier', role: 'copy', enabled: false },
      { label: 'Coller', role: 'paste', enabled: true },
      { type: 'separator' },
      { label: 'Tout sélectionner', role: 'selectAll', enabled: true },
    ])
  })

  it('propose seulement « Copier » sur une sélection hors champ éditable', () => {
    const t = buildContextMenuTemplate(input({ selectionText: 'du texte' }), actions())

    expect(t).toEqual([{ label: 'Copier', role: 'copy', enabled: true }])
  })

  it('ne propose rien hors champ éditable sans sélection', () => {
    expect(buildContextMenuTemplate(input({ selectionText: '   ' }), actions())).toEqual([])
  })
})
