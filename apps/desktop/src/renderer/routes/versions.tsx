import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Package } from 'lucide-react'
import { ViewHeader } from '../components/layout/ViewHeader'
import { useSetTabTitle } from '../contexts/TabsContext'

/** GH201 §6 — accueil du sous-panneau « Produit » : le panneau latéral liste composants et versions. */
export const Route = createFileRoute('/versions')({
  component: VersionsHome,
  validateSearch: (s: Record<string, unknown>) => ({ projectId: (s['projectId'] as string) ?? '' }),
})

function VersionsHome() {
  const { t } = useTranslation()
  const { projectId } = Route.useSearch()
  useSetTabTitle(t('versions.title'))
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ViewHeader currentProjectId={projectId} title={t('versions.title')} />
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-ink-3">
        <Package size={28} />
        <p className="text-xs">{t('versions.home')}</p>
      </div>
    </div>
  )
}
