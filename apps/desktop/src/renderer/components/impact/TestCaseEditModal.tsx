import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../api'
import { useProjectSchema, getTestTypeDef } from '../../hooks/useProjectSchema'
import { DynamicField } from '../DynamicField'
import { StepsTable } from '../StepsTable'
import type { StepDraft } from '../StepsTable'
import type { TestCase } from '@polenta/types'

interface Props {
  repoPath: string
  testId: string
  onClose: () => void
}

function fieldToString(fields: Record<string, unknown>, key: string): string {
  const v = fields[key]
  return typeof v === 'string' ? v : (v !== undefined && v !== null ? String(v) : '')
}

// Popup de consultation en lecture seule — pas d'édition, pas de sauvegarde.
export function TestCaseEditModal({ repoPath, testId, onClose }: Props) {
  const { data: tc, isLoading } = useQuery<TestCase>({
    queryKey: ['test', repoPath, testId],
    queryFn: () => api.tests.get(repoPath, testId),
    enabled: !!repoPath,
  })

  const { data: schema } = useProjectSchema(repoPath)
  const typeDef = getTestTypeDef(schema, tc?.objectTypeRef ?? '')

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const fields = (tc?.fields ?? {}) as Record<string, unknown>
  const steps: StepDraft[] = (tc?.steps ?? [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .map(s => ({ action: s.action, expectedResult: s.expectedResult }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-surface border border-edge rounded-lg shadow-xl w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-edge shrink-0">
          <h2 className="text-sm font-semibold text-ink flex-1 truncate">{tc?.title ?? testId}</h2>
          <span className="font-mono text-xs text-ink-3">{testId}</span>
          {tc && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-300">
              {typeDef?.statuses?.find(s => s.name === tc.status)?.label ?? tc.status}
            </span>
          )}
          <button type="button" onClick={onClose} className="text-ink-3 hover:text-ink text-lg leading-none px-1">×</button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto space-y-4">
          {isLoading ? (
            <p className="text-sm text-ink-3">Chargement…</p>
          ) : !tc ? (
            <p className="text-sm text-ink-2">Cas de test introuvable : {testId}</p>
          ) : (
            <>
              {typeDef?.fields.map(f => (
                <DynamicField
                  key={f.name}
                  field={f}
                  value={fieldToString(fields, f.name)}
                  onChange={() => {}}
                  disabled
                  repoPath={repoPath}
                />
              ))}

              {!typeDef && Object.keys(fields).length > 0 && (
                Object.entries(fields).map(([key, val]) => (
                  <div key={key}>
                    <label className="block text-sm font-medium text-ink mb-1">{key}</label>
                    <input type="text" value={val !== undefined && val !== null ? String(val) : ''} disabled className="input-field w-full" />
                  </div>
                ))
              )}

              {tc.preconditions && (
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Préconditions</label>
                  <p className="text-sm text-ink-2 whitespace-pre-wrap">{tc.preconditions}</p>
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide mb-2">Étapes</p>
                <StepsTable steps={steps} onChange={() => {}} disabled repoPath={repoPath} />
              </div>

              {tc.postconditions && (
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Postconditions</label>
                  <p className="text-sm text-ink-2 whitespace-pre-wrap">{tc.postconditions}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-edge shrink-0">
          <button type="button" onClick={onClose} className="text-sm px-4 py-1.5 border border-edge rounded text-ink-2 hover:text-ink transition-colors">
            Fermer
          </button>
        </div>
      </div>
    </div>
  )
}
