import type { Editor } from '@tiptap/react'
import type { NodeContextMenuEntry } from './NodeContextMenu'

// Items du menu contextuel clic droit sur une cellule de tableau. Chaque
// action lit `editor.can().<commande>()` plutot qu'une logique maison de
// comptage de lignes/colonnes : @tiptap/extension-table refuse deja
// nativement de supprimer la derniere ligne/colonne d'un tableau (can()
// retourne false dans ce cas), pas de fusion (cf. T42.md decision 1) donc
// aucune entree mergeCells/splitCell ici.
export function buildTableMenuItems(editor: Editor): NodeContextMenuEntry[] {
  return [
    { id: 'row-before', label: 'Ajouter une ligne au-dessus', disabled: !editor.can().addRowBefore(), onSelect: () => editor.chain().focus().addRowBefore().run() },
    { id: 'row-after', label: 'Ajouter une ligne en dessous', disabled: !editor.can().addRowAfter(), onSelect: () => editor.chain().focus().addRowAfter().run() },
    { id: 'row-delete', label: 'Supprimer la ligne', disabled: !editor.can().deleteRow(), onSelect: () => editor.chain().focus().deleteRow().run() },
    'separator',
    { id: 'col-before', label: 'Ajouter une colonne à gauche', disabled: !editor.can().addColumnBefore(), onSelect: () => editor.chain().focus().addColumnBefore().run() },
    { id: 'col-after', label: 'Ajouter une colonne à droite', disabled: !editor.can().addColumnAfter(), onSelect: () => editor.chain().focus().addColumnAfter().run() },
    { id: 'col-delete', label: 'Supprimer la colonne', disabled: !editor.can().deleteColumn(), onSelect: () => editor.chain().focus().deleteColumn().run() },
    'separator',
    { id: 'table-delete', label: 'Supprimer le tableau', danger: true, disabled: !editor.can().deleteTable(), onSelect: () => editor.chain().focus().deleteTable().run() },
  ]
}
