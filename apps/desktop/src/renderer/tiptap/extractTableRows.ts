// Extrait le contenu texte d'un tableau HTML collé (Excel, etc.) sous forme de
// grille de chaînes, sans jamais reparser le HTML directement dans le
// document ProseMirror. Deux raisons à ce choix :
// - `parseSlice(dom)` calcule un openStart/openEnd égal à la profondeur de la
//   structure du tableau (4 pour table>row>cell>paragraph) quand aucun
//   `context` cohérent n'est fourni, ce qui fait fusionner le contenu
//   environnant (texte avant/après le point d'insertion) dans la dernière
//   cellule du tableau au lieu de l'inserer proprement à côté.
// - Le HTML exporté par Excel ne contient que des cellules simples (jamais de
//   <th>) et peut contenir des fusions (colspan/rowspan, cf. T42.md décision 1
//   — non supportées) ; reconstruire le tableau nous-mêmes via `insertTable`
//   (déjà utilisé par TableInsertButton) et y injecter le texte cellule par
//   cellule évite ces deux classes de problèmes d'un coup.
export function extractTableRows(html: string): string[][] | null {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const table = doc.querySelector('table')
  if (!table) return null

  const rows = Array.from(table.querySelectorAll('tr'))
    .map(tr => Array.from(tr.querySelectorAll('td, th')).map(cell => (cell.textContent ?? '').trim()))
    .filter(row => row.length > 0)

  return rows.length > 0 ? rows : null
}

// Complète chaque ligne à `cols` colonnes (vide si la ligne source en avait
// moins, ex. cellule fusionnée sur plusieurs colonnes côté Excel) pour garder
// une grille rectangulaire — nécessaire pour aligner correctement le
// remplissage cellule par cellule sur le tableau réellement inséré.
export function padTableRows(rows: string[][], cols: number): string[][] {
  return rows.map(row => {
    const padded = [...row]
    while (padded.length < cols) padded.push('')
    return padded
  })
}
