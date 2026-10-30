import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import type { Change, ChangeTestToRun } from '@polenta/types'
import { api } from '../../api'

// GH207 — campagnes d'un changeset (specs/GH207.md §2–§4) : campagnes liées, tests à exécuter,
// « Créer la campagne », « N tests à ajouter » → sélecteur pré-coché de la campagne choisie.

const OPEN = new Set(['planned', 'in_progress'])

/** Instances retenues par test, pour les paramètres `instances` (`TEST-1:SW-1|SW-2,TEST-2:SW-3`). */
export function encodeInstances(tests: ChangeTestToRun[]): string | undefined {
  const parts = tests.filter(t => t.requirementIds.length > 0).map(t => `${t.testId}:${t.requirementIds.join('|')}`)
  return parts.length > 0 ? parts.join(',') : undefined
}

export function ChangeCampaignsSection({ repoPath, projectId, change }: { repoPath: string; projectId: string; change: Change }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [choosing, setChoosing] = useState(false)
  const { data } = useQuery({
    queryKey: ['change-tests', repoPath, change.id, change.status, change.toModify.length, change.impacted, change.campaigns],
    queryFn: () => api.changesets.testsToRun(repoPath, change.id),
    enabled: !!repoPath,
    // Les campagnes liées évoluent ailleurs (exécution, clôture) : relu à chaque affichage.
    staleTime: 0,
  })
  if (!data) return null
  const openLinked = data.linked.filter(c => !c.missing && OPEN.has(c.status))
  const toAdd = data.tests.filter(x => data.toAdd.includes(x.testId))

  const create = () => navigate({
    to: '/campaign/new',
    search: {
      repoPath, projectId, component: change.component, level: undefined,
      title: `${change.id} — ${change.title}`,
      testCaseIds: data.tests.map(x => x.testId).join(','),
      changeset: change.id,
      instances: encodeInstances(data.tests),
    },
  })
  const addTo = (campaignId: string) => navigate({
    to: '/campaign/$campaignId',
    params: { campaignId },
    search: { repoPath, projectId, component: undefined, level: undefined, addTests: toAdd.map(x => x.testId).join(','), instances: encodeInstances(toAdd) },
  })

  return (
    <section className="border rounded p-3 mb-4" data-testid="change-campaigns">
      <div className="flex items-center justify-between mb-2 gap-2">
        <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide">
          {t('changes.campaigns')} <span className="font-normal text-ink-3 normal-case">({data.linked.length})</span>
        </p>
        <button type="button" className="btn-primary-sm" disabled={data.tests.length === 0} onClick={create} data-testid="change-campaign-create">
          {t('changes.campaignSection.create')}
        </button>
      </div>
      <p className="text-xs text-ink-3 mb-2" data-testid="change-tests-to-run">
        {t('changes.campaignSection.toRun', { count: data.tests.length })}
        {data.uncovered.length > 0 && <> · {t('changes.campaignSection.uncovered', { ids: data.uncovered.join(', ') })}</>}
      </p>
      {toAdd.length > 0 && openLinked.length > 0 && (
        <div className="flex items-center gap-2 text-xs bg-status-info-bg border border-status-info-border rounded px-2 py-1 mb-2" data-testid="change-tests-to-add">
          <span className="text-ink">{t('changes.campaignSection.toAdd', { count: toAdd.length })}</span>
          {openLinked.length === 1 ? (
            <button type="button" className="text-prim hover:underline" onClick={() => addTo(openLinked[0].id)} data-testid="change-tests-add">
              {t('changes.campaignSection.addTo', { id: openLinked[0].id })}
            </button>
          ) : (
            <span className="relative">
              <button type="button" className="text-prim hover:underline" onClick={() => setChoosing(c => !c)} data-testid="change-tests-add">
                {t('changes.campaignSection.addToMany')}
              </button>
              {choosing && (
                <ul className="absolute z-10 mt-1 bg-surface border border-edge rounded shadow">
                  {openLinked.map(c => (
                    <li key={c.id}>
                      <button type="button" className="px-2 py-1 hover:bg-hover whitespace-nowrap" onClick={() => addTo(c.id)}>{c.id} — {c.title}</button>
                    </li>
                  ))}
                </ul>
              )}
            </span>
          )}
        </div>
      )}
      {data.linked.length === 0 ? <p className="text-xs text-ink-3">{t('changes.none')}</p> : (
        <table className="w-full text-sm">
          <tbody>
            {data.linked.map(c => (
              <tr key={c.id} className="border-t border-edge-subtle" data-testid={`change-campaign-${c.id}`}>
                <td className="py-1 pr-3 whitespace-nowrap">
                  {c.missing
                    ? <span className="font-mono text-ink-3 line-through">{c.id}</span>
                    : <Link to="/campaign/$campaignId" params={{ campaignId: c.id }} search={{ repoPath, projectId, component: undefined, level: undefined }} className="font-mono text-prim hover:underline">{c.id}</Link>}
                </td>
                <td className="py-1 pr-3 text-ink truncate">{c.missing ? t('changes.removed') : c.title}</td>
                <td className="py-1 pr-3 text-xs text-ink-3 whitespace-nowrap">{c.missing ? '' : t(`executionHistory.campaignStatus.${c.status}`, { defaultValue: c.status })}</td>
                <td className="py-1 pr-3 text-xs text-ink-3 whitespace-nowrap">{c.missing ? '' : t('changes.campaignSection.progress', { passed: c.passed, total: c.total })}</td>
                <td className="py-1 text-xs text-ink-3 whitespace-nowrap">{c.missing ? '' : t('changes.campaignSection.changesetTests', { count: c.changesetTests })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
