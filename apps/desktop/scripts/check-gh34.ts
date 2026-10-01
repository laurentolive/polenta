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
import type {
  CampaignExportPayload, DashboardExportPayload, ImpactAnalysisExportPayload, QueryResultExportPayload,
  RequirementsExportPayload, TestCase, TestRun, TestsExportPayload,
} from '@polenta/types'
import { ExportTemplateLibrary } from '../src/main/services/export-template-library'
import { TemplateExportService } from '../src/main/services/export/template/template-export.service'
import type { AppSettingsService } from '../src/main/services/app-settings.service'
import type { GitService } from '../src/main/services/git.service'
import type { SchemaService } from '../src/main/services/schema.service'
import type { AuthService } from '../src/main/services/auth.service'
import type { TestsService } from '../src/main/services/tests.service'
import type { DrawioRef, DrawioSnapshot } from '../src/main/services/export/template/drawio-ref'

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
  const tests = { findRuns: async () => RUNS } as unknown as TestsService
  const service = new TemplateExportService(library, git, schema, auth, tests, fakeSnapshotter)

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
  await sprint3(service, library, lib, tmp, out)
  await sprint4(service, lib, tmp, out)

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

// ── Sprint 3 — draw.io, campagnes, dashboard, gabarits d'exemple ────────────

const PNG_1X1_S3 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
/** Appels reçus par le faux rendu draw.io (la vraie capture est vérifiée dans l'app, cf. sprint3.md). */
const snapshotCalls: DrawioRef[][] = []
async function fakeSnapshotter(_repo: string, refs: DrawioRef[]): Promise<Map<string, DrawioSnapshot>> {
  snapshotCalls.push(refs)
  const { drawioKey } = await import('../src/main/services/export/template/drawio-ref')
  return new Map(refs.filter(r => r.path === 'diagrams/ok.drawio').map(r => [drawioKey(r), { png: PNG_1X1_S3, width: 300, height: 150 }]))
}

const testCase = (id: string, title: string): TestCase => ({
  id, title, projectId: '', branchId: '', objectTypeRef: 'root::test', status: 'approved',
  preconditions: 'Batterie **chargée**', postconditions: 'Appareil éteint', equipment: [],
  steps: [
    { order: 2, action: 'Mesurer le temps', expectedResult: '< 500 ms', notes: null },
    { order: 1, action: 'Appuyer sur **ON**', expectedResult: 'LED verte', notes: 'à 25 °C' },
  ],
  fields: { niveau: 'système' }, createdAt: null, createdBy: null, updatedAt: null, updatedBy: null,
})

const RUNS: TestRun[] = [{
  id: 'RUN-1', testCaseId: 'TEST-0001', campaignRunId: null, result: 'FAIL', executedAt: '2026-09-30T14:05:00Z',
  executedBy: 'lolive', duration: 60, equipmentUsed: [], notes: 'Écart **constaté**',
  stepResults: [
    { order: 1, result: 'PASS', comment: '', executedAt: null },
    { order: 2, result: 'FAIL', comment: 'Mesuré **620 ms**', executedAt: null },
  ],
}]

const campaignPayload: CampaignExportPayload = {
  campaign: {
    id: 'CAMP-0001', title: 'Validation démarrage', fields: {}, baselineRef: 'v1.2.0', component: 'Moteur',
    status: 'in_progress', testCaseIds: [], runs: [], createdAt: '2026-09-01T00:00:00Z',
  },
  entries: [
    { run: { entryId: 'TEST-0001', testCaseId: 'TEST-0001', status: 'FAIL', runId: 'RUN-1', executedAt: '2026-09-30T14:05:00Z', executedBy: 'lolive', requirementId: 'SYS-0001' }, test: testCase('TEST-0001', 'Démarrage Eco') },
    { run: { entryId: 'TEST-0002', testCaseId: 'TEST-0002', status: 'pending' }, test: testCase('TEST-0002', 'Démarrage Turbo') },
  ],
}

