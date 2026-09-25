import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { Parameter, ParameterUsage } from '@polenta/types'
import { PARAM_NAME_RE } from '@polenta/types'
import { api } from '../../api'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'

interface Props {
  /** Repo qui porte la base du paramètre. */
  repoPath: string
  workspaceDir: string
  projectId: string
  /** Absent : création. */
  parameter?: Parameter
  /** Nom pré-rempli en création (ex. référence non résolue, sprint 2). */
  initialName?: string
  readOnly: boolean
  onClose: () => void
  /** Appelé après écriture, avec les éléments marqués `needsRevalidation`. */
  onSaved?: (marked: number) => void
}

type Pending = { kind: 'save' } | { kind: 'delete' } | null

/**
 * T171 — création / modification / suppression d'un paramètre, avec la liste « Utilisé par ».
 * Même dialogue depuis la vue Paramètres et (sprint 2) depuis une référence dans un texte.
 * Une modification de `value`/`unit` (ou une création) qui touche des éléments approuvés demande
 * une confirmation listant ces éléments : ils seront marqués `needsRevalidation` (spec §9).
 */
export function ParameterEditDialog({ repoPath, workspaceDir, projectId, parameter, initialName, readOnly, onClose, onSaved }: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const isCreate = !parameter
  const [name, setName] = useState(parameter?.name ?? initialName ?? '')
  const [value, setValue] = useState(parameter?.value ?? '')
  const [unit, setUnit] = useState(parameter?.unit ?? '')
  const [description, setDescription] = useState(parameter?.description ?? '')
  const [pending, setPending] = useState<Pending>(null)
  const [error, setError] = useState<string | null>(null)
  const [refusedUsages, setRefusedUsages] = useState<ParameterUsage[] | null>(null)

  const usageName = isCreate ? name : parameter!.name
  const { data: usages = [], isFetching: usagesLoading } = useQuery({
    queryKey: ['parameter-usages', repoPath, usageName, workspaceDir],
    queryFn: () => api.parameters.usages(repoPath, usageName, workspaceDir || undefined),
    enabled: !!repoPath && PARAM_NAME_RE.test(usageName),
  })
  const approvedUsers = usages.filter(u => u.isApproval && !u.isTerminal)

  const textChanged = isCreate
    || (parameter!.value ?? '') !== value.trim()
    || (parameter!.unit ?? '') !== unit.trim()
  const nameValid = PARAM_NAME_RE.test(name)

  const invalidate = (marked: number) => {
    qc.invalidateQueries({ queryKey: ['parameters'] })
    qc.invalidateQueries({ queryKey: ['parameter-usages'] })
    if (marked > 0) {
      // Mêmes préfixes que l'invalidation T172 de SystemView : les éléments marqués peuvent être
      // de n'importe quel type/nœud.
      qc.invalidateQueries({ queryKey: ['objects'] })
      qc.invalidateQueries({ queryKey: ['object'] })
      qc.invalidateQueries({ queryKey: ['traceability-matrix'] })
      qc.invalidateQueries({ queryKey: ['requirements-all'] })
      qc.invalidateQueries({ queryKey: ['tests-all'] })
    }
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const patch = { value: value.trim(), unit: unit.trim() || undefined, description: description.trim() || undefined }
      return isCreate
        ? api.parameters.create(repoPath, { name, ...patch }, workspaceDir || undefined)
        : api.parameters.update(repoPath, parameter!.name, patch, workspaceDir || undefined)
    },
    onSuccess: (res) => {
      invalidate(res.marked.length)
      onSaved?.(res.marked.length)
      onClose()
    },
    onError: (err) => { setPending(null); setError(err instanceof Error ? err.message : String(err)) },
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.parameters.delete(repoPath, parameter!.name, workspaceDir || undefined),
    onSuccess: (res) => {
      setPending(null)
      if (!res.deleted) { setRefusedUsages(res.usages); return }
      invalidate(0)
      onClose()
    },
    onError: (err) => { setPending(null); setError(err instanceof Error ? err.message : String(err)) },
  })

  const requestSave = () => {
    setError(null)
    if (!nameValid) { setError(t('parameters.errors.invalidName')); return }
    if (textChanged && usagesLoading) return
    if (textChanged && approvedUsers.length > 0) { setPending({ kind: 'save' }); return }
    saveMutation.mutate()
  }

  const busy = saveMutation.isPending || deleteMutation.isPending
  useModalHotkeys(pending ? () => setPending(null) : onClose, undefined, busy)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" onClick={onClose}>
      <div className="bg-surface border border-edge rounded-lg shadow-xl p-6 w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-sm font-semibold text-ink mb-4">
          {isCreate ? t('parameters.dialog.createTitle') : t('parameters.dialog.editTitle', { name: parameter!.name })}
          {readOnly && <span className="ml-2 text-xs font-normal text-ink-3">{t('parameters.readOnly')}</span>}
        </h2>

        {pending?.kind === 'save' ? (
          <ConfirmImpact
            users={approvedUsers}
            onCancel={() => setPending(null)}
            onConfirm={() => saveMutation.mutate()}
            busy={busy}
          />
        ) : pending?.kind === 'delete' ? (
          <div>
            <p className="text-xs text-ink-2 mb-4">{t('parameters.dialog.confirmDelete', { name: parameter!.name })}</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setPending(null)}>{t('common.cancel')}</button>
              <button type="button" className="btn-danger" disabled={busy} onClick={() => deleteMutation.mutate()}>{t('common.delete')}</button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <Field label={t('parameters.fields.name')}>
                <input
                  className="input-field w-full font-mono text-xs"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  disabled={!isCreate || readOnly}
                  autoFocus={isCreate}
                />
                {isCreate && name && !nameValid && (
                  <p className="text-[11px] text-status-danger mt-1">{t('parameters.errors.invalidName')}</p>
                )}
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Field label={t('parameters.fields.value')}>
                    <input className="input-field w-full text-xs" value={value} onChange={e => setValue(e.target.value)} disabled={readOnly} autoFocus={!isCreate} />
                  </Field>
                </div>
                <Field label={t('parameters.fields.unit')}>
                  <input className="input-field w-full text-xs" value={unit} onChange={e => setUnit(e.target.value)} disabled={readOnly} />
                </Field>
              </div>
              <Field label={t('parameters.fields.description')}>
                <textarea className="input-field w-full text-xs" rows={2} value={description} onChange={e => setDescription(e.target.value)} disabled={readOnly} />
              </Field>
            </div>

            <UsageList
              title={refusedUsages ? t('parameters.dialog.deleteRefused') : t('parameters.usedBy', { count: usages.length })}
              usages={refusedUsages ?? usages}
              projectId={projectId}
              danger={!!refusedUsages}
              onNavigate={onClose}
            />

            {error && <p className="text-xs text-status-danger mt-3">{error}</p>}

            <div className="flex justify-between gap-2 mt-5">
              <div>
                {!isCreate && !readOnly && (
                  <button type="button" className="btn-danger" disabled={busy} onClick={() => { setRefusedUsages(null); setPending({ kind: 'delete' }) }}>
                    {t('common.delete')}
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary" onClick={onClose}>{readOnly ? t('common.close') : t('common.cancel')}</button>
                {!readOnly && (
                  <button
                    type="button"
                    className="btn-primary"
                    // La confirmation §9 dépend des usages : ne pas enregistrer un changement de
                    // texte avant de savoir s'il touche des éléments approuvés.
                    disabled={busy || (isCreate && !nameValid) || (textChanged && usagesLoading)}
                    onClick={requestSave}
                  >
                    {t('common.save')}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-ink-2">{label}</span>
      {children}
    </label>
  )
}

function ConfirmImpact({ users, onCancel, onConfirm, busy }: {
  users: ParameterUsage[]; onCancel: () => void; onConfirm: () => void; busy: boolean
}) {
  const { t } = useTranslation()
  return (
    <div>
      <p className="text-xs text-ink-2 mb-2">{t('parameters.dialog.confirmImpact', { count: users.length })}</p>
      <ul className="text-xs text-ink mb-4 max-h-48 overflow-y-auto border border-edge rounded divide-y divide-edge">
        {users.map(u => (
          <li key={u.elementId} className="px-2 py-1"><span className="font-mono text-ink-3 mr-2">{u.elementId}</span>{u.title}</li>
        ))}
      </ul>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>{t('common.cancel')}</button>
        <button type="button" className="btn-primary" disabled={busy} onClick={onConfirm} autoFocus>{t('parameters.dialog.confirmSave')}</button>
      </div>
    </div>
  )
}

/** « Utilisé par » : chaque entrée ouvre l'élément ; les éléments terminaux sont grisés. */
export function UsageList({ title, usages, projectId, danger = false, onNavigate }: {
  title: string; usages: ParameterUsage[]; projectId: string; danger?: boolean; onNavigate?: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="mt-4">
      <h3 className={`text-xs font-medium mb-1 ${danger ? 'text-status-danger' : 'text-ink-2'}`}>{title}</h3>
      {usages.length === 0 ? (
        <p className="text-xs text-ink-3 italic">{t('parameters.notUsed')}</p>
      ) : (
        <ul className="text-xs max-h-48 overflow-y-auto border border-edge rounded divide-y divide-edge">
          {usages.map(u => {
            const search = { repoPath: u.repoPath, projectId, component: undefined, level: undefined }
            const content = (
              <>
                <span className="font-mono text-ink-3 mr-2">{u.elementId}</span>
                <span className={u.isTerminal ? 'text-ink-3 line-through' : 'text-ink'}>{u.title}</span>
                <span className="ml-2 text-ink-3">({u.status}{u.ref.includes('::') ? ` · {${u.ref}}` : ''})</span>
              </>
            )
            return (
              <li key={`${u.repoPath}::${u.elementId}`} className={`px-2 py-1 ${u.isTerminal ? 'opacity-60' : ''}`}>
                {u.category === 'requirement' ? (
                  <Link to="/req/$reqId" params={{ reqId: u.elementId }} search={search} onClick={onNavigate} className="hover:underline">{content}</Link>
                ) : (
                  <Link to="/test/$testId" params={{ testId: u.elementId }} search={search} onClick={onNavigate} className="hover:underline">{content}</Link>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
