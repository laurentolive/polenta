import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ShieldCheck } from 'lucide-react'
import { ViewHeader } from '../components/layout/ViewHeader'
import { useSetTabTitle } from '../contexts/TabsContext'

/** GH204 §7 — accueil de la vue Validation : le panneau latéral liste composants et versions. */
export const Route = createFileRoute('/validations')({
  component: ValidationsHome,
  validateSearch: (s: Record<string, unknown>) => ({ projectId: (s['projectId'] as string) ?? '' }),
})

function ValidationsHome() {
  const { t } = useTranslation()
  const { projectId } = Route.useSearch()
  useSetTabTitle(t('validation.title'))
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ViewHeader currentProjectId={projectId} title={t('validation.title')} />
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-ink-3">
        <ShieldCheck size={28} />
        <p className="text-xs">{t('validation.home')}</p>
      </div>
    </div>
  )
}
