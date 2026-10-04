import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CloudOff, RefreshCw } from 'lucide-react'
import { api } from '../../api'
import { decodeProjectId } from '../../lib/projectId'
import { useWorkspaceStructure } from '../../hooks/useWorkspaceStructure'
import { useResyncIntegration, useWorkspaceSyncAlerts, type RepoSyncAlert } from '../../hooks/useIntegrationSync'
import { PublishPopover } from './ModificationControl'

interface Props {
  currentProjectId: string | null
}

function repoName(node: { name: string; label?: string }): string {
  return node.label || node.name
}

/**
 * GH39 — header alert shown while at least one repo's integration branch is ahead of `origin`
 * (unpushed) or diverged from it; its popover lists those repos with their last sync error and a
 * "Resynchroniser" action each. Renders nothing otherwise — including in a project without remote.
 * See specs/GH39.md §3.1.
 */
export function SyncIndicator({ currentProjectId }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const { data: project } = useQuery({
    queryKey: ['workspace', currentProjectId],
    queryFn: () => api.workspace.resolve(decodeProjectId(currentProjectId as string)),
    enabled: !!currentProjectId,
  })
  const { flatNodes } = useWorkspaceStructure(project?.workspaceDir ?? '', project?.localPath ?? '')
  const alerts = useWorkspaceSyncAlerts(flatNodes)
  const { resync, pendingRepoPath, anyPending, setAside, reset } = useResyncIntegration()

  // The set-aside explanation must outlive the repo leaving the alert list (that's what a
  // successful set-aside does), so the popover stays open on it.
  if (alerts.length === 0 && !setAside && !open) return null

  // A resync still running is not reset: its set-aside outcome must still reopen the popover.
  function close() {
    setOpen(false)
    if (!pendingRepoPath) reset()
  }

  return (
    <div className="relative shrink-0">
      {alerts.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={t('layout.syncIndicator.title')}
          className="flex items-center gap-1 text-xs text-status-warning bg-status-warning-bg border border-status-warning-border rounded px-2 py-1 hover:opacity-80"
        >
          <CloudOff size={13} />
          {alerts.length}
        </button>
      )}

      {(open || setAside) && (
        <PublishPopover onClose={close}>
          <h2 className="font-semibold text-sm text-ink mb-2">{t('layout.syncIndicator.title')}</h2>
          {setAside && (
            <p className="text-xs text-status-info mb-3">
              {t('layout.syncIndicator.setAside', { branch: setAside.branch })}
            </p>
          )}
          {alerts.length === 0 ? (
            !setAside && <p className="text-xs text-ink-3">{t('layout.syncIndicator.allSynced')}</p>
          ) : (
            <>
              <p className="text-xs text-ink-2 mb-2">{t('layout.syncIndicator.intro')}</p>
              <ul className="space-y-2">
                {alerts.map(a => (
                  <SyncAlertRow
                    key={a.node.repoPath}
                    alert={a}
                    pending={pendingRepoPath === a.node.repoPath}
                    disabled={anyPending}
                    onResync={() => resync(a.node.repoPath, repoName(a.node))}
                  />
                ))}
              </ul>
            </>
          )}
          <div className="flex justify-end mt-4">
            <button type="button" onClick={close} className="btn-secondary-sm">{t('common.close')}</button>
          </div>
        </PublishPopover>
      )}
    </div>
  )
}

function SyncAlertRow({ alert, pending, disabled, onResync }: {
  alert: RepoSyncAlert
  pending: boolean
  disabled: boolean
  onResync: () => void
}) {
  const { t } = useTranslation()
  const { info, lastError, node } = alert
  return (
    <li className="border border-edge-subtle rounded px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-ink truncate">
            {repoName(node)} <span className="font-mono text-ink-3">{info.integrationBranch}</span>
          </p>
          <p className="text-xs text-status-warning">
            {info.state === 'diverged'
              ? t('layout.syncIndicator.diverged', { ahead: info.ahead, behind: info.behind })
              : t('layout.syncIndicator.ahead', { count: info.ahead })}
          </p>
        </div>
        <button
          type="button"
          onClick={onResync}
          disabled={disabled}
          className="btn-sm flex items-center gap-1 shrink-0"
        >
          <RefreshCw size={11} className={pending ? 'animate-spin' : ''} />
          {pending ? t('layout.syncIndicator.resyncing') : t('layout.syncIndicator.resync')}
        </button>
      </div>
      {lastError && (
        <p className="text-xs text-status-danger mt-1 break-words">
          {t('layout.syncIndicator.lastError', { error: lastError })}
        </p>
      )}
    </li>
  )
}
