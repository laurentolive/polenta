import { Menu, type BrowserWindow, type ContextMenuParams, type MenuItemConstructorOptions } from 'electron'

// GH134 — menu contextuel natif de la fenêtre. Electron n'affiche aucun menu au clic droit si
// l'application n'en fournit pas : sans ce module, le correcteur orthographique souligne les fautes
// mais ne propose ni suggestions ni Couper/Copier/Coller. Les menus propres à Polenta (arbre des
// éléments, tableaux du richtext) appellent preventDefault côté renderer : Electron n'émet alors
// pas l'événement context-menu, ils ne sont donc pas doublés par celui-ci.

export type ContextMenuInput = Pick<
  ContextMenuParams,
  'isEditable' | 'selectionText' | 'misspelledWord' | 'dictionarySuggestions' | 'editFlags'
>

export interface ContextMenuActions {
  replaceMisspelling(word: string): void
  addToDictionary(word: string): void
}

export function buildContextMenuTemplate(
  params: ContextMenuInput,
  actions: ContextMenuActions,
): MenuItemConstructorOptions[] {
  const { isEditable, selectionText, misspelledWord, dictionarySuggestions, editFlags } = params
  const template: MenuItemConstructorOptions[] = []

  if (isEditable && misspelledWord) {
    if (dictionarySuggestions.length > 0) {
      for (const suggestion of dictionarySuggestions) {
        template.push({ label: suggestion, click: () => actions.replaceMisspelling(suggestion) })
      }
    } else {
      template.push({ label: 'Aucune suggestion', enabled: false })
    }
    template.push(
      { label: 'Ajouter au dictionnaire', click: () => actions.addToDictionary(misspelledWord) },
      { type: 'separator' },
    )
  }

  if (isEditable) {
    template.push(
      { label: 'Couper', role: 'cut', enabled: editFlags.canCut },
      { label: 'Copier', role: 'copy', enabled: editFlags.canCopy },
      { label: 'Coller', role: 'paste', enabled: editFlags.canPaste },
      { type: 'separator' },
      { label: 'Tout sélectionner', role: 'selectAll', enabled: editFlags.canSelectAll },
    )
  } else if (selectionText.trim()) {
    template.push({ label: 'Copier', role: 'copy', enabled: editFlags.canCopy })
  }

  return template
}

export function attachContextMenu(win: BrowserWindow): void {
  const { webContents } = win
  webContents.on('context-menu', (_event, params) => {
    const template = buildContextMenuTemplate(params, {
      replaceMisspelling: word => webContents.replaceMisspelling(word),
      addToDictionary: word => webContents.session.addWordToSpellCheckerDictionary(word),
    })
    if (template.length > 0) Menu.buildFromTemplate(template).popup({ window: win })
  })
}
