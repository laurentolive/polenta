import * as fsP from 'fs/promises'
import { DocxPackage } from './docx-package'

// Filtres autorisés dans les balises (`{{titre | upper}}`) — liste blanche : rien d'autre n'est
// appelable depuis un gabarit (le parseur angular-expressions n'évalue que le scope de données).
const FILTERS: Record<string, (input: unknown, ...args: unknown[]) => unknown> = {
  upper: input => (input == null ? '' : String(input).toUpperCase()),
  lower: input => (input == null ? '' : String(input).toLowerCase()),
  default: (input, fallback) => (input == null || input === '' ? fallback : input),
  join: (input, sep) => (Array.isArray(input) ? input.join(typeof sep === 'string' ? sep : ', ') : input),
  date: (input, format) => formatDate(input, typeof format === 'string' ? format : 'dd/MM/yyyy'),
}

/** `dd`, `MM`, `yyyy`, `yy`, `HH`, `mm` — entrée ISO ou Date ; entrée non datable renvoyée telle quelle. */
function formatDate(input: unknown, format: string): unknown {
  const date = input instanceof Date ? input : typeof input === 'string' ? new Date(input) : null
  if (!date || Number.isNaN(date.getTime())) return input
  const pad = (n: number) => String(n).padStart(2, '0')
  return format.replace(/yyyy|yy|MM|dd|HH|mm/g, token => {
    switch (token) {
      case 'yyyy': return String(date.getFullYear())
      case 'yy': return String(date.getFullYear()).slice(-2)
      case 'MM': return pad(date.getMonth() + 1)
      case 'dd': return pad(date.getDate())
      case 'HH': return pad(date.getHours())
      default: return pad(date.getMinutes())
    }
  })
}

// Explications en français des erreurs de gabarit courantes (identifiant docxtemplater), sinon
// l'explication anglaise de la lib.
const ERROR_LABELS: Record<string, string> = {
  unclosed_loop: 'boucle non fermée',
  unopened_loop: 'fermeture de boucle sans ouverture',
  closing_tag_does_not_match_opening_tag: 'la fermeture ne correspond pas à l’ouverture',
  unclosed_tag: 'balise non fermée (« }} » manquant)',
  unopened_tag: 'balise non ouverte (« {{ » manquant)',
  duplicate_open_tag: 'balise ouverte deux fois',
  duplicate_close_tag: 'balise fermée deux fois',
  raw_xml_tag_should_be_only_text_in_paragraph: 'une balise {{@…}} doit être seule dans son paragraphe',
  raw_tag_outerxml_invalid: 'une balise {{@…}} doit être seule dans son paragraphe (pas dans une boucle sur une seule ligne)',
  scopeparser_compilation_failed: 'expression invalide',
  scopeparser_execution_failed: 'erreur à l’évaluation de l’expression',
  unimplemented_tag_type: 'type de balise non pris en charge',
}

/**
 * Un paragraphe ne contenant qu'une balise de section (`{{#items}}`, `{{/}}`, `{{^x}}`) est supprimé
 * par docxtemplater (`paragraphLoop`) — avec tout ce qu'il porte d'autre. Word place souvent un
 * caractère de champ dans un tel paragraphe (fin du champ de la table des matières, collée au
 * paragraphe suivant) : le supprimer casse le champ. Ces paragraphes — et seulement ceux que
 * docxtemplater supprimerait : aucun texte hors balises de section — sont scindés avant le rendu :
 * les runs avant la première balise et après la dernière vont dans leurs propres paragraphes
 * (mêmes propriétés), la balise reste seule dans le sien. Un paragraphe portant un saut de section
 * ou une numérotation de liste n'est pas scindé (propriétés non duplicables sans effet visible).
 */
