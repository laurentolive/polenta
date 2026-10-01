/**
 * GH34 — vérifications automatiques de l'export à partir d'un gabarit client (specs/GH34-tests.md,
 * scénarios marqués [auto]). Génère ses propres gabarits fixtures avec la lib `docx` (balises
 * `{{…}}` dans un seul run, comme dans un gabarit saisi d'un trait dans Word), les remplit via les
 * vrais services (bibliothèque, données, moteur docxtemplater), relit le document produit et
 * vérifie son texte.
 *
 * Lancement : `pnpm --filter @polenta/desktop exec tsx scripts/check-gh34.ts`
 */
import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx'
import PizZip from 'pizzip'
import type { RequirementsExportPayload, TestsExportPayload } from '@polenta/types'
import { ExportTemplateLibrary } from '../src/main/services/export-template-library'
import { TemplateExportService } from '../src/main/services/export/template/template-export.service'
import type { AppSettingsService } from '../src/main/services/app-settings.service'
import type { GitService } from '../src/main/services/git.service'
import type { SchemaService } from '../src/main/services/schema.service'
import type { AuthService } from '../src/main/services/auth.service'

let failures = 0
let passes = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passes++
  else failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n      ${detail}` : ''}`)
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const p = (text: string) => new Paragraph({ children: [new TextRun(text)] })
const cell = (text: string) => new TableCell({ children: [p(text)] })

async function writeDocx(file: string, children: (Paragraph | Table)[]): Promise<void> {
  await fsP.mkdir(path.dirname(file), { recursive: true })
  await fsP.writeFile(file, await Packer.toBuffer(new Document({ sections: [{ children }] })))
}

/** Texte de chaque paragraphe du corps (`w:br` → `\n`), entités décodées. */
function paragraphsOf(buffer: Buffer): string[] {
  const xml = new PizZip(buffer).file('word/document.xml')!.asText()
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(m =>
    [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>|<w:br\/>/g)]
      .map(t => (t[0] === '<w:br/>' ? '\n' : t[1]))
      .join('')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'),
  )
}

const RICH = [
  '# Titre',
  'Texte **gras** et *italique*, voir [[SW-0042]].',
  '',
  '- puce 1',
  '  - puce imbriquée',
  '- [ ] à faire',
  '- [x] fait',
  '',
  '1. un',
  '2. deux',
  '',
  '| A | B |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  '```image',
  '{"src":"images/x.png"}',
  '```',
].join('\n')

const reqPayload: RequirementsExportPayload = {
  componentLabel: 'Moteur',
  columns: [
    { key: 'section', label: 'Section' },
    { key: 'id', label: 'ID' },
    { key: 'name', label: 'Label' },
    { key: 'status', label: 'Statut' },
    { key: 'statement', label: 'Énoncé', type: 'richtext' },
    { key: 'note', label: 'Note', type: 'text' },
  ],
  rows: [],
  outline: [
    { kind: 'folder', level: 1, section: '1', name: 'Sécurité', values: {} },
    {
      kind: 'item', level: 2, section: '1.1', name: 'Surcharge',
      values: { section: '1.1', id: 'SYS-0001', name: 'Surcharge', status: 'approved', statement: RICH, note: 'a < b & "c"\nligne 2 🙂' },
    },
    { kind: 'folder', level: 2, section: '1.2', name: 'Thermique', values: {} },
    {
      kind: 'item', level: 3, section: '1.2.1', name: 'Température', values: { section: '1.2.1', id: 'SYS-0002', name: 'Température', status: 'draft', statement: 'WHEN x THE system SHALL y', note: '' },
    },
  ],
}

const testsPayload: TestsExportPayload = {
  componentLabel: 'Moteur',
  columns: [{ key: 'id', label: 'ID' }, { key: 'name', label: 'Label' }],
  rows: [],
  outline: [{
    kind: 'item', level: 1, section: '1', name: 'Test démarrage', values: { id: 'TEST-0001', name: 'Test démarrage' },
    steps: [
      { order: 1, action: 'Appuyer sur **ON**', expectedResult: 'LED verte', notes: '' },
      { order: 2, action: 'Attendre 500 ms', expectedResult: 'Mode Eco', notes: 'à 25 °C' },
    ],
  }],
}

