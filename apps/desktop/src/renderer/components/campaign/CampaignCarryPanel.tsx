import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ElementLink } from '../element/ElementLink'
import { ElementLinks } from '../element/ElementLinks'
import { DataGrid } from '../grid/DataGrid'
import type { GridColumn } from '../grid/gridTypes'
import { useGridScrollKey } from '../grid/useGridScrollKey'
import type { ProjectSchema, TestCampaign, TestCase, TestRunStatus } from '@polenta/types'
import { CARRY_STATUSES, versionChanged, type CarryRow } from '../../lib/carryOver'
import { CAMPAIGN_STATUS_CLASS, RUN_STATUS_CLASS, RUN_STATUS_LABEL_KEY } from '../../lib/runStatus'
import { isTestApproved } from '../../hooks/useProjectSchema'
import { NotApprovedBadge } from './NotApproved'
import { unapprovedCarriedTest } from '../../lib/campaignApproval'

const DEFAULTS = ['test', 'title', 'requirement', 'params', 'status', 'execution', 'source', 'remark']
/** Ligne d'une entrée source : une seule ligne par entrée (les doublons sont regroupés par clé). */
const carryRowId = (r: CarryRow) => `${r.campaignId}/${r.entryId}`
const isAvailable = (r: CarryRow) => !r.unavailable
const rowClassName = (r: CarryRow) => (r.unavailable ? 'opacity-50' : undefined)

/**
 * GH64 — onglet « Depuis une campagne » du sélecteur de tests : campagnes source, filtre par statut
 * d'entrée, entrées proposées (cochées / grisées avec leur motif). Composant contrôlé : l'état (et
 * le calcul des lignes, qui dépend de la résolution des paramètres) vit dans `TestPickerModal`.
 */
