import { inflateRawSync } from 'zlib'

export interface DrawioPage {
  id: string
  name: string
  /** mxGraphModel XML décompressé, prêt à parser côté renderer (DOMParser). */
  xml: string
}

const DIAGRAM_RE = /<diagram\b([^>]*)>([\s\S]*?)<\/diagram>/g
const ATTR_RE = /(\w+)="([^"]*)"/g

function parseAttrs(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  let m: RegExpExecArray | null
  ATTR_RE.lastIndex = 0
  while ((m = ATTR_RE.exec(attrString))) {
    attrs[m[1]] = m[2]
  }
  return attrs
}

/**
 * Un fichier .drawio (<mxfile>) contient une ou plusieurs pages <diagram>.
 * Par défaut draw.io stocke le contenu de chaque page compressé
 * (deflate brut + base64, avec le XML original URI-encodé avant compression) ;
 * "Edit > Diagram Properties > uncompressed" produit du XML <mxGraphModel> littéral.
 * On gère les deux cas ici pour renvoyer systématiquement du XML prêt à parser.
 */
export function parseDrawioPages(raw: string): DrawioPage[] {
  const pages: DrawioPage[] = []
  let match: RegExpExecArray | null
  DIAGRAM_RE.lastIndex = 0
  let index = 0
  while ((match = DIAGRAM_RE.exec(raw))) {
    const attrs = parseAttrs(match[1])
    const content = match[2].trim()
    const id = attrs.id ?? `page-${index}`
    const name = attrs.name ?? `Page ${index + 1}`
    let xml = ''
    if (content.startsWith('<mxGraphModel')) {
      xml = content
    } else if (content.length > 0) {
      try {
        const inflated = inflateRawSync(Buffer.from(content, 'base64'))
        xml = decodeURIComponent(inflated.toString('utf-8'))
      } catch {
        xml = ''
      }
    }
    pages.push({ id, name, xml })
    index++
  }
  return pages
}