const dashboardPayload: DashboardExportPayload = {
  dashboard: {
    id: 'D1', title: 'Suivi', scope: 'project' as never, createdBy: '', createdAt: '',
    widgetOrder: ['w2', 'w1'],
    widgets: [
      { id: 'w1', title: 'Vide', queryId: 'q', type: 'table' as never, fieldMapping: {} as never, size: {} as never },
      { id: 'w2', title: 'Couverture', queryId: 'q', type: 'table' as never, fieldMapping: {} as never, size: {} as never },
    ],
  },
  widgetResults: {
    w1: { columns: [], rows: [] },
    w2: { columns: [{ name: 'Statut', type: 'string' }, { name: 'Nombre', type: 'number' }], rows: [{ Statut: 'approved', Nombre: 12 }, { Statut: 'draft', Nombre: 3 }] },
  },
}

const DRAWIO = (pathName: string, nodeId = 'n1') => ['```drawio', JSON.stringify({ path: pathName, nodeId, width: 300 }), '```'].join('\n')

async function sprint3(service: TemplateExportService, library: ExportTemplateLibrary, lib: string, repo: string, out: string): Promise<void> {
  const examplesSrc = path.join(__dirname, '..', 'resources', 'export-templates')

  // ── S3.7 — installation des exemples (sans écrasement) ────────────────────
  const first = await library.installExamples(examplesSrc)
  const again = await library.installExamples(examplesSrc)
  const expected = fs.readdirSync(examplesSrc).length
  check(`S3.7 exemples installés (${first.copied}/${expected}), réinstallation sans écrasement`, first.copied === expected && again.copied === 0)
  const listed = (await library.list('docx')).templates.map(t => t.relPath).filter(r => r.startsWith('Exemples Polenta/'))
  const docxCount = fs.readdirSync(examplesSrc).filter(f => f.endsWith('.docx')).length
  check('S3.7 exemples Word listés (référence HTML exclue)', listed.length === docxCount, JSON.stringify(listed))

  const exportTo = async (kind: Parameters<TemplateExportService['run']>[0], tpl: string, payload: unknown, name: string) => {
    const dest = path.join(out, name)
    await service.run(kind, 'docx', payload, repo, `Exemples Polenta/${tpl}`, dest)
    return fsP.readFile(dest)
  }
  const textOf = (b: Buffer) => paragraphsOf(b).join('\n')

  // ── S3.1–S3.3 — draw.io ────────────────────────────────────────────────────
  const statement = [
    'Avant', '', DRAWIO('diagrams/ok.drawio'), '', DRAWIO('diagrams/absent.drawio', 'x9'), '', DRAWIO('diagrams/ok.drawio'),
    '', '```drawio', 'pas du json', '```',
  ].join('\n')
  const reqPayload: RequirementsExportPayload = {
    componentLabel: 'Moteur',
    columns: [{ key: 'section', label: 'Section' }, { key: 'id', label: 'ID' }, { key: 'name', label: 'Label' }, { key: 'status', label: 'Statut' }, { key: 'statement', label: 'Énoncé', type: 'richtext' }],
    rows: [],
    outline: [
      { kind: 'folder', level: 1, section: '1', name: 'Sécurité', values: {} },
      { kind: 'folder', level: 2, section: '1.1', name: 'Batterie', values: {} },
      ...Array.from({ length: 20 }, (_, i) => ({
        kind: 'item' as const, level: 3, section: `1.1.${i + 1}`, name: `Exigence ${i + 1}`, statusLabel: 'Approuvé',
        values: { section: `1.1.${i + 1}`, id: `SYS-${String(i + 1).padStart(4, '0')}`, name: `Exigence ${i + 1}`, status: 'approved', statement },
      })),
    ],
  }
  snapshotCalls.length = 0
  const reqBuf = await exportTo('requirements', 'Cahier des exigences.docx', reqPayload, 's3-exigences.docx')
  const reqDoc = new PizZip(reqBuf).file('word/document.xml')!.asText()
  const reqText = textOf(reqBuf)
  check('S3.1 diagramme rendu inséré en image (taille d’affichage)', reqDoc.includes(`<wp:extent cx="${300 * 9525}" cy="${150 * 9525}"/>`))
  check('S3.2 diagramme introuvable → repli', reqText.includes('[Diagramme : diagrams/absent.drawio#x9]'))
  check('S3.2 bloc drawio non JSON → omis', !reqText.includes('pas du json'))
  check('S3.3 rendu en une seule passe (un appel)', snapshotCalls.length === 1, String(snapshotCalls.length))
  check('S3.3 même diagramme ×40 → un seul média', Object.keys(new PizZip(reqBuf).files).filter(f => f.startsWith('word/media/')).length === 1)
  check('S3.7 exemple exigences : titres de dossiers hiérarchiques', /Heading1"\/>[\s\S]*?1 Sécurité/.test(reqDoc) && /Heading2"\/>[\s\S]*?1\.1 Batterie/.test(reqDoc))
  check('S3.7 exemple exigences : cartouche et en-tête', reqText.includes('Aspirateur V1') && reqText.includes('v1.2.0'))
  check('libellé de statut du schéma', reqText.includes('Statut : Approuvé') && !reqText.includes('Statut : approved'))
  const headerXml = Object.keys(new PizZip(reqBuf).files).filter(f => /word\/header\d*\.xml/.test(f)).map(f => new PizZip(reqBuf).file(f)!.asText()).join('')
  check('S3.7 balises remplies dans l’en-tête', headerXml.includes('Aspirateur V1 — Cahier des exigences') && !headerXml.includes('{{'))
  const reqProblems = packageProblems(reqBuf)
  check('S3.7 exemple exigences : paquet cohérent', reqProblems.length === 0, reqProblems.join(' ; '))

  snapshotCalls.length = 0
  await exportTo('requirements', 'Cahier des exigences.docx', { ...reqPayload, outline: reqPayload.outline!.map(e => ({ ...e, values: { ...e.values, statement: 'sans diagramme' } })) }, 's3-sans-diagramme.docx')
  check('aucun diagramme → pas de fenêtre de rendu', snapshotCalls.length === 0)

  // ── Exemple tests ──────────────────────────────────────────────────────────
  const testsBuf = await exportTo('tests', 'Cahier de tests.docx', {
    componentLabel: 'Moteur',
    columns: [{ key: 'id', label: 'ID' }, { key: 'name', label: 'Label' }, { key: 'preconditions', label: 'Préconditions', type: 'richtext' }],
    rows: [],
    outline: [{ kind: 'item', level: 1, section: '1', name: 'Démarrage', values: { id: 'TEST-0001', name: 'Démarrage', preconditions: 'Batterie **chargée**' }, steps: testCase('x', 'y').steps.map(st => ({ ...st, notes: st.notes ?? '' })) }],
  } satisfies TestsExportPayload, 's3-tests.docx')
  const testsText = textOf(testsBuf)
  check('S3.7 exemple tests : étapes en tableau', testsText.includes('Appuyer sur ON') && testsText.includes('LED verte'))
  check('S3.7 exemple tests : paquet cohérent', packageProblems(testsBuf).length === 0, packageProblems(testsBuf).join(' ; '))

  // ── S3.4 / S3.5 — campagnes ───────────────────────────────────────────────
  const planBuf = await exportTo('campaign-plan', 'Cahier de campagne.docx', campaignPayload, 's3-campagne.docx')
  const planText = textOf(planBuf)
  check('S3.4 cahier de campagne : entrées, exigence de l’instance, composant',
    planText.includes('TEST-0001') && planText.includes('Démarrage Turbo') && planText.includes('SYS-0001') && planText.includes('Moteur'))
  check('S3.4 étapes triées par ordre', planText.indexOf('Appuyer sur ON') < planText.indexOf('Mesurer le temps'))
  check('S3.4 préconditions mises en forme', /<w:b\/><\/w:rPr><w:t xml:space="preserve">chargée/.test(new PizZip(planBuf).file('word/document.xml')!.asText()))
  check('S3.4 paquet cohérent', packageProblems(planBuf).length === 0, packageProblems(planBuf).join(' ; '))

  const reportBuf = await exportTo('campaign-report', 'Rapport de campagne.docx', campaignPayload, 's3-rapport.docx')
  const reportText = textOf(reportBuf)
  check('S3.5 rapport : statut de campagne et libellés de résultat', reportText.includes('En cours') && reportText.includes('Échoué') && reportText.includes('En attente'))
  check('S3.5 rapport : synthèse (total 2, 1 échec, 1 en attente)', /\n2\n0\n1\n0\n0\n1\n/.test(reportText), reportText.slice(reportText.indexOf('Synthèse'), reportText.indexOf('Synthèse') + 120))
  check('S3.5 rapport : résultat et commentaire par étape', reportText.includes('Passé') && reportText.includes('Mesuré 620 ms'))
  check('S3.5 rapport : date d’exécution formatée', reportText.includes('30/09/2026'))
  check('S3.5 rapport : notes d’exécution', reportText.includes('Écart constaté') || /constaté/.test(new PizZip(reportBuf).file('word/document.xml')!.asText()))
  check('S3.5 paquet cohérent', packageProblems(reportBuf).length === 0, packageProblems(reportBuf).join(' ; '))

  // ── S3.6 — dashboard ──────────────────────────────────────────────────────
  const dashBuf = await exportTo('dashboard', 'Dashboard.docx', dashboardPayload, 's3-dashboard.docx')
  const dashText = textOf(dashBuf)
  check('S3.6 dashboard : ordre d’affichage des widgets', dashText.indexOf('Couverture') < dashText.indexOf('Vide'))
  check('S3.6 dashboard : tableau du résultat', /Statut\nNombre\napproved\n12\ndraft\n3/.test(dashText), dashText)
  check('S3.6 dashboard : widget sans donnée', /Vide\nAucune donnée\./.test(dashText))
  check('S3.6 paquet cohérent', packageProblems(dashBuf).length === 0, packageProblems(dashBuf).join(' ; '))
}

