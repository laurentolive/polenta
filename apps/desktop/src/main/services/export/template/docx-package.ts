import type PizZip from 'pizzip'

// GH34 sprint 2 — tout ce que l'insertion de contenu riche (`{{@rich.x}}`) doit ajouter au paquet
// .docx du gabarit, à côté de `word/document.xml` : médias et leurs relations, définitions de
// numérotation des listes, content types. Les identifiants sont alloués pendant la conversion
// Markdown → OOXML (avant le rendu docxtemplater) et matérialisés par `finalize` après le rendu.

const REL_IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'
const REL_NUMBERING = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering'
const CT_NUMBERING = 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml'
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const ROOT_NAMESPACES: Record<string, string> = {
  'xmlns:r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  'xmlns:wp': 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  'xmlns:a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
  'xmlns:pic': 'http://schemas.openxmlformats.org/drawingml/2006/picture',
}
const MIME_BY_EXT: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif' }

/** Styles du gabarit utilisés par le contenu riche, recherchés par nom canonique (`w:name`) —
 *  l'ID (`w:styleId`) dépend de la langue de Word (`Titre1` en français, `Heading1` en anglais). */
export interface TemplateStyles {
  headings: (string | null)[] // index 0 = heading 1
  listParagraph: string | null
  tableGrid: string | null
  quote: string | null
  codeChar: string | null
}

export type ListKind = 'bullet' | 'decimal'

export class DocxPackage {
  readonly styles: TemplateStyles
  /** Largeur utile de la page (EMU) : largeur − marges de la dernière section du gabarit. */
  readonly contentWidthEmu: number

  private readonly media: { rId: string; path: string; ext: string; data: Buffer }[] = []
  private readonly nums: { numId: number; kind: ListKind; start: number; level: number }[] = []
  private nextNumId: number
  private readonly abstractIds: Record<ListKind, number>
  private nextDocPrId = 10000

  /** Le gabarit contient au moins une balise brute `{{@…}}` : sans elle, aucun contenu riche
   *  n'est inséré et la conversion (images distantes comprises) est inutile. */
  readonly usesRawTags: boolean

  constructor(zip: PizZip) {
    this.styles = readStyles(zip.file('word/styles.xml')?.asText() ?? '')
    const documentXml = zip.file('word/document.xml')?.asText() ?? ''
    this.contentWidthEmu = readContentWidthEmu(documentXml)
    // Texte seul (balises XML retirées) : Word coupe souvent une balise sur plusieurs runs.
    this.usesRawTags = documentXml.replace(/<[^>]+>/g, '').includes('{{@')
    const numbering = zip.file('word/numbering.xml')?.asText() ?? ''
    const maxAbstract = maxAttr(numbering, /w:abstractNumId="(\d+)"/g)
    this.abstractIds = { bullet: maxAbstract + 1, decimal: maxAbstract + 2 }
    this.nextNumId = maxAttr(numbering, /w:numId="(\d+)"/g) + 1
  }

  /** Enregistre une image et renvoie l'ID de relation à référencer (`r:embed`). */
  addImage(data: Buffer, ext: 'png' | 'jpeg' | 'gif'): string {
    const n = this.media.length + 1
    const rId = `rIdPolenta${n}`
    this.media.push({ rId, path: `media/polenta-${n}.${ext}`, ext, data })
    return rId
  }

  /** Numérotation propre à une liste (chaque liste repart de `start`). */
  addList(kind: ListKind, level: number, start = 1): number {
    const numId = this.nextNumId++
    this.nums.push({ numId, kind, start, level })
    return numId
  }

  /** ID unique de `wp:docPr` (obligatoire et unique par dessin dans le document). */
  nextDrawingId(): number {
    return this.nextDocPrId++
  }

