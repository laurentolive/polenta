/**
 * GH34 — génère les gabarits Word d'exemple livrés avec l'application
 * (`resources/export-templates/*.docx`), copiés dans la bibliothèque de l'utilisateur par
 * « Installer les exemples » (panneau Compte). Point de départ pour un gabarit client : page de
 * garde avec cartouche, en-tête/pied de page, titres hiérarchiques, contenu riche. Les balises
 * sont écrites chacune dans un seul run (comme si elles étaient tapées d'un trait dans Word).
 *
 * Lancement : `pnpm --filter @polenta/desktop exec tsx scripts/build-export-templates.ts`
 * (à relancer après toute modification de ce fichier ; les .docx produits sont versionnés).
 */
import * as fs from 'fs'
import * as path from 'path'
import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, Packer, PageBreak, PageNumber,
  Paragraph, ShadingType, Table, TableCell, TableRow, TabStopType, TextRun, WidthType,
} from 'docx'

const OUT = path.join(__dirname, '..', 'resources', 'export-templates')
const ACCENT = '1F3864'
const ACCENT_LIGHT = 'D9E2F3'
const GREY = '666666'

// ── Briques ───────────────────────────────────────────────────────────────────

const p = (text: string, opts: { bold?: boolean; color?: string; size?: number; style?: string; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; keepNext?: boolean } = {}) =>
  new Paragraph({
    style: opts.style,
    alignment: opts.align,
    keepNext: opts.keepNext,
    children: [new TextRun({ text, bold: opts.bold, color: opts.color, size: opts.size })],
  })
const tag = (text: string) => new Paragraph({ children: [new TextRun(text)] })
const h = (level: 1 | 2 | 3, text: string) => new Paragraph({
  heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][level - 1],
  children: [new TextRun(text)],
})
const label = (text: string) => p(text, { style: 'PolentaLabel', keepNext: true })
const meta = (text: string) => p(text, { style: 'PolentaMeta' })

const BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'A6A6A6' }
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER, insideHorizontal: BORDER, insideVertical: BORDER }

function cell(text: string, opts: { header?: boolean; width?: number } = {}): TableCell {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.header ? { type: ShadingType.CLEAR, color: 'auto', fill: ACCENT_LIGHT } : undefined,
    children: [new Paragraph({ children: [new TextRun({ text, bold: opts.header, size: 18 })] })],
  })
}

/** Tableau : ligne d'en-tête + lignes (une ligne contenant `{{#x}}…{{/x}}` est répétée). */
function table(header: string[], rows: string[][], widths: number[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: BORDERS,
    rows: [
      new TableRow({ tableHeader: true, children: header.map((t, i) => cell(t, { header: true, width: widths[i] })) }),
      ...rows.map(r => new TableRow({ children: r.map((t, i) => cell(t, { width: widths[i] })) })),
    ],
  })
}

/** Cartouche de page de garde : libellé | valeur. */
function cartouche(rows: [string, string][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: BORDERS,
    rows: rows.map(([k, v]) => new TableRow({ children: [cell(k, { header: true, width: 30 }), cell(v, { width: 70 })] })),
  })
}

function cover(docTitle: string, subtitle: string, extra: [string, string][]): Paragraph[] | (Paragraph | Table)[] {
  return [
    new Paragraph({ spacing: { before: 2400 }, children: [] }),
    p('{{project.label}}', { size: 28, color: GREY }),
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(docTitle)] }),
    p(subtitle, { size: 28, color: ACCENT }),
    new Paragraph({ spacing: { before: 1200 }, children: [] }),
    cartouche([
      ['Projet', '{{project.label}}'],
      ...extra,
      ['Révision', '{{git.commit}}{{#git.tag}} — {{git.tag}}{{/git.tag}}'],
      ['Branche', '{{git.branch}}'],
      ['Date', '{{export.date}}'],
      ['Édité par', '{{export.user}}'],
    ]),
    new Paragraph({ spacing: { before: 600 }, children: [] }),
    meta('Document généré par Polenta à partir du gabarit {{export.templateName}}.'),
    new Paragraph({ children: [new PageBreak()] }),
  ]
}

