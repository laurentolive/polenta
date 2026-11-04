import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Eye } from 'lucide-react'
import type { SavedView, SavedViewRef, SchemaField, ValidationPage, ValidationRow } from '@polenta/types'
import { fieldValueToText, pendingDecision } from '@polenta/types'
import { api } from '../../api'
import { DynamicField } from '../DynamicField'
import { SavedViewsMenu } from '../system/SavedViewsMenu'
import { IssueProposalDialog, useHasIssueType } from '../issues/IssueProposalDialog'
import { ValidationRuns } from './ValidationRuns'
import { useInvalidateValidations, validationErrorText } from './useValidations'

const DEFAULT_COLUMNS = ['decision', 'comment', 'status', 'design', 'coverage', 'impact']
const COVERAGE_CLASS: Record<ValidationRow['coverageStatus'], string> = {
  not_covered: 'bg-status-neutral-bg text-status-neutral',
  covered: 'bg-status-info-bg text-status-info',
  validated: 'bg-status-success-bg text-status-success',
  failing: 'bg-status-danger-bg text-status-danger',
  needs_revalidation: 'bg-status-warning-bg text-status-warning',
}
type Filter = 'all' | 'pending' | 'proposed' | 'review' | 'impacted' | `decision:${string}`

const stripHtml = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const textOf = (v: unknown) => stripHtml(fieldValueToText(v))

