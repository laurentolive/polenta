import { createFileRoute, Navigate } from '@tanstack/react-router'

export const Route = createFileRoute('/versioning')({
  component: VersioningRedirect,
  validateSearch: (s: Record<string, unknown>) => ({
    projectId: (s['projectId'] as string) ?? '',
  }),
})

function VersioningRedirect() {
  const { projectId } = Route.useSearch()
  return <Navigate to="/graph" search={{ projectId, sha: undefined }} replace />
}
