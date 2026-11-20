import { createFileRoute } from '@tanstack/react-router'
import { ExecutionsView } from '../components/executions/ExecutionsView'
import { validateExecutionsSearch } from '../lib/executionsRoute'

/** GH400 — vue Exécutions (specs/GH400.md) : panneau Campagnes, type de test choisi dans le panneau. */
export const Route = createFileRoute('/executions')({
  component: ExecutionsPage,
  validateSearch: validateExecutionsSearch,
})

function ExecutionsPage() {
  const search = Route.useSearch()
  return <ExecutionsView search={search} />
}
