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

  // ── S1.13 / S1.15 — bibliothèque non configurée / absente ─────────────────
  dir = undefined
  const none = await library.list('docx')
  check('S1.13 bibliothèque non configurée', !none.dirConfigured && none.templates.length === 0)
  dir = path.join(tmp, 'supprime')
  const gone = await library.list('docx')
  check('S1.15 bibliothèque introuvable', gone.dirConfigured && !gone.dirExists)

  await fsP.rm(tmp, { recursive: true, force: true })
  console.log(`\n${passes} PASS, ${failures} FAIL`)
  process.exit(failures ? 1 : 0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
