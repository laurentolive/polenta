import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useProjectSchema, getReqTypeDef } from '../hooks/useProjectSchema'
import { DynamicField } from '../components/DynamicField'
import { ViewHeader } from '../components/layout/ViewHeader'
import { useRegisterTabDirty, useSetTabTitle } from '../contexts/TabsContext'
import type { Requirement } from '@polenta/types'

export const Route = createFileRoute('/req/$reqId')({
  component: RequirementDetailPage,
  validateSearch: (search: Record<string, unknown>) => ({
    repoPath: (search['repoPath'] as string) ?? '',
    projectId: (search['projectId'] as string) ?? '',
    component: search['component'] as string | undefined,
    level: search['level'] as string | undefined,
  }),
})

const STATUS_CLASSES: Record<string, string> = {
  draft:    'bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-300',
  review:   'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  obsolete: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

function getStringField(fields: Record<string, unknown>, key: string): string {
  const v = fields[key]
  return typeof v === 'string' ? v : (v !== undefined && v !== null ? String(v) : '')
}

function RequirementDetailPage() {
  const { reqId } = Route.useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { repoPath, projectId } = Route.useSearch()

  const [title, setTitle] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [initialized, setInitialized] = useState(false)
  const [confirmObsolete, setConfirmObsolete] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [transitionError, setTransitionError] = useState<string | null>(null)

  const { data: req, isLoading } = useQuery<Requirement>({
    queryKey: ['requirement', repoPath, reqId],
    queryFn: () => api.requirements.get(repoPath, reqId),
    enabled: !!repoPath,
  })

  const { data: schema } = useProjectSchema(repoPath)
  const typeDef = getReqTypeDef(schema, req?.objectTypeRef ?? '')

  useEffect(() => {
    if (req && !initialized) {
      setTitle(req.title ?? '')
      const stringFields: Record<string, string> = {}
      if (req.fields && typeof req.fields === 'object') {
        for (const [k, v] of Object.entries(req.fields as Record<string, unknown>)) {
          stringFields[k] = v !== undefined && v !== null ? String(v) : ''
        }
      }
      setFields(stringFields)
      setInitialized(true)
    }
  }, [req, initialized])

  const hasChanges = req
    ? title !== (req.title ?? '') ||
      Object.keys(fields).some(k => fields[k] !== getStringField(req.fields as Record<string, unknown>, k)) ||
      (typeDef?.fields ?? []).some(f => {
        const reqVal = getStringField(req.fields as Record<string, unknown>, f.name)
        return (fields[f.name] ?? '') !== reqVal
      })
    : false
  useRegisterTabDirty(hasChanges)
  useSetTabTitle(req?.title)

  const saveMutation = useMutation({
    mutationFn: () => api.requirements.update(repoPath, reqId, { title, fields }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requirements', repoPath] })
      qc.invalidateQueries({ queryKey: ['requirement', repoPath, reqId] })
      setInitialized(false)
      setSaveError(null)
    },
    onError: (err: unknown) => setSaveError(err instanceof Error ? err.message : 'Erreur inconnue'),
  })

  const transitionMutation = useMutation({
    mutationFn: (toStatus: string) => api.requirements.transition(repoPath, reqId, { toStatus }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requirements', repoPath] })
      qc.invalidateQueries({ queryKey: ['requirement', repoPath, reqId] })
      setConfirmObsolete(false)
      setTransitionError(null)
      setInitialized(false)
    },
    onError: (err: unknown) => setTransitionError(err instanceof Error ? err.message : 'Erreur inconnue'),
  })

  if (!repoPath) {
    return <p className="text-sm text-ink-2 p-4">Paramètre <code>repoPath</code> manquant dans l&apos;URL.</p>
  }

  if (isLoading) return <p className="text-sm text-ink-3 p-4">Chargement…</p>
  if (!req) return <p className="text-sm text-ink-2 p-4">Exigence introuvable : {reqId}</p>

  const statusClass = STATUS_CLASSES[req.status] ?? STATUS_CLASSES['draft']

  const statuses = typeDef?.statuses ?? [
    { name: 'draft', label: 'Brouillon' },
    { name: 'review', label: 'En review' },
    { name: 'approved', label: 'Approuvé', isApproval: true },
    { name: 'obsolete', label: 'Obsolète' },
  ]

  const currentStatusIndex = statuses.findIndex(s => s.name === req.status)
  const nextStatus = currentStatusIndex >= 0 && currentStatusIndex < statuses.length - 1
    ? statuses[currentStatusIndex + 1]
    : null
  const obsoleteStatus = statuses.find(s => s.name === 'obsolete')
  const canMarkObsolete = req.status !== 'obsolete' && obsoleteStatus !== undefined && (!nextStatus || nextStatus.name !== 'obsolete')

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ViewHeader
        currentProjectId={projectId}
        title={req.title}
        subtitle={<span className="font-mono">{req.id}</span>}
        actions={
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusClass}`}>
            {req.status}
          </span>
        }
      />

      <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            Titre <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="input-field w-full"
          />
        </div>

        {typeDef?.fields.map(f => (
          <DynamicField
            key={f.name}
            field={f}
            value={fields[f.name] ?? String(f.default ?? '')}
            onChange={v => setFields(prev => ({ ...prev, [f.name]: v }))}
            repoPath={repoPath}
          />
        ))}

        {!typeDef && req.fields && Object.keys(req.fields).length > 0 && (
          Object.entries(req.fields as Record<string, unknown>).map(([key, val]) => (
            <div key={key}>
              <label className="block text-sm font-medium text-ink mb-1">{key}</label>
              <input
                type="text"
                value={fields[key] ?? String(val ?? '')}
                onChange={e => setFields(prev => ({ ...prev, [key]: e.target.value }))}
                className="input-field w-full"
              />
            </div>
          ))
        )}

        {saveError && <p className="text-sm text-red-500">{saveError}</p>}

        <div className="flex gap-3 items-center flex-wrap">
          <button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={!hasChanges || saveMutation.isPending}
            className="btn-primary"
          >
            {saveMutation.isPending ? 'Sauvegarde…' : 'Sauvegarder'}
          </button>
          <button
            type="button"
            onClick={() => navigate({ to: '/schema', search: { repoPath, projectId } })}
            className="btn-secondary"
          >
            Retour
          </button>
        </div>

        {(nextStatus || canMarkObsolete) && (
          <div className="border-t border-edge pt-4 mt-2">
            <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide mb-3">
              Transitions de statut
            </p>

            {transitionError && <p className="text-sm text-red-500 mb-2">{transitionError}</p>}

            <div className="flex gap-3 items-center flex-wrap">
              {nextStatus && (
                <button
                  type="button"
                  onClick={() => transitionMutation.mutate(nextStatus.name)}
                  disabled={transitionMutation.isPending}
                  className={`text-white rounded px-4 py-2 text-sm disabled:opacity-50 transition-colors ${
                    nextStatus.isApproval
                      ? 'bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600'
                      : 'bg-amber-500 hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-500'
                  }`}
                >
                  {transitionMutation.isPending
                    ? 'Transition…'
                    : nextStatus.isApproval
                      ? `Approuver (${nextStatus.label ?? nextStatus.name})`
                      : nextStatus.label ?? nextStatus.name}
                </button>
              )}

              {canMarkObsolete && !confirmObsolete && (
                <button
                  type="button"
                  onClick={() => setConfirmObsolete(true)}
                  className="border border-red-300 text-red-600 rounded px-3 py-1.5 text-xs hover:bg-red-50 dark:border-red-700/60 dark:text-red-400 dark:hover:bg-red-900/20 transition-colors"
                >
                  Marquer obsolète
                </button>
              )}

              {confirmObsolete && (
                <div className="flex items-center gap-2 border border-red-200 rounded px-3 py-2 bg-red-50 dark:border-red-700/60 dark:bg-red-900/20">
                  <span className="text-sm text-red-700 dark:text-red-400">Confirmer l&apos;obsolescence ?</span>
                  <button
                    type="button"
                    onClick={() => transitionMutation.mutate('obsolete')}
                    disabled={transitionMutation.isPending}
                    className="bg-red-600 text-white rounded px-3 py-1 text-sm disabled:opacity-50"
                  >
                    {transitionMutation.isPending ? 'Transition…' : 'Oui, obsolète'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmObsolete(false)}
                    className="btn-secondary px-3 py-1 text-sm"
                  >
                    Annuler
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  )
}