function document(docTitle: string, children: (Paragraph | Table)[]): Document {
  return new Document({
    creator: 'Polenta',
    title: docTitle,
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 21 }, paragraph: { spacing: { after: 80 } } },
        title: { run: { font: 'Calibri Light', size: 56, color: ACCENT } },
        heading1: { run: { font: 'Calibri Light', size: 32, bold: true, color: ACCENT }, paragraph: { spacing: { before: 360, after: 120 }, keepNext: true } },
        heading2: { run: { font: 'Calibri Light', size: 28, bold: true, color: ACCENT }, paragraph: { spacing: { before: 240, after: 100 }, keepNext: true } },
        heading3: { run: { font: 'Calibri Light', size: 24, bold: true, color: '2E74B5' }, paragraph: { spacing: { before: 200, after: 80 }, keepNext: true } },
      },
      paragraphStyles: [
        { id: 'PolentaItemTitle', name: 'Polenta — titre d’élément', basedOn: 'Normal', next: 'Normal', run: { bold: true, size: 23, color: ACCENT }, paragraph: { spacing: { before: 240, after: 40 }, keepNext: true, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: ACCENT_LIGHT, space: 2 } } } },
        { id: 'PolentaMeta', name: 'Polenta — métadonnées', basedOn: 'Normal', next: 'Normal', run: { size: 18, color: GREY, italics: true }, paragraph: { spacing: { after: 120 } } },
        { id: 'PolentaLabel', name: 'Polenta — libellé', basedOn: 'Normal', next: 'Normal', run: { bold: true, size: 19, color: GREY }, paragraph: { spacing: { before: 120, after: 20 }, keepNext: true } },
      ],
    },
    sections: [{
      properties: { titlePage: true, page: { margin: { top: 1418, bottom: 1418, left: 1418, right: 1418 } } },
      headers: {
        first: new Header({ children: [] }),
        default: new Header({ children: [p(`{{project.label}} — ${docTitle}`, { size: 16, color: GREY, align: AlignmentType.RIGHT })] }),
      },
      footers: {
        first: new Footer({ children: [] }),
        default: new Footer({
          children: [new Paragraph({
            tabStops: [{ type: TabStopType.RIGHT, position: 9070 }],
            children: [
              new TextRun({ text: 'Révision {{git.commit}} — {{export.date}}', size: 16, color: GREY }),
              new TextRun({ children: ['\tPage ', PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], size: 16, color: GREY }),
            ],
          })],
        }),
      },
      children,
    }],
  })
}

// Titres de dossiers selon leur profondeur, puis le contenu propre à chaque élément.
function folderHeadings(): Paragraph[] {
  return [
    tag('{{#isFolder && level == 1}}'), h(1, '{{section}} {{name}}'), tag('{{/}}'),
    tag('{{#isFolder && level == 2}}'), h(2, '{{section}} {{name}}'), tag('{{/}}'),
    tag('{{#isFolder && level > 2}}'), h(3, '{{section}} {{name}}'), tag('{{/}}'),
  ]
}

// Colonnes visibles de la Vue Word, sauf celles déjà dans le titre / la ligne de métadonnées.
const SHOWN_IN_HEADER = ['id', 'name', 'section', 'status', 'version', 'steps']
function columnsBlock(): Paragraph[] {
  const condition = SHOWN_IN_HEADER.map(k => `key != "${k}"`).join(' && ')
  return [
    tag('{{#columns}}'),
    tag(`{{#${condition} && value}}`),
    label('{{label}}'),
    tag('{{@rich}}'),
    tag('{{/}}'),
    tag('{{/columns}}'),
  ]
}

function itemHeader(): Paragraph[] {
  return [
    p('{{id}} — {{name}}', { style: 'PolentaItemTitle' }),
    meta('{{#section}}§{{section}} · {{/section}}Statut : {{statusLabel}}{{#version}} · version {{version}}{{/version}}'),
  ]
}

// ── Gabarits ──────────────────────────────────────────────────────────────────

