import {
  TEST_RUN_STATUS_LABELS,
  type CampaignExportPayload,
  type CampaignStatus,
  type DashboardExportPayload,
  type StepResultValue,
  type TestRun,
} from '@polenta/types'
import { markdownToPlainText } from './markdown-to-text'
import { defineRich, type RichConverter } from './template-data'

// Libellés français des statuts sans table partagée (l'écran de campagne affiche la valeur brute ;
// les résultats d'étape suivent `campaignPage.stepResult` / `runStatus` de l'i18n).
const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  planned: 'Planifiée',
  in_progress: 'En cours',
  completed: 'Terminée',
  abandoned: 'Abandonnée',
}
const STEP_RESULT_LABELS: Record<StepResultValue, string> = {
  PASS: 'Passé',
  FAIL: 'Échoué',
  BLOCKED: 'Bloqué',
  SKIP: 'Ignoré',
  NOT_EXECUTED: 'Non exécuté',
}

/** Tableau Word de texte simple (`textTableXml` sur le paquet du gabarit). */
export type TableBuilder = (header: string[], rows: string[][]) => string

/** Charge l'exécution détaillée (`TestRun`, résultats par étape) d'une entrée de campagne. */
export type RunLoader = (testCaseId: string, runId: string) => Promise<TestRun | null>

/**
 * GH34 sprint 3 — données d'un cahier (`campaign-plan`) ou d'un rapport (`campaign-report`) de
 * campagne : la campagne, puis une entrée par instance de test (`entries`, déjà résolues côté
 * renderer : snapshot figé, paramètres substitués), avec pour le rapport le résultat d'exécution
 * et le détail par étape (lu depuis l'exécution `runId`), et une synthèse par statut.
 */
export async function buildCampaignData(
  payload: CampaignExportPayload,
  toRich: RichConverter,
  loadRun: RunLoader,
): Promise<object> {
  const { campaign } = payload
  const summary = { total: 0, pass: 0, fail: 0, blocked: 0, incomplete: 0, pending: 0 }
  const entries: object[] = []

  for (const { run, test } of payload.entries) {
    summary.total++
    const key = run.status === 'pending' ? 'pending' : run.status.toLowerCase() as keyof typeof summary
    if (key in summary) summary[key]++

    const execution = run.runId ? await loadRun(run.testCaseId, run.runId).catch(() => null) : null
    const resultsByOrder = new Map((execution?.stepResults ?? []).map(r => [r.order, r]))

    const steps: object[] = []
    for (const step of [...(test.steps ?? [])].sort((a, b) => a.order - b.order)) {
      const result = resultsByOrder.get(step.order)
      const rich = {}
      defineRich(rich, 'action', await toRich(step.action ?? ''))
      defineRich(rich, 'expectedResult', await toRich(step.expectedResult ?? ''))
      defineRich(rich, 'notes', await toRich(step.notes ?? ''))
      defineRich(rich, 'comment', await toRich(result?.comment ?? ''))
      steps.push({
        order: step.order,
        action: markdownToPlainText(step.action ?? ''),
        expectedResult: markdownToPlainText(step.expectedResult ?? ''),
        notes: markdownToPlainText(step.notes ?? ''),
        result: result?.result ?? '',
        resultLabel: result ? STEP_RESULT_LABELS[result.result] ?? result.result : '',
        comment: markdownToPlainText(result?.comment ?? ''),
        rich,
      })
    }

    const rich = {}
    defineRich(rich, 'preconditions', await toRich(test.preconditions ?? ''))
    defineRich(rich, 'postconditions', await toRich(test.postconditions ?? ''))
    defineRich(rich, 'notes', await toRich(execution?.notes ?? ''))
    entries.push({
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
      notes: markdownToPlainText(execution?.notes ?? ''),
      fields: plainFields(test.fields),
      steps,
      rich,
    })
  }

  return {
    campaign: {
      id: campaign.id,
      title: campaign.title,
      status: campaign.status,
      statusLabel: CAMPAIGN_STATUS_LABELS[campaign.status] ?? campaign.status,
      baselineRef: campaign.baselineRef ?? '',
      component: campaign.component ?? '',
      level: campaign.level ?? '',
      createdAt: campaign.createdAt ?? '',
      completedAt: campaign.completedAt ?? '',
      fields: plainFields(campaign.fields),
    },
    entries,
    count: entries.length,
    summary,
  }
}

/**
 * GH34 sprint 3 — données d'un dashboard : un widget par élément de `widgets`, dans l'ordre
 * d'affichage, avec son résultat : `{{@table}}` (tableau Word complet, colonnes du résultat — une
 * boucle sur des colonnes de tableau n'existe pas dans docxtemplater), ou `columns`/`rows` (cellules
 * dans l'ordre des colonnes) pour une mise en forme libre. Pas de graphique (hors scope, comme
 * l'export docx Standard).
 */
export function buildDashboardData(payload: DashboardExportPayload, toTable: TableBuilder): object {
  const { dashboard, widgetResults } = payload
  const byId = new Map(dashboard.widgets.map(w => [w.id, w]))
  const ordered = [
    ...dashboard.widgetOrder.map(id => byId.get(id)).filter((w): w is NonNullable<typeof w> => !!w),
    ...dashboard.widgets.filter(w => !dashboard.widgetOrder.includes(w.id)),
  ]
  const widgets = ordered.map(widget => {
    const result = widgetResults[widget.id]
    const columns = result?.columns.map(c => c.name) ?? []
    const rows = (result?.rows ?? []).map(row => ({ cells: columns.map(c => (row[c] == null ? '' : String(row[c]))) }))
    const hasData = rows.length > 0 && columns.length > 0
    return {
      id: widget.id,
      title: widget.title,
      type: widget.type,
      columns: columns.map(name => ({ name })),
      rows,
      hasData,
      rowCount: rows.length,
      table: hasData ? toTable(columns, rows.map(r => r.cells)) : '',
    }
  })
  return { dashboard: { id: dashboard.id, title: dashboard.title }, widgets, count: widgets.length }
}

/** Champs personnalisés en texte simple (richtext Markdown retiré, listes jointes). */
function plainFields(fields: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (value == null) out[key] = ''
    else if (Array.isArray(value)) out[key] = value.map(String).join(', ')
    else if (typeof value === 'string') out[key] = markdownToPlainText(value)
    else out[key] = String(value)
  }
  return out
}