// ── Mise en place ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const tmp = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh34-'))
  const lib = path.join(tmp, 'lib')
  const out = path.join(tmp, 'out')
  await fsP.mkdir(out, { recursive: true })

  await writeDocx(path.join(lib, 'ACME', 'cahier.docx'), [
    p('{{project.label}} | {{project.component}} | {{git.branch}} | {{git.commit}} | {{git.tag}} | {{export.user}} | {{count}}'),
    p('date={{export.iso | date:"yyyy-MM-dd"}} kind={{export.kind}} tpl={{export.templateName}}'),
    p('Accolades simples {nom} conservées'),
    p('{{#items}}'),
    p('{{#isFolder}}DOSSIER {{section}} {{name}} niveau {{level}}{{/isFolder}}{{#isItem}}ITEM {{id}} — {{name}}{{/isItem}}'),
    p('{{#isItem}}{{statement}}{{/isItem}}'),
    p('{{#isItem}}NOTE {{note}}{{/isItem}}'),
    p('{{#status == "approved"}}APPROUVÉE {{id | upper}}{{/}}'),
    p('{{/items}}'),
    p('absent=[{{champInexistant}}]'),
    new Table({ rows: [
      new TableRow({ children: [cell('ID'), cell('Statut')] }),
      new TableRow({ children: [cell('{{#items}}{{#isItem}}{{id}}'), cell('{{status}}{{/isItem}}{{/items}}')] }),
    ] }),
  ])
  await writeDocx(path.join(lib, 'ACME', 'sub', 'tests.docx'), [
    p('{{#items}}{{id}} {{name}}'),
    p('{{#steps}}ÉTAPE {{order}} : {{action}} → {{expectedResult}} [{{notes}}]{{/steps}}'),
    p('{{/items}}'),
  ])
  await writeDocx(path.join(lib, 'ACME', 'casse.docx'), [p('{{#items}} jamais fermé')])
  await writeDocx(path.join(lib, 'ACME', 'injection.docx'), [
    p('A[{{constructor.constructor("return process")()}}]'),
    p('B[{{items.constructor}}]'),
  ])
  await writeDocx(path.join(lib, '.cache', 'cache.docx'), [p('x')])
  await writeDocx(path.join(lib, 'ACME', '~$cahier.docx'), [p('x')])
  await fsP.writeFile(path.join(lib, 'ACME', 'corrompu.docx'), 'pas un zip')
  await fsP.writeFile(path.join(lib, 'Globex.xlsx'), 'x')
  await fsP.writeFile(path.join(tmp, 'secret.docx'), 'x')

  let dir: string | undefined = lib
  const appSettings = { get: () => ({ autoCheckUpdates: false, exportTemplatesDir: dir }) } as unknown as AppSettingsService
  const library = new ExportTemplateLibrary(appSettings)
  const git = {
    currentBranch: async () => 'main',
    headSha: async () => '0123456789abcdef',
    tagsAtHead: async () => ['v1.2.0'],
  } as unknown as GitService
  const schema = { get: async () => ({ nodes: [{ name: 'root', label: 'Aspirateur V1' }] }) } as unknown as SchemaService
  const auth = { projectUsername: async () => 'lolive' } as unknown as AuthService
  const service = new TemplateExportService(library, git, schema, auth)

  // ── S1.2 — liste de la bibliothèque ───────────────────────────────────────
  const listed = await library.list('docx')
  check('S1.2 liste docx (sous-dossiers, ~$ et cachés exclus)',
    JSON.stringify(listed.templates.map(t => t.relPath)) ===
      JSON.stringify(['ACME/cahier.docx', 'ACME/casse.docx', 'ACME/corrompu.docx', 'ACME/injection.docx', 'ACME/sub/tests.docx']),
    JSON.stringify(listed))
  check('S1.2 liste xlsx', (await library.list('xlsx')).templates.map(t => t.relPath).join() === 'Globex.xlsx')

  // ── Export exigences ──────────────────────────────────────────────────────
  const reqOut = path.join(out, 'req.docx')
  await service.run('requirements', 'docx', reqPayload, tmp, 'ACME/cahier.docx', reqOut)
  const paras = paragraphsOf(await fsP.readFile(reqOut))
  const text = paras.join('\n')

  check('S1.5 données communes', paras[0] === 'Aspirateur V1 | Moteur | main | 0123456' + ' | v1.2.0 | lolive | 2', paras[0])
  check('S1.5 filtre date + kind + gabarit', /^date=\d{4}-\d{2}-\d{2} kind=requirements tpl=ACME\/cahier\.docx$/.test(paras[1]), paras[1])
  check('S1.22 accolades simples conservées', paras.includes('Accolades simples {nom} conservées'))
  check('S1.7 dossiers dans l\'ordre de l\'arbre avec niveau',
    text.indexOf('DOSSIER 1 Sécurité niveau 1') < text.indexOf('ITEM SYS-0001') &&
    text.indexOf('ITEM SYS-0001') < text.indexOf('DOSSIER 1.2 Thermique niveau 2') &&
    text.indexOf('DOSSIER 1.2 Thermique niveau 2') < text.indexOf('ITEM SYS-0002'), text)
  check('S1.11 richtext en texte simple (Markdown retiré)',
    text.includes('Titre\nTexte gras et italique, voir SW-0042.\n• puce 1\n  • puce imbriquée\n☐ à faire\n☒ fait\n1. un\n2. deux\nA\tB\n1\t2'),
    text)
  check('S1.11 image omise du texte simple', !text.includes('images/x.png'))
  check('S1.23 caractères spéciaux et retour à la ligne', text.includes('NOTE a < b & "c"\nligne 2 🙂'), text)
  check('S1.12 expression + filtre', text.includes('APPROUVÉE SYS-0001') && !text.includes('APPROUVÉE SYS-0002'))
  check('S1.17 balise inexistante → vide', paras.includes('absent=[]'))
  check('S1.6 boucle de ligne de tableau', text.includes('SYS-0001\napproved') || (paras.includes('SYS-0001') && paras.includes('approved') && paras.includes('SYS-0002') && paras.includes('draft')), JSON.stringify(paras.slice(-8)))

  // ── S1.8 — étapes de test ─────────────────────────────────────────────────
  const testsOut = path.join(out, 'tests.docx')
  await service.run('tests', 'docx', testsPayload, tmp, 'ACME/sub/tests.docx', testsOut)
  const tText = paragraphsOf(await fsP.readFile(testsOut)).join('\n')
  check('S1.8 étapes détaillées dans l\'ordre',
    tText.includes('ÉTAPE 1 : Appuyer sur ON → LED verte []') && tText.indexOf('ÉTAPE 1') < tText.indexOf('ÉTAPE 2 : Attendre 500 ms → Mode Eco [à 25 °C]'),
    tText)

  // ── S1.16 — liste vide ────────────────────────────────────────────────────
  const emptyOut = path.join(out, 'empty.docx')
  await service.run('requirements', 'docx', { ...reqPayload, outline: [] }, tmp, 'ACME/cahier.docx', emptyOut)
  check('S1.16 liste vide → document, count = 0', paragraphsOf(await fsP.readFile(emptyOut))[0].endsWith('| 0'))

  // ── Erreurs ───────────────────────────────────────────────────────────────
  const expectError = async (name: string, relPath: string, pattern: RegExp, dest: string) => {
    try {
      await service.run('requirements', 'docx', reqPayload, tmp, relPath, dest)
      check(name, false, 'aucune erreur levée')
    } catch (err) {
      check(name, pattern.test((err as Error).message), (err as Error).message)
    }
  }
  const existing = path.join(out, 'existant.docx')
  await fsP.writeFile(existing, 'ORIGINAL')
  await expectError('S1.18 gabarit invalide → message gabarit + balise', 'ACME/casse.docx', /ACME\/casse\.docx.*items/, existing)
  check('S1.18 destination existante non écrasée', fs.readFileSync(existing, 'utf-8') === 'ORIGINAL')
  const noFile = path.join(out, 'jamais.docx')
  await expectError('S1.19 fichier corrompu → message', 'ACME/corrompu.docx', /n’est pas un document Word valide/, noFile)
  check('S1.18/S1.19 aucun fichier écrit', !fs.existsSync(noFile))
  await expectError('S1.20 chemin hors bibliothèque refusé', '../secret.docx', /hors de la bibliothèque/, noFile)
  await expectError('S1.14 gabarit absent', 'ACME/renomme.docx', /introuvable/, noFile)

  // ── S1.21 — pas d'exécution de code ───────────────────────────────────────
  try {
    const injOut = path.join(out, 'inj.docx')
    await service.run('requirements', 'docx', reqPayload, tmp, 'ACME/injection.docx', injOut)
    const inj = paragraphsOf(await fsP.readFile(injOut)).join('\n')
    check('S1.21 aucune exécution de code', !/process|function|\[object/i.test(inj), inj)
  } catch (err) {
    check('S1.21 aucune exécution de code (refus par le gabarit)', /invalide/.test((err as Error).message), (err as Error).message)
  }

  await sprint2(service, lib, tmp, out)

  // ── S1.13 / S1.15 — bibliothèque non configurée / absente ─────────────────
  dir = undefined
  const none = await library.list('docx')
  check('S1.13 bibliothèque non configurée', !none.dirConfigured && none.templates.length === 0)
  dir = path.join(tmp, 'supprime')
  const gone = await library.list('docx')
  check('S1.15 bibliothèque introuvable', gone.dirConfigured && !gone.dirExists)

  // `--keep` : conserve les documents produits (ouverture manuelle dans Word, « sans réparation »).
  if (process.argv.includes('--keep')) console.log(`\nDocuments conservés dans ${out}`)
  else await fsP.rm(tmp, { recursive: true, force: true })
  console.log(`\n${passes} PASS, ${failures} FAIL`)
  process.exit(failures ? 1 : 0)
}

