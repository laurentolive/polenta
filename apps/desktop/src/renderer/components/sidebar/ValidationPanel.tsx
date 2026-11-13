import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Lock } from 'lucide-react'
import type { ObjectTypeDefinition, ValidationVersionItem } from '@polenta/types'
import { fieldValueToText } from '@polenta/types'
import { api } from '../../api'
import { decodeProjectId } from '../../lib/projectId'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'
import { useProjectSchema } from '../../hooks/useProjectSchema'
import { ComponentTypeCombobox } from '../system/ComponentTypeCombobox'
import type { ComponentTypeOption } from '../../contexts/SystemViewContext'
import { DynamicField } from '../DynamicField'
import { flattenVersionTree } from './version/ProductVersionsPanel'
import { useVersionTree } from '../versions/useVersions'
import { isValidationPath, useInvalidateValidations, useValidationVersions, validationErrorText, VALIDATION_STATE_BADGE } from '../validation/useValidations'
import { backdropDismiss } from '../../lib/backdropDismiss'

const LAST_COMPONENT_KEY = 'polenta:validationComponent:'

function readLast(projectId: string): string | null {
  try { return localStorage.getItem(LAST_COMPONENT_KEY + projectId) } catch { return null }
}
function writeLast(projectId: string, repoPath: string): void {
  try { localStorage.setItem(LAST_COMPONENT_KEY + projectId, repoPath) } catch { /* stockage indisponible */ }
}

/** GH204 §7 — panneau de la vue Validation : un composant, ses versions, l'état de leur validation. */
export function ValidationPanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: s => s.location.pathname })
  const search = useRouterState({ select: s => s.location.search as Record<string, unknown> })
  const { data: tree, isLoading, error } = useVersionTree(projectId)
  const flat = useMemo(() => flattenVersionTree(tree ?? []), [tree])

  const urlRepo = isValidationPath(pathname) && typeof search['repoPath'] === 'string' ? search['repoPath'] as string : ''
  const [chosen, setChosen] = useState<string | null>(() => readLast(projectId))
  useEffect(() => { if (urlRepo) setChosen(urlRepo) }, [urlRepo])
  const selectedIndex = Math.max(0, flat.findIndex(f => f.node.repoPath === (urlRepo || chosen)))
  const current = flat[selectedIndex]?.node
  const repoPath = current?.repoPath ?? ''

  const { data: schema } = useProjectSchema(repoPath)
  const validationType = schema?.nodes?.find(n => n.name === 'root')?.objectTypes?.find(o => o.category === 'validation') ?? null
  const { data: items = [] } = useValidationVersions(validationType ? repoPath : '')
  const [creating, setCreating] = useState<ValidationVersionItem['version'] | null>(null)

  const options: ComponentTypeOption[] = flat.map(f => ({ repoName: f.node.repoPath, nodeId: '', typeId: '', label: f.label }))
  const open = (id: string) => void navigate({ to: '/validation/$validationId', params: { validationId: id }, search: { projectId, repoPath } })
  const shown = items.filter(i => i.version.state !== 'abandoned' || i.validation)

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="validation-panel">
      <div className="px-3 py-2 border-b border-edge shrink-0 flex items-center gap-2">
        <ComponentTypeCombobox options={options} selectedIndex={flat.length ? selectedIndex : -1} onSelect={opt => {
          setChosen(opt.repoName)
          writeLast(projectId, opt.repoName)
          void navigate({ to: '/validations', search: { projectId } })
        }} />
        {current?.readonly && <span title={t('validation.readonly')}><Lock size={12} className="text-status-warning shrink-0" /></span>}
      </div>
      <div className="flex-1 overflow-y-auto py-0.5">
        {isLoading && <p className="px-4 py-2 text-xs text-ink-3 italic">{t('common.loading')}</p>}
        {error && <p className="px-4 py-2 text-xs text-status-danger">{String(error)}</p>}
        {current && (!validationType || !current.versionType) && (
          <div className="px-4 py-3 flex flex-col gap-2 text-xs text-ink-2" data-testid="validation-no-type">
            <p>{t(validationType ? 'validation.noVersionType' : 'validation.noType')}</p>
            <button type="button" className="btn-secondary-sm self-start" onClick={() => void navigate({ to: '/schema', search: { repoPath: '', projectId } })}>{t('versions.openSchema')}</button>
          </div>
        )}
        {validationType && current?.versionType && shown.length === 0 && <p className="px-4 py-1 text-xs text-ink-3 italic">{t('versions.noVersion')}</p>}
        {validationType && current?.versionType && shown.map(item => {
          const active = !!item.validation && pathname === `/validation/${item.validation.id}`
          const validation = item.validation
          const canCreate = !validation && !current.readonly && item.version.state !== 'abandoned'
          // GH306 — toute la ligne est l'action (ouvrir la validation, ou la créer) ; seul le statut de la validation est affiché.
          const onClick = validation ? () => open(validation.id) : canCreate ? () => setCreating(item.version) : undefined
          const className = `w-full flex items-center gap-2 px-4 py-1 text-xs text-left ${active ? 'bg-hover text-prim font-medium' : 'text-ink-2'} ${onClick ? 'hover:bg-hover cursor-pointer' : ''}`
          const content = (
            <>
              <span className="flex-1 truncate">{item.version.title}</span>
              {validation ? (
                <span className={`px-1.5 rounded text-[10px] ${VALIDATION_STATE_BADGE[validation.state]}`} data-testid={`validation-open-${item.version.id}`}>
                  {t(`validation.state.${validation.state}`)}
                </span>
              ) : canCreate ? (
                <span className="text-prim" data-testid={`validation-create-${item.version.id}`}>{t('validation.create')}</span>
              ) : <span className="text-ink-3">—</span>}
            </>
          )
          return onClick
            ? <button type="button" key={item.version.id} className={className} onClick={onClick} data-testid={`validation-version-${item.version.id}`}>{content}</button>
            : <div key={item.version.id} className={className} data-testid={`validation-version-${item.version.id}`}>{content}</div>
        })}
      </div>
      {creating && validationType && (
        <NewValidationDialog
          repoPath={repoPath}
          workspaceDir={decodeProjectId(projectId) || undefined}
          version={creating}
          typeDef={validationType}
          onCreated={id => { setCreating(null); open(id) }}
          onClose={() => setCreating(null)}
        />
      )}
    </div>
  )
}

