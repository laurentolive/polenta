import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { GitPullRequestArrow } from 'lucide-react'
import { useProjectSchema, getAllObjectTypes } from '../../hooks/useProjectSchema'

/**
 * GH198 — « Créer un change » depuis une exigence ou un test (specs/GH198.md §5, Q4) : formulaire
 * de création avec l'élément dans « à modifier » et le composant de l'élément. Masqué tant que le
 * repo ne déclare aucun type de change.
 */
export function CreateChangeButton({ repoPath, projectId, elementId, objectTypeRef }: {
  repoPath: string
  projectId: string
  elementId: string
  objectTypeRef?: string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: schema } = useProjectSchema(repoPath)
  if (!projectId || getAllObjectTypes(schema, 'change').length === 0) return null
  const component = objectTypeRef?.includes('::') ? objectTypeRef.split('::')[0] : undefined
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink"
      onClick={() => navigate({ to: '/change/new', search: { projectId, repoPath, element: elementId, component } })}
      data-testid="create-change"
    >
      <GitPullRequestArrow size={13} />
      {t('changes.createFromElement')}
    </button>
  )
}
