import { createFileRoute } from '@tanstack/react-router'
import { SystemView } from '../components/system/SystemView'
import { useSystemView } from '../contexts/SystemViewContext'
import { useSetTabTitle } from '../contexts/TabsContext'

export const Route = createFileRoute('/product')({
  component: ProductPage,
  validateSearch: (search: Record<string, unknown>) => ({
    projectId: (search['projectId'] as string) ?? '',
    tab: search['tab'] as string | undefined,
    repo: search['repo'] as string | undefined,
    node: search['node'] as string | undefined,
    type: search['type'] as string | undefined,
    category: search['category'] as string | undefined,
  }),
})

function ProductPage() {
  const { effectiveNode, effectiveType } = useSystemView()
  // `|| ` (not `??`) on purpose: an object type saved with a blank label/name is not a usable
  // suffix either, same as it being absent — falls back to the generic "Produit" tab title.
  const typeLabel = effectiveType?.label || effectiveType?.name
  useSetTabTitle(effectiveNode && typeLabel ? `${effectiveNode.label} — ${typeLabel}` : undefined)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <SystemView />
    </div>
  )
}
