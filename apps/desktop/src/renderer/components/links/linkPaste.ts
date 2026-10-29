import { encodeLinkSeparator, isAcceptedLinkUrl, parseLinksText, type LinkValue } from '@polenta/types'

// GH195 — collage dans un champ lien (specs/GH195.md §1.10) : les liens hypertexte copiés depuis
// Word, Excel, Outlook ou un navigateur arrivent en `text/html` (`<a href>`) ; sinon le texte est lu
// ligne à ligne (URL brute ou `libellé | URL`). Seules les ancres sont lues, aucun autre HTML.

export interface PastedLinks {
  links: LinkValue[]
  /** Ancres ou lignes ignorées (schéma d'URL non accepté). */
  rejected: number
}

function fromHtml(html: string): PastedLinks | null {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const anchors = [...doc.querySelectorAll('a[href]')]
  if (anchors.length === 0) return null
  const links: LinkValue[] = []
  let rejected = 0
  for (const a of anchors) {
    const url = encodeLinkSeparator((a.getAttribute('href') ?? '').trim())
    if (!isAcceptedLinkUrl(url)) { rejected++; continue }
    const label = (a.textContent ?? '').replace(/\s+/g, ' ').replace(/\|/g, '/').trim()
    links.push(label && label !== url ? { label, url } : { url })
  }
  return links.length > 0 ? { links, rejected } : null
}

/**
 * Liens d'un collage, ou `null` pour laisser le collage natif (aucune URL reconnue : l'utilisateur
 * colle un libellé ou une portion d'URL).
 */
export function linksFromClipboard(data: Pick<DataTransfer, 'getData'>): PastedLinks | null {
  const html = data.getData('text/html')
  if (html) {
    const fromAnchors = fromHtml(html)
    if (fromAnchors) return fromAnchors
  }
  const parsed = parseLinksText(data.getData('text/plain')).filter(l => l.url)
  const accepted = parsed.filter(l => isAcceptedLinkUrl(l.url))
  return accepted.length > 0 ? { links: accepted, rejected: parsed.length - accepted.length } : null
}