// ── Sprint 4 — Excel ────────────────────────────────────────────────────────

/** Lecture minimale d'un classeur : feuilles (nom → XML), chaînes partagées, valeur d'une cellule. */
function readXlsx(buf: Buffer) {
  const zip = new PizZip(buf)
  const decode = (t: string) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  const shared = [...(zip.file('xl/sharedStrings.xml')?.asText() ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => decode([...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(t => t[1]).join('')))
  const wbXml = zip.file('xl/workbook.xml')!.asText()
  const rels = zip.file('xl/_rels/workbook.xml.rels')!.asText()
  const sheets = new Map<string, string>()
  for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = decode(/name="([^"]*)"/.exec(m[0])![1])
    const rid = /r:id="([^"]+)"/.exec(m[0])![1]
    const target = new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] ?? new RegExp(`Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)![1]
    sheets.set(name, zip.file(target.startsWith('/') ? target.slice(1) : `xl/${target}`)!.asText())
  }
  const cell = (sheet: string, ref: string): string => {
    const m = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`).exec(sheets.get(sheet) ?? '')
    if (!m) return ''
    const v = /<v>([^<]*)<\/v>/.exec(m[2] ?? '')?.[1] ?? ''
    if (/t="s"/.test(m[1])) return shared[Number(v)] ?? ''
    const inline = /<is>[\s\S]*?<t[^>]*>([^<]*)<\/t>/.exec(m[2] ?? '')?.[1]
    return decode(inline ?? v)
  }
  const formulas = (sheet: string) => [...(sheets.get(sheet) ?? '').matchAll(/<f[^>]*>([^<]*)<\/f>/g)].map(m => decode(m[1]))
  return { zip, sheets, cell, formulas, workbook: wbXml }
}

