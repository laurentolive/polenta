import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { isValidIntegrationSuffix } from '@polenta/types'
import { api } from '../../api'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'
import { branchErrorText } from '../../lib/branchErrors'

export interface NewIntegrationRequest {
  suffix: string
  /** Absent : depuis la branche d'intégration actuelle (ou le commit courant, cf. `atCommit`). */
  from?: { tag: string }
}

/**
 * GH106 — « Nouvelle branche d'intégration… » (spec GH103 §1.3) : préfixe `int-` imposé, nom
 * vérifié pendant la saisie (caractères, nom déjà pris en local ou sur `origin`), point de départ
 * au choix : la branche d'intégration actuelle ou une baseline. La création désigne la branche.
 */
export function NewIntegrationBranchModal({ repoPath, repoLabel, configured, atCommit, taken, onCancel, onSubmit }: {
  repoPath: string
  repoLabel: string
  configured: string
  /** Detached HEAD sans branche d'intégration existante : départ du commit courant (abrégé). */
  atCommit?: string
  /** `int-*` existantes (locales et distantes). */
  taken: string[]
  onCancel: () => void
  onSubmit: (req: NewIntegrationRequest) => Promise<void>
}) {
  const { t } = useTranslation()
  const [suffix, setSuffix] = useState('')
  const [source, setSource] = useState<'current' | 'baseline'>('current')
  const [tag, setTag] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: tags = [] } = useQuery({
    queryKey: ['sync:tags', repoPath],
    queryFn: () => api.sync.tags(repoPath),
    enabled: source === 'baseline',
  })

  const trimmed = suffix.trim()
  const invalid = trimmed !== '' && !isValidIntegrationSuffix(trimmed)
  const isTaken = trimmed !== '' && taken.includes(`int-${trimmed}`)
  const canSubmit = !pending && trimmed !== '' && !invalid && !isTaken && (source === 'current' || !!tag)

  async function submit() {
    if (!canSubmit) return
    setPending(true)
    setError(null)
    try {
      await onSubmit({ suffix: trimmed, ...(source === 'baseline' ? { from: { tag } } : {}) })
    } catch (err) {
      setError(branchErrorText(err))
    } finally {
      setPending(false)
    }
  }

  useModalHotkeys(onCancel, () => { void submit() }, pending)

  return (
    <div className="fixed inset-0 bg-overlay/50 flex items-center justify-center z-20" onClick={e => e.stopPropagation()}>
      <div role="dialog" aria-label={t('schema.newIntegrationBranch.title')} className="bg-surface border border-edge rounded-lg shadow-xl p-5 w-full max-w-md mx-4">
        <h2 className="font-semibold text-sm text-ink mb-1">{t('schema.newIntegrationBranch.title')}</h2>
        <p className="text-xs text-ink-3 mb-4">{repoLabel}</p>

        <label className="block text-xs text-ink-2 mb-1" htmlFor="new-int-suffix">{t('schema.newIntegrationBranch.name')}</label>
        <div className="flex items-center input-field py-0 pl-2 mb-1">
          <span className="text-xs font-mono text-ink-3 select-none">int-</span>
          <input
            id="new-int-suffix"
            autoFocus
            value={suffix}
            onChange={e => setSuffix(e.target.value)}
            className="flex-1 bg-transparent outline-none text-xs font-mono py-1"
          />
        </div>
        <p className="text-xs min-h-4 mb-3 text-status-danger">
          {invalid && t('schema.newIntegrationBranch.invalid')}
          {isTaken && t('schema.newIntegrationBranch.taken', { branch: `int-${trimmed}` })}
        </p>

        <fieldset className="mb-4">
          <legend className="text-xs text-ink-2 mb-1">{t('schema.newIntegrationBranch.from')}</legend>
          <label className="flex items-center gap-2 text-xs text-ink mb-1">
            <input type="radio" checked={source === 'current'} onChange={() => setSource('current')} />
            {atCommit
              ? t('schema.newIntegrationBranch.fromCommit', { commit: atCommit })
              : t('schema.newIntegrationBranch.fromCurrent', { branch: configured })}
          </label>
          <label className="flex items-center gap-2 text-xs text-ink">
            <input type="radio" checked={source === 'baseline'} onChange={() => setSource('baseline')} />
            {t('schema.newIntegrationBranch.fromBaseline')}
          </label>
          {source === 'baseline' && (
            <select
              value={tag}
              onChange={e => setTag(e.target.value)}
              aria-label={t('schema.newIntegrationBranch.fromBaseline')}
              className="input-field text-xs mt-2 w-full"
            >
              <option value="">{tags.length === 0 ? t('schema.newIntegrationBranch.noBaseline') : t('schema.newIntegrationBranch.pickBaseline')}</option>
              {tags.map(tg => <option key={tg} value={tg}>{tg}</option>)}
            </select>
          )}
        </fieldset>

        {error && <p className="text-xs text-status-danger mb-3">{error}</p>}

        <div className="flex gap-2 justify-end">
          {/* Not cancellable mid-request: the branch may already be created, designated and pushed. */}
          <button type="button" onClick={onCancel} disabled={pending} className="btn-secondary-sm">{t('common.cancel')}</button>
          <button type="button" onClick={() => void submit()} disabled={!canSubmit} className="btn-primary-sm">
            {pending ? t('schema.newIntegrationBranch.creating') : t('schema.newIntegrationBranch.create')}
          </button>
        </div>
      </div>
    </div>
  )
}
