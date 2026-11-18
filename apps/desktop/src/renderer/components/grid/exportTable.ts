import type { TableExportPayload } from '@polenta/types'

/** GH389 — colonne exportée : texte affiché de la cellule, URL éventuelle (valeur `link`). */
export interface ExportableColumn<R> {
  key: string
  label: string
  text(row: R): string
  hyperlink?(row: R): string | undefined
}

/** Caractères refusés par Excel dans un nom de feuille. */
const SHEET_FORBIDDEN = /[[\]:*?/\\]/g
const SHEET_MAX = 31

/** Nom de feuille Excel : caractères interdits remplacés, 31 caractères au plus, jamais vide. */
export function sheetNameOf(title: string): string {
  const cleaned = title.replace(SHEET_FORBIDDEN, ' ').replace(/\s+/g, ' ').trim().slice(0, SHEET_MAX).trim()
  return cleaned || 'Sheet1'
}

/** Nom de fichier proposé (sans extension) : titre de la grille, caractères refusés par les systèmes de fichiers retirés. */
export function fileBaseNameOf(title: string): string {
  // eslint-disable-next-line no-control-regex
  return title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim() || 'export'
}

/** Liens d'élément d'une cellule exportés en texte : ID affichés séparés par « , ». */
export function joinIds(ids: readonly string[]): string {
  return ids.join(', ')
}

/**
 * Payload `table` : `rows` = lignes affichées (déjà filtrées, dans l'ordre), `columns` = colonnes
 * visibles dans l'ordre, `widths` en px, `freezeColCount` = colonnes figées parmi elles.
 */
export function buildTablePayload<R>(
  title: string, columns: readonly ExportableColumn<R>[], rows: readonly R[], widths: Readonly<Record<string, number>> = {}, freezeColCount = 0,
): TableExportPayload {
  const hyperlinks: Record<string, Record<string, string>> = {}
  const outRows = rows.map((row, i) => {
    const values: Record<string, string> = {}
    for (const col of columns) {
      values[col.key] = col.text(row)
      const url = col.hyperlink?.(row)
      if (url) (hyperlinks[String(i)] ??= {})[col.key] = url
    }
    return values
  })
  return {
    sheetName: sheetNameOf(title),
    columns: columns.map(c => ({ key: c.key, label: c.label, ...(widths[c.key] ? { width: widths[c.key] } : {}) })),
    rows: outRows,
    ...(Object.keys(hyperlinks).length > 0 ? { hyperlinks } : {}),
    ...(freezeColCount > 0 ? { freezeColCount: Math.min(freezeColCount, columns.length) } : {}),
  }
}
