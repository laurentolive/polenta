import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ChangeSummary } from '@polenta/types'
import { api } from '../../api'
import { getObjectTypeRefs, useProjectSchema } from '../../hooks/useProjectSchema'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'

/**
 * GH199 §8bis — choisir le change ouvert qui reçoit des éléments (`toModify`), ou en créer un.
 * Trois usages : approbation d'un élément non assigné (`approve` : « Approuver sans change »),
 * « Assigner à… » depuis le backlog (`assign`), « Déplacer vers… » depuis un change (`move`).
 */
export function AssignToChangeDialog({ mode, repoPath, elementIds, component, sourceChangeId, openChanges, onDone, onCancel }: {
  mode: 'approve' | 'assign' | 'move'
  repoPath: string
  elementIds: string[]
  /** Composant du change créé depuis le dialogue. */
  component: string | null
  /** `move` : change d'origine (exclu de la liste). */
  sourceChangeId?: string
  /** Changes ouverts déjà connus (contrôle d'approbation) ; sinon lus. */
  openChanges?: ChangeSummary[]
  /** `changeId` : change qui a reçu les éléments ; null : « Approuver sans change ». */
  onDone: (changeId: string | null) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: schema } = useProjectSchema(repoPath)
  const { data: listed } = useQuery({
    queryKey: ['changesets', 'repo', repoPath],
    queryFn: () => api.changesets.list(repoPath),
    enabled: !openChanges && !!repoPath,
  })
  const candidates = (openChanges ?? (listed ?? []).filter(c => c.repoPath === repoPath && c.open))
    .filter(c => c.id !== sourceChangeId)
  const types = getObjectTypeRefs(schema, 'changeset')
  const [title, setTitle] = useState('')
  const [typeRef, setTypeRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Une écriture en vol ne s'annule pas : le dialogue attend son résultat.
  const cancel = () => { if (!busy) onCancel() }
  useModalHotkeys(cancel)

  const run = async (target: () => Promise<string>) => {
    setBusy(true)
    setError(null)
    try {
      const changeId = await target()
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['changesets'] }),
        qc.invalidateQueries({ queryKey: ['changeset'] }),
        qc.invalidateQueries({ queryKey: ['changes-backlog'] }),
      ])
      onDone(changeId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }
  const toExisting = (changeId: string) => run(async () => {
    if (mode === 'move' && sourceChangeId) await api.changesets.move(repoPath, sourceChangeId, changeId, elementIds)
    else await api.changesets.assign(repoPath, changeId, elementIds)
    return changeId
  })
  const toNew = () => run(async () => {
    const created = await api.changesets.create(repoPath, {
      objectTypeRef: typeRef || types[0]!.ref,
      title: title.trim(),
      ...(component && { component }),
      toModify: elementIds.map(id => ({ id, state: 'planned' as const })),
    })
    if (mode === 'move' && sourceChangeId) await api.changesets.move(repoPath, sourceChangeId, created.id, elementIds)
    return created.id
  })

  const heading = mode === 'approve' ? t('changes.assign.approveTitle') : mode === 'move' ? t('changes.assign.moveTitle') : t('changes.assign.assignTitle')
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" onClick={cancel}>
      <div role="dialog" aria-label={heading} className="bg-surface border border-edge rounded-lg shadow-xl w-[32rem] max-w-[95vw] max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()} data-testid="assign-change-dialog">
        <div className="px-4 py-3 border-b border-edge">
          <h2 className="text-sm font-semibold text-ink">{heading}</h2>
          <p className="text-xs text-ink-3 mt-1">
            {mode === 'approve' ? t('changes.assign.approveHelp', { id: elementIds[0] }) : t('changes.assign.elements', { ids: elementIds.join(', ') })}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <div>
            <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide mb-1">{t('changes.assign.openChanges')}</p>
            {candidates.length === 0 ? <p className="text-xs text-ink-3">{t('changes.assign.noOpen')}</p> : (
              <ul className="space-y-1">
                {candidates.map(c => (
                  <li key={c.id}>
                    <button type="button" disabled={busy} onClick={() => toExisting(c.id)} data-testid={`assign-change-${c.id}`}
                      className="w-full text-left text-sm px-2 py-1 rounded hover:bg-hover flex items-center gap-2 disabled:opacity-50">
                      <span className="font-mono text-prim whitespace-nowrap">{c.id}</span>
                      <span className="truncate text-ink">{c.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {types.length > 0 && (
            <form className="border-t border-edge pt-3 space-y-2" onSubmit={e => { e.preventDefault(); if (title.trim()) void toNew() }}>
              <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide">{t('changes.new')}</p>
              {types.length > 1 && (
                <select className="input-field text-xs w-full" value={typeRef || types[0]!.ref} onChange={e => setTypeRef(e.target.value)} aria-label={t('changes.type')}>
                  {types.map(ty => <option key={ty.ref} value={ty.ref}>{ty.label}</option>)}
                </select>
              )}
              <div className="flex gap-2">
                <input className="input-field text-sm flex-1" value={title} onChange={e => setTitle(e.target.value)} placeholder={t('changes.assign.newTitle')} data-testid="assign-change-new-title" />
                <button type="submit" className="btn-primary-sm" disabled={busy || !title.trim()} data-testid="assign-change-new-submit">{t('changes.assign.create')}</button>
              </div>
            </form>
          )}
          {error && <p className="text-xs text-status-danger">{error}</p>}
        </div>
        <div className="px-4 py-3 border-t border-edge flex justify-end gap-2">
          {mode === 'approve' && (
            <button type="button" className="btn-secondary-sm" disabled={busy} onClick={() => onDone(null)} data-testid="assign-change-skip">
              {t('changes.assign.approveWithout')}
            </button>
          )}
          <button type="button" className="text-xs text-ink-3 hover:text-ink disabled:opacity-50" disabled={busy} onClick={cancel} data-testid="assign-change-cancel">{t('common.cancel')}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
