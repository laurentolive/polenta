import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import { isEarsCompliant, splitRichTextColorTags, stripRichTextColorTags, validatorError } from '@polenta/types'
import { markdownRichTextColors } from './richTextColors'
import { rgbTripletToHex } from './richTextColorValues'

function render(src: string): string {
  const md = new MarkdownIt({ html: false })
  markdownRichTextColors(md)
  return md.render(src)
}

describe('GH299 — stripRichTextColorTags / splitRichTextColorTags', () => {
  it('retire les balises de la palette et garde le contenu', () => {
    expect(stripRichTextColorTags('a <span class="pl-c-red">b</span> <mark class="pl-hl-yellow">c</mark>')).toBe('a b c')
  })

  it('laisse tout autre HTML', () => {
    for (const s of [
      '<span style="color:red">x</span>'.replace('</span>', ''),
      '<span class="pl-c-fuchsia">x',
      '<mark class="pl-c-red">x',
      '<span class="pl-hl-yellow">x',
      '<span class="pl-c-red" id="a">x',
      '<script>x',
    ]) expect(stripRichTextColorTags(s)).toBe(s)
  })

  it('découpe en segments dont la concaténation redonne la source', () => {
    const src = 'x<span class="pl-c-red">y</span>z'
    const parts = splitRichTextColorTags(src)
    expect(parts.map(p => p.text).join('')).toBe(src)
    expect(parts.filter(p => p.tag).map(p => p.text)).toEqual(['<span class="pl-c-red">', '</span>'])
    expect(splitRichTextColorTags('')).toEqual([{ text: '', tag: false }])
  })

  it('EARS : un mot-clé coloré reste conforme', () => {
    const v = '<span class="pl-c-red">WHEN</span> x\nTHE s <mark class="pl-hl-yellow">SHALL</mark> y'
    expect(isEarsCompliant(v)).toBe(true)
    expect(validatorError({ name: 'statement', label: 'Énoncé', validator: 'EARS' }, v)).toBeNull()
  })
})

describe('GH299 — plugin markdown-it', () => {
  it('rend couleur, surlignage et leur imbrication', () => {
    expect(render('a <span class="pl-c-red">b</span>')).toBe('<p>a <span class="pl-c-red">b</span></p>\n')
    expect(render('<mark class="pl-hl-yellow"><span class="pl-c-blue">b</span></mark>'))
      .toBe('<p><mark class="pl-hl-yellow"><span class="pl-c-blue">b</span></mark></p>\n')
  })

  it('compose avec le gras, une puce, un titre, un tableau, un ID', () => {
    expect(render('**<span class="pl-c-red">b</span>**')).toBe('<p><strong><span class="pl-c-red">b</span></strong></p>\n')
    expect(render('<span class="pl-c-red">**b**</span>')).toBe('<p><span class="pl-c-red"><strong>b</strong></span></p>\n')
    expect(render('- <span class="pl-c-red">b</span>')).toContain('<li><span class="pl-c-red">b</span></li>')
    expect(render('## <mark class="pl-hl-green">t</mark>')).toBe('<h2><mark class="pl-hl-green">t</mark></h2>\n')
    expect(render('| a |\n|---|\n| <span class="pl-c-gray">c</span> |')).toContain('<td><span class="pl-c-gray">c</span></td>')
    expect(render('<span class="pl-c-red">[[SYS-0001]]</span>')).toContain('<span class="pl-c-red">[[SYS-0001]]</span>')
  })

  it('laisse littéral (échappé) tout ce qui sort de la liste blanche', () => {
    expect(render('<span style="color:red">x</span>')).toBe('<p>&lt;span style=&quot;color:red&quot;&gt;x&lt;/span&gt;</p>\n')
    expect(render('<span class="pl-c-fuchsia">x</span>')).not.toContain('<span')
    expect(render('<span class="pl-c-red">x')).toBe('<p>&lt;span class=&quot;pl-c-red&quot;&gt;x</p>\n')
    expect(render('x</span>')).toBe('<p>x&lt;/span&gt;</p>\n')
    expect(render('<script>alert(1)</script>')).not.toContain('<script')
    expect(render('`<span class="pl-c-red">x</span>`')).not.toContain('<span')
    expect(render('```\n<span class="pl-c-red">x</span>\n```')).not.toContain('<span')
    expect(render('&lt;span class="pl-c-red"&gt;x</span>')).not.toContain('<span')
  })

  it('imbrication stricte : des balises qui se chevauchent restent en partie littérales', () => {
    expect(render('<span class="pl-c-red">a<mark class="pl-hl-yellow">b</span>c</mark>'))
      .toBe('<p>&lt;span class=&quot;pl-c-red&quot;&gt;a<mark class="pl-hl-yellow">b&lt;/span&gt;c</mark></p>\n')
  })

  it('ne s\'apparie pas d\'un paragraphe à l\'autre', () => {
    expect(render('<span class="pl-c-red">a\n\nb</span>')).not.toContain('<span')
  })

  it('est idempotent', () => {
    const md = new MarkdownIt({ html: false })
    markdownRichTextColors(md)
    markdownRichTextColors(md)
    expect(md.render('<span class="pl-c-red">b</span>')).toBe('<p><span class="pl-c-red">b</span></p>\n')
  })

  it('convertit un triplet RGB en hex', () => {
    expect(rgbTripletToHex('220 38 38')).toBe('DC2626')
    expect(rgbTripletToHex('0 0 0')).toBe('000000')
  })
})
