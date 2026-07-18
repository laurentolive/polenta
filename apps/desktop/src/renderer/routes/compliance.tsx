/**
 * CompliancePage — T69 Sprint 4, back-navigation updated T70 Sprint 3
 *
 * Dedicated route for "Conformité interfaces" accessible from the Structure tab.
 * Displays the compliance matrix for all interface repos in a workspace.
 *
 * URL: /compliance?dir=<workspace dir>&repoPath=<repo path>&projectId=<encoded project id>
 */

import { useState, useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { api } from '../api'
import { ComplianceMatrixComponent } from '../components/ComplianceMatrix'
import { ViewHeader } from '../components/layout/ViewHeader'
import { useSetTabTitle } from '../contexts/TabsContext'
import type { ComplianceMatrix } from '@polenta/types'

export const Route = createFileRoute('/compliance')({
  component: CompliancePage,
  validateSearch: (s: Record<string, unknown>) => ({
    dir: (s['dir'] as string) ?? '',
    repoPath: (s['repoPath'] as string) ?? '',
    projectId: (s['projectId'] as string) ?? '',
  }),
})

function CompliancePage() {
  const { dir, repoPath, projectId } = Route.useSearch()
  const navigate = useNavigate()

  const [matrices, setMatrices] = useState<ComplianceMatrix[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Selected interface tab
  const [selectedInterface, setSelectedInterface] = useState<string | null>(null)

  useEffect(() => {
    if (!dir) {
      setError('Aucun workspace spécifié.')
      setLoading(false)
      return
    }

    let cancelled = false

    api.interface.complianceMatrix(dir)
      .then(result => {
        if (cancelled) return
        setMatrices(result)
        if (result.length > 0 && !selectedInterface) {
          setSelectedInterface(result[0].interfaceName)
        }
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [dir])

  const currentMatrix = matrices.find(m => m.interfaceName === selectedInterface)
  useSetTabTitle(currentMatrix ? `Conformité — ${currentMatrix.interfaceName}` : undefined)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ViewHeader
        currentProjectId={projectId}
        back={{
          label: 'Structure',
          onClick: () => repoPath
            ? navigate({ to: '/schema', search: { repoPath, projectId } })
            // Pre-T70 /compliance links only ever carried `dir` — fall back through the
            // /workspace redirect page, which knows how to resolve a bare workspaceDir.
            : navigate({ to: '/workspace', search: { dir } }),
        }}
        title={
          <span className="flex items-center gap-2">
            <ShieldCheck size={14} className="text-violet-500" />
            Conformité interfaces
          </span>
        }
        subtitle={dir && <span className="font-mono">{dir}</span>}
      />

      <div className="flex-1 overflow-y-auto">
      <div className="p-6 space-y-4">
      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center h-40 text-ink-3 text-sm">
          Calcul de la matrice de conformité…
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/60 rounded px-3 py-2 text-sm text-red-700 dark:text-red-400">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && matrices.length === 0 && (
        <div className="text-sm text-ink-3 text-center py-10">
          <ShieldCheck size={32} className="mx-auto mb-2 opacity-30" />
          <p>Aucune interface trouvée dans ce workspace.</p>
          <p className="mt-1">
            Un repo interface déclare <code className="font-mono text-xs">roles:</code> dans son{' '}
            <code className="font-mono text-xs">.polenta/schema.yaml</code>.
          </p>
        </div>
      )}

      {/* Interface tabs + matrix */}
      {!loading && !error && matrices.length > 0 && (
        <div className="space-y-4">
          {/* Tab bar */}
          {matrices.length > 1 && (
            <div className="flex gap-2 border-b border-edge">
              {matrices.map(m => (
                <button
                  key={m.interfaceName}
                  type="button"
                  className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                    selectedInterface === m.interfaceName
                      ? 'border-primary text-primary'
                      : 'border-transparent text-ink-2 hover:text-ink'
                  }`}
                  onClick={() => setSelectedInterface(m.interfaceName)}
                >
                  {m.interfaceName}
                  <span className="ml-1.5 text-xs text-ink-3">
                    ({m.requirements.length} req)
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Selected matrix */}
          {currentMatrix && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-ink">{currentMatrix.interfaceName}</h2>
                <span className="text-xs text-ink-3">
                  {currentMatrix.requirements.length} exigence(s) approuvée(s) ·{' '}
                  {currentMatrix.components.length} composant(s) implémenteur(s)
                </span>
              </div>
              <ComplianceMatrixComponent matrix={currentMatrix} />
            </div>
          )}
        </div>
      )}
      </div>
      </div>
    </div>
  )
}
