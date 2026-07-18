import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../api'
import { useProjectSchema, getReqTypeDef } from '../../hooks/useProjectSchema'
import { DynamicField } from '../DynamicField'
import type { Requirement } from '@polenta/types'

interface Props {
  repoPath: string
  reqId: string
  onClose: () => void
}

const STATUS_CLASSES: Record<string, string> = {
  draft:    'bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-300',
  review:   'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  obsolete: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

function fieldToString(fields: Record<string, unknown>, key: string): string {
  const v = fields[key]
  return typeof v === 'string' ? v : (v !== undefined && v !== null ? String(v) : '')
}

// Popup de consultation en lecture seule — pas d'édition, pas de transitions de statut. La liste
// (impact-analysis.tsx) affiche déjà l'énoncé en tooltip au survol du titre/id ; ce popup permet
// de le consulter confortablement (avec les autres champs), sans troncature.
export function RequirementEditModal({ repoPath, reqId, onClose }: Props) {
  const { data: req, isLoading } = useQuery<Requirement>({
    queryKey: ['requirement', repoPath, reqId],
    queryFn: () => api.requirements.get(repoPath, reqId),
    enabled: !!repoPath,
  })

  const { data: schema } = useProjectSchema(repoPath)
  const typeDef = getReqTypeDef(schema, req?.objectTypeRef ?? '')

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const statusClass = req ? (STATUS_CLASSES[req.status] ?? STATUS_CLASSES['draft']) : STATUS_CLASSES['draft']
  const fields = (req?.fields ?? {}) as Record<string, unknown>

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-surface border border-edge rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-edge shrink-0">
          <h2 className="text-sm font-semibold text-ink flex-1 truncate">{req?.title ?? reqId}</h2>
          <span className="font-mono text-xs text-ink-3">{reqId}</span>
          {req && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusClass}`}>{req.status}</span>
          )}
          <button type="button" onClick={onClose} className="text-ink-3 hover:text-ink text-lg leading-none px-1">×</button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto space-y-4">
          {isLoading ? (
            <p className="text-sm text-ink-3">Chargement…</p>
          ) : !req ? (
            <p className="text-sm text-ink-2">Exigence introuvable : {reqId}</p>
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