export function isolateFieldChars(xml: string): string {
  // Paragraphes vides auto-fermants (`<w:p …/>`) reconnus à part : sinon l'expression engloberait
  // le paragraphe suivant.
  return xml.replace(/<w:p\b([^>]*?)(?:\/>|>((?:(?!<\/w:p>)[\s\S])*)<\/w:p>)/g, (whole, attrs: string, body: string | undefined) => {
    if (body === undefined || !body.includes('<w:fldChar')) return whole
    const text = [...body.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map(t => t[1]).join('')
    const sectionTags = /\{\{\s*[#^/][^{}]*\}\}/g
    if (!sectionTags.test(text) || text.replace(sectionTags, '').trim() !== '') return whole
    const pPr = /^\s*<w:pPr\b[\s\S]*?<\/w:pPr>/.exec(body)?.[0] ?? ''
    if (/<w:(?:sectPr|numPr)\b/.test(pPr)) return whole
    const runs = [...body.slice(pPr.length).matchAll(/<w:r\b[^>]*>[\s\S]*?<\/w:r>|<w:r\b[^>]*\/>|<[^>]+\/>|<w:(?:bookmarkStart|bookmarkEnd|proofErr)\b[^>]*>/g)]
      .map(m => m[0])
    if (runs.join('').length !== body.slice(pPr.length).replace(/\s+$/, '').length) return whole // structure inattendue : intact
    const runText = (r: string) => [...r.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map(t => t[1]).join('')
    const first = runs.findIndex(r => runText(r).includes('{{'))
    let last = -1
    runs.forEach((r, i) => { if (runText(r).includes('}}')) last = i })
    if (first < 0 || last < first) return whole
    const part = (rs: string[]) => (rs.length ? `<w:p${attrs}>${pPr}${rs.join('')}</w:p>` : '')
    return part(runs.slice(0, first)) + part(runs.slice(first, last + 1)) + part(runs.slice(last + 1))
  })
}

interface DocxtemplaterErrorDetail {
  properties?: { explanation?: string; xtag?: string; id?: string }
  message?: string
}

/**
 * GH34 — message lisible à partir d'une erreur docxtemplater (`TemplateError`/`MultiError`) :
 * gabarit, balise fautive et explication, au plus 3 erreurs détaillées.
 */
export function describeTemplateError(templateName: string, err: unknown): string {
  const e = err as { properties?: { errors?: DocxtemplaterErrorDetail[] } & DocxtemplaterErrorDetail['properties']; message?: string }
  const details: DocxtemplaterErrorDetail[] = e?.properties?.errors?.length
    ? e.properties.errors
    : [err as DocxtemplaterErrorDetail]
  const parts = details.slice(0, 3).map(d => {
    const id = d.properties?.id
    const explanation = (id && ERROR_LABELS[id]) ?? d.properties?.explanation ?? d.message ?? 'erreur inconnue'
    const tag = d.properties?.xtag
    return tag ? `balise « {{${tag}}} » : ${explanation}` : explanation
  })
  const more = details.length > 3 ? ` (+${details.length - 3} autres erreurs)` : ''
  return `Gabarit « ${templateName} » invalide — ${parts.join(' ; ')}${more}`
}

/**
 * GH34 — remplit un gabarit Word client avec les données produites par `prepare` et renvoie le
 * document produit. Aucun fichier
 * n'est écrit ici : l'appelant n'écrit la destination qu'une fois le buffer entièrement généré,
 * pour ne jamais laisser de fichier partiel (ni écraser un fichier existant) en cas d'erreur.
 */
export async function renderDocxTemplate(
  templatePath: string,
  templateName: string,
  prepare: (pkg: DocxPackage) => Promise<object>,
): Promise<Buffer> {
  let content: Buffer
  try {
    content = await fsP.readFile(templatePath)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EBUSY' || code === 'EPERM') {
      throw new Error(`Gabarit « ${templateName} » verrouillé (ouvert dans Word ?) : fermez-le puis relancez l’export.`)
    }
    throw new Error(`Gabarit « ${templateName} » illisible : ${(err as Error).message}`)
  }

  // Chargés à la demande, comme les générateurs du rendu Standard (T141) : rien au démarrage.
  const [{ default: PizZip }, { default: Docxtemplater }, { default: expressionParser }] = await Promise.all([
    import('pizzip'),
    import('docxtemplater'),
    import('docxtemplater/expressions.js'),
  ])

  let zip: InstanceType<typeof PizZip>
  try {
    zip = new PizZip(content)
  } catch {
    throw new Error(`Gabarit « ${templateName} » n’est pas un document Word valide (.docx).`)
  }

  const documentXml = zip.file('word/document.xml')?.asText()
  if (documentXml) zip.file('word/document.xml', isolateFieldChars(documentXml))

  // Données construites sur le paquet du gabarit : le contenu riche y alloue ses images,
  // numérotations et styles avant le rendu.
  const pkg = new DocxPackage(zip)
  const data = await prepare(pkg)

  try {
    const doc = new Docxtemplater(zip, {
      delimiters: { start: '{{', end: '}}' },
      paragraphLoop: true,
      linebreaks: true,
      parser: expressionParser.configure({ filters: FILTERS }),
      // Donnée absente (champ renommé, colonne masquée) → vide, pas d'erreur (spec §2.7).
      nullGetter: () => '',
      // Erreurs rapportées à l'utilisateur via `describeTemplateError`, pas dans la console.
      errorLogging: false,
    })
    doc.render(data)
    pkg.finalize(doc.getZip())
    return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer
  } catch (err) {
    throw new Error(describeTemplateError(templateName, err))
  }
}
