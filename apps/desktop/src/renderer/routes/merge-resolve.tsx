import { createFileRoute } from '@tanstack/react-router'
import { MergeResolvePage } from '../components/merge/MergeResolvePage'

/** GH37 — éditeur de résolution des conflits d'un merge, ouvert dans son propre onglet. */
export const Route = createFileRoute('/merge-resolve')({
  component: MergeResolveRoute,
  validateSearch: (s: Record<string, unknown>): { id: string; projectId: string; file?: string } => ({
    id: (s['id'] as string) ?? '',
    projectId: (s['projectId'] as string) ?? '',
    // GH233 — fichier ouvert, partagé avec le panneau latéral « Fichiers en conflit ».
    file: (s['file'] as string | undefined) || undefined,
  }),
})

function MergeResolveRoute() {
  const { id, projectId, file } = Route.useSearch()
  const navigate = Route.useNavigate()
  const select = (next: string) => navigate({ search: { id, projectId, file: next }, replace: true })
  // Keyed by session: opening the next repo's resolution in the same tab starts fresh.
  return <MergeResolvePage key={id} id={id} projectId={projectId} selected={file ?? null} onSelect={select} />
}
