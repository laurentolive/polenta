import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'

import type { LinkValue } from '@polenta/types'
import { linkParagraphs } from './template/markdown-to-ooxml'
import { readLinkCell, writeLinkCell } from './link-cell.util'

// GH195 — lecture des liens saisis par un technicien dans une cellule Excel, et cellule écrite par
// l'export relue sans perte (specs/GH195.md §1.7, §1.10). Les valeurs passent par un vrai fichier
// xlsx (écrit puis relu par ExcelJS) : c'est la forme sous laquelle l'import les recevra.

async function roundTrip(fill: (sheet: ExcelJS.Worksheet) => void): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook()
  fill(wb.addWorksheet('S'))
  const buffer = await wb.xlsx.writeBuffer()
  const back = new ExcelJS.Workbook()
  await back.xlsx.load(buffer as ArrayBuffer)
  return back.getWorksheet('S')!
}

describe('readLinkCell', () => {
  it('reconnaît chaque forme de saisie', async () => {
    const sheet = await roundTrip(s => {
      s.getCell('A1').value = { text: 'RE-118', hyperlink: 'https://ged/118' }            // Insertion › Lien
      s.getCell('A2').value = { text: 'https://ged/118', hyperlink: 'https://ged/118' }   // URL auto-convertie
      s.getCell('A3').value = { formula: 'HYPERLINK("https://ged/118","RE-118")', result: 'RE-118' }
      s.getCell('A4').value = { formula: 'HYPERLINK("https://ged/118")', result: 'https://ged/118' }
      s.getCell('A5').value = 'https://ged/118'
      s.getCell('A6').value = 'RE-118 | https://ged/118'
      s.getCell('A7').value = 'RE-118 | https://ged/118\n\\\\srv\\essais\\photos'
      s.getCell('A8').value = { text: 'Rapport\nPhotos | file:///C:/p', hyperlink: 'https://ged/118' }
      s.getCell('A9').value = { text: 'www.ged.fr', hyperlink: 'http://www.ged.fr/' }
    })
    const read = (a: string) => readLinkCell(sheet.getCell(a))
    expect(read('A1')).toEqual({ ok: true, links: [{ label: 'RE-118', url: 'https://ged/118' }] })
    expect(read('A2')).toEqual({ ok: true, links: [{ url: 'https://ged/118' }] })
    expect(read('A3')).toEqual({ ok: true, links: [{ label: 'RE-118', url: 'https://ged/118' }] })
    expect(read('A4')).toEqual({ ok: true, links: [{ url: 'https://ged/118' }] })
    expect(read('A5')).toEqual({ ok: true, links: [{ url: 'https://ged/118' }] })
    expect(read('A6')).toEqual({ ok: true, links: [{ label: 'RE-118', url: 'https://ged/118' }] })
    expect(read('A7')).toEqual({ ok: true, links: [{ label: 'RE-118', url: 'https://ged/118' }, { url: '\\\\srv\\essais\\photos' }] })
    expect(read('A8')).toEqual({ ok: true, links: [{ label: 'Rapport', url: 'https://ged/118' }, { label: 'Photos', url: 'file:///C:/p' }] })
    expect(read('A9')).toEqual({ ok: true, links: [{ label: 'www.ged.fr', url: 'http://www.ged.fr/' }] })
  })

  it('cellule vide : aucun lien ; ligne sans URL : erreur nommant la cellule', async () => {
    const sheet = await roundTrip(s => {
      s.getCell('B2').value = 'voir rapport papier'
    })
    expect(readLinkCell(sheet.getCell('B1'))).toEqual({ ok: true, links: [] })
    const bad = readLinkCell(sheet.getCell('B2'))
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.reason).toMatch(/^cellule B2 : « voir rapport papier »/)
  })
})

describe('writeLinkCell', () => {
  const cases: LinkValue[][] = [
    [{ label: 'RE-118', url: 'https://ged/118' }],
    [{ url: 'https://ged/118' }],
    [{ label: 'RE-118', url: 'https://ged/118' }, { url: '\\\\srv\\essais\\photos' }, { label: 'Log', url: 'file:///C:/log.txt' }],
  ]

  it('hyperlien natif, relu sans perte', async () => {
    const sheet = await roundTrip(s => cases.forEach((links, i) => writeLinkCell(s.getCell(`A${i + 1}`), links)))
    cases.forEach((links, i) => {
      const cell = sheet.getCell(`A${i + 1}`)
      expect((cell.value as { hyperlink?: string }).hyperlink).toBe(links[0].url)
      expect(readLinkCell(cell)).toEqual({ ok: true, links })
    })
  })

  it('aucun lien : cellule vide', () => {
    const cell = new ExcelJS.Workbook().addWorksheet('S').getCell('A1')
    writeLinkCell(cell, [])
    expect(cell.value).toBeNull()
  })
})

describe('linkParagraphs (gabarit docx)', () => {
  it('un w:hyperlink par lien, relation externe enregistrée une fois par cible', () => {
    const rIds: string[] = []
    const pkg = { addHyperlink: (url: string) => { rIds.push(url); return `rId${rIds.indexOf(url) + 1}` } }
    const xml = linkParagraphs([{ label: 'A & B', url: 'https://a' }, { url: 'https://b' }], pkg as never)
    expect(xml.match(/<w:hyperlink /g)).toHaveLength(2)
    expect(xml).toContain('r:id="rId1"')
    expect(xml).toContain('A &amp; B')
    expect(xml).toContain('>https://b<')
  })
})
