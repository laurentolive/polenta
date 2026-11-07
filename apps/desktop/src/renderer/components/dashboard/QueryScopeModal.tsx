/**
 * GH67 — confirmation du changement de portée d'une requête seule (vue `/query`, panneau latéral).
 * L'aperçu vient du main (`queries:scope-preview`) : effet, autres dashboards privés remappés, titre
 * déjà pris, colonne calculée retirée, bloquants. Rien n'est écrit sans confirmation ; un bloquant
 * retire le bouton de confirmation.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryScope, SavedQuery } from '@polenta/types'
import { labelText } from '@polenta/types'
import { api } from '../../api'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'
import { BlockerLine, ScopeBlocked, ScopeModalFrame, ScopeWarning, invalidateAfterScopeChange, noteQueryRenamed, scopeErrorText, useWidgetRefText } from './ScopeChangeParts'

interface Props {
  repoPath: string
  username: string
  query: { id: string; title: string; scope: QueryScope }
  onClose: () => void
  /** Après le changement : la requête sous son nouvel id. */
  onChanged: (updated: SavedQuery) => void
}

export function QueryScopeModal({ repoPath, username, query, onClose, onChanged }: Props) {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const widgetRef = useWidgetRefText()
  const to: QueryScope = query.scope === 'shared' ? 'private' : 'shared'
  const [error, setError] = useState<string | null>(null)
  const locale = (i18n.resolvedLanguage ?? i18n.language ?? 'fr').startsWith('en') ? 'en' : 'fr'

  const { data: preview, isLoading, error: previewError } = useQuery({
    queryKey: ['query-scope-preview', repoPath, username, query.id, to],
    queryFn: () => api.queries.scopePreview(repoPath, username, query.id, to),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })

  const mutation = useMutation({
    mutationFn: () => api.queries.setScope(repoPath, username, query.id, to),
    onSuccess: (updated) => {
      noteQueryRenamed(query.id, updated.id)
      invalidateAfterScopeChange(qc, repoPath, username)
      onChanged(updated)
    },
    onError: (err) => setError(scopeErrorText(err, t('dashboardPage.cannotChangeScope'))),
  })

  const blocked = !preview || preview.blockers.length > 0
  const confirm = () => { if (!blocked && !mutation.isPending) mutation.mutate() }
  // Pas de fermeture pendant l'écriture : l'issue (erreur ou navigation) doit rester visible.
  const close = () => { if (!mutation.isPending) onClose() }
  useModalHotkeys(close, confirm, mutation.isPending)

  const titleKey = to === 'shared' ? 'suiviScope.query.toSharedTitle' : 'suiviScope.query.toPrivateTitle'
  return (
    <ScopeModalFrame
      title={t(titleKey)}
      testId="query-scope-modal"
      footer={<>
        <button type="button" onClick={close} disabled={mutation.isPending} className="btn-secondary">{t('common.cancel')}</button>
        {preview && !blocked && (
          <button type="button" onClick={confirm} disabled={mutation.isPending} className="btn-primary" data-testid="scope-confirm">
            {t(to === 'shared' ? 'suiviScope.query.confirmShared' : 'suiviScope.query.confirmPrivate')}
          </button>
        )}
      </>}
    >
      {isLoading && <p className="text-ink-3">{t('common.loading')}</p>}
      {previewError && <ScopeBlocked>{scopeErrorText(previewError, t('dashboardPage.cannotChangeScope'))}</ScopeBlocked>}
      {preview && (
        <>
          <p>{t(to === 'shared' ? 'suiviScope.query.sharedEffect' : 'suiviScope.query.privateEffect', { title: preview.title })}</p>
          <p className="text-ink-3">{t('suiviScope.query.savedOnly')}</p>
          {preview.remapped.length > 0 && (
            <p data-testid="scope-also-used">
              {t('suiviScope.alsoUsedBy', { list: preview.remapped.map(widgetRef).join(', ') })}
            </p>
          )}
          {preview.titleTakenBy.length > 0 && (
            <ScopeWarning testId="scope-title-taken">{t('suiviScope.titleTaken', { count: preview.titleTakenBy.length })}</ScopeWarning>
          )}
          {preview.columnRemoved !== null && (
            <ScopeWarning testId="scope-column-removed">{t('suiviScope.query.columnRemoved', { label: labelText(preview.columnRemoved, locale) })}</ScopeWarning>
          )}
          {preview.blockers.map((b, i) => <BlockerLine key={i} blocker={b} />)}
        </>
      )}
      {error && <ScopeBlocked testId="scope-error">{error}</ScopeBlocked>}
    </ScopeModalFrame>
  )
}
