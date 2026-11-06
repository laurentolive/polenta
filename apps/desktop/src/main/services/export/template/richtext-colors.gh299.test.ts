import { describe, expect, it } from 'vitest'
import { markdownToPlainText } from './markdown-to-text'
import { MarkdownToOoxml } from './markdown-to-ooxml'
import type { DocxPackage } from './docx-package'

// Paquet minimal : la conversion de texte inline n'utilise que les styles (absents → repli).
const pkg = {
  styles: { headings: {}, codeChar: null, listParagraph: null, quote: null, tableGrid: null },
  addList: () => 1,
  addHyperlink: () => 'rId1',
  addImage: () => 'rId2',
  nextDrawingId: () => 1,
  contentWidthEmu: 6_000_000,
} as unknown as DocxPackage

async function ooxml(md: string): Promise<string> {
  return (await new MarkdownToOoxml(pkg, '/repo').convert(md)).render()
}

describe('GH299 — couleurs richtext dans les exports', () => {
  it('texte simple : balises retirées, contenu gardé', () => {
    expect(markdownToPlainText('a <span class="pl-c-red">b</span> <mark class="pl-hl-yellow">**c**</mark>')).toBe('a b c')
  })

  it('texte simple : une balise hors palette reste littérale', () => {
    expect(markdownToPlainText('<span style="color:red">x</span>')).toBe('<span style="color:red">x</span>')
  })

  it('OOXML : couleur du texte → w:color, surlignage → w:shd (valeurs claires)', async () => {
    const xml = await ooxml('a <span class="pl-c-red">b</span> <mark class="pl-hl-yellow">c</mark>')
    expect(xml).toContain('<w:rPr><w:color w:val="DC2626"/></w:rPr><w:t xml:space="preserve">b</w:t>')
    expect(xml).toContain('<w:rPr><w:shd w:val="clear" w:color="auto" w:fill="FEF08A"/></w:rPr><w:t xml:space="preserve">c</w:t>')
    expect(xml).toContain('<w:t xml:space="preserve">a </w:t>')
  })

  it('OOXML : imbrication et ordre du schéma (b, i, strike, color, shd)', async () => {
    // Forme écrite par l'éditeur : balises de couleur à l'extérieur du gras (cf. RichTextColorMarks).
    const xml = await ooxml('<mark class="pl-hl-green"><span class="pl-c-blue">**x**</span>y</mark>z')
    expect(xml).toContain('<w:rPr><w:b/><w:color w:val="1D4ED8"/><w:shd w:val="clear" w:color="auto" w:fill="BBF7D0"/></w:rPr><w:t xml:space="preserve">x</w:t>')
    expect(xml).toContain('<w:rPr><w:shd w:val="clear" w:color="auto" w:fill="BBF7D0"/></w:rPr><w:t xml:space="preserve">y</w:t>')
    expect(xml).toContain('<w:r><w:t xml:space="preserve">z</w:t></w:r>')
  })
})
