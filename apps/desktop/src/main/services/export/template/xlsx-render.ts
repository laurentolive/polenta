import * as fsP from 'fs/promises'
import type PizZipType from 'pizzip'
import { RowMap, rewriteFormula, type FormulaContext } from './xlsx-refs'

// GH34 sprint 4 — remplissage d'un gabarit Excel client : xlsx-template (MIT, travaille sur le XML
// du classeur — logo, graphiques, autres feuilles, mise en page conservés) puis réécriture des
// références (`xlsx-refs.ts`) que xlsx-template laisse sur la seule ligne modèle.
//
// Syntaxe (référence des balises) : `${project.label}` valeur ; ligne modèle `${table:items.id}`
// (une ligne par élément, mise en forme de la ligne recopiée) ; `${columnNames}` une valeur par
// cellule vers la droite.

interface SheetInfo {
  name: string
  file: string // ex. xl/worksheets/sheet1.xml
}

/** Valeurs commençant par `=` : xlsx-template les écrirait comme **formules** (injection de formule
 *  depuis le contenu d'un champ). Préfixées d'un espace insécable de largeur nulle : affichées telles
 *  quelles, jamais évaluées. */
function neutralizeFormulas<T>(value: T): T {
  if (typeof value === 'string') return (value.startsWith('=') ? `​${value}` : value) as T
  if (Array.isArray(value)) return value.map(neutralizeFormulas) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, neutralizeFormulas(v)])) as T
  }
  return value
}

export async function renderXlsxTemplate(templatePath: string, templateName: string, data: object): Promise<Buffer> {
  let content: Buffer
  try {
    content = await fsP.readFile(templatePath)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EBUSY' || code === 'EPERM') {
      throw new Error(`Gabarit « ${templateName} » verrouillé (ouvert dans Excel ?) : fermez-le puis relancez l’export.`)
    }
    throw new Error(`Gabarit « ${templateName} » illisible : ${(err as Error).message}`)
  }

  // Chargés à la demande (T141).
  const [{ default: PizZip }, { default: XlsxTemplate }] = await Promise.all([import('pizzip'), import('xlsx-template')])

  let original: PizZipType
  try {
    original = new PizZip(content)
    if (!original.file('xl/workbook.xml')) throw new Error()
  } catch {
    throw new Error(`Gabarit « ${templateName} » n’est pas un classeur Excel valide (.xlsx).`)
  }

  const safeData = neutralizeFormulas(data)
  const sheets = readSheets(original)
  const { maps, cellLists } = readExpansions(original, sheets, safeData as Record<string, unknown>)

  let output: Buffer
  try {
    // `subsituteAllTableRow` recopie dans chaque ligne générée les cellules sans balise de la ligne
    // modèle (formules, bordures) ; incompatible dans xlsx-template avec une liste de cellules en
    // largeur (`${table:rows.cells}`, cellules en double) — désactivé dans ce seul cas.
    const workbook = new XlsxTemplate(content, { moveImages: true, subsituteAllTableRow: !cellLists } as never)
    // `substituteAll` (toutes les feuilles) existe à l'exécution mais manque aux typings de la lib.
    ;(workbook as unknown as { substituteAll(data: object): void }).substituteAll(safeData)
    output = workbook.generate({ type: 'nodebuffer' }) as unknown as Buffer
  } catch (err) {
    throw new Error(`Gabarit « ${templateName} » : remplissage impossible — ${(err as Error).message}`)
  }

  const zip = new PizZip(output)
  assertNoDuplicateCells(zip, sheets, templateName)
  fixReferences(zip, original, sheets, maps)
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer
}

// ── Lecture du gabarit ───────────────────────────────────────────────────────

