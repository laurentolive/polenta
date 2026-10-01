import type {
  ExportColumn,
  ExportKind,
  RequirementsExportPayload,
  TemplateOutlineEntry,
  TestsExportPayload,
} from '@polenta/types'
import { markdownToPlainText } from './markdown-to-text'
import { textParagraphs, type RichFragment } from './markdown-to-ooxml'

/** GH34 — données communes à tous les gabarits (spec §2.4). */
export interface TemplateCommonData {
  project: { label: string; component: string }
  export: {
    /** Date de génération, format local (`fr-FR`). */
    date: string
    datetime: string
    /** Même instant en ISO 8601 — entrée du filtre `date:'…'` pour un autre format. */
    iso: string
    user: string
    kind: ExportKind
    templateName: string
  }
  git: { branch: string; commit: string; tag: string }
}

export interface TemplateContext {
  projectLabel: string
  componentLabel: string
  user: string
  kind: ExportKind
  templateRelPath: string
  branch: string
  commit: string
  tags: string[]
  now: Date
}

export function buildCommonData(ctx: TemplateContext): TemplateCommonData {
  return {
    project: { label: ctx.projectLabel, component: ctx.componentLabel },
    export: {
      date: ctx.now.toLocaleDateString('fr-FR'),
      datetime: ctx.now.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }),
      iso: ctx.now.toISOString(),
      user: ctx.user,
      kind: ctx.kind,
      templateName: ctx.templateRelPath,
    },
    git: { branch: ctx.branch, commit: ctx.commit.slice(0, 7), tag: ctx.tags[0] ?? '' },
  }
}

/** Champ richtext → fragment OOXML pour une balise brute `{{@rich.x}}` (cf. `MarkdownToOoxml`). */
export type RichConverter = (markdown: string) => Promise<RichFragment>

/**
 * Expose `fragment` en propriété calculée : docxtemplater relit la valeur à chaque occurrence de
 * balise, chaque insertion reçoit donc ses propres numérotations de listes (`RichFragment`).
 */
function defineRich(target: object, key: string, fragment: RichFragment): void {
  Object.defineProperty(target, key, { get: () => fragment.render(), enumerable: true, configurable: true })
}

interface TemplateStep {
  order: number
  action: string
  expectedResult: string
  notes: string
  rich: { action: string; expectedResult: string; notes: string }
}

/** Élément (exigence ou test) ou dossier tel qu'exposé à une boucle `{{#items}}`. */
export interface TemplateItem {
  isFolder: boolean
  isItem: boolean
  level: number
  section: string
  name: string
  columns: { key: string; label: string; value: string; rich: string; isRich: boolean }[]
  steps: TemplateStep[]
  /** OOXML des champs richtext, par nom de champ (`{{@rich.statement}}`). */
  rich: Record<string, string>
  [field: string]: unknown
}

// Clés structurelles d'un élément : prioritaires sur une colonne de même nom.
const RESERVED = new Set(['isFolder', 'isItem', 'level', 'section', 'name', 'columns', 'steps', 'rich'])

/**
 * GH34 — `items` d'un cahier d'exigences ou de tests. Part de `outline` (arbre complet dans
 * l'ordre visuel, dossiers compris) envoyé par le renderer quand un gabarit est choisi ; à défaut
 * (renderer plus ancien), repli sur `rows` sans dossiers ni étapes détaillées.
 * Chaque champ richtext est exposé deux fois : en texte simple (`{{statement}}`) et mis en forme
 * (`{{@rich.statement}}`, sprint 2) ; idem pour les étapes de test.
 */
export async function buildItemsData(
  payload: RequirementsExportPayload | TestsExportPayload,
  toRich: RichConverter,
): Promise<{ items: TemplateItem[]; count: number }> {
  const outline: TemplateOutlineEntry[] = payload.outline ?? payload.rows.map(values => ({
    kind: 'item' as const,
    level: 1,
    section: values['section'] ?? '',
    name: values['name'] ?? '',
    values,
  }))
  const items: TemplateItem[] = []
  // Séquentiel : l'ordre d'allocation des images/listes suit celui du document.
  for (const entry of outline) items.push(await toItem(entry, payload.columns, toRich))
  return { items, count: items.filter(i => i.isItem).length }
}

async function toItem(entry: TemplateOutlineEntry, columns: ExportColumn[], toRich: RichConverter): Promise<TemplateItem> {
  const item: TemplateItem = {
    isFolder: entry.kind === 'folder',
    isItem: entry.kind === 'item',
    level: entry.level,
    section: entry.section,
    name: entry.name,
    columns: [],
    steps: [],
    rich: {},
  }
  if (entry.kind === 'folder') return item

  // Étapes saisies en richtext (Markdown).
  for (const step of entry.steps ?? []) {
    const rich = {} as TemplateStep['rich']
    defineRich(rich, 'action', await toRich(step.action))
    defineRich(rich, 'expectedResult', await toRich(step.expectedResult))
    defineRich(rich, 'notes', await toRich(step.notes))
    item.steps.push({
      order: step.order,
      action: markdownToPlainText(step.action),
      expectedResult: markdownToPlainText(step.expectedResult),
      notes: markdownToPlainText(step.notes),
      rich,
    })
  }

  for (const col of columns) {
    const raw = entry.values[col.key] ?? ''
    const isRich = col.type === 'richtext'
    const value = isRich ? markdownToPlainText(raw) : raw
    // Colonne non richtext : paragraphes de texte simple, pour qu'une boucle sur `columns` puisse
    // utiliser `{{@rich}}` uniformément.
    const fragment: RichFragment = isRich ? await toRich(raw) : { render: () => textParagraphs(raw) }
    if (!RESERVED.has(col.key)) {
      item[col.key] = value
      if (isRich) defineRich(item.rich, col.key, fragment)
    }
    if (!RESERVED.has(col.key) || col.key === 'section' || col.key === 'name') {
      const column = { key: col.key, label: col.label, value, isRich } as TemplateItem['columns'][number]
      defineRich(column, 'rich', fragment)
      item.columns.push(column)
    }
  }
  // Valeurs sans colonne déclarée (payload ancien) : exposées telles quelles.
  for (const [key, value] of Object.entries(entry.values)) {
    if (!RESERVED.has(key) && !(key in item)) item[key] = value
  }
  return item
}
