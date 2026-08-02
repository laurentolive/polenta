import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../api'
import { useProjectSchema, getReqTypeDef } from '../../hooks/useProjectSchema'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'
import { DynamicField } from '../DynamicField'
import type { Requirement } from '@polenta/types'

interface Props {
  repoPath: string
  reqId: string
  onClose: () => void
}

const STATUS_CLASSES: Record<string, string> = {
  draft:    'bg-status-neutral-bg text-status-neutral',
  review:   'bg-status-warning-bg text-status-warning',
  approved: 'bg-status-success-bg text-status-success',
  obsolete: 'bg-status-danger-bg text-status-danger',
}

function fieldToString(fields: Record<string, unknown>, key: string): string {
  const v = fields[key]
  return typeof v === 'string' ? v : (v !== undefined && v !== null ? String(v) : '')
}

// Popup de consultation en lecture seule — pas d'édition, pas de transitions de statut. La liste
// (impact-analysis.tsx) affiche déjà l'énoncé en tooltip au survol du titre/id ; ce popup permet
// de le consulter confortablement (avec les autres champs), sans troncature.
export function RequirementEditModal({ repoPath, reqId, onClose }: Props) {
  const { t } = useTranslation()
  const { data: req, isLoading } = useQuery<Requirement>({
    queryKey: ['requirement', repoPath, reqId],
    queryFn: () => api.requirements.get(repoPath, reqId),
    enabled: !!repoPath,
  })

  const { data: schema } = useProjectSchema(repoPath)
  const typeDef = getReqTypeDef(schema, req?.objectTypeRef ?? '')

  useModalHotkeys(onClose, onClose)

  const statusClass = req ? (STATUS_CLASSES[req.status] ?? STATUS_CLASSES['draft']) : STATUS_CLASSES['draft']
  const fields = (req?.fields ?? {}) as Record<string, unknown>

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" onClick={onClose}>
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
          <button type="button" onClick={onClose} className="btn-close">×</button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto space-y-4">
          {isLoading ? (
            <p className="text-sm text-ink-3">{t('common.loading')}</p>
          ) : !req ? (
            <p className="text-sm text-ink-2">{t('requirementsPage.notFound', { reqId })}</p>
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
                  interfaceRoles={schema?.roles?.map(r => r.name)}
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
          <button type="button" onClick={onClose} className="btn-secondary">
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