// ── Sprint 2 — richtext mis en forme ────────────────────────────────────────

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const GIF_1X1 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

/** Bien-formé : chaque balise ouvrante a sa fermante, dans l'ordre. */
function wellFormed(xml: string): string | null {
  const stack: string[] = []
  for (const m of xml.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)[^>]*?(\/?)>/g)) {
    if (m[0].startsWith('<?')) continue
    const [, closing, name, selfClosing] = m
    if (selfClosing) continue
    if (!closing) stack.push(name)
    else if (stack.pop() !== name) return `fermeture </${name}> inattendue`
  }
  return stack.length ? `non fermé : ${stack.join(' > ')}` : null
}

/** Cohérence du paquet : XML bien formé, relations/médias/content types/numérotations présents. */
function packageProblems(buffer: Buffer): string[] {
  const zip = new PizZip(buffer)
  const problems: string[] = []
  const doc = zip.file('word/document.xml')!.asText()
  const rels = zip.file('word/_rels/document.xml.rels')!.asText()
  const types = zip.file('[Content_Types].xml')!.asText()
  const numbering = zip.file('word/numbering.xml')?.asText() ?? ''
  for (const [name, xml] of [['document.xml', doc], ['rels', rels], ['types', types], ['numbering.xml', numbering]] as const) {
    const err = xml ? wellFormed(xml) : null
    if (err) problems.push(`${name} : ${err}`)
  }
  for (const [, rId] of doc.matchAll(/r:embed="([^"]+)"/g)) {
    const target = new RegExp(`Id="${rId}"[^>]*Target="([^"]+)"`).exec(rels)?.[1]
    if (!target) problems.push(`relation ${rId} absente`)
    else if (!zip.file(`word/${target}`)) problems.push(`média ${target} absent`)
    else if (!new RegExp(`Extension="${target.split('.').pop()}"`, 'i').test(types)) problems.push(`content type ${target} absent`)
  }
  for (const [, numId] of doc.matchAll(/<w:numId w:val="(\d+)"/g)) {
    if (!numbering.includes(`<w:num w:numId="${numId}"`)) problems.push(`numId ${numId} non défini`)
  }
  const firstNum = numbering.search(/<w:num[\s>]/)
  if (firstNum >= 0 && numbering.lastIndexOf('<w:abstractNum ') > firstNum) problems.push('abstractNum après num')
  if (numbering && !rels.includes('numbering.xml')) problems.push('relation numbering absente')
  for (const cell of doc.matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)) {
    // Approximation suffisante ici (pas de tableau imbriqué dans une cellule imbriquée).
    if (!/<w:p[ />][\s\S]*$/.test(cell[1]) || /<\/w:tbl>\s*$/.test(cell[1])) problems.push('cellule sans paragraphe final')
  }
  const ids = [...doc.matchAll(/<wp:docPr id="(\d+)"/g)].map(m => m[1])
  if (new Set(ids).size !== ids.length) problems.push('wp:docPr id dupliqué')
  return problems
}

