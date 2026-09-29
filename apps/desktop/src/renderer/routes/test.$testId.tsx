import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation, Trans } from 'react-i18next'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useProjectSchema, getTestTypeDef, getAllObjectTypes } from '../hooks/useProjectSchema'
import { DynamicField } from '../components/DynamicField'
import { StepsTable } from '../components/StepsTable'
import { LinkedReqValues } from '../components/parameters/LinkedReqValues'
import type { StepDraft } from '../components/StepsTable'
import { RichTextProvider } from '../contexts/RichTextContext'
import { RichTextToolbar } from '../components/system/RichTextToolbar'
import { ViewHeader } from '../components/layout/ViewHeader'
import { useRegisterTabDirty, useSetTabTitle } from '../contexts/TabsContext'
import type { TestCase } from '@polenta/types'
import { ParamRefProvider } from '../contexts/ParamRefContext'
import { decodeProjectId } from '../lib/projectId'

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
  const { t } = useTranslation()
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
    onError: (err: unknown) => setSaveError(err instanceof Error ? err.message : t('common.unknownError')),
  })

  const handleSave = () => {
    if (steps.length === 0) { setSaveError(t('testsPage.atLeastOneStepRequired')); return }
    const emptyStep = steps.findIndex(s => !s.action.trim() || !s.expectedResult.trim())
    if (emptyStep !== -1) { setSaveError(t('testsPage.stepIncomplete', { index: emptyStep + 1 })); return }
    setSaveError(null)
    saveMutation.mutate()
  }

  // Ctrl/Cmd+Entrée depuis un champ richtext (champ perso ou cellule d'étape) → « Enregistrer ».
  const submitEdit = () => { if (hasChanges && !saveMutation.isPending) handleSave() }

  if (!repoPath) return <p className="text-sm text-ink-2 p-4"><Trans i18nKey="testsPage.missingRepoPath" components={{ code: <code /> }} /></p>
  if (isLoading) return <p className="text-sm text-ink-3 p-4">{t('common.loading')}</p>
  if (!tc) return <p className="text-sm text-ink-2 p-4">{t('testsPage.notFound', { testId })}</p>

  return (
    <ParamRefProvider repoPath={repoPath} workspaceDir={projectId ? decodeProjectId(projectId) : ''} projectId={projectId}>
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
                  className="text-xs font-medium px-2 py-0.5 rounded bg-status-neutral-bg text-status-neutral border border-edge outline-none cursor-pointer"
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
                  className="text-xs font-medium px-2 py-0.5 rounded bg-status-neutral-bg text-status-neutral border border-edge outline-none w-24"
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
              {t('requirementsPage.titleLabel')} <span className="text-status-danger">*</span>
            </label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)}
              className="input-field w-full" />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-1">{t('system.editView.colType')}</label>
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
              interfaceRoles={schema?.roles?.map(r => r.name)}
              onSubmit={submitEdit}
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
            <label className="block text-sm font-medium text-ink mb-1">{t('testsPage.preconditions')}</label>
            <textarea value={preconditions} onChange={e => setPreconditions(e.target.value)}
              rows={2} className="input-field w-full resize-none" />
          </div>

          <div>
            <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide mb-2">{t('system.wordView.stepsHeading')}</p>
            <LinkedReqValues repoPath={repoPath} testId={testId} workspaceDir={projectId ? decodeProjectId(projectId) : ''}>
              <StepsTable steps={steps} onChange={setSteps} repoPath={repoPath} onSubmit={submitEdit} />
            </LinkedReqValues>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-1">{t('testsPage.postconditions')}</label>
            <textarea value={postconditions} onChange={e => setPostconditions(e.target.value)}
              rows={2} className="input-field w-full resize-none" />
          </div>

          {saveError && <p className="text-sm text-status-danger">{saveError}</p>}

          <div className="flex gap-3">
            <button type="button" onClick={handleSave}
              disabled={!hasChanges || saveMutation.isPending} className="btn-primary">
              {saveMutation.isPending ? t('requirementsPage.saving') : t('requirementsPage.save')}
            </button>
            <button type="button"
              onClick={() => navigate({ to: '/schema', search: { repoPath, projectId } })}
              className="btn-secondary">
              {t('layout.viewHeader.back')}
            </button>
          </div>
        </div>
        </div>
      </div>
    </RichTextProvider>
    </ParamRefProvider>
  )
}
