import * as fsP from 'fs/promises'

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
  scopeparser_compilation_failed: 'expression invalide',
  scopeparser_execution_failed: 'erreur à l’évaluation de l’expression',
  unimplemented_tag_type: 'type de balise non pris en charge',
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
 * GH34 — remplit un gabarit Word client avec `data` et renvoie le document produit. Aucun fichier
 * n'est écrit ici : l'appelant n'écrit la destination qu'une fois le buffer entièrement généré,
 * pour ne jamais laisser de fichier partiel (ni écraser un fichier existant) en cas d'erreur.
 */
export async function renderDocxTemplate(templatePath: string, templateName: string, data: object): Promise<Buffer> {
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
    return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer
  } catch (err) {
    throw new Error(describeTemplateError(templateName, err))
  }
}
