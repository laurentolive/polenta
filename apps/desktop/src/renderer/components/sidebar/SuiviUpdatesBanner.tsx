/**
 * GH74 §6.3 — bandeau des mises à jour en tête du panneau Suivi : fichiers de la bibliothèque de
 * départ restés à une version livrée antérieure (ou nouveaux), widget ajouté au seed « Campagnes »,
 * nouvelle version de modèle d'un objet de seed. Liste à cocher → « Appliquer » (écriture normale, à
 * publier pour les fichiers partagés) ; « Ignorer » masque une version pour l'utilisateur. Sur une
 * branche en lecture seule : liste affichée sans bouton.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import { api } from '../../api'
import type { SuiviUpdate } from '@polenta/types'

interface Props {
  repoPath: string
  username: string
  /** Lu après le seed (déclenché par `dashboards:list`) : sinon la liste précéderait la copie. */
  enabled: boolean
}

export function SuiviUpdatesBanner({ repoPath, username, enabled }: Props) {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const lang = i18n.resolvedLanguage === 'en' ? 'en' : 'fr'
  const [open, setOpen] = useState(false)
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const key = ['suivi-updates', repoPath, username]
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => api.suivi.updatesList(repoPath, username, i18n.resolvedLanguage),
    enabled: enabled && !!repoPath && !!username,
  })
  const updates = data?.updates ?? []

  const refresh = () => {
    qc.invalidateQueries({ queryKey: key })
    qc.invalidateQueries({ queryKey: ['dashboards', repoPath, username] })
    qc.invalidateQueries({ queryKey: ['queries', repoPath, username] })
    qc.invalidateQueries({ queryKey: ['widget-query-result'] })
  }

  const apply = useMutation({
    mutationFn: (ids: string[]) => api.suivi.updatesApply(repoPath, username, ids, i18n.resolvedLanguage),
    onSuccess: () => { setError(null); setUnchecked(new Set()); refresh() },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  })
  const ignore = useMutation({
    mutationFn: (u: SuiviUpdate) => api.suivi.updatesIgnore(repoPath, username, u.id, u.toVersion),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  })

  if (updates.length === 0) return null
  const selected = updates.filter((u) => !unchecked.has(u.id)).map((u) => u.id)
  const toggle = (id: string) => setUnchecked((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return (
    <div className="mx-3 mt-2 border border-status-info/40 bg-status-info-bg rounded text-xs shrink-0" data-testid="suivi-updates">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-1.5 px-2 py-1.5 text-status-info font-medium">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <RefreshCw size={11} />
        {t('sidebar.dashboard.updates.title', { count: updates.length })}
      </button>
      {open && (
        <div className="px-2 pb-2 space-y-1.5">
          {data?.readOnly && <p className="text-ink-3 italic">{t('sidebar.dashboard.updates.readOnly')}</p>}
          <ul className="space-y-1.5 max-h-48 overflow-y-auto">
            {updates.map((u) => (
              <li key={u.id} className="flex items-start gap-1.5" data-testid="suivi-update">
                {!data?.readOnly && (
                  <input type="checkbox" className="mt-0.5" checked={!unchecked.has(u.id)} onChange={() => toggle(u.id)} aria-label={u.title} />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-ink break-all" title={u.title}>
                    {u.kind === 'seed-widget' ? t('sidebar.dashboard.updates.seedWidget', { dashboard: u.title }) : u.title}
                    <span className="text-ink-3">
                      {' '}
                      {u.fromVersion === undefined
                        ? t('sidebar.dashboard.updates.new')
                        : t('sidebar.dashboard.updates.version', { from: u.fromVersion, to: u.toVersion })}
                    </span>
                  </p>
                  <p className="text-ink-3">{u.summary[lang]}</p>
                  {u.shared && !data?.readOnly && <p className="text-ink-3 italic">{t('sidebar.dashboard.updates.toPublish')}</p>}
                </div>
                <button type="button" onClick={() => ignore.mutate(u)} className="text-ink-3 hover:text-ink underline shrink-0">
                  {t('sidebar.dashboard.updates.ignore')}
                </button>
              </li>
            ))}
          </ul>
          {error && <p className="text-status-danger">{error}</p>}
          {!data?.readOnly && (
            <button
              type="button"
              className="btn-primary text-xs py-1"
              disabled={selected.length === 0 || apply.isPending}
              onClick={() => apply.mutate(selected)}
            >
              {apply.isPending ? t('sidebar.dashboard.updates.applying') : t('sidebar.dashboard.updates.apply', { count: selected.length })}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