/** GH204 §7 — grille des décisions : une ligne par exigence, dépliée sur ses champs, tests et exécutions. */
export function ValidationGrid({ page, repoPath, projectId, workspaceDir }: {
  page: ValidationPage
  repoPath: string
  projectId: string
  workspaceDir?: string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const invalidate = useInvalidateValidations()
  const hasIssueType = useHasIssueType(repoPath)
  const { validation, typeDef } = page
  const editable = page.state === 'open' && !page.readonly && page.version.state !== 'abandoned'
  const decisions = typeDef.decisions ?? []
  const pending = pendingDecision(typeDef)?.name
  const typeKey = validation.objectTypeRef

  const { data: username } = useQuery({
    queryKey: ['project-username', repoPath],
    queryFn: () => api.auth.projectUsername(repoPath),
    enabled: !!repoPath,
    retry: false,
  })
  const user = username ?? 'local'
  const prefKey = ['pref-visibility', repoPath, user, typeKey]
  const { data: prefs, isSuccess: prefsLoaded } = useQuery({
    queryKey: prefKey,
    queryFn: () => api.pref.getFieldVisibility(repoPath, user, typeKey),
  })

  const available = useMemo(() => [
    ...DEFAULT_COLUMNS.map(key => ({ key, label: t(`validation.column.${key}`) })),
    ...(typeDef.entryFields ?? []).map(f => ({ key: `entry:${f.name}`, label: f.label || f.name })),
    ...page.requirementFields.map(f => ({ key: `field:${f.name}`, label: f.label || f.name })),
  ], [typeDef.entryFields, page.requirementFields, t])
  const defaults = useMemo(() => [...DEFAULT_COLUMNS, ...(typeDef.entryFields ?? []).map(f => `entry:${f.name}`)], [typeDef.entryFields])
  const [columns, setColumns] = useState<string[] | null>(null)
  useEffect(() => { if (prefsLoaded) setColumns(prefs?.excel ?? defaults) }, [prefsLoaded, prefs?.excel, defaults])
  const shown = columns ?? defaults
  const visible = available.filter(c => shown.includes(c.key))

  const savePrefs = async (patch: { excel?: string[] | null; activeView?: SavedViewRef | null }) => {
    await api.pref.setFieldVisibility(repoPath, user, typeKey, patch)
    await qc.invalidateQueries({ queryKey: prefKey })
  }
  const setShown = (next: string[]) => {
    setColumns(next)
    void savePrefs({ excel: next })
  }
  const columnsOf = (settings: Record<string, unknown>): string[] => {
    const list = settings.excel
    return Array.isArray(list) && list.every(s => typeof s === 'string') ? list as string[] : defaults
  }
  const applyView = (view: SavedView & { ref: SavedViewRef }) => {
    const next = columnsOf(view.settings)
    setColumns(next)
    void savePrefs({ excel: next, activeView: view.ref })
  }

  const [filter, setFilter] = useState<Filter>('all')
  const rows = page.rows.filter(r => {
    if (filter === 'all') return true
    if (filter === 'pending') return r.decision === pending
    if (filter === 'proposed') return !!r.entry?.proposed
    if (filter === 'review') return !!r.review
    if (filter === 'impacted') return !!r.impact
    return r.decision === filter.slice('decision:'.length)
  })

  const [open, setOpen] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [proposing, setProposing] = useState<{ requirementId: string; decisionLabel: string } | null>(null)
  const signedAt = page.signed?.at ?? null

  const run = async (op: () => Promise<unknown>): Promise<boolean> => {
    setError(null)
    try {
      await op()
      await invalidate()
      return true
    } catch (err) {
      setError(validationErrorText(t, err))
      return false
    }
  }
  const proposeIssue = (requirementId: string, decision: string) => {
    const def = decisions.find(d => d.name === decision)
    if (def?.proposesIssue && hasIssueType) setProposing({ requirementId, decisionLabel: def.label || def.name })
  }
  const decide = async (row: ValidationRow, decision: string, patch: { comment?: string; fields?: Record<string, unknown> } = {}) => {
    const done = await run(() => api.validations.decide(repoPath, validation.id, {
      requirementId: row.requirementId, decision,
      comment: patch.comment ?? row.entry?.comment,
      fields: patch.fields ?? row.entry?.fields,
    }, workspaceDir))
    if (done && decision !== row.decision) proposeIssue(row.requirementId, decision)
  }
  const confirm = async (row: ValidationRow) => {
    const done = await run(() => api.validations.confirm(repoPath, validation.id, row.requirementId, workspaceDir))
    if (done && row.entry?.proposed) proposeIssue(row.requirementId, row.decision)
  }

  const cell = (row: ValidationRow, key: string) => {
    switch (key) {
      case 'decision':
        return editable ? (
          <select value={row.decision} onChange={e => void decide(row, e.target.value)} className="input-field text-xs py-0.5" data-testid={`validation-decision-${row.requirementId}`}>
            {decisions.map(d => <option key={d.name} value={d.name}>{d.label || d.name}</option>)}
          </select>
        ) : <span data-testid={`validation-decision-${row.requirementId}`}>{decisions.find(d => d.name === row.decision)?.label || row.decision}</span>
      case 'comment':
        return editable && row.decision !== pending
          ? <CommentInput key={row.entry?.comment ?? ''} value={row.entry?.comment ?? ''} testId={`validation-comment-${row.requirementId}`}
              onCommit={comment => void decide(row, row.decision, { comment })} />
          : <span className="text-ink-2">{row.entry?.comment}</span>
      case 'status':
        return <span className="text-ink-2">{page.requirementStatusLabels[row.status] ?? row.status}</span>
      case 'design':
        return row.designVersion
          ? <button type="button" className="text-prim hover:underline" onClick={() => void navigate({ to: '/version/$versionId', params: { versionId: row.designVersion!.id }, search: { projectId, repoPath } })}>{row.designVersion.title}</button>
          : <span className="text-ink-3">—</span>
      case 'coverage':
        return <span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${COVERAGE_CLASS[row.coverageStatus]}`}>{t(`system.coverage.status.${row.coverageStatus}`)}</span>
      case 'impact':
        if (!row.impact) return null
        return (
          <span className="flex flex-col" data-testid={`validation-impact-${row.requirementId}`}>
            <span className="text-[10px] px-1.5 rounded bg-status-warning-bg text-status-warning self-start">{t(`validation.impact.${row.impact.kind}`)}</span>
            {row.impact.sources.length > 0 && <span className="text-[10px] text-ink-3">{row.impact.sources.map(s => [s.rootId, ...s.path.map(p => p.id)].join(' → ')).join(' ; ')}</span>}
          </span>
        )
      default:
        if (key.startsWith('entry:')) return <span className="text-ink-2">{textOf(row.entry?.fields?.[key.slice(6)])}</span>
        if (key.startsWith('field:')) return <span className="text-ink-2">{textOf(row.fields[key.slice(6)])}</span>
        return null
    }
  }

  return (
    <div className="flex flex-col gap-2 min-h-0">
      <div className="flex items-center gap-2 flex-wrap">
        <select value={filter} onChange={e => setFilter(e.target.value as Filter)} className="input-field text-xs py-0.5" aria-label={t('validation.filter.label')} data-testid="validation-filter">
          <option value="all">{t('validation.filter.all')}</option>
          <option value="pending">{t('validation.filter.pending')}</option>
          <option value="proposed">{t('validation.filter.proposed')}</option>
          <option value="review">{t('validation.filter.review')}</option>
          <option value="impacted">{t('validation.filter.impacted')}</option>
          {decisions.filter(d => !d.isPending).map(d => <option key={d.name} value={`decision:${d.name}`}>{d.label || d.name}</option>)}
        </select>
        <ColumnsMenu available={available} shown={shown} onChange={setShown} />
        <SavedViewsMenu
          repoPath={repoPath}
          username={user}
          typeKey={typeKey}
          workspaceDir={workspaceDir}
          settings={{ excel: shown }}
          active={prefs?.activeView ?? null}
          isModified={settings => JSON.stringify(columnsOf(settings)) !== JSON.stringify(shown)}
          onApply={applyView}
          onActiveChange={async activeView => { await savePrefs({ activeView }) }}
          onDefaults={() => { setColumns(defaults); void savePrefs({ excel: null, activeView: null }) }}
        />
        <span className="text-xs text-ink-3 ml-auto" data-testid="validation-count">{rows.length} / {page.rows.length}</span>
      </div>
      {error && <p className="text-xs text-status-danger" role="alert">{error}</p>}
      {page.rows.length === 0 && <p className="text-xs text-ink-3 italic">{t('validation.noRequirement')}</p>}
      <div className="overflow-auto min-h-0">
        <table className="w-full text-xs border-collapse" data-testid="validation-grid">
          <thead className="sticky top-0 bg-surface z-10">
            <tr className="text-left text-ink-3 border-b border-edge">
              <th className="w-6" />
              <th className="font-normal py-1 pr-3">{t('validation.column.id')}</th>
              <th className="font-normal py-1 pr-3">{t('validation.column.title')}</th>
              {visible.map(c => <th key={c.key} className="font-normal py-1 pr-3">{c.label}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const isOpen = open.has(row.requirementId)
              return (
                <Fragment key={row.requirementId}>
                  <tr className="border-b border-edge-subtle align-top" data-testid={`validation-row-${row.requirementId}`}>
                    <td className="py-1">
                      <button type="button" className="text-ink-3 hover:text-ink" aria-expanded={isOpen} aria-label={row.requirementId} data-testid={`validation-toggle-${row.requirementId}`}
                        onClick={() => setOpen(s => { const n = new Set(s); if (!n.delete(row.requirementId)) n.add(row.requirementId); return n })}>
                        {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </button>
                    </td>
                    <td className="py-1 pr-3 whitespace-nowrap">
                      <button type="button" className="font-mono text-prim hover:underline" onClick={() => void navigate({ to: '/req/$reqId', params: { reqId: row.requirementId }, search: { projectId, repoPath } as never })}>{row.requirementId}</button>
                    </td>
                    <td className="py-1 pr-3 text-ink">{row.title}</td>
                    {visible.map(c => <td key={c.key} className="py-1 pr-3">{cell(row, c.key)}</td>)}
                    <td className="py-1 whitespace-nowrap text-right">
                      {row.entry?.proposed && <span className="text-[10px] px-1.5 rounded bg-status-info-bg text-status-info mr-1" data-testid={`validation-proposed-${row.requirementId}`}>{t('validation.proposed', { by: row.entry.proposedBy })}</span>}
                      {!row.entry?.proposed && row.review && <span className="text-[10px] px-1.5 rounded bg-status-warning-bg text-status-warning mr-1" data-testid={`validation-review-${row.requirementId}`}>{t(`validation.review.${row.review}`)}</span>}
                      {editable && (row.review || row.entry?.proposed) && <button type="button" className="btn-secondary-sm" data-testid={`validation-confirm-${row.requirementId}`} onClick={() => void confirm(row)}>{t('validation.confirm')}</button>}
                      {editable && row.entry?.proposed && <button type="button" className="btn-secondary-sm ml-1" data-testid={`validation-reject-${row.requirementId}`} onClick={() => void run(() => api.validations.reject(repoPath, validation.id, row.requirementId, workspaceDir))}>{t('validation.reject')}</button>}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-edge">
                      <td />
                      <td colSpan={visible.length + 3} className="py-2 pr-3">
                        <div className="flex flex-col gap-3">
                          {(typeDef.entryFields ?? []).length > 0 && (
                            <EntryFieldsForm
                              fields={typeDef.entryFields!}
                              values={row.entry?.fields ?? {}}
                              disabled={!editable || row.decision === pending}
                              repoPath={repoPath}
                              testId={`validation-entry-${row.requirementId}`}
                              onSave={fields => void decide(row, row.decision, { fields })}
                            />
                          )}
                          <ValidationRuns repoPath={repoPath} projectId={projectId} workspaceDir={workspaceDir} requirementId={row.requirementId} tests={row.tests} versionId={validation.versionId} signedAt={signedAt} />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      {proposing && (
        <IssueProposalDialog
          repoPath={repoPath}
          workspaceDir={workspaceDir}
          origin={{ kind: 'decision', ref: `${validation.id}/${proposing.requirementId}`, requirementId: proposing.requirementId, decisionLabel: proposing.decisionLabel }}
          onClose={() => setProposing(null)}
        />
      )}
    </div>
  )
}

function CommentInput({ value, testId, onCommit }: { value: string; testId: string; onCommit: (comment: string) => void }) {
  const [text, setText] = useState(value)
  return (
    <input
      value={text}
      onChange={e => setText(e.target.value)}
      onBlur={() => { if (text !== value) onCommit(text) }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
      className="input-field text-xs py-0.5 w-full min-w-40"
      data-testid={testId}
    />
  )
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

function ColumnsMenu({ available, shown, onChange }: { available: { key: string; label: string }[]; shown: string[]; onChange: (next: string[]) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="btn-icon" title={t('validation.columns')} aria-label={t('validation.columns')} aria-expanded={open} onClick={() => setOpen(v => !v)} data-testid="validation-columns">
        <Eye size={14} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 bg-surface border border-edge rounded shadow-lg z-20 py-1 w-56 max-h-80 overflow-y-auto">
          {available.map(c => (
            <label key={c.key} className="flex items-center gap-2 px-3 py-1 text-xs text-ink-2 hover:bg-hover">
              <input type="checkbox" checked={shown.includes(c.key)} data-testid={`validation-column-${c.key}`}
                onChange={e => onChange(e.target.checked ? [...shown, c.key] : shown.filter(k => k !== c.key))} />
              {c.label}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
