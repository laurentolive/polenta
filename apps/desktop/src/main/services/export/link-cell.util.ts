import type ExcelJS from 'exceljs'
import { ExternalHyperlink, Paragraph, TextRun } from 'docx'
import {
  formatLinksText, isAcceptedLinkUrl, linkDisplayText, parseLinkLine, parseLinksText, type LinkValue,
} from '@polenta/types'

// GH195 — cellules Excel d'un champ `link` (specs/GH195.md §1.7, §1.10). `readLinkCell` reconnaît
// ce que saisit un technicien : hyperlien natif, formule HYPERLINK (LIEN_HYPERTEXTE en français,
// stockée HYPERLINK dans le fichier), URL brute, `libellé | URL`, plusieurs lignes. `writeLinkCell`
// écrit une cellule que `readLinkCell` relit sans perte.

/** Export docx Standard (lib `docx`) : un paragraphe par lien, hyperlien natif. `text` : forme
 *  texte `libellé | URL` reçue du renderer. */
export function linkParagraphsDocx(text: string): Paragraph[] {
  return parseLinksText(text).map(link => new Paragraph({
    children: [new ExternalHyperlink({
      link: link.url,
      children: [new TextRun({ text: linkDisplayText(link), color: '0563C1', underline: {} })],
    })],
  }))
}

export type LinkCellRead = { ok: true; links: LinkValue[] } | { ok: false; reason: string }

const HYPERLINK_FORMULA = /^HYPERLINK\(\s*"((?:[^"]|"")*)"\s*(?:[,;]\s*"((?:[^"]|"")*)"\s*)?\)$/i

function unquote(s: string): string {
  return s.replace(/""/g, '"')
}

function sameUrl(a: string, b: string): boolean {
  return a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase()
}

function richTextOf(v: unknown): string | null {
  if (v && typeof v === 'object' && Array.isArray((v as { richText?: unknown }).richText)) {
    return (v as { richText: { text: string }[] }).richText.map(r => r.text).join('')
  }
  return null
}

/** Texte affiché et cible d'hyperlien d'une valeur de cellule ExcelJS. */
function cellContent(value: ExcelJS.CellValue): { text: string; target?: string } {
  if (value === null || value === undefined) return { text: '' }
  if (typeof value === 'string') return { text: value }
  if (typeof value === 'number' || typeof value === 'boolean') return { text: String(value) }
  if (value instanceof Date) return { text: value.toISOString() }
  const rich = richTextOf(value)
  if (rich !== null) return { text: rich }
  if ('hyperlink' in value && typeof value.hyperlink === 'string') {
    const text = typeof value.text === 'string' ? value.text : (richTextOf(value.text) ?? '')
    return { text, target: value.hyperlink }
  }
  if ('formula' in value && typeof value.formula === 'string') {
    const m = HYPERLINK_FORMULA.exec(value.formula.trim())
    if (m) {
      const url = unquote(m[1])
      return { text: m[2] !== undefined ? unquote(m[2]) : url, target: url }
    }
    const result = (value as { result?: unknown }).result
    return { text: result === undefined || result === null ? '' : String(result) }
  }
  if ('text' in value && typeof (value as { text?: unknown }).text === 'string') return { text: (value as { text: string }).text }
  return { text: '' }
}

/**
 * Liens d'une cellule (§1.10). L'hyperlien de la cellule donne la cible de la ligne sans URL
 * (normalement la première) ; s'il n'est repris par aucune ligne et absent des URL lues, il est
 * ajouté en tête. Une ligne sans URL reconnue et non couverte par l'hyperlien est une erreur.
 */
export function readLinkCell(cell: Pick<ExcelJS.Cell, 'value' | 'address'>): LinkCellRead {
  const { text, target } = cellContent(cell.value)
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const links: LinkValue[] = []
  let targetUsed = false
  for (const line of lines) {
    const parsed = parseLinkLine(line)
    if (parsed && isAcceptedLinkUrl(parsed.url)) {
      if (target && sameUrl(parsed.url, target)) targetUsed = true
      links.push(parsed)
    } else if (target && !targetUsed) {
      targetUsed = true
      links.push(sameUrl(line, target) ? { url: target } : { label: line, url: target })
    } else {
      return { ok: false, reason: `cellule ${cell.address} : « ${line} » n'est pas un lien reconnu (http(s)://, file://, \\\\serveur\\partage ou « libellé | URL »)` }
    }
  }
  if (target && !targetUsed) links.unshift({ url: target })
  return { ok: true, links }
}

/**
 * Écrit les liens d'un champ dans une cellule (§1.7) : un lien = hyperlien natif ; plusieurs = le
 * premier en hyperlien de la cellule (Excel n'en porte qu'un), le texte listant tous les liens
 * sous la forme `libellé | URL`, une ligne chacun.
 */
export function writeLinkCell(cell: ExcelJS.Cell, links: LinkValue[]): void {
  if (links.length === 0) {
    cell.value = null
    return
  }
  const text = links.length === 1 ? linkDisplayText(links[0]) : formatLinksText(links)
  cell.value = { text, hyperlink: links[0].url, tooltip: links[0].url }
  cell.font = { ...(cell.font ?? {}), color: { argb: 'FF0563C1' }, underline: true }
  if (links.length > 1) cell.alignment = { ...(cell.alignment ?? {}), wrapText: true, vertical: 'top' }
}