async function sprint2(service: TemplateExportService, lib: string, repo: string, out: string): Promise<void> {
  await fsP.mkdir(path.join(repo, 'images'), { recursive: true })
  await fsP.writeFile(path.join(repo, 'images', 'x.png'), Buffer.from(PNG_1X1, 'base64'))
  await fsP.writeFile(path.join(repo, 'images', 'g.gif'), Buffer.from(GIF_1X1, 'base64'))

  const full = [
    '# Titre 1',
    '## Titre 2',
    'Texte **gras** *italique* ~~barré~~ `code` [[SW-0042]] [lien](https://x.y).',
    '',
    '**gras _in_ out**',
    '',
    '- puce',
    '  - imbriquée',
    '    1. numéro imbriqué',
    '- [ ] à faire',
    '- [x] fait',
    '',
    '1. un',
    '2. deux',
    '',
    'Paragraphe entre deux listes.',
    '',
    '1. un bis',
    '',
    '| A | B |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    '> citation',
    '',
    '```image',
    '{"src":"images/x.png","width":5000}',
    '```',
    '',
    '```image',
    '{"src":"images/x.png","crop":{"x":0.1,"y":0.2,"width":0.5,"height":0.25}}',
    '```',
    '',
    '![gif](images/g.gif)',
    '',
    '![absente](images/absente.png)',
    '',
    '```drawio',
    '{"path":"diagrams/a.drawio","nodeId":"n1"}',
    '```',
    '',
    'ligne A',
    'ligne B',
  ].join('\n')

  const payload: RequirementsExportPayload = {
    componentLabel: 'C',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'statement', label: 'Énoncé', type: 'richtext' },
      { key: 'empty', label: 'Vide', type: 'richtext' },
      { key: 'tableOnly', label: 'Tableau', type: 'richtext' },
    ],
    rows: [],
    outline: [
      { kind: 'item', level: 1, section: '1', name: 'A', values: { id: 'SYS-1', statement: full, empty: '', tableOnly: '| x |\n|---|\n| y |' } },
      { kind: 'item', level: 1, section: '2', name: 'B', values: { id: 'SYS-2', statement: '1. autre liste\n2. suite', empty: '', tableOnly: '' } },
    ],
  }

  // Gabarit : riche dans le corps + dans des cellules de tableau, champ vide entre deux marqueurs.
  const tplPath = path.join(lib, 'S2', 'riche.docx')
  await writeDocx(tplPath, [
    p('{{#items}}'),
    p('DEBUT {{id}}'),
    p('{{@rich.statement}}'),
    p('{{@rich.empty}}'),
    p('FIN {{id}}'),
    new Table({ rows: [new TableRow({ children: [cell('{{@rich.tableOnly}}'), cell('{{@rich.empty}}')] })] }),
    p('{{#columns}}'),
    p('{{label}}'),
    p('{{@rich}}'),
    p('{{/columns}}'),
    p('{{/items}}'),
  ])

  const run = async (relPath: string, name: string, data: RequirementsExportPayload = payload) => {
    const dest = path.join(out, name)
    await service.run('requirements', 'docx', data, repo, relPath, dest)
    return fsP.readFile(dest)
  }

  // ── S2.1 / S2.3 — rendu complet, gabarit sans Table Grid ni Quote ─────────
  const buf = await run('S2/riche.docx', 's2-riche.docx')
  const doc = new PizZip(buf).file('word/document.xml')!.asText()
  const problems = packageProblems(buf)
  check('S2.1 paquet cohérent (XML, relations, médias, numérotation, cellules)', problems.length === 0, problems.join(' ; '))
  check('S2.1 titres au style du gabarit', doc.includes('<w:pStyle w:val="Heading1"/>') && doc.includes('<w:pStyle w:val="Heading2"/>'))
  check('S2.1 gras / italique / barré / code',
    /<w:b\/><\/w:rPr><w:t xml:space="preserve">gras/.test(doc) && /<w:i\/><\/w:rPr><w:t xml:space="preserve">italique/.test(doc)
    && /<w:strike\/><\/w:rPr><w:t xml:space="preserve">barré/.test(doc) && /Consolas[^>]*\/><\/w:rPr><w:t xml:space="preserve">code/.test(doc))
  check('S2.11 [[ID]] et lien → texte', doc.includes(' SW-0042 ') && doc.includes('>lien<') && !doc.includes('[['))
  check('S2.1 listes : puces, imbrication, liste numérotée imbriquée',
    /<w:ilvl w:val="0"\/>[\s\S]*?puce/.test(doc) && /<w:ilvl w:val="1"\/>[\s\S]*?imbriquée/.test(doc) && /<w:ilvl w:val="2"\/>[\s\S]*?numéro imbriqué/.test(doc))
  check('S2.1 cases à cocher', doc.includes('>☐ <') && doc.includes('>☒ <'))
  check('S2.1 style List Paragraph', doc.includes('<w:pStyle w:val="ListParagraph"/>'))
  check('S2.1 tableau avec en-tête', doc.includes('<w:tblHeader/>') && /<w:tblHeader\/>[\s\S]*?<w:b\/>[\s\S]*?>A</.test(doc))
  check('S2.3 tableau sans Table Grid → bordures', doc.includes('<w:tblBorders>') && !doc.includes('<w:tblStyle'))
  check('S2.3 citation sans style Quote → retrait', /<w:ind w:left="720"\/><\/w:pPr><w:r><w:rPr><w:i\/>/.test(doc))
  check('S2.1 images embarquées (png fence, png crop, gif inline)', (doc.match(/<w:drawing>/g) ?? []).length >= 3 * 2) // ×2 : statement + boucle columns
  check('S2.6 image plus large que la page ramenée à la largeur utile',
    [...doc.matchAll(/<wp:extent cx="(\d+)"/g)].every(m => Number(m[1]) <= (11906 - 2 * 1440) * 635))
  check('S2.1 rognage (fractions) → srcRect', doc.includes('<a:srcRect l="10000" t="20000" r="40000" b="55000"/>'))
  check('S2.1 gras imbriqué conservé après fermeture intérieure', /<w:b\/><w:i\/><\/w:rPr><w:t xml:space="preserve">in<[\s\S]*?<w:b\/><\/w:rPr><w:t xml:space="preserve"> out</.test(doc))
  check('S2.7 image introuvable → repli', doc.includes('[Image : images/absente.png]'))
  check('S2.8 même image : un seul média', Object.keys(new PizZip(buf).files).filter(f => f.startsWith('word/media/')).length === 2)
  check('draw.io → repli explicite (sprint 3)', doc.includes('[Diagramme : diagrams/a.drawio#n1]'))
  check('retours à la ligne conservés', /ligne A<\/w:t><\/w:r><w:r><w:br\/><\/w:r><w:r><w:t xml:space="preserve">ligne B/.test(doc))
  const paras = paragraphsOf(buf)
  check('S2.10 champ vide : aucun paragraphe parasite',
    paras.indexOf('FIN SYS-2') - paras.lastIndexOf('autre listesuite') <= 2 || paras.indexOf('FIN SYS-2') - paras.indexOf('suite') === 1,
    JSON.stringify(paras.slice(paras.indexOf('DEBUT SYS-2'), paras.indexOf('FIN SYS-2') + 1)))

  // ── S2.4 — chaque liste numérotée repart à 1 ──────────────────────────────
  const numbering = new PizZip(buf).file('word/numbering.xml')!.asText()
  // numId de chaque paragraphe contenant `text` (toutes les occurrences, dans l'ordre).
  const numIdsOf = (text: string) => [...doc.matchAll(/<w:p>((?:(?!<\/w:p>)[\s\S])*)<\/w:p>/g)]
    .filter(m => m[1].includes(`>${text}<`))
    .map(m => /<w:numId w:val="(\d+)"/.exec(m[1])?.[1])
  const ids = ['un', 'un bis', 'autre liste'].map(t => numIdsOf(t)[0])
  check('S2.4 listes numérotées distinctes', ids.every(Boolean) && new Set(ids).size === 3, JSON.stringify(ids))
  const twice = numIdsOf('un')
  check('S2.4 même champ inséré deux fois : listes indépendantes', twice.length >= 2 && twice[0] !== twice[1], JSON.stringify(twice))
  check('S2.4 redémarrage à 1', [...ids, ...twice].every(id => new RegExp(`<w:num w:numId="${id}">(?:(?!</w:num>)[\\s\\S])*<w:startOverride w:val="1"/>`).test(numbering)))

  // ── S2.2 — gabarit « français » (styleId Titre1) ; S2.5 — sans numbering.xml ; Table Grid
  const zip = new PizZip(await fsP.readFile(tplPath))
  const styles = zip.file('word/styles.xml')!.asText()
    .replace(/w:styleId="Heading1"/, 'w:styleId="Titre1"')
    .replace('</w:styles>', '<w:style w:type="table" w:styleId="Grilledutableau"><w:name w:val="Table Grid"/></w:style></w:styles>')
  zip.file('word/styles.xml', styles)
  zip.remove('word/numbering.xml')
  zip.file('word/_rels/document.xml.rels', zip.file('word/_rels/document.xml.rels')!.asText().replace(/<Relationship [^>]*numbering\.xml"\/>/, ''))
  zip.file('[Content_Types].xml', zip.file('[Content_Types].xml')!.asText().replace(/<Override PartName="\/word\/numbering\.xml"[^>]*\/>/, ''))
  await fsP.writeFile(path.join(lib, 'S2', 'fr.docx'), zip.generate({ type: 'nodebuffer' }))
  const frBuf = await run('S2/fr.docx', 's2-fr.docx')
  const frDoc = new PizZip(frBuf).file('word/document.xml')!.asText()
  check('S2.2 styleId localisé (Titre1) résolu par nom', frDoc.includes('<w:pStyle w:val="Titre1"/>'))
  check('S2.2 style de tableau Table Grid utilisé', frDoc.includes('<w:tblStyle w:val="Grilledutableau"/>'))
  const frProblems = packageProblems(frBuf)
  check('S2.5 gabarit sans numbering.xml : partie créée, paquet cohérent', !!new PizZip(frBuf).file('word/numbering.xml') && frProblems.length === 0, frProblems.join(' ; '))

  // ── Gabarit sans {{@…}} : pas de conversion ni d'image embarquée ─────────
  await writeDocx(path.join(lib, 'S2', 'simple.docx'), [p('{{#items}}{{id}} {{statement}}{{/items}}')])
  const simple = new PizZip(await run('S2/simple.docx', 's2-simple.docx'))
  check('gabarit sans {{@…}} : aucun média ni numérotation ajoutés',
    !Object.keys(simple.files).some(f => f.startsWith('word/media/'))
    && simple.file('word/numbering.xml')?.asText() === new PizZip(await fsP.readFile(path.join(lib, 'S2', 'simple.docx'))).file('word/numbering.xml')?.asText())

  // ── Numérotation Word pour Mac (numIdMacAtCleanup en fin de partie) ───────
  const mac = new PizZip(await fsP.readFile(tplPath))
  mac.file('word/numbering.xml', mac.file('word/numbering.xml')!.asText().replace('</w:numbering>', '<w:numIdMacAtCleanup w:val="0"/></w:numbering>'))
  await fsP.writeFile(path.join(lib, 'S2', 'mac.docx'), mac.generate({ type: 'nodebuffer' }))
  const macNum = new PizZip(await run('S2/mac.docx', 's2-mac.docx')).file('word/numbering.xml')!.asText()
  check('numIdMacAtCleanup reste après les w:num ajoutés', macNum.lastIndexOf('<w:num ') < macNum.indexOf('<w:numIdMacAtCleanup'))

  // ── S2.9 — balise brute au milieu d'un paragraphe ─────────────────────────
  await writeDocx(path.join(lib, 'S2', 'brut.docx'), [p('{{#items}}'), p('Énoncé : {{@rich.statement}}'), p('{{/items}}')])
  try {
    await run('S2/brut.docx', 's2-brut.docx')
    check('S2.9 balise brute non seule → erreur', false, 'aucune erreur')
  } catch (err) {
    check('S2.9 balise brute non seule → erreur explicite', /seule dans son paragraphe/.test((err as Error).message), (err as Error).message)
  }

  // ── S2.12 — volume ────────────────────────────────────────────────────────
  const many: RequirementsExportPayload = {
    ...payload,
    outline: Array.from({ length: 500 }, (_, i) => ({
      kind: 'item' as const, level: 1, section: String(i + 1), name: `R${i}`,
      values: { id: `SYS-${i}`, statement: full, empty: '', tableOnly: '' },
    })),
  }
  const t0 = Date.now()
  const bigBuf = await run('S2/riche.docx', 's2-500.docx', many)
  const elapsed = Date.now() - t0
  check(`S2.12 500 exigences en < 15 s (${elapsed} ms)`, elapsed < 15000)
  const bigProblems = packageProblems(bigBuf)
  check('S2.12 paquet cohérent à 500 exigences', bigProblems.length === 0, bigProblems.slice(0, 3).join(' ; '))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
