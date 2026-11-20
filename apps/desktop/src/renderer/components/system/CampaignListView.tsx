import { useCallback, useMemo, useRef } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../api'
import type { TestCampaign, TestRunStatus } from '@polenta/types'
import { useSystemView } from '../../contexts/SystemViewContext'
import { buildFilterRegex } from '../../lib/textFilter'
import { CAMPAIGN_STATUS_CLASS, RUN_STATUS_CLASS, RUN_STATUS_LABEL_KEY } from '../../lib/runStatus'
import { ElementLink } from '../element/ElementLink'
import { ElementLinks } from '../element/ElementLinks'
import { DataGrid } from '../grid/DataGrid'
import type { GridColumn } from '../grid/gridTypes'
import { useGridScrollKey } from '../grid/useGridScrollKey'

const RUN_STATUSES: TestRunStatus[] = ['PASS', 'FAIL', 'BLOCKED', 'INCOMPLETE', 'pending']
const DEFAULTS = ['id', 'status', 'title', 'tests', 'runs']
const campaignId = (c: TestCampaign) => c.id
/** Tests de la campagne, chacun une fois (un test paramétré peut avoir plusieurs instances). */
const testIdsOf = (c: TestCampaign) => [...new Set(c.testCaseIds)]

interface Props {
  repoPath: string
  component?: string
  level?: string
}

/**
 * Liste des campagnes d'un type (vue système). GH389 §4 : grille commune (`DataGrid`) — ID, statut,
 * titre, tests (liens d'élément), nombre d'entrées par statut ; le filtre global de la vue système
 * se combine aux filtres de colonne. Double-clic / Entrée ou clic sur l'ID : ouvre la campagne.
 */
export function CampaignListView({ repoPath, component, level }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { searchStr } = useRouterState({ select: s => ({ searchStr: s.location.searchStr }) })
  const projectId = new URLSearchParams(searchStr ?? '').get('projectId') ?? ''
  const { filter, filterOptions } = useSystemView()
  const scrollKey = useGridScrollKey('campaign-list')

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ['campaigns', repoPath, component, level],
    queryFn: () => api.campaigns.list(repoPath, component, level),
    enabled: !!repoPath,
  })

  const rowFilter = useMemo(() => {
    const filterRe = buildFilterRegex(filter, filterOptions)
    if (!filterRe) return undefined
    return (c: TestCampaign) =>
      filterRe.test(c.id) ||
      filterRe.test(c.title) ||
      filterRe.test(c.status) ||
      Object.values(c.fields ?? {}).some(v => typeof v === 'string' && filterRe.test(v))
  }, [filter, filterOptions])

  const openCampaign = (id: string) => navigate({
    to: '/campaign/$campaignId',
    params: { campaignId: id },
    search: { repoPath, projectId, component, level },
  })
  const newCampaign = () => navigate({
    to: '/campaign/new',
    search: { repoPath, projectId, component, level, title: undefined, testCaseIds: undefined },
  })
  const gestures = useRef({ openCampaign })
  gestures.current = { openCampaign }
  const onActivate = useCallback((c: TestCampaign) => void gestures.current.openCampaign(c.id), [])

  const columns = useMemo<GridColumn<TestCampaign>[]>(() => {
    const statusLabel = (c: TestCampaign) => t(`campaignPage.carry.campaignStatus.${c.status}`, { defaultValue: c.status })
    const runCounts = (c: TestCampaign) => RUN_STATUSES
      .map(s => ({ s, n: c.runs.filter(r => r.status === s).length }))
      .filter(x => x.n > 0)
    return [
      {
        key: 'id', label: t('system.campaignListView.colId'), locked: true,
        getText: c => c.id,
        render: c => <ElementLink id={c.id} className="font-mono text-prim" />,
        elementId: c => c.id,
      },
      {
        key: 'status', label: t('system.campaignListView.colStatus'),
        getText: statusLabel,
        render: c => (
          <span className={`px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap ${CAMPAIGN_STATUS_CLASS[c.status] ?? CAMPAIGN_STATUS_CLASS['planned']}`}>
            {statusLabel(c)}
          </span>
        ),
      },
      { key: 'title', label: t('system.campaignListView.colTitle'), getText: c => c.title },
      {
        key: 'tests', label: t('system.campaignListView.colTests'),
        getText: c => (c.testCaseIds.length > 0 ? testIdsOf(c).join(', ') : t('system.campaignListView.noTest')),
        render: c => (c.testCaseIds.length > 0
          ? <ElementLinks ids={testIdsOf(c)} />
          : <span className="italic text-ink-3">{t('system.campaignListView.noTest')}</span>),
      },
      {
        key: 'runs', label: t('system.campaignListView.colRuns'),
        getText: c => runCounts(c).map(({ s, n }) => `${n} ${t(RUN_STATUS_LABEL_KEY[s])}`).join(' · '),
        render: c => (
          <span className="inline-flex flex-wrap gap-1 text-[10px]">
            {runCounts(c).map(({ s, n }) => (
              <span key={s} className={`px-1.5 py-0.5 rounded-full whitespace-nowrap ${RUN_STATUS_CLASS[s]}`}>{n} {t(RUN_STATUS_LABEL_KEY[s])}</span>
            ))}
          </span>
        ),
      },
    ]
  }, [t])
  const prefs = useMemo(() => ({ repoPath, prefKey: 'grid::campaign-list', view: 'columns', defaults: DEFAULTS }), [repoPath])

  if (isLoading) {
    return <div className="p-6 text-sm text-ink-3">{t('common.loading')}</div>
  }

  const newButton = (
    <button type="button" onClick={() => void newCampaign()} className="text-xs bg-ink text-prim-fg px-3 py-1.5 rounded hover:opacity-90" data-testid="campaign-list-new">
      + {t('system.campaignListView.newCampaign')}
    </button>
  )

  if (campaigns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-16">
        <p className="text-sm text-ink-3">{t('sidebar.system.noCampaign')}</p>
        <button type="button" onClick={() => void newCampaign()} className="mt-3 text-xs text-prim hover:underline">
          {t('system.campaignListView.createFirst')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0 p-4" data-testid="campaign-list">
      <DataGrid
        gridId="campaign-list"
        title={t('system.campaignListView.title')}
        rows={campaigns}
        getRowId={campaignId}
        columns={columns}
        prefs={prefs}
        toolbarStart={newButton}
        rowFilter={rowFilter}
        onActivate={onActivate}
        scrollMemoryKey={scrollKey}
      />
    </div>
  )
}