const templates: Record<string, Document> = {
  'Cahier des exigences.docx': document('Cahier des exigences', [
    ...cover('Cahier des exigences', '{{project.component}}', [['Composant', '{{project.component}}'], ['Exigences', '{{count}}']]),
    tag('{{#items}}'),
    ...folderHeadings(),
    tag('{{#isItem}}'),
    ...itemHeader(),
    ...columnsBlock(),
    tag('{{/isItem}}'),
    tag('{{/items}}'),
  ]),

  'Cahier de tests.docx': document('Cahier de tests', [
    ...cover('Cahier de tests', '{{project.component}}', [['Composant', '{{project.component}}'], ['Tests', '{{count}}']]),
    tag('{{#items}}'),
    ...folderHeadings(),
    tag('{{#isItem}}'),
    ...itemHeader(),
    ...columnsBlock(),
    label('Étapes'),
    table(['N°', 'Action', 'Résultat attendu', 'Notes'], [['{{#steps}}{{order}}', '{{action}}', '{{expectedResult}}', '{{notes}}{{/steps}}']], [8, 37, 37, 18]),
    tag('{{/isItem}}'),
    tag('{{/items}}'),
  ]),

  'Cahier de campagne.docx': document('Cahier de campagne', [
    ...cover('Cahier de campagne', '{{campaign.title}}', [['Campagne', '{{campaign.id}} — {{campaign.title}}'], ['Composant', '{{campaign.component}}'], ['Référence', '{{campaign.baselineRef}}'], ['Tests', '{{count}}']]),
    h(1, 'Tests inclus'),
    table(['Test', 'Titre', 'Exigence'], [['{{#entries}}{{id}}', '{{title}}', '{{requirementId}}{{/entries}}']], [20, 55, 25]),
    h(1, 'Procédures'),
    tag('{{#entries}}'),
    h(2, '{{id}} — {{title}}'),
    meta('{{#requirementId}}Instance pour {{requirementId}} · {{/requirementId}}Statut du test : {{testStatus}}'),
    label('Préconditions'),
    tag('{{@rich.preconditions}}'),
    label('Étapes'),
    table(['N°', 'Action', 'Résultat attendu', 'Notes'], [['{{#steps}}{{order}}', '{{action}}', '{{expectedResult}}', '{{notes}}{{/steps}}']], [8, 37, 37, 18]),
    label('Postconditions'),
    tag('{{@rich.postconditions}}'),
    tag('{{/entries}}'),
  ]),

  'Rapport de campagne.docx': document('Rapport de campagne', [
    ...cover('Rapport de campagne', '{{campaign.title}}', [['Campagne', '{{campaign.id}} — {{campaign.title}}'], ['Composant', '{{campaign.component}}'], ['Statut', '{{campaign.statusLabel}}'], ['Référence', '{{campaign.baselineRef}}']]),
    h(1, 'Synthèse'),
    table(['Total', 'Passés', 'Échoués', 'Bloqués', 'Incomplets', 'En attente'],
      [['{{summary.total}}', '{{summary.pass}}', '{{summary.fail}}', '{{summary.blocked}}', '{{summary.incomplete}}', '{{summary.pending}}']],
      [16, 16, 17, 17, 17, 17]),
    h(1, 'Résultats'),
    table(['Test', 'Titre', 'Exigence', 'Résultat', 'Exécuté le', 'Par'],
      [['{{#entries}}{{id}}', '{{title}}', '{{requirementId}}', '{{statusLabel}}', '{{executedAt | date:"dd/MM/yyyy"}}', '{{executedBy}}{{/entries}}']],
      [14, 30, 14, 14, 14, 14]),
    h(1, 'Détail par test'),
    tag('{{#entries}}'),
    h(2, '{{id}} — {{title}} : {{statusLabel}}'),
    meta('{{#requirementId}}Instance pour {{requirementId}} · {{/requirementId}}{{#executedAt}}Exécuté le {{executedAt | date:"dd/MM/yyyy HH:mm"}}{{#executedBy}} par {{executedBy}}{{/executedBy}}{{/executedAt}}'),
    table(['N°', 'Action', 'Résultat attendu', 'Résultat', 'Commentaire'],
      [['{{#steps}}{{order}}', '{{action}}', '{{expectedResult}}', '{{resultLabel}}', '{{comment}}{{/steps}}']],
      [7, 30, 30, 13, 20]),
    tag('{{#notes}}'),
    label('Notes d’exécution'),
    tag('{{@rich.notes}}'),
    tag('{{/notes}}'),
    tag('{{/entries}}'),
  ]),

  'Dashboard.docx': document('Dashboard', [
    ...cover('Dashboard', '{{dashboard.title}}', [['Dashboard', '{{dashboard.title}}'], ['Widgets', '{{count}}']]),
    tag('{{#widgets}}'),
    h(2, '{{title}}'),
    tag('{{#hasData}}'),
    tag('{{@table}}'),
    meta('{{rowCount}} ligne(s)'),
    tag('{{/hasData}}'),
    tag('{{^hasData}}'),
    meta('Aucune donnée.'),
    tag('{{/hasData}}'),
    tag('{{/widgets}}'),
  ]),
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true })
  for (const [name, doc] of Object.entries(templates)) {
    fs.writeFileSync(path.join(OUT, name), await Packer.toBuffer(doc))
    console.log(`écrit ${name}`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
