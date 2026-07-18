import type { EditorView } from '@tiptap/pm/view'

// Remplit de texte un tableau vide (venant d'être inséré via insertTable, cf.
// TableInsertButton) en repérant ses cellules à partir de la sélection
// courante (positionnée par TipTap dans la première cellule après
// insertTable). `cellTexts` est une liste à plat, ligne par ligne, de même
// longueur que le nombre de cellules du tableau (cf. padTableRows).
export function fillPastedTable(view: EditorView, cellTexts: string[]) {
  const { $from } = view.state.selection
  let tableDepth = -1
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).type.name === 'table') {
      tableDepth = d
      break
    }
  }
  if (tableDepth === -1) return

  const tableStart = $from.before(tableDepth)
  const tableNode = $from.node(tableDepth)
  const cellPositions: number[] = []
  tableNode.descendants((node, pos) => {
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
      // `pos` est relatif au début du contenu de `tableNode` ; +1 pour entrer
      // dans le tableau, +1 pour entrer dans la cellule, +1 pour entrer dans
      // son paragraphe (contenu par défaut d'une cellule vide).
      cellPositions.push(tableStart + 1 + pos + 2)
      return false
    }
    return true
  })

  // Insertion de la dernière cellule vers la première : une position déjà
  // calculée pour une cellule antérieure n'est jamais décalée par l'insertion
  // de texte dans une cellule postérieure (positions plus grandes).
  let tr = view.state.tr
  for (let i = cellPositions.length - 1; i >= 0; i--) {
    const text = cellTexts[i]
    if (text) tr = tr.insertText(text, cellPositions[i])
  }
  view.dispatch(tr)
}