  /** Après `doc.render()` : ajoute médias, relations, numérotation et content types au zip rendu. */
  finalize(zip: PizZip): void {
    let documentXml = zip.file('word/document.xml')?.asText()
    if (documentXml) {
      documentXml = ensureRootNamespaces(documentXml)
      documentXml = ensureCellsEndWithParagraph(documentXml)
      documentXml = renumberDrawings(documentXml)
      zip.file('word/document.xml', documentXml)
    }

    const relsPath = 'word/_rels/document.xml.rels'
    let rels = zip.file(relsPath)?.asText()
      ?? '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
    let contentTypes = zip.file('[Content_Types].xml')?.asText() ?? ''

    for (const m of this.media) {
      zip.file(`word/${m.path}`, m.data)
      rels = rels.replace('</Relationships>', `<Relationship Id="${m.rId}" Type="${REL_IMAGE}" Target="${m.path}"/></Relationships>`)
      if (!new RegExp(`<Default[^>]*Extension="${m.ext}"`, 'i').test(contentTypes)) {
        contentTypes = contentTypes.replace('</Types>', `<Default Extension="${m.ext}" ContentType="${MIME_BY_EXT[m.ext]}"/></Types>`)
      }
    }

    if (this.nums.length > 0) {
      let numbering = zip.file('word/numbering.xml')?.asText()
      if (!numbering) {
        numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="${W_NS}"></w:numbering>`
        rels = rels.replace('</Relationships>', `<Relationship Id="rIdPolentaNumbering" Type="${REL_NUMBERING}" Target="numbering.xml"/></Relationships>`)
        if (!contentTypes.includes('/word/numbering.xml')) {
          contentTypes = contentTypes.replace('</Types>', `<Override PartName="/word/numbering.xml" ContentType="${CT_NUMBERING}"/></Types>`)
        }
      }
      zip.file('word/numbering.xml', addNumbering(numbering, this.abstractIds, this.nums))
    }

    zip.file(relsPath, rels)
    if (contentTypes) zip.file('[Content_Types].xml', contentTypes)
  }
}

function maxAttr(xml: string, re: RegExp): number {
  let max = 0
  for (const m of xml.matchAll(re)) max = Math.max(max, Number(m[1]))
  return max
}

function readStyles(stylesXml: string): TemplateStyles {
  const byName = new Map<string, string>()
  for (const m of stylesXml.matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g)) {
    const id = /w:styleId="([^"]+)"/.exec(m[1])?.[1]
    const name = /<w:name w:val="([^"]+)"/.exec(m[2])?.[1]
    if (id && name) byName.set(name.toLowerCase(), id)
  }
  return {
    headings: [1, 2, 3, 4, 5, 6].map(n => byName.get(`heading ${n}`) ?? null),
    listParagraph: byName.get('list paragraph') ?? null,
    tableGrid: byName.get('table grid') ?? null,
    quote: byName.get('quote') ?? null,
    codeChar: byName.get('html code') ?? null,
  }
}

// Défaut A4 portrait, marges 2,5 cm, si le gabarit n'a pas de `w:sectPr` lisible.
const DEFAULT_CONTENT_TWIPS = 11906 - 2 * 1418

function readContentWidthEmu(documentXml: string): number {
  const sectPrs = [...documentXml.matchAll(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g)]
  const last = sectPrs.at(-1)?.[0] ?? ''
  const width = Number(/<w:pgSz\b[^>]*w:w="(\d+)"/.exec(last)?.[1])
  const left = Number(/<w:pgMar\b[^>]*w:left="(\d+)"/.exec(last)?.[1] ?? 0)
  const right = Number(/<w:pgMar\b[^>]*w:right="(\d+)"/.exec(last)?.[1] ?? 0)
  const twips = width > 0 ? width - left - right : DEFAULT_CONTENT_TWIPS
  return Math.max(twips, 1440) * 635 // 1 twip = 635 EMU
}

/** Préfixes `r:`, `wp:`, `a:`, `pic:` utilisés par les images insérées : déclarés à la racine
 *  s'ils manquent (les gabarits Word les déclarent normalement déjà). */
function ensureRootNamespaces(xml: string): string {
  return xml.replace(/<w:document\b([^>]*)>/, (whole, attrs: string) => {
    const missing = Object.entries(ROOT_NAMESPACES).filter(([name]) => !attrs.includes(`${name}=`))
    if (missing.length === 0) return whole
    return `<w:document${attrs}${missing.map(([n, v]) => ` ${n}="${v}"`).join('')}>`
  })
}

/**
 * Une cellule de tableau Word doit se terminer par un paragraphe. Une balise `{{@rich.x}}` seule
 * dans une cellule remplace ce paragraphe : par le contenu converti (qui peut finir par un
 * tableau), ou par rien si le champ est vide. On rétablit un paragraphe vide dans ces deux cas.
 */
function ensureCellsEndWithParagraph(xml: string): string {
  return xml
    .replace(/<\/w:tbl>(\s*)<\/w:tc>/g, '</w:tbl>$1<w:p/></w:tc>')
    .replace(/<\/w:tcPr>(\s*)<\/w:tc>/g, '</w:tcPr>$1<w:p/></w:tc>')
    .replace(/<w:tc>(\s*)<\/w:tc>/g, '<w:tc>$1<w:p/></w:tc>')
}

/**
 * `wp:docPr/@id` doit être unique dans le document : un fragment riche inséré deux fois, ou une
 * image du gabarit répétée par une boucle, en dupliquerait. Renumérotation séquentielle de tous
 * les dessins (et de leur `pic:cNvPr`) — les ID ne sont référencés nulle part ailleurs.
 */
function renumberDrawings(xml: string): string {
  let next = 1
  return xml.replace(/<w:drawing>[\s\S]*?<\/w:drawing>/g, drawing => {
    const id = next++
    return drawing
      .replace(/(<wp:docPr\b[^>]*?\bid=")\d+"/, `$1${id}"`)
      .replace(/(<pic:cNvPr\b[^>]*?\bid=")\d+"/, `$1${id}"`)
  })
}

const BULLETS = ['•', '◦', '▪']

function abstractNumXml(id: number, kind: ListKind): string {
  const levels = Array.from({ length: 9 }, (_, l) => {
    const indent = 720 * (l + 1)
    const fmt = kind === 'bullet'
      ? `<w:numFmt w:val="bullet"/><w:lvlText w:val="${BULLETS[l % BULLETS.length]}"/>`
      : `<w:numFmt w:val="decimal"/><w:lvlText w:val="%${l + 1}."/>`
    return `<w:lvl w:ilvl="${l}"><w:start w:val="1"/>${fmt}<w:lvlJc w:val="left"/>`
      + `<w:pPr><w:ind w:left="${indent}" w:hanging="360"/></w:pPr></w:lvl>`
  }).join('')
  return `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>${levels}</w:abstractNum>`
}

function addNumbering(
  numbering: string,
  abstractIds: Record<ListKind, number>,
  nums: { numId: number; kind: ListKind; start: number; level: number }[],
): string {
  const abstracts = abstractNumXml(abstractIds.bullet, 'bullet') + abstractNumXml(abstractIds.decimal, 'decimal')
  const numXml = nums.map(n =>
    `<w:num w:numId="${n.numId}"><w:abstractNumId w:val="${abstractIds[n.kind]}"/>`
    + `<w:lvlOverride w:ilvl="${n.level}"><w:startOverride w:val="${n.start}"/></w:lvlOverride></w:num>`,
  ).join('')

  // Ordre imposé par le schéma : numPicBullet*, abstractNum*, num*, numIdMacAtCleanup? — les
  // `w:abstractNum` ajoutés suivent ceux du gabarit (ou précèdent son premier `w:num`), les `w:num`
  // ajoutés suivent ceux du gabarit (ou nos `w:abstractNum`), jamais en toute fin de partie.
  const lastAbstract = numbering.lastIndexOf('</w:abstractNum>')
  const firstNum = numbering.search(/<w:num[\s>]/)
  let at: number
  if (lastAbstract >= 0) at = lastAbstract + '</w:abstractNum>'.length
  else if (firstNum >= 0) at = firstNum
  else at = numbering.search(/<w:numIdMacAtCleanup\b|<\/w:numbering>/)
  numbering = numbering.slice(0, at) + abstracts + numbering.slice(at)
  const lastNum = numbering.lastIndexOf('</w:num>')
  const numAt = lastNum >= 0 ? lastNum + '</w:num>'.length : at + abstracts.length
  return numbering.slice(0, numAt) + numXml + numbering.slice(numAt)
}
