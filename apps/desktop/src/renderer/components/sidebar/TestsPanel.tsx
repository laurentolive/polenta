import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Search, Plus } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../api'
import { decodeProjectId } from '../../lib/projectId'
import { useProjectSchema, getAllObjectTypes } from '../../hooks/useProjectSchema'

interface Props {
  currentProjectId: string
  projectId: string
}

export function TestsPanel({ currentProjectId, projectId }: Props) {
  const navigate = useNavigate()
  const [showTypeMenu, setShowTypeMenu] = useState(false)

  const search = useRouterState({ select: s => s.location.search })
  const params = new URLSearchParams(search)
  const currentFilter = params.get('filter') ?? ''
  const currentType   = params.get('type')   ?? ''

  const { data: project } = useQuery({
    queryKey: ['workspace', currentProjectId],
    queryFn: () => api.workspace.resolve(decodeProjectId(currentProjectId)),
  })
  const repoPath = project?.localPath ?? ''

  const { data: tests = [] } = useQuery({
    queryKey: ['tests', repoPath],
    queryFn: () => api.tests.list(repoPath),
    enabled: !!repoPath,
  })

  const { data: schema } = useProjectSchema(repoPath)
  const types = getAllObjectTypes(schema, 'test')

  const countByType = new Map<string, number>()
  for (const t of tests) {
    const key = t.objectTypeRef
    countByType.set(key, (countByType.get(key) ?? 0) + 1)
  }

  function navTo(filter: string, type: string) {
    navigate({ to: '/tests', search: { projectId, filter, type }, replace: true })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" onClick={() => showTypeMenu && setShowTypeMenu(false)}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-edge shrink-0">
        <div className="flex items-center justify-between mb-2">
          <p className="section-label">Tests</p>
          <div className="relative">
            <button
              type="button"
              onClick={e => { e.stopPropagation(); setShowTypeMenu(v => !v) }}
              disabled={!repoPath}
              className="p-1 rounded text-ink-3 hover:text-ink hover:bg-hover disabled:opacity-40 transition-colors"
              title="Nouveau test"
            >
              <Plus size={14} />
            </button>
            {showTypeMenu && (
              <div className="absolute right-0 top-full mt-1 bg-surface border border-edge rounded shadow-lg z-10 w-48 py-1">
                {types.length > 0 ? types.map(t => (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() => {
                      setShowTypeMenu(false)
                      navigate({ to: '/test/new', search: { repoPath, projectId, type: t.name, component: undefined, level: undefined } })
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-ink-2 hover:bg-hover hover:text-ink transition-colors"
                  >
                    {t.label ?? t.name}
                  </button>
                )) : (
                  <button
                    type="button"
                    onClick={() => {
                      setShowTypeMenu(false)
                      navigate({ to: '/test/new', search: { repoPath, projectId, type: '', component: undefined, level: undefined } })
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-ink-2 hover:bg-hover transition-colors"
                  >
                    Nouveau test
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        {/* Filter input */}
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
          <input
            value={currentFilter}
            onChange={e => navTo(e.target.value, currentType)}
            placeholder="Filtrer…"
            className="input-field w-full pl-6 pr-3 py-1"
          />
        </div>
      </div>

      {/* Type filters */}
      <div className="flex-1 overflow-y-auto py-2">
        <button
          type="button"
          onClick={() => navTo(currentFilter, '')}
          className={`w-full flex items-center justify-between px-4 py-2 text-xs transition-colors ${
            currentType === ''
              ? 'bg-hover text-ink font-medium'
              : 'text-ink-2 hover:bg-hover hover:text-ink'
          }`}
        >
          <span>Tout</span>
          <span className="text-ink-3">{tests.length}</span>
        </button>

        {types.map(t => (
          <button
            key={t.name}
            type="button"
            onClick={() => navTo(currentFilter, currentType === t.name ? '' : t.name)}
            className={`w-full flex items-center justify-between px-4 py-2 text-xs transition-colors ${
              currentType === t.name
                ? 'bg-hover text-ink font-medium'
                : 'text-ink-2 hover:bg-hover hover:text-ink'
            }`}
          >
            <span>{t.label ?? t.name}</span>
            <span className="text-ink-3">{countByType.get(t.name) ?? 0}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
