import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'

import { findElementRefs, markdownElementRefs, type ElementRefsEnv } from './elementRefs'

// GH229 §2.2 — ID d'élément dans le texte (scénarios L4–L5 de specs/GH229-tests.md).

const IDS = new Set(['SYS-0001', 'REQ-MC-SW-001', 'TC-0002'])
const exists = (id: string) => IDS.has(id)
const ids = (text: string) => findElementRefs(text, exists).map(r => r.id)

describe('findElementRefs (L4)', () => {
  it('ID existant délimité, ponctuation comprise', () => {
    expect(ids('voir SYS-0001.')).toEqual(['SYS-0001'])
    expect(ids('(SYS-0001, TC-0002)')).toEqual(['SYS-0001', 'TC-0002'])
    expect(ids('SYS-0001')).toEqual(['SYS-0001'])
  })
  it('collé à une lettre ou un chiffre : pas de lien', () => {
    expect(ids('SYS-0001A')).toEqual([])
    expect(ids('xSYS-0001')).toEqual([])
    expect(ids('SYS-00012')).toEqual([])
  })
  it('ID inexistant : pas de lien', () => {
    expect(ids('voir SYS-9999')).toEqual([])
  })
  it('préfixe à tirets pris en entier, jamais en partie', () => {
    expect(ids('voir REQ-MC-SW-001')).toEqual(['REQ-MC-SW-001'])
    expect(ids('voir MC-SW-001')).toEqual([])
  })
  it('position exacte', () => {
    expect(findElementRefs('a SYS-0001 b', exists)).toEqual([{ index: 2, id: 'SYS-0001' }])
  })
})

describe('markdownElementRefs (L5)', () => {
  const md = new MarkdownIt({ linkify: false })
  markdownElementRefs(md)
  const render = (src: string, env: ElementRefsEnv = { elementRefs: { exists } }) => md.render(src, env)

  it('texte : lien', () => {
    expect(render('voir SYS-0001 et SYS-9999.')).toContain('<span class="element-ref" data-element-ref="SYS-0001">SYS-0001</span> et SYS-9999.')
  })
  it('code inline, bloc de code, lien Markdown : texte brut', () => {
    expect(render('`SYS-0001`')).not.toContain('element-ref')
    expect(render('```\nSYS-0001\n```')).not.toContain('element-ref')
    expect(render('[SYS-0001](https://example.com)')).not.toContain('element-ref')
  })
  it('sans index : rendu inchangé', () => {
    expect(render('voir SYS-0001', {})).toBe('<p>voir SYS-0001</p>\n')
  })
})
