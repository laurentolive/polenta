import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Copy, Eye, Pencil, Play, Trash2 } from 'lucide-react'
import type { CampaignTestRun, ParamResolutionPreview, ProjectSchema, TestCampaign, TestCase, TestRunStatus } from '@polenta/types'
import { ElementLink } from '../element/ElementLink'
import { DataGrid } from '../grid/DataGrid'
import type { GridColumn } from '../grid/gridTypes'
import { useGridScrollKey } from '../grid/useGridScrollKey'
import { TestParamFields } from '../TestParamFields'
import { NotApprovedBadge } from './NotApproved'
import { manualKeysForRun } from '../../lib/testParams'
import { resolveRunTest } from '../../lib/campaignTests'
import { unapprovedTestOf } from '../../lib/campaignApproval'
import { RUN_STATUS_CLASS, RUN_STATUS_LABEL_KEY } from '../../lib/runStatus'

/** Ordre d'affichage des pastilles ; valeurs = statuts d'entrée de `TEST_RUN_STATUS_LABELS`. */
const RUN_STATUSES: TestRunStatus[] = ['PASS', 'FAIL', 'BLOCKED', 'INCOMPLETE', 'pending']
const DEFAULTS = ['test', 'title', 'requirement', 'carried', 'params', 'status', 'actions']

type ReqPreview = NonNullable<ParamResolutionPreview['requirements']>[number]

/** Une entrée de la campagne, avec ce qu'il faut pour l'afficher et l'éditer. */
interface EntryRow {
  run: CampaignTestRun
  /** Test figé de l'entrée (`testSnapshot`), ou test actuel en repli. */
  tc: TestCase | undefined
  /** Références à saisir de cette instance (les valeurs lues dans la base sont figées). */
  manualKeys: string[]
  /** État actuel du test : « Dupliquer » crée une instance sur ses paramètres actuels. */
  liveTc: TestCase | undefined
  liveManualKeys: string[]
  /** T179 — valeurs `{req.<champ>}` actuelles de l'exigence de l'instance (duplicata). */
  liveReq: ReqPreview | undefined
  canDuplicate: boolean
  unapproved: TestCase | undefined
}

type OpenForm = { entryId: string; mode: 'params' | 'duplicate' }

const entryIdOf = (r: EntryRow) => r.run.entryId
const paramsText = (run: CampaignTestRun) =>
  Object.entries(run.paramValues ?? {}).map(([label, value]) => `${label}=${value}`).join(' · ')

/**
 * GH389 §4 — entrées d'une campagne sur la grille commune (`DataGrid`) : test, titre, exigence,
 * campagne d'origine d'un report, paramètres, statut, puis actions (dupliquer, paramètres, voir,
 * exécuter, retirer). Pastilles de statut = filtre de l'écran (GH65), en tête de barre d'outils ;
 * saisie des paramètres et duplicata dans la ligne dépliée.
 */
