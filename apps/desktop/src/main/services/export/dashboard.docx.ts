import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } from 'docx'
import * as fsP from 'fs/promises'
import type { DashboardExportPayload } from '@polenta/types'

/** Dashboard — export docx (T43 sprint 3). Pas de rendu graphique (les charts Recharts ne se
 *  transposent pas en docx) — chaque widget est représenté par son titre et un tableau des
 *  données sous-jacentes (`widgetResults`, déjà exécutées côté renderer, cf.
 *  specs/T43-design.md décision structurante xlsx/docx = payload direct). Pas d'équivalent xlsx
 *  (cf. specs/T43.md §2) : le pdf reste le format recommandé pour un rendu visuel fidèle
 *  (`print.dashboard.tsx` réutilise `DashboardGrid` en mode impression, graphiques inclus). */
export async function exportDashboardDocx(
  payload: DashboardExportPayload,
  destPath: string,
): Promise<void> {
  const { dashboard, widgetResults } = payload
  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: `Dashboard — ${dashboard.title}`, heading: HeadingLevel.TITLE }),
  ]

  for (const widget of dashboard.widgets) {
    children.push(new Paragraph({ text: widget.title, heading: HeadingLevel.HEADING_2 }))

    const result = widgetResults[widget.id]
    // `columns.length === 0` inclus : un `Table` docx sans colonne (TableRow aux enfants vides)
    // n'est pas supporté par la librairie et peut faire échouer tout le document au packaging
    // (bug trouvé en revue de code) — traité comme "pas de donnée", même repli que `!result`.
    if (!result || result.columns.length === 0 || result.rows.length === 0) {
      children.push(new Paragraph({
        children: [new TextRun({ text: 'Aucune donnée.', italics: true })],
      }))
      continue
    }

    const headerRow = new TableRow({
      children: result.columns.map(col => new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: col.name, bold: true })] })],
      })),
    })
    const dataRows = result.rows.map(row => new TableRow({
      children: result.columns.map(col => new TableCell({
        children: [new Paragraph({ text: row[col.name] == null ? '' : String(row[col.name]) })],
      })),
    }))

    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headerRow, ...dataRows],
    }))
  }

  const doc = new Document({ sections: [{ children }] })
  const buffer = await Packer.toBuffer(doc)
  await fsP.writeFile(destPath, buffer)
}
