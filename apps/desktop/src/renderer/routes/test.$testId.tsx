import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useProjectSchema, getTestTypeDef, getAllObjectTypes } from '../hooks/useProjectSchema'
import { DynamicField } from '../components/DynamicField'
import { StepsTable } from '../components/StepsTable'
import type { StepDraft } from '../components/StepsTable'
import { RichTextProvider } from '../contexts/RichTextContext'
import { RichTextToolbar } from '../components/system/RichTextToolbar'
import { ViewHeader } from '../components/layout/ViewHeader'
import { useRegisterTabDirty, useSetTabTitle } from '../contexts/TabsContext'
import type { TestCase } from '@polenta/types'

export const Route = createFileRoute('/test/$testId')({
  component: TestCaseDetailPage,
  validateSearch: (search: Record<string, unknown>) => ({
    repoPath: (search['repoPath'] as string) ?? '',
    projectId: (search['projectId'] as string) ?? '',
    component: search['component'] as string | undefined,
    level: search['level'] as string | undefined,
  }),
})

function getStringField(fields: Record<string, unknown>, key: string): string {
  const v = fields[key]
  return typeof v === 'string' ? v : (v !== undefined && v !== null ? String(v) : '')
}

function TestCaseDetailPage() {
  const { testId } = Route.useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { repoPath, projectId } = Route.useSearch()

  const [title, setTitle] = useState('')
  const [type, setType] = useState<string>('manual')
  const [status, setStatus] = useState<string>('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [preconditions, setPreconditions] = useState('')
  const [steps, setSteps] = useState<StepDraft[]>([])
  const [postconditions, setPostconditions] = useState('')
  const [initialized, setInitialized] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const { data: tc, isLoading } = useQuery<TestCase>({
    queryKey: ['test', repoPath, testId],
    queryFn: () => api.tests.get(repoPath, testId),
    enabled: !!repoPath,
  })

  const { data: schema } = useProjectSchema(repoPath)
  const testTypes = getAllObjectTypes(schema, 'test')
  const typeDef = getTestTypeDef(schema, tc?.objectTypeRef ?? type)

  useEffect(() => {
    if (tc && !initialized) {
      setTitle(tc.title ?? '')
      setType(tc.objectTypeRef ?? '')
      setStatus(tc.status ?? '')
      const stringFields: Record<string, string> = {}
      if (tc.fields && typeof tc.fields === 'object') {
        for (const [k, v] of Object.entries(tc.fields as Record<string, unknown>)) {
          stringFields[k] = v !== undefined && v !== null ? String(v) : ''
        }
      }
      setFields(stringFields)
      setPreconditions(tc.preconditions ?? '')
      const sorted = (tc.steps ?? [])
        .slice()
        .sort((a, b) => a.order - b.order)
        .map(s => ({ action: s.action, expectedResult: s.expectedResult }))
      setSteps(sorted.length > 0 ? sorted : [{ action: '', expectedResult: '' }])
      setPostconditions(tc.postconditions ?? '')
      setInitialized(true)
    }
  }, [tc, initialized])

  const hasChanges = tc
    ? title !== (tc.title ?? '') ||
      type !== (tc.objectTypeRef ?? '') ||
      status !== (tc.status ?? '') ||
      preconditions !== (tc.preconditions ?? '') ||
      postconditions !== (tc.postconditions ?? '') ||
      steps.length !== (tc.steps ?? []).length ||
      steps.some((s, i) => {
        const orig = [...(tc.steps ?? [])].sort((a, b) => a.order - b.order)[i]
        return !orig || s.action !== orig.action || s.expectedResult !== orig.expectedResult
      }) ||
      Object.keys(fields).some(k => fields[k] !== getStringField(tc.fields as Record<string, unknown>, k))
    : false
  useRegisterTabDirty(hasChanges)
  useSetTabTitle(tc?.title)

  const saveMutation = useMutation({
    mutationFn: () => api.tests.update(repoPath, testId, {
      title,
      objectTypeRef: type,
      status,
      preconditions: preconditions.trim() || undefined,
      steps: steps.map((s, i) => ({ order: i + 1, action: s.action, expectedResult: s.expectedResult, notes: null })),
      postconditions: postconditions.trim() || undefined,
      fields,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tests', repoPath] })
      qc.invalidateQueries({ queryKey: ['test', repoPath, testId] })
      setInitialized(false)
      setSaveError(null)
    },
    onError: (err: unknown) => setSaveError(err instanceof Error ? err.message : 'Erreur inconnue'),
  })

  const handleSave = () => {
    if (steps.length === 0) { setSaveError('Au moins une étape est requise.'); return }
    const emptyStep = steps.findIndex(s => !s.action.trim() || !s.expectedResult.trim())
    if (emptyStep !== -1) { setSaveError(`L'étape ${emptyStep + 1} est incomplète.`); return }
    setSaveError(null)
    saveMutation.mutate()
  }

  if (!repoPath) return <p className="text-sm text-ink-2 p-4">Paramètre <code>repoPath</code> manquant.</p>
  if (isLoading) return <p className="text-sm text-ink-3 p-4">Chargement…</p>
  if (!tc) return <p className="text-sm text-ink-2 p-4">Cas de test introuvable : {testId}</p>

  return (
    <RichTextProvider>
      <div className="flex flex-col h-full overflow-hidden">
        <ViewHeader
          currentProjectId={projectId}
          title={
            <span className="flex items-center gap-2">
              {tc.title}
              {typeDef?.statuses?.length ? (
                <select
                  value={status}
                  onChange={e => setStatus(e.target.value)}
                  className="text-xs font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-300 border border-edge outline-none cursor-pointer"
                >
                  {typeDef.statuses.map(s => (
                    <option key={s.name} value={s.name}>{s.label ?? s.name}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={status}
                  onChange={e => setStatus(e.target.value)}
                  className="text-xs font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-300 border border-edge outline-none w-24"
                />
              )}
              <span className="text-xs font-mono text-ink-3 font-normal">{tc.id}</span>
            </span>
          }
          actions={<RichTextToolbar repoPath={repoPath} />}
        />

        <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              Titre <span className="text-red-500">*</span>
            </label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)}
              className="input-field w-full" />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-1">Type</label>
            <select value={type} onChange={e => setType(e.target.value)} className="input-field w-full">
              {testTypes.map(t => (
                <option key={t.name} value={t.name}>{t.label ?? t.name}</option>
              ))}
            </select>
          </div>

          {typeDef?.fields.map(f => (
            <DynamicField key={f.name} field={f}
              value={fields[f.name] ?? String(f.default ?? '')}
              onChange={v => setFields(prev => ({ ...prev, [f.name]: v }))}
              repoPath={repoPath}
            />
          ))}

          {!typeDef && tc.fields && Object.keys(tc.fields).length > 0 && (
            Object.entries(tc.fields as Record<string, unknown>).map(([key, val]) => (
              <div key={key}>
                <label className="block text-sm font-medium text-ink mb-1">{key}</label>
                <input type="text" value={fields[key] ?? String(val ?? '')}
                  onChange={e => setFields(prev => ({ ...prev, [key]: e.target.value }))}
                  className="input-field w-full" />
              </div>
            ))
          )}

          <div>
            <label className="block text-sm font-medium text-ink mb-1">Préconditions</label>
            <textarea value={preconditions} onChange={e => setPreconditions(e.target.value)}
              rows={2} className="input-field w-full resize-none" />
          </div>

          <div>
            <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide mb-2">Étapes</p>
            <StepsTable steps={steps} onChange={setSteps} repoPath={repoPath} />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-1">Postconditions</label>
            <textarea value={postconditions} onChange={e => setPostconditions(e.target.value)}
              rows={2} className="input-field w-full resize-none" />
          </div>

          {saveError && <p className="text-sm text-red-500">{saveError}</p>}

          <div className="flex gap-3">
            <button type="button" onClick={handleSave}
              disabled={!hasChanges || saveMutation.isPending} className="btn-primary">
              {saveMutation.isPending ? 'Sauvegarde…' : 'Sauvegarder'}
            </button>
            <button type="button"
              onClick={() => navigate({ to: '/schema', search: { repoPath, projectId } })}
              className="btn-secondary">
              Retour
            </button>
          </div>
        </div>
        </div>
      </div>
    </RichTextProvider>
  )
}
