import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useProjectSchema, getAllObjectTypes } from '../hooks/useProjectSchema'
import { DynamicField } from '../components/DynamicField'
import { ViewHeader } from '../components/layout/ViewHeader'

export const Route = createFileRoute('/req/new')({
  component: NewRequirementPage,
  validateSearch: (search: Record<string, unknown>) => ({
    repoPath: (search['repoPath'] as string) ?? '',
    projectId: (search['projectId'] as string) ?? '',
    type: (search['type'] as string) ?? '',
    component: search['component'] as string | undefined,
    level: search['level'] as string | undefined,
  }),
})

function buildDefaultFields(typeDef: { fields: Array<{ name: string; default?: unknown }> } | undefined): Record<string, string> {
  if (!typeDef) return {}
  const result: Record<string, string> = {}
  for (const f of typeDef.fields) {
    result[f.name] = f.default !== undefined ? String(f.default) : ''
  }
  return result
}

function NewRequirementPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { repoPath, projectId, type: typeParam } = Route.useSearch()

  const { data: schema, isLoading: schemaLoading } = useProjectSchema(repoPath)
  const reqTypes = getAllObjectTypes(schema, 'requirement')

  const firstTypeName = reqTypes[0]?.name ?? ''
  const [type, setType] = useState(typeParam || firstTypeName)
  const [title, setTitle] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [fieldsInitialized, setFieldsInitialized] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (schema && !fieldsInitialized) {
      const allTypes = getAllObjectTypes(schema, 'requirement')
      const resolvedType = typeParam || allTypes[0]?.name || ''
      setType(resolvedType)
      const typeDef = allTypes.find(t => t.name === resolvedType)
      setFields(buildDefaultFields(typeDef))
      setFieldsInitialized(true)
    }
  }, [schema, fieldsInitialized, typeParam])

  const handleTypeChange = (newType: string) => {
    setType(newType)
    const typeDef = reqTypes.find(t => t.name === newType)
    setFields(buildDefaultFields(typeDef))
  }

  const typeDef = reqTypes.find(t => t.name === type)

  const createMutation = useMutation({
    mutationFn: () => api.requirements.create(repoPath, { objectTypeRef: type, title, fields }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['requirements', repoPath] })
      navigate({ to: '/req/$reqId', params: { reqId: result.id }, search: { repoPath, projectId, component: undefined, level: undefined } })
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : t('common.unknownError')),
  })

  const isDisabled = schemaLoading || createMutation.isPending

  const submitForm = () => {
    if (isDisabled) return
    if (!title.trim()) { setError(t('requirementsPage.titleRequired')); return }
    if (!repoPath) { setError(t('requirementsPage.projectNotLoadedGoHome')); return }
    setError(null)
    createMutation.mutate()
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    submitForm()
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ViewHeader currentProjectId={projectId} title={t('requirementsPage.newTitle')} />

      <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl p-6">

      {schemaLoading && <p className="text-sm text-ink-3 mb-4">{t('schema.page.loading')}</p>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            {t('requirementsPage.titleLabel')} <span className="text-status-danger">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={t('requirementsPage.titlePlaceholder')}
            className="input-field w-full"
            autoFocus
            disabled={isDisabled}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            {t('system.editView.colType')} <span className="text-status-danger">*</span>
          </label>
          {schema ? (
            <select
              value={type}
              onChange={e => handleTypeChange(e.target.value)}
              className="input-field w-full"
              disabled={isDisabled}
            >
              {reqTypes.map(t => (
                <option key={t.name} value={t.name}>{t.label ?? t.name}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={type}
              onChange={e => setType(e.target.value)}
              className="input-field w-full"
              disabled={isDisabled}
            />
          )}
        </div>

        {typeDef?.fields.map(f => (
          <DynamicField
            key={f.name}
            field={f}
            value={fields[f.name] ?? String(f.default ?? '')}
            onChange={v => setFields(prev => ({ ...prev, [f.name]: v }))}
            disabled={isDisabled}
            repoPath={repoPath}
            interfaceRoles={schema?.roles?.map(r => r.name)}
            onSubmit={submitForm}
          />
        ))}

        {error && <p className="text-sm text-status-danger">{error}</p>}

        <div className="flex gap-3">
          <button type="submit" disabled={isDisabled} className="btn-primary">
            {createMutation.isPending ? t('common.creating') : t('requirementsPage.createRequirement')}
          </button>
          <button
            type="button"
            onClick={() => navigate({ to: '/schema', search: { repoPath, projectId } })}
            className="btn-secondary"
          >
            {t('common.cancel')}
          </button>
        </div>
      </form>
      </div>
      </div>
    </div>
  )
}
