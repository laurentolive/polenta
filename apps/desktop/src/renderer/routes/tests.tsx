import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { decodeProjectId } from '../lib/projectId'
import { useProjectSchema, getAllObjectTypes } from '../hooks/useProjectSchema'
import { ViewHeader } from '../components/layout/ViewHeader'
import type { TestCase } from '@polenta/types'

export const Route = createFileRoute('/tests')({
  component: TestsPage,
  validateSearch: (s: Record<string, unknown>) => ({
    projectId: (s['projectId'] as string) ?? '',
    filter:    (s['filter']    as string) ?? '',
    type:      (s['type']      as string) ?? '',
  }),
})

const STATUS_CLASSES: Record<string, string> = {
  draft:    'bg-status-neutral-bg text-status-neutral',
  ready:    'bg-status-info-bg text-status-info',
  passed:   'bg-status-success-bg text-status-success',
  failed:   'bg-status-danger-bg text-status-danger',
  blocked:  'bg-status-warning-bg text-status-warning',
  obsolete: 'bg-status-neutral-bg text-status-neutral',
}

function groupByType(tests: TestCase[]): Map<string, TestCase[]> {
  const map = new Map<string, TestCase[]>()
  for (const t of tests) {
    const key = t.objectTypeRef
    const list = map.get(key) ?? []
    list.push(t)
    map.set(key, list)
  }
  return map
}

function TestsPage() {
  const { t } = useTranslation()
  const { projectId, filter, type: typeFilter } = Route.useSearch()
  const navigate = useNavigate()

  const { data: project } = useQuery({
    queryKey: ['workspace', projectId],
    queryFn: () => api.workspace.resolve(decodeProjectId(projectId)),
    enabled: !!projectId,
  })
  const repoPath = project?.localPath ?? ''

  const { data: tests = [], isLoading } = useQuery({
    queryKey: ['tests', repoPath],
    queryFn: () => api.tests.list(repoPath),
    enabled: !!repoPath,
  })

  const { data: schema } = useProjectSchema(repoPath)
  const testTypes = getAllObjectTypes(schema, 'test')

  let filtered = tests
  if (typeFilter) filtered = filtered.filter(t => t.objectTypeRef === typeFilter)
  if (filter.trim()) filtered = filtered.filter(t =>
    t.id.toLowerCase().includes(filter.toLowerCase()) ||
    (t.title ?? '').toLowerCase().includes(filter.toLowerCase())
  )

  const grouped = groupByType(filtered)
  const typeOrder = testTypes.map(t => t.name).length > 0
    ? testTypes.map(t => t.name)
    : [...grouped.keys()].sort()
  const types = typeOrder.filter(t => grouped.has(t))

  const typeLabel = (name: string) =>
    testTypes.find(t => t.name === name)?.label ?? name

  if (!projectId) return <p className="text-sm text-ink-3 p-4">{t('common.projectNotLoaded')}</p>

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ViewHeader
        currentProjectId={projectId}
        title={
          <>
            {t('testsPage.title')}
            <span className="text-sm font-normal text-ink-3 ml-2">({filtered.length})</span>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl p-6">
      {isLoading ? (
        <p className="text-sm text-ink-3">{t('common.loading')}</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-sm text-ink-3">
            {filter || typeFilter ? t('testsPage.noTestForFilter') : t('testsPage.noTestCreated')}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {types.map(type => {
            const items = grouped.get(type) ?? []
            return (
              <div key={type}>
                <h2 className="section-label mb-2">{typeLabel(type)} ({items.length})</h2>
                <div className="space-y-1">
                  {items.map(tc => (
                    <button
                      key={tc.id}
                      type="button"
                      onClick={() => navigate({
                        to: '/test/$testId',
                        params: { testId: tc.id },
                        search: { repoPath, projectId, component: undefined, level: undefined },
                      })}
                      className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg border border-edge bg-surface hover:bg-hover transition-colors text-left"
                    >
                      <span className="font-mono text-xs text-ink-3 shrink-0 w-28">{tc.id}</span>
                      <span className="text-sm text-ink flex-1 truncate">{tc.title}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_CLASSES[tc.status as string] ?? STATUS_CLASSES['draft']}`}>
                        {tc.status}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
      </div>
      </div>
    </div>
  )
}
