import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { ProductVersion } from '@polenta/types'
import { isValidTagName } from '@polenta/types'
import { api } from '../../api'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'
import { useInvalidateVersions, versionErrorText } from './useVersions'

/**
 * GH201 §3 — passage released : tag pré-rempli `<projet>-<label>` (modifiable), contrôles du main
 * listés ; confirmation impossible tant qu'un contrôle échoue. Commit + tag annoté, poussé au
 * prochain push du repo.
 */
export function ReleaseVersionDialog({ repoPath, version, workspaceDir, onClose }: {
  repoPath: string
  version: ProductVersion
  workspaceDir: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const invalidate = useInvalidateVersions()
  // `null` : pas encore saisi — le tag proposé par le main s'affiche (une seule fois).
  const [typed, setTyped] = useState<string | null>(null)
  const [checkedTag, setCheckedTag] = useState<string | undefined>(undefined)
  const { data: preview, isLoading, isFetching } = useQuery({
    queryKey: ['versions', 'release-preview', repoPath, version.id, workspaceDir, checkedTag],
    queryFn: () => api.versions.releasePreview(repoPath, version.id, workspaceDir || undefined, checkedTag),
    staleTime: 0,
    placeholderData: prev => prev,
  })
  const tag = typed ?? preview?.suggestedTag ?? ''
  // Le tag saisi est contrôlé par le main (existe déjà ?) après une courte pause de frappe.
  useEffect(() => {
    if (typed === null) return
    const timer = setTimeout(() => setCheckedTag(typed.trim()), 300)
    return () => clearTimeout(timer)
  }, [typed])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const problems = preview?.problems ?? []
  const tagValid = isValidTagName(tag.trim())
  const upToDate = typed === null || checkedTag === typed.trim()
  const canConfirm = !isLoading && !isFetching && upToDate && problems.length === 0 && tagValid && !saving

  const submit = async () => {
    if (!canConfirm) return
    setSaving(true)
    setError(null)
    try {
      await api.versions.release(repoPath, version.id, tag.trim(), workspaceDir || undefined)
      await invalidate()
      onClose()
    } catch (err) {
      setError(versionErrorText(t, err))
    } finally {
      setSaving(false)
    }
  }
  useModalHotkeys(onClose, () => void submit())

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" onClick={onClose}>
      <div role="dialog" aria-label={t('versions.release.title')} className="bg-surface border border-edge rounded-lg shadow-xl w-[32rem] max-w-[95vw] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-edge">
          <h2 className="text-sm font-semibold text-ink">{t('versions.release.title')}</h2>
          <p className="text-xs text-ink-3 mt-0.5">{version.title} ({version.id})</p>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <p className="text-xs text-ink-2">{t('versions.release.explain')}</p>
          <label className="flex flex-col gap-1 text-xs text-ink-2">
            {t('versions.release.tag')}
            <input value={tag} onChange={e => setTyped(e.target.value)} className="input-field text-sm font-mono" data-testid="release-tag" />
          </label>
          {isLoading && <p className="text-xs text-ink-3 italic">{t('common.loading')}</p>}
          {problems.length > 0 && (
            <ul className="text-xs text-status-danger list-disc pl-4" data-testid="release-problems">
              {problems.map((p, i) => <li key={i}>{t(`versions.errors.${p.code}`, { detail: p.detail })}</li>)}
            </ul>
          )}
          {error && <p className="text-xs text-status-danger" role="alert">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-edge">
          <button type="button" onClick={onClose} className="btn-secondary">{t('common.cancel')}</button>
          <button type="button" onClick={() => void submit()} disabled={!canConfirm} className="btn-primary-sm" data-testid="release-confirm">
            {t('versions.release.confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
