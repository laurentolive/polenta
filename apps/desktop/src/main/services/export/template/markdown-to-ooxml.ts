import { parseMarkdown, stripInternalLinks, type MdToken } from './markdown'
import type { DocxPackage, ListKind } from './docx-package'
import { loadImage, type LoadedImage } from './image-source'

const EMU_PER_PX = 9525 // 96 dpi
const TWIPS_PER_EMU = 1 / 635
const LIST_INDENT_TWIPS = 720

/** Rognage d'une image, en fractions de sa taille naturelle (comme `ResizableImageView`). */
interface CropRect { x: number; y: number; width: number; height: number }

interface ImageRef {
  src: string
  alt: string
  width: number | null
  height: number | null
  crop: CropRect | null
}

/** Liste d'un fragment : sa numérotation Word est allouée à chaque insertion du fragment. */
interface ListSpec { kind: ListKind; level: number; start: number }

/**
 * Contenu riche converti, prêt à insérer. `render()` produit le XML avec des numérotations de
 * listes neuves à chaque appel : un même champ inséré deux fois (ex. `{{@rich.statement}}` puis
 * la boucle `{{#columns}}{{@rich}}`) donne deux listes indépendantes, chacune repartant à 1, au
 * lieu d'une seule liste dont la seconde copie continuerait la numérotation.
 */
export interface RichFragment {
  render(): string
}

const EMPTY_FRAGMENT: RichFragment = { render: () => '' }

/**
 * GH34 sprint 2 — convertit les champs richtext (Markdown) en WordprocessingML pour une balise
 * brute `{{@rich.x}}` : paragraphes et tableaux aux styles du gabarit, listes numérotées par le
 * paquet (`DocxPackage`), images embarquées. Une instance par export : les images déjà chargées
 * sont réutilisées (un média par source distincte).
 */
export class MarkdownToOoxml {
  private readonly images = new Map<string, Promise<{ rId: string; image: LoadedImage } | null>>()

  constructor(private readonly pkg: DocxPackage, private readonly repoPath: string) {}

  async convert(markdown: string): Promise<RichFragment> {
    if (!markdown.trim()) return EMPTY_FRAGMENT
    const conversion = new Conversion(this, this.pkg)
    const xml = await conversion.run(parseMarkdown(markdown))
    const lists = conversion.listSpecs
    if (lists.length === 0) return { render: () => xml }
    return {
      render: () => {
        const numIds = lists.map(l => this.pkg.addList(l.kind, l.level, l.start))
        return xml.replace(/§(\d+)§/g, (_, k: string) => String(numIds[Number(k)]))
      },
    }
  }

  /** Image enregistrée dans le paquet (une seule fois par source), `null` si inutilisable. */
  image(src: string): Promise<{ rId: string; image: LoadedImage } | null> {
    let entry = this.images.get(src)
    if (!entry) {
      entry = loadImage(src, this.repoPath).then(image => (image ? { rId: this.pkg.addImage(image.data, image.ext), image } : null))
      this.images.set(src, entry)
    }
    return entry
  }
}

// `ref` : marqueur `§k§` remplacé par le numId réel à chaque insertion (cf. `RichFragment`).
interface ListFrame { kind: ListKind; ref: string; depth: number }
interface ItemFrame { depth: number; first: boolean }
interface TableFrame { rows: { header: boolean; cells: string[] }[]; inHead: boolean }

/** Parcours séquentiel des tokens d'un champ — état des conteneurs ouverts (listes, citations,
 *  tableaux, cellules). */
class Conversion {
  private readonly containers: string[][] = [[]]
  private readonly lists: ListFrame[] = []
  private readonly items: ItemFrame[] = []
  private readonly tables: TableFrame[] = []
  private quoteDepth = 0
  private headingLevel = 0
  private inHeaderCell = false
  readonly listSpecs: ListSpec[] = []

  constructor(private readonly converter: MarkdownToOoxml, private readonly pkg: DocxPackage) {}

  private get out(): string[] {
    return this.containers[this.containers.length - 1]
  }

  async run(tokens: MdToken[]): Promise<string> {
    for (const token of tokens) await this.visit(token)
    return this.containers[0].join('')
  }

