import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { flattenSystemNodes, isFieldRequiredNow, objectFieldReader } from '@polenta/types'
import { api } from '../api'
import { decodeProjectId } from '../lib/projectId'
import { ViewHeader } from '../components/layout/ViewHeader'
import { DynamicField } from '../components/DynamicField'
import { NoTypeForCategory } from '../components/system/NoTypeForCategory'
import { RichTextProvider } from '../contexts/RichTextContext'
import { getObjectTypeRefs } from '../hooks/useProjectSchema'
import { useWorkspaceStructure } from '../hooks/useWorkspaceStructure'
import { repoName } from '../components/sidebar/ChangesPanel'
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
    enabled: !!projectId,
  })
  const openRepo = project?.localPath ?? ''
  const { flatNodes, schemasByRepoPath } = useWorkspaceStructure(workspaceDir, openRepo)

  // Composant concerné : un composant local de n'importe quel repo du workspace. Le change est
  // stocké dans ce repo, avec ses types (#193 §4) — il suit le composant réutilisé ailleurs.
  const targets = useMemo(() => {
    const repos = [openRepo, ...flatNodes.map(n => n.repoPath)].filter((rp, i, all) => !!rp && all.indexOf(rp) === i)
    const multiRepo = repos.length > 1
    return repos.flatMap(rp => {
      const repoSchema = schemasByRepoPath.get(rp)
      const repoLabel = flatNodes.find(n => n.repoPath === rp)?.label || repoName(rp)
      const hasType = getObjectTypeRefs(repoSchema, 'change').length > 0
      return flattenSystemNodes(repoSchema?.nodes ?? []).map(({ node }) => node).filter(n => n.objectTypes !== undefined)
        .map(n => ({ repoPath: rp, node: n.name, hasType, label: multiRepo ? `${repoLabel} › ${n.label || n.name}` : n.label || n.name }))
    })
  }, [openRepo, flatNodes, schemasByRepoPath])

  const [typeRef, setTypeRef] = useState('')
  const [title, setTitle] = useState('')
  const [targetKey, setTargetKey] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})

  const keyOf = (x: { repoPath: string; node: string }) => `${x.repoPath}\n${x.node}`
  const elementRepo = repoFromSearch || openRepo
  const usable = targets.filter(x => x.hasType)
  const defaultTarget = targets.find(x => x.hasType && x.repoPath === elementRepo && x.node === componentFromSearch)
    ?? (usable.length === 1 ? usable[0] : undefined)
  const target = targets.find(x => keyOf(x) === targetKey) ?? defaultTarget
  const repoPath = target?.repoPath ?? ''
  const schema = schemasByRepoPath.get(repoPath)

  const types = getObjectTypeRefs(schema, 'change')
  const selectedRef = types.some(x => x.ref === typeRef) ? typeRef : types.length === 1 ? types[0].ref : ''
  const typeDef = types.find(x => x.ref === selectedRef)?.typeDef
  const initial = typeDef?.statuses?.[0]?.name ?? ''
  const reader = typeDef ? objectFieldReader(typeDef, { status: initial, fields }) : null
  const requiredFields = typeDef && reader ? typeDef.fields.filter(f => isFieldRequiredNow(f, reader)) : []
  // Élément pré-rempli : seulement s'il appartient au repo du change (listes du repo, Q3).
  const prefill = element && repoPath === elementRepo ? element : undefined
  const effectiveComponent = target?.node ?? ''

  const create = useMutation({
    mutationFn: () => api.changes.create(repoPath, {
      objectTypeRef: selectedRef,
      title,
      ...(effectiveComponent && { component: effectiveComponent }),
      fields: Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== '')),
      ...(prefill && { toModify: [{ id: prefill, state: 'planned' as const }] }),
    }, workspaceDir || undefined),
    onSuccess: change => {
      qc.invalidateQueries({ queryKey: ['changes'] })
      navigate({ to: '/change/$changeId', params: { changeId: change.id }, search: { projectId, repoPath: change.repoPath } })
    },
  })
  const canCreate = !!target && !!selectedRef && !!title.trim() && !create.isPending
  const submit = () => { if (canCreate) create.mutate() }

  const labelClass = 'block text-sm font-medium text-ink mb-1'
  const inputClass = 'w-full text-sm bg-surface border border-edge rounded px-2 py-1.5 text-ink'

  return (
    <RichTextProvider>
      <div className="flex flex-col h-full overflow-hidden">
        <ViewHeader title={t('changes.new')} currentProjectId={projectId} />
        <div className="flex-1 overflow-y-auto">
          {!openRepo || (targets.length === 0 && flatNodes.length === 0) ? (
            <p className="p-8 text-sm text-ink-3">{openRepo ? t('common.loading') : t('common.projectNotLoaded')}</p>
          ) : usable.length === 0 ? (
            <NoTypeForCategory category="change" repoPath={openRepo} projectId={projectId} />
          ) : (
            <form className="max-w-2xl p-6 space-y-4" onSubmit={e => { e.preventDefault(); submit() }} data-testid="change-new-form">
              {targets.length > 1 && (
                <div>
                  <label className={labelClass}>{t('changes.component')}<span className="text-status-danger ml-1">*</span></label>
                  <select className={inputClass} value={target ? keyOf(target) : ''} onChange={e => setTargetKey(e.target.value)} data-testid="change-new-component">
                    <option value="">{t('changes.componentPick')}</option>
                    {targets.map(x => (
                      <option key={keyOf(x)} value={keyOf(x)} disabled={!x.hasType}>
                        {x.hasType ? x.label : `${x.label} — ${t('changes.noTypeInRepo')}`}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-ink-3 mt-1">{t('changes.componentHelp')}</p>
                </div>
              )}
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
              {prefill && (
                <p className="text-sm text-ink-2">
                  {t('changes.toModify')} : <span className="font-mono">{prefill}</span>
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
                  interfaceRoles={schema?.roles?.map(r => r.name)}
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