export function CampaignEntriesGrid({
  campaign, isActive, repoPath, testMap, paramPreviews, schema, isApproved, statusFilter, onStatusFilter,
  onView, onExecute, onRemove, removing, onSaveParams, savingParams, onDuplicate, duplicating,
}: {
  campaign: TestCampaign
  isActive: boolean
  repoPath: string
  testMap: Map<string, TestCase>
  paramPreviews: Map<string, ParamResolutionPreview>
  schema: ProjectSchema | undefined
  isApproved: (tc: TestCase) => boolean
  statusFilter: TestRunStatus | undefined
  onStatusFilter: (status: TestRunStatus | undefined) => void
  onView: (entryId: string) => void
  onExecute: (entryId: string) => void
  onRemove: (entryId: string) => void
  removing: boolean
  onSaveParams: (entryId: string, values: Record<string, string>) => Promise<unknown>
  savingParams: boolean
  onDuplicate: (args: { testCaseId: string; paramValues: Record<string, string>; requirementId?: string }) => Promise<unknown>
  duplicating: boolean
}) {
  const { t } = useTranslation()
  const scrollKey = useGridScrollKey('campaign-entries')
  const [open, setOpen] = useState<OpenForm | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})

  const rows = useMemo<EntryRow[]>(() => campaign.runs.map(run => {
    const tc = resolveRunTest(run, testMap)
    const liveTc = testMap.get(run.testCaseId)
    const liveManualKeys = paramPreviews.get(run.testCaseId)?.manual ?? []
    const liveReq = run.requirementId
      ? paramPreviews.get(run.testCaseId)?.requirements?.find(r => r.requirementId === run.requirementId)
      : undefined
    return {
      run, tc, liveTc, liveManualKeys, liveReq,
      manualKeys: tc ? manualKeysForRun(run, tc) : [],
      // T179 — exigence plus liée : pas de duplicata possible pour elle.
      canDuplicate: isActive && liveManualKeys.length > 0 && (!run.requirementId || !!liveReq),
      unapproved: unapprovedTestOf(run, liveTc, isActive, isApproved),
    }
  }), [campaign.runs, testMap, paramPreviews, isActive, isApproved])

  const openForm = useCallback((entryId: string, mode: OpenForm['mode'], initial: Record<string, string>) => {
    setOpen(prev => (prev?.entryId === entryId && prev.mode === mode ? null : { entryId, mode }))
    setValues(initial)
  }, [])
  // Gestes des cellules lus par une ref : colonnes stables (cellules mémoïsées).
  const gestures = useRef({ onView, onExecute, onRemove, openForm })
  gestures.current = { onView, onExecute, onRemove, openForm }

  const columns = useMemo<GridColumn<EntryRow>[]>(() => {
    const titleText = (r: EntryRow) => [
      r.tc?.title ?? '',
      r.unapproved ? t('campaignPage.notApproved') : '',
      r.run.unresolvedParams?.length ? t('campaignParams.unresolvedCount', { count: r.run.unresolvedParams.length }) : '',
    ].filter(Boolean).join(' ')
    return [
      {
        key: 'test', label: t('campaignPage.columns.test'), locked: true,
        getText: r => r.run.testCaseId,
        render: r => <ElementLink id={r.run.testCaseId} className="font-mono text-prim whitespace-nowrap" />,
        elementId: r => r.run.testCaseId,
      },
      {
        key: 'title', label: t('campaignPage.columns.title'),
        getText: titleText,
        render: r => (
          <>
            {r.tc?.title}
            {r.unapproved && <NotApprovedBadge test={r.unapproved} schema={schema} />}
            {(r.run.unresolvedParams?.length ?? 0) > 0 && (
              <span
                className="ml-2 inline-flex items-center gap-0.5 text-[10px] text-status-warning"
                title={r.run.unresolvedParams!.map(u => `{${u.ref}} — ${t(`campaignParams.reason.${u.reason}`)}`).join('\n')}
              >
                <AlertTriangle size={11} />{t('campaignParams.unresolvedCount', { count: r.run.unresolvedParams!.length })}
              </span>
            )}
          </>
        ),
      },
      {
        key: 'requirement', label: t('campaignPage.columns.requirement'),
        getText: r => r.run.requirementId ?? '',
        render: r => r.run.requirementId && <ElementLink id={r.run.requirementId} className="font-mono text-prim" />,
        elementId: r => r.run.requirementId,
      },
      {
        // GH64 — instance reportée depuis une autre campagne.
        key: 'carried', label: t('campaignPage.columns.carried'),
        getText: r => r.run.carriedFrom?.campaignId ?? '',
        render: r => r.run.carriedFrom && (
          <span
            title={t('campaignPage.carriedFrom', { campaignId: r.run.carriedFrom.campaignId, entryId: r.run.carriedFrom.entryId })}
            className="font-mono text-ink-3"
          >
            ↩ <ElementLink id={r.run.carriedFrom.campaignId} className="text-prim" />
          </span>
        ),
        elementId: r => r.run.carriedFrom?.campaignId,
      },
      {
        key: 'params', label: t('campaignPage.columns.params'),
        getText: r => paramsText(r.run),
        render: r => <span className="font-mono text-[10px] text-ink-3">{paramsText(r.run)}</span>,
      },
      {
        key: 'status', label: t('campaignPage.columns.status'),
        getText: r => t(RUN_STATUS_LABEL_KEY[r.run.status]),
        render: r => (
          <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${RUN_STATUS_CLASS[r.run.status]}`}>
            {t(RUN_STATUS_LABEL_KEY[r.run.status])}
          </span>
        ),
      },
      {
        key: 'actions', label: t('campaignPage.columns.actions'), filterable: false,
        getText: () => '',
        render: r => {
          const { entryId, runId } = r.run
          return (
            <span className="inline-flex items-center gap-1 flex-wrap" data-cell-dblclick-ignore onDoubleClick={e => e.stopPropagation()}>
              {r.canDuplicate && (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); gestures.current.openForm(entryId, 'duplicate', {}) }}
                  title={t('campaignPage.addAnotherInstance')}
                  className="text-ink-3 hover:text-ink p-1 rounded hover:bg-hover"
                  data-testid={`campaign-entries-duplicate-${entryId}`}
                >
                  <Copy size={12} />
                </button>
              )}
              {r.manualKeys.length > 0 && (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); gestures.current.openForm(entryId, 'params', { ...(r.run.paramValues ?? {}) }) }}
                  title={t('campaignPage.editParamValues')}
                  className="text-ink-3 hover:text-ink p-1 rounded hover:bg-hover"
                  data-testid={`campaign-entries-params-${entryId}`}
                >
                  <Pencil size={12} />
                </button>
              )}
              {(runId || !isActive) && (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); gestures.current.onView(entryId) }}
                  title={t('campaignPage.viewResult')}
                  className="flex items-center gap-1 text-xs text-ink-3 hover:text-ink border border-edge rounded px-2 py-0.5 hover:bg-hover transition-colors"
                >
                  <Eye size={11} />
                  {t('campaignPage.view')}
                </button>
              )}
              {isActive && (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); gestures.current.onExecute(entryId) }}
                  title={t('campaignPage.executeThisTest')}
                  className="flex items-center gap-1 text-xs text-status-info hover:opacity-80 border border-status-info-border rounded px-2 py-0.5 hover:bg-status-info-bg transition-colors"
                >
                  <Play size={11} />
                  {t('campaignPage.execute')}
                </button>
              )}
              {isActive && (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); gestures.current.onRemove(entryId) }}
                  disabled={removing}
                  title={t('campaignPage.removeTestFromCampaign')}
                  className="text-ink-3 hover:text-status-danger p-1 rounded hover:bg-status-danger-bg transition-colors disabled:opacity-50"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </span>
          )
        },
      },
    ]
  }, [t, schema, isActive, removing])

  const prefs = useMemo(() => ({ repoPath, prefKey: 'grid::campaign-entries', view: 'columns', defaults: DEFAULTS }), [repoPath])
  const rowFilter = useMemo(() => (statusFilter ? (r: EntryRow) => r.run.status === statusFilter : undefined), [statusFilter])
  const canExpand = useCallback((r: EntryRow) => r.manualKeys.length > 0 || r.canDuplicate, [])
  const rowById = useMemo(() => new Map(rows.map(r => [r.run.entryId, r])), [rows])
  // Formulaire ouvert sur une entrée disparue (retirée, relue) : fermé.
  const current = open && rowById.has(open.entryId) ? open : null
  const expanded = useMemo(() => new Set(current ? [current.entryId] : []), [current])
  // Chevron, ←/→ : paramètres de l'entrée s'il y en a, sinon duplicata.
  const toggleExpanded = useCallback((entryId: string) => {
    const r = rowById.get(entryId)
    if (!r) return
    if (open?.entryId === entryId) { setOpen(null); return }
    if (r.manualKeys.length > 0) openForm(entryId, 'params', { ...(r.run.paramValues ?? {}) })
    else openForm(entryId, 'duplicate', {})
  }, [rowById, open, openForm])
  const onActivate = useCallback((r: EntryRow) => gestures.current.onView(r.run.entryId), [])

  const renderExpanded = (r: EntryRow) => {
    if (!current || current.entryId !== r.run.entryId) return null
    const close = () => { setOpen(null); setValues({}) }
    const set = (label: string, value: string) => setValues(prev => ({ ...prev, [label]: value }))
    if (current.mode === 'params') {
      return (
        <div data-testid={`campaign-entries-form-${r.run.entryId}`}>
          <TestParamFields labels={r.manualKeys} values={values} onChange={set} />
          <div className="flex gap-2 pl-8">
            <button type="button" onClick={close} className="text-xs text-ink-3 hover:text-ink">{t('common.cancel')}</button>
            <button
              type="button"
              onClick={() => void onSaveParams(r.run.entryId, values).then(close, () => {})}
              disabled={savingParams || r.manualKeys.some(label => !values[label]?.trim())}
              className="btn-primary-sm"
            >
              {savingParams ? t('campaignPage.saving') : t('common.save')}
            </button>
          </div>
        </div>
      )
    }
    const preview = paramPreviews.get(r.run.testCaseId)
    return (
      <div data-testid={`campaign-entries-form-${r.run.entryId}`}>
        <p className="pl-6 text-[11px] text-ink-3 mb-1">{t('campaignPage.newInstanceOf', { tcId: r.run.testCaseId })}</p>
        <TestParamFields
          labels={r.liveManualKeys}
          resolved={{ ...preview?.resolved, ...r.liveReq?.resolved }}
          unresolved={[...(preview?.unresolved ?? []), ...(r.liveReq?.unresolved ?? [])]}
          values={values}
          onChange={set}
        />
        <div className="flex gap-2 pl-8">
          <button type="button" onClick={close} className="text-xs text-ink-3 hover:text-ink">{t('common.cancel')}</button>
          <button
            type="button"
            onClick={() => void onDuplicate({ testCaseId: r.run.testCaseId, paramValues: values, requirementId: r.run.requirementId }).then(close, () => {})}
            disabled={duplicating || r.liveManualKeys.some(label => !values[label]?.trim())}
            className="btn-primary-sm"
          >
            {duplicating ? t('campaignPage.adding') : t('campaignPage.duplicate')}
          </button>
        </div>
      </div>
    )
  }

  const filterLabel = statusFilter ? t(RUN_STATUS_LABEL_KEY[statusFilter]) : ''
  const pastilles = (
    <>
      {RUN_STATUSES.map(s => {
        const count = campaign.runs.filter(r => r.status === s).length
        const active = statusFilter === s
        if (count === 0 && !active) return null
        // GH65 — pastille = filtre par statut brut (re-clic : retiré).
        return (
          <button
            key={s}
            type="button"
            aria-pressed={active}
            data-status={s}
            onClick={() => onStatusFilter(active ? undefined : s)}
            title={t('campaignPage.statusFilter.toggle', { status: t(RUN_STATUS_LABEL_KEY[s]) })}
            className={`text-xs px-2 py-0.5 rounded-full ${RUN_STATUS_CLASS[s]} ${active ? 'ring-2 ring-offset-1 ring-status-info' : statusFilter ? 'opacity-50 hover:opacity-100' : 'hover:brightness-95'}`}
          >
            {count} {t(RUN_STATUS_LABEL_KEY[s])}
          </button>
        )
      })}
      {statusFilter && (
        <button type="button" onClick={() => onStatusFilter(undefined)} className="text-xs text-ink-3 hover:text-ink underline" data-testid="campaign-status-filter-clear">
          {t('campaignPage.statusFilter.clear', { status: filterLabel })}
        </button>
      )}
    </>
  )

  return (
    <div className="flex flex-col max-h-[70vh] min-h-0 mb-3" data-testid="campaign-entries">
      <DataGrid
        gridId="campaign-entries"
        title={t('campaignPage.entriesTitle', { id: campaign.id })}
        rows={rows}
        getRowId={entryIdOf}
        columns={columns}
        prefs={prefs}
        toolbarStart={pastilles}
        rowFilter={rowFilter}
        onActivate={onActivate}
        renderExpanded={renderExpanded}
        canExpand={canExpand}
        expanded={expanded}
        onToggleExpanded={toggleExpanded}
        scrollMemoryKey={scrollKey}
      />
    </div>
  )
}
