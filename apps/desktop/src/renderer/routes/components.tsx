import { createFileRoute } from '@tanstack/react-router'
import { SystemView } from '../components/system/SystemView'
import { useSystemView } from '../contexts/SystemViewContext'
import { useSetTabTitle } from '../contexts/TabsContext'

export const Route = createFileRoute('/components')({
  component: ComponentsPage,
  validateSearch: (search: Record<string, unknown>) => ({
    projectId: (search['projectId'] as string) ?? '',
    repo: search['repo'] as string | undefined,
    component: search['component'] as string | undefined,
    type: search['type'] as string | undefined,
    // 'level' and 'tab' kept for backwards compat but no longer used
    level: search['level'] as string | undefined,
    tab: search['tab'] as string | undefined,
  }),
})

function ComponentsPage() {
  const { effectiveNode, effectiveType } = useSystemView()
  // `|| ` (not `??`) on purpose: an object type saved with a blank label/name is not a usable
  // suffix either, same as it being absent — falls back to the generic "Composants" tab title.
  const typeLabel = effectiveType?.label || effectiveType?.name
  useSetTabTitle(effectiveNode && typeLabel ? `${effectiveNode.label} — ${typeLabel}` : undefined)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <SystemView />
    </div>
  )
}
