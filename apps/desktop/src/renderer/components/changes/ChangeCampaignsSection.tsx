import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import type { Change, ChangeTestToRun } from '@polenta/types'
import { api } from '../../api'
import { useProjectSchema } from '../../hooks/useProjectSchema'
import { useRepoElements } from './ChangeElements'

// GH207 — campagnes d'un changeset (specs/GH207.md §2–§4) : campagnes liées, tests à exécuter
// listés et cochables (retour de validation du 2026-10-31 : l'utilisateur choisit précisément les
// tests), « Créer une campagne » / « Ajouter à … » avec les tests cochés → sélecteur pré-coché.

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
  const { data: schema } = useProjectSchema(repoPath)
  const elements = useRepoElements(repoPath, schema)
  const { data } = useQuery({
    queryKey: ['change-tests', repoPath, change.id, change.status, change.toModify.length, change.impacted, change.campaigns],
    queryFn: () => api.changesets.testsToRun(repoPath, change.id),
    enabled: !!repoPath,
    // Les campagnes liées évoluent ailleurs (exécution, clôture) : relu à chaque affichage.
    staleTime: 0,
  })

  // Cochés par défaut : les tests absents des campagnes liées ouvertes ; recalculé quand la liste change.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const signature = data ? `${data.tests.map(x => x.testId).join(',')}|${data.toAdd.join(',')}` : ''
  useEffect(() => {
    if (data) setSelected(new Set(data.toAdd))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recalcul sur le contenu, pas sur l'objet
  }, [signature])

  const inCampaigns = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const c of data?.linked ?? []) {
      if (c.missing || !OPEN.has(c.status)) continue
      for (const id of c.testIds) m.set(id, [...(m.get(id) ?? []), c.id])
    }
    return m
  }, [data])

  if (!data) return null
  const openLinked = data.linked.filter(c => !c.missing && OPEN.has(c.status))
  const chosen = data.tests.filter(x => selected.has(x.testId))
  const allChosen = data.tests.length > 0 && chosen.length === data.tests.length
  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const create = () => navigate({
    to: '/campaign/new',
    search: {
      repoPath, projectId, component: change.component, level: undefined,
      title: `${change.id} — ${change.title}`,
      testCaseIds: chosen.map(x => x.testId).join(','),
      changeset: change.id,
      instances: encodeInstances(chosen),
    },
  })
  const addTo = (campaignId: string) => navigate({
    to: '/campaign/$campaignId',
    params: { campaignId },
    search: { repoPath, projectId, component: undefined, level: undefined, addTests: chosen.map(x => x.testId).join(','), instances: encodeInstances(chosen) },
  })

  return (
    <section className="border rounded p-3 mb-4" data-testid="change-campaigns">
      <div className="flex items-center justify-between mb-2 gap-2">
        <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide">
          {t('changes.campaigns')} <span className="font-normal text-ink-3 normal-case">({data.linked.length})</span>
        </p>
        <div className="flex items-center gap-3">
          {openLinked.length === 1 && (
            <button type="button" className="text-xs text-prim hover:underline disabled:opacity-50" disabled={chosen.length === 0} onClick={() => addTo(openLinked[0].id)} data-testid="change-tests-add">
              {t('changes.campaignSection.addTo', { id: openLinked[0].id })}
            </button>
          )}
          {openLinked.length > 1 && (
            <span className="relative">
              <button type="button" className="text-xs text-prim hover:underline disabled:opacity-50" disabled={chosen.length === 0} onClick={() => setChoosing(c => !c)} data-testid="change-tests-add">
                {t('changes.campaignSection.addToMany')}
              </button>
              {choosing && (
                <ul className="absolute right-0 z-10 mt-1 bg-surface border border-edge rounded shadow text-xs">
                  {openLinked.map(c => (
                    <li key={c.id}>
                      <button type="button" className="px-2 py-1 hover:bg-hover whitespace-nowrap" onClick={() => addTo(c.id)}>{c.id} — {c.title}</button>
                    </li>
                  ))}
                </ul>
              )}
            </span>
          )}
          <button type="button" className="btn-primary-sm" disabled={chosen.length === 0} onClick={create} data-testid="change-campaign-create">
            {t('changes.campaignSection.create')}
          </button>
        </div>
      </div>

      <p className="text-xs text-ink-3 mb-1" data-testid="change-tests-to-run">
        {t('changes.campaignSection.toRun', { count: data.tests.length })}
        {openLinked.length > 0 && data.toAdd.length > 0 && (
          <> · <span data-testid="change-tests-to-add">{t('changes.campaignSection.toAdd', { count: data.toAdd.length })}</span></>
        )}
        {data.uncovered.length > 0 && <> · {t('changes.campaignSection.uncovered', { ids: data.uncovered.join(', ') })}</>}
      </p>
      {data.tests.length > 0 && (
        <table className="w-full text-sm mb-3" data-testid="change-tests-list">
          <thead className="text-xs text-ink-3 text-left">
            <tr>
              <th className="w-6 py-1">
                <input type="checkbox" checked={allChosen} aria-label={t('changes.campaignSection.selectAll')}
                  onChange={() => setSelected(allChosen ? new Set() : new Set(data.tests.map(x => x.testId)))} />
              </th>
              <th className="py-1 pr-3 font-normal">ID</th>
              <th className="py-1 pr-3 font-normal">{t('changes.backlog.titleCol')}</th>
              <th className="py-1 pr-3 font-normal">{t('changes.campaignSection.via')}</th>
              <th className="py-1 font-normal">{t('changes.campaignSection.inCampaigns')}</th>
            </tr>
          </thead>
          <tbody>
            {data.tests.map(x => (
              <tr key={x.testId} className="border-t border-edge-subtle" data-testid={`change-test-${x.testId}`}>
                <td className="py-1">
                  <input type="checkbox" checked={selected.has(x.testId)} onChange={() => toggle(x.testId)} aria-label={t('changes.backlog.select', { id: x.testId })} />
                </td>
                <td className="py-1 pr-3 whitespace-nowrap">
                  <Link to="/test/$testId" params={{ testId: x.testId }} search={{ repoPath, projectId, component: undefined, level: undefined }} className="font-mono text-prim hover:underline">{x.testId}</Link>
                </td>
                <td className="py-1 pr-3 text-ink truncate">{elements.get(x.testId)?.title ?? ''}</td>
                <td className="py-1 pr-3 text-xs text-ink-3 font-mono">{x.sources.filter(id => id !== x.testId).join(', ')}</td>
                <td className="py-1 text-xs text-ink-3 font-mono">{(inCampaigns.get(x.testId) ?? []).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