function NewValidationDialog({ repoPath, workspaceDir, version, typeDef, onCreated, onClose }: {
  repoPath: string
  workspaceDir?: string
  version: ValidationVersionItem['version']
  typeDef: ObjectTypeDefinition
  onCreated: (id: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const invalidate = useInvalidateValidations()
  const [title, setTitle] = useState(t('validation.defaultTitle', { version: version.title }))
  const [fields, setFields] = useState<Record<string, unknown>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const submit = async () => {
    if (!title.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      const created = await api.validations.create(repoPath, { versionId: version.id, title: title.trim(), fields }, workspaceDir)
      await invalidate()
      onCreated(created.id)
    } catch (err) {
      setError(validationErrorText(t, err))
      setSaving(false)
    }
  }
  useModalHotkeys(onClose)
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" {...backdropDismiss(onClose)}>
      <div role="dialog" aria-label={t('validation.newTitle')} className="bg-surface border border-edge rounded-lg shadow-xl w-[34rem] max-w-[95vw] max-h-[85vh] overflow-y-auto p-4 flex flex-col gap-3" onClick={e => e.stopPropagation()} data-testid="new-validation-dialog">
        <h2 className="text-sm font-semibold text-ink">{t('validation.newTitle')}</h2>
        <p className="text-xs text-ink-3">{t('validation.newHint', { version: version.title })}</p>
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          {t('validation.titleLabel')}
          <input value={title} onChange={e => setTitle(e.target.value)} className="input-field text-sm" data-testid="new-validation-title" />
        </label>
        {typeDef.fields.map(f => (
          <DynamicField key={f.name} field={f} value={fieldValueToText(fields[f.name])} repoPath={repoPath} onChange={v => setFields(prev => ({ ...prev, [f.name]: v }))} />
        ))}
        {error && <p className="text-xs text-status-danger" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary-sm" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn-primary-sm" disabled={!title.trim() || saving} onClick={() => void submit()} data-testid="new-validation-submit">{t('validation.create')}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
