import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { flattenSystemNodes, isFieldRequiredNow, objectFieldReader } from '@polenta/types'
import { api } from '../api'
import { decodeProjectId } from '../lib/projectId'
import { ViewHeader } from '../components/layout/ViewHeader'
import { DynamicField } from '../components/DynamicField'
import { NoTypeForCategory } from '../components/system/NoTypeForCategory'
import { RichTextProvider } from '../contexts/RichTextContext'
import { useProjectSchema, getObjectTypeRefs } from '../hooks/useProjectSchema'
import { useSetTabTitle } from '../contexts/TabsContext'

/**
 * GH198 — création d'une demande de changement (specs/GH198.md §5). URL :
 * /change/new?projectId=<encoded>[&repoPath=<repo de l'élément>][&element=<ID>][&component=<nœud>]
 * `element` : « Créer un change » depuis un élément, ajouté à « à modifier » (Q4).
 */
export const Route = createFileRoute('/change/new')({
  component: NewChangePage,
  validateSearch: (s: Record<string, unknown>) => ({
    projectId: (s['projectId'] as string) ?? '',
    repoPath: s['repoPath'] as string | undefined,
    element: s['element'] as string | undefined,
    component: s['component'] as string | undefined,
  }),
})

function NewChangePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { projectId, repoPath: repoFromSearch, element, component: componentFromSearch } = Route.useSearch()
  useSetTabTitle(t('changes.new'))
  const workspaceDir = projectId ? decodeProjectId(projectId) : ''
  const { data: project } = useQuery({
    queryKey: ['workspace', projectId],
    queryFn: () => api.workspace.resolve(workspaceDir),
    enabled: !!projectId && !repoFromSearch,
  })
  const repoPath = repoFromSearch || project?.localPath || ''
  const { data: schema } = useProjectSchema(repoPath)

  const types = getObjectTypeRefs(schema, 'change')
  // Composants locaux du repo (un composant externe relève de L7, #208).
  const localNodes = flattenSystemNodes(schema?.nodes ?? []).map(({ node }) => node).filter(n => n.objectTypes !== undefined)
  const [typeRef, setTypeRef] = useState('')
  const [title, setTitle] = useState('')
  const [component, setComponent] = useState(componentFromSearch ?? '')
  const [fields, setFields] = useState<Record<string, string>>({})

  const selectedRef = typeRef || (types.length === 1 ? types[0].ref : '')
  const typeDef = types.find(x => x.ref === selectedRef)?.typeDef
  const initial = typeDef?.statuses?.[0]?.name ?? ''
  const reader = typeDef ? objectFieldReader(typeDef, { status: initial, fields }) : null
  const requiredFields = typeDef && reader ? typeDef.fields.filter(f => isFieldRequiredNow(f, reader)) : []
  // Composant : déduit quand le repo ne porte qu'un composant local, sinon à choisir (§3).
  const effectiveComponent = component || (localNodes.length === 1 ? localNodes[0].name : '')
  const componentMissing = localNodes.length > 1 && !effectiveComponent

  const create = useMutation({
    mutationFn: () => api.changes.create(repoPath, {
      objectTypeRef: selectedRef,
      title,
      ...(effectiveComponent && { component: effectiveComponent }),
      fields: Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== '')),
      ...(element && { toModify: [{ id: element, state: 'planned' as const }] }),
    }, workspaceDir || undefined),
    onSuccess: change => {
      qc.invalidateQueries({ queryKey: ['changes'] })
      navigate({ to: '/change/$changeId', params: { changeId: change.id }, search: { projectId, repoPath: change.repoPath } })
    },
  })
  const canCreate = !!selectedRef && !!title.trim() && !componentMissing && !create.isPending
  const submit = () => { if (canCreate) create.mutate() }

  const labelClass = 'block text-sm font-medium text-ink mb-1'
  const inputClass = 'w-full text-sm bg-surface border border-edge rounded px-2 py-1.5 text-ink'

  return (
    <RichTextProvider>
      <div className="flex flex-col h-full overflow-hidden">
        <ViewHeader title={t('changes.new')} currentProjectId={projectId} />
        <div className="flex-1 overflow-y-auto">
          {!schema ? (
            <p className="p-8 text-sm text-ink-3">{repoPath ? t('common.loading') : t('common.projectNotLoaded')}</p>
          ) : types.length === 0 ? (
            <NoTypeForCategory category="change" repoPath={repoPath} projectId={projectId} />
          ) : (
            <form className="max-w-2xl p-6 space-y-4" onSubmit={e => { e.preventDefault(); submit() }} data-testid="change-new-form">
              {types.length > 1 && (
                <div>
                  <label className={labelClass}>{t('changes.type')}<span className="text-status-danger ml-1">*</span></label>
                  <select className={inputClass} value={selectedRef} onChange={e => setTypeRef(e.target.value)} data-testid="change-new-type">
                    <option value="" />
                    {types.map(x => <option key={x.ref} value={x.ref}>{x.label}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className={labelClass}>{t('changes.titleLabel')}<span className="text-status-danger ml-1">*</span></label>
                <input className={inputClass} value={title} onChange={e => setTitle(e.target.value)} autoFocus data-testid="change-new-title" />
              </div>
              {localNodes.length > 1 && (
                <div>
                  <label className={labelClass}>
                    {t('changes.component')}<span className="text-status-danger ml-1">*</span>
                  </label>
                  <select className={inputClass} value={effectiveComponent} onChange={e => setComponent(e.target.value)} data-testid="change-new-component">
                    <option value="">{t('changes.componentPick')}</option>
                    {localNodes.map(n => <option key={n.name} value={n.name}>{n.label || n.name}</option>)}
                  </select>
                </div>
              )}
              {element && (
                <p className="text-sm text-ink-2">
                  {t('changes.toModify')} : <span className="font-mono">{element}</span>
                </p>
              )}
              {requiredFields.map(f => (
                <DynamicField
                  key={f.name}
                  field={f}
                  value={fields[f.name] ?? ''}
                  requiredNow
                  onChange={v => setFields(prev => ({ ...prev, [f.name]: v }))}
                  repoPath={repoPath}
                  interfaceRoles={schema.roles?.map(r => r.name)}
                  onSubmit={submit}
                />
              ))}
              {create.error && (
                <p className="text-sm text-status-danger">{create.error instanceof Error ? create.error.message : String(create.error)}</p>
              )}
              <button type="submit" className="btn-primary-sm" disabled={!canCreate} data-testid="change-new-submit">
                {create.isPending ? t('changes.creating') : t('changes.create')}
              </button>
            </form>
          )}
        </div>
      </div>
    </RichTextProvider>
  )
}
