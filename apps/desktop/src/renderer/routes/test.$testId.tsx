import { fieldValueToText, isFieldRequiredNow, objectFieldReader } from '@polenta/types'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation, Trans } from 'react-i18next'
import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { HistorySection } from '../components/history/HistorySection'
import { ExecutionsSection } from '../components/executions/ExecutionsSection'
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
import { TransitionScopeContext, transitionPreviewKey } from '../hooks/useTransitionPreview'
import { notifyTransitionResult } from '../lib/transitionNotices'
import { TransitionStatusOptions } from '../components/transitions/TransitionStatusOptions'
import { typeChoiceLabel } from '../lib/typeLabels'
import { draftFields, fieldKeys, useDraftForm, type Draft } from '../lib/draftSync'
import { ExternalChangeBanner } from '../components/ExternalChangeBanner'

export const Route = createFileRoute('/test/$testId')({
  component: TestCaseDetailPage,
  validateSearch: (search: Record<string, unknown>) => ({
    repoPath: (search['repoPath'] as string) ?? '',
    projectId: (search['projectId'] as string) ?? '',
    component: search['component'] as string | undefined,
    level: search['level'] as string | undefined,
  }),
})

/** GH342 — formulaire du test en clés (brouillon face aux modifications faites ailleurs). Les
 *  étapes forment une seule clé (liste enregistrée en bloc) ; un test sans étape en montre une vide. */