async function sprint4(service: TemplateExportService, lib: string, repo: string, out: string): Promise<void> {
  // Gabarit « client » fait par Excel (scripts/fixtures/make-gh34-client-xlsx.ps1) : logo,
  // fusion, formule de ligne, MFC, validation, totaux, 2e feuille, graphique, zone d'impression.
  fs.mkdirSync(path.join(lib, 'S4'), { recursive: true })
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'gh34-client.xlsx'), path.join(lib, 'S4', 'client.xlsx'))

  const reqPayload = (n: number): RequirementsExportPayload => ({
    componentLabel: 'Moteur',
    columns: [
      { key: 'id', label: 'ID' }, { key: 'name', label: 'Label' }, { key: 'priority', label: 'Priorité', type: 'number' },
      { key: 'statement', label: 'Énoncé', type: 'richtext' },
    ],
    rows: [],
    outline: [
      { kind: 'folder', level: 1, section: '1', name: 'Sécurité', values: {} },
      ...[
        { id: 'SYS-0001', name: 'Surcharge', priority: '3', statusLabel: 'Approuvé' },
        { id: 'SYS-0002', name: '=HYPERLINK("http://x","clic")', priority: '5', statusLabel: 'Brouillon' },
        { id: 'SYS-0003', name: 'Court-circuit', priority: '9', statusLabel: 'Approuvé' },
      ].slice(0, n).map((v, i) => ({
        kind: 'item' as const, level: 2, section: `1.${i + 1}`, name: v.name, statusLabel: v.statusLabel,
        values: { id: v.id, name: v.name, priority: v.priority, statement: '**Gras** et\n- puce' },
      })),
    ],
  })
  const exportXlsx = async (kind: Parameters<TemplateExportService['run']>[0], tpl: string, payload: unknown, name: string) => {
    const dest = path.join(out, name)
    await service.run(kind, 'xlsx', payload, repo, tpl, dest)
    return readXlsx(await fsP.readFile(dest))
  }

  // ── S4.1 — gabarit client, 3 lignes ───────────────────────────────────────
  const x3 = await exportXlsx('requirements', 'S4/client.xlsx', reqPayload(3), 's4-client-3.xlsx')
  check('S4.1 cartouche rempli', x3.cell('Exigences', 'A1') === 'Aspirateur V1 — Cahier d\'exigences' && x3.cell('Exigences', 'A2') === 'Révision 0123456 v1.2.0', x3.cell('Exigences', 'A1') + ' / ' + x3.cell('Exigences', 'A2'))
  check('S4.1 ligne modèle répétée', ['A6', 'A7', 'A8'].map(r => x3.cell('Exigences', r)).join() === 'SYS-0001,SYS-0002,SYS-0003')
  check('S4.1 nombre réel pour un champ numérique', /<c r="D8"[^>]*><v>9<\/v>/.test(x3.sheets.get('Exigences')!))
  check('S4.1 formule de ligne recopiée et suivie', JSON.stringify(x3.formulas('Exigences').filter(f => f.endsWith('*2'))) === '["D6*2","D7*2","D8*2"]', JSON.stringify(x3.formulas('Exigences')))
  check('S4.1 totaux étendus', x3.formulas('Exigences').includes('SUM(D6:D8)') && x3.formulas('Exigences').includes('COUNTIF(C6:C8,"Approuvé")'))
  check('S4.1 totaux déplacés sous le tableau', x3.cell('Exigences', 'C10') === 'Total' && x3.cell('Exigences', 'C11') === 'Approuvées')
  check('S4.1 MFC et validation étendues', /conditionalFormatting[^>]*sqref="C6:C8"/.test(x3.sheets.get('Exigences')!) && /dataValidation\b[^>]*sqref="D6:D8"/.test(x3.sheets.get('Exigences')!))
  check('S4.1 autre feuille : formules étendues, valeur remplie', x3.formulas('Synthèse').join() === 'COUNTA(Exigences!A6:A8),AVERAGE(Exigences!D6:D8)' && x3.cell('Synthèse', 'B3') === 'Moteur')
  const chart = x3.zip.file(Object.keys(x3.zip.files).find(f => /xl\/charts\/chart\d*\.xml/.test(f))!)!.asText()
  check('S4.1 graphique conservé, séries étendues', chart.includes('$A$6:$A$8') && chart.includes('$D$6:$D$8'))
  check('S4.1 logo conservé', Object.keys(x3.zip.files).some(f => f.startsWith('xl/media/')))
  check('S4.1 zone d’impression étendue', /Print_Area[^>]*>Exigences!\$A\$1:\$E\$11</.test(x3.workbook))
  check('S4.1 recalcul complet à l’ouverture', /<calcPr[^>]*fullCalcOnLoad="1"/.test(x3.workbook))
  check('injection de formule neutralisée', x3.cell('Exigences', 'B7') === '\u200B=HYPERLINK("http://x","clic")' && !x3.formulas('Exigences').some(f => f.includes('HYPERLINK')))

  // ── Liste d'un seul élément / vide : références inchangées ────────────────
  const x1 = await exportXlsx('requirements', 'S4/client.xlsx', reqPayload(1), 's4-client-1.xlsx')
  check('S4.1 une ligne : références inchangées', x1.formulas('Exigences').includes('SUM(D6:D6)') && /sqref="C6"/.test(x1.sheets.get('Exigences')!))
  const x0 = await exportXlsx('requirements', 'S4/client.xlsx', reqPayload(0), 's4-client-0.xlsx')
  check('liste vide : ligne modèle vidée, références inchangées', x0.cell('Exigences', 'A6') === '' && x0.formulas('Exigences').includes('SUM(D6:D6)') && /Exigences!\$A\$6:\$A\$6/.test(x0.zip.file(Object.keys(x0.zip.files).find(f => /xl\/charts\/chart\d*\.xml/.test(f))!)!.asText()))

  // ── S4.3 / exemples ───────────────────────────────────────────────────────
  const ex = 'Exemples Polenta/'
  const xr = await exportXlsx('requirements', ex + 'Liste des exigences.xlsx', reqPayload(3), 's4-exigences.xlsx')
  const sheetName = [...xr.sheets.keys()][0]
  check('S4.3 richtext en texte simple dans une cellule', !JSON.stringify(xr.sheets.get(sheetName)).includes('**'))
  check('S4.7 exemple exigences : lignes, dossier, statut', xr.cell(sheetName, 'B9') === 'SYS-0001' && xr.cell(sheetName, 'D10') === 'Sécurité' && xr.cell(sheetName, 'E11') === 'Approuvé')
  check('S4.7 exemple exigences : totaux et filtre étendus', xr.formulas(sheetName).includes('COUNTA(B9:B11)') && /<autoFilter ref="A8:E11"/.test(xr.sheets.get(sheetName)!), JSON.stringify(xr.formulas(sheetName)))

  const xt = await exportXlsx('tests', ex + 'Liste des tests.xlsx', {
    componentLabel: 'Moteur', columns: [{ key: 'id', label: 'ID' }, { key: 'name', label: 'Label' }], rows: [],
    outline: [{ kind: 'item', level: 1, section: '1', name: 'Démarrage', values: { id: 'TEST-0001', name: 'Démarrage' }, steps: testCase('x', 'y').steps.map(st => ({ ...st, notes: st.notes ?? '' })) }],
  } satisfies TestsExportPayload, 's4-tests.xlsx')
  const tName = [...xt.sheets.keys()][0]
  check('S4.7 exemple tests : procédure en texte', xt.cell(tName, 'F9').startsWith('2. Mesurer le temps') || xt.cell(tName, 'F9').includes('Appuyer sur ON → LED verte'), xt.cell(tName, 'F9'))

  const xc = await exportXlsx('campaign-plan', ex + 'Plan de campagne.xlsx', campaignPayload, 's4-campagne.xlsx')
  const cName = [...xc.sheets.keys()][0]
  check('S4.2 plan de campagne : entrées et résultat', xc.cell(cName, 'A9') === 'TEST-0001' && xc.cell(cName, 'F10') === 'En attente' && xc.cell(cName, 'C9') === 'SYS-0001')

  // ── S4.4 — résultat de requête (colonnes dynamiques) et analyse d'impact ─
  const query: QueryResultExportPayload = {
    queryName: 'Statuts',
    result: { columns: [{ name: 'Statut', type: 'string' }, { name: 'Nombre', type: 'number' }, { name: 'Part', type: 'number' }], rows: [{ Statut: 'approved', Nombre: 12, Part: 0.8 }, { Statut: 'draft', Nombre: 3, Part: 0.2 }] },
  }
  const xq = await exportXlsx('query-result', ex + 'Résultat de requête.xlsx', query, 's4-requete.xlsx')
  const qName = [...xq.sheets.keys()][0]
  check('S4.4 requête : aucune cellule en double', !/<c r="(A10)"[^>]*>[\s\S]*?<c r="\1"/.test(xq.sheets.get(qName)!.match(/<row r="10"[\s\S]*?<\/row>/)?.[0] ?? ''))
  check('S4.4 requête : en-têtes et cellules en largeur', ['A8', 'B8', 'C8', 'A9', 'B9', 'A10', 'C10'].map(r => xq.cell(qName, r)).join('|') === 'Statut|Nombre|Part|approved|12|draft|0.2', ['A8', 'B8', 'C8', 'A9', 'B9', 'A10', 'C10'].map(r => xq.cell(qName, r)).join('|'))

  const impact: ImpactAnalysisExportPayload = {
    analysis: {
      id: 'IA-1', label: 'v1.0 → v1.1', repoPath: repo, fromBaseline: { tag: 'v1.0', sha: 'a' }, toBaseline: { tag: 'v1.1', sha: 'b' },
      createdAt: '2026-09-01', createdBy: 'lolive',
      changedRequirements: [{
        reqId: 'SYS-0001', title: 'Surcharge', changeType: 'modified' as never, changedFields: [],
        descendantTree: [{ elementId: 'SW-0001', elementType: 'requirement', title: 'Coupure FET', linkType: 'implementation', status: 'to_review' as never, comment: null, updatedAt: null, updatedBy: null,
          children: [{ elementId: 'TEST-0001', elementType: 'test_case', title: 'Test coupure', linkType: 'verification', status: 'ok' as never, comment: 'RAS', updatedAt: null, updatedBy: null, children: [] }] }],
        ascendantTree: [],
      }],
    },
  }
  const xi = await exportXlsx('impact-analysis', ex + 'Analyse des impacts.xlsx', impact, 's4-impact.xlsx')
  const iName = [...xi.sheets.keys()][0]
  check('S4.4 analyse d’impact : arbre aplati avec profondeur', ['D9', 'D10', 'D11', 'C11', 'H11'].map(r => xi.cell(iName, r)).join('|') === 'SYS-0001|SW-0001|TEST-0001|2|RAS', ['D9', 'D10', 'D11', 'C11', 'H11'].map(r => xi.cell(iName, r)).join('|'))
  check('S4.4 analyse d’impact : synthèse étendue', xi.formulas(iName).includes('COUNTIF(B9:B11,"<>Modification")'), JSON.stringify(xi.formulas(iName)))

  // ── Recopie d'Excel dans les lignes générées, lignes/cellules vides, balise partielle ──
  {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Calc')
    ws.getCell('A3').value = 'Réf ${table:items.n}'        // balise non seule : pas d'extension
    ws.getRow(5).height = 30                               // ligne vide auto-fermante
    ws.getCell('A6').value = { formula: 'B6*2' }           // formule à gauche de la balise
    ws.getCell('B6').value = '${table:items.n}'
    ws.getCell('C6').border = { top: { style: 'thin' } }   // cellule vide encadrée
    ws.getCell('D6').value = { formula: 'SUM(B$6:B6)' }    // cumul
    ws.getCell('E6').value = { formula: 'B6-B5' }          // différence avec la ligne précédente
    ws.getCell('B8').value = { formula: 'SUM(B6:B6)' }
    const calcPath = path.join(lib, 'S4', 'calc.xlsx')
    fs.writeFileSync(calcPath, Buffer.from(await wb.xlsx.writeBuffer()))
    const { renderXlsxTemplate } = await import('../src/main/services/export/template/xlsx-render')
    const buf = await renderXlsxTemplate(calcPath, 'calc.xlsx', { items: [{ n: 1 }, { n: 2 }, { n: 3 }] })
    fs.writeFileSync(path.join(out, 's4-calc.xlsx'), buf)
    const sheet = readXlsx(buf).sheets.get('Calc')!
    const f = (ref: string) => new RegExp(`<c r="${ref}"[^>]*>\\s*<f>([^<]*)</f>`).exec(sheet)?.[1] ?? '(aucune)'
    check('revue : formule à gauche de la balise suit sa ligne', [f('A6'), f('A7'), f('A8')].join() === 'B6*2,B7*2,B8*2', [f('A6'), f('A7'), f('A8')].join())
    check('revue : cumul recopié (B$6:B…)', [f('D6'), f('D7'), f('D8')].join() === 'SUM(B$6:B6),SUM(B$6:B7),SUM(B$6:B8)', [f('D6'), f('D7'), f('D8')].join())
    check('revue : référence relative à une autre ligne décalée', [f('E6'), f('E7')].join() === 'B6-B5,B7-B6', [f('E6'), f('E7')].join())
    check('revue : ligne vide au-dessus et balise partielle sans décalage parasite', f('B10') === 'SUM(B6:B8)', f('B10'))
  }

  // ── S4.5 — erreurs ────────────────────────────────────────────────────────
  fs.writeFileSync(path.join(lib, 'S4', 'corrompu.xlsx'), 'pas un zip')
  const dest = path.join(out, 's4-jamais.xlsx')
  try {
    await service.run('requirements', 'xlsx', reqPayload(1), repo, 'S4/corrompu.xlsx', dest)
    check('S4.5 classeur corrompu → erreur', false, 'aucune erreur')
  } catch (err) {
    check('S4.5 classeur corrompu → message, aucun fichier', /n’est pas un classeur Excel valide/.test((err as Error).message) && !fs.existsSync(dest), (err as Error).message)
  }
}
