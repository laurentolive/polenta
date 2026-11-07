/**
 * GH67 — confirmation du partage d'un dashboard privé avec ses requêtes privées. L'aperçu vient du
 * main (`dashboards:share-preview`) : une ligne par requête (widgets de ce dashboard, autres
 * dashboards privés remappés, titre déjà pris, bloquants) et les widgets dont la requête est
 * introuvable. Un échec en cours de route (`SCOPE_PARTIAL`) laisse les requêtes déjà partagées :
 * l'aperçu est relu, il ne liste plus que celles restées privées.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Dashboard } from '@polenta/types'
import { api } from '../../api'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'
import { BlockerLine, ScopeBlocked, ScopeModalFrame, ScopeWarning, invalidateAfterScopeChange, noteQueryRenamed, scopeErrorText, useWidgetRefText } from './ScopeChangeParts'

interface Props {
  repoPath: string
  username: string
  dashboardId: string
  onClose: () => void
  /** Après le partage : le dashboard sous son nouvel id. */
  onShared: (dashboard: Dashboard) => void
}

export function DashboardShareModal({ repoPath, username, dashboardId, onClose, onShared }: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const widgetRef = useWidgetRefText()
  const [error, setError] = useState<string | null>(null)

  const previewKey = ['dashboard-share-preview', repoPath, username, dashboardId]
  const { data: preview, isLoading, error: previewError } = useQuery({
    queryKey: previewKey,
    queryFn: () => api.dashboards.sharePreview(repoPath, username, dashboardId),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })

  const mutation = useMutation({
    mutationFn: () => api.dashboards.shareWithQueries(repoPath, username, dashboardId),
    onSuccess: (dashboard) => {
      // Requêtes promues : nouvel id lu sur un widget qui l'utilisait (une vue `/query` ouverte sur
      // l'ancien id le suit).
      for (const q of preview?.queries ?? []) {
        const newId = dashboard.widgets.find((w) => w.id === q.widgets[0]?.widgetId)?.queryId
        if (newId && newId !== q.queryId) noteQueryRenamed(q.queryId, newId)
      }
      invalidateAfterScopeChange(qc, repoPath, username, dashboardId)
      onShared(dashboard)
    },
    onError: (err) => {
      setError(scopeErrorText(err, t('dashboardPage.cannotChangeScope')))
      // Requêtes peut-être partagées en partie : listes et aperçu relus.
      invalidateAfterScopeChange(qc, repoPath, username)
      void qc.invalidateQueries({ queryKey: previewKey })
    },
  })

  const blocked = !preview || preview.missing.length > 0 || preview.queries.some((q) => q.blockers.length > 0)
  const confirm = () => { if (!blocked && !mutation.isPending) mutation.mutate() }
  // Pas de fermeture pendant l'écriture : l'issue (erreur ou navigation) doit rester visible.
  const close = () => { if (!mutation.isPending) onClose() }
  useModalHotkeys(close, confirm, mutation.isPending)

  return (
    <ScopeModalFrame
      title={t('suiviScope.dashboard.title')}
      testId="dashboard-share-modal"
      footer={<>
        <button type="button" onClick={close} disabled={mutation.isPending} className="btn-secondary">{t('common.cancel')}</button>
        {preview && !blocked && (
          <button type="button" onClick={confirm} disabled={mutation.isPending} className="btn-primary" data-testid="scope-confirm">
            {preview.queries.length === 0 ? t('suiviScope.dashboard.confirmNone') : t('suiviScope.dashboard.confirm', { count: preview.queries.length })}
          </button>
        )}
      </>}
    >
      {isLoading && <p className="text-ink-3">{t('common.loading')}</p>}
      {previewError && <ScopeBlocked>{scopeErrorText(previewError, t('dashboardPage.cannotChangeScope'))}</ScopeBlocked>}
      {preview && (
        <>
          {/* Aucune requête restée privée : cas d'une reprise après un échec partiel. */}
          {preview.queries.length > 0 && <p>{t('suiviScope.dashboard.intro', { count: preview.queries.length })}</p>}
          <ul className="space-y-2" data-testid="share-query-list">
            {preview.queries.map((q) => (
              <li key={q.queryId} className="border border-edge rounded p-2 space-y-1" data-testid="share-query">
                <p className="font-medium text-ink">{q.title}</p>
                <p className="text-ink-3">{t('suiviScope.dashboard.widgets', { list: q.widgets.map((w) => w.widgetTitle).join(', ') })}</p>
                {q.remapped.length > 0 && (
                  <p data-testid="scope-also-used">{t('suiviScope.alsoUsedBy', { list: q.remapped.map(widgetRef).join(', ') })}</p>
                )}
                {q.titleTakenBy.length > 0 && (
                  <ScopeWarning testId="scope-title-taken">{t('suiviScope.titleTaken', { count: q.titleTakenBy.length })}</ScopeWarning>
                )}
                {q.blockers.map((b, i) => <BlockerLine key={i} blocker={b} />)}
              </li>
            ))}
          </ul>
          {preview.missing.map((m) => (
            <ScopeBlocked key={m.widgetId}>{t('suiviScope.blocker.missing', { title: m.widgetTitle })}</ScopeBlocked>
          ))}
          <p>{t('suiviScope.dashboard.effect')}</p>
          <p className="text-ink-3">{t('suiviScope.dashboard.stayShared')}</p>
        </>
      )}
      {error && <ScopeBlocked testId="scope-error">{error}</ScopeBlocked>}
    </ScopeModalFrame>
  )
}