function testDraft(tc: TestCase): Draft {
  const fields: Record<string, string> = {}
  if (tc.fields && typeof tc.fields === 'object') {
    for (const [k, v] of Object.entries(tc.fields as Record<string, unknown>)) fields[k] = fieldValueToText(v)
  }
  const steps: StepDraft[] = (tc.steps ?? [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .map(s => ({ action: s.action, expectedResult: s.expectedResult }))
  return {
    title: tc.title ?? '',
    type: tc.objectTypeRef ?? '',
    status: tc.status ?? '',
    preconditions: tc.preconditions ?? '',
    postconditions: tc.postconditions ?? '',
    steps: JSON.stringify(steps.length > 0 ? steps : [{ action: '', expectedResult: '' }]),
    ...fieldKeys(fields),
  }
}

function TestCaseDetailPage() {
  const { t } = useTranslation()
  const { testId } = Route.useParams()
  const qc = useQueryClient()
  const { repoPath, projectId } = Route.useSearch()

  const [saveError, setSaveError] = useState<string | null>(null)

  const { data: tc, isLoading } = useQuery<TestCase>({
    queryKey: ['test', repoPath, testId],
    queryFn: () => api.tests.get(repoPath, testId),
    enabled: !!repoPath,
  })

  const { data: schema } = useProjectSchema(repoPath)
  const testTypes = getAllObjectTypes(schema, 'test')
  // GH342 — brouillon réconcilié avec l'objet relu : un champ changé ailleurs est adopté, sauf s'il
  // est en cours de saisie ici (bandeau) ; l'enregistrement n'envoie que les champs modifiés ici.
  const server = useMemo(() => (tc ? testDraft(tc) : undefined), [tc])
  const form = useDraftForm(server, `${repoPath}::${testId}`)
  const d = form.draft
  const title = d['title'] ?? ''
  const type = d['type'] ?? ''
  const status = d['status'] ?? ''
  const preconditions = d['preconditions'] ?? ''
  const postconditions = d['postconditions'] ?? ''
  const stepsJson = d['steps']
  const steps = useMemo<StepDraft[]>(() => (stepsJson ? JSON.parse(stepsJson) as StepDraft[] : []), [stepsJson])
  const fields = useMemo(() => draftFields(d), [d])
  const setTitle = (v: string) => form.set('title', v)
  const setType = (v: string) => form.set('type', v)
  const setStatus = (v: string) => form.set('status', v)
  const setPreconditions = (v: string) => form.set('preconditions', v)
  const setPostconditions = (v: string) => form.set('postconditions', v)
  const setSteps = (v: StepDraft[]) => form.set('steps', JSON.stringify(v))
  const setField = (name: string, v: string) => form.set(`field:${name}`, v)

  const typeDef = getTestTypeDef(schema, tc?.objectTypeRef ?? type)

  // Pas « modifiée » avant que le formulaire ait copié l'objet (gh228 E5) : `changed` est vide tant
  // que le brouillon n'est pas initialisé.
  const hasChanges = form.changed.length > 0
  useRegisterTabDirty(hasChanges)
  useSetTabTitle(tc?.title)

  const saveMutation = useMutation({
    // GH342 — base posée dès l'envoi : l'écho de notre écriture n'est pas un conflit.
    onMutate: (values: Draft) => form.markSaved(values),
    mutationFn: (values: Draft) => {
      const changedFields = draftFields(values)
      const sentSteps = 'steps' in values ? JSON.parse(values['steps']) as StepDraft[] : null
      return api.tests.update(repoPath, testId, {
        ...('title' in values ? { title: values['title'] } : {}),
        ...('type' in values ? { objectTypeRef: values['type'] } : {}),
        ...('status' in values ? { status: values['status'] } : {}),
        ...('preconditions' in values ? { preconditions: values['preconditions'].trim() || undefined } : {}),
        ...(sentSteps ? { steps: sentSteps.map((s, i) => ({ order: i + 1, action: s.action, expectedResult: s.expectedResult, notes: null })) } : {}),
        ...('postconditions' in values ? { postconditions: values['postconditions'].trim() || undefined } : {}),
        ...(Object.keys(changedFields).length > 0 ? { fields: changedFields } : {}),
      }, projectId ? decodeProjectId(projectId) : undefined)
    },
    onSuccess: (result, values) => {
      // GH206 — passage de statut notifié : motifs affichés, sans confirmation.
      notifyTransitionResult(result, testId)
      qc.invalidateQueries({ queryKey: transitionPreviewKey(repoPath) })
      qc.invalidateQueries({ queryKey: ['tests', repoPath] })
      qc.invalidateQueries({ queryKey: ['test', repoPath, testId] })
      setSaveError(null)
    },
    onError: (err: unknown, _values, previous) => {
      if (previous) form.restoreBase(previous)
      setSaveError(err instanceof Error ? err.message : t('common.unknownError'))
    },
  })

  const handleSave = () => {
    if (steps.length === 0) { setSaveError(t('testsPage.atLeastOneStepRequired')); return }
    const emptyStep = steps.findIndex(s => !s.action.trim() || !s.expectedResult.trim())
    if (emptyStep !== -1) { setSaveError(t('testsPage.stepIncomplete', { index: emptyStep + 1 })); return }
    setSaveError(null)
    saveMutation.mutate(form.changedValues())
  }

  // Ctrl/Cmd+Entrée depuis un champ richtext (champ perso ou cellule d'étape) → « Enregistrer ».
  const submitEdit = () => { if (hasChanges && !saveMutation.isPending) handleSave() }

  if (!repoPath) return <p className="text-sm text-ink-2 p-4"><Trans i18nKey="testsPage.missingRepoPath" components={{ code: <code /> }} /></p>
  if (isLoading) return <p className="text-sm text-ink-3 p-4">{t('common.loading')}</p>
  if (!tc) return <p className="text-sm text-ink-2 p-4">{t('testsPage.notFound', { testId })}</p>

  // GH200 — test approuvé (statut du formulaire) : contenu en lecture seule ; choisir un autre
  // statut le rouvre et rend le contenu modifiable dans le même enregistrement.
  const locked = !!typeDef?.statuses?.find(s => s.name === status)?.isApproval

  const conflictLabel = (key: string): string => {
    switch (key) {
      case 'title': return t('requirementsPage.titleLabel')
      case 'type': return t('system.editView.colType')
      case 'status': return t('externalChange.status')
      case 'preconditions': return t('testsPage.preconditions')
      case 'postconditions': return t('testsPage.postconditions')
      case 'steps': return t('system.wordView.stepsHeading')
      default: return typeDef?.fields.find(f => `field:${f.name}` === key)?.label ?? key.replace(/^field:/, '')
    }
  }

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
                <TransitionScopeContext.Provider value={{ repoPath, category: 'test', workspaceDir: projectId ? decodeProjectId(projectId) : undefined }}>
                  <select
                    value={status}
                    onChange={e => setStatus(e.target.value)}
                    className="text-xs font-medium px-2 py-0.5 rounded bg-status-neutral-bg text-status-neutral border border-edge outline-none cursor-pointer"
                    data-testid="test-status-select"
                  >
                    {/* GH206 — options annotées par rapport au statut enregistré. */}
                    <TransitionStatusOptions
                      objectId={testId}
                      current={tc.status}
                      values={typeDef.statuses.map(s => s.name)}
                      labels={Object.fromEntries(typeDef.statuses.filter(s => s.label).map(s => [s.name, s.label!]))}
                    />
                  </select>
                </TransitionScopeContext.Provider>
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
          actions={
            <>
              <RichTextToolbar repoPath={repoPath} />
            </>
          }
        />

        <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl p-6 space-y-4">
          {locked && (
          <p className="text-xs text-ink-3 bg-surface-2 border border-edge rounded px-2 py-1" data-testid="approved-lock-banner">
            {t('system.editView.approvedLocked')}
          </p>
        )}
          <ExternalChangeBanner
            labels={form.conflicts.map(k => conflictLabel(k))}
            onReload={() => form.reload(form.conflicts)}
            onKeep={() => form.keep(form.conflicts)}
          />
          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              {t('requirementsPage.titleLabel')} <span className="text-status-danger">*</span>
            </label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} readOnly={locked}
              className="input-field w-full" />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-1">{t('system.editView.colType')}</label>
            <select value={type} onChange={e => setType(e.target.value)} disabled={locked} className="input-field w-full">
              {testTypes.map(t => (
                <option key={t.name} value={t.name}>{typeChoiceLabel(t, testTypes)}</option>
              ))}
            </select>
          </div>

          {typeDef?.fields.map(f => (
            <DynamicField key={f.name} field={f}
              value={fields[f.name] ?? String(f.default ?? '')}
              requiredNow={isFieldRequiredNow(f, objectFieldReader(typeDef, { status: tc.status, fields: fields }))}
              onChange={v => setField(f.name, v)}
              disabled={locked}
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
                  onChange={e => setField(key, e.target.value)} readOnly={locked}
                  className="input-field w-full" />
              </div>
            ))
          )}

          <div>
            <label className="block text-sm font-medium text-ink mb-1">{t('testsPage.preconditions')}</label>
            <textarea value={preconditions} onChange={e => setPreconditions(e.target.value)} readOnly={locked}
              rows={2} className="input-field w-full resize-none" />
          </div>

          <div>
            <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide mb-2">{t('system.wordView.stepsHeading')}</p>
            <LinkedReqValues repoPath={repoPath} testId={testId} workspaceDir={projectId ? decodeProjectId(projectId) : ''}>
              <StepsTable steps={steps} onChange={setSteps} disabled={locked} repoPath={repoPath} onSubmit={submitEdit} />
            </LinkedReqValues>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-1">{t('testsPage.postconditions')}</label>
            <textarea value={postconditions} onChange={e => setPostconditions(e.target.value)} readOnly={locked}
              rows={2} className="input-field w-full resize-none" />
          </div>

          {saveError && <p className="text-sm text-status-danger">{saveError}</p>}

          <div className="flex gap-3">
            <button type="button" onClick={handleSave}
              disabled={!hasChanges || saveMutation.isPending} className="btn-primary">
              {saveMutation.isPending ? t('requirementsPage.saving') : t('requirementsPage.save')}
            </button>
          </div>

          {/* GH197 — historique des exécutions. */}
          <ExecutionsSection repoPath={repoPath} projectId={projectId} workspaceDir={projectId ? decodeProjectId(projectId) : undefined} target={{ testId }} typeKey={tc.objectTypeRef} />

          {/* GH77 — historique des champs suivis (lecture seule). */}
          <HistorySection repoPath={repoPath} kind="test" id={testId} typeDef={typeDef}
            refreshKey={`${tc.status}:${JSON.stringify(tc.history ?? null)}`} />
        </div>
        </div>
      </div>
    </RichTextProvider>
    </ParamRefProvider>
  )
}
