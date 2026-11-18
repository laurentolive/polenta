import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'
import * as fsP from 'fs/promises'
import type { ExecutionsExportPayload } from '@polenta/types'

const lines = (text: string) => text.split('\n').map(line => new Paragraph({ text: line }))
const textCell = (text: string, bold = false) =>
  new TableCell({ children: text.split('\n').map(line => new Paragraph({ children: [new TextRun({ text: line, bold })] })) })

/** Construit le document (séparé de l'écriture : testé sans fichier). */
export function buildExecutionsDocument(payload: ExecutionsExportPayload): Document {
  const children: (Paragraph | Table)[] = [new Paragraph({ text: payload.title, heading: HeadingLevel.TITLE })]
  for (const run of payload.runs) {
    children.push(new Paragraph({ text: run.heading, heading: HeadingLevel.HEADING_2 }))
    if (run.meta) children.push(new Paragraph({ children: [new TextRun({ text: run.meta, italics: true, color: '666666' })] }))
    for (const field of run.fields) {
      if (!field.value.trim()) continue
      children.push(new Paragraph({ children: [new TextRun({ text: field.label, bold: true })] }), ...lines(field.value))
    }
    if (run.notes.trim()) children.push(new Paragraph({ children: [new TextRun({ text: payload.labels.notes, bold: true })] }), ...lines(run.notes))
    if (run.steps && run.steps.length > 0) {
      const fieldLabels = [...new Set(run.steps.flatMap(s => s.fields.map(f => f.label)))]
      const header = new TableRow({
        tableHeader: true,
        children: ['#', payload.labels.stepVerdict, payload.labels.stepComment, ...fieldLabels].map(h => textCell(h, true)),
      })
      const rows = run.steps.map(s => new TableRow({
        children: [
          textCell(String(s.order)), textCell(s.result), textCell(s.comment),
          ...fieldLabels.map(label => textCell(s.fields.find(f => f.label === label)?.value ?? '')),
        ],
      }))
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...rows] }))
    }
  }
  return new Document({ sections: [{ children }] })
}

/**
 * GH400 — Document de la vue Exécutions : un titre par exécution (test), une ligne d'en-tête
 * (verdict, date, testeur, campagne, entrée), les champs de l'onglet Document, les notes et, si
 * demandé, le tableau des étapes (même contenu que l'écran).
 */
export async function exportExecutionsDocx(payload: ExecutionsExportPayload, destPath: string): Promise<void> {
  const buffer = await Packer.toBuffer(buildExecutionsDocument(payload))
  await fsP.writeFile(destPath, buffer)
}
