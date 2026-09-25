import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Lock, Plus, Search } from 'lucide-react'
import type { Parameter, RepoParameters } from '@polenta/types'
import { api } from '../../api'
import { ParameterEditDialog } from './ParameterEditDialog'

interface Props {
  /** Repo ouvert (repo produit / racine du workspace). */
  repoPath: string
  workspaceDir: string
  projectId: string
  /** Filtre sur un repo (sélection dans le panneau latéral) ; absent = tous. */
  repoFilter?: string
}

type DialogState = { repo: RepoParameters; parameter?: Parameter } | null

/** T171 — vue Paramètres : bases de paramètres regroupées par repo, recherche, édition. */
export function ParametersView({ repoPath, workspaceDir, projectId, repoFilter }: Props) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState<DialogState>(null)

  const { data: repos = [], isLoading } = useQuery({
    queryKey: ['parameters', workspaceDir, repoPath],
    queryFn: () => api.parameters.list(repoPath, workspaceDir || undefined),
    enabled: !!repoPath,
  })

  const needle = search.trim().toLowerCase()
  const shown = useMemo(() => repos
    .filter(r => !repoFilter || r.repoPath === repoFilter)
    .map(r => ({
      repo: r,
      parameters: needle
        ? r.parameters.filter(p => [p.name, p.value, p.description ?? ''].some(s => s.toLowerCase().includes(needle)))
        : r.parameters,
    })), [repos, repoFilter, needle])

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-6">
        <div className="flex items-center gap-2 mb-5">
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              className="input-field w-full pl-7 text-xs"
              placeholder={t('parameters.searchPlaceholder')}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {isLoading && <p className="text-sm text-ink-3">{t('common.loading')}</p>}

        {shown.map(({ repo, parameters }) => (
          <section key={repo.repoPath} className="mb-8">
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-sm font-semibold text-ink">{repo.label ?? repo.repoName}</h2>
              {repo.label && <span className="text-xs text-ink-3 font-mono">{repo.repoName}</span>}
              {repo.readonly && (
                <span className="flex items-center gap-1 text-xs text-ink-3"><Lock size={12} />{t('parameters.readOnly')}</span>
              )}
              <div className="flex-1" />
              {!repo.readonly && (
                <button type="button" className="btn-secondary flex items-center gap-1 text-xs" onClick={() => setDialog({ repo })}>
                  <Plus size={12} />{t('parameters.new')}
                </button>
              )}
            </div>
            {parameters.length === 0 ? (
              <p className="text-xs text-ink-3 italic">{needle ? t('common.noResults') : t('parameters.empty')}</p>
            ) : (
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-left text-ink-3">
                    <th className="font-medium py-1 pr-3 w-1/4">{t('parameters.fields.name')}</th>
                    <th className="font-medium py-1 pr-3">{t('parameters.fields.value')}</th>
                    <th className="font-medium py-1 pr-3 w-16">{t('parameters.fields.unit')}</th>
                    <th className="font-medium py-1 pr-3">{t('parameters.fields.description')}</th>
                    <th className="font-medium py-1 w-20 text-right">{t('parameters.uses')}</th>
                  </tr>
                </thead>
                <tbody>
                  {parameters.map(p => (
                    <tr
                      key={p.name}
                      className="border-t border-edge hover:bg-row-hover cursor-pointer"
                      onClick={() => setDialog({ repo, parameter: p })}
                    >
                      <td className="py-1.5 pr-3 font-mono text-ink">{p.name}</td>
                      <td className="py-1.5 pr-3 text-ink">
                        {p.value || <span className="text-status-warning italic">{t('parameters.emptyValue')}</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-ink-2">{p.unit}</td>
                      <td className="py-1.5 pr-3 text-ink-2">{p.description}</td>
                      <td className="py-1.5 text-right text-ink-2">{repo.usageCounts[p.name] ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        ))}
      </div>

      {dialog && (
        <ParameterEditDialog
          repoPath={dialog.repo.repoPath}
          workspaceDir={workspaceDir}
          projectId={projectId}
          parameter={dialog.parameter}
          readOnly={dialog.repo.readonly}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}
