import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { VersionTestToRun, VersionTestsToRun } from '@polenta/types'
import { api } from '../../api'
import { DataGrid } from '../grid/DataGrid'
import { useGridScrollKey } from '../grid/useGridScrollKey'
import { useSectionOpen } from './useVersions'
import { VERSION_TEST_DEFAULTS, buildVersionTestColumns, versionTestRowId as testIdOf } from './versionTestColumns'

/** Instances retenues par test, pour le paramètre `instances` (`TEST-1:SW-1|SW-2,TEST-2:SW-3`, GH207). */
export function encodeInstances(tests: VersionTestToRun[]): string | undefined {
  const parts = tests.filter(t => t.requirementIds.length > 0).map(t => `${t.testId}:${t.requirementIds.join('|')}`)
  return parts.length > 0 ? parts.join(',') : undefined
}

/**
 * GH245 §2 — tests à exécuter d'une version : grille à cases (GH389 §4, `DataGrid`), élément(s) qui amènent chaque test,
 * campagnes ouvertes qui le contiennent déjà (information) ; « Créer une campagne » et « Ajouter à … »
 * sont des raccourcis : aucun lien n'est écrit entre la version et la campagne.
 */
export function VersionTestsSection({ data, repoPath, projectId, versionLabel }: {
  data: VersionTestsToRun | undefined
  repoPath: string
  projectId: string
  versionLabel: string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useSectionOpen('tests')

  // Cochés par défaut : les tests qu'aucune campagne ouverte ne contient ; recalculé si la liste change.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const signature = data ? data.tests.map(x => `${x.testId}:${x.alreadyIn.length}`).join(',') : ''
  useEffect(() => {
    if (data) setSelected(new Set(data.tests.filter(x => x.alreadyIn.length === 0).map(x => x.testId)))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recalcul sur le contenu, pas sur l'objet
  }, [signature])

  const tests = useMemo(() => data?.tests ?? [], [data])
  const chosen = tests.filter(x => selected.has(x.testId))
  const scrollKey = useGridScrollKey('version-tests')
  const columns = useMemo(() => buildVersionTestColumns({ t }), [t])
  const prefs = useMemo(() => ({ repoPath, prefKey: 'grid::version-tests', view: 'columns', defaults: VERSION_TEST_DEFAULTS }), [repoPath])
  // Campagnes ouvertes du repo : cibles de « Ajouter à … » (raccourci, aucun lien écrit).
  const { data: campaigns = [] } = useQuery({
    queryKey: ['campaigns', repoPath],
    queryFn: () => api.campaigns.list(repoPath),
    enabled: !!repoPath && open,
  })
  const openCampaigns = campaigns.filter(c => c.status === 'planned' || c.status === 'in_progress')

  const create = () => navigate({
    to: '/campaign/new',
    search: {
      repoPath, projectId, component: undefined, level: undefined,
      title: versionLabel,
      testCaseIds: chosen.map(x => x.testId).join(','),
      instances: encodeInstances(chosen),
    },
  })
  const addTo = (campaignId: string) => navigate({
    to: '/campaign/$campaignId',
    params: { campaignId },
    search: { repoPath, projectId, component: undefined, level: undefined, addTests: chosen.map(x => x.testId).join(','), instances: encodeInstances(chosen) },
  })

  return (
    <section className="flex flex-col gap-2" data-testid="version-tests">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex items-center gap-1 section-label hover:text-ink">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {t('versions.tests.title')}
          {data && <span className="font-normal text-ink-3 normal-case">({tests.length})</span>}
        </button>
        <div className="flex-1" />
        {open && data && (
          <>
            {openCampaigns.length > 0 && (
              <select
                value=""
                disabled={chosen.length === 0}
                onChange={e => { if (e.target.value) addTo(e.target.value) }}
                className="input-field text-xs py-1 disabled:opacity-50"
                aria-label={t('versions.tests.addTo')}
                data-testid="version-tests-add"
              >
                <option value="">{t('versions.tests.addTo')}</option>
                {openCampaigns.map(c => <option key={c.id} value={c.id}>{c.id} — {c.title}</option>)}
              </select>
            )}
            <button type="button" className="btn-primary-sm" disabled={chosen.length === 0} onClick={create} data-testid="version-campaign-create">
              {t('versions.tests.create')}
            </button>
          </>
        )}
      </div>

      {open && (!data ? <p className="text-xs text-ink-3 italic">{t('common.loading')}</p> : (
        <>
          {data.uncovered.length > 0 && (
            <p className="text-xs text-status-warning" data-testid="version-tests-uncovered">{t('versions.tests.uncovered', { ids: data.uncovered.join(', ') })}</p>
          )}
          {tests.length === 0 ? <p className="text-xs text-ink-3 italic">{t('versions.tests.none')}</p> : (
            <div className="flex flex-col max-h-[60vh] min-h-0" data-testid="version-tests-list">
              <DataGrid
                gridId="version-tests"
                title={`${t('versions.tests.title')} ${versionLabel}`}
                rows={tests}
                getRowId={testIdOf}
                columns={columns}
                prefs={prefs}
                selection={{ mode: 'checkbox', selected, onChange: setSelected }}
                scrollMemoryKey={scrollKey}
                noExport
              />
            </div>
          )}
        </>
      ))}
    </section>
  )
}