  private async visit(token: MdToken): Promise<void> {
    switch (token.type) {
      case 'heading_open':
        this.headingLevel = Number(token.tag.slice(1))
        break
      case 'heading_close':
        this.headingLevel = 0
        break
      case 'bullet_list_open':
      case 'ordered_list_open': {
        const kind: ListKind = token.type === 'bullet_list_open' ? 'bullet' : 'decimal'
        const depth = this.lists.length
        const start = Number(token.attrGet('start') ?? 1)
        this.listSpecs.push({ kind, level: depth, start })
        this.lists.push({ kind, depth, ref: `§${this.listSpecs.length - 1}§` })
        break
      }
      case 'bullet_list_close':
      case 'ordered_list_close':
        this.lists.pop()
        break
      case 'list_item_open':
        this.items.push({ depth: this.lists.length - 1, first: true })
        break
      case 'list_item_close':
        this.items.pop()
        break
      case 'blockquote_open':
        this.quoteDepth++
        break
      case 'blockquote_close':
        this.quoteDepth--
        break
      case 'inline':
        this.out.push(await this.paragraphFromInline(token))
        break
      case 'fence':
      case 'code_block':
        await this.block(token)
        break
      case 'hr':
        this.out.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr></w:p>')
        break
      case 'table_open':
        this.tables.push({ rows: [], inHead: false })
        break
      case 'thead_open':
        this.tables[this.tables.length - 1].inHead = true
        break
      case 'thead_close':
        this.tables[this.tables.length - 1].inHead = false
        break
      case 'tr_open': {
        const table = this.tables[this.tables.length - 1]
        table.rows.push({ header: table.inHead, cells: [] })
        break
      }
      case 'th_open':
      case 'td_open':
        this.inHeaderCell = token.type === 'th_open'
        this.containers.push([])
        break
      case 'th_close':
      case 'td_close': {
        const content = this.containers.pop()!.join('') || '<w:p/>'
        const table = this.tables[this.tables.length - 1]
        table.rows[table.rows.length - 1].cells.push(content)
        this.inHeaderCell = false
        break
      }
      case 'table_close':
        this.out.push(this.tableXml(this.tables.pop()!))
        break
      default:
        break
    }
  }

  // ── Blocs ─────────────────────────────────────────────────────────────────

  private async paragraphFromInline(token: MdToken): Promise<string> {
    // Copie : la case à cocher d'une liste de tâches retire son marqueur du premier texte.
    const children = [...(token.children ?? [])]
    const props: string[] = []
    let prefixRun = ''
    const bold = this.inHeaderCell

    if (this.headingLevel > 0) {
      const style = this.pkg.styles.headings[this.headingLevel - 1]
      if (style) props.push(`<w:pStyle w:val="${style}"/>`)
      // Sans style de titre dans le gabarit : au moins du gras, pour rester lisible.
      return paragraph(props, await this.runs(children, { bold: bold || !style }))
    }

    const item = this.items[this.items.length - 1]
    if (item) {
      const list = this.lists[this.lists.length - 1]
      if (this.pkg.styles.listParagraph) props.push(`<w:pStyle w:val="${this.pkg.styles.listParagraph}"/>`)
      const indent = LIST_INDENT_TWIPS * (item.depth + 1)
      const task = item.first ? /^\[( |x|X)\]\s+/.exec(children[0]?.type === 'text' ? children[0].content : '') : null
      if (task) {
        // Case à cocher GFM : la case remplace la puce (spec §2.5).
        children[0] = { ...children[0], content: children[0].content.slice(task[0].length) } as MdToken
        prefixRun = run(task[1] === ' ' ? '☐ ' : '☒ ', {})
        props.push(`<w:ind w:left="${indent}" w:hanging="360"/>`)
      } else if (item.first && list) {
        props.push(`<w:numPr><w:ilvl w:val="${item.depth}"/><w:numId w:val="${list.ref}"/></w:numPr>`)
      } else {
        props.push(`<w:ind w:left="${indent}"/>`)
      }
      item.first = false
    } else if (this.quoteDepth > 0) {
      if (this.pkg.styles.quote) props.push(`<w:pStyle w:val="${this.pkg.styles.quote}"/>`)
      else props.push(`<w:ind w:left="${LIST_INDENT_TWIPS * this.quoteDepth}"/>`)
    }

    return paragraph(props, prefixRun + await this.runs(children, { bold, italic: this.quoteDepth > 0 && !this.pkg.styles.quote }))
  }

