/**
 * GH67 — éléments communs aux confirmations de changement de portée (requête seule, partage d'un
 * dashboard avec ses requêtes) : cadre de la fenêtre, lignes d'avertissement et de blocage.
 */
import type { ReactNode } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Ban } from 'lucide-react'
import type { QueryScopeBlocker, ScopeWidgetRef } from '@polenta/types'

export function ScopeModalFrame({ title, testId, children, footer }: { title: string; testId: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40">
      <div role="dialog" aria-label={title} data-testid={testId} className="bg-surface border border-edge rounded-lg shadow-xl p-6 w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        <h2 className="text-sm font-semibold text-ink mb-3">{title}</h2>
        <div className="flex-1 overflow-y-auto space-y-3 text-xs text-ink-2">{children}</div>
        <div className="flex gap-3 justify-end mt-5">{footer}</div>
      </div>
    </div>
  )
}

export function ScopeWarning({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p className="flex items-start gap-1.5 text-status-warning" data-testid={testId}>
      <AlertTriangle size={12} className="shrink-0 mt-0.5" /> <span>{children}</span>
    </p>
  )
}

export function ScopeBlocked({ children, testId = 'scope-blocker' }: { children: ReactNode; testId?: string }) {
  return (
    <div className="flex items-start gap-1.5 text-status-danger" data-testid={testId}>
      <Ban size={12} className="shrink-0 mt-0.5" /> <div>{children}</div>
    </div>
  )
}

export function useWidgetRefText() {
  const { t } = useTranslation()
  return (w: ScopeWidgetRef) => t('suiviScope.widgetRef', {
    widget: w.widgetTitle,
    dashboard: w.dashboardTitle,
    scope: t(w.dashboardScope === 'shared' ? 'sidebar.reorderable.shared' : 'sidebar.reorderable.private'),
  })
}

/** Un bloquant de requête, en clair. */
export function BlockerLine({ blocker }: { blocker: QueryScopeBlocker }) {
  const { t } = useTranslation()
  const widgetRef = useWidgetRefText()
  if (blocker.kind === 'read-only') {
    return <ScopeBlocked>{t('suiviScope.blocker.readOnly', { reason: t(`sidebar.reorderable.readOnlyBadge.${blocker.reason}`) })}</ScopeBlocked>
  }
  if (blocker.kind === 'params') return <ScopeBlocked>{t('suiviScope.blocker.params', { message: blocker.message })}</ScopeBlocked>
  return (
    <ScopeBlocked>
      {t('suiviScope.blocker.dependents', { count: blocker.widgets.length })}
      <ul className="list-disc ml-4 mt-1">
        {blocker.widgets.map((w) => <li key={`${w.dashboardId}/${w.widgetId}`}>{widgetRef(w)}</li>)}
      </ul>
    </ScopeBlocked>
  )
}

/** Clés à rafraîchir après un changement de portée (ids changés, widgets remappés, colonnes). */
export function invalidateAfterScopeChange(qc: QueryClient, repoPath: string, username: string): void {
  for (const key of ['queries', 'queries-order', 'dashboards', 'dashboards-order', 'dashboard']) {
    void qc.invalidateQueries({ queryKey: [key, repoPath, username] })
  }
  void qc.invalidateQueries({ queryKey: ['widget-query-result'] })
  void qc.invalidateQueries({ queryKey: ['suivi-updates'] })
}

/** Requêtes dont la portée vient de changer : nouvel id → ancien id. La vue `/query` ouverte sur
 *  l'ancien id s'en sert pour suivre le nouvel id sans recharger l'éditeur (modifications en cours
 *  conservées), que le changement vienne de `/query` ou du panneau latéral. */
const renamedQueries = new Map<string, string>()
export function noteQueryRenamed(oldId: string, newId: string): void {
  renamedQueries.set(newId, oldId)
}
export function queryRenamedFrom(newId: string | undefined): string | undefined {
  return newId ? renamedQueries.get(newId) : undefined
}

/** Message d'une erreur du main sans le préfixe de code (`SCOPE_PARTIAL: …`). */
export function scopeErrorText(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : ''
  return message.replace(/^(Error invoking remote method '[^']+': )?(Error: )?(SCOPE_[A-Z]+: )?/, '') || fallback
}
