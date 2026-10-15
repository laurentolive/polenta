import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { findSystemNode } from '@polenta/types'
import type { HistoryBackfillResult } from '@polenta/types'
import { api } from '../../api'
import { useProjectSchema } from '../../hooks/useProjectSchema'
import { useWorkspaceStructure } from '../../hooks/useWorkspaceStructure'

interface RepoState {
  running?: boolean
  confirming?: boolean
  result?: HistoryBackfillResult
  error?: string
}

/**
 * GH77 — reprise de l'historique des champs suivis depuis git (spec §9) : action manuelle, une ligne
 * par repo du workspace. Les fichiers complétés restent dans le working tree, à publier.
 */
export function HistoryBackfillPanel({ workspaceDir, repoPath }: { workspaceDir: string; repoPath: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { flatNodes } = useWorkspaceStructure(workspaceDir, repoPath)
  const { data: schema } = useProjectSchema(repoPath)
  const [states, setStates] = useState<Record<string, RepoState>>({})

  // Composants montés sous un nœud `readonly: true` du schéma ouvert : pas de réécriture proposée
  // (même règle que la revalidation, T172).
  const repos = [{ repoPath, name: repoPath.split(/[\\/]/).pop() ?? repoPath }, ...flatNodes]
    .filter((r, i, all) => r.repoPath && all.findIndex(x => x.repoPath === r.repoPath) === i)
    .filter(r => r.repoPath === repoPath || !(schema && findSystemNode(schema.nodes, r.name)?.readonly))

  const set = (path: string, next: RepoState) => setStates(s => ({ ...s, [path]: next }))

  const run = async (path: string) => {
    set(path, { running: true })
    try {
      const result = await api.history.backfill(path)
      set(path, { result })
      await qc.invalidateQueries()
    } catch (err) {
      set(path, { error: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <div className="mt-6" data-testid="history-backfill">
      <p className="text-sm text-ink">{t('history.backfillTitle')}</p>
      <p className="text-xs text-ink-3 mt-0.5 mb-3">{t('history.backfillHelp')}</p>
      <div className="space-y-2">
        {repos.map(r => {
          const st = states[r.repoPath] ?? {}
          return (
            <div key={r.repoPath} className="text-xs">
              <div className="flex items-center gap-3">
                <span className="text-ink-2 w-56 truncate" title={r.repoPath}>{r.name}</span>
                {st.confirming ? (
                  <span className="flex items-center gap-2">
                    <span className="text-ink-2">{t('history.backfillConfirm', { repo: r.name })}</span>
                    <button type="button" className="btn-primary-sm" onClick={() => void run(r.repoPath)}>{t('common.yes')}</button>
                    <button type="button" className="btn-secondary-sm" onClick={() => set(r.repoPath, {})}>{t('common.no')}</button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn-secondary-sm"
                    disabled={st.running}
                    onClick={() => set(r.repoPath, { confirming: true })}
                  >
                    {st.running ? t('history.backfillRunning') : t('history.backfillRun')}
                  </button>
                )}
              </div>
              {st.result && (
                <p className="mt-1 text-status-success" role="status">
                  {t('history.backfillResult', { objects: st.result.objects, entries: st.result.entriesAdded })}
                  {st.result.failed.length > 0 && (
                    <span className="block text-status-warning">
                      {t('history.backfillFailed', { count: st.result.failed.length, files: st.result.failed.map(f => f.file).join(', ') })}
                    </span>
                  )}
                </p>
              )}
              {st.error && <p className="mt-1 text-status-danger">{st.error}</p>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