export function CampaignCarryPanel({
  repoPath,
  campaigns,
  isLoading,
  sources,
  onSourcesChange,
  statuses,
  onStatusesChange,
  rows,
  checked,
  onCheckedChange,
  testsById,
  schema,
}: {
  /** Repo des préférences de colonnes de la grille (`grid::campaign-carry`). */
  repoPath: string
  /** Campagnes proposées (sans la cible), plus récente d'abord. */
  campaigns: TestCampaign[]
  isLoading: boolean
  sources: Set<string>
  onSourcesChange: (next: Set<string>) => void
  statuses: Set<TestRunStatus>
  onStatusesChange: (next: Set<TestRunStatus>) => void
  rows: CarryRow[]
  checked: Set<string>
  onCheckedChange: (next: Set<string>) => void
  testsById: Map<string, TestCase>
  /** GH68 — pour signaler un test non approuvé (reportable, mais signalé). */
  schema: ProjectSchema | undefined
}) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState('')
  const scrollKey = useGridScrollKey('campaign-carry')

  const rowFilter = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return undefined
    return (r: CarryRow) =>
      [r.testCaseId, testsById.get(r.testCaseId)?.title ?? '', r.requirementId ?? '', r.campaignId]
        .some(v => v.toLowerCase().includes(q))
  }, [filter, testsById])

  // Sélection de la grille = ID de ligne (`campagne/entrée`) ; cases du sélecteur = clé de doublon.
  // Une clé cochée absente des lignes (statut filtré) reste cochée.
  const selected = useMemo(() => new Set(rows.filter(r => !r.unavailable && checked.has(r.key)).map(carryRowId)), [rows, checked])
  const changeSelected = (next: Set<string>) => {
    const keys = new Set([...checked].filter(k => !rows.some(r => r.key === k)))
    for (const r of rows) if (!r.unavailable && next.has(carryRowId(r))) keys.add(r.key)
    onCheckedChange(keys)
  }

  const toggle = <T,>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    return next
  }

  const columns = useMemo<GridColumn<CarryRow>[]>(() => {
    const unapprovedOf = (r: CarryRow) => unapprovedCarriedTest(testsById.get(r.testCaseId), tc => isTestApproved(tc, schema))
    const execution = (r: CarryRow) => [r.executedAt?.slice(0, 10), r.executedBy].filter(Boolean).join(' · ')
    const params = (r: CarryRow) => Object.entries(r.paramValues).filter(([, v]) => v.trim()).map(([k, v]) => `${k}=${v}`).join(', ')
    const remarkParts = (r: CarryRow) => [
      r.unavailable ? t(`campaignPage.carry.unavailable.${r.unavailable}`) : '',
      versionChanged(r) ? t('campaignPage.carry.versionChanged', { from: r.sourceVersion, to: r.liveVersion }) : '',
    ].filter(Boolean).join(' · ')
    const remark = (r: CarryRow) => [
      remarkParts(r),
      r.otherSources.length > 0 ? t('campaignPage.carry.alsoIn', { ids: r.otherSources.join(', ') }) : '',
    ].filter(Boolean).join(' · ')
    return [
      {
        key: 'test', label: t('campaignPage.carry.colTest'), locked: true,
        getText: r => r.testCaseId,
        render: r => <ElementLink id={r.testCaseId} className="font-mono text-prim" />,
        elementId: r => r.testCaseId,
      },
      {
        key: 'title', label: t('campaignPage.columns.title'),
        getText: r => [testsById.get(r.testCaseId)?.title ?? '', unapprovedOf(r) ? t('campaignPage.notApproved') : ''].filter(Boolean).join(' '),
        render: r => {
          const unapproved = unapprovedOf(r)
          return <>{testsById.get(r.testCaseId)?.title ?? ''}{unapproved && <NotApprovedBadge test={unapproved} schema={schema} />}</>
        },
      },
      {
        key: 'requirement', label: t('campaignPage.carry.colRequirement'),
        getText: r => r.requirementId ?? '',
        render: r => r.requirementId && <ElementLink id={r.requirementId} className="font-mono text-prim" />,
        elementId: r => r.requirementId,
      },
      {
        key: 'params', label: t('campaignPage.carry.colParams'),
        getText: params,
        render: r => <span className="font-mono text-[10px] text-ink-3">{params(r)}</span>,
      },
      {
        key: 'status', label: t('campaignPage.carry.colStatus'),
        getText: r => t(RUN_STATUS_LABEL_KEY[r.status]),
        render: r => <span className={`px-1.5 py-0.5 rounded-full text-[10px] whitespace-nowrap ${RUN_STATUS_CLASS[r.status]}`}>{t(RUN_STATUS_LABEL_KEY[r.status])}</span>,
      },
      {
        key: 'execution', label: t('campaignPage.carry.colExecution'),
        getText: execution,
        render: r => <span className="text-[10px] text-ink-3 whitespace-nowrap">{execution(r)}</span>,
      },
      {
        key: 'source', label: t('campaignPage.carry.colSource'),
        getText: r => r.campaignId,
        render: r => <ElementLink id={r.campaignId} className="font-mono text-prim" />,
        elementId: r => r.campaignId,
      },
      {
        key: 'remark', label: t('campaignPage.carry.colRemark'),
        getText: remark,
        render: r => {
          // « aussi dans » : ID des autres campagnes source en liens d'élément.
          const [before, after = ''] = t('campaignPage.carry.alsoIn', { ids: '\u0000' }).split('\u0000')
          const parts = remarkParts(r)
          return (
            <span className={`text-[10px] ${r.unavailable ? 'text-ink-3' : 'text-status-warning'}`}>
              {parts}
              {r.otherSources.length > 0 && <>{parts && ' · '}{before}<ElementLinks ids={r.otherSources} className="font-mono" />{after}</>}
            </span>
          )
        },
      },
    ]
  }, [t, testsById, schema])
  const prefs = useMemo(() => ({ repoPath, prefKey: 'grid::campaign-carry', view: 'columns', defaults: DEFAULTS }), [repoPath])

  const statusBar = (
    <>
      <span className="text-xs text-ink-2">{t('campaignPage.carry.statusFilter')}</span>
      {CARRY_STATUSES.map(s => (
        <label key={s} className="flex items-center gap-1 text-xs text-ink-2">
          <input type="checkbox" checked={statuses.has(s)} onChange={() => onStatusesChange(toggle(statuses, s))} />
          {t(`campaignPage.runStatus.${s.toLowerCase()}`)}
        </label>
      ))}
      <input
        type="text"
        value={filter}
        onChange={e => setFilter(e.target.value)}
        placeholder={t('common.filterPlaceholder')}
        className="input-field text-xs min-w-[10rem]"
        data-testid="carry-filter"
      />
    </>
  )

  return (
    <div className="flex-1 min-h-0 flex">
      {/* Campagnes source */}
      <div className="w-72 shrink-0 border-r border-edge flex flex-col min-h-0">
        <p className="px-3 py-2 text-xs font-medium text-ink-2 border-b border-edge">{t('campaignPage.carry.sources')}</p>
        <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-edge" data-testid="carry-sources">
          {isLoading ? (
            <p className="p-3 text-xs text-ink-3 italic">{t('common.loading')}</p>
          ) : campaigns.length === 0 ? (
            <p className="p-3 text-xs text-ink-3 italic">{t('campaignPage.carry.noCampaign')}</p>
          ) : campaigns.map(c => (
            <label key={c.id} className="flex items-start gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-hover/50">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={sources.has(c.id)}
                onChange={() => onSourcesChange(toggle(sources, c.id))}
                aria-label={c.id}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="font-mono text-ink-3">{c.id}</span>
                  <span className={`px-1.5 rounded-full text-[10px] ${CAMPAIGN_STATUS_CLASS[c.status] ?? ''}`}>
                    {t(`campaignPage.carry.campaignStatus.${c.status}`)}
                  </span>
                </span>
                <span className="block text-ink truncate">{c.title}</span>
                <span className="block text-[10px] text-ink-3">
                  {[c.createdAt.slice(0, 10), c.component, c.level].filter(Boolean).join(' · ')}
                </span>
                {c.runs.length > 0 && (
                  <span className="flex gap-1 mt-0.5 text-[10px]">
                    {CARRY_STATUSES.map(s => {
                      const n = c.runs.filter(r => r.status === s).length
                      return n ? <span key={s} className={`px-1.5 rounded-full ${RUN_STATUS_CLASS[s]}`}>{n}</span> : null
                    })}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Entrées — GH389 §4 : grille commune à cases ; le filtre texte de l'écran reste. */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0 px-4 py-2">
        {rows.length === 0 ? (
          <>
            {statusBar}
            <p className="p-4 text-xs text-ink-3 italic">
              {sources.size === 0 ? t('campaignPage.carry.pickSource') : t('campaignPage.carry.noEntry')}
            </p>
          </>
        ) : (
          <div className="flex flex-col flex-1 min-h-0" data-testid="carry-rows">
            <DataGrid
              gridId="campaign-carry"
              title={t('campaignPage.carry.gridTitle')}
              rows={rows}
              getRowId={carryRowId}
              columns={columns}
              prefs={prefs}
              toolbarStart={statusBar}
              rowFilter={rowFilter}
              selection={{ mode: 'checkbox', selected, onChange: changeSelected, isSelectable: isAvailable }}
              rowClassName={rowClassName}
              scrollMemoryKey={scrollKey}
              layer="modal"
            />
          </div>
        )}
      </div>
    </div>
  )
}
