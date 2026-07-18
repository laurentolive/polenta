import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx'
import * as fsP from 'fs/promises'
import type { TestsExportPayload } from '@polenta/types'

/** Cahier de test — export docx, miroir de `requirements.docx.ts` : un titre par test (ID + Label),
 *  puis chaque autre colonne visible (`visibleFieldsWord`) en paragraphe labellisé. La colonne
 *  `steps`, quand configurée, affiche le nombre d'étapes (comme `ExcelView`) — pas le détail
 *  action/résultat étape par étape de la version précédente : ce correctif aligne le contenu sur
 *  ce que l'utilisateur a réellement configuré/voit à l'écran plutôt que de garder un contenu
 *  toujours plus riche mais déconnecté de la configuration (une restitution détaillée des étapes
 *  reste possible en évolution séparée si demandée). */
export async function exportTestsDocx(
  payload: TestsExportPayload,
  destPath: string,
): Promise<void> {
  const children: Paragraph[] = [
    new Paragraph({ text: `Cahier de test — ${payload.componentLabel}`, heading: HeadingLevel.TITLE }),
  ]

  const idKey = payload.columns.find(c => c.key === 'id')?.key
  const nameKey = payload.columns.find(c => c.key === 'name')?.key
  const sectionKey = payload.columns.find(c => c.key === 'section')?.key
  const statusKey = payload.columns.find(c => c.key === 'status')?.key
  const versionKey = payload.columns.find(c => c.key === 'version')?.key
  // section/statut/version : compacts dans le sous-titre (miroir du badge d'en-tête de
  // `WordView.ItemCard`) plutôt que répétés en paragraphe labellisé dans le corps.
  const headerKeys = new Set([idKey, nameKey, sectionKey, statusKey, versionKey].filter((k): k is string => !!k))
  const bodyColumns = payload.columns.filter(c => !headerKeys.has(c.key))

  for (const row of payload.rows) {
    const heading = [idKey && row[idKey], nameKey && row[nameKey]].filter(Boolean).join(' — ')
    children.push(new Paragraph({ text: heading || 'Test', heading: HeadingLevel.HEADING_2 }))

    const meta = [
      sectionKey && row[sectionKey] && `§${row[sectionKey]}`,
      statusKey && row[statusKey],
      versionKey && row[versionKey] && `v${row[versionKey]}`,
    ].filter(Boolean).join(' · ')
    if (meta) children.push(new Paragraph({ children: [new TextRun({ text: meta, italics: true, color: '666666' })] }))

    for (const col of bodyColumns) {
      const value = row[col.key]
      if (!value?.trim()) continue
      children.push(new Paragraph({ children: [new TextRun({ text: col.label, bold: true })] }))
      for (const line of value.split('\n')) children.push(new Paragraph({ text: line }))
    }
  }

  const doc = new Document({ sections: [{ children }] })
  const buffer = await Packer.toBuffer(doc)
  await fsP.writeFile(destPath, buffer)
}