function decodeXml(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

function encodeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function readSheets(zip: PizZipType): SheetInfo[] {
  const workbook = zip.file('xl/workbook.xml')?.asText() ?? ''
  const rels = zip.file('xl/_rels/workbook.xml.rels')?.asText() ?? ''
  const targets = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m => [
    /Id="([^"]+)"/.exec(m[0])?.[1] ?? '', /Target="([^"]+)"/.exec(m[0])?.[1] ?? '',
  ]))
  return [...workbook.matchAll(/<sheet\b[^>]*>/g)].map(m => {
    const name = decodeXml(/name="([^"]*)"/.exec(m[0])?.[1] ?? '')
    const target = targets.get(/r:id="([^"]+)"/.exec(m[0])?.[1] ?? '') ?? ''
    const file = target.startsWith('/') ? target.slice(1) : `xl/${target}`
    return { name, file }
  })
}

/**
 * Lignes modèles (`${table:<liste>.…}`) de chaque feuille et nombre de lignes qu'elles donneront ;
 * `cellLists` : une ligne modèle insère une liste de cellules en largeur (`${table:rows.cells}`).
 */
function readExpansions(
  zip: PizZipType,
  sheets: SheetInfo[],
  data: Record<string, unknown>,
): { maps: Map<string, RowMap>; cellLists: boolean } {
  let cellLists = false
  const shared = [...(zip.file('xl/sharedStrings.xml')?.asText() ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => decodeXml([...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(t => t[1]).join('')))
  const maps = new Map<string, RowMap>()
  for (const sheet of sheets) {
    const xml = zip.file(sheet.file)?.asText() ?? ''
    const expansions: { row: number; count: number }[] = []
    // Lignes vides auto-fermantes (`<row r="5" … />`) ignorées : sans elles le contenu de la ligne
    // suivante serait attribué à la précédente.
    for (const row of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      if (row[2] === undefined) continue
      const rowNumber = Number(/\br="(\d+)"/.exec(row[1])?.[1])
      let list: string | null = null
      for (const cell of row[2].matchAll(/<c\b[^>]*\bt="s"[^>]*>\s*<v>(\d+)<\/v>/g)) {
        // xlsx-template n'étend une ligne que si la balise de table occupe **toute** la cellule.
        const m = /^\$\{table:([^{}:.]+)\.([^{}:]+)\}$/.exec(shared[Number(cell[1])] ?? '')
        if (!m) continue
        list = m[1]
        const first = (data[list] as Record<string, unknown>[] | undefined)?.[0]
        if (Array.isArray(first?.[m[2]])) cellLists = true
      }
      if (!list) continue
      const value = data[list]
      // Liste vide : xlsx-template garde la ligne modèle (vidée), elle ne disparaît pas.
      expansions.push({ row: rowNumber, count: Array.isArray(value) ? Math.max(value.length, 1) : 1 })
    }
    if (expansions.length) maps.set(sheet.name, new RowMap(expansions))
  }
  return { maps, cellLists }
}

/** Garde-fou : deux cellules à la même adresse rendraient le classeur illisible par Excel. */
function assertNoDuplicateCells(zip: PizZipType, sheets: SheetInfo[], templateName: string): void {
  for (const sheet of sheets) {
    const refs = [...(zip.file(sheet.file)?.asText() ?? '').matchAll(/<c\b[^>]*\br="([A-Z]+\d+)"/g)].map(m => m[1])
    const dup = refs.find((r, i) => refs.indexOf(r) !== i)
    if (dup) {
      throw new Error(`Gabarit « ${templateName} » : combinaison de balises non prise en charge sur la feuille « ${sheet.name} » (cellule ${dup} produite deux fois). Placez une liste de cellules (\${table:rows.cells}) seule sur sa ligne modèle.`)
    }
  }
}

// ── Réécriture des références ────────────────────────────────────────────────

function fixReferences(zip: PizZipType, original: PizZipType, sheets: SheetInfo[], maps: Map<string, RowMap>): void {
  if ([...maps.values()].every(m => m.isEmpty)) return
  const rewrite = (text: string, ctx: FormulaContext, asArea = false) => encodeXml(rewriteFormula(decodeXml(text), maps, ctx, asArea))
  const rewriteSqref = (sqref: string, sheet: string) => sqref.split(/\s+/).filter(Boolean).map(a => rewrite(a, { sheet }, true)).join(' ')

  for (const sheet of sheets) {
    let xml = zip.file(sheet.file)?.asText()
    if (!xml) continue
    const ctx = { sheet: sheet.name }
    // Formules de cellules (ligne de la cellule : suivi des lignes générées) ; `ref` des formules
    // partagées / matricielles = zone.
    // Cellules vides auto-fermantes (`<c r="C6" s="4"/>`, écrites par xlsx-template) exclues, sans
    // quoi l'expression avalerait la cellule suivante et sa formule.
    xml = xml.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (whole, attrs: string, inner: string | undefined) => {
      if (inner === undefined || !inner.includes('<f')) return whole
      const cellRow = Number(/\br="[A-Z]+(\d+)"/.exec(attrs)?.[1])
      const fixed = inner.replace(/<f\b([^>]*?)(\/?)>(?:([^<]*)<\/f>)?/g, (_f, fAttrs: string, selfClosing: string, text: string | undefined) => {
        const a = fAttrs.replace(/\bref="([^"]*)"/, (_r, ref: string) => `ref="${rewrite(ref, ctx, true)}"`)
        if (selfClosing) return `<f${a}/>`
        return `<f${a}>${rewrite(text ?? '', { ...ctx, cellRow })}</f>`
      })
      return `<c${attrs}>${fixed}</c>`
    })
    xml = xml
      .replace(/(<conditionalFormatting\b[^>]*\bsqref=")([^"]*)(")/g, (_m, a, sq: string, b) => a + rewriteSqref(sq, sheet.name) + b)
      .replace(/(<dataValidation\b[^>]*\bsqref=")([^"]*)(")/g, (_m, a, sq: string, b) => a + rewriteSqref(sq, sheet.name) + b)
      .replace(/(<autoFilter\b[^>]*\bref=")([^"]*)(")/g, (_m, a, ref: string, b) => a + rewrite(ref, ctx, true) + b)
      .replace(/<(formula|formula1|formula2|xm:f)>([^<]*)<\/\1>/g, (_m, tag: string, text: string) => `<${tag}>${rewrite(text, ctx)}</${tag}>`)
      .replace(/<xm:sqref>([^<]*)<\/xm:sqref>/g, (_m, sq: string) => `<xm:sqref>${rewriteSqref(sq, sheet.name)}</xm:sqref>`)
    zip.file(sheet.file, xml)
  }

  // Séries de graphiques (références toujours qualifiées par la feuille).
  for (const name of Object.keys(zip.files).filter(f => /^xl\/charts\/chart\d*\.xml$/.test(f))) {
    const xml = zip.file(name)!.asText()
    zip.file(name, xml.replace(/<c:f>([^<]*)<\/c:f>/g, (_m, text: string) => `<c:f>${rewrite(text, {})}</c:f>`))
  }

  // Noms définis (zones d'impression, plages nommées) : recalculés depuis le gabarit (xlsx-template
  // n'en décale qu'une partie), et recalcul complet à l'ouverture (valeurs en cache périmées).
  let workbook = zip.file('xl/workbook.xml')!.asText()
  const originalNames = /<definedNames>[\s\S]*?<\/definedNames>/.exec(original.file('xl/workbook.xml')?.asText() ?? '')?.[0]
  if (originalNames) {
    const fixedNames = originalNames.replace(/(<definedName\b[^>]*>)([^<]*)(<\/definedName>)/g, (_m, open: string, text: string, close: string) => open + rewrite(text, {}) + close)
    workbook = workbook.replace(/<definedNames>[\s\S]*?<\/definedNames>/, fixedNames)
  }
  if (/<calcPr\b/.test(workbook)) {
    workbook = workbook.replace(/<calcPr\b([^>]*?)(\/?)>/, (_m, attrs: string, sc: string) =>
      `<calcPr${attrs.replace(/\s*fullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"${sc}>`)
  } else {
    workbook = workbook.replace(/(<\/definedNames>|<\/sheets>)(?![\s\S]*<\/definedNames>)/, '$1<calcPr fullCalcOnLoad="1"/>')
  }
  zip.file('xl/workbook.xml', workbook)
}
