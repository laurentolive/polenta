import type {
  ExportColumn,
  ExportKind,
  RequirementsExportPayload,
  TemplateOutlineEntry,
  TestsExportPayload,
} from '@polenta/types'
import { markdownToPlainText } from './markdown-to-text'

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

/** Élément (exigence ou test) ou dossier tel qu'exposé à une boucle `{{#items}}`. */
export interface TemplateItem {
  isFolder: boolean
  isItem: boolean
  level: number
  section: string
  name: string
  columns: { key: string; label: string; value: string; isRich: boolean }[]
  steps: { order: number; action: string; expectedResult: string; notes: string }[]
  [field: string]: unknown
}

// Clés structurelles d'un élément : prioritaires sur une colonne de même nom.
const RESERVED = new Set(['isFolder', 'isItem', 'level', 'section', 'name', 'columns', 'steps', 'rich'])

/**
 * GH34 — `items` d'un cahier d'exigences ou de tests. Part de `outline` (arbre complet dans
 * l'ordre visuel, dossiers compris) envoyé par le renderer quand un gabarit est choisi ; à défaut
 * (renderer plus ancien), repli sur `rows` sans dossiers ni étapes détaillées.
 * Les valeurs richtext sont exposées en texte simple ; `rich.<champ>` (mise en forme Word) vient
 * au sprint 2.
 */
export function buildItemsData(payload: RequirementsExportPayload | TestsExportPayload): {
  items: TemplateItem[]
  count: number
} {
  const outline: TemplateOutlineEntry[] = payload.outline ?? payload.rows.map(values => ({
    kind: 'item' as const,
    level: 1,
    section: values['section'] ?? '',
    name: values['name'] ?? '',
    values,
  }))
  const items = outline.map(entry => toItem(entry, payload.columns))
  return { items, count: items.filter(i => i.isItem).length }
}

function toItem(entry: TemplateOutlineEntry, columns: ExportColumn[]): TemplateItem {
  const plain = (col: ExportColumn): string => {
    const raw = entry.values[col.key] ?? ''
    return col.type === 'richtext' ? markdownToPlainText(raw) : raw
  }
  const item: TemplateItem = {
    isFolder: entry.kind === 'folder',
    isItem: entry.kind === 'item',
    level: entry.level,
    section: entry.section,
    name: entry.name,
    columns: [],
    // Étapes saisies en richtext (Markdown) : texte simple, comme les champs richtext.
    steps: (entry.steps ?? []).map(step => ({
      order: step.order,
      action: markdownToPlainText(step.action),
      expectedResult: markdownToPlainText(step.expectedResult),
      notes: markdownToPlainText(step.notes),
    })),
  }
  if (entry.kind === 'folder') return item

  for (const [key, value] of Object.entries(entry.values)) {
    if (RESERVED.has(key)) continue
    const col = columns.find(c => c.key === key)
    item[key] = col ? plain(col) : value
  }
  item.columns = columns
    .filter(c => !RESERVED.has(c.key) || c.key === 'section' || c.key === 'name')
    .map(c => ({ key: c.key, label: c.label, value: plain(c), isRich: c.type === 'richtext' }))
  return item
}
