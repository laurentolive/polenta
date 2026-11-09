import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { api } from '../../../api'
import { branchErrorText } from '../../../lib/branchErrors'

/**
 * GH336 §6 — « Polenta doit mettre à jour ce dépôt » : rien n'est écrit tant que l'utilisateur n'a
 * pas validé ; « Valider » écrit, commite ces seuls fichiers et pousse aussitôt. « Plus tard » masque
 * la ligne jusqu'à la prochaine ouverture du workspace (Q3 : jamais mémorisé).
 */

// « Plus tard » — par workspace ouvert, en mémoire seulement : re-proposé à la prochaine ouverture.
let dismissedFor = ''
const dismissed = new Set<string>()
function isDismissed(workspaceDir: string, repoPath: string): boolean {
  if (dismissedFor !== workspaceDir) {
    dismissedFor = workspaceDir
    dismissed.clear()
  }
  return dismissed.has(repoPath)
}

interface Props {
  repoPath: string
  workspaceDir: string
  /** Repo racine du workspace : seul concerné par AGENTS.md / .mcp.json. */
  root: boolean
  /** HEAD détaché (sous-repo épinglé) : jamais de proposition. */
  detached: boolean
  indent: number
}

export function ConformityNotice({ repoPath, workspaceDir, root, detached, indent }: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [hidden, setHidden] = useState(() => isDismissed(workspaceDir, repoPath))
  const [showDetails, setShowDetails] = useState(false)

  const { data: items = [], error: checkError } = useQuery({
    queryKey: ['conformity:check', repoPath, root],
    queryFn: () => api.conformity.check(repoPath, root),
    enabled: !!repoPath && !detached && !hidden,
    refetchInterval: 30_000,
  })

  const apply = useMutation({
    mutationFn: () => api.conformity.apply(repoPath, root),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['conformity:check', repoPath] })
      qc.invalidateQueries({ queryKey: ['sync:status', repoPath] })
      qc.invalidateQueries({ queryKey: ['sync:integration-state', repoPath] })
    },
  })

  const result = apply.data
  if (detached || hidden) return null
  if (items.length === 0 && !result && !apply.isError && !checkError) return null

  const errorText = (() => {
    if (!apply.error) return null
    const msg = branchErrorText(apply.error)
    if (msg.startsWith('conformity-dirty')) return t('sidebar.version.conformity.errorDirty')
    if (msg.startsWith('conformity-off-integration:')) {
      return t('sidebar.version.conformity.errorOffIntegration', { branch: msg.split(':')[1] })
    }
    if (msg.startsWith('conformity-diverged')) return t('sidebar.version.conformity.errorDiverged')
    return msg
  })()

  return (
    <div style={{ paddingLeft: `${8 + indent}px` }} className="px-3 py-1" data-testid="conformity-notice">
      {items.length > 0 && (
        <>
          <div className="flex items-start gap-1.5 text-xs text-status-warning leading-snug">
            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
            <span className="flex-1">{t('sidebar.version.conformity.title')}</span>
            <button
              type="button"
              onClick={() => setShowDetails(v => !v)}
              className="shrink-0 flex items-center text-ink-3 hover:text-ink"
            >
              {showDetails ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {t('sidebar.version.conformity.details')}
            </button>
          </div>
          <ul className="text-xs text-ink-2 mt-0.5 ml-5 list-disc pl-3">
            {items.map(item => (
              <li key={item.id}>
                {t(`sidebar.version.conformity.item_${item.id}`)}
                {showDetails && <span className="text-ink-3"> — {item.files.join(', ')}</span>}
              </li>
            ))}
          </ul>
          {showDetails && <p className="text-xs text-ink-3 mt-0.5 ml-5">{t('sidebar.version.conformity.intro')}</p>}
          <div className="flex gap-2 mt-1 ml-4">
            <button
              type="button"
              className="btn-primary-sm"
              disabled={apply.isPending}
              onClick={() => apply.mutate()}
            >
              {apply.isPending ? t('sidebar.version.conformity.applying') : t('sidebar.version.conformity.apply')}
            </button>
            <button
              type="button"
              className="text-xs text-ink-3 hover:text-ink"
              disabled={apply.isPending}
              onClick={() => { dismissed.add(repoPath); setHidden(true) }}
            >
              {t('sidebar.version.conformity.later')}
            </button>
          </div>
        </>
      )}
      {checkError && (
        <p className="text-xs text-status-danger leading-snug">
          {t('sidebar.version.conformity.checkFailed', { error: branchErrorText(checkError) })}
        </p>
      )}
      {errorText && <p className="text-xs text-status-danger leading-snug mt-1 whitespace-pre-line">{errorText}</p>}
      {result && (result.pushed
        ? items.length === 0 && <p className="text-xs text-status-success leading-snug">{t('sidebar.version.conformity.done')}</p>
        : <p className="text-xs text-status-danger leading-snug">{t('sidebar.version.conformity.pushFailed', { error: result.pushError })}</p>)}
    </div>
  )
}
