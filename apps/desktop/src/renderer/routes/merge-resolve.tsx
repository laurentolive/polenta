import { createFileRoute } from '@tanstack/react-router'
import { MergeResolvePage } from '../components/merge/MergeResolvePage'

/** GH37 — éditeur de résolution des conflits d'un merge, ouvert dans son propre onglet. */
export const Route = createFileRoute('/merge-resolve')({
  component: MergeResolveRoute,
  validateSearch: (s: Record<string, unknown>) => ({
    id: (s['id'] as string) ?? '',
    projectId: (s['projectId'] as string) ?? '',
  }),
})

function MergeResolveRoute() {
  const { id, projectId } = Route.useSearch()
  // Keyed by session: opening the next repo's resolution in the same tab starts fresh.
  return <MergeResolvePage key={id} id={id} projectId={projectId} />
}
