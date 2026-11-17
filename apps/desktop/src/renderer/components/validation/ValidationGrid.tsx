import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CoverageStatus, MatrixCell, SchemaField, TestCase, ValidationPage, ValidationRow } from '@polenta/types'
import { fieldValueToText, pendingDecision } from '@polenta/types'
import { api } from '../../api'
import { DynamicField } from '../DynamicField'
import { useNavigate } from '@tanstack/react-router'
import { ElementLink } from '../element/ElementLink'
import { PageLink } from '../element/PageLink'
import { CoverageBadge } from '../system/CoverageBadge'
import { IssueProposalDialog, useHasIssueType, type IssueProposalOrigin } from '../issues/IssueProposalDialog'
import { DataGrid, type CellEditFailure } from '../grid/DataGrid'
import type { GridColumn } from '../grid/gridTypes'
import { useGridScrollKey } from '../grid/useGridScrollKey'
import { ValidationRuns } from './ValidationRuns'
import { useInvalidateValidations, validationErrorText } from './useValidations'

type Filter = 'all' | 'pending' | 'proposed' | 'review' | 'impacted' | `decision:${string}`
type DecisionOrigin = Extract<IssueProposalOrigin, { kind: 'decision' }>

const BASE_COLUMNS = ['id', 'title', 'decision', 'comment', 'status', 'design', 'coverage', 'impact']
const stripHtml = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const textOf = (v: unknown) => stripHtml(fieldValueToText(v))
const CELL_STATUS: Record<string, MatrixCell['status']> = { PASS: 'pass', FAIL: 'fail', BLOCKED: 'blocked' }
const NO_TESTS = new Map<string, TestCase>()

/** GH204 §7 (préférences d'avant GH389) : ID, titre et mentions étaient affichés hors de la liste. */
const migrateColumns = (stored: string[]) => (stored.includes('id') ? stored : ['id', 'title', ...stored, 'mentions'])

/**
 * GH204 §7, GH389 §2.2 — grille des décisions sur la grille commune (`DataGrid`) : une ligne par
 * exigence, dépliée sur ses champs d'entrée, ses tests et leurs exécutions. Décision et commentaire
 * s'éditent dans la cellule (et en lot sur la sélection) ; Confirmer / Rejeter agissent sur la ligne
 * ou sur la sélection.
 */
