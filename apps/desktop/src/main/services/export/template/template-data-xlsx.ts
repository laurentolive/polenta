import {
  TEST_RUN_STATUS_LABELS,
  type CampaignExportPayload,
  type ImpactAnalysisExportPayload,
  type ImpactNode,
  type QueryResultExportPayload,
  type RequirementsExportPayload,
  type TemplateOutlineEntry,
  type TestsExportPayload,
} from '@polenta/types'
import { markdownToPlainText } from './markdown-to-text'

// GH34 sprint 4 — données des gabarits Excel. Une cellule n'a pas de mise en forme riche : tout
// est en texte simple ; les listes de lignes (`items`, `entries`, `rows`) alimentent les lignes
// modèles `${table:<liste>.<champ>}` ; les champs numériques du schéma sont de vrais nombres
// (formules et formats Excel s'y appliquent).

/** Cahier d'exigences / de tests : une ligne par élément (les dossiers ne font pas de ligne). */
export function buildItemsXlsxData(payload: RequirementsExportPayload | TestsExportPayload): object {
  const outline: TemplateOutlineEntry[] = payload.outline ?? payload.rows.map(values => ({
    kind: 'item' as const, level: 1, section: values['section'] ?? '', name: values['name'] ?? '', values,
  }))
  const items: Record<string, unknown>[] = []
  const folders: string[] = [] // dossier courant par profondeur
  for (const entry of outline) {
    if (entry.kind === 'folder') {
      folders[entry.level - 1] = entry.name
      folders.length = entry.level
      continue
    }
    const item: Record<string, unknown> = {}
    for (const col of payload.columns) {
      const raw = entry.values[col.key] ?? ''
      item[col.key] = col.type === 'richtext' ? markdownToPlainText(raw)
        : col.type === 'number' && raw.trim() !== '' && Number.isFinite(Number(raw)) ? Number(raw)
          : raw
    }
    const steps = entry.steps ?? []
    Object.assign(item, {
      section: entry.section,
      name: entry.name,
      level: entry.level,
      folder: folders.slice(0, entry.level - 1).filter(Boolean).at(-1) ?? '',
      folderPath: folders.slice(0, entry.level - 1).filter(Boolean).join(' › '),
      statusLabel: entry.statusLabel ?? entry.values['status'] ?? '',
      stepCount: steps.length,
      stepsText: steps.map(s => `${s.order}. ${markdownToPlainText(s.action)} → ${markdownToPlainText(s.expectedResult)}`).join('\n'),
    })
    items.push(item)
  }
  return { items, count: items.length }
}

/** Cahier de campagne : une ligne par instance de test. */
export function buildCampaignXlsxData(payload: CampaignExportPayload): object {
  const { campaign } = payload
  const entries = payload.entries.map(({ run, test }) => {
    const steps = [...(test.steps ?? [])].sort((a, b) => a.order - b.order)
    return {
      entryId: run.entryId,
      id: test.id,
      title: test.title,
      testStatus: test.status,
      requirementId: run.requirementId ?? '',
      status: run.status,
      statusLabel: TEST_RUN_STATUS_LABELS[run.status] ?? run.status,
      executedAt: run.executedAt ?? '',
      executedBy: run.executedBy ?? '',
      preconditions: markdownToPlainText(test.preconditions ?? ''),
      postconditions: markdownToPlainText(test.postconditions ?? ''),
      stepCount: steps.length,
      stepsText: steps.map(s => `${s.order}. ${markdownToPlainText(s.action ?? '')} → ${markdownToPlainText(s.expectedResult ?? '')}`).join('\n'),
    }
  })
  return {
    campaign: {
      id: campaign.id, title: campaign.title, status: campaign.status, baselineRef: campaign.baselineRef ?? '',
      component: campaign.component ?? '', level: campaign.level ?? '', createdAt: campaign.createdAt ?? '',
    },
    entries,
    count: entries.length,
  }
}

/**
 * Résultat de requête : colonnes inconnues à l'avance — `${columnNames}` (en-têtes, insérés en
 * largeur) et `${table:rows.cells}` (une ligne par résultat, cellules en largeur) ; pour une
 * requête connue, aussi `${table:rows.<colonne>}` par nom de colonne.
 */
export function buildQueryResultXlsxData(payload: QueryResultExportPayload): object {
  const columns = payload.result.columns
  const rows = payload.result.rows.map(row => {
    const cells = columns.map(c => cellValue(row[c.name]))
    return { ...Object.fromEntries(columns.map((c, i) => [c.name, cells[i]])), cells }
  })
  return { query: { name: payload.queryName }, columnNames: columns.map(c => c.name), rows, count: rows.length }
}

/** Analyse d'impact : une ligne par exigence modifiée puis par nœud de ses arbres d'impact. */
export function buildImpactXlsxData(payload: ImpactAnalysisExportPayload): object {
  const { analysis } = payload
  const rows: Record<string, unknown>[] = []
  const addNode = (reqId: string, node: ImpactNode, direction: string, depth: number) => {
    rows.push({
      reqId, direction, depth, id: node.elementId, title: node.title, type: node.linkType,
      status: node.status, comment: node.comment ?? '', updatedBy: node.updatedBy ?? '',
    })
    for (const child of node.children) addNode(reqId, child, direction, depth + 1)
  }
  for (const req of analysis.changedRequirements) {
    rows.push({ reqId: req.reqId, direction: 'Modification', depth: 0, id: req.reqId, title: req.title, type: req.changeType, status: '', comment: '', updatedBy: '' })
    for (const node of req.descendantTree) addNode(req.reqId, node, 'Descendant', 1)
    for (const node of req.ascendantTree) addNode(req.reqId, node, 'Ascendant', 1)
  }
  return {
    analysis: {
      id: analysis.id, label: analysis.label, from: analysis.fromBaseline.tag, to: analysis.toBaseline.tag,
      createdAt: analysis.createdAt, createdBy: analysis.createdBy,
    },
    rows,
    changes: analysis.changedRequirements.length,
    count: rows.length,
  }
}

function cellValue(value: unknown): string | number | boolean {
  if (value == null) return ''
  if (typeof value === 'number' || typeof value === 'boolean') return value
  return String(value)
}