  private async block(token: MdToken): Promise<void> {
    const info = token.info.trim()
    if (token.type === 'fence' && info === 'image') {
      const ref = parseImageFence(token.content)
      this.out.push(ref ? paragraph([], await this.imageRun(ref)) : '')
      return
    }
    if (token.type === 'fence' && info === 'drawio') {
      // Rendu des diagrammes en image : sprint 3 (GH34-design §2.5). Repli explicite d'ici là.
      const ref = parseJson(token.content)
      const target = typeof ref?.path === 'string' ? `${ref.path}${typeof ref.nodeId === 'string' && ref.nodeId ? `#${ref.nodeId}` : ''}` : ''
      this.out.push(paragraph([], run(`[Diagramme : ${target}]`, { italic: true })))
      return
    }
    for (const line of token.content.replace(/\n$/, '').split('\n')) {
      this.out.push(paragraph([], run(line, { code: true }, this.pkg)))
    }
  }

  private tableXml(table: TableFrame): string {
    const columns = Math.max(1, ...table.rows.map(r => r.cells.length))
    const totalTwips = Math.floor(this.pkg.contentWidthEmu * TWIPS_PER_EMU)
    const colTwips = Math.floor(totalTwips / columns)
    const style = this.pkg.styles.tableGrid
    const borders = style
      ? ''
      : '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
        .map(side => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`).join('') + '</w:tblBorders>'
    const tblPr = `<w:tblPr>${style ? `<w:tblStyle w:val="${style}"/>` : ''}<w:tblW w:w="${colTwips * columns}" w:type="dxa"/>${borders}</w:tblPr>`
    const grid = `<w:tblGrid>${`<w:gridCol w:w="${colTwips}"/>`.repeat(columns)}</w:tblGrid>`
    const rows = table.rows.map(row => {
      const cells = Array.from({ length: columns }, (_, i) =>
        `<w:tc><w:tcPr><w:tcW w:w="${colTwips}" w:type="dxa"/></w:tcPr>${row.cells[i] ?? '<w:p/>'}</w:tc>`).join('')
      return `<w:tr>${row.header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells}</w:tr>`
    }).join('')
    return `<w:tbl>${tblPr}${grid}${rows}</w:tbl>`
  }

  // ── Texte ─────────────────────────────────────────────────────────────────

  private async runs(children: MdToken[], base: RunMarks): Promise<string> {
    const marks: RunMarks = { ...base }
    // Profondeur d'imbrication (`**a __b__ c**`) : la fermeture intérieure ne doit pas retirer
    // la mise en forme de l'extérieure.
    const depth = { bold: 0, italic: 0, strike: 0 }
    const set = (mark: keyof typeof depth, delta: number) => {
      depth[mark] = Math.max(0, depth[mark] + delta)
      marks[mark] = !!base[mark] || depth[mark] > 0
    }
    let out = ''
    let text = ''
    for (const child of children) {
      // Textes adjacents fusionnés avant écriture : markdown-it coupe `[[SW-0042]]` en plusieurs
      // tokens texte (`[` est un délimiteur), que `stripInternalLinks` doit voir d'un seul bloc.
      if (child.type === 'text') {
        text += child.content
        continue
      }
      if (text) {
        out += run(stripInternalLinks(text), marks, this.pkg)
        text = ''
      }
      switch (child.type) {
        case 'code_inline':
          out += run(child.content, { ...marks, code: true }, this.pkg)
          break
        case 'softbreak':
        case 'hardbreak':
          // Retour à la ligne conservé (même convention que le texte simple, sprint 1) : les
          // énoncés EARS sont souvent écrits sur plusieurs lignes d'un même paragraphe.
          out += '<w:r><w:br/></w:r>'
          break
        case 'strong_open': set('bold', 1); break
        case 'strong_close': set('bold', -1); break
        case 'em_open': set('italic', 1); break
        case 'em_close': set('italic', -1); break
        case 's_open': set('strike', 1); break
        case 's_close': set('strike', -1); break
        case 'image':
          out += await this.imageRun({
            src: child.attrGet('src') ?? '',
            alt: child.content,
            width: null, height: null, crop: null,
          })
          break
        default:
          break // link_open/close : texte du lien seulement (lien hypertexte hors scope v1)
      }
    }
    if (text) out += run(stripInternalLinks(text), marks, this.pkg)
    return out
  }

  private async imageRun(ref: ImageRef): Promise<string> {
    const loaded = ref.src ? await this.converter.image(ref.src) : null
    if (!loaded) return run(`[Image : ${ref.src || ref.alt}]`, { italic: true })
    const { rId, image } = loaded
    const crop = ref.crop && ref.crop.width > 0 && ref.crop.height > 0 ? ref.crop : null

    // Taille affichée (px) : celle choisie dans l'éditeur, sinon la taille naturelle (rognée).
    const baseW = crop ? crop.width * image.width : image.width
    const baseH = crop ? crop.height * image.height : image.height
    const w = ref.width ?? (ref.height ? (ref.height * baseW) / baseH : baseW)
    const h = ref.height ?? (w * baseH) / baseW
    let cx = Math.round(w * EMU_PER_PX)
    let cy = Math.round(h * EMU_PER_PX)
    if (cx > this.pkg.contentWidthEmu) {
      cy = Math.round((cy * this.pkg.contentWidthEmu) / cx)
      cx = this.pkg.contentWidthEmu
    }

    const srcRect = crop
      ? `<a:srcRect l="${pct(crop.x)}" t="${pct(crop.y)}" r="${pct(1 - crop.x - crop.width)}" b="${pct(1 - crop.y - crop.height)}"/>`
      : ''
    // Identifiant provisoire : renuméroté sur tout le document par `DocxPackage.finalize`.
    const id = this.pkg.nextDrawingId()
    return '<w:r><w:drawing>'
      + `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>`
      + `<wp:docPr id="${id}" name="Image ${id}" descr="${escapeXml(ref.alt)}"/>`
      + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
      + `<pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="Image ${id}"/><pic:cNvPicPr/></pic:nvPicPr>`
      + `<pic:blipFill><a:blip r:embed="${rId}"/>${srcRect}<a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
      + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
      + '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
  }
}

/** Texte simple → un paragraphe Word par ligne (vide → rien). */
export function textParagraphs(text: string): string {
  if (!text) return ''
  return text.split('\n').map(line => paragraph([], run(line, {}))).join('')
}

interface RunMarks { bold?: boolean; italic?: boolean; strike?: boolean; code?: boolean }

function paragraph(props: string[], runs: string): string {
  return `<w:p>${props.length ? `<w:pPr>${props.join('')}</w:pPr>` : ''}${runs}</w:p>`
}

function run(text: string, marks: RunMarks, pkg?: DocxPackage): string {
  if (!text) return ''
  // Ordre des éléments imposé par le schéma : rStyle, rFonts, b, i, strike.
  let rPr = ''
  if (marks.code) {
    rPr += pkg?.styles.codeChar
      ? `<w:rStyle w:val="${pkg.styles.codeChar}"/>`
      : '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>'
  }
  if (marks.bold) rPr += '<w:b/>'
  if (marks.italic) rPr += '<w:i/>'
  if (marks.strike) rPr += '<w:strike/>'
  return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
}

/** Fraction → millièmes de pourcent (unité de `a:srcRect`). */
function pct(fraction: number): number {
  return Math.max(0, Math.round(fraction * 100000))
}

// Caractères interdits en XML 1.0 retirés (un caractère de contrôle collé dans un champ rendrait
// le document illisible par Word).
// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g

function escapeXml(text: string): string {
  return text.replace(INVALID_XML, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function parseJson(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content.trim()) as unknown
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/** Bloc ```` ```image ```` (`ResizableImageExtension`) : `{src, alt, width, height, crop}`. */
function parseImageFence(content: string): ImageRef | null {
  const parsed = parseJson(content)
  if (!parsed || typeof parsed.src !== 'string') return null
  const c = parsed.crop as Record<string, unknown> | undefined
  const crop = c && typeof c.x === 'number' && typeof c.y === 'number' && positive(c.width) && positive(c.height)
    ? { x: c.x, y: c.y, width: c.width as number, height: c.height as number }
    : null
  return {
    src: parsed.src,
    alt: typeof parsed.alt === 'string' ? parsed.alt : '',
    width: positive(parsed.width),
    height: positive(parsed.height),
    crop,
  }
}
