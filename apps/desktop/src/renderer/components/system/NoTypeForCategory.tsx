import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import type { ObjectCategory } from '@polenta/types'

const CATEGORY_LABEL_KEY: Record<ObjectCategory, string> = {
  requirement: 'layout.activityBar.requirements',
  test: 'layout.activityBar.tests',
  campaign: 'layout.activityBar.campaigns',
  change: 'layout.activityBar.changes',
}

// GH144 — empty state of a category tab (Exigences/Tests/Campagnes) when the selected component
// has object types, but none of this tab's category: say so and point to the data model, rather
// than showing the objects of another category.
export function NoTypeForCategory({ category, repoPath, projectId, className }: {
  category: ObjectCategory
  repoPath: string
  projectId: string
  className?: string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <div className={`flex flex-col items-center justify-center gap-2 h-full text-ink-3 px-3 text-center ${className ?? ''}`}>
      <span>{t('sidebar.system.noTypeForCategory', { category: t(CATEGORY_LABEL_KEY[category]) })}</span>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => navigate({ to: '/schema', search: { repoPath, projectId } })}
      >
        {t('sidebar.system.openDataModel')}
      </button>
    </div>
  )
}
