import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { ProductVersion, VersionComponentNode, VersionSummary } from '@polenta/types'
import { api } from '../../api'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'
import { useInvalidateVersions, versionErrorText } from './useVersions'
import { backdropDismiss } from '../../lib/backdropDismiss'

const lastReleased = (versions: VersionSummary[]) => versions.find(v => v.state === 'released')?.id ?? ''

/**
 * GH201 §2 — création d'une version : label, version précédente (dernière released par défaut),
 * versions des composants (dernière released de chaque dépendance qui a un type version).
 */
export function NewVersionDialog({ node, workspaceDir, onCreated, onClose }: {
  node: VersionComponentNode
  workspaceDir: string
  onCreated: (v: ProductVersion) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const invalidate = useInvalidateVersions()
  const deps = node.children.filter(c => c.versionType)
  const [title, setTitle] = useState('')
  const [basedOn, setBasedOn] = useState(lastReleased(node.versions))
  const [components, setComponents] = useState<Record<string, string>>(
    Object.fromEntries(deps.map(d => [d.name, lastReleased(d.versions)])),
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!title.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      const created = await api.versions.create(node.repoPath, { title: title.trim(), basedOn: basedOn || null, components }, workspaceDir || undefined)
      await invalidate()
      onCreated(created)
    } catch (err) {
      setError(versionErrorText(t, err))
    } finally {
      setSaving(false)
    }
  }
  useModalHotkeys(onClose, () => void submit())

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" {...backdropDismiss(onClose)}>
      <div role="dialog" aria-label={t('versions.new.title')} className="bg-surface border border-edge rounded-lg shadow-xl w-[28rem] max-w-[95vw] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-edge">
          <h2 className="text-sm font-semibold text-ink">{t('versions.new.title')}</h2>
          <p className="text-xs text-ink-3 mt-0.5">{node.label}</p>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-ink-2">
            {t('versions.label')}
            <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="1.0.0" className="input-field text-sm" data-testid="new-version-title" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-2">
            {t('versions.basedOn')}
            <select value={basedOn} onChange={e => setBasedOn(e.target.value)} className="input-field text-sm" data-testid="new-version-based-on">
              <option value="">{t('versions.none')}</option>
              {node.versions.filter(v => v.state === 'released').map(v => (
                <option key={v.id} value={v.id}>{v.title} ({v.id})</option>
              ))}
            </select>
          </label>
          {deps.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-ink-2">{t('versions.components')}</p>
              {deps.map(d => (
                <label key={d.name} className="flex items-center gap-2 text-xs text-ink-2">
                  <span className="w-32 truncate" title={d.label}>{d.label}</span>
                  <select
                    value={components[d.name] ?? ''}
                    onChange={e => setComponents(c => ({ ...c, [d.name]: e.target.value }))}
                    className="input-field text-xs flex-1"
                  >
                    <option value="">{t('versions.none')}</option>
                    {d.versions.filter(v => v.state !== 'abandoned').map(v => (
                      <option key={v.id} value={v.id}>{v.title} ({v.id}){v.state === 'in_progress' ? ` — ${t('versions.state.in_progress')}` : ''}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}
          {error && <p className="text-xs text-status-danger" role="alert">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-edge">
          <button type="button" onClick={onClose} className="btn-secondary">{t('common.cancel')}</button>
          <button type="button" onClick={() => void submit()} disabled={!title.trim() || saving} className="btn-primary-sm" data-testid="new-version-confirm">
            {t('versions.new.confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
