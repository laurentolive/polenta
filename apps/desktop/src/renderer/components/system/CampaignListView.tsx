import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../api'
import type { TestRunStatus } from '@polenta/types'
import { useSystemView } from '../../contexts/SystemViewContext'
import { buildFilterRegex } from '../../lib/textFilter'

const STATUS_CLASS: Record<string, string> = {
  planned:     'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-400',
  completed:   'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-400',
  abandoned:   'bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-400',
}

const RUN_CLASS: Partial<Record<TestRunStatus, string>> = {
  PASS:       'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  FAIL:       'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  BLOCKED:    'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  INCOMPLETE: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  pending:    'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
}

interface Props {
  repoPath: string
  component?: string
  level?: string
}

export function CampaignListView({ repoPath, component, level }: Props) {
  const navigate = useNavigate()
  const { searchStr } = useRouterState({ select: s => ({ searchStr: s.location.searchStr }) })
  const sp = new URLSearchParams(searchStr ?? '')
  const projectId = sp.get('projectId') ?? ''
  const { filter, filterOptions } = useSystemView()

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ['campaigns', repoPath, component, level],
    queryFn: () => api.campaigns.list(repoPath, component, level),
    enabled: !!repoPath,
  })

  const filterRe = buildFilterRegex(filter, filterOptions)
  const visibleCampaigns = filterRe
    ? campaigns.filter(c =>
        filterRe.test(c.id) ||
        filterRe.test(c.title) ||
        filterRe.test(c.status) ||
        Object.values(c.fields ?? {}).some(v => typeof v === 'string' && filterRe.test(v)),
      )
    : campaigns

  const { data: tests = [] } = useQuery({
    queryKey: ['tests', repoPath],
    queryFn: () => api.tests.list(repoPath),
    enabled: !!repoPath,
  })

  const testMap = new Map(tests.map(t => [t.id, t]))

  function openCampaign(campaignId: string) {
    navigate({
      to: '/campaign/$campaignId',
      params: { campaignId },
      search: { repoPath, projectId, component, level },
    })
  }

  function newCampaign() {
    navigate({
      to: '/campaign/new',
      search: { repoPath, projectId, component, level, title: undefined, testCaseIds: undefined },
    })
  }

  if (isLoading) {
    return <div className="p-6 text-sm text-ink-3">Chargementâ€¦</div>
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 border-b border-edge shrink-0">
        <span className="text-xs text-ink-3">
          {filterRe
            ? `${visibleCampaigns.length}/${campaigns.length} campagne${campaigns.length !== 1 ? 's' : ''}`
            : `${campaigns.length} campagne${campaigns.length !== 1 ? 's' : ''}`}
        </span>
        <button
          type="button"
          onClick={newCampaign}
          className="text-xs bg-ink text-prim-fg px-3 py-1.5 rounded hover:opacity-90"
        >
          + Nouvelle campagne
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {campaigns.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-16">
            <p className="text-sm text-ink-3">Aucune campagne</p>
            <button
              type="button"
              onClick={newCampaign}
              className="mt-3 text-xs text-blue-600 hover:underline"
            >
              CrÃ©er la premiÃ¨re campagne
            </button>
          </div>
        ) : visibleCampaigns.length === 0 ? (
          <div className="flex items-center justify-center h-full text-center py-16">
            <p className="text-sm text-ink-3">Aucun rÃ©sultat</p>
          </div>
        ) : (
          <div className="divide-y divide-edge">
            {visibleCampaigns.map(camp => (
              <button
                key={camp.id}
                type="button"
                onClick={() => openCampaign(camp.id)}
                className="w-full flex items-start gap-4 px-6 py-3 hover:bg-hover transition-colors text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs text-ink-3 shrink-0">{camp.id}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0 ${STATUS_CLASS[camp.status] ?? STATUS_CLASS['planned']}`}>
                      {camp.status}
                    </span>
                    {camp.baselineRef && (
                      <span className="text-[10px] font-mono text-ink-3 truncate">
                        {camp.baselineRef}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-ink truncate">{camp.title}</p>
                  {camp.testCaseIds.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {camp.testCaseIds.map((tcId, idx) => {
                        const tc = testMap.get(tcId)
                        return (
                          <span
                            key={`${tcId}-${idx}`}
                            title={tc?.title}
                            className="text-[10px] font-mono bg-canvas border border-edge rounded px-1.5 py-0.5 text-ink-3"
                          >
                            {tcId}
                          </span>
                        )
                      })}
                    </div>
                  )}
                  {camp.testCaseIds.length === 0 && (
                    <p className="text-[10px] text-ink-3 italic mt-1">Aucun test</p>
                  )}
                </div>

                {camp.runs.length > 0 && (
                  <div className="shrink-0 flex gap-1 text-[10px] mt-0.5">
                    {(['PASS', 'FAIL', 'BLOCKED', 'INCOMPLETE', 'pending'] as TestRunStatus[]).map(s => {
                      const count = camp.runs.filter(r => r.status === s).length
                      if (!count) return null
                      return (
                        <span key={s} className={`px-1.5 py-0.5 rounded-full ${RUN_CLASS[s] ?? ''}`}>
                          {count}
                        </span>
                      )
                    })}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