export function ValidationGrid({ page, repoPath, projectId, workspaceDir }: {
  page: ValidationPage
  repoPath: string
  projectId: string
  workspaceDir?: string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const invalidate = useInvalidateValidations()
  const hasIssueType = useHasIssueType(repoPath)
  const scrollKey = useGridScrollKey('validation')
  const { validation, typeDef } = page
  const editable = page.state === 'open' && !page.readonly && page.version.state !== 'abandoned'
  const decisions = useMemo(() => typeDef.decisions ?? [], [typeDef.decisions])
  const pending = pendingDecision(typeDef)?.name
  const typeKey = validation.objectTypeRef
  const signedAt = page.signed?.at ?? null

  const [filter, setFilter] = useState<Filter>('all')
  const rowFilter = useCallback((r: ValidationRow) => {
    if (filter === 'all') return true
    if (filter === 'pending') return r.decision === pending
    if (filter === 'proposed') return !!r.entry?.proposed
    if (filter === 'review') return !!r.review
    if (filter === 'impacted') return !!r.impact
    return r.decision === filter.slice('decision:'.length)
  }, [filter, pending])

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  // Lignes disparues (exigence retirée du périmètre) : hors de la sélection.
  useEffect(() => {
    const ids = new Set(page.rows.map(r => r.requirementId))
    setSelected(prev => ([...prev].every(id => ids.has(id)) ? prev : new Set([...prev].filter(id => ids.has(id)))))
  }, [page.rows])
  const [error, setError] = useState<string | null>(null)
  const [proposing, setProposing] = useState<DecisionOrigin | null>(null)

  const decide = (row: ValidationRow, decision: string, patch: { comment?: string; fields?: Record<string, unknown> } = {}) =>
    api.validations.decide(repoPath, validation.id, {
      requirementId: row.requirementId, decision,
      comment: patch.comment ?? row.entry?.comment,
      fields: patch.fields ?? row.entry?.fields,
    }, workspaceDir)

  /** GH244 — une seule proposition d'issue pour toutes les lignes dont la décision la propose. */
  const proposeIssue = (rows: ValidationRow[], decisionOf: (row: ValidationRow) => string) => {
    if (!hasIssueType) return
    const defOf = (r: ValidationRow) => decisions.find(d => d.name === decisionOf(r))
    const concerned = rows.filter(r => defOf(r)?.proposesIssue)
    if (concerned.length === 0) return
    const labels = [...new Set(concerned.map(r => defOf(r)!).map(d => d.label || d.name))]
    setProposing({
      kind: 'decision',
      refs: concerned.map(r => ({ ref: `${validation.id}/${r.requirementId}`, requirementId: r.requirementId })),
      decisionLabel: labels.join(' / '),
    })
  }

  /** Écrit ligne par ligne : un échec n'empêche pas les autres ; rend les lignes écrites et les échecs. */
  const writeAll = async (rows: ValidationRow[], op: (row: ValidationRow) => Promise<unknown>) => {
    const done: ValidationRow[] = []
    const failed: CellEditFailure[] = []
    for (const row of rows) {
      try {
        await op(row)
        done.push(row)
      } catch (err) {
        failed.push({ id: row.requirementId, message: validationErrorText(t, err) })
      }
    }
    await invalidate()
    return { done, failed }
  }
  const showFailures = (failed: CellEditFailure[]) => {
    if (failed.length > 0) setError([t('grid.bulkFailed', { count: failed.length }), ...failed.map(f => `${f.id} : ${f.message}`)].join('\n'))
  }

  const byId = useMemo(() => new Map(page.rows.map(r => [r.requirementId, r])), [page.rows])
  const onCellEdit = async (ids: string[], key: string, value: string) => {
    setError(null)
    const rows = ids.map(id => byId.get(id)).filter((r): r is ValidationRow => !!r)
    if (key === 'decision') {
      const { done, failed } = await writeAll(rows, row => decide(row, value))
      proposeIssue(done.filter(r => r.decision !== value), () => value)
      return { failed }
    }
    const { failed } = await writeAll(rows, row => decide(row, row.decision, { comment: value }))
    return { failed }
  }

  /** Confirmer / Rejeter : n'agissent que sur les lignes concernées. */
  const confirmRows = async (rows: ValidationRow[]) => {
    setError(null)
    const { done, failed } = await writeAll(rows.filter(r => r.review || r.entry?.proposed),
      row => api.validations.confirm(repoPath, validation.id, row.requirementId, workspaceDir))
    showFailures(failed)
    proposeIssue(done.filter(r => r.entry?.proposed), r => r.decision)
  }
  const rejectRows = async (rows: ValidationRow[]) => {
    setError(null)
    const { failed } = await writeAll(rows.filter(r => r.entry?.proposed),
      row => api.validations.reject(repoPath, validation.id, row.requirementId, workspaceDir))
    showFailures(failed)
  }
  const saveEntryFields = async (row: ValidationRow, fields: Record<string, unknown>) => {
    setError(null)
    const { failed } = await writeAll([row], r => decide(r, r.decision, { fields }))
    if (failed.length > 0) setError(failed[0].message)
  }

  // Actions des cellules (mentions, dépli) lues par une ref : colonnes et dépli stables.
  const rowActions = useRef({ confirmRows, rejectRows, saveEntryFields })
  rowActions.current = { confirmRows, rejectRows, saveEntryFields }

  const columns = useMemo<GridColumn<ValidationRow>[]>(() => {
    const decisionGroup = t('validation.group.decision')
    const requirementGroup = t('validation.group.requirement')
    const decisionLabel = (name: string) => decisions.find(d => d.name === name)?.label || name
    const sourcesText = (r: ValidationRow) => r.impact?.sources.map(s => [s.rootId, ...s.path.map(p => p.id)].join(' → ')).join(' ; ') ?? ''
    const mentions = (r: ValidationRow) => [
      r.outsideSignature ? t('validation.frozen.outside') : '',
      r.entry?.proposed ? t('validation.proposed', { by: r.entry.proposedBy }) : '',
      !r.entry?.proposed && r.review ? t(`validation.review.${r.review}`) : '',
    ].filter(Boolean)
    return [
      {
        key: 'id', label: t('validation.column.id'), group: requirementGroup, locked: true,
        getText: r => r.requirementId,
        render: r => <ElementLink id={r.requirementId} className="font-mono text-prim" />,
        elementId: r => r.requirementId,
      },
      { key: 'title', label: t('validation.column.title'), group: requirementGroup, locked: true, getText: r => r.title },
      {
        key: 'decision', label: t('validation.column.decision'), group: decisionGroup,
        getText: r => decisionLabel(r.decision),
        editValue: r => r.decision,
        editor: { kind: 'enum', options: decisions.map(d => ({ value: d.name, label: d.label || d.name })) },
        isEditable: () => editable,
      },
      {
        key: 'comment', label: t('validation.column.comment'), group: decisionGroup,
        getText: r => r.entry?.comment ?? '',
        editor: { kind: 'text' },
        isEditable: r => editable && r.decision !== pending,
      },
      { key: 'status', label: t('validation.column.status'), group: requirementGroup, getText: r => page.requirementStatusLabels[r.status] ?? r.status },
      {
        key: 'design', label: t('validation.column.design'), group: requirementGroup,
        getText: r => r.designVersion?.title ?? '',
        render: r => r.designVersion
          ? (
            <PageLink id={r.designVersion.id} repoPath={repoPath} className="text-prim"
              onFallback={() => void navigate({ to: '/version/$versionId', params: { versionId: r.designVersion!.id }, search: { projectId, repoPath } })}>
              {r.designVersion.title}
            </PageLink>
          )
          : <span className="text-ink-3">—</span>,
        elementId: r => r.designVersion?.id,
      },
      {
        key: 'coverage', label: t('validation.column.coverage'), group: requirementGroup,
        getText: r => t(`system.coverage.status.${r.coverageStatus}`),
        render: r => <CoverageBadge coverage={coverageOf(r.coverageStatus, r.tests)} testsById={testsOf(r.tests)} />,
      },
      {
        key: 'impact', label: t('validation.column.impact'), group: decisionGroup,
        getText: r => (r.impact ? [t(`validation.impact.${r.impact.kind}`), sourcesText(r)].filter(Boolean).join(' ') : ''),
        render: r => r.impact && (
          <span className="flex flex-col">
            <span className="text-[10px] px-1.5 rounded bg-status-warning-bg text-status-warning self-start">{t(`validation.impact.${r.impact.kind}`)}</span>
            {r.impact.sources.length > 0 && <span className="text-[10px] text-ink-3">{sourcesText(r)}</span>}
          </span>
        ),
      },
      ...(typeDef.entryFields ?? []).map((f): GridColumn<ValidationRow> => ({
        key: `entry:${f.name}`, label: f.label || f.name, group: decisionGroup, getText: r => textOf(r.entry?.fields?.[f.name]),
      })),
      {
        key: 'mentions', label: t('validation.column.mentions'), group: decisionGroup, filterable: false,
        getText: r => mentions(r).join(', '),
        render: r => (
          <span className="whitespace-nowrap">
            {r.outsideSignature && <span className="text-[10px] px-1.5 rounded bg-status-warning-bg text-status-warning mr-1" data-testid={`validation-outside-${r.requirementId}`}>{t('validation.frozen.outside')}</span>}
            {r.entry?.proposed && <span className="text-[10px] px-1.5 rounded bg-status-info-bg text-status-info mr-1" data-testid={`validation-proposed-${r.requirementId}`}>{t('validation.proposed', { by: r.entry.proposedBy })}</span>}
            {!r.entry?.proposed && r.review && <span className="text-[10px] px-1.5 rounded bg-status-warning-bg text-status-warning mr-1" data-testid={`validation-review-${r.requirementId}`}>{t(`validation.review.${r.review}`)}</span>}
            {editable && (r.review || r.entry?.proposed) && (
              <button type="button" className="btn-secondary-sm" data-testid={`validation-confirm-${r.requirementId}`}
                onClick={e => { e.stopPropagation(); void rowActions.current.confirmRows([r]) }}>{t('validation.confirm')}</button>
            )}
            {editable && r.entry?.proposed && (
              <button type="button" className="btn-secondary-sm ml-1" data-testid={`validation-reject-${r.requirementId}`}
                onClick={e => { e.stopPropagation(); void rowActions.current.rejectRows([r]) }}>{t('validation.reject')}</button>
            )}
          </span>
        ),
      },
      ...page.requirementFields.map((f): GridColumn<ValidationRow> => ({
        key: `field:${f.name}`, label: f.label || f.name, group: requirementGroup, getText: r => textOf(r.fields[f.name]),
      })),
    ]
  }, [t, decisions, editable, pending, typeDef.entryFields, page.requirementFields, page.requirementStatusLabels, navigate, repoPath, projectId])

  const defaults = useMemo(() => [...BASE_COLUMNS, ...(typeDef.entryFields ?? []).map(f => `entry:${f.name}`), 'mentions'], [typeDef.entryFields])
  const prefs = useMemo(() => ({ repoPath, prefKey: typeKey, view: 'excel', defaults }), [repoPath, typeKey, defaults])
  const savedViews = useMemo(() => ({ typeKey, workspaceDir }), [typeKey, workspaceDir])
  const getRowId = useCallback((r: ValidationRow) => r.requirementId, [])
  const renderExpanded = useCallback((row: ValidationRow) => (
    <div className="flex flex-col gap-3">
      {(typeDef.entryFields ?? []).length > 0 && (
        <EntryFieldsForm
          fields={typeDef.entryFields!}
          values={row.entry?.fields ?? {}}
          disabled={!editable || row.decision === pending}
          repoPath={repoPath}
          testId={`validation-entry-${row.requirementId}`}
          onSave={fields => void rowActions.current.saveEntryFields(row, fields)}
        />
      )}
      <ValidationRuns repoPath={repoPath} projectId={projectId} workspaceDir={workspaceDir} requirementId={row.requirementId} tests={row.tests}
        versionId={validation.versionId} signedAt={signedAt} frozen={page.frozen === 'copy' && !row.outsideSignature} />
    </div>
  ), [typeDef.entryFields, editable, pending, repoPath, projectId, workspaceDir, validation.versionId, signedAt, page.frozen])

  const selectedRows = page.rows.filter(r => selected.has(r.requirementId))
  const canConfirm = selectedRows.some(r => r.review || r.entry?.proposed)
  const canReject = selectedRows.some(r => r.entry?.proposed)

  return (
    <div className="flex flex-col gap-2 min-h-0 flex-1">
      {error && <p className="text-xs text-status-danger whitespace-pre-wrap" role="alert" data-testid="validation-grid-error">{error}</p>}
      {page.frozen === 'copy' && <p className="text-xs text-status-info" data-testid="validation-frozen">{t('validation.frozen.copy')}</p>}
      {page.frozen === 'legacy' && <p className="text-xs text-ink-3" data-testid="validation-frozen-legacy">{t('validation.frozen.legacy')}</p>}
      {page.rows.some(r => r.outsideSignature) && <p className="text-xs text-status-warning" role="alert" data-testid="validation-outside-banner">{t('validation.frozen.outsideBanner')}</p>}
      {page.rows.length === 0 && <p className="text-xs text-ink-3 italic">{t('validation.noRequirement')}</p>}
      <DataGrid
        gridId="validation"
        title={validation.title}
        rows={page.rows}
        getRowId={getRowId}
        columns={columns}
        prefs={prefs}
        migrateColumns={migrateColumns}
        savedViews={savedViews}
        rowFilter={rowFilter}
        selection={{ mode: 'rows', selected, onChange: setSelected }}
        onCellEdit={editable ? onCellEdit : undefined}
        renderExpanded={renderExpanded}
        scrollMemoryKey={scrollKey}
        toolbarStart={
          <>
            <select value={filter} onChange={e => setFilter(e.target.value as Filter)} className="input-field text-xs py-0.5" aria-label={t('validation.filter.label')} data-testid="validation-filter">
              <option value="all">{t('validation.filter.all')}</option>
              <option value="pending">{t('validation.filter.pending')}</option>
              <option value="proposed">{t('validation.filter.proposed')}</option>
              <option value="review">{t('validation.filter.review')}</option>
              <option value="impacted">{t('validation.filter.impacted')}</option>
              {decisions.filter(d => !d.isPending).map(d => <option key={d.name} value={`decision:${d.name}`}>{d.label || d.name}</option>)}
            </select>
            {editable && (
              <>
                <button type="button" className="btn-secondary-sm" disabled={!canConfirm} onClick={() => void confirmRows(selectedRows)} data-testid="validation-confirm-selection">
                  {t('grid.confirmSelection')}
                </button>
                <button type="button" className="btn-secondary-sm" disabled={!canReject} onClick={() => void rejectRows(selectedRows)} data-testid="validation-reject-selection">
                  {t('grid.rejectSelection')}
                </button>
              </>
            )}
          </>
        }
      />
      {proposing && (
        <IssueProposalDialog repoPath={repoPath} workspaceDir={workspaceDir} origin={proposing} onClose={() => setProposing(null)} />
      )}
    </div>
  )
}

/** Couverture du badge commun ; ses tests et leur dernière exécution sont lus dans la ligne. */
function coverageOf(coverageStatus: CoverageStatus, tests: ValidationRow['tests']) {
  return {
    coverageStatus,
    cells: tests.map((test): MatrixCell => ({
      testCaseId: test.id, coverageType: 'full', status: CELL_STATUS[test.lastRun?.result ?? ''] ?? 'not_run',
      lastRunId: test.lastRun?.id ?? null, lastRunDate: test.lastRun?.executedAt ?? null,
    })),
  }
}

function testsOf(tests: ValidationRow['tests']): Map<string, TestCase> {
  return tests.length === 0 ? NO_TESTS : new Map(tests.map(test => [test.id, { id: test.id, title: test.title } as TestCase]))
}

function EntryFieldsForm({ fields, values, disabled, repoPath, testId, onSave }: {
  fields: SchemaField[]
  values: Record<string, unknown>
  disabled: boolean
  repoPath: string
  testId: string
  onSave: (fields: Record<string, unknown>) => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(values)
  // Sur le contenu : une relecture de la page (nouvel objet, même valeur) garde la saisie.
  const saved = JSON.stringify(values)
  useEffect(() => setDraft(JSON.parse(saved) as Record<string, unknown>), [saved])
  const dirty = JSON.stringify(draft) !== JSON.stringify(values)
  return (
    <div className="flex flex-col gap-2 max-w-3xl" data-testid={testId}>
      {fields.map(f => (
        <DynamicField key={f.name} field={f} value={fieldValueToText(draft[f.name])} disabled={disabled} repoPath={repoPath}
          onChange={v => setDraft(prev => ({ ...prev, [f.name]: v }))} />
      ))}
      {dirty && !disabled && (
        <div className="flex gap-2">
          <button type="button" className="btn-primary-sm" onClick={() => onSave(draft)} data-testid={`${testId}-save`}>{t('common.save')}</button>
          <button type="button" className="btn-secondary-sm" onClick={() => setDraft(values)}>{t('common.cancel')}</button>
        </div>
      )}
    </div>
  )
}
