/**
 * SearchPage — zone principale de la Vue Recherche (activité « Recherche »).
 *
 * T107 : cette route possède la zone de contenu principale de `/search` pour ne pas
 * laisser la page précédente affichée derrière le panneau de recherche.
 * T167 : elle affiche la liste des résultats (style Vue Word) — `SearchResultsDoc` — ou,
 * quand un résultat est en cours d'édition (`editing`), le formulaire `EditView`
 * (`SearchEditPane`), sans jamais quitter `/search`. État partagé via `SearchContext`.
 *
 * URL: /search?projectId=<encoded>
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { ViewHeader } from '../components/layout/ViewHeader'
import { SearchResultsDoc } from '../components/search/SearchResultsDoc'
import { SearchEditPane } from '../components/search/SearchEditPane'
import { ParamRefProvider } from '../contexts/ParamRefContext'
import { decodeProjectId } from '../lib/projectId'
import { useOptionalSearch } from '../contexts/SearchContext'
import type { SearchResult } from '../lib/searchQuery'

export const Route = createFileRoute('/search')({
  component: SearchPage,
  validateSearch: (s: Record<string, unknown>) => ({
    projectId: (s['projectId'] as string) ?? '',
  }),
})

function SearchPage() {
  const { t } = useTranslation()
  const { projectId } = Route.useSearch()
  const navigate = useNavigate()
  const search = useOptionalSearch()

  const emptyState = (message: string) => (
    <div className="flex flex-col h-full overflow-hidden">
      <ViewHeader currentProjectId={projectId} title={t('sidebar.search.title')} />
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-ink-3 text-sm">
        <Search size={28} className="opacity-30" />
        <p>{message}</p>
      </div>
    </div>
  )

  // Provider absent : `/search` atteint sans projet ouvert (route restaurée, projet fermé).
  if (!search) return emptyState(t('search.page.hint'))

  const {
    repoPath, regex, results, requirements, tests, campaigns,
    gotoId, gotoSeq, setGoto, clearGoto,
    editing, openEditor, closeEditor,
  } = search

  // T171 — références de paramètres résolues dans la liste comme dans l'édition.
  const withParams = (node: ReactNode) => (
    <ParamRefProvider repoPath={repoPath} workspaceDir={projectId ? decodeProjectId(projectId) : ''} projectId={projectId}>
      {node}
    </ParamRefProvider>
  )

  // Édition inline d'un résultat (exigence / test) — prioritaire sur la liste.
  if (editing) {
    return withParams(<SearchEditPane editing={editing} repoPath={repoPath} projectId={projectId} onBack={closeEditor} />)
  }

  if (!regex) return emptyState(t('search.page.hint'))
  if (results.length === 0) return emptyState(t('search.page.noResults'))

  // Double-clic : exigence / test → édition inline ; campagne (pas d'endpoint
  // d'édition générique) → page campagne dédiée.
  const handleOpen = (result: SearchResult) => {
    if (result.itemType === 'campaign') {
      if (!repoPath) return
      navigate({
        to: '/campaign/$campaignId',
        params: { campaignId: result.id },
        search: { repoPath, projectId, component: undefined, level: undefined },
      })
      return
    }
    openEditor(result)
  }

  return withParams(
    <div className="flex flex-col h-full overflow-hidden">
      <ViewHeader currentProjectId={projectId} title={t('sidebar.search.title')} />
      <SearchResultsDoc
        repoPath={repoPath}
        results={results}
        requirements={requirements}
        tests={tests}
        campaigns={campaigns}
        regex={regex}
        gotoId={gotoId}
        gotoSeq={gotoSeq}
        onGoto={setGoto}
        onClearGoto={clearGoto}
        onOpen={handleOpen}
      />
    </div>
  )
}
