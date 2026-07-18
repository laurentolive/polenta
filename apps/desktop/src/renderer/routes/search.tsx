/**
 * SearchPage — T107.
 *
 * Dedicated landing page for the "Recherche" activity-bar entry. The search
 * itself (query, filters, replace, results list) lives entirely in
 * `SearchPanel` (sidebar) — this route only owns the main content area, so
 * that opening Recherche doesn't leave whatever page was open before still
 * displayed behind it (T107).
 *
 * URL: /search?projectId=<encoded>
 */
import { createFileRoute } from '@tanstack/react-router'
import { Search } from 'lucide-react'

export const Route = createFileRoute('/search')({
  component: SearchPage,
  validateSearch: (s: Record<string, unknown>) => ({
    projectId: (s['projectId'] as string) ?? '',
  }),
})

function SearchPage() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 text-ink-3 text-sm">
      <Search size={28} className="opacity-30" />
      <p>Utilisez le panneau de recherche à gauche pour rechercher dans les exigences, tests et campagnes.</p>
    </div>
  )
}
