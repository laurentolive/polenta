import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../api'
import { useProjectSchema, getTestTypeDef } from '../../hooks/useProjectSchema'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'
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
  const { t } = useTranslation()
  const { data: tc, isLoading } = useQuery<TestCase>({
    queryKey: ['test', repoPath, testId],
    queryFn: () => api.tests.get(repoPath, testId),
    enabled: !!repoPath,
  })

  const { data: schema } = useProjectSchema(repoPath)
  const typeDef = getTestTypeDef(schema, tc?.objectTypeRef ?? '')

  useModalHotkeys(onClose, onClose)

  const fields = (tc?.fields ?? {}) as Record<string, unknown>
  const steps: StepDraft[] = (tc?.steps ?? [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .map(s => ({ action: s.action, expectedResult: s.expectedResult }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" onClick={onClose}>
      <div
        className="bg-surface border border-edge rounded-lg shadow-xl w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-edge shrink-0">
          <h2 className="text-sm font-semibold text-ink flex-1 truncate">{tc?.title ?? testId}</h2>
          <span className="font-mono text-xs text-ink-3">{testId}</span>
          {tc && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-status-neutral-bg text-status-neutral">
              {typeDef?.statuses?.find(s => s.name === tc.status)?.label ?? tc.status}
            </span>
          )}
          <button type="button" onClick={onClose} className="btn-close">×</button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto space-y-4">
          {isLoading ? (
            <p className="text-sm text-ink-3">{t('common.loading')}</p>
          ) : !tc ? (
            <p className="text-sm text-ink-2">{t('testsPage.notFound', { testId })}</p>
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

              {tc.preconditions && (
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">{t('testsPage.preconditions')}</label>
                  <p className="text-sm text-ink-2 whitespace-pre-wrap">{tc.preconditions}</p>
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide mb-2">{t('system.wordView.stepsHeading')}</p>
                <StepsTable steps={steps} onChange={() => {}} disabled repoPath={repoPath} />
              </div>

              {tc.postconditions && (
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">{t('testsPage.postconditions')}</label>
                  <p className="text-sm text-ink-2 whitespace-pre-wrap">{tc.postconditions}</p>
                </div>
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
